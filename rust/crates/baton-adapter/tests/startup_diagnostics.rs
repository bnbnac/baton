#![cfg(windows)]
mod common;
use common::*;
use std::sync::Arc;

#[tokio::test]
async fn fixture_startup_failure_identifies_lock_and_pipe_collisions() {
    let path = folder();
    let other_path = folder();
    let app = app_id();
    let server = start_server(&path, app, Arc::new(Fixture::new(None))).await;
    let mut failures = Vec::new();
    for (target, instance) in [(path.clone(), app_id()), (other_path.clone(), app)] {
        let task = tokio::spawn(async move {
            start_server(&target, instance, Arc::new(Fixture::new(None))).await
        });
        match task.await {
            Ok(unexpected) => {
                unexpected.shutdown().await;
                failures.push(String::new());
            }
            Err(error) => failures.push(*error.into_panic().downcast::<String>().unwrap()),
        }
    }
    server.shutdown().await;
    // Removing the fixture's diagnostic capture must fail these assertions:
    // the wire error alone cannot distinguish a lock from a pipe collision.
    assert!(failures[0].contains("CreateFileW"), "{}", failures[0]);
    assert!(failures[0].contains("Some(32)"), "{}", failures[0]);
    assert!(failures[1].contains("named_pipe.create"), "{}", failures[1]);
    assert!(failures[1].contains("Some(5)"), "{}", failures[1]);
    for message in failures {
        assert!(message.contains("app=WireId("), "{message}");
        assert!(message.contains("path="), "{message}");
    }
    assert!(!path.join("endpoint.bin").exists());
    assert!(!other_path.join("endpoint.bin").exists());
}
