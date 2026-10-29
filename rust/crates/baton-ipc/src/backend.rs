use crate::*;
use std::{future::Future, pin::Pin};
pub type IpcFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConnectionContext {
    pub(crate) app: WireId,
    pub(crate) connection: WireId,
}
impl ConnectionContext {
    pub fn app_instance_id(self) -> WireId {
        self.app
    }
    pub fn connection_id(self) -> WireId {
        self.connection
    }
}
pub trait AgentBackend: Send + Sync + 'static {
    fn connected(&self, context: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>>;
    fn dispatch(
        &self,
        context: ConnectionContext,
        request: AgentRequest,
        cancel: CancellationToken,
    ) -> IpcFuture<'_, Result<AgentResponse, WireError>>;
    fn disconnected(&self, context: ConnectionContext) -> IpcFuture<'_, ()>;
    /// Runs with the response writer exclusively held. Implementations recheck
    /// authorization before committing a public response to this connection.
    fn commit_response(
        &self,
        _context: ConnectionContext,
        _request: &AgentRequest,
        _response: &mut Result<AgentResponse, WireError>,
    ) {
    }
}
pub(crate) fn fresh_id() -> Result<WireId, WireError> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).map_err(|_| WireError::new(ErrorCode::AuthenticationFailed))?;
    Ok(WireId::from_u128(u128::from_le_bytes(bytes)))
}
