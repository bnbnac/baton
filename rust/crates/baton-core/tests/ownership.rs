use baton_core::*;
use std::time::Duration;
mod support;
use support::*;

#[test]
fn reassignment_revokes_old_owner_and_changes_stream() {
    let mut ids = Ids::new();
    let (a, b) = (ids.connection(), ids.connection());
    let (first, second) = (ids.stream(), ids.stream());
    let mut s = Session::new(ids.session());
    s.connected().unwrap();
    s.handoff(a, first, Duration::ZERO).unwrap();
    assert_eq!(s.snapshot().state, State::AgentOwned);
    assert_eq!(s.snapshot().epoch.get(), 1);
    s.reclaim(Duration::ZERO).unwrap();
    assert_eq!(s.snapshot().state, State::UserOwned);
    assert_eq!(s.status_for(a).unwrap().stream, None);
    s.handoff(b, second, Duration::ZERO).unwrap();
    assert_eq!(s.snapshot().epoch.get(), 3);
    assert_eq!(s.status_for(a), Err(CoreError::NotOwner));
    assert_eq!(s.status_for(b).unwrap().stream, Some(second));
}

fn registry_four() -> (Registry, ConnectionId, ConnectionId, Vec<SessionId>) {
    let mut ids = Ids::new();
    let mut r = Registry::new(ids.app());
    let (a, b) = (ids.connection(), ids.connection());
    r.register_connection(a).unwrap();
    r.register_connection(b).unwrap();
    let mut sessions = Vec::new();
    for index in 0..4 {
        let id = ids.session();
        let mut s = Session::new(id);
        s.connected().unwrap();
        r.insert_session(s).unwrap();
        r.handoff(
            id,
            if index < 3 { a } else { b },
            ids.stream(),
            Duration::ZERO,
        )
        .unwrap();
        sessions.push(id);
    }
    (r, a, b, sessions)
}

#[test]
fn connection_sees_only_assigned_sessions() {
    let (r, a, b, ids) = registry_four();
    assert_eq!(
        r.status_for(a)
            .unwrap()
            .iter()
            .map(|(id, _)| *id)
            .collect::<Vec<_>>(),
        ids[..3]
    );
    assert_eq!(
        r.status_for(b)
            .unwrap()
            .iter()
            .map(|(id, _)| *id)
            .collect::<Vec<_>>(),
        ids[3..]
    );
    for id in &ids[..3] {
        assert_eq!(
            r.session(*id).unwrap().status_for(b),
            Err(CoreError::NotOwner)
        );
    }
}
#[test]
fn reclaim_before_disconnect_preserves_user_shell_only() {
    let (mut r, a, b, ids) = registry_four();
    r.session_mut(ids[0])
        .unwrap()
        .reclaim(Duration::ZERO)
        .unwrap();
    r.disconnect(a);
    assert_eq!(
        r.session(ids[0]).unwrap().snapshot().state,
        State::UserOwned
    );
    assert_eq!(r.session(ids[0]).unwrap().snapshot().assigned, None);
    for id in &ids[1..3] {
        assert_eq!(r.session(*id).unwrap().snapshot().state, State::Closed);
    }
    assert_eq!(r.status_for(b).unwrap()[0].1.state, State::AgentOwned);
    assert_eq!(r.status_for(a), Err(CoreError::NotOwner));
}
#[test]
fn disconnect_before_reclaim_cannot_resurrect_shell() {
    let (mut r, a, _, ids) = registry_four();
    r.disconnect(a);
    assert_eq!(
        r.session_mut(ids[0]).unwrap().reclaim(Duration::ZERO),
        Err(CoreError::SessionClosed)
    );
    assert_eq!(
        r.session(ids[3]).unwrap().snapshot().state,
        State::AgentOwned
    );
}
#[test]
fn session_slots_and_duplicate_registration_are_bounded() {
    let mut ids = Ids::new();
    let mut r = Registry::new(ids.app());
    let mut saved = Vec::new();
    for _ in 0..16 {
        let id = ids.session();
        saved.push(id);
        r.insert_session(Session::new(id)).unwrap();
    }
    assert_eq!(
        r.insert_session(Session::new(saved[0])),
        Err(CoreError::DuplicateId)
    );
    assert_eq!(
        r.insert_session(Session::new(ids.session())),
        Err(CoreError::Capacity)
    );
    assert_eq!(r.forget_closed(saved[0]), Err(CoreError::Busy));
    r.session_mut(saved[0]).unwrap().close(CloseReason::User);
    assert_eq!(
        r.insert_session(Session::new(ids.session())),
        Err(CoreError::Capacity)
    );
    r.forget_closed(saved[0]).unwrap();
    r.insert_session(Session::new(ids.session())).unwrap();
    assert!(matches!(r.session(saved[0]), Err(CoreError::UnknownId)));
}
#[test]
fn closed_and_connecting_reject_control_and_close_is_idempotent() {
    let mut ids = Ids::new();
    let mut s = Session::new(ids.session());
    let a = ids.connection();
    assert_eq!(
        s.handoff(a, ids.stream(), Duration::ZERO),
        Err(CoreError::ControlUnavailable)
    );
    s.close(CloseReason::TransportLost);
    let closed = s.snapshot();
    s.close(CloseReason::User);
    assert_eq!(s.snapshot(), closed);
    assert_eq!(s.connected(), Err(CoreError::SessionClosed));
    assert_eq!(
        s.handoff(a, ids.stream(), Duration::ZERO),
        Err(CoreError::SessionClosed)
    );
    assert_eq!(s.status_for(a), Err(CoreError::NotOwner));
}
#[test]
fn unknown_target_and_close_all_do_not_reassign() {
    let (mut r, a, b, ids) = registry_four();
    r.session_mut(ids[0])
        .unwrap()
        .reclaim(Duration::ZERO)
        .unwrap();
    let before = r.session(ids[0]).unwrap().snapshot();
    assert_eq!(
        r.handoff(
            ids[0],
            ConnectionId::from_u128(900),
            StreamId::from_u128(900),
            Duration::ZERO
        ),
        Err(CoreError::NotOwner)
    );
    assert_eq!(r.session(ids[0]).unwrap().snapshot(), before);
    r.close_all(CloseReason::AppExit);
    assert!(
        r.status_for(a)
            .unwrap()
            .iter()
            .all(|(_, s)| s.state == State::Closed)
    );
    assert!(
        r.status_for(b)
            .unwrap()
            .iter()
            .all(|(_, s)| s.state == State::Closed)
    );
}
