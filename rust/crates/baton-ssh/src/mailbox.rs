use crate::*;
use std::sync::Mutex;
use tokio::sync::{mpsc, oneshot};
type Key = (SessionId, AttemptId, ChallengeId);
type Pending = Option<(Key, oneshot::Sender<AuthAnswer>)>;
pub struct AuthMailbox {
    prompts: mpsc::Sender<AuthPrompt>,
    pending: Mutex<Pending>,
}
impl AuthMailbox {
    pub fn new() -> (Arc<Self>, mpsc::Receiver<AuthPrompt>) {
        let (tx, rx) = mpsc::channel(1);
        (
            Arc::new(Self {
                prompts: tx,
                pending: Mutex::new(None),
            }),
            rx,
        )
    }
    pub fn answer(
        &self,
        session: SessionId,
        attempt: AttemptId,
        challenge: ChallengeId,
        answer: AuthAnswer,
    ) -> Result<(), SshError> {
        let mut pending = self.pending.lock().unwrap();
        if pending.as_ref().map(|(key, _)| *key) != Some((session, attempt, challenge)) {
            return Err(SshError::StaleChallenge);
        }
        pending
            .take()
            .unwrap()
            .1
            .send(answer)
            .map_err(|_| SshError::StaleChallenge)
    }
}
struct Clear<'a> {
    mailbox: &'a AuthMailbox,
    key: Key,
}
impl Drop for Clear<'_> {
    fn drop(&mut self) {
        let mut pending = self.mailbox.pending.lock().unwrap();
        if pending.as_ref().map(|(key, _)| *key) == Some(self.key) {
            pending.take();
        }
    }
}
impl AuthUi for AuthMailbox {
    fn ask(&self, prompt: AuthPrompt) -> IoFuture<'_, Result<AuthAnswer, SshError>> {
        Box::pin(async move {
            let key = (prompt.session, prompt.attempt_id, prompt.challenge_id);
            let (tx, rx) = oneshot::channel();
            {
                let mut pending = self.pending.lock().unwrap();
                if pending.is_some() {
                    return Err(SshError::Capacity);
                }
                *pending = Some((key, tx));
            }
            let _clear = Clear { mailbox: self, key };
            self.prompts
                .try_send(prompt)
                .map_err(|_| SshError::Capacity)?;
            rx.await.map_err(|_| SshError::Cancelled)
        })
    }
}
