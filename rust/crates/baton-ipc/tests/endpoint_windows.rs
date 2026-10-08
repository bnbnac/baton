#![cfg(windows)]
use baton_ipc::{endpoint::*, *};
fn dir() -> std::path::PathBuf {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase3-endpoint");
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap().join(format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
#[tokio::test]
async fn discovery_is_protected_exclusive_and_removed_by_its_owner() {
    let path = dir();
    let id = WireId::from_u128(100);
    let lease = EndpointLease::publish(&path, id).unwrap();
    let loaded = load_endpoint(&path).unwrap();
    assert_eq!(loaded.app_instance_id, id);
    assert!(loaded.pipe_name.contains("baton-rust-v2-"));
    assert!(!format!("{loaded:?}").contains(loaded.secret.expose_hex().as_str()));
    let data = std::fs::read(path.join("endpoint.bin")).unwrap();
    assert!(
        !data
            .windows(64)
            .any(|b| b == loaded.secret.expose_hex().as_bytes())
    );
    assert!(EndpointLease::publish(&path, WireId::from_u128(101)).is_err());
    drop(lease);
    assert!(!path.join("endpoint.bin").exists());
}
#[tokio::test]
async fn authentication_binds_version_instance_and_secret() {
    let path = dir();
    let lease = EndpointLease::publish(&path, WireId::from_u128(200)).unwrap();
    let discovery = load_endpoint(&path).unwrap();
    assert!(
        discovery
            .verify(2, discovery.app_instance_id, &discovery.secret)
            .is_ok()
    );
    assert_eq!(
        discovery
            .verify(1, discovery.app_instance_id, &discovery.secret)
            .unwrap_err()
            .code,
        ErrorCode::ProtocolMismatch
    );
    assert_eq!(
        discovery
            .verify(2, WireId::from_u128(0), &discovery.secret)
            .unwrap_err()
            .code,
        ErrorCode::AuthenticationFailed
    );
    let other = Secret::generate().unwrap();
    assert_eq!(
        discovery
            .verify(2, discovery.app_instance_id, &other)
            .unwrap_err()
            .code,
        ErrorCode::AuthenticationFailed
    );
    drop(lease);
}
#[tokio::test]
async fn tampered_and_oversized_discovery_are_rejected() {
    let path = dir();
    let _lease = EndpointLease::publish(&path, WireId::from_u128(300)).unwrap();
    let file = path.join("endpoint.bin");
    let mut bytes = std::fs::read(&file).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x55;
    std::fs::write(&file, bytes).unwrap();
    assert!(load_endpoint(&path).is_err());
    std::fs::write(&file, vec![0u8; 16385]).unwrap();
    assert!(load_endpoint(&path).is_err());
}
