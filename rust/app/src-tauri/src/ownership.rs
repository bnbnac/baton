use crate::{AppService, app::core_error, dto::*};
use baton_core::{ConnectionId, RequestId, SessionHandle, SessionId, StreamId};
impl AppService {
    pub fn list_agent_connections(&self) -> Vec<ConnectionInfo> {
        let state = self.state.lock().unwrap();
        if state.stopping {
            return vec![];
        }
        self.runtime
            .connection_ids()
            .into_iter()
            .map(|id| ConnectionInfo {
                id: Id(id.as_u128()),
                display_name: format!("MCP {:032x}", id.as_u128()),
            })
            .collect()
    }
    pub(crate) fn publish_connections(&self) {
        let active = {
            let state = self.state.lock().unwrap();
            state.frontend_started && !state.stopping
        };
        if active {
            let _ = self.send(UiEvent::Connections {
                connections: self.list_agent_connections(),
            });
        }
    }
    fn ownership_handle(&self, id: Id) -> Result<SessionHandle, AppError> {
        let state = self.state.lock().unwrap();
        if state.stopping {
            return Err(AppError::new("app_closed"));
        }
        if !state.entries.contains_key(&id) {
            return Err(AppError::new("unknown_session"));
        }
        self.runtime
            .session_handle(SessionId::from_u128(id.0))
            .map_err(core_error)
    }
    fn ownership_result(&self, id: Id) -> Result<SessionInfo, AppError> {
        self.publish();
        self.list()
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| AppError::new("unknown_session"))
    }
    pub async fn handoff_session(&self, request: HandoffRequest) -> Result<SessionInfo, AppError> {
        self.ownership_handle(request.id)?
            .handoff_expected(
                ConnectionId::from_u128(request.connection_id.0),
                StreamId::from_u128(crate::ids::fresh()?.0),
                request.expected_epoch,
            )
            .await
            .map_err(core_error)?;
        self.ownership_result(request.id)
    }
    pub async fn reclaim_session(
        &self,
        request: OwnershipRequest,
    ) -> Result<SessionInfo, AppError> {
        self.ownership_handle(request.id)?
            .reclaim_expected(request.expected_epoch)
            .await
            .map_err(core_error)?;
        self.ownership_result(request.id)
    }
    pub async fn decline_intervention(
        &self,
        request: DeclineRequest,
    ) -> Result<SessionInfo, AppError> {
        self.ownership_handle(request.id)?
            .decline_intervention(
                request.expected_epoch,
                RequestId::from_u128(request.request_id.0),
            )
            .await
            .map_err(core_error)?;
        self.ownership_result(request.id)
    }
}
