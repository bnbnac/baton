mod auth;
mod pty;

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProbeInput {
    case: String,
    host: std::net::IpAddr,
    port: u16,
    host_fingerprint: String,
    credential: Credential,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Credential {
    username: String,
    password: String,
    #[serde(default)]
    private_key: Option<String>,
    #[serde(default)]
    passphrase: String,
    #[serde(default)]
    responses: Vec<String>,
}

#[tokio::main]
async fn main() {
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut line = String::new();
        let mut reader = BufReader::new(tokio::io::stdin().take(131072));
        reader.read_line(&mut line)
            .await
            .map_err(|_| "invalid_input")?;
        if line.len() > 65536 {
            return Err("invalid_input");
        }
        let input: ProbeInput = serde_json::from_str(&line).map_err(|_| "invalid_input")?;
        if !input.host.is_loopback()
            || input.port == 0
            || !["password-pty", "openssh", "host-reject", "host-cancel", "wrong-password", "encrypted-key", "wrong-key-passphrase", "interactive-two-rounds", "password-then-interactive", "cancel-before-auth", "cancel-between-rounds", "cancel-before-shell", "cancel-late-success"].contains(&input.case.as_str())
        {
            return Err("invalid_input");
        }
        tokio::select! {
            biased;
            _ = async {
                let mut command = String::new();
                loop {
                    command.clear();
                    match reader.read_line(&mut command).await {
                        Ok(0) | Err(_) => std::future::pending::<()>().await,
                        Ok(_) => {
                            if command.len() > 1024 || serde_json::from_str::<serde_json::Value>(&command).ok().and_then(|v| v.get("cancel").and_then(|x| x.as_bool())) == Some(true) { break; }
                        }
                    }
                }
            } => { println!("{{\"stage\":\"cancelled\"}}"); Err("cancelled") },
            result = pty::run(input) => result,
        }
    })
    .await;
    let outcome = match result {
        Ok(Ok(())) => "ok",
        Ok(Err(code)) => code,
        Err(_) => "timeout",
    };
    println!("{}", serde_json::json!({ "outcome": outcome }));
}
