#![cfg(windows)]
mod common;
use baton_ipc::*;
use common::*;
use serde_json::{Value, json};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

fn input() -> Value {
    json!({"session_id":"1".repeat(32),"control_epoch":1,"request_id":"2".repeat(32),"text":"NEVER_REPLAY"})
}

#[tokio::test]
async fn damaged_discovery_is_rejected_then_reloaded_after_replacement() {
    let (path, server, _) = setup(None).await;
    std::fs::write(path.join("endpoint.bin"), b"not DPAPI discovery").unwrap();
    let mut process = Process::start(&path).await;
    process
        .wait_status("code", json!("authentication_failed"))
        .await;
    server.shutdown().await;
    let instance = app_id();
    let replacement = LocalServer::start(&path, instance, Arc::new(Fixture::new(None)))
        .await
        .unwrap();
    assert_eq!(
        data(&process.wait_status("app_state", json!("online")).await)["app_instance_id"],
        serde_json::to_value(instance).unwrap()
    );
    process.eof().await;
    replacement.shutdown().await;
}

#[tokio::test]
async fn handshake_attempt_expires_and_reconnects_to_a_replacement_endpoint() {
    let path = folder();
    let mut lease = endpoint::EndpointLease::publish(&path, app_id()).unwrap();
    let mut pipe = lease.take_first_pipe().unwrap();
    let accepted = tokio::spawn(async move {
        pipe.connect().await.unwrap();
        assert!(matches!(
            read_frame(&mut pipe).await.unwrap(),
            Frame::Hello { .. }
        ));
        pipe
    });
    let mut process = Process::start(&path).await;
    let mut pipe = tokio::time::timeout(Duration::from_secs(2), accepted)
        .await
        .unwrap()
        .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(4), read_frame(&mut pipe))
            .await
            .expect("handshake exceeded 3 second budget")
            .is_err()
    );
    drop(pipe);
    drop(lease);
    let server = LocalServer::start(&path, app_id(), Arc::new(Fixture::new(None)))
        .await
        .unwrap();
    process.wait_status("app_state", json!("online")).await;
    process.eof().await;
    server.shutdown().await;
}

#[tokio::test]
async fn three_app_restarts_use_new_identity_and_never_replay_offline_input() {
    let path = folder();
    let mut process = Process::start(&path).await;
    let mut previous = Value::Null;
    for _ in 0..3 {
        let instance = app_id();
        assert_eq!(
            data(&process.call(2, "send_text", input()).await)["code"],
            "app_offline"
        );
        let fixture = Arc::new(Fixture::new(None));
        let server = LocalServer::start(&path, instance, fixture.clone())
            .await
            .unwrap();
        let status = data(&process.wait_status("app_state", json!("online")).await);
        assert_eq!(
            status["app_instance_id"],
            serde_json::to_value(instance).unwrap()
        );
        assert_ne!(status["connection_id"], previous);
        previous = status["connection_id"].clone();
        assert_eq!(status["sessions"], json!([]));
        assert!(fixture.inputs.lock().unwrap().is_empty());
        server.shutdown().await;
        let offline = data(&process.wait_status("app_state", json!("offline")).await);
        assert!(offline["app_instance_id"].is_null());
        assert!(offline["connection_id"].is_null());
        assert_eq!(offline["sessions"], json!([]));
    }
    process.eof().await;
}

#[tokio::test]
async fn pending_input_becomes_uncertain_and_is_not_sent_to_replacement_app() {
    let (path, server, old) = setup(None).await;
    old.block_inputs.store(true, Ordering::SeqCst);
    let mut process = Process::start(&path).await;
    process.wait_status("app_state", json!("online")).await;
    process.send(json!({"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"send_text","arguments":input()}})).await;
    tokio::time::timeout(Duration::from_secs(2), old.entered.notified())
        .await
        .unwrap();
    server.shutdown().await;
    let result = process.next().await;
    assert_eq!(result["id"], 20);
    assert_eq!(data(&result)["code"], "uncertain");
    assert_eq!(old.inputs.lock().unwrap().len(), 1);
    let new = Arc::new(Fixture::new(None));
    let replacement = LocalServer::start(&path, app_id(), new.clone())
        .await
        .unwrap();
    process.wait_status("app_state", json!("online")).await;
    assert!(new.inputs.lock().unwrap().is_empty());
    assert_eq!(
        data(&process.call(21, "send_text", input()).await)["result"],
        "delivered"
    );
    assert_eq!(new.inputs.lock().unwrap().len(), 1);
    process.eof().await;
    replacement.shutdown().await;
}

#[tokio::test]
async fn authentication_and_version_errors_recover_with_fresh_discovery() {
    for code in [ErrorCode::AuthenticationFailed, ErrorCode::ProtocolMismatch] {
        let (path, server, fixture) = setup(Some(code)).await;
        let mut process = Process::start(&path).await;
        process
            .wait_status("code", serde_json::to_value(code).unwrap())
            .await;
        // Authentication errors remain visible while backoff prevents busy loops.
        tokio::time::sleep(Duration::from_millis(2400)).await;
        assert!((2..=3).contains(&fixture.attempts.load(Ordering::SeqCst)));
        assert_eq!(
            data(&process.call(2, "status", json!({})).await)["code"],
            serde_json::to_value(code).unwrap()
        );
        server.shutdown().await;
        let replacement = LocalServer::start(&path, app_id(), Arc::new(Fixture::new(None)))
            .await
            .unwrap();
        assert_eq!(
            data(&process.wait_status("app_state", json!("online")).await)["sessions"],
            json!([])
        );
        process.eof().await;
        replacement.shutdown().await;
    }
}

#[tokio::test]
async fn handshake_stall_does_not_block_initialize_tools_status_or_eof() {
    let path = folder();
    let mut lease = endpoint::EndpointLease::publish(&path, app_id()).unwrap();
    let pipe = lease.take_first_pipe().unwrap();
    let accepted = tokio::spawn(async move {
        pipe.connect().await.unwrap();
        pipe
    });
    // The pipe accepts but never sends Welcome: initialization must not wait 3s.
    let mut process = tokio::time::timeout(Duration::from_secs(1), Process::start(&path))
        .await
        .expect("initialize blocked on handshake");
    let _pipe = tokio::time::timeout(Duration::from_secs(2), accepted)
        .await
        .unwrap()
        .unwrap();
    process
        .send(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
        .await;
    assert_eq!(
        process.next().await["result"]["tools"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        data(&process.call(3, "status", json!({})).await)["app_state"],
        "offline"
    );
    process.eof().await;
}

#[tokio::test]
async fn prolonged_offline_retains_tools_and_eof_stops_retrying() {
    let path = folder();
    let mut process = Process::start(&path).await;
    tokio::time::sleep(Duration::from_secs(8)).await;
    assert_eq!(
        data(&process.call(2, "status", json!({})).await)["app_state"],
        "offline"
    );
    process
        .send(json!({"jsonrpc":"2.0","id":3,"method":"tools/list"}))
        .await;
    assert_eq!(
        process.next().await["result"]["tools"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    process.eof().await;
    let fixture = Arc::new(Fixture::new(None));
    let server = LocalServer::start(&path, app_id(), fixture.clone())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(fixture.attempts.load(Ordering::SeqCst), 0);
    server.shutdown().await;
}
