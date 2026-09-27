use baton_core::*;
use baton_ssh::*;
use serde::Deserialize;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
mod multi;
mod openssh;
#[derive(Deserialize)]
struct Input {
    case: String,
    port: u16,
    private_key: Option<String>,
    #[serde(default)]
    ports: Vec<u16>,
    host_fingerprint: Option<String>,
}
struct Ui {
    case: String,
    key: Option<String>,
    round: std::sync::atomic::AtomicUsize,
    cancel: CancellationToken,
    fingerprint: Option<String>,
}
impl AuthUi for Ui {
    fn before_pty(&self) {
        if self.case == "cancel-before-pty" {
            self.cancel.cancel();
        }
    }
    fn owned_stream_dropped(&self) {
        println!("{{\"stage\":\"owned-stream-dropped\"}}");
    }
    fn observed_late_auth_success(&self) {
        println!("{{\"stage\":\"late-auth-success-observed\"}}");
    }
    fn ask(&self, p: AuthPrompt) -> IoFuture<'_, Result<AuthAnswer, SshError>> {
        Box::pin(async move {
            println!("{}", serde_json::json!({"prompt":format!("{:?}",p.kind)}));
            if (self.case == "host-cancel" && p.kind == PromptKind::HostKey)
                || (self.case == "cancel-before-auth" && p.kind == PromptKind::Password)
                || (self.case == "cancel-between-rounds"
                    && p.kind == PromptKind::Interactive
                    && self.round.load(std::sync::atomic::Ordering::SeqCst) == 1)
            {
                self.cancel.cancel();
                return Err(SshError::Cancelled);
            }
            Ok(match p.kind {
                PromptKind::HostKey => AuthAnswer::Host(
                    self.case != "host-reject"
                        && self
                            .fingerprint
                            .as_ref()
                            .is_none_or(|f| p.display.ends_with(f)),
                ),
                PromptKind::Password => AuthAnswer::Password(Zeroizing::new(
                    if self.case == "wrong-password" {
                        "wrong"
                    } else if self.case == "openssh" {
                        "baton-fixture-only"
                    } else {
                        "fixture-only"
                    }
                    .into(),
                )),
                PromptKind::Key => AuthAnswer::Key {
                    encoded: Zeroizing::new(self.key.clone().unwrap()),
                    passphrase: Zeroizing::new(
                        if self.case == "wrong-key-passphrase" {
                            "wrong"
                        } else {
                            "fixture-key-pass"
                        }
                        .into(),
                    ),
                },
                PromptKind::Interactive => {
                    let i = self.round.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    AuthAnswer::Interactive(vec![Zeroizing::new(
                        if i == 0 { "123456" } else { "654321" }.into(),
                    )])
                }
            })
        })
    }
}
#[tokio::main]
async fn main() {
    let mut line = String::new();
    let mut input_reader = BufReader::new(tokio::io::stdin()).take(2 * 1024 * 1024);
    input_reader.read_line(&mut line).await.unwrap();
    let input: Input = serde_json::from_str(&line).unwrap();
    if input.case == "multi" {
        let result = multi::run(input.ports).await;
        println!(
            "{}",
            serde_json::json!({"outcome":result.err().map_or("ok".to_owned(),|e|format!("{e:?}"))})
        );
        return;
    }
    let cancel = CancellationToken::new();
    let signal = cancel.clone();
    let input_task = tokio::spawn(async move {
        let mut line = String::new();
        while input_reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            if line.trim() == "cancel" {
                signal.cancel();
                println!("{{\"stage\":\"cancelled\"}}");
            }
            line.clear();
        }
    });
    let id = SessionId::from_u128(1);
    let rt = Runtime::spawn(Registry::new(AppId::from_u128(1)));
    rt.reserve_session(id).unwrap();
    let method = if input.case.contains("key") {
        AuthMethod::Key
    } else if input.case.starts_with("interactive") || input.case == "cancel-between-rounds" {
        AuthMethod::Interactive
    } else {
        AuthMethod::Password
    };
    let case = input.case.clone();
    let ui = Arc::new(Ui {
        case: input.case,
        key: input.private_key,
        round: std::sync::atomic::AtomicUsize::new(0),
        cancel: cancel.clone(),
        fingerprint: input.host_fingerprint,
    });
    let request = ConnectRequest {
        session: id,
        attempt_id: AttemptId(1),
        target: Target {
            host: "127.0.0.1".into(),
            port: input.port,
        },
        username: if case == "openssh" {
            "batonfixture"
        } else {
            "fixture"
        }
        .into(),
        auth_method: method,
        initial_geometry: Geometry::new(120, 32).unwrap(),
    };
    let result = async {
        let h = connect(request, ui, cancel).await?.activate(&rt)?;
        let v = h
            .bind_view(ViewId::from_u128(1))
            .await
            .map_err(|_| SshError::CoreRejected)?;
        if case == "openssh" {
            return openssh::run(&h, v).await;
        }
        h.submit(InputCall {
            principal: Principal::User,
            epoch: SafeInt::new(0).unwrap(),
            request_id: RequestId::from_u128(1),
            payload: b"ABC\r".to_vec(),
        })
        .await
        .map_err(|_| SshError::CoreRejected)?;
        if ["remote-exit", "tcp-close"].contains(&case.as_str()) {
            let mut status = h.subscribe();
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                while status.borrow_and_update().state != State::Closed {
                    status.changed().await.unwrap();
                }
            })
            .await
            .map_err(|_| SshError::Timeout)?;
            println!("{{\"stage\":\"remote-closed\"}}");
            return Ok(());
        }
        let mut bytes = Vec::new();
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !bytes.windows(4).any(|w| w == b"ABC\r") {
                if let Some(f) = h.next_ui_frame(v).await.unwrap() {
                    bytes.extend_from_slice(&f.bytes);
                    h.ack_ui_frame(v, f.seq).await.unwrap();
                } else {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
            }
        })
        .await
        .map_err(|_| SshError::Timeout)?;
        h.resize(GeometryRequest {
            binding: v,
            resize_seq: SafeInt::new(1).unwrap(),
            geometry: Geometry::new(91, 27).unwrap(),
        })
        .await
        .map_err(|_| SshError::CoreRejected)?;
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while h.geometry().await.columns != 91 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .map_err(|_| SshError::Timeout)?;
        Ok::<(), SshError>(())
    }
    .await;
    rt.shutdown().await;
    input_task.abort();
    println!(
        "{}",
        serde_json::json!({"outcome":result.err().map_or("ok".to_owned(),|e|format!("{e:?}"))})
    );
}
