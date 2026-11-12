use crate::{dto::*, *};
use baton_core::{ConnectionId, IoFuture, SessionId, State, StreamId, Transport, WriteResult};
use baton_ipc::{AgentBackend, ConnectionContext, IpcFuture, WireError};
use baton_ipc::{
    AgentKey, AgentRequest, AgentResponse, CancellationToken, ErrorCode, LocalClient, LocalServer,
    WireId,
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
fn key(n: u128) -> AgentKey {
    AgentKey::from_u128(n)
}
// The core connection an agent key maps to: the key's 128 bits.
fn vc(n: u128) -> ConnectionId {
    ConnectionId::from_u128(n)
}
fn status_request(n: u128) -> AgentRequest {
    AgentRequest::Status { agent_key: key(n) }
}
async fn status_of(client: &LocalClient, n: u128) -> baton_ipc::StatusResult {
    match client
        .call(status_request(n), CancellationToken::new())
        .await
        .unwrap()
    {
        AgentResponse::Status(status) => status,
        other => panic!("status expected, got {other:?}"),
    }
}
fn read_request(
    n: u128,
    session: Id,
    epoch: baton_core::SafeInt,
    stream: u128,
    wait_ms: u32,
) -> AgentRequest {
    AgentRequest::ReadOutput {
        agent_key: key(n),
        session_id: WireId::from_u128(session.0),
        control_epoch: epoch,
        stream_id: WireId::from_u128(stream),
        cursor: baton_core::SafeInt::new(0).unwrap(),
        limit: 100,
        wait_ms,
    }
}
fn send_request(
    n: u128,
    session: Id,
    epoch: baton_core::SafeInt,
    request_id: u128,
    text: &str,
) -> AgentRequest {
    AgentRequest::SendText {
        agent_key: key(n),
        session_id: WireId::from_u128(session.0),
        control_epoch: epoch,
        request_id: WireId::from_u128(request_id),
        text: text.into(),
    }
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
    status_of(&a, 1).await;
    status_of(&b, 2).await;
    let (aid, ah) = session(&app, "A private").await;
    let (bid, bh) = session(&app, "B private").await;
    ah.handoff(vc(1), StreamId::from_u128(1)).await.unwrap();
    bh.handoff(vc(2), StreamId::from_u128(2)).await.unwrap();
    ah.receive(b"A output".to_vec()).await.unwrap();
    bh.receive(b"B SECRET".to_vec()).await.unwrap();
    let status = status_of(&a, 1).await;
    assert_eq!(status.sessions.len(), 1);
    assert_eq!(status.sessions[0].session_id, WireId::from_u128(aid.0));
    assert_eq!(status.sessions[0].label, "A private");
    let epoch = bh.snapshot().await.epoch;
    for request in [
        read_request(1, bid, epoch, 2, 0),
        send_request(1, bid, epoch, 5, "NEVER"),
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
            send_request(1, aid, ah.snapshot().await.epoch, 6, "ALLOWED"),
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
    // A shell belongs to the agent key, not to the IPC connection that carried the call.
    drop(a);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(ah.snapshot().await.state, State::AgentOwned);
    assert_eq!(bh.snapshot().await.state, State::AgentOwned);
    drop(b);
    server.shutdown().await;
    app.shutdown().await;
}
#[tokio::test]
async fn two_agent_keys_on_one_ipc_connection_see_only_their_own_shells() {
    let app = AppService::with_connector(
        Arc::new(ConnectorFixture(Arc::new(Writes::default()))),
        Arc::new(Sink),
    );
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let client = LocalClient::connect(&path).await.unwrap();
    status_of(&client, 1).await;
    status_of(&client, 2).await;
    let (aid, ah) = session(&app, "A shell").await;
    let (bid, bh) = session(&app, "B shell").await;
    ah.handoff(vc(1), StreamId::from_u128(1)).await.unwrap();
    bh.handoff(vc(2), StreamId::from_u128(2)).await.unwrap();
    let first = status_of(&client, 1).await;
    assert_eq!(first.sessions.len(), 1);
    assert_eq!(first.sessions[0].session_id, WireId::from_u128(aid.0));
    let second = status_of(&client, 2).await;
    assert_eq!(second.sessions.len(), 1);
    assert_eq!(second.sessions[0].session_id, WireId::from_u128(bid.0));
    assert!(status_of(&client, 3).await.sessions.is_empty());
    drop(client);
    server.shutdown().await;
    app.shutdown().await;
}
#[tokio::test]
async fn foreign_key_cannot_read_or_write_another_keys_shell() {
    let writes = Arc::new(Writes::default());
    let app =
        AppService::with_connector(Arc::new(ConnectorFixture(writes.clone())), Arc::new(Sink));
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let client = LocalClient::connect(&path).await.unwrap();
    status_of(&client, 1).await;
    status_of(&client, 2).await;
    let (aid, ah) = session(&app, "A shell").await;
    ah.handoff(vc(1), StreamId::from_u128(1)).await.unwrap();
    ah.receive(b"A output".to_vec()).await.unwrap();
    let epoch = ah.snapshot().await.epoch;
    for request in [
        read_request(2, aid, epoch, 1, 0),
        send_request(2, aid, epoch, 5, "NEVER"),
    ] {
        assert_eq!(
            client
                .call(request, CancellationToken::new())
                .await
                .unwrap_err()
                .code,
            ErrorCode::NotOwner
        );
    }
    assert!(writes.0.lock().unwrap().is_empty());
    match client
        .call(read_request(1, aid, epoch, 1, 0), CancellationToken::new())
        .await
        .unwrap()
    {
        AgentResponse::Output(page) => assert_eq!(page.text, "A output"),
        other => panic!("output expected, got {other:?}"),
    }
    drop(client);
    server.shutdown().await;
    app.shutdown().await;
}
#[tokio::test]
async fn one_agent_key_can_own_three_shells() {
    let app = AppService::with_connector(
        Arc::new(ConnectorFixture(Arc::new(Writes::default()))),
        Arc::new(Sink),
    );
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let client = LocalClient::connect(&path).await.unwrap();
    status_of(&client, 1).await;
    let mut expected = Vec::new();
    for n in 0..3u128 {
        let (id, handle) = session(&app, &format!("shell {n}")).await;
        handle
            .handoff(vc(1), StreamId::from_u128(n + 1))
            .await
            .unwrap();
        expected.push(WireId::from_u128(id.0));
    }
    let mut seen: Vec<WireId> = status_of(&client, 1)
        .await
        .sessions
        .iter()
        .map(|s| s.session_id)
        .collect();
    seen.sort();
    expected.sort();
    assert_eq!(seen, expected);
    drop(client);
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
    status_of(&client, 1).await;
    let (id, handle) = session(&app, "private after reclaim").await;
    handle.handoff(vc(1), StreamId::from_u128(1)).await.unwrap();
    let request = read_request(1, id, handle.snapshot().await.epoch, 1, 10000);
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
            .call(status_request(1), CancellationToken::new())
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
    status_of(&client, 1).await;
    let (id, handle) = session(&app, "cancellation").await;
    let owner = vc(1);
    handle.handoff(owner, StreamId::from_u128(1)).await.unwrap();
    let epoch = handle.snapshot().await.epoch;
    let request = |n: u128, text: &str| send_request(1, id, epoch, n, text);
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

#[tokio::test]
async fn user_ownership_actions_validate_epoch_and_intervention_is_only_notification() {
    let writes = Arc::new(Writes::default());
    let app =
        AppService::with_connector(Arc::new(ConnectorFixture(writes.clone())), Arc::new(Sink));
    assert!(app.list_agent_connections().is_empty());
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let client = LocalClient::connect(&path).await.unwrap();
    // An IPC connection alone is not listed; the agent connection appears with its first call.
    assert!(app.list_agent_connections().is_empty());
    status_of(&client, 1).await;
    let connection_id = Id(1);
    assert_eq!(app.list_agent_connections()[0].id, connection_id);
    let (id, handle) = session(&app, "ownership").await;
    let first = handle.snapshot().await.epoch;
    assert!(
        app.handoff_session(HandoffRequest {
            id,
            expected_epoch: first,
            connection_id: Id(0)
        })
        .await
        .is_err()
    );
    let handed = app
        .handoff_session(HandoffRequest {
            id,
            expected_epoch: first,
            connection_id,
        })
        .await
        .unwrap();
    assert_eq!(handed.state, "agent_owned");
    assert_eq!(handed.assigned_connection, Some(connection_id));
    assert_eq!(
        app.reclaim_session(OwnershipRequest {
            id,
            expected_epoch: first
        })
        .await
        .unwrap_err()
        .code,
        "StaleControlEpoch"
    );
    client
        .call(
            AgentRequest::RequestUserControl {
                agent_key: key(1),
                session_id: WireId::from_u128(id.0),
                control_epoch: handed.epoch,
                request_id: WireId::from_u128(7),
                reason: "<script>not HTML</script> 인증 필요".into(),
            },
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(handle.snapshot().await.state, State::AgentOwned);
    assert!(writes.0.lock().unwrap().is_empty());
    let pending = app.list().into_iter().find(|s| s.id == id).unwrap();
    assert!(pending.intervention.is_some());
    let declined = app
        .decline_intervention(DeclineRequest {
            id,
            expected_epoch: handed.epoch,
            request_id: Id(7),
        })
        .await
        .unwrap();
    assert_eq!(
        declined.intervention.unwrap().state,
        baton_ipc::InterventionState::Declined
    );
    assert_eq!(declined.state, "agent_owned");
    assert!(writes.0.lock().unwrap().is_empty());
    let reclaimed = app
        .reclaim_session(OwnershipRequest {
            id,
            expected_epoch: handed.epoch,
        })
        .await
        .unwrap();
    assert_eq!(reclaimed.state, "user_owned");
    assert!(reclaimed.intervention.is_none());
    assert_eq!(reclaimed.assigned_connection, Some(connection_id));
    drop(client);
    server.shutdown().await;
    // The agent connection outlives the IPC connection that carried its calls.
    assert_eq!(app.list_agent_connections().len(), 1);
    assert_eq!(handle.snapshot().await.state, State::UserOwned);
    app.shutdown().await;
}

#[tokio::test]
async fn first_call_registers_the_agent_connection_and_status_reports_its_id() {
    let app = AppService::with_connector(
        Arc::new(ConnectorFixture(Arc::new(Writes::default()))),
        Arc::new(Sink),
    );
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let client = LocalClient::connect(&path).await.unwrap();
    assert!(app.list_agent_connections().is_empty());
    let status = status_of(&client, 7).await;
    let list = app.list_agent_connections();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, Id(7));
    assert_eq!(status.connection_id, Some(WireId::from_u128(7)));
    assert_eq!(status.contract_version, baton_ipc::CONTRACT_VERSION);
    drop(client);
    server.shutdown().await;
    app.shutdown().await;
}

#[tokio::test]
async fn connection_names_are_kept_per_agent_key() {
    let app = AppService::with_connector(
        Arc::new(ConnectorFixture(Arc::new(Writes::default()))),
        Arc::new(Sink),
    );
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
    assert!(app.list_agent_connections().is_empty());
    let named = a
        .call(
            AgentRequest::SetConnectionName {
                agent_key: key(1),
                name: "  서버 점검  ".into(),
            },
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(named, AgentResponse::ConnectionName {});
    b.call(
        AgentRequest::SetConnectionName {
            agent_key: key(2),
            name: "로그 분석".into(),
        },
        CancellationToken::new(),
    )
    .await
    .unwrap();
    let invalid = b
        .call(
            AgentRequest::SetConnectionName {
                agent_key: key(3),
                name: "\n".into(),
            },
            CancellationToken::new(),
        )
        .await;
    assert!(invalid.is_err());
    let names = |app: &Arc<AppService>| {
        app.list_agent_connections()
            .into_iter()
            .map(|c| (c.id.0, c.name))
            .collect::<Vec<_>>()
    };
    let expected = vec![
        (1, Some("서버 점검".to_string())),
        (2, Some("로그 분석".to_string())),
    ];
    assert_eq!(names(&app), expected);
    // Names belong to the agent key and stay when the IPC connection that set them goes away.
    a.close();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(names(&app), expected);
    drop(b);
    server.shutdown().await;
    app.shutdown().await;
}

#[tokio::test]
async fn shells_stay_assigned_after_physical_disconnect_and_same_key_reattaches() {
    let writes = Arc::new(Writes::default());
    let app =
        AppService::with_connector(Arc::new(ConnectorFixture(writes.clone())), Arc::new(Sink));
    let path = folder();
    let server = app.start_agent_server(&path).await.unwrap();
    let first = LocalClient::connect(&path).await.unwrap();
    status_of(&first, 1).await;
    let (id, handle) = session(&app, "survivor").await;
    handle.handoff(vc(1), StreamId::from_u128(1)).await.unwrap();
    drop(first);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(handle.snapshot().await.state, State::AgentOwned);
    let second = LocalClient::connect(&path).await.unwrap();
    let status = status_of(&second, 1).await;
    assert_eq!(status.sessions.len(), 1);
    assert_eq!(status.sessions[0].session_id, WireId::from_u128(id.0));
    assert_eq!(status.sessions[0].state, baton_ipc::SessionState::AgentOwned);
    let sent = second
        .call(
            send_request(1, id, handle.snapshot().await.epoch, 1, "AFTER"),
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
    assert_eq!(*writes.0.lock().unwrap(), vec![b"AFTER".to_vec()]);
    drop(second);
    server.shutdown().await;
    app.shutdown().await;
}
