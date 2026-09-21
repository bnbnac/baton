use baton_core::*;
use std::time::Duration;
mod support;
use support::*;
fn n(value: u64) -> SafeInt {
    SafeInt::new(value).unwrap()
}
fn read(
    s: &Session,
    a: ConnectionId,
    stream: StreamId,
    cursor: u64,
) -> Result<ReadPage, CoreError> {
    s.read(&ReadCall {
        connection: a,
        epoch: s.snapshot().epoch,
        stream,
        cursor: n(cursor),
        limit: 32768,
    })
}
fn drain_ui(s: &mut Session) -> Vec<u8> {
    let mut bytes = Vec::new();
    while let Some(chunk) = s.next_ui_chunk() {
        bytes.extend_from_slice(&chunk.bytes);
        s.ack_ui(chunk.seq).unwrap();
    }
    bytes
}
#[test]
fn all_utf8_splits_keep_utf16_cursor() {
    let bytes = "한😀글".as_bytes();
    for split in 0..=bytes.len() {
        let mut o = PublicOutput::new(32).unwrap();
        o.receive(&bytes[..split]).unwrap();
        o.receive(&bytes[split..]).unwrap();
        let page = o.read(n(0), 32).unwrap();
        assert_eq!(page.text, "한😀글");
        assert_eq!(page.next, n(4));
        assert_eq!(o.read(n(2), 32), Err(CoreError::InvalidCursor));
    }
}
#[test]
fn malformed_utf8_and_ansi_are_packet_independent_data() {
    let cases: Vec<(&[u8], &str)> = vec![
        (&[0xf0, 0x28, 0x8c, 0xbc], "�(��"),
        (&[0xc0, 0xaf], "��"),
        (&[0xe2, 0x82, b'A'], "�A"),
        (&[0xed, 0xa0, 0x80], "���"),
        (&[0xf4, 0x90, 0x80, 0x80], "����"),
        (b"\x1b[31mTEXT\x1b[0m", "\x1b[31mTEXT\x1b[0m"),
        (&[b'A', 0xf0, 0x9f], "A"),
    ];
    for (bytes, want) in cases {
        for first in 0..=bytes.len() {
            for second in first..=bytes.len() {
                let mut o = PublicOutput::new(100).unwrap();
                for part in [&bytes[..first], &bytes[first..second], &bytes[second..]] {
                    o.receive(part).unwrap();
                }
                assert_eq!(
                    o.read(n(0), 100).unwrap().text,
                    want,
                    "splits {first}/{second}"
                );
            }
        }
    }
}
#[test]
fn public_history_never_comes_from_ui_and_reemitted_private_text_is_public() {
    let mut s = Session::new(SessionId::from_u128(1));
    s.connected().unwrap();
    let a = ConnectionId::from_u128(2);
    let first = StreamId::from_u128(3);
    let second = StreamId::from_u128(4);
    s.receive(b"P").unwrap();
    s.handoff(a, first, Duration::ZERO).unwrap();
    s.receive(b"Q").unwrap();
    assert_eq!(read(&s, a, first, 0).unwrap().text, "Q");
    let old_epoch = s.snapshot().epoch;
    s.reclaim(Duration::ZERO).unwrap();
    s.receive(b"R").unwrap();
    assert_eq!(read(&s, a, first, 0), Err(CoreError::ControlUnavailable));
    s.handoff(a, second, Duration::ZERO).unwrap();
    assert_eq!(read(&s, a, second, 0).unwrap().text, "");
    assert_eq!(
        s.read(&ReadCall {
            connection: a,
            epoch: old_epoch,
            stream: first,
            cursor: n(0),
            limit: 32
        }),
        Err(CoreError::StaleControlEpoch)
    );
    assert_eq!(read(&s, a, first, 0), Err(CoreError::StaleStream));
    assert_eq!(
        read(&s, ConnectionId::from_u128(999), second, 0),
        Err(CoreError::NotOwner)
    );
    assert_eq!(drain_ui(&mut s), b"PQR");
    s.receive(b"P").unwrap();
    assert_eq!(read(&s, a, second, 0).unwrap().text, "P");
}
#[test]
fn decoder_carry_never_crosses_handoff_or_reclaim() {
    let bytes = "한😀".as_bytes();
    for split in 1..bytes.len() {
        let (mut s, a, _, first) = agent_session();
        s.receive(&bytes[..split]).unwrap();
        s.reclaim(Duration::ZERO).unwrap();
        let second = StreamId::from_u128(999);
        s.handoff(a, second, Duration::ZERO).unwrap();
        s.receive(&bytes[split..]).unwrap();
        let expected = String::from_utf8_lossy(&bytes[split..]);
        assert_eq!(read(&s, a, second, 0).unwrap().text, expected);
        assert_eq!(read(&s, a, first, 0), Err(CoreError::StaleStream));
        assert_eq!(drain_ui(&mut s), bytes);
    }
}
#[test]
fn ring_overwrite_preserves_scalars_and_classifies_cursors() {
    let mut o = PublicOutput::new(2).unwrap();
    o.receive("😀A".as_bytes()).unwrap();
    assert_eq!(
        o.read(n(0), 2),
        Err(CoreError::CursorExpired { oldest: n(2) })
    );
    let p = o.read(n(2), 2).unwrap();
    assert_eq!(p.text, "A");
    assert_eq!(p.end, n(3));
    assert_eq!(o.read(n(4), 2), Err(CoreError::InvalidCursor));
    assert_eq!(o.read(n(3), 2).unwrap().text, "");
    for limit in [0, 1, 32769] {
        assert_eq!(o.read(n(2), limit), Err(CoreError::InvalidLimit));
    }
    assert!(matches!(PublicOutput::new(1), Err(CoreError::InvalidLimit)));
    assert!(matches!(
        PublicOutput::new(1048577),
        Err(CoreError::InvalidLimit)
    ));
}
#[test]
fn pages_always_progress_without_splitting_emoji() {
    let mut o = PublicOutput::new(100).unwrap();
    o.receive("A😀한😀B".as_bytes()).unwrap();
    let mut cursor = n(0);
    let mut text = String::new();
    for expected in ["A", "😀", "한", "😀", "B"] {
        let p = o.read(cursor, 2).unwrap();
        assert_eq!(p.text, expected);
        assert!(p.next > cursor);
        cursor = p.next;
        text.push_str(&p.text);
    }
    assert_eq!(text, "A😀한😀B");
    assert!(!o.read(cursor, 2).unwrap().has_more);
}
#[test]
fn ui_backpressure_preserves_every_byte_and_rejects_ack_replay() {
    let (mut s, _, _, _) = agent_session();
    s.receive(&vec![b'x'; 131073]).unwrap();
    let first = s.next_ui_chunk().unwrap();
    assert_eq!(first.bytes.len(), 65536);
    assert!(s.next_ui_chunk().is_none());
    let before = s.usage();
    assert_eq!(
        s.ack_ui(first.seq.checked_next().unwrap()),
        Err(CoreError::InvalidAck)
    );
    assert_eq!(s.usage(), before);
    s.ack_ui(first.seq).unwrap();
    assert_eq!(s.ack_ui(first.seq), Err(CoreError::InvalidAck));
    let rest = drain_ui(&mut s);
    assert_eq!(rest.len(), 65537);
    assert!(rest.iter().all(|b| *b == b'x'));
    assert_eq!(s.usage().ui_bytes, 0);
}
#[test]
fn ui_overload_closes_only_affected_session_and_blocks_input() {
    let (mut s, a, epoch, stream) = agent_session();
    let (mut other, _, _, _) = agent_session();
    s.receive(&vec![b'x'; 1048576]).unwrap();
    assert_eq!(s.usage().ui_bytes, 1048576);
    assert_eq!(s.receive(b"!"), Err(CoreError::Capacity));
    assert_eq!(s.snapshot().state, State::Closed);
    assert_eq!(s.close_reason(), Some(CloseReason::OutputOverload));
    assert_eq!(
        s.submit(agent_call(a, epoch, RequestId::from_u128(1), b"BAD")),
        Err(CoreError::SessionClosed)
    );
    assert_eq!(read(&s, a, stream, 0), Err(CoreError::SessionClosed));
    assert_eq!(s.receive(b"late"), Err(CoreError::SessionClosed));
    assert!(s.next_ui_chunk().is_none());
    other.receive(b"ok").unwrap();
    assert_eq!(other.snapshot().state, State::AgentOwned);
}
#[test]
fn output_during_transition_is_ui_only() {
    let (mut s, a, e, stream) = agent_session();
    s.submit(agent_call(a, e, RequestId::from_u128(1), b"A"))
        .unwrap();
    let op = s.start_write().unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    s.receive(b"PRIVATE").unwrap();
    assert_eq!(read(&s, a, stream, 0), Err(CoreError::ControlUnavailable));
    s.finish_write(op.id, WriteResult::Delivered).unwrap();
    s.handoff(a, StreamId::from_u128(900), Duration::ZERO)
        .unwrap();
    assert_eq!(read(&s, a, StreamId::from_u128(900), 0).unwrap().text, "");
    assert_eq!(drain_ui(&mut s), b"PRIVATE");
}

#[test]
fn full_public_ring_and_max_page_use_utf16_units() {
    let mut o = PublicOutput::new(1048576).unwrap();
    o.receive(&vec![b'x'; 1048576]).unwrap();
    o.receive(b"y").unwrap();
    assert_eq!(
        o.read(n(0), 32768),
        Err(CoreError::CursorExpired { oldest: n(1) })
    );
    let page = o.read(n(1), 32768).unwrap();
    assert_eq!(page.text.len(), 32768);
    assert_eq!(page.next, n(32769));
    assert!(page.has_more);
    assert_eq!(o.read(n(1048576), 2).unwrap().text, "y");
}

#[test]
fn empty_receive_does_not_consume_queue_or_sequence_and_out_of_order_ack_is_rejected() {
    let (mut s, _, _, _) = agent_session();
    for _ in 0..100 {
        s.receive(b"").unwrap();
    }
    assert_eq!(s.usage().ui_bytes, 0);
    assert!(s.next_ui_chunk().is_none());
    s.receive(b"a").unwrap();
    s.receive(b"b").unwrap();
    let first = s.next_ui_chunk().unwrap();
    let second = s.next_ui_chunk().unwrap();
    assert_eq!(first.seq, n(1));
    assert_eq!(second.seq, n(2));
    assert_eq!(s.ack_ui(second.seq), Err(CoreError::InvalidAck));
    assert_eq!(s.usage().ui_bytes, 2);
    s.ack_ui(first.seq).unwrap();
    s.ack_ui(second.seq).unwrap();
    assert_eq!(s.usage().ui_bytes, 0);
}
