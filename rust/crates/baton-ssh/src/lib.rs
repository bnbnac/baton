use baton_core::{Geometry, IoFuture, SessionId};
use std::sync::Arc;
mod auth;
mod host_key;
mod mailbox;
mod reader;
mod transport;
pub use mailbox::AuthMailbox;
pub use tokio_util::sync::CancellationToken;
pub use transport::ConnectedSsh;
pub use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AttemptId(pub u128);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChallengeId(pub u128);
#[derive(Clone, Debug)]
pub struct Target {
    pub host: String,
    pub port: u16,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthMethod {
    Password,
    Key,
    Interactive,
}
pub struct ConnectRequest {
    pub session: SessionId,
    pub attempt_id: AttemptId,
    pub target: Target,
    pub username: String,
    pub auth_method: AuthMethod,
    pub initial_geometry: Geometry,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PromptKind {
    HostKey,
    Password,
    Key,
    Interactive,
}
#[derive(Clone, Debug)]
pub struct PromptField {
    pub text: String,
    pub echo: bool,
}
#[derive(Clone, Debug)]
pub struct AuthPrompt {
    pub session: SessionId,
    pub attempt_id: AttemptId,
    pub challenge_id: ChallengeId,
    pub kind: PromptKind,
    pub display: String,
    pub prompts: Vec<PromptField>,
}
pub enum AuthAnswer {
    Host(bool),
    Password(Zeroizing<String>),
    Key {
        encoded: Zeroizing<String>,
        passphrase: Zeroizing<String>,
    },
    Interactive(Vec<Zeroizing<String>>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SshError {
    InvalidInput,
    Cancelled,
    HostRejected,
    AuthFailed,
    TransportFailed,
    Timeout,
    StaleChallenge,
    Capacity,
    CoreRejected,
}
pub trait AuthUi: Send + Sync {
    fn ask(&self, prompt: AuthPrompt) -> IoFuture<'_, Result<AuthAnswer, SshError>>;
    #[cfg(feature = "acceptance")]
    fn observed_late_auth_success(&self) {}
    #[cfg(feature = "acceptance")]
    fn owned_stream_dropped(&self) {}
    #[cfg(feature = "acceptance")]
    fn before_pty(&self) {}
}
pub async fn connect(
    request: ConnectRequest,
    ui: Arc<dyn AuthUi>,
    cancel: CancellationToken,
) -> Result<ConnectedSsh, SshError> {
    transport::connect(request, ui, cancel).await
}
