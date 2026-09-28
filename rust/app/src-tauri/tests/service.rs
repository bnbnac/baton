use baton_app::{dto::*, *};
use baton_core::*;
use baton_ssh::*;
use std::sync::{Arc, Mutex};
struct Pending;
struct PromptConnector(Arc<std::sync::atomic::AtomicUsize>);
impl Connector for PromptConnector {
    fn connect(
        &self,
        r: ConnectRequest,
        ui: Arc<dyn AuthUi>,
        cancel: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, SshError>> {
        let calls = self.0.clone();
        Box::pin(async move {
            let prompt = AuthPrompt {
                session: r.session,
                attempt_id: r.attempt_id,
                challenge_id: ChallengeId(1),
                kind: PromptKind::Password,
                display: "Password".into(),
                prompts: vec![PromptField {
                    text: "Password".into(),
                    echo: false,
                }],
            };
            let result =
                tokio::select! {_=cancel.cancelled()=>Err(SshError::Cancelled),r=ui.ask(prompt)=>r};
            if matches!(result, Ok(AuthAnswer::Password(_))) {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            Err(SshError::AuthFailed)
        })
    }
}
#[tokio::test]
async fn oversized_or_foreign_auth_answers_have_no_effect_and_secrets_never_enter_metadata() {
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sink = Arc::new(Sink::default());
    let app = AppService::with_connector(Arc::new(PromptConnector(count.clone())), sink.clone());
    app.connect(request()).unwrap();
    let mut prompt = None;
    for _ in 0..30 {
        prompt = sink.0.lock().unwrap().iter().find_map(|e| match e {
            UiEvent::Auth { prompt } => Some(prompt.clone()),
            _ => None,
        });
        if prompt.is_some() {
            break;
        }
        tokio::task::yield_now().await;
    }
    let p = prompt.unwrap();
    let answer = |attempt, answer| AuthResponse {
        session: p.session,
        attempt,
        challenge: p.challenge,
        answer,
    };
    assert_eq!(
        app.answer(answer(
            Id(0),
            Answer::Password {
                password: "secret-marker".into()
            }
        ))
        .unwrap_err()
        .code,
        "stale_challenge"
    );
    assert_eq!(
        app.answer(answer(
            p.attempt,
            Answer::Key {
                encoded: "x".repeat(1048577),
                passphrase: String::new()
            }
        ))
        .unwrap_err()
        .code,
        "invalid_input"
    );
    assert_eq!(
        app.answer(answer(
            p.attempt,
            Answer::Interactive {
                responses: vec![String::new(); 17]
            }
        ))
        .unwrap_err()
        .code,
        "invalid_input"
    );
    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 0);
    app.answer(answer(
        p.attempt,
        Answer::Password {
            password: "secret-marker".into(),
        },
    ))
    .unwrap();
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(
        !serde_json::to_string(&app.list())
            .unwrap()
            .contains("secret-marker")
    );
    assert!(
        !serde_json::to_string(&*sink.0.lock().unwrap())
            .unwrap()
            .contains("secret-marker")
    );
    app.shutdown().await;
}
#[test]
fn product_commands_have_no_agent_execution_or_file_access_entry() {
    let source = include_str!("../src/main.rs");
    let commands = source
        .split("generate_handler![")
        .nth(1)
        .unwrap()
        .split(']')
        .next()
        .unwrap();
    let names: Vec<_> = commands
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    assert_eq!(
        names,
        vec![
            "connect_session",
            "answer_auth",
            "cancel_connect",
            "list_sessions",
            "close_session",
            "remove_closed_session",
            "bind_terminal",
            "user_input",
            "ack_output",
            "terminal_reply",
            "resize_terminal",
            "frontend_pong"
        ]
    );
}
impl Connector for Pending {
    fn connect(
        &self,
        _: ConnectRequest,
        _: Arc<dyn AuthUi>,
        cancel: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, SshError>> {
        Box::pin(async move {
            cancel.cancelled().await;
            Err(SshError::Cancelled)
        })
    }
}
#[derive(Default)]
struct Sink(Mutex<Vec<UiEvent>>);
impl EventSink for Sink {
    fn emit(&self, event: UiEvent) -> Result<(), AppError> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}
fn request() -> ConnectionRequest {
    ConnectionRequest {
        host: "127.0.0.1".into(),
        port: 22,
        username: "user".into(),
        label: "App server".into(),
        method: Method::Password,
    }
}
struct Ready(SessionId);
struct Wire;
impl Transport for Wire {
    fn write<'a>(&'a mut self, _: &'a [u8]) -> IoFuture<'a, WriteResult> {
        Box::pin(async { WriteResult::Delivered })
    }
    fn close(&mut self) -> IoFuture<'_, ()> {
        Box::pin(async {})
    }
}
impl ReadyConnection for Ready {
    fn activate(self: Box<Self>, r: &Runtime) -> Result<SessionHandle, SshError> {
        r.activate_session(self.0, Box::new(Wire))
            .map_err(|_| SshError::CoreRejected)
    }
}
struct Immediate;
impl Connector for Immediate {
    fn connect(
        &self,
        r: ConnectRequest,
        _: Arc<dyn AuthUi>,
        _: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, SshError>> {
        Box::pin(async move { Ok(Box::new(Ready(r.session)) as Box<dyn ReadyConnection>) })
    }
}
async fn connected(app: &AppService, id: Id) {
    for _ in 0..50 {
        if app
            .list()
            .iter()
            .any(|s| s.id == id && s.state == "user_owned")
        {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("not connected");
}
#[tokio::test]
async fn foreign_view_and_duplicate_input_cannot_cross_user_session() {
    let app = AppService::with_connector(Arc::new(Immediate), Arc::new(Sink::default()));
    let a = app.connect(request()).unwrap().id;
    let b = app.connect(request()).unwrap().id;
    connected(&app, a).await;
    connected(&app, b).await;
    let av = app.bind(a).await.unwrap();
    let bv = app.bind(b).await.unwrap();
    let input = |binding, seq| UserInput {
        binding,
        epoch: SafeInt::new(0).unwrap(),
        input_seq: SafeInt::new(seq).unwrap(),
        text: "hello".into(),
    };
    assert_eq!(
        app.user_input(input(
            Binding {
                session: b,
                view: av.view
            },
            1
        ))
        .await
        .unwrap_err()
        .code,
        "stale_view"
    );
    assert!(app.user_input(input(av, 1)).await.is_ok());
    assert_eq!(
        app.user_input(input(av, 1)).await.unwrap_err().code,
        "stale_input"
    );
    assert!(app.user_input(input(bv, 1)).await.is_ok());
    app.close(a).unwrap();
    assert!(app.user_input(input(av, 2)).await.is_err());
    app.shutdown().await;
}
#[tokio::test]
async fn a_rebound_view_closes_every_session_instead_of_replaying_output() {
    let app = AppService::with_connector(Arc::new(Immediate), Arc::new(Sink::default()));
    let a = app.connect(request()).unwrap().id;
    let b = app.connect(request()).unwrap().id;
    connected(&app, a).await;
    connected(&app, b).await;
    app.bind(a).await.unwrap();
    assert_eq!(app.bind(a).await.unwrap_err().code, "stale_view");
    assert!(app.list().iter().all(|s| s.state == "closed"));
    app.shutdown().await;
}
struct Late(Mutex<Option<tokio::sync::oneshot::Receiver<()>>>);
impl Connector for Late {
    fn connect(
        &self,
        r: ConnectRequest,
        _: Arc<dyn AuthUi>,
        _: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, SshError>> {
        let rx = self.0.lock().unwrap().take().unwrap();
        Box::pin(async move {
            rx.await.unwrap();
            Ok(Box::new(Ready(r.session)) as Box<dyn ReadyConnection>)
        })
    }
}
#[tokio::test]
async fn late_success_after_cancel_cannot_reopen_the_reserved_session() {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app = AppService::with_connector(
        Arc::new(Late(Mutex::new(Some(rx)))),
        Arc::new(Sink::default()),
    );
    let id = app.connect(request()).unwrap().id;
    app.close(id).unwrap();
    tx.send(()).unwrap();
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert_eq!(app.list()[0].state, "closed");
    assert!(app.bind(id).await.is_err());
    app.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn stale_heartbeat_cannot_keep_a_lost_frontend_alive() {
    let sink = Arc::new(Sink::default());
    let app = AppService::with_connector(Arc::new(Pending), sink.clone());
    let id = app.connect(request()).unwrap().id;
    app.heartbeat().unwrap();
    let challenge = match sink.0.lock().unwrap().last().unwrap() {
        UiEvent::Heartbeat { challenge } => *challenge,
        _ => panic!(),
    };
    assert!(app.pong(Id(0)).is_err());
    app.pong(challenge).unwrap();
    assert!(app.pong(challenge).is_err());
    tokio::time::advance(std::time::Duration::from_secs(30)).await;
    assert!(app.heartbeat().is_err());
    assert_eq!(
        app.list().iter().find(|s| s.id == id).unwrap().state,
        "closed"
    );
    app.shutdown().await;
}
#[tokio::test]
async fn invalid_metadata_rejected_and_sixteen_connecting_or_closed_sessions_use_capacity() {
    let service = AppService::with_connector(Arc::new(Pending), Arc::new(Sink::default()));
    for (field, text) in [
        ("host", "".into()),
        ("host", "x".repeat(254)),
        ("username", "x".repeat(257)),
        ("label", "한".repeat(86)),
    ] {
        let mut r = request();
        match field {
            "host" => r.host = text,
            "username" => r.username = text,
            _ => r.label = text,
        };
        assert_eq!(service.connect(r).unwrap_err().code, "invalid_input");
    }
    let mut ids = vec![];
    for _ in 0..16 {
        ids.push(service.connect(request()).unwrap().id);
    }
    assert_eq!(service.connect(request()).unwrap_err().code, "capacity");
    service.close(ids[0]).unwrap();
    assert_eq!(service.connect(request()).unwrap_err().code, "capacity");
    assert_eq!(service.list().len(), 16);
    service.shutdown().await;
    assert!(service.list().iter().all(|s| s.state == "closed"));
    assert_eq!(service.connect(request()).unwrap_err().code, "app_closed");
}
#[test]
fn identifiers_serialize_as_strings_and_unknown_command_fields_are_rejected() {
    assert_eq!(
        serde_json::to_string(&Id(u128::MAX)).unwrap(),
        "\"ffffffffffffffffffffffffffffffff\""
    );
    assert!(serde_json::from_str::<ConnectionRequest>(r#"{"host":"localhost","port":22,"username":"u","label":"l","method":"password","principal":"agent"}"#).is_err());
}
