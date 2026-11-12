use baton_ipc::{AgentKey, AgentRequest, CONTRACT_VERSION};
use serde_json::json;

const HYPHENATED: &str = "3f39e1c4-70c2-475e-b0e7-b5891a42f330";

#[test]
fn contract_version_is_three() {
    assert_eq!(CONTRACT_VERSION, 3);
}

#[test]
fn parses_hyphenated_and_plain_hex_case_insensitively() {
    let upper = AgentKey::parse("3F39E1C4-70C2-475E-B0E7-B5891A42F330").unwrap();
    let plain = AgentKey::parse("3f39e1c470c2475eb0e7b5891a42f330").unwrap();
    let mixed = AgentKey::parse("3f39E1c4-70c2-475e-B0e7-b5891a42f330").unwrap();
    assert_eq!(upper, plain);
    assert_eq!(upper, mixed);
    assert_eq!(upper.as_u128(), 0x3f39e1c470c2475eb0e7b5891a42f330);
    assert_eq!(AgentKey::from_u128(upper.as_u128()), upper);
}

#[test]
fn rejects_malformed_keys() {
    for text in [
        "",
        "3f39e1c4-70c2-475e-b0e7-b5891a42f33",
        "3f39e1c4-70c2-475e-b0e7-b5891a42f3300",
        "3f39e1c4-70c2-475e-b0e7-b5891a42f33g",
        "{3f39e1c4-70c2-475e-b0e7-b5891a42f330}",
        "3f39e1c470c2-475e-b0e7-b5891a42f330",
        "3f39e1c470c2475eb0e7b5891a42f33",
        "00000000-0000-0000-0000-000000000000",
        "00000000000000000000000000000000",
    ] {
        assert!(AgentKey::parse(text).is_none(), "accepted {text:?}");
    }
}

#[test]
fn serializes_as_lowercase_hyphenated() {
    let key = AgentKey::parse("3F39E1C470C2475EB0E7B5891A42F330").unwrap();
    assert_eq!(serde_json::to_value(key).unwrap(), json!(HYPHENATED));
    let back: AgentKey = serde_json::from_value(json!(HYPHENATED)).unwrap();
    assert_eq!(back, key);
    assert!(serde_json::from_value::<AgentKey>(json!("not-a-uuid")).is_err());
}

#[test]
fn agent_request_requires_agent_key() {
    assert!(serde_json::from_value::<AgentRequest>(json!({"method": "status"})).is_err());
    let status: AgentRequest =
        serde_json::from_value(json!({"method": "status", "agent_key": HYPHENATED})).unwrap();
    assert_eq!(status.agent_key(), AgentKey::parse(HYPHENATED).unwrap());
    let send = json!({
        "method": "send_text",
        "session_id": "11111111111111111111111111111111",
        "control_epoch": 1,
        "request_id": "22222222222222222222222222222222",
        "text": "x"
    });
    assert!(serde_json::from_value::<AgentRequest>(send.clone()).is_err());
    let mut keyed = send;
    keyed["agent_key"] = json!(HYPHENATED);
    let request: AgentRequest = serde_json::from_value(keyed).unwrap();
    assert_eq!(request.agent_key(), AgentKey::parse(HYPHENATED).unwrap());
}
