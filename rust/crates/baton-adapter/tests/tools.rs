use baton_adapter::tools::{definitions, parse};
use baton_ipc::AgentKey;
use serde_json::json;

const KEY: &str = "3f39e1c4-70c2-475e-b0e7-b5891a42f330";

#[test]
fn all_tool_parameters_are_checked_before_dispatch() {
    let valid = json!({"agent_key":KEY,"session_id":"1".repeat(32),"control_epoch":1,"stream_id":"2".repeat(32),"cursor":0,"limit":32768,"wait_ms":10000});
    assert!(parse("read_output", valid.as_object().cloned()).is_ok());
    for key in [
        "agent_key",
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
    let mut args = json!({"agent_key":KEY,"session_id":"1".repeat(32),"control_epoch":1,"request_id":"2".repeat(32),"reason":"need\ncontrol"});
    assert!(parse("request_user_control", args.as_object().cloned()).is_err());
    args["reason"] = json!("인증 필요");
    assert!(parse("request_user_control", args.as_object().cloned()).is_ok());
    assert_eq!(definitions().len(), 6);
}

#[test]
fn connection_name_is_validated_before_dispatch() {
    let ok = |name: serde_json::Value| {
        parse(
            "set_connection_name",
            json!({"agent_key":KEY,"name":name}).as_object().cloned(),
        )
        .is_ok()
    };
    assert!(ok(json!("MCP 세션 이름")));
    assert!(ok(json!("a".repeat(64))));
    assert!(!ok(json!("a".repeat(65))));
    assert!(!ok(json!("   ")));
    assert!(!ok(json!("two\nlines")));
    assert!(!ok(json!("\u{200B}\u{200B}")));
    assert!(!ok(json!("세션\u{202E}A")));
    assert!(!ok(json!("a\u{FEFF}b")));
    for blank in [
        "\u{3164}",
        "\u{115F}\u{1160}",
        "\u{FFA0}",
        "\u{2800}",
        "a\u{2028}b",
    ] {
        assert!(!ok(json!(blank)), "{blank:?}");
    }
    assert!(ok(json!("⚠\u{FE0F} 배포")));
    assert!(!ok(json!(7)));
    assert!(parse("set_connection_name", None).is_err());
    assert!(
        parse(
            "set_connection_name",
            json!({"agent_key":KEY,"name":"x","extra":1}).as_object().cloned()
        )
        .is_err()
    );
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
            let args = json!({"agent_key":KEY,"session_id":"1".repeat(32),"control_epoch":1,"request_id":value});
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

fn arguments_for(tool: &str) -> serde_json::Map<String, serde_json::Value> {
    let ids = json!({"session_id":"1".repeat(32),"control_epoch":1});
    let value = match tool {
        "status" => json!({}),
        "set_connection_name" => json!({"name":"서버 점검"}),
        "read_output" => json!({"session_id":"1".repeat(32),"control_epoch":1,"stream_id":"2".repeat(32),"cursor":0,"limit":2,"wait_ms":0}),
        "send_text" => {
            json!({"session_id":ids["session_id"],"control_epoch":1,"request_id":"3".repeat(32),"text":"x"})
        }
        "send_key" => {
            json!({"session_id":ids["session_id"],"control_epoch":1,"request_id":"3".repeat(32),"key":"Enter"})
        }
        "request_user_control" => {
            json!({"session_id":ids["session_id"],"control_epoch":1,"request_id":"3".repeat(32),"reason":"need"})
        }
        other => panic!("unknown tool {other}"),
    };
    value.as_object().cloned().unwrap()
}

const TOOLS: [&str; 6] = [
    "status",
    "set_connection_name",
    "read_output",
    "send_text",
    "send_key",
    "request_user_control",
];

#[test]
fn instructions_cover_the_agent_key_rules() {
    let text = baton_adapter::policy::INSTRUCTIONS;
    for needle in [
        "contract_version 3",
        "Send agent_key on every call",
        "random UUID",
        "same key",
        "agent_key_required",
        "As soon as Baton comes up",
        "set_connection_name",
        "sudo -n",
        "request_user_control",
    ] {
        assert!(text.contains(needle), "instructions lack {needle:?}");
    }
}

#[test]
fn instructions_tell_that_shells_belong_to_the_key_and_survive_a_reconnect() {
    let text = baton_adapter::policy::INSTRUCTIONS;
    for stale in [
        "inspect status for the new connection_id",
        "hand off a session to the new connection",
        "handed to its authenticated connection",
    ] {
        assert!(!text.contains(stale), "stale wording remains: {stale:?}");
    }
    for needle in [
        "handed to your agent_key",
        "belong to your agent_key",
        "still yours",
        "An app restart",
    ] {
        assert!(text.contains(needle), "instructions lack {needle:?}");
    }
    let status = definitions()
        .into_iter()
        .find(|tool| tool.name == "status")
        .unwrap();
    assert!(status.description.as_deref().unwrap_or("").contains("agent_key"));
}

#[test]
fn every_tool_requires_agent_key() {
    for tool in TOOLS {
        let mut without = arguments_for(tool);
        let error = parse(tool, Some(without.clone())).unwrap_err();
        assert_eq!(error.message, "agent_key_required", "{tool}");
        let details = error.data.unwrap();
        assert_eq!(details["field"], "agent_key");
        assert_eq!(details["dispatched"], false);
        without.insert("agent_key".into(), json!(KEY));
        assert!(parse(tool, Some(without)).is_ok(), "{tool} with key");
    }
}

#[test]
fn agent_key_error_never_echoes_the_value() {
    for (value, kind) in [
        (json!("SECRET-not-a-uuid"), "string"),
        (json!("00000000-0000-0000-0000-000000000000"), "string"),
        (json!(42), "number"),
        (json!(null), "null"),
    ] {
        let mut args = arguments_for("status");
        args.insert("agent_key".into(), value);
        let error = parse("status", Some(args)).unwrap_err();
        assert_eq!(error.message, "agent_key_required");
        let details = error.data.unwrap();
        assert_eq!(details["actual_type"], kind);
        let text = details.to_string();
        assert!(!text.contains("SECRET"));
        assert!(!text.contains("0000-0000"));
    }
}

#[test]
fn agent_key_is_accepted_in_both_notations() {
    let expected = AgentKey::parse(KEY).unwrap();
    for text in [KEY, "3f39e1c470c2475eb0e7b5891a42f330", "3F39E1C4-70C2-475E-B0E7-B5891A42F330"] {
        let mut args = arguments_for("status");
        args.insert("agent_key".into(), json!(text));
        let request = parse("status", Some(args)).unwrap();
        assert_eq!(request.agent_key(), expected, "{text}");
    }
}

#[test]
fn all_definitions_list_agent_key_as_required() {
    for tool in definitions() {
        let schema = tool.input_schema.as_ref();
        assert!(
            schema["properties"].get("agent_key").is_some(),
            "{} lacks agent_key property",
            tool.name
        );
        let required: Vec<&str> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert!(required.contains(&"agent_key"), "{} does not require it", tool.name);
    }
}
