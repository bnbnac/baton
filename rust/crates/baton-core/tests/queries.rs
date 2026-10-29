use baton_core::*;
use std::time::Duration;
mod support;
#[test]
fn remote_close_drains_received_frames_without_restoring_control() {
    let (mut s, v) = session();
    s.receive(&vec![b'x'; 65536]).unwrap();
    let first = s.next_ui_frame(v).unwrap().unwrap();
    s.receive(b"FINAL_RESULT\r\n\x1b[6n").unwrap();
    s.close(CloseReason::RemoteClosed);
    assert_eq!(s.snapshot().state, State::Closed);
    assert_eq!(s.usage().ui_bytes, 65554);
    let foreign = ViewBinding {
        generation: ViewId::from_u128(99),
        ..v
    };
    assert_eq!(s.next_ui_frame(foreign), Err(CoreError::StaleView));
    assert!(s.next_ui_frame(v).unwrap().is_none());
    s.ack_ui_frame(v, first.seq).unwrap();
    let last = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(last.bytes, b"FINAL_RESULT\r\n\x1b[6n");
    assert!(last.queries.is_empty());
    assert_eq!(s.receive(b"late"), Err(CoreError::SessionClosed));
    assert_eq!(
        s.prepare_reply(ReplyCall {
            binding: v,
            epoch: s.snapshot().epoch,
            query: QueryId(SafeInt::new(1).unwrap()),
            kind: QueryKind::Dsr,
            row: None,
            column: None
        }),
        Err(CoreError::SessionClosed)
    );
    s.ack_ui_frame(v, last.seq).unwrap();
    assert_eq!(s.usage().ui_bytes, 0);
    assert_eq!(s.next_ui_frame(v), Err(CoreError::SessionClosed));
}

#[test]
fn first_view_can_render_a_remote_closed_shell_but_cannot_rebind_it() {
    let mut s = Session::new(SessionId::from_u128(1));
    s.connected().unwrap();
    s.receive(b"LOGIN_FINAL\r\n").unwrap();
    s.close(CloseReason::RemoteClosed);
    let v = s.bind_view(ViewId::from_u128(2)).unwrap();
    assert_eq!(
        s.next_ui_frame(v).unwrap().unwrap().bytes,
        b"LOGIN_FINAL\r\n"
    );
    assert_eq!(s.bind_view(ViewId::from_u128(3)), Err(CoreError::StaleView));
}
fn session() -> (Session, ViewBinding) {
    let mut s = Session::new(SessionId::from_u128(1));
    s.connected().unwrap();
    let view = s.bind_view(ViewId::from_u128(2));
    assert!(view.is_ok());
    (s, view.unwrap())
}
#[test]
fn frame_split_and_unicode_prefix_preserve_query_final_byte() {
    let (mut s, v) = session();
    let mut bytes = vec![b'x'; 65534];
    bytes.extend_from_slice(b"\x1b[5n");
    s.receive(&bytes).unwrap();
    let first = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(first.bytes.len(), 65536);
    assert!(first.queries.is_empty());
    assert!(s.next_ui_frame(v).unwrap().is_none());
    s.ack_ui_frame(v, first.seq).unwrap();
    let second = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(second.bytes, b"5n");
    assert_eq!(second.queries[0].end_offset, 1);
    assert_eq!(
        s.prepare_reply(reply(v, &second.queries[0])).unwrap(),
        b"\x1b[0n"
    );
    let bytes = "한😀\x1b[005n\x1b[000c".as_bytes();
    for split in 0..=bytes.len() {
        let (mut s, v) = session();
        let mut kinds = vec![];
        for part in [&bytes[..split], &bytes[split..]] {
            s.receive(part).unwrap();
            while let Some(f) = s.next_ui_frame(v).unwrap() {
                kinds.extend(f.queries.iter().map(|q| q.kind));
                s.ack_ui_frame(v, f.seq).unwrap();
            }
        }
        assert_eq!(kinds, vec![QueryKind::Dsr, QueryKind::Da]);
    }
}
fn reply(view: ViewBinding, q: &QueryMark) -> ReplyCall {
    ReplyCall {
        binding: view,
        epoch: q.epoch,
        query: q.id,
        kind: q.kind,
        row: None,
        column: None,
    }
}
#[test]
fn query_once_foreign_kind_coordinates_and_expiry() {
    let (mut s, v) = session();
    s.receive(b"\x1b[5n\x1b[6n\x1b[c").unwrap();
    let f = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(f.queries.len(), 3);
    let q = &f.queries[0];
    let mut wrong = reply(v, q);
    wrong.binding.generation = ViewId::from_u128(3);
    assert_eq!(s.prepare_reply(wrong), Err(CoreError::StaleView));
    let mut wrong = reply(v, q);
    wrong.kind = QueryKind::Da;
    assert_eq!(s.prepare_reply(wrong), Err(CoreError::WrongQueryKind));
    assert_eq!(s.prepare_reply(reply(v, q)).unwrap(), b"\x1b[0n");
    assert_eq!(s.prepare_reply(reply(v, q)), Err(CoreError::UnknownQuery));
    let mut cpr = reply(v, &f.queries[1]);
    cpr.row = Some(200);
    cpr.column = Some(502);
    assert_eq!(
        s.prepare_reply(cpr.clone()),
        Err(CoreError::InvalidPosition)
    );
    cpr.column = Some(501);
    assert_eq!(s.prepare_reply(cpr).unwrap(), b"\x1b[200;501R");
    s.tick(Duration::from_millis(2000));
    assert_eq!(
        s.prepare_reply(reply(v, &f.queries[2])),
        Err(CoreError::QueryExpired)
    );
}
#[test]
fn fragments_bind_only_final_bytes_and_do_not_borrow_tokens() {
    let bytes = b"\x1b[06n\x1b[2;3H\x1b[6n";
    for split in 0..=bytes.len() {
        let (mut s, v) = session();
        let mut marks = vec![];
        let mut offset = 0;
        for part in [&bytes[..split], &bytes[split..]] {
            s.receive(part).unwrap();
            while let Some(f) = s.next_ui_frame(v).unwrap() {
                for q in &f.queries {
                    marks.push((q.kind, offset + q.end_offset));
                }
                offset += f.bytes.len();
                s.ack_ui_frame(v, f.seq).unwrap();
            }
        }
        assert_eq!(
            marks,
            vec![(QueryKind::Cpr, 4), (QueryKind::Cpr, 14)],
            "split={split}"
        );
    }
}
#[test]
fn long_and_cancelled_control_sequences_do_not_accumulate_or_forge_queries() {
    let (mut s, v) = session();
    let mut bytes = b"\x1b[".to_vec();
    bytes.extend(vec![b'0'; 10000]);
    bytes.extend_from_slice(b"6n\x1b[5n");
    s.receive(&bytes).unwrap();
    let f = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(
        f.queries.iter().map(|q| q.kind).collect::<Vec<_>>(),
        vec![QueryKind::Dsr]
    );
    s.ack_ui_frame(v, f.seq).unwrap();
    s.receive(b"\x1b]52;c;\x1b[6n\x07\x1bP\x1b[6n\x1b\\\x1b[5n\x1b[6\x18n")
        .unwrap();
    let f = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(
        f.queries.iter().map(|q| q.kind).collect::<Vec<_>>(),
        vec![QueryKind::Cpr, QueryKind::Cpr, QueryKind::Dsr]
    );
}
#[test]
fn transition_invalidates_tokens_and_partial_query_origin_but_preserves_ui() {
    let (mut s, v) = session();
    s.receive(b"PRIVATE\x1b[5n\x1b[").unwrap();
    let f = s.next_ui_frame(v).unwrap().unwrap();
    let old = reply(v, &f.queries[0]);
    let a = ConnectionId::from_u128(9);
    s.handoff(a, StreamId::from_u128(10), Duration::ZERO)
        .unwrap();
    assert_eq!(s.prepare_reply(old), Err(CoreError::StaleControlEpoch));
    s.ack_ui_frame(v, f.seq).unwrap();
    s.receive(b"6n\x1b[5n").unwrap();
    let f = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(f.queries.len(), 1);
    assert_eq!(f.queries[0].kind, QueryKind::Dsr);
    assert_eq!(
        s.prepare_reply(reply(v, &f.queries[0])).unwrap(),
        b"\x1b[0n"
    );
}
#[test]
fn query_limit_closes_only_that_session_and_claimed_replies_still_count() {
    let (mut s, v) = session();
    s.receive(&b"\x1b[5n".repeat(32)).unwrap();
    let f = s.next_ui_frame(v).unwrap().unwrap();
    assert_eq!(f.queries.len(), 32);
    for q in &f.queries {
        assert_eq!(s.prepare_reply(reply(v, q)).unwrap(), b"\x1b[0n");
    }
    assert_eq!(s.receive(b"\x1b[5n"), Err(CoreError::QueryLimit));
    assert_eq!(s.snapshot().state, State::Closed);
    assert_eq!(s.close_reason(), Some(CloseReason::OutputOverload));
}
#[test]
fn view_replacement_closes_but_same_binding_never_replays_a_frame() {
    let (mut s, v) = session();
    s.receive(b"ONCE").unwrap();
    let f = s.next_ui_frame(v).unwrap().unwrap();
    s.ack_ui_frame(v, f.seq).unwrap();
    assert_eq!(s.bind_view(v.generation), Ok(v));
    assert!(s.next_ui_frame(v).unwrap().is_none());
    let mut foreign = v;
    foreign.session = SessionId::from_u128(999);
    assert_eq!(s.ack_ui_frame(foreign, f.seq), Err(CoreError::StaleView));
    assert_eq!(s.bind_view(ViewId::from_u128(3)), Err(CoreError::StaleView));
    assert_eq!(s.snapshot().state, State::Closed);
}
#[tokio::test(start_paused = true)]
async fn queued_user_query_then_handoff_has_no_reply() {
    use support::transport::*;
    let f = RaceFixture::agent().await;
    f.handle.reclaim().await.unwrap();
    let v = f.handle.bind_view(ViewId::from_u128(42)).await.unwrap();
    let mut incoming = Box::pin(f.handle.receive(b"\x1b[6n".to_vec()));
    assert!(poll_once(incoming.as_mut()).await.is_pending());
    f.handle
        .handoff(f.connection, StreamId::from_u128(99))
        .await
        .unwrap();
    incoming.await.unwrap();
    assert!(
        f.handle
            .next_ui_frame(v)
            .await
            .unwrap()
            .unwrap()
            .queries
            .is_empty()
    );
    assert!(f.audit.lock().unwrap().started.is_empty());
    f.runtime.shutdown().await;
}
