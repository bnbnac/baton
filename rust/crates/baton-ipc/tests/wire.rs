use baton_core::{CoreError, SafeInt, SessionId};
use baton_ipc::*;
use serde_json::{Value, json};
use std::{
    io,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, ReadBuf};

fn id() -> &'static str {
    "0123456789abcdef0123456789abcdef"
}
fn request() -> Value {
    json!({"method":"send_text","session_id":id(),"control_epoch":1,"request_id":id(),"text":"hello\n"})
}
fn frame(body: Value) -> Vec<u8> {
    let payload = serde_json::to_vec(&body).unwrap();
    let mut bytes = (payload.len() as u32).to_le_bytes().to_vec();
    bytes.extend(payload);
    bytes
}
struct HeaderOnly {
    bytes: [u8; 4],
    position: usize,
}
impl AsyncRead for HeaderOnly {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        assert!(self.position < 4, "oversized frame attempted body read");
        let count = (4 - self.position).min(buf.remaining());
        buf.put_slice(&self.bytes[self.position..self.position + count]);
        self.position += count;
        Poll::Ready(Ok(()))
    }
}
#[tokio::test]
async fn frame_limit_before_allocation() {
    for length in [0u32, 262145, u32::MAX] {
        let mut input = HeaderOnly {
            bytes: length.to_le_bytes(),
            position: 0,
        };
        assert_eq!(
            read_frame(&mut input).await.unwrap_err().code,
            ErrorCode::InvalidFrame
        );
    }
}
#[tokio::test]
async fn exact_frame_limit_and_coalesced_frames() {
    let mut exact = frame(json!({"type":"cancel","id":7}));
    exact.resize(4 + MAX_FRAME_BYTES, b' ');
    exact[..4].copy_from_slice(&(MAX_FRAME_BYTES as u32).to_le_bytes());
    exact.extend(frame(json!({"type":"cancel","id":8})));
    let mut input = exact.as_slice();
    assert!(matches!(read_frame(&mut input).await.unwrap(),Frame::Cancel{id} if id.get()==7));
    assert!(matches!(read_frame(&mut input).await.unwrap(),Frame::Cancel{id} if id.get()==8));
    assert!(input.is_empty());
}
#[tokio::test]
async fn partial_frame_eof() {
    let valid = frame(json!({"type":"request","id":1,"body":request()}));
    for end in 0..valid.len() {
        assert!(
            read_frame(&mut &valid[..end]).await.is_err(),
            "prefix {end} accepted"
        );
    }
    assert!(read_frame(&mut valid.as_slice()).await.is_ok());
}
#[test]
fn strict_ids_numbers() {
    for value in [
        "a".repeat(31),
        "a".repeat(33),
        "g".repeat(32),
        "é".repeat(16),
    ] {
        assert!(serde_json::from_value::<WireId>(json!(value)).is_err());
    }
    let upper = serde_json::from_value::<WireId>(json!(id().to_uppercase())).unwrap();
    assert_eq!(serde_json::to_value(upper).unwrap(), json!(id()));
    let core = SessionId::from_u128(upper.as_u128());
    assert_eq!(core.as_u128(), upper.as_u128());
    for value in [
        json!(-1),
        json!(1.5),
        json!(9007199254740992u64),
        json!("1"),
        json!(null),
    ] {
        let mut req = request();
        req["control_epoch"] = value;
        assert!(serde_json::from_value::<AgentRequest>(req).is_err());
    }
    for field in ["session_id", "control_epoch", "request_id", "text"] {
        let mut req = request();
        req.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<AgentRequest>(req).is_err());
    }
    let mut req = request();
    req["owner"] = json!(id());
    assert!(serde_json::from_value::<AgentRequest>(req).is_err());
}
#[test]
fn strict_request_variants() {
    for value in [
        json!({"method":"status","owner":id()}),
        json!({"method":"reclaim"}),
        json!({"method":"send_key","session_id":id(),"control_epoch":1,"request_id":id(),"key":"F1"}),
    ] {
        assert!(serde_json::from_value::<AgentRequest>(value).is_err());
    }
    let mut read = json!({"method":"read_output","session_id":id(),"control_epoch":1,"stream_id":id(),"cursor":0,"limit":2,"wait_ms":0});
    assert!(serde_json::from_value::<AgentRequest>(read.clone()).is_ok());
    read.as_object_mut().unwrap().remove("stream_id");
    assert!(serde_json::from_value::<AgentRequest>(read).is_err());
}
#[tokio::test]
async fn request_bounds_on_wire() {
    for (count, ok) in [(16384, true), (16385, false)] {
        let mut req = request();
        req["text"] = json!("x".repeat(count));
        assert_eq!(
            read_frame(&mut frame(json!({"type":"request","id":0,"body":req})).as_slice())
                .await
                .is_ok(),
            ok
        );
    }
    for reason in ["\n", "\u{7f}", "\u{85}"] {
        let req = json!({"method":"request_user_control","session_id":id(),"control_epoch":0,"request_id":id(),"reason":reason});
        assert!(
            read_frame(&mut frame(json!({"type":"request","id":0,"body":req})).as_slice())
                .await
                .is_err()
        );
    }
    for (limit, wait, ok) in [
        (1, 0, false),
        (2, 0, true),
        (32768, 10000, true),
        (32769, 0, false),
        (2, 10001, false),
    ] {
        let req = json!({"method":"read_output","session_id":id(),"control_epoch":0,"stream_id":id(),"cursor":0,"limit":limit,"wait_ms":wait});
        assert_eq!(
            read_frame(&mut frame(json!({"type":"request","id":0,"body":req})).as_slice())
                .await
                .is_ok(),
            ok
        );
    }
}
#[tokio::test]
async fn malformed_json_has_safe_errors() {
    let bodies = [
        b"{secret:supersecret}".to_vec(),
        vec![0xff],
        b"{\"type\":\"cancel\",\"id\":1,\"id\":2}".to_vec(),
        format!("{}0{}", "[".repeat(150), "]".repeat(150)).into_bytes(),
    ];
    for body in bodies {
        let mut input = (body.len() as u32).to_le_bytes().to_vec();
        input.extend(body);
        let err = read_frame(&mut input.as_slice()).await.unwrap_err();
        assert_eq!(
            serde_json::to_value(err).unwrap(),
            json!({"code":"invalid_frame"})
        );
    }
}
#[tokio::test]
async fn exclusive_response_outcomes() {
    for value in [
        json!({"type":"response","id":1}),
        json!({"type":"response","id":1,"result":{"kind":"input","result":"delivered"},"error":{"code":"not_owner"}}),
    ] {
        assert!(read_frame(&mut frame(value).as_slice()).await.is_err());
    }
}
#[tokio::test]
async fn escaped_output_fits() {
    let result = AgentResponse::Output(OutputPage {
        text: "\u{1}".repeat(32768),
        next_cursor: SafeInt::new(32768).unwrap(),
        oldest_cursor: SafeInt::new(0).unwrap(),
        end_cursor: SafeInt::new(32768).unwrap(),
        has_more: false,
    });
    let f = Frame::success(SafeInt::new(1).unwrap(), result);
    let mut out = Vec::new();
    write_frame(&mut out, &f).await.unwrap();
    assert!(out.len() <= MAX_FRAME_BYTES + 4);
    assert!(!out[4..].contains(&1));
    assert_eq!(read_frame(&mut out.as_slice()).await.unwrap(), f);
}
#[tokio::test]
async fn bounded_writer_never_emits_partial_frame_on_validation_failure() {
    let response = AgentResponse::Output(OutputPage {
        text: "x".repeat(MAX_FRAME_BYTES + 1),
        next_cursor: SafeInt::new(0).unwrap(),
        oldest_cursor: SafeInt::new(0).unwrap(),
        end_cursor: SafeInt::new(0).unwrap(),
        has_more: false,
    });
    let mut out = Vec::new();
    assert!(
        write_frame(
            &mut out,
            &Frame::success(SafeInt::new(0).unwrap(), response)
        )
        .await
        .is_err()
    );
    assert!(out.is_empty());
}
#[test]
fn explicit_core_error_mapping() {
    assert_eq!(
        WireError::from(CoreError::NotOwner).code,
        ErrorCode::NotOwner
    );
    assert_eq!(
        serde_json::to_value(WireError::from(CoreError::CursorExpired {
            oldest: SafeInt::new(7).unwrap()
        }))
        .unwrap(),
        json!({"code":"cursor_expired","oldest_cursor":7})
    );
}
