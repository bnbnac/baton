use crate::*;
use russh::{
    client,
    keys::{HashAlg, PublicKeyOrCertificate},
};
pub(crate) struct HostVerifier {
    pub context: Arc<auth::Context>,
    pub target: Target,
    pub shutdown: CancellationToken,
}
impl client::Handler for HostVerifier {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let display = format!(
            "{}:{}\n{}\n{}",
            self.target.host,
            self.target.port,
            key.public_key().algorithm(),
            key.public_key().fingerprint(HashAlg::Sha256)
        );
        let result = tokio::select! {biased; _=self.shutdown.cancelled()=>Err(SshError::Cancelled),result=self.context.ask(PromptKind::HostKey, display, vec![])=>result};
        match result {
            Ok(AuthAnswer::Host(true)) => Ok(true),
            other => {
                *self.context.failure.lock().unwrap() = Some(match other {
                    Err(e) => e,
                    _ => SshError::HostRejected,
                });
                Ok(false)
            }
        }
    }
}
