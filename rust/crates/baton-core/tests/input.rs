use baton_core::*;
use std::time::Duration;
mod support;
use support::*;
fn request(n: u128) -> RequestId {
    RequestId::from_u128(n)
}

#[test]
fn duplicate_input_has_one_effect_and_conflict_has_none() {
    let (mut s, a, e, _) = agent_session();
    for _ in 0..100 {
        assert_eq!(
            s.submit(agent_call(a, e, request(1), b"ONE")),
            Ok(InputResult::Pending)
        );
    }
    assert_eq!(s.usage().queued, 1);
    assert_eq!(s.usage().history, 1);
    assert_eq!(
        s.submit(agent_call(a, e, request(1), b"OTHER")),
        Err(CoreError::RequestIdConflict)
    );
    let op = s.start_write().unwrap();
    assert_eq!(op.payload, b"ONE");
    assert!(s.start_write().is_none());
    s.finish_write(op.id, WriteResult::Delivered).unwrap();
    assert_eq!(
        s.submit(agent_call(a, e, request(1), b"ONE")),
        Ok(InputResult::Delivered)
    );
    assert!(s.start_write().is_none());
    assert_eq!(
        s.finish_write(op.id, WriteResult::Delivered),
        Err(CoreError::InvalidCompletion)
    );
}
#[test]
fn reclaim_invalidates_unstarted_input() {
    let (mut s, a, e, _) = agent_session();
    s.submit(agent_call(a, e, request(1), b"FIRST")).unwrap();
    s.submit(agent_call(a, e, request(2), b"SECOND")).unwrap();
    let op = s.start_write().unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    assert_eq!(s.snapshot().state, State::Reclaiming);
    assert!(s.start_write().is_none());
    assert_eq!(s.usage().queued, 0);
    let before = s.snapshot();
    assert_eq!(s.reclaim(Duration::ZERO), Err(CoreError::Busy));
    assert_eq!(s.snapshot(), before);
    s.finish_write(op.id, WriteResult::Delivered).unwrap();
    assert_eq!(s.snapshot().state, State::UserOwned);
    assert!(s.start_write().is_none());
    assert_eq!(
        s.input_result(Principal::Agent(a), e, request(2)),
        Err(CoreError::ControlUnavailable)
    );
    assert_eq!(s.usage().history, 0);
}
#[test]
fn handoff_waits_for_active_user_write_and_drops_queued_user_input() {
    let mut s = Session::new(SessionId::from_u128(1));
    s.connected().unwrap();
    let e = s.snapshot().epoch;
    for n in 1..=2 {
        s.submit(InputCall {
            principal: Principal::User,
            epoch: e,
            request_id: request(n),
            payload: vec![n as u8],
        })
        .unwrap();
    }
    let op = s.start_write().unwrap();
    let a = ConnectionId::from_u128(2);
    s.handoff(a, StreamId::from_u128(3), Duration::ZERO)
        .unwrap();
    assert_eq!(s.snapshot().state, State::Transferring);
    assert_eq!(s.snapshot().stream, None);
    assert_eq!(
        s.submit(agent_call(a, s.snapshot().epoch, request(3), b"A")),
        Err(CoreError::ControlUnavailable)
    );
    assert!(s.start_write().is_none());
    s.finish_write(op.id, WriteResult::Delivered).unwrap();
    assert_eq!(s.snapshot().state, State::AgentOwned);
    assert_eq!(s.snapshot().stream, Some(StreamId::from_u128(3)));
    assert!(s.start_write().is_none());
}
#[test]
fn foreign_and_stale_inputs_and_results_have_zero_effect() {
    let (mut s, a, e, _) = agent_session();
    assert_eq!(
        s.submit(agent_call(
            ConnectionId::from_u128(999),
            e,
            request(1),
            b"BAD"
        )),
        Err(CoreError::NotOwner)
    );
    s.submit(agent_call(a, e, request(1), b"OLD")).unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    s.handoff(a, StreamId::from_u128(90), Duration::ZERO)
        .unwrap();
    assert_eq!(
        s.submit(agent_call(a, e, request(1), b"OLD")),
        Err(CoreError::StaleControlEpoch)
    );
    assert_eq!(
        s.input_result(Principal::Agent(a), e, request(1)),
        Err(CoreError::StaleControlEpoch)
    );
    assert_eq!(
        s.submit(InputCall {
            principal: Principal::User,
            epoch: s.snapshot().epoch,
            request_id: request(1),
            payload: b"USER".to_vec()
        }),
        Err(CoreError::ControlUnavailable)
    );
    assert!(s.start_write().is_none());
    assert_eq!(s.usage().history, 0);
}
#[test]
fn payload_and_queue_bounds_admit_no_extra_storage() {
    let (mut s, a, e, _) = agent_session();
    assert_eq!(
        s.submit(agent_call(a, e, request(99), &vec![0; 16385])),
        Err(CoreError::InputTooLarge)
    );
    assert_eq!(s.usage().input_bytes, 0);
    for n in 0..32 {
        s.submit(agent_call(a, e, request(n), &vec![0; 16384]))
            .unwrap();
    }
    let usage = s.usage();
    assert_eq!(usage.input_bytes, 32 * 16384);
    assert_eq!(
        s.submit(agent_call(a, e, request(32), b"EXTRA")),
        Err(CoreError::InputQueueFull)
    );
    assert_eq!(s.usage(), usage);
    s.reclaim(Duration::ZERO).unwrap();
    assert!(s.start_write().is_none());
    assert_eq!(s.usage().queued, 0);
}
#[test]
fn history_limit_does_not_trigger_automatic_transition() {
    let (mut s, a, e, _) = agent_session();
    for n in 0..4096 {
        s.submit(agent_call(a, e, request(n), b"x")).unwrap();
        let op = s.start_write().unwrap();
        s.finish_write(op.id, WriteResult::Delivered).unwrap();
    }
    let before = s.snapshot();
    let usage = s.usage();
    assert_eq!(
        s.submit(agent_call(a, e, request(4096), b"x")),
        Err(CoreError::RequestHistoryFull)
    );
    assert_eq!(s.snapshot(), before);
    assert_eq!(s.usage(), usage);
    assert_eq!(
        s.submit(agent_call(a, e, request(0), b"x")),
        Ok(InputResult::Delivered)
    );
    assert!(s.start_write().is_none());
}
#[test]
fn cancellation_distinguishes_queued_active_and_finished() {
    let (mut s, a, e, _) = agent_session();
    s.submit(agent_call(a, e, request(1), b"CANCEL")).unwrap();
    assert_eq!(
        s.cancel_input(Principal::Agent(a), e, request(1)),
        Ok(InputResult::InputInvalidated)
    );
    assert!(s.start_write().is_none());
    assert_eq!(
        s.submit(agent_call(a, e, request(1), b"CANCEL")),
        Ok(InputResult::InputInvalidated)
    );
    s.submit(agent_call(a, e, request(2), b"ACTIVE")).unwrap();
    let op = s.start_write().unwrap();
    assert_eq!(
        s.cancel_input(Principal::Agent(a), e, request(2)),
        Ok(InputResult::Pending)
    );
    s.finish_write(op.id, WriteResult::Uncertain).unwrap();
    assert_eq!(
        s.cancel_input(Principal::Agent(a), e, request(2)),
        Ok(InputResult::Uncertain)
    );
    assert_eq!(
        s.input_result(Principal::Agent(a), e, request(2)),
        Ok(InputResult::Uncertain)
    );
    assert!(s.start_write().is_none());
    assert_eq!(
        s.cancel_input(Principal::Agent(a), e, request(100)),
        Err(CoreError::UnknownId)
    );
}
#[test]
fn transition_deadline_closes_and_late_completion_never_restarts() {
    let (mut s, a, e, _) = agent_session();
    s.submit(agent_call(a, e, request(1), b"ACTIVE")).unwrap();
    let op = s.start_write().unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    s.tick(Duration::from_millis(4999));
    assert_eq!(s.snapshot().state, State::Reclaiming);
    s.tick(Duration::from_millis(5000));
    assert_eq!(s.snapshot().state, State::Closed);
    assert_eq!(s.close_reason(), Some(CloseReason::TransitionTimeout));
    assert_eq!(
        s.finish_write(op.id, WriteResult::Delivered),
        Err(CoreError::InvalidCompletion)
    );
    assert!(s.start_write().is_none());
    assert_eq!(s.usage().active, 0);
}
#[test]
fn wrong_completion_does_not_release_inflight_or_transition() {
    let (mut s, a, e, _) = agent_session();
    s.submit(agent_call(a, e, request(1), b"A")).unwrap();
    let op = s.start_write().unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    assert_eq!(
        s.finish_write(op.id.checked_next().unwrap(), WriteResult::Delivered),
        Err(CoreError::InvalidCompletion)
    );
    assert_eq!(s.snapshot().state, State::Reclaiming);
    assert_eq!(s.usage().active, 1);
    s.close(CloseReason::User);
    assert_eq!(
        s.finish_write(op.id, WriteResult::Uncertain),
        Err(CoreError::InvalidCompletion)
    );
    assert!(s.start_write().is_none());
}
#[test]
fn reconnecting_assignment_never_reuses_write_sequence() {
    let (mut s, a, e, _) = agent_session();
    s.submit(agent_call(a, e, request(1), b"A")).unwrap();
    let first = s.start_write().unwrap();
    s.finish_write(first.id, WriteResult::Delivered).unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    s.handoff(a, StreamId::from_u128(99), Duration::ZERO)
        .unwrap();
    s.submit(agent_call(a, s.snapshot().epoch, request(1), b"B"))
        .unwrap();
    let second = s.start_write().unwrap();
    assert!(second.id > first.id);
}
#[test]
fn disconnect_during_reclaim_keeps_user_target_but_during_handoff_closes() {
    let mut r = Registry::new(AppId::from_u128(1));
    let a = ConnectionId::from_u128(2);
    r.register_connection(a).unwrap();
    let (mut s, _, _, _) = agent_session();
    s.reclaim(Duration::ZERO).unwrap();
    let id = s.id();
    s.handoff(a, StreamId::from_u128(5), Duration::ZERO)
        .unwrap();
    let e = s.snapshot().epoch;
    s.submit(agent_call(a, e, request(1), b"A")).unwrap();
    let op = s.start_write().unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    r.insert_session(s).unwrap();
    r.disconnect(a);
    let s = r.session_mut(id).unwrap();
    assert_eq!(s.snapshot().state, State::Reclaiming);
    assert_eq!(s.snapshot().assigned, None);
    s.finish_write(op.id, WriteResult::Delivered).unwrap();
    assert_eq!(s.snapshot().state, State::UserOwned);
    r.register_connection(a).unwrap();
    let s = r.session_mut(id).unwrap();
    s.submit(InputCall {
        principal: Principal::User,
        epoch: s.snapshot().epoch,
        request_id: request(1),
        payload: b"U".to_vec(),
    })
    .unwrap();
    s.start_write().unwrap();
    r.handoff(id, a, StreamId::from_u128(6), Duration::ZERO)
        .unwrap();
    r.disconnect(a);
    assert_eq!(r.session(id).unwrap().snapshot().state, State::Closed);
}
