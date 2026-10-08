use baton_adapter::{link::AdapterLink, tools::Adapter};
use baton_ipc::CancellationToken;
use rmcp::ServiceExt;
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let endpoint = std::env::var_os("BATON_RUST_ENDPOINT_DIR")
        .map(std::path::PathBuf::from)
        .map(Ok)
        .unwrap_or_else(baton_ipc::endpoint::default_endpoint_dir);
    let link = Arc::new(match endpoint {
        Ok(path) => AdapterLink::connect(&path).await,
        Err(error) => AdapterLink::unavailable(error),
    });
    let eof = CancellationToken::new();
    let signal = eof.clone();
    let (mut writer, reader) = tokio::io::duplex(65536);
    let input = tokio::spawn(async move {
        let _ = tokio::io::copy(&mut tokio::io::stdin(), &mut writer).await;
        drop(writer);
        signal.cancel();
    });
    if let Ok(service) = (Adapter {
        link,
        eof: eof.clone(),
    })
    .serve((reader, tokio::io::stdout()))
    .await
    {
        let cancel = service.cancellation_token();
        tokio::select! {_=eof.cancelled()=>cancel.cancel(),_=service.waiting()=>{}}
    }
    input.abort();
}
