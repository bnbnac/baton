use crate::{AppService, dto::Id};
use baton_core as core;
use baton_ipc::*;
use std::sync::Arc;

pub struct AgentBridge {
    app: Arc<AppService>,
}
#[cfg(windows)]
impl AppService {
    pub async fn start_agent_server(
        self: &Arc<Self>,
        dir: &std::path::Path,
    ) -> Result<LocalServer, WireError> {
        if self.state.lock().unwrap().stopping {
            return Err(WireError::new(ErrorCode::AppOffline));
        }
        LocalServer::start(
            dir,
            WireId::from_u128(self.runtime.app_id().as_u128()),
            Arc::new(AgentBridge::new(self.clone())),
        )
        .await
    }
}
impl AgentBridge {
    pub fn new(app: Arc<AppService>) -> Self {
        Self { app }
    }
    fn check(&self, context: ConnectionContext) -> Result<core::ConnectionId, WireError> {
        if self.app.state.lock().unwrap().stopping {
            return Err(WireError::new(ErrorCode::AppOffline));
        }
        if context.app_instance_id().as_u128() != self.app.runtime.app_id().as_u128() {
            return Err(WireError::new(ErrorCode::AuthenticationFailed));
        }
        Ok(core::ConnectionId::from_u128(
            context.connection_id().as_u128(),
        ))
    }
    fn status(&self, context: ConnectionContext) -> Result<AgentResponse, WireError> {
        let connection = self.check(context)?;
        let state_guard = self.app.state.lock().unwrap();
        if state_guard.stopping {
            return Err(WireError::new(ErrorCode::AppOffline));
        }
        self.app
            .runtime
            .commit_agent_status(connection, |visible| {
                let mut sessions = Vec::with_capacity(visible.len());
                for (id, snapshot, geometry) in visible {
                    let metadata = state_guard
                        .entries
                        .get(&Id(id.as_u128()))
                        .map(|entry| entry.info.clone());
                    let Some(info) = metadata else { continue };
                    sessions.push(AgentSession {
                        session_id: WireId::from_u128(id.as_u128()),
                        label: info.label,
                        target: Target {
                            host: info.host,
                            port: info.port,
                            username: info.username,
                        },
                        state: state(snapshot.state),
                        control_epoch: snapshot.epoch,
                        stream_id: snapshot.stream.map(|id| WireId::from_u128(id.as_u128())),
                        geometry: Geometry {
                            columns: geometry.columns,
                            rows: geometry.rows,
                        },
                        intervention: intervention(snapshot.intervention),
                    });
                }
                AgentResponse::Status(StatusResult {
                    contract_version: 2,
                    app_state: AppState::Online,
                    app_instance_id: Some(context.app_instance_id()),
                    connection_id: Some(context.connection_id()),
                    sessions,
                })
            })
            .map_err(WireError::from)
    }
    async fn input(
        &self,
        handle: core::SessionHandle,
        call: core::InputCall,
        cancel: CancellationToken,
    ) -> Result<AgentResponse, WireError> {
        let principal = call.principal;
        let epoch = call.epoch;
        let id = call.request_id;
        let operation = async {
            let result = handle.submit(call).await?;
            if result == core::InputResult::Pending {
                handle.wait_input_result(principal, epoch, id).await
            } else {
                Ok(result)
            }
        };
        let result = tokio::select! {biased;
            _=cancel.cancelled()=>{
                // Dropping submit also cancels a request still entering the queue.
                let _=handle.cancel_input(principal,epoch,id).await;
                return Err(WireError::new(ErrorCode::Cancelled));
            },
            result=operation=>result?,
        };
        Ok(AgentResponse::Input {
            result: match result {
                core::InputResult::Delivered => InputOutcome::Delivered,
                core::InputResult::InputInvalidated => InputOutcome::InputInvalidated,
                core::InputResult::Uncertain => InputOutcome::Uncertain,
                core::InputResult::Pending => return Err(WireError::new(ErrorCode::Uncertain)),
            },
        })
    }
}
impl AgentBackend for AgentBridge {
    fn commit_response(
        &self,
        context: ConnectionContext,
        request: &AgentRequest,
        response: &mut Result<AgentResponse, WireError>,
    ) {
        if response.is_err() {
            return;
        }
        if matches!(request, AgentRequest::Status {}) {
            *response = self.status(context);
            return;
        }
        let connection = match self.check(context) {
            Ok(c) => c,
            Err(e) => {
                *response = Err(e);
                return;
            }
        };
        let (session, epoch, stream) = match request {
            AgentRequest::ReadOutput {
                session_id,
                control_epoch,
                stream_id,
                ..
            } => (
                *session_id,
                *control_epoch,
                Some(core::StreamId::from_u128(stream_id.as_u128())),
            ),
            AgentRequest::SendText {
                session_id,
                control_epoch,
                ..
            }
            | AgentRequest::SendKey {
                session_id,
                control_epoch,
                ..
            }
            | AgentRequest::RequestUserControl {
                session_id,
                control_epoch,
                ..
            } => (*session_id, *control_epoch, None),
            AgentRequest::Status {} => unreachable!(),
        };
        let prepared = std::mem::replace(response, Err(WireError::new(ErrorCode::Disconnected)));
        *response = self
            .app
            .runtime
            .commit_agent_response(
                connection,
                core::SessionId::from_u128(session.as_u128()),
                epoch,
                stream,
                || prepared,
            )
            .unwrap_or_else(|e| Err(e.into()));
    }
    fn connected(&self, context: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>> {
        Box::pin(async move {
            // Same lock order as app shutdown: app state, then the runtime registry.
            let state = self.app.state.lock().unwrap();
            if state.stopping {
                return Err(WireError::new(ErrorCode::AppOffline));
            }
            if context.app_instance_id().as_u128() != self.app.runtime.app_id().as_u128() {
                return Err(WireError::new(ErrorCode::AuthenticationFailed));
            }
            self.app
                .runtime
                .register_connection(core::ConnectionId::from_u128(
                    context.connection_id().as_u128(),
                ))?;
            drop(state);
            self.app.publish_connections();
            Ok(())
        })
    }
    fn disconnected(&self, context: ConnectionContext) -> IpcFuture<'_, ()> {
        Box::pin(async move {
            self.app
                .runtime
                .disconnect(core::ConnectionId::from_u128(
                    context.connection_id().as_u128(),
                ))
                .await;
            self.app.publish_connections();
        })
    }
    fn dispatch(
        &self,
        context: ConnectionContext,
        request: AgentRequest,
        cancel: CancellationToken,
    ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
        Box::pin(async move {
            request.validate()?;
            let connection = self.check(context)?;
            if cancel.is_cancelled() {
                return Err(WireError::new(ErrorCode::Cancelled));
            }
            let principal = core::Principal::Agent(connection);
            match request {
                AgentRequest::Status {} => self.status(context),
                AgentRequest::ReadOutput {
                    session_id,
                    control_epoch,
                    stream_id,
                    cursor,
                    limit,
                    wait_ms,
                } => {
                    let handle = self
                        .app
                        .runtime
                        .session_handle(core::SessionId::from_u128(session_id.as_u128()))?;
                    let read = core::ReadCall {
                        connection,
                        epoch: control_epoch,
                        stream: core::StreamId::from_u128(stream_id.as_u128()),
                        cursor,
                        limit: limit as usize,
                    };
                    let page = tokio::select! {biased;_=cancel.cancelled()=>return Err(WireError::new(ErrorCode::Cancelled)),result=handle.read(read,wait_ms)=>result?};
                    Ok(AgentResponse::Output(OutputPage {
                        text: page.text,
                        next_cursor: page.next,
                        oldest_cursor: page.oldest,
                        end_cursor: page.end,
                        has_more: page.has_more,
                    }))
                }
                AgentRequest::SendText {
                    session_id,
                    control_epoch,
                    request_id,
                    text,
                } => {
                    let handle = self
                        .app
                        .runtime
                        .session_handle(core::SessionId::from_u128(session_id.as_u128()))?;
                    self.input(
                        handle,
                        core::InputCall {
                            principal,
                            epoch: control_epoch,
                            request_id: core::RequestId::from_u128(request_id.as_u128()),
                            payload: text.into_bytes(),
                        },
                        cancel,
                    )
                    .await
                }
                AgentRequest::SendKey {
                    session_id,
                    control_epoch,
                    request_id,
                    key,
                } => {
                    let handle = self
                        .app
                        .runtime
                        .session_handle(core::SessionId::from_u128(session_id.as_u128()))?;
                    self.input(
                        handle,
                        core::InputCall {
                            principal,
                            epoch: control_epoch,
                            request_id: core::RequestId::from_u128(request_id.as_u128()),
                            payload: key.bytes().to_vec(),
                        },
                        cancel,
                    )
                    .await
                }
                AgentRequest::RequestUserControl {
                    session_id,
                    control_epoch,
                    request_id,
                    reason,
                } => {
                    let handle = self
                        .app
                        .runtime
                        .session_handle(core::SessionId::from_u128(session_id.as_u128()))?;
                    let result = handle
                        .request_user_control(
                            connection,
                            control_epoch,
                            core::RequestId::from_u128(request_id.as_u128()),
                            reason,
                        )
                        .await?;
                    Ok(AgentResponse::Intervention {
                        result: match result {
                            core::InterventionResult::Queued => InterventionOutcome::Queued,
                            core::InterventionResult::Duplicate => InterventionOutcome::Duplicate,
                        },
                    })
                }
            }
        })
    }
}
fn state(value: core::State) -> SessionState {
    match value {
        core::State::Connecting => SessionState::Connecting,
        core::State::UserOwned => SessionState::UserOwned,
        core::State::Transferring => SessionState::Transferring,
        core::State::AgentOwned => SessionState::AgentOwned,
        core::State::Reclaiming => SessionState::Reclaiming,
        core::State::Closed => SessionState::Closed,
    }
}
pub(crate) fn intervention(value: Option<core::Intervention>) -> Option<Intervention> {
    value.map(|v| Intervention {
        request_id: WireId::from_u128(v.request_id.as_u128()),
        reason: v.reason,
        state: match v.state {
            core::InterventionState::Requested => InterventionState::Requested,
            core::InterventionState::Declined => InterventionState::Declined,
        },
    })
}
