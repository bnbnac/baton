#![allow(dead_code)]
use baton_ipc::*;
use serde_json::{Value, json};
use std::{
    path::Path,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Notify,
};
pub struct Fixture {
    pub entered: Notify,
    pub cancelled: Notify,
    pub disconnected: Notify,
    pub reject: Option<ErrorCode>,
    pub block_inputs: AtomicBool,
    pub inputs: Mutex<Vec<AgentRequest>>,
    pub attempts: AtomicUsize,
}
impl Fixture {
    pub fn new(reject: Option<ErrorCode>) -> Self {
        Self {
            entered: Notify::new(),
            cancelled: Notify::new(),
            disconnected: Notify::new(),
            reject,
            block_inputs: AtomicBool::new(false),
            inputs: Mutex::new(vec![]),
            attempts: AtomicUsize::new(0),
        }
    }
}
impl AgentBackend for Fixture {
    fn connected(&self, _: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
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
                request @ (AgentRequest::SendText { .. } | AgentRequest::SendKey { .. }) => {
                    self.inputs.lock().unwrap().push(request);
                    self.entered.notify_one();
                    if self.block_inputs.load(Ordering::SeqCst) {
                        t.cancelled().await;
                        return Err(WireError::new(ErrorCode::Cancelled));
                    }
                    Ok(AgentResponse::Input {
                        result: InputOutcome::Delivered,
                    })
                }
                _ => Ok(AgentResponse::Input {
                    result: InputOutcome::Delivered,
                }),
            }
        })
    }
}
pub fn folder() -> std::path::PathBuf {
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
pub fn app_id() -> WireId {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).unwrap();
    WireId::from_u128(u128::from_le_bytes(bytes))
}
pub async fn setup(reject: Option<ErrorCode>) -> (std::path::PathBuf, LocalServer, Arc<Fixture>) {
    let path = folder();
    let fixture = Arc::new(Fixture::new(reject));
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
pub struct Process {
    pub child: Child,
    pub input: Option<ChildStdin>,
    pub output: Lines<BufReader<ChildStdout>>,
}
impl Process {
    pub async fn start(path: &Path) -> Self {
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
    pub async fn send(&mut self, value: Value) {
        let line = value.to_string() + "\n";
        self.input
            .as_mut()
            .unwrap()
            .write_all(line.as_bytes())
            .await
            .unwrap();
    }
    pub async fn next(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(2), self.output.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["jsonrpc"], "2.0");
        v
    }
    pub async fn call(&mut self, id: u64, name: &str, args: Value) -> Value {
        self.send(json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":args}})).await;
        let result = self.next().await;
        assert_eq!(result["id"], id);
        result
    }
    pub async fn eof(&mut self) {
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
    pub async fn wait_status(&mut self, key: &str, expected: Value) -> Value {
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
pub fn data(response: &Value) -> Value {
    serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
}
pub fn read(wait: u32) -> Value {
    json!({"session_id":"00000000000000000000000000000001","control_epoch":1,"stream_id":"00000000000000000000000000000002","cursor":0,"limit":100,"wait_ms":wait})
}
