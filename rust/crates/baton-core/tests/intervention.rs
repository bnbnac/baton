use baton_core::*;
use std::time::Duration;
fn setup() -> (Session, ConnectionId, SafeInt) {
    let mut s = Session::new(SessionId::from_u128(1));
    s.connected().unwrap();
    let a = ConnectionId::from_u128(2);
    s.handoff(a, StreamId::from_u128(3), Duration::ZERO)
        .unwrap();
    let e = s.snapshot().epoch;
    (s, a, e)
}
#[test]
fn deduplication_decline_and_method_conflicts() {
    let (mut s, a, e) = setup();
    let id = RequestId::from_u128(10);
    assert_eq!(
        s.request_user_control(a, e, id, "Need user".into()),
        Ok(InterventionResult::Queued)
    );
    assert_eq!(s.snapshot().state, State::AgentOwned);
    assert!(s.start_write().is_none());
    assert_eq!(
        s.request_user_control(a, e, id, "Need user".into()),
        Ok(InterventionResult::Duplicate)
    );
    assert_eq!(
        s.request_user_control(a, e, id, "Changed".into()),
        Err(CoreError::RequestIdConflict)
    );
    assert_eq!(
        s.request_user_control(a, e, RequestId::from_u128(11), "New".into()),
        Err(CoreError::Busy)
    );
    assert_eq!(
        s.submit(InputCall {
            principal: Principal::Agent(a),
            epoch: e,
            request_id: id,
            payload: b"Need user".to_vec()
        }),
        Err(CoreError::RequestIdConflict)
    );
    assert_eq!(
        s.input_result(Principal::Agent(a), e, id),
        Err(CoreError::RequestIdConflict)
    );
    assert_eq!(
        s.cancel_input(Principal::Agent(a), e, id),
        Err(CoreError::RequestIdConflict)
    );
    s.decline_intervention(e, id).unwrap();
    assert_eq!(
        s.snapshot().intervention.as_ref().unwrap().state,
        InterventionState::Declined
    );
    assert_eq!(
        s.request_user_control(a, e, id, "Need user".into()),
        Ok(InterventionResult::Duplicate)
    );
    assert_eq!(
        s.snapshot().intervention.as_ref().unwrap().state,
        InterventionState::Declined
    );
    s.request_user_control(a, e, RequestId::from_u128(11), "New".into())
        .unwrap();
    s.reclaim(Duration::ZERO).unwrap();
    assert!(s.snapshot().intervention.is_none());
    s.handoff(a, StreamId::from_u128(5), Duration::ZERO)
        .unwrap();
    assert_eq!(
        s.request_user_control(a, e, id, "Need user".into()),
        Err(CoreError::StaleControlEpoch)
    );
    let e = s.snapshot().epoch;
    s.request_user_control(a, e, id, "again".into()).unwrap();
    s.close(CloseReason::User);
    assert!(s.snapshot().intervention.is_none());
}
#[test]
fn reason_limits_are_bytes_and_control_characters_are_rejected() {
    for reason in [
        "x".repeat(2049),
        "é".repeat(1025),
        "\n".into(),
        "\u{7f}".into(),
        "\u{85}".into(),
    ] {
        let (mut s, a, e) = setup();
        assert_eq!(
            s.request_user_control(a, e, RequestId::from_u128(1), reason),
            Err(CoreError::InvalidReason)
        );
        assert_eq!(s.usage().history, 0);
    }
    let (mut s, a, e) = setup();
    s.request_user_control(a, e, RequestId::from_u128(1), "é".repeat(1024))
        .unwrap();
    assert_eq!(
        s.request_user_control(
            ConnectionId::from_u128(99),
            e,
            RequestId::from_u128(2),
            "x".into()
        ),
        Err(CoreError::NotOwner)
    );
}
#[test]
fn intervention_and_input_share_history_without_becoming_writes() {
    let (mut s, a, e) = setup();
    s.submit(InputCall {
        principal: Principal::Agent(a),
        epoch: e,
        request_id: RequestId::from_u128(0),
        payload: b"cmd".to_vec(),
    })
    .unwrap();
    assert_eq!(
        s.request_user_control(a, e, RequestId::from_u128(0), "cmd".into()),
        Err(CoreError::RequestIdConflict)
    );
    let op = s.start_write().unwrap();
    s.finish_write(op.id, WriteResult::Delivered).unwrap();
    for n in 1..4096 {
        let id = RequestId::from_u128(n);
        s.request_user_control(a, e, id, "x".into()).unwrap();
        s.decline_intervention(e, id).unwrap();
    }
    assert_eq!(s.usage().history, 4096);
    assert!(s.start_write().is_none());
    assert_eq!(
        s.request_user_control(a, e, RequestId::from_u128(5000), "x".into()),
        Err(CoreError::RequestHistoryFull)
    );
    assert_eq!(
        s.submit(InputCall {
            principal: Principal::Agent(a),
            epoch: e,
            request_id: RequestId::from_u128(5000),
            payload: b"cmd".to_vec()
        }),
        Err(CoreError::RequestHistoryFull)
    );
    assert_eq!(
        s.request_user_control(a, e, RequestId::from_u128(1), "x".into()),
        Ok(InterventionResult::Duplicate)
    );
}
