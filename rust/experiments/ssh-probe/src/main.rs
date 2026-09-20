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
#[serde(deny_unknown_fields)]
struct Credential {
    username: String,
    password: String,
}

#[tokio::main]
async fn main() {
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut line = String::new();
        BufReader::new(tokio::io::stdin().take(65537))
            .read_line(&mut line)
            .await
            .map_err(|_| "invalid_input")?;
        if line.len() > 65536 {
            return Err("invalid_input");
        }
        let input: ProbeInput = serde_json::from_str(&line).map_err(|_| "invalid_input")?;
        if !input.host.is_loopback()
            || input.port == 0
            || !["password-pty", "openssh"].contains(&input.case.as_str())
        {
            return Err("invalid_input");
        }
        pty::run(input).await
    })
    .await;
    let outcome = match result {
        Ok(Ok(())) => "ok",
        Ok(Err(code)) => code,
        Err(_) => "timeout",
    };
    println!("{}", serde_json::json!({ "outcome": outcome }));
}
