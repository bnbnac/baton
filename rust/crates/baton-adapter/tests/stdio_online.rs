#![cfg(windows)]
use baton_ipc::*;
use serde_json::{Value, json};
use std::{path::Path, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Notify,
};
struct Fixture {
    entered: Notify,
    cancelled: Notify,
    disconnected: Notify,
    reject: Option<ErrorCode>,
}
impl AgentBackend for Fixture {
    fn connected(&self, _: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>> {
        Box::pin(async { self.reject.map_or(Ok(()), |code| Err(WireError::new(code))) })
    }
    fn disconnected(&self, _: ConnectionContext) -> IpcFuture<'_, ()> {
        Box::pin(async {
            self.disconnected.notify_one();
        })
    }
    fn dispatch(
        &self,
        c: ConnectionContext,
        r: AgentRequest,
        t: CancellationToken,
    ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
        Box::pin(async move {
            match r {
                AgentRequest::Status {} => Ok(AgentResponse::Status(StatusResult {
                    contract_version: 2,
                    app_state: AppState::Online,
                    app_instance_id: Some(c.app_instance_id()),
                    connection_id: Some(c.connection_id()),
                    sessions: vec![],
                })),
                AgentRequest::ReadOutput { wait_ms, .. } if wait_ms > 0 => {
                    self.entered.notify_one();
                    t.cancelled().await;
                    self.cancelled.notify_one();
                    Err(WireError::new(ErrorCode::Cancelled))
                }
                AgentRequest::ReadOutput {
                    control_epoch,
                    stream_id,
                    cursor,
                    ..
                } => {
                    if control_epoch.get() != 1 {
                        return Err(WireError::new(ErrorCode::StaleControlEpoch));
                    }
                    if stream_id.as_u128() != 2 {
                        return Err(WireError::new(ErrorCode::StaleStream));
                    }
                    Ok(AgentResponse::Output(OutputPage {
                        text: "\"quote\"\n한글 😀 \\ data".into(),
                        next_cursor: cursor,
                        oldest_cursor: cursor,
                        end_cursor: cursor,
                        has_more: false,
                    }))
                }
                _ => Ok(AgentResponse::Input {
                    result: InputOutcome::Delivered,
                }),
            }
        })
    }
}
fn folder() -> std::path::PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase3-stdio");
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap().join(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string(),
    )
}
async fn setup(reject: Option<ErrorCode>) -> (std::path::PathBuf, LocalServer, Arc<Fixture>) {
    let path = folder();
    let fixture = Arc::new(Fixture {
        entered: Notify::new(),
        cancelled: Notify::new(),
        disconnected: Notify::new(),
        reject,
    });
    let app = WireId::from_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    );
    let server = LocalServer::start(&path, app, fixture.clone())
        .await
        .unwrap();
    (path, server, fixture)
}
struct Process {
    child: Child,
    input: Option<ChildStdin>,
    output: Lines<BufReader<ChildStdout>>,
}
impl Process {
    async fn start(path: &Path) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_baton-adapter"));
        command
            .env("BATON_RUST_ENDPOINT_DIR", path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let mut child = command.spawn().unwrap();
        let input = Some(child.stdin.take().unwrap());
        let output = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut this = Self {
            child,
            input,
            output,
        };
        this.send(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}})).await;
        let response = this.next().await;
        assert_eq!(response["result"]["protocolVersion"], "2025-11-25");
        this.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .await;
        this
    }
    async fn send(&mut self, value: Value) {
        let line = value.to_string() + "\n";
        self.input
            .as_mut()
            .unwrap()
            .write_all(line.as_bytes())
            .await
            .unwrap();
    }
    async fn next(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(2), self.output.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["jsonrpc"], "2.0");
        v
    }
    async fn call(&mut self, id: u64, name: &str, args: Value) -> Value {
        self.send(json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":args}})).await;
        let result = self.next().await;
        assert_eq!(result["id"], id);
        result
    }
    async fn eof(&mut self) {
        drop(self.input.take());
        assert!(
            tokio::time::timeout(Duration::from_secs(2), self.child.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
        let mut stderr = String::new();
        self.child
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .await
            .unwrap();
        assert!(stderr.is_empty());
    }
    async fn wait_status(&mut self, key: &str, expected: Value) -> Value {
        tokio::time::timeout(Duration::from_secs(12), async {
            loop {
                let result = self.call(1000, "status", json!({})).await;
                if data(&result)[key] == expected {
                    break result;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("expected adapter state not observed")
    }
}
fn data(response: &Value) -> Value {
    serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
}
fn read(wait: u32) -> Value {
    json!({"session_id":"00000000000000000000000000000001","control_epoch":1,"stream_id":"00000000000000000000000000000002","cursor":0,"limit":100,"wait_ms":wait})
}
#[tokio::test]
async fn stdio_online_output_errors_then_offline_has_no_cached_identity() {
    let (path, server, _) = setup(None).await;
    let mut process = Process::start(&path).await;
    let status = data(&process.wait_status("app_state", json!("online")).await);
    assert_eq!(status["app_state"], "online");
    assert_eq!(status["sessions"], json!([]));
    assert!(status["connection_id"].is_string());
    assert_eq!(
        data(&process.call(3, "read_output", read(0)).await)["text"],
        "\"quote\"\n한글 😀 \\ data"
    );
    let mut wrong = read(0);
    wrong["control_epoch"] = json!(2);
    let result = process.call(4, "read_output", wrong).await;
    assert_eq!(result["result"]["isError"], true);
    assert_eq!(data(&result)["code"], "stale_control_epoch");
    let mut wrong = read(0);
    wrong["stream_id"] = json!("3".repeat(32));
    assert_eq!(
        data(&process.call(5, "read_output", wrong).await)["code"],
        "stale_stream"
    );
    server.shutdown().await;
    let result = data(&process.call(6, "status", json!({})).await);
    assert_eq!(result["app_state"], "offline");
    assert!(result["connection_id"].is_null());
    assert!(result["app_instance_id"].is_null());
    assert_eq!(result["sessions"], json!([]));
    process.eof().await;
}
#[tokio::test]
async fn stdio_cancellation_and_eof_release_pending_reads_and_ipc() {
    let (path, server, fixture) = setup(None).await;
    let mut process = Process::start(&path).await;
    process.wait_status("app_state", json!("online")).await;
    process.send(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_output","arguments":read(10000)}})).await;
    tokio::time::timeout(Duration::from_secs(2), fixture.entered.notified())
        .await
        .unwrap();
    process
        .send(json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}))
        .await;
    tokio::time::timeout(Duration::from_secs(2), fixture.cancelled.notified())
        .await
        .unwrap();
    process.send(json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_output","arguments":read(10000)}})).await;
    tokio::time::timeout(Duration::from_secs(2), fixture.entered.notified())
        .await
        .unwrap();
    process.eof().await;
    tokio::time::timeout(Duration::from_secs(2), fixture.disconnected.notified())
        .await
        .unwrap();
    server.shutdown().await;
}
#[tokio::test]
async fn authentication_and_version_failures_are_not_reported_as_offline() {
    for code in [ErrorCode::AuthenticationFailed, ErrorCode::ProtocolMismatch] {
        let (path, server, _) = setup(Some(code)).await;
        let mut process = Process::start(&path).await;
        let result = process
            .wait_status("code", serde_json::to_value(code).unwrap())
            .await;
        assert_eq!(result["result"]["isError"], true);
        assert_eq!(data(&result)["code"], serde_json::to_value(code).unwrap());
        process.eof().await;
        server.shutdown().await;
    }
}
#[tokio::test]
async fn offline_start_rediscovers_a_new_app_without_restarting_stdio() {
    let path = folder();
    let mut process = Process::start(&path).await;
    assert_eq!(
        data(&process.call(2, "status", json!({})).await)["app_state"],
        "offline"
    );
    let fixture = Arc::new(Fixture {
        entered: Notify::new(),
        cancelled: Notify::new(),
        disconnected: Notify::new(),
        reject: None,
    });
    let server = LocalServer::start(&path, WireId::from_u128(89123), fixture)
        .await
        .unwrap();
    let status = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let status = data(&process.call(3, "status", json!({})).await);
            if status["app_state"] == "online" {
                break status;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("adapter never rediscovered the app");
    assert_eq!(status["app_instance_id"], format!("{:032x}", 89123));
    assert_eq!(status["sessions"], json!([]));
    assert!(status["connection_id"].is_string());
    process.eof().await;
    server.shutdown().await;
}
