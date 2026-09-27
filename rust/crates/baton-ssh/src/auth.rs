use crate::*;
use russh::{
    client::{self, Handle, KeyboardInteractiveAuthResponse as Interactive},
    keys::{PrivateKeyWithHashAlg, decode_secret_key},
};
use std::{
    future::Future,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{sync::watch, time::Instant};

pub(crate) struct Context {
    pub session: SessionId,
    pub attempt: AttemptId,
    pub ui: Arc<dyn AuthUi>,
    pub cancel: CancellationToken,
    next: AtomicU64,
    pub paused: watch::Sender<bool>,
    pub failure: Mutex<Option<SshError>>,
    cleanup: Mutex<Option<Instant>>,
}
impl Context {
    pub fn new(r: &ConnectRequest, ui: Arc<dyn AuthUi>, cancel: CancellationToken) -> Self {
        Self {
            session: r.session,
            attempt: r.attempt_id,
            ui,
            cancel,
            next: AtomicU64::new(1),
            paused: watch::channel(false).0,
            failure: Mutex::new(None),
            cleanup: Mutex::new(None),
        }
    }
    pub async fn ask(
        &self,
        kind: PromptKind,
        display: String,
        prompts: Vec<PromptField>,
    ) -> Result<AuthAnswer, SshError> {
        if prompts.len() > 16
            || display.len() + prompts.iter().map(|p| p.text.len()).sum::<usize>() > 32768
        {
            return Err(SshError::InvalidInput);
        }
        self.check()?;
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.paused.send_replace(true);
        struct Resume<'a>(&'a watch::Sender<bool>);
        impl Drop for Resume<'_> {
            fn drop(&mut self) {
                self.0.send_replace(false);
            }
        }
        let _resume = Resume(&self.paused);
        let prompt = AuthPrompt {
            session: self.session,
            attempt_id: self.attempt,
            challenge_id: ChallengeId(id.into()),
            kind,
            display,
            prompts,
        };
        let answer = tokio::select! {biased; _=self.cancel.cancelled()=>Err(SshError::Cancelled),result=tokio::time::timeout(Duration::from_secs(300),self.ui.ask(prompt))=>result.map_err(|_|SshError::Timeout)?}?;
        self.check()?;
        let size = match &answer {
            AuthAnswer::Host(_) => 0,
            AuthAnswer::Password(p) => p.len(),
            AuthAnswer::Key {
                encoded,
                passphrase,
            } => {
                if encoded.len() > 1048576 {
                    return Err(SshError::InvalidInput);
                }
                passphrase.len()
            }
            AuthAnswer::Interactive(values) => {
                if values.len() > 16 {
                    return Err(SshError::InvalidInput);
                }
                values.iter().map(|v| v.len()).sum()
            }
        };
        if size > 16384 {
            return Err(SshError::InvalidInput);
        }
        Ok(answer)
    }
    pub fn check(&self) -> Result<(), SshError> {
        if self.cancel.is_cancelled() {
            Err(SshError::Cancelled)
        } else {
            Ok(())
        }
    }
    pub fn cleanup_deadline(&self) -> Instant {
        let mut deadline = self.cleanup.lock().unwrap();
        *deadline.get_or_insert_with(|| Instant::now() + Duration::from_secs(5))
    }
    pub async fn auth_network<T, E>(
        &self,
        future: impl Future<Output = Result<T, E>>,
        success: fn(&T) -> bool,
    ) -> Result<T, SshError> {
        self.check()?;
        let deadline = Instant::now() + Duration::from_secs(10);
        tokio::pin!(future);
        tokio::select! {biased;
            _=self.cancel.cancelled()=>{
                // An already-sent authentication cannot be undone. Drain only that
                // reply within the common cleanup budget, never open a channel.
                if let Ok(Ok(value))=tokio::time::timeout_at(deadline.min(self.cleanup_deadline()),&mut future).await {
                    if success(&value) {
                        #[cfg(feature="acceptance")]
                        self.ui.observed_late_auth_success();
                    }
                }
                Err(SshError::Cancelled)
            },
            result=tokio::time::timeout_at(deadline,&mut future)=>{self.check()?;result.map_err(|_|SshError::Timeout)?.map_err(|_|SshError::TransportFailed)},
        }
    }
    // User prompt time is excluded from the ten-second server-operation budget.
    pub async fn network<T, E>(
        &self,
        future: impl Future<Output = Result<T, E>>,
    ) -> Result<T, SshError> {
        self.check()?;
        let mut changes = self.paused.subscribe();
        let mut remaining = Duration::from_secs(10);
        tokio::pin!(future);
        loop {
            let paused = *changes.borrow_and_update();
            let start = Instant::now();
            tokio::select! {biased;
                _=self.cancel.cancelled()=>return Err(SshError::Cancelled),
                result=&mut future=>{self.check()?;return result.map_err(|_|self.failure.lock().unwrap().unwrap_or(SshError::TransportFailed));},
                _=changes.changed()=>{},
                _=async {if paused {std::future::pending::<()>().await}else{tokio::time::sleep(remaining).await}}=>return Err(SshError::Timeout),
            }
            if !paused {
                remaining = remaining.saturating_sub(start.elapsed());
            }
        }
    }
}
pub(crate) async fn authenticate(
    ssh: &mut Handle<crate::host_key::HostVerifier>,
    ctx: &Context,
    r: &ConnectRequest,
) -> Result<(), SshError> {
    let result = match r.auth_method {
        AuthMethod::Password => {
            let AuthAnswer::Password(password) = ctx
                .ask(
                    PromptKind::Password,
                    format!("{}@{}", r.username, r.target.host),
                    vec![PromptField {
                        text: "Password".into(),
                        echo: false,
                    }],
                )
                .await?
            else {
                return Err(SshError::InvalidInput);
            };
            Some(
                ctx.auth_network(
                    ssh.authenticate_password(&r.username, password.as_str()),
                    client::AuthResult::success,
                )
                .await?,
            )
        }
        AuthMethod::Key => {
            let AuthAnswer::Key {
                encoded,
                passphrase,
            } = ctx
                .ask(
                    PromptKind::Key,
                    format!("{}@{}", r.username, r.target.host),
                    vec![],
                )
                .await?
            else {
                return Err(SshError::InvalidInput);
            };
            let key =
                decode_secret_key(&encoded, Some(&passphrase)).map_err(|_| SshError::AuthFailed)?;
            Some(
                ctx.auth_network(
                    ssh.authenticate_publickey(
                        &r.username,
                        PrivateKeyWithHashAlg::new(Arc::new(key), None),
                    ),
                    client::AuthResult::success,
                )
                .await?,
            )
        }
        AuthMethod::Interactive => None,
    };
    if let Some(result) = result {
        if result.success() {
            return Ok(());
        }
        if !matches!(
            result,
            client::AuthResult::Failure {
                partial_success: true,
                ..
            }
        ) {
            return Err(SshError::AuthFailed);
        }
    }
    let mut reply = ctx
        .auth_network(
            ssh.authenticate_keyboard_interactive_start(&r.username, None),
            |r| matches!(r, Interactive::Success),
        )
        .await?;
    let mut rounds = 0;
    loop {
        match reply {
            Interactive::Success => return Ok(()),
            Interactive::Failure { .. } => return Err(SshError::AuthFailed),
            Interactive::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                if rounds >= 16 {
                    return Err(SshError::InvalidInput);
                }
                rounds += 1;
                let count = prompts.len();
                let fields = prompts
                    .into_iter()
                    .map(|p| PromptField {
                        text: p.prompt,
                        echo: p.echo,
                    })
                    .collect();
                let AuthAnswer::Interactive(values) = ctx
                    .ask(
                        PromptKind::Interactive,
                        format!("{name}\n{instructions}"),
                        fields,
                    )
                    .await?
                else {
                    return Err(SshError::InvalidInput);
                };
                if values.len() != count {
                    return Err(SshError::InvalidInput);
                }
                reply = ctx
                    .auth_network(
                        ssh.authenticate_keyboard_interactive_respond(
                            values.iter().map(|v| v.to_string()).collect(),
                        ),
                        |r| matches!(r, Interactive::Success),
                    )
                    .await?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct PendingUi;
    impl AuthUi for PendingUi {
        fn ask(&self, _: AuthPrompt) -> IoFuture<'_, Result<AuthAnswer, SshError>> {
            Box::pin(std::future::pending())
        }
    }
    fn context(ui: Arc<dyn AuthUi>) -> Context {
        Context::new(
            &ConnectRequest {
                session: SessionId::from_u128(1),
                attempt_id: AttemptId(1),
                target: Target {
                    host: "localhost".into(),
                    port: 22,
                },
                username: "fixture".into(),
                auth_method: AuthMethod::Password,
                initial_geometry: Geometry::new(120, 32).unwrap(),
            },
            ui,
            CancellationToken::new(),
        )
    }
    #[tokio::test(start_paused = true)]
    async fn network_budget_is_ten_seconds_and_prompt_budget_is_five_minutes() {
        let ctx = context(Arc::new(PendingUi));
        let before = Instant::now();
        assert_eq!(
            ctx.network(std::future::pending::<Result<(), ()>>()).await,
            Err(SshError::Timeout)
        );
        assert_eq!(before.elapsed(), Duration::from_secs(10));
        let before = Instant::now();
        assert!(matches!(
            ctx.ask(PromptKind::Password, String::new(), vec![]).await,
            Err(SshError::Timeout)
        ));
        assert_eq!(before.elapsed(), Duration::from_secs(300));
        assert!(!*ctx.paused.borrow());
    }
    #[tokio::test(start_paused = true)]
    async fn interactive_prompt_time_is_not_charged_to_handshake_network_budget() {
        let ctx = context(Arc::new(PendingUi));
        let result = ctx
            .network(async {
                ctx.paused.send_replace(true);
                tokio::time::sleep(Duration::from_secs(25)).await;
                ctx.paused.send_replace(false);
                tokio::time::sleep(Duration::from_secs(9)).await;
                Ok::<_, ()>(7)
            })
            .await;
        assert_eq!(result, Ok(7));
    }
    #[tokio::test(start_paused = true)]
    async fn cancelled_inflight_auth_has_only_one_five_second_cleanup_budget() {
        let ctx = context(Arc::new(PendingUi));
        let token = ctx.cancel.clone();
        tokio::spawn(async move {
            tokio::task::yield_now().await;
            token.cancel();
        });
        let before = Instant::now();
        assert_eq!(
            ctx.auth_network(std::future::pending::<Result<(), ()>>(), |_| true)
                .await,
            Err(SshError::Cancelled)
        );
        assert_eq!(before.elapsed(), Duration::from_secs(5));
        assert!(ctx.cleanup_deadline() <= Instant::now());
    }
}
