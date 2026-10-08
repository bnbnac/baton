#![cfg(windows)]
use baton_core::SafeInt;
use baton_ipc::*;
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::AsyncWriteExt,
    net::windows::named_pipe::{ClientOptions, NamedPipeClient},
    sync::Notify,
};
#[derive(Default)]
struct Backend {
    connected: AtomicUsize,
    disconnected: AtomicUsize,
    entered: Notify,
    release: Notify,
    cancelled: Notify,
}
impl AgentBackend for Backend {
    fn connected(&self, _: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>> {
        Box::pin(async {
            self.connected.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    }
    fn disconnected(&self, _: ConnectionContext) -> IpcFuture<'_, ()> {
        Box::pin(async {
            self.disconnected.fetch_add(1, Ordering::SeqCst);
        })
    }
    fn dispatch(
        &self,
        _: ConnectionContext,
        request: AgentRequest,
        cancel: CancellationToken,
    ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
        Box::pin(async move {
            if matches!(&request,AgentRequest::SendText{text,..} if text=="bulk") {
                return Ok(AgentResponse::Output(OutputPage {
                    text: "x".repeat(200000),
                    next_cursor: id(200000),
                    oldest_cursor: id(0),
                    end_cursor: id(200000),
                    has_more: false,
                }));
            }
            if !matches!(request, AgentRequest::Status {}) {
                self.entered.notify_one();
                tokio::select! { _ = cancel.cancelled() => {self.cancelled.notify_one();return Err(WireError::new(ErrorCode::Cancelled));}, _ = self.release.notified() => {} }
            }
            Ok(AgentResponse::Input {
                result: InputOutcome::Delivered,
            })
        })
    }
}

fn bulk(n: u64) -> Frame {
    Frame::Request {
        id: id(n),
        body: AgentRequest::SendText {
            session_id: WireId::from_u128(1),
            control_epoch: id(1),
            request_id: WireId::from_u128(n.into()),
            text: "bulk".into(),
        },
    }
}
#[tokio::test]
async fn stalled_writer_still_processes_cancel_and_expires_without_harming_other_clients() {
    let (folder, server, backend) = setup().await;
    let good = LocalClient::connect(&folder).await.unwrap();
    let mut stalled = raw(&folder).await;
    write_frame(&mut stalled, &bulk(0)).await.unwrap();
    write_frame(&mut stalled, &request(1, true)).await.unwrap();
    backend.entered.notified().await;
    write_frame(&mut stalled, &Frame::Cancel { id: id(1) })
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(1), backend.cancelled.notified())
        .await
        .unwrap();
    assert!(
        good.call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .is_ok()
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        while backend.disconnected.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        good.call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .is_ok()
    );
    drop(stalled);
    drop(good);
    server.shutdown().await;
}
#[tokio::test]
async fn response_queue_overflow_closes_connection_with_bounded_memory() {
    let (folder, server, backend) = setup().await;
    let mut stalled = raw(&folder).await;
    tokio::time::timeout(Duration::from_secs(2), async {
        for n in 0..100 {
            if write_frame(&mut stalled, &bulk(n)).await.is_err() {
                break;
            }
        }
        while backend.disconnected.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(backend.disconnected.load(Ordering::SeqCst), 1);
    drop(stalled);
    server.shutdown().await;
}
fn folder() -> std::path::PathBuf {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase3-ipc");
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize()
        .unwrap()
        .join(format!("auth-{:032x}", unique_id().as_u128()))
}
fn unique_id() -> WireId {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).unwrap();
    WireId::from_u128(u128::from_le_bytes(bytes))
}
async fn setup() -> (std::path::PathBuf, LocalServer, Arc<Backend>) {
    let folder = folder();
    let backend = Arc::new(Backend::default());
    let app = unique_id();
    let server = LocalServer::start(&folder, app, backend.clone())
        .await
        .unwrap_or_else(|error| panic!("fixture endpoint {folder:?} app {app:?}: {error:?}"));
    (folder, server, backend)
}
async fn raw(folder: &std::path::Path) -> NamedPipeClient {
    let d = endpoint::load_endpoint(folder).unwrap();
    let mut pipe = ClientOptions::new().open(&d.pipe_name).unwrap();
    write_frame(
        &mut pipe,
        &Frame::Hello {
            contract_version: 2,
            app_instance_id: d.app_instance_id,
            secret: d.secret,
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        read_frame(&mut pipe).await.unwrap(),
        Frame::Welcome { .. }
    ));
    pipe
}
fn id(n: u64) -> SafeInt {
    SafeInt::new(n).unwrap()
}
fn request(n: u64, read: bool) -> Frame {
    let body = if read {
        AgentRequest::ReadOutput {
            session_id: WireId::from_u128(1),
            control_epoch: id(1),
            stream_id: WireId::from_u128(1),
            cursor: id(0),
            limit: 2,
            wait_ms: 10000,
        }
    } else {
        AgentRequest::SendText {
            session_id: WireId::from_u128(1),
            control_epoch: id(1),
            request_id: WireId::from_u128(n.into()),
            text: "test".into(),
        }
    };
    Frame::Request { id: id(n), body }
}
async fn response(pipe: &mut NamedPipeClient) -> Frame {
    tokio::time::timeout(Duration::from_secs(2), read_frame(pipe))
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn authentication_rejects_secret_version_instance_before_registration() {
    let (folder, server, backend) = setup().await;
    for variant in 0..3 {
        let d = endpoint::load_endpoint(&folder).unwrap();
        let mut pipe = ClientOptions::new().open(&d.pipe_name).unwrap();
        let frame = Frame::Hello {
            contract_version: if variant == 0 { 1 } else { 2 },
            app_instance_id: if variant == 1 {
                WireId::from_u128(999)
            } else {
                d.app_instance_id
            },
            secret: if variant == 2 {
                endpoint::Secret::generate().unwrap()
            } else {
                d.secret
            },
        };
        write_frame(&mut pipe, &frame).await.unwrap();
        assert!(matches!(response(&mut pipe).await, Frame::Rejected { .. }));
    }
    assert_eq!(backend.connected.load(Ordering::SeqCst), 0);
    let client = LocalClient::connect(&folder).await.unwrap();
    assert!(
        client
            .call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .is_ok()
    );
    drop(client);
    server.shutdown().await;
    assert_eq!(backend.disconnected.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn eight_waiting_reads_allow_send_and_ninth_read_is_rejected() {
    let (folder, server, backend) = setup().await;
    let mut pipe = raw(&folder).await;
    for n in 0..8 {
        write_frame(&mut pipe, &request(n, true)).await.unwrap();
        backend.entered.notified().await;
    }
    write_frame(&mut pipe, &request(8, true)).await.unwrap();
    assert!(matches!(
        response(&mut pipe).await,
        Frame::Response {
            error: Some(WireError {
                code: ErrorCode::ReadLimit,
                ..
            }),
            ..
        }
    ));
    write_frame(&mut pipe, &request(9, false)).await.unwrap();
    backend.entered.notified().await;
    write_frame(&mut pipe, &Frame::Cancel { id: id(9) })
        .await
        .unwrap();
    assert!(
        matches!(response(&mut pipe).await,Frame::Response{id:i,error:Some(WireError{code:ErrorCode::Cancelled,..}),..} if i==id(9))
    );
    drop(pipe);
    server.shutdown().await;
}
#[tokio::test]
async fn sixteen_requests_reject_seventeenth_but_accept_cancellation() {
    let (folder, server, backend) = setup().await;
    let mut pipe = raw(&folder).await;
    for n in 0..16 {
        write_frame(&mut pipe, &request(n, false)).await.unwrap();
        backend.entered.notified().await;
    }
    write_frame(&mut pipe, &request(16, false)).await.unwrap();
    assert!(matches!(
        response(&mut pipe).await,
        Frame::Response {
            error: Some(WireError {
                code: ErrorCode::RequestLimit,
                ..
            }),
            ..
        }
    ));
    write_frame(&mut pipe, &Frame::Cancel { id: id(0) })
        .await
        .unwrap();
    assert!(
        matches!(response(&mut pipe).await,Frame::Response{id:i,error:Some(WireError{code:ErrorCode::Cancelled,..}),..} if i==id(0))
    );
    drop(pipe);
    server.shutdown().await;
}
#[tokio::test]
async fn partial_frame_survives_dispatch_completion() {
    let (folder, server, backend) = setup().await;
    let mut pipe = raw(&folder).await;
    write_frame(&mut pipe, &request(0, false)).await.unwrap();
    backend.entered.notified().await;
    let mut encoded = Vec::new();
    write_frame(
        &mut encoded,
        &Frame::Request {
            id: id(1),
            body: AgentRequest::Status {},
        },
    )
    .await
    .unwrap();
    pipe.write_all(&encoded[..2]).await.unwrap();
    // Let the pipe reader consume the partial length before the unrelated reply.
    tokio::time::sleep(Duration::from_millis(30)).await;
    backend.release.notify_one();
    assert!(matches!(response(&mut pipe).await,Frame::Response{id:i,..} if i==id(0)));
    pipe.write_all(&encoded[2..]).await.unwrap();
    assert!(matches!(response(&mut pipe).await,Frame::Response{id:i,..} if i==id(1)));
    drop(pipe);
    server.shutdown().await;
}
#[tokio::test]
async fn thirty_two_authenticated_connections_are_bounded() {
    let (folder, server, backend) = setup().await;
    let mut clients = Vec::new();
    for _ in 0..32 {
        clients.push(LocalClient::connect(&folder).await.unwrap());
    }
    assert!(LocalClient::connect(&folder).await.is_err());
    assert_eq!(backend.connected.load(Ordering::SeqCst), 32);
    assert!(
        clients[0]
            .call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .is_ok()
    );
    drop(clients);
    server.shutdown().await;
    assert_eq!(backend.disconnected.load(Ordering::SeqCst), 32);
}

#[tokio::test]
async fn pending_handshakes_are_bounded_and_partial_eof_does_not_harm_other_clients() {
    let (folder, server, backend) = setup().await;
    let good = LocalClient::connect(&folder).await.unwrap();
    let discovery = endpoint::load_endpoint(&folder).unwrap();
    let mut pending = Vec::new();
    for _ in 0..31 {
        let mut pipe = ClientOptions::new().open(&discovery.pipe_name).unwrap();
        pipe.write_all(&[1, 0]).await.unwrap();
        pending.push(pipe);
        // A healthy round trip proves the accept loop has run before next open.
        good.call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .unwrap();
    }
    assert!(LocalClient::connect(&folder).await.is_err());
    assert_eq!(backend.connected.load(Ordering::SeqCst), 1);
    drop(pending);
    good.call(AgentRequest::Status {}, CancellationToken::new())
        .await
        .unwrap();
    drop(good);
    server.shutdown().await;
    assert_eq!(backend.disconnected.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn duplicate_ids_disconnect_only_the_offending_client() {
    let (folder, server, _) = setup().await;
    let good = LocalClient::connect(&folder).await.unwrap();
    let mut bad = raw(&folder).await;
    let frame = Frame::Request {
        id: id(0),
        body: AgentRequest::Status {},
    };
    write_frame(&mut bad, &frame).await.unwrap();
    response(&mut bad).await;
    write_frame(&mut bad, &frame).await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(1), read_frame(&mut bad))
            .await
            .unwrap()
            .is_err()
    );
    assert!(
        good.call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .is_ok()
    );
    drop(good);
    server.shutdown().await;
}
