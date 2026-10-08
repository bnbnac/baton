use crate::{dto::*, *};
use baton_core::{ConnectionId, IoFuture, SessionId, State, StreamId, Transport, WriteResult};
use baton_ipc::{AgentBackend, ConnectionContext, IpcFuture, WireError};
use baton_ipc::{
    AgentRequest, AgentResponse, CancellationToken, ErrorCode, LocalClient, LocalServer, WireId,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
struct Sink;
impl EventSink for Sink {
    fn emit(&self, _: UiEvent) -> Result<(), AppError> {
        Ok(())
    }
}
#[derive(Default)]
struct Writes(
    Mutex<Vec<Vec<u8>>>,
    std::sync::atomic::AtomicBool,
    tokio::sync::Notify,
    tokio::sync::Notify,
);
struct Writer(Arc<Writes>);
impl Transport for Writer {
    fn write<'a>(&'a mut self, data: &'a [u8]) -> IoFuture<'a, WriteResult> {
        Box::pin(async move {
            self.0.0.lock().unwrap().push(data.to_vec());
            self.0.2.notify_one();
            if self.0.1.load(std::sync::atomic::Ordering::SeqCst) {
                self.0.3.notified().await;
            }
            WriteResult::Delivered
        })
    }
    fn close(&mut self) -> IoFuture<'_, ()> {
        Box::pin(async {})
    }
}
struct Ready(SessionId, Arc<Writes>);
impl ReadyConnection for Ready {
    fn activate(
        self: Box<Self>,
        runtime: &baton_core::Runtime,
    ) -> Result<baton_core::SessionHandle, baton_ssh::SshError> {
        runtime
            .activate_session(self.0, Box::new(Writer(self.1)))
            .map_err(|_| baton_ssh::SshError::Cancelled)
    }
}
struct ConnectorFixture(Arc<Writes>);
impl Connector for ConnectorFixture {
    fn connect(
        &self,
        r: baton_ssh::ConnectRequest,
        _: Arc<dyn baton_ssh::AuthUi>,
        _: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, baton_ssh::SshError>> {
        let writer = self.0.clone();
        Box::pin(async move { Ok(Box::new(Ready(r.session, writer)) as Box<dyn ReadyConnection>) })
    }
}
fn folder() -> std::path::PathBuf {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase3-bridge");
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap().join(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string(),
    )
}
async fn session(app: &Arc<AppService>, label: &str) -> (Id, baton_core::SessionHandle) {
    let info = app
        .connect(ConnectionRequest {
            label: label.into(),
            host: "fixture.invalid".into(),
            port: 22,
            username: "test".into(),
            method: Method::Password,
        })
        .unwrap();
    let id = SessionId::from_u128(info.id.0);
    let handle = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let Ok(h) = app.runtime.session_handle(id) {
                break h;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (info.id, handle)
}
#[tokio::test]
async fn real_ipc_bridge_filters_owners_and_blocks_foreign_read_and_write() {
    let writes = Arc::new(Writes::default());
    let app =
        AppService::with_connector(Arc::new(ConnectorFixture(writes.clone())), Arc::new(Sink));
    let path = folder();
    let server = LocalServer::start(
        &path,
        WireId::from_u128(app.runtime.app_id().as_u128()),
        Arc::new(AgentBridge::new(app.clone())),
    )
    .await
    .unwrap();
    let a = LocalClient::connect(&path).await.unwrap();
    let b = LocalClient::connect(&path).await.unwrap();
    let (aid, ah) = session(&app, "A private").await;
    let (bid, bh) = session(&app, "B private").await;
    ah.handoff(
        ConnectionId::from_u128(a.context().connection_id().as_u128()),
        StreamId::from_u128(1),
    )
    .await
    .unwrap();
    bh.handoff(
        ConnectionId::from_u128(b.context().connection_id().as_u128()),
        StreamId::from_u128(2),
    )
    .await
    .unwrap();
    ah.receive(b"A output".to_vec()).await.unwrap();
    bh.receive(b"B SECRET".to_vec()).await.unwrap();
    let status = a
        .call(AgentRequest::Status {}, CancellationToken::new())
        .await
        .unwrap();
    let AgentResponse::Status(status) = status else {
        panic!("status expected")
    };
    assert_eq!(status.sessions.len(), 1);
    assert_eq!(status.sessions[0].session_id, WireId::from_u128(aid.0));
    assert_eq!(status.sessions[0].label, "A private");
    let epoch = bh.snapshot().await.epoch;
    for request in [
        AgentRequest::ReadOutput {
            session_id: WireId::from_u128(bid.0),
            control_epoch: epoch,
            stream_id: WireId::from_u128(2),
            cursor: baton_core::SafeInt::new(0).unwrap(),
            limit: 100,
            wait_ms: 0,
        },
        AgentRequest::SendText {
            session_id: WireId::from_u128(bid.0),
            control_epoch: epoch,
            request_id: WireId::from_u128(5),
            text: "NEVER".into(),
        },
    ] {
        assert_eq!(
            a.call(request, CancellationToken::new())
                .await
                .unwrap_err()
                .code,
            ErrorCode::NotOwner
        );
    }
    assert!(writes.0.lock().unwrap().is_empty());
    let sent = a
        .call(
            AgentRequest::SendText {
                session_id: WireId::from_u128(aid.0),
                control_epoch: ah.snapshot().await.epoch,
                request_id: WireId::from_u128(6),
                text: "ALLOWED".into(),
            },
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(
        sent,
        AgentResponse::Input {
            result: baton_ipc::InputOutcome::Delivered
        }
    );
    assert_eq!(*writes.0.lock().unwrap(), vec![b"ALLOWED".to_vec()]);
    drop(a);
    tokio::time::timeout(Duration::from_secs(1), async {
        while ah.snapshot().await.state != State::Closed {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(bh.snapshot().await.state, State::AgentOwned);
    drop(b);
    server.shutdown().await;
    app.shutdown().await;
}

struct CommitGate {
    bridge: AgentBridge,
    ready: tokio::sync::Notify,
    released: Mutex<bool>,
    wake: std::sync::Condvar,
}
impl AgentBackend for CommitGate {
    fn connected(&self, c: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>> {
        self.bridge.connected(c)
    }
    fn disconnected(&self, c: ConnectionContext) -> IpcFuture<'_, ()> {
        self.bridge.disconnected(c)
    }
    fn dispatch(
        &self,
        c: ConnectionContext,
        r: AgentRequest,
        t: CancellationToken,
    ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
        self.bridge.dispatch(c, r, t)
    }
    fn commit_response(
        &self,
        c: ConnectionContext,
        r: &AgentRequest,
        result: &mut Result<AgentResponse, WireError>,
    ) {
        if matches!(result, Ok(AgentResponse::Output(_))) {
            self.ready.notify_one();
            let mut release = self.released.lock().unwrap();
            while !*release {
                release = self.wake.wait(release).unwrap();
            }
        }
        self.bridge.commit_response(c, r, result);
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn read_reclaim_before_flush_rejects_the_old_output() {
    let app = AppService::with_connector(
        Arc::new(ConnectorFixture(Arc::new(Writes::default()))),
        Arc::new(Sink),
    );
    let gate = Arc::new(CommitGate {
        bridge: AgentBridge::new(app.clone()),
        ready: tokio::sync::Notify::new(),
        released: Mutex::new(false),
        wake: std::sync::Condvar::new(),
    });
    let path = folder();
    let server = LocalServer::start(
        &path,
        WireId::from_u128(app.runtime.app_id().as_u128()),
        gate.clone(),
    )
    .await
    .unwrap();
    let client = Arc::new(LocalClient::connect(&path).await.unwrap());
    let (id, handle) = session(&app, "private after reclaim").await;
    handle
        .handoff(
            ConnectionId::from_u128(client.context().connection_id().as_u128()),
            StreamId::from_u128(1),
        )
        .await
        .unwrap();
    let request = AgentRequest::ReadOutput {
        session_id: WireId::from_u128(id.0),
        control_epoch: handle.snapshot().await.epoch,
        stream_id: WireId::from_u128(1),
        cursor: baton_core::SafeInt::new(0).unwrap(),
        limit: 100,
        wait_ms: 10000,
    };
    let caller = client.clone();
    let read = tokio::spawn(async move { caller.call(request, CancellationToken::new()).await });
    handle.receive(b"OLD PUBLIC OUTPUT".to_vec()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), gate.ready.notified())
        .await
        .unwrap();
    handle.reclaim().await.unwrap();
    *gate.released.lock().unwrap() = true;
    gate.wake.notify_all();
    assert!(
        read.await.unwrap().is_err(),
        "output reclaimed before commit must not reach the agent"
    );
    drop(client);
    server.shutdown().await;
    app.shutdown().await;
}

#[tokio::test]
async fn app_shutdown_rejects_new_ipc_registration() {
    let app = AppService::with_connector(
        Arc::new(ConnectorFixture(Arc::new(Writes::default()))),
        Arc::new(Sink),
    );
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let client = LocalClient::connect(&path).await.unwrap();
    app.shutdown().await;
    assert_eq!(
        client
            .call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .unwrap_err()
            .code,
        ErrorCode::AppOffline
    );
    assert_eq!(
        LocalClient::connect(&path).await.err().unwrap().code,
        ErrorCode::AppOffline
    );
    drop(client);
    server.shutdown().await;
}

#[tokio::test]
async fn queued_input_cancellation_never_writes_and_delivery_waits_for_transport() {
    use baton_core::{InputResult, Principal, RequestId};
    let writes = Arc::new(Writes::default());
    writes.1.store(true, std::sync::atomic::Ordering::SeqCst);
    let app =
        AppService::with_connector(Arc::new(ConnectorFixture(writes.clone())), Arc::new(Sink));
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let client = Arc::new(LocalClient::connect(&path).await.unwrap());
    let (id, handle) = session(&app, "cancellation").await;
    let owner = ConnectionId::from_u128(client.context().connection_id().as_u128());
    handle.handoff(owner, StreamId::from_u128(1)).await.unwrap();
    let epoch = handle.snapshot().await.epoch;
    let request = |n, text: &str| AgentRequest::SendText {
        session_id: WireId::from_u128(id.0),
        control_epoch: epoch,
        request_id: WireId::from_u128(n),
        text: text.into(),
    };
    let caller = client.clone();
    let first = request(1, "FIRST");
    let first = tokio::spawn(async move { caller.call(first, CancellationToken::new()).await });
    writes.2.notified().await;
    assert!(!first.is_finished());
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let caller = client.clone();
    let second = request(2, "NEVER");
    let second = tokio::spawn(async move { caller.call(second, token).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if handle
                .input_result(Principal::Agent(owner), epoch, RequestId::from_u128(2))
                .await
                == Ok(InputResult::Pending)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    cancel.cancel();
    assert_eq!(
        second.await.unwrap().unwrap_err().code,
        ErrorCode::Cancelled
    );
    assert_eq!(
        tokio::time::timeout(
            Duration::from_secs(2),
            handle.wait_input_result(Principal::Agent(owner), epoch, RequestId::from_u128(2))
        )
        .await
        .unwrap()
        .unwrap(),
        InputResult::InputInvalidated
    );
    writes.1.store(false, std::sync::atomic::Ordering::SeqCst);
    writes.3.notify_one();
    assert_eq!(
        first.await.unwrap().unwrap(),
        AgentResponse::Input {
            result: baton_ipc::InputOutcome::Delivered
        }
    );
    client
        .call(request(3, "AFTER"), CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(
        *writes.0.lock().unwrap(),
        vec![b"FIRST".to_vec(), b"AFTER".to_vec()]
    );
    drop(client);
    server.shutdown().await;
    app.shutdown().await;
}
