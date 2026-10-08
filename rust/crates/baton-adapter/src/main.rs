use baton_adapter::{link::AdapterLink, tools::Adapter};
use baton_ipc::CancellationToken;
use rmcp::ServiceExt;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// rmcp's tuple transport collects an entire newline-delimited message before
// parsing it. Bound that input before it reaches the SDK, including a peer that
// never sends a newline. Only complete frames are forwarded.
async fn forward_stdin(mut writer: tokio::io::DuplexStream) {
    const MAX_LINE: usize = 262_144;
    let mut stdin = tokio::io::stdin();
    let mut chunk = [0_u8; 8192];
    let mut line = Vec::with_capacity(MAX_LINE);
    loop {
        let Ok(count) = stdin.read(&mut chunk).await else {
            return;
        };
        if count == 0 {
            return;
        }
        for &byte in &chunk[..count] {
            if byte == b'\n' {
                if writer.write_all(&line).await.is_err() || writer.write_all(b"\n").await.is_err()
                {
                    return;
                }
                line.clear();
            } else {
                if line.len() == MAX_LINE {
                    return;
                }
                line.push(byte);
            }
        }
    }
}
#[tokio::main]
async fn main() {
    let endpoint = std::env::var_os("BATON_RUST_ENDPOINT_DIR")
        .map(std::path::PathBuf::from)
        .map(Ok)
        .unwrap_or_else(baton_ipc::endpoint::default_endpoint_dir);
    let link = Arc::new(match endpoint {
        Ok(path) => AdapterLink::start(path),
        Err(error) => AdapterLink::unavailable(error),
    });
    let eof = CancellationToken::new();
    let signal = eof.clone();
    let (writer, reader) = tokio::io::duplex(65536);
    let input = tokio::spawn(async move {
        forward_stdin(writer).await;
        signal.cancel();
    });
    if let Ok(service) = (Adapter {
        link: link.clone(),
        eof: eof.clone(),
    })
    .serve((reader, tokio::io::stdout()))
    .await
    {
        let cancel = service.cancellation_token();
        tokio::select! {_=eof.cancelled()=>cancel.cancel(),_=service.waiting()=>{}}
    }
    input.abort();
    link.shutdown().await;
}
