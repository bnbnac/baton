use crate::dto::*;
use baton_core::*;
use baton_ssh::{
    AttemptId, AuthMailbox, AuthMethod, AuthUi, CancellationToken, ConnectRequest, ConnectedSsh,
    SshError, Target,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tokio::{task::JoinHandle, time::Instant};
pub trait ReadyConnection: Send {
    fn activate(self: Box<Self>, runtime: &Runtime) -> Result<SessionHandle, SshError>;
}
impl ReadyConnection for ConnectedSsh {
    fn activate(self: Box<Self>, runtime: &Runtime) -> Result<SessionHandle, SshError> {
        (*self).activate(runtime)
    }
}
pub trait Connector: Send + Sync {
    fn connect(
        &self,
        request: ConnectRequest,
        ui: Arc<dyn AuthUi>,
        cancel: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, SshError>>;
}
pub trait EventSink: Send + Sync {
    fn emit(&self, event: UiEvent) -> Result<(), AppError>;
}
pub struct RealConnector;
impl Connector for RealConnector {
    fn connect(
        &self,
        r: ConnectRequest,
        ui: Arc<dyn AuthUi>,
        cancel: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, SshError>> {
        Box::pin(async move {
            baton_ssh::connect(r, ui, cancel)
                .await
                .map(|c| Box::new(c) as Box<dyn ReadyConnection>)
        })
    }
}
pub(crate) struct Entry {
    pub info: SessionInfo,
    pub cancel: CancellationToken,
    pub mailbox: Arc<AuthMailbox>,
    pub attempt: Id,
    pub binding: Option<Binding>,
    pub last_input: SafeInt,
    pub tasks: Vec<JoinHandle<()>>,
    pub output_ready: Arc<tokio::sync::Notify>,
    pub output_started: bool,
}
pub(crate) struct AppState {
    pub entries: BTreeMap<Id, Entry>,
    pub stopping: bool,
    pub frontend_started: bool,
    pub heartbeat: Option<Id>,
    pub last_pong: Instant,
}
pub struct AppService {
    pub(crate) runtime: Arc<Runtime>,
    pub(crate) state: Mutex<AppState>,
    pub(crate) sink: Arc<dyn EventSink>,
    connector: Arc<dyn Connector>,
}
pub(crate) fn core_error(e: CoreError) -> AppError {
    AppError::new(&format!("{e:?}"))
}
pub(crate) fn state_name(state: State) -> String {
    match state {
        State::Connecting => "connecting",
        State::UserOwned => "user_owned",
        State::Transferring => "transferring",
        State::AgentOwned => "agent_owned",
        State::Reclaiming => "reclaiming",
        State::Closed => "closed",
    }
    .into()
}
impl AppService {
    pub async fn ack(&self, r: AckRequest) -> Result<(), AppError> {
        self.handle(r.binding)?
            .ack_ui_frame(r.binding.core(), r.seq)
            .await
            .map_err(core_error)?;
        if let Some(entry) = self.state.lock().unwrap().entries.get(&r.binding.session) {
            entry.output_ready.notify_one();
        }
        Ok(())
    }
    pub async fn resize(&self, r: ResizeRequest) -> Result<(), AppError> {
        self.handle(r.binding)?
            .resize(GeometryRequest {
                binding: r.binding.core(),
                resize_seq: r.resize_seq,
                geometry: Geometry::new(r.columns, r.rows).map_err(core_error)?,
            })
            .await
            .map_err(core_error)
    }
    pub async fn reply(&self, r: ReplyRequest) -> Result<(), AppError> {
        self.handle(r.binding)?
            .protocol_reply(ReplyCall {
                binding: r.binding.core(),
                epoch: r.epoch,
                query: QueryId(r.query),
                kind: match r.kind {
                    ReplyKind::Dsr => QueryKind::Dsr,
                    ReplyKind::Cpr => QueryKind::Cpr,
                    ReplyKind::Da => QueryKind::Da,
                },
                row: r.row,
                column: r.column,
            })
            .await
            .map_err(core_error)
    }
    pub async fn user_input(&self, input: UserInput) -> Result<(), AppError> {
        let handle = self.handle(input.binding)?;
        if input.data.len() > limits::INPUT_BYTES {
            return Err(AppError::new("input_too_large"));
        }
        {
            let mut state = self.state.lock().unwrap();
            let entry = state
                .entries
                .get_mut(&input.binding.session)
                .ok_or_else(|| AppError::new("unknown_session"))?;
            if input.input_seq <= entry.last_input {
                return Err(AppError::new("stale_input"));
            }
            entry.last_input = input.input_seq;
        }
        handle
            .submit_user_action(
                input.binding.core(),
                input.epoch,
                input.input_seq,
                input.data,
            )
            .await
            .map_err(core_error)
    }
    pub fn with_connector(connector: Arc<dyn Connector>, sink: Arc<dyn EventSink>) -> Arc<Self> {
        Self::with_registry(
            connector,
            sink,
            Registry::new(AppId::from_u128(
                crate::ids::fresh().expect("OS entropy required").0,
            )),
        )
    }
    pub(crate) fn with_registry(
        connector: Arc<dyn Connector>,
        sink: Arc<dyn EventSink>,
        registry: Registry,
    ) -> Arc<Self> {
        Arc::new(Self {
            runtime: Arc::new(Runtime::spawn(registry)),
            state: Mutex::new(AppState {
                entries: BTreeMap::new(),
                stopping: false,
                frontend_started: false,
                heartbeat: None,
                last_pong: Instant::now(),
            }),
            sink,
            connector,
        })
    }
    pub fn connect(self: &Arc<Self>, r: ConnectionRequest) -> Result<SessionInfo, AppError> {
        if r.host.is_empty()
            || r.host.len() > 253
            || r.host.chars().any(|c| c.is_whitespace() || c.is_control())
            || r.port == 0
            || r.username.is_empty()
            || r.username.len() > 256
            || r.username.chars().any(char::is_control)
            || r.label.len() > 256
        {
            return Err(AppError::new("invalid_input"));
        }
        let id = crate::ids::fresh()?;
        let attempt = crate::ids::fresh()?;
        let session = SessionId::from_u128(id.0);
        let cancel = CancellationToken::new();
        let (mailbox, prompts) = AuthMailbox::new();
        let info = SessionInfo {
            id,
            label: r.label.clone(),
            host: r.host.clone(),
            port: r.port,
            username: r.username.clone(),
            state: "connecting".into(),
            epoch: SafeInt::new(0).unwrap(),
            error: None,
            has_terminal: false,
            assigned_connection: None,
            intervention: None,
        };
        {
            let mut state = self.state.lock().unwrap();
            if state.stopping {
                return Err(AppError::new("app_closed"));
            }
            if state.entries.len() >= 16 {
                return Err(AppError::new("capacity"));
            }
            self.runtime.reserve_session(session).map_err(core_error)?;
            let request = ConnectRequest {
                session,
                attempt_id: AttemptId(attempt.0),
                target: Target {
                    host: r.host,
                    port: r.port,
                },
                username: r.username,
                auth_method: match r.method {
                    Method::Password => AuthMethod::Password,
                    Method::Key => AuthMethod::Key,
                    Method::Interactive => AuthMethod::Interactive,
                },
                initial_geometry: Geometry::new(120, 32).unwrap(),
            };
            let service = Arc::downgrade(self);
            let connector = self.connector.clone();
            let ui = mailbox.clone();
            let signal = cancel.clone();
            let task = tokio::spawn(async move {
                let result = connector.connect(request, ui, signal.clone()).await;
                if let Some(app) = service.upgrade() {
                    let connected = match result {
                        Ok(connection) => connection.activate(&app.runtime),
                        Err(error) => Err(error),
                    };
                    match connected {
                        Ok(handle) => {
                            if let Some(entry) = app.state.lock().unwrap().entries.get_mut(&id) {
                                entry.info.has_terminal = true;
                            }
                            app.watch_session(id, handle);
                        }
                        Err(error) => {
                            signal.cancel();
                            let _ = app
                                .runtime
                                .close_session(session, CloseReason::TransportLost);
                            if let Some(entry) = app.state.lock().unwrap().entries.get_mut(&id) {
                                entry.info.error = Some(format!("{error:?}"));
                            }
                        }
                    }
                    app.publish();
                }
            });
            let forward = self.forward_auth(id, prompts, cancel.clone());
            state.entries.insert(
                id,
                Entry {
                    info: info.clone(),
                    cancel,
                    mailbox,
                    attempt,
                    binding: None,
                    last_input: SafeInt::new(0).unwrap(),
                    tasks: vec![task, forward],
                    output_ready: Arc::new(tokio::sync::Notify::new()),
                    output_started: false,
                },
            );
        }
        self.publish();
        Ok(info)
    }
    pub fn list(&self) -> Vec<SessionInfo> {
        let state = self.state.lock().unwrap();
        let snapshots = self.runtime.snapshots();
        state
            .entries
            .values()
            .map(|entry| {
                let mut info = entry.info.clone();
                if let Some((_, snapshot)) = snapshots
                    .iter()
                    .find(|(id, _)| *id == SessionId::from_u128(info.id.0))
                {
                    info.state = state_name(snapshot.state);
                    info.epoch = snapshot.epoch;
                    info.assigned_connection = snapshot.assigned.map(|id| Id(id.as_u128()));
                    info.intervention =
                        crate::agent_bridge::intervention(snapshot.intervention.clone());
                }
                info
            })
            .collect()
    }
    pub(crate) fn publish(&self) {
        let _ = self.send(UiEvent::Sessions {
            sessions: self.list(),
        });
    }
    pub(crate) fn send(&self, event: UiEvent) -> Result<(), AppError> {
        if let Err(error) = self.sink.emit(event) {
            self.stop(CloseReason::FrontendLost);
            return Err(error);
        }
        Ok(())
    }
    pub fn close(&self, id: Id) -> Result<(), AppError> {
        {
            let state = self.state.lock().unwrap();
            let entry = state
                .entries
                .get(&id)
                .ok_or_else(|| AppError::new("unknown_session"))?;
            entry.cancel.cancel();
            self.runtime
                .close_session(SessionId::from_u128(id.0), CloseReason::User)
                .map_err(core_error)?;
        }
        self.publish();
        Ok(())
    }
    pub fn remove(&self, id: Id) -> Result<(), AppError> {
        {
            let mut state = self.state.lock().unwrap();
            let entry = state
                .entries
                .get(&id)
                .ok_or_else(|| AppError::new("unknown_session"))?;
            if entry.tasks.iter().any(|t| !t.is_finished()) {
                return Err(AppError::new("busy"));
            }
            self.runtime
                .forget_closed(SessionId::from_u128(id.0))
                .map_err(core_error)?;
            state.entries.remove(&id);
        }
        self.publish();
        Ok(())
    }
    fn watch_session(self: &Arc<Self>, id: Id, handle: SessionHandle) {
        let weak = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            let mut changed = handle.subscribe();
            loop {
                let closed = changed.borrow_and_update().state == State::Closed;
                if let Some(app) = weak.upgrade() {
                    if closed {
                        if let Some(entry) = app.state.lock().unwrap().entries.get(&id) {
                            entry.cancel.cancel();
                        }
                    }
                    app.publish();
                } else {
                    break;
                }
                if closed || changed.changed().await.is_err() {
                    break;
                }
            }
        });
        if let Some(entry) = self.state.lock().unwrap().entries.get_mut(&id) {
            entry.tasks.push(task);
        } else {
            task.abort();
        }
    }
    pub async fn bind(&self, id: Id) -> Result<Binding, AppError> {
        let handle = self
            .runtime
            .session_handle(SessionId::from_u128(id.0))
            .map_err(core_error)?;
        let binding = {
            let mut state = self.state.lock().unwrap();
            if state.stopping {
                return Err(AppError::new("app_closed"));
            }
            let entry = state
                .entries
                .get_mut(&id)
                .ok_or_else(|| AppError::new("unknown_session"))?;
            if entry.binding.is_some() {
                drop(state);
                self.stop(CloseReason::FrontendLost);
                return Err(AppError::new("stale_view"));
            }
            let binding = Binding {
                session: id,
                view: crate::ids::fresh()?,
            };
            entry.binding = Some(binding);
            binding
        };
        handle
            .bind_view(ViewId::from_u128(binding.view.0))
            .await
            .map_err(core_error)?;
        Ok(binding)
    }
    pub(crate) fn handle(&self, binding: Binding) -> Result<SessionHandle, AppError> {
        let state = self.state.lock().unwrap();
        if state.stopping {
            return Err(AppError::new("app_closed"));
        }
        let entry = state
            .entries
            .get(&binding.session)
            .ok_or_else(|| AppError::new("unknown_session"))?;
        if entry.binding.is_none_or(|b| b.view != binding.view) {
            return Err(AppError::new("stale_view"));
        }
        self.runtime
            .session_handle(SessionId::from_u128(binding.session.0))
            .map_err(core_error)
    }
}
