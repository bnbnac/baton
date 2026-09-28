use crate::{app::*, dto::*};
use baton_ssh::{
    AttemptId, AuthAnswer, AuthPrompt, CancellationToken, ChallengeId, PromptKind, Zeroizing,
};
use std::sync::Arc;
use tokio::{sync::mpsc, task::JoinHandle};
impl AppService {
    pub(crate) fn forward_auth(
        self: &Arc<Self>,
        id: Id,
        mut prompts: mpsc::Receiver<AuthPrompt>,
        cancel: CancellationToken,
    ) -> JoinHandle<()> {
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                let prompt = tokio::select! {biased;_=cancel.cancelled()=>break,p=prompts.recv()=>match p {Some(p)=>p,None=>break}};
                if let Some(app) = weak.upgrade() {
                    let dto = AuthPromptDto {
                        session: id,
                        attempt: Id(prompt.attempt_id.0),
                        challenge: Id(prompt.challenge_id.0),
                        kind: match prompt.kind {
                            PromptKind::HostKey => "host",
                            PromptKind::Password => "password",
                            PromptKind::Key => "key",
                            PromptKind::Interactive => "interactive",
                        }
                        .into(),
                        display: prompt.display,
                        prompts: prompt
                            .prompts
                            .into_iter()
                            .map(|p| PromptFieldDto {
                                text: p.text,
                                echo: p.echo,
                            })
                            .collect(),
                    };
                    if app.send(UiEvent::Auth { prompt: dto }).is_err() {
                        break;
                    }
                } else {
                    break;
                }
            }
        })
    }
    pub fn answer(&self, mut response: AuthResponse) -> Result<(), AppError> {
        let state = self.state.lock().unwrap();
        if state.stopping {
            return Err(AppError::new("app_closed"));
        }
        let entry = state
            .entries
            .get(&response.session)
            .ok_or_else(|| AppError::new("unknown_session"))?;
        if entry.attempt != response.attempt || entry.cancel.is_cancelled() {
            return Err(AppError::new("stale_challenge"));
        }
        let answer = match &mut response.answer {
            Answer::Host { accept } => AuthAnswer::Host(*accept),
            Answer::Password { password } => {
                if password.len() > 16384 {
                    return Err(AppError::new("invalid_input"));
                }
                AuthAnswer::Password(Zeroizing::new(std::mem::take(password)))
            }
            Answer::Key {
                encoded,
                passphrase,
            } => {
                if encoded.len() > 1048576 || passphrase.len() > 16384 {
                    return Err(AppError::new("invalid_input"));
                }
                AuthAnswer::Key {
                    encoded: Zeroizing::new(std::mem::take(encoded)),
                    passphrase: Zeroizing::new(std::mem::take(passphrase)),
                }
            }
            Answer::Interactive { responses } => {
                if responses.len() > 16 || responses.iter().map(String::len).sum::<usize>() > 16384
                {
                    return Err(AppError::new("invalid_input"));
                }
                AuthAnswer::Interactive(
                    std::mem::take(responses)
                        .into_iter()
                        .map(Zeroizing::new)
                        .collect(),
                )
            }
        };
        entry
            .mailbox
            .answer(
                baton_core::SessionId::from_u128(response.session.0),
                AttemptId(response.attempt.0),
                ChallengeId(response.challenge.0),
                answer,
            )
            .map_err(|_| AppError::new("stale_challenge"))
    }
}
