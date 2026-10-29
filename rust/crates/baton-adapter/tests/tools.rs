use baton_adapter::tools::{definitions, parse};
use serde_json::json;
#[test]
fn all_tool_parameters_are_checked_before_dispatch() {
    let valid = json!({"session_id":"1".repeat(32),"control_epoch":1,"stream_id":"2".repeat(32),"cursor":0,"limit":32768,"wait_ms":10000});
    assert!(parse("read_output", valid.as_object().cloned()).is_ok());
    for key in [
        "session_id",
        "control_epoch",
        "stream_id",
        "cursor",
        "limit",
        "wait_ms",
    ] {
        let mut missing = valid.as_object().unwrap().clone();
        missing.remove(key);
        assert!(parse("read_output", Some(missing)).is_err());
    }
    for (key, value) in [
        ("control_epoch", json!(9007199254740992u64)),
        ("limit", json!(32769)),
        ("wait_ms", json!(10001)),
        ("cursor", json!(-1)),
        ("stream_id", json!("bad")),
    ] {
        let mut invalid = valid.as_object().unwrap().clone();
        invalid.insert(key.into(), value);
        assert!(parse("read_output", Some(invalid)).is_err());
    }
    let mut args = json!({"session_id":"1".repeat(32),"control_epoch":1,"request_id":"2".repeat(32),"reason":"need\ncontrol"});
    assert!(parse("request_user_control", args.as_object().cloned()).is_err());
    args["reason"] = json!("인증 필요");
    assert!(parse("request_user_control", args.as_object().cloned()).is_ok());
    assert_eq!(definitions().len(), 5);
}

#[test]
fn invalid_request_ids_report_facts_without_echoing_input() {
    for tool in ["send_text", "send_key", "request_user_control"] {
        for (value, length, kind) in [
            (
                json!("a1b2c3d4e5f60718293a4b5c6d7e8f9"),
                json!(31),
                "string",
            ),
            (json!("sensitive-non-hex"), json!(17), "string"),
            (json!("한".repeat(32)), json!(32), "string"),
            (json!(123), json!(null), "number"),
            (json!(null), json!(null), "null"),
        ] {
            let args = json!({"session_id":"1".repeat(32),"control_epoch":1,"request_id":value});
            let error = parse(tool, args.as_object().cloned()).unwrap_err();
            assert_eq!(error.message, "invalid_arguments");
            let details = error.data.unwrap();
            assert_eq!(details["field"], "request_id");
            assert_eq!(details["actual_length"], length);
            assert_eq!(details["actual_type"], kind);
            assert_eq!(details["dispatched"], false);
            assert!(!details.to_string().contains("sensitive-non-hex"));
        }
    }
}
