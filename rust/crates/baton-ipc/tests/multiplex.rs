#![cfg(windows)]
use baton_ipc::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
struct Backend {
    connected: AtomicUsize,
    disconnected: AtomicUsize,
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
        ctx: ConnectionContext,
        request: AgentRequest,
        cancel: CancellationToken,
    ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
        Box::pin(async move {
            match request {
                AgentRequest::Status {} => Ok(AgentResponse::Status(StatusResult {
                    contract_version: 2,
                    app_state: AppState::Online,
                    app_instance_id: Some(ctx.app_instance_id()),
                    connection_id: Some(ctx.connection_id()),
                    sessions: vec![],
                })),
                AgentRequest::ReadOutput { .. } => {
                    cancel.cancelled().await;
                    Err(WireError::new(ErrorCode::Cancelled))
                }
                _ => Ok(AgentResponse::Input {
                    result: InputOutcome::Delivered,
                }),
            }
        })
    }
}
fn folder() -> std::path::PathBuf {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase3-ipc");
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap().join(format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
#[tokio::test]
async fn real_pipe_clients_have_distinct_contexts_and_waiting_reads_do_not_block_status() {
    let folder = folder();
    let backend = Arc::new(Backend {
        connected: AtomicUsize::new(0),
        disconnected: AtomicUsize::new(0),
    });
    let server = LocalServer::start(&folder, WireId::from_u128(9), backend.clone())
        .await
        .unwrap();
    let a = LocalClient::connect(&folder).await.unwrap();
    let b = LocalClient::connect(&folder).await.unwrap();
    assert_ne!(a.context(), b.context());
    let cancel = CancellationToken::new();
    let reads = AgentRequest::ReadOutput {
        session_id: WireId::from_u128(1),
        control_epoch: baton_core::SafeInt::new(1).unwrap(),
        stream_id: WireId::from_u128(1),
        cursor: baton_core::SafeInt::new(0).unwrap(),
        limit: 2,
        wait_ms: 10000,
    };
    let mut wait = Box::pin(a.call(reads, cancel.clone()));
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(wait.as_mut().poll(cx)))
            .await
            .is_pending()
    );
    let status = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        a.call(AgentRequest::Status {}, CancellationToken::new()),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(matches!(status, AgentResponse::Status(_)));
    cancel.cancel();
    assert!(wait.await.is_err());
    drop(a);
    assert!(
        b.call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .is_ok()
    );
    drop(b);
    server.shutdown().await;
    assert_eq!(backend.connected.load(Ordering::SeqCst), 2);
    assert_eq!(backend.disconnected.load(Ordering::SeqCst), 2);
    assert!(!folder.join("endpoint.bin").exists());
}
#[tokio::test]
async fn unavailable_discovery_is_offline() {
    assert_eq!(
        LocalClient::connect(&folder()).await.err().unwrap().code,
        ErrorCode::AppOffline
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn concurrent_calls_preserve_request_order_on_the_wire() {
    let folder = folder();
    let backend = Arc::new(Backend {
        connected: AtomicUsize::new(0),
        disconnected: AtomicUsize::new(0),
    });
    let server = LocalServer::start(&folder, WireId::from_u128(910), backend)
        .await
        .unwrap();
    let client = Arc::new(LocalClient::connect(&folder).await.unwrap());
    let barrier = Arc::new(tokio::sync::Barrier::new(16));
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..16 {
        let client = client.clone();
        let barrier = barrier.clone();
        tasks.spawn(async move {
            for _ in 0..100 {
                barrier.wait().await;
                client
                    .call(AgentRequest::Status {}, CancellationToken::new())
                    .await
                    .unwrap();
            }
        });
    }
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(result) = tasks.join_next().await {
            result.unwrap();
        }
    })
    .await
    .unwrap();
    drop(client);
    server.shutdown().await;
}
