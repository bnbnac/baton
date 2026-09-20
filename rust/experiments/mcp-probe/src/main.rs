mod tools;
use rmcp::ServiceExt;

#[tokio::main]
async fn main() {
    let (eof_tx, eof_rx) = tokio::sync::watch::channel(false);
    let (mut writer, reader) = tokio::io::duplex(65536);
    let input = tokio::spawn(async move {
        let _ = tokio::io::copy(&mut tokio::io::stdin(), &mut writer).await;
        let _ = eof_tx.send(true);
        drop(writer);
    });
    if let Ok(service) = (tools::Probe { eof: eof_rx })
        .serve((reader, tokio::io::stdout()))
        .await
    {
        let _ = service.waiting().await;
    }
    input.abort();
}
