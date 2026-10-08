#![cfg(windows)]
mod common;
use baton_ipc::*;
use common::*;
use serde_json::json;
use std::{sync::Arc, time::Duration};
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
    let fixture = Arc::new(Fixture::new(None));
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
