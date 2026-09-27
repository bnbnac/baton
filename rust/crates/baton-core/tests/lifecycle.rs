use baton_core::*;
mod support;
use support::transport::*;
fn id(n: u128) -> SessionId {
    SessionId::from_u128(n)
}
fn runtime() -> Runtime {
    Runtime::spawn(Registry::new(AppId::from_u128(1)))
}
fn input(epoch: SafeInt) -> InputCall {
    InputCall {
        principal: Principal::User,
        epoch,
        request_id: RequestId::from_u128(1),
        payload: b"ONCE".to_vec(),
    }
}

#[tokio::test(start_paused = true)]
async fn reserve_close_late_activate_never_opens() {
    let r = runtime();
    assert_eq!(r.reserve_session(id(1)), Ok(()));
    assert_eq!(r.snapshots()[0].1.state, State::Connecting);
    assert_eq!(r.close_session(id(1), CloseReason::User), Ok(()));
    let (io, p) = FaultTransport::pair();
    assert!(matches!(
        r.activate_session(id(1), Box::new(io)),
        Err(CoreError::SessionClosed)
    ));
    assert!(p.audit.lock().unwrap().started.is_empty());
    assert_eq!(p.audit.lock().unwrap().drops, 1);
    assert_eq!(r.snapshots()[0].1.state, State::Closed);
    assert_eq!(r.forget_closed(id(1)), Ok(()));
    assert!(r.snapshots().is_empty());
}

#[tokio::test(start_paused = true)]
async fn connecting_and_closed_cards_share_capacity_until_explicit_removal() {
    let r = runtime();
    for n in 1..=16 {
        assert_eq!(r.reserve_session(id(n)), Ok(()));
    }
    assert_eq!(r.reserve_session(id(1)), Err(CoreError::DuplicateId));
    assert_eq!(r.reserve_session(id(17)), Err(CoreError::Capacity));
    assert_eq!(r.forget_closed(id(1)), Err(CoreError::Busy));
    r.close_session(id(1), CloseReason::User).unwrap();
    assert_eq!(r.reserve_session(id(17)), Err(CoreError::Capacity));
    r.forget_closed(id(1)).unwrap();
    assert_eq!(r.reserve_session(id(17)), Ok(()));
    assert_eq!(r.snapshots().len(), 16);
    assert!(r.snapshots().iter().all(|(sid, _)| *sid != id(1)));
    r.shutdown().await;
}

#[tokio::test(start_paused = true)]
async fn forget_waits_for_driver_and_stale_handles_never_panic_or_touch_replacement() {
    let r = runtime();
    r.reserve_session(id(1)).unwrap();
    let (io, p) = FaultTransport::pair();
    let h = r.activate_session(id(1), Box::new(io)).unwrap();
    assert_eq!(h.snapshot().await.state, State::UserOwned);
    h.submit(input(h.snapshot().await.epoch)).await.unwrap();
    p.wait_started().await;
    r.close_session(id(1), CloseReason::User).unwrap();
    assert_eq!(r.forget_closed(id(1)), Err(CoreError::Busy));
    p.complete(WriteResult::Delivered);
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while r.forget_closed(id(1)) == Err(CoreError::Busy) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(p.audit.lock().unwrap().drops, 1);
    assert!(r.snapshots().is_empty());
    // Even a trusted assembler accidentally reusing an ID cannot revive old handles.
    r.reserve_session(id(1)).unwrap();
    let (replacement, other) = FaultTransport::pair();
    let fresh = r.activate_session(id(1), Box::new(replacement)).unwrap();
    assert_eq!(h.snapshot().await.state, State::Closed);
    assert_eq!(
        h.submit(input(SafeInt::new(0).unwrap())).await,
        Err(CoreError::SessionClosed)
    );
    assert_eq!(
        h.receive(b"OLD".to_vec()).await,
        Err(CoreError::SessionClosed)
    );
    h.close(CloseReason::User).await;
    assert_eq!(fresh.snapshot().await.state, State::UserOwned);
    assert!(fresh.next_ui_chunk().await.is_none());
    assert!(other.audit.lock().unwrap().started.is_empty());
    r.shutdown().await;
}

#[tokio::test(start_paused = true)]
async fn shutdown_covers_reservations_and_rejects_late_activation() {
    let r = runtime();
    r.reserve_session(id(1)).unwrap();
    r.reserve_session(id(2)).unwrap();
    let (io, p) = FaultTransport::pair();
    let h = r.activate_session(id(1), Box::new(io)).unwrap();
    let (duplicate, d) = FaultTransport::pair();
    assert!(r.activate_session(id(1), Box::new(duplicate)).is_err());
    assert_eq!(d.audit.lock().unwrap().drops, 1);
    assert_eq!(
        r.session_handle(id(1)).unwrap().snapshot().await.state,
        State::UserOwned
    );
    assert!(r.session_handle(id(2)).is_err());
    r.shutdown().await;
    assert_eq!(p.audit.lock().unwrap().drops, 1);
    assert_eq!(h.snapshot().await.state, State::Closed);
    assert_eq!(r.reserve_session(id(3)), Err(CoreError::SessionClosed));
    let (late, p) = FaultTransport::pair();
    assert!(matches!(
        r.activate_session(id(2), Box::new(late)),
        Err(CoreError::SessionClosed)
    ));
    assert_eq!(p.audit.lock().unwrap().drops, 1);
}

#[tokio::test(start_paused = true)]
async fn remote_close_does_not_close_another_live_shell() {
    let r = runtime();
    r.reserve_session(id(1)).unwrap();
    r.reserve_session(id(2)).unwrap();
    let (a, pa) = FaultTransport::pair();
    let (b, pb) = FaultTransport::pair();
    let a = r.activate_session(id(1), Box::new(a)).unwrap();
    let b = r.activate_session(id(2), Box::new(b)).unwrap();
    a.close(CloseReason::TransportLost).await;
    b.submit(input(b.snapshot().await.epoch)).await.unwrap();
    pb.wait_started().await;
    assert_eq!(pb.audit.lock().unwrap().started, vec![b"ONCE".to_vec()]);
    assert!(pa.audit.lock().unwrap().started.is_empty());
    pb.complete(WriteResult::Delivered);
    r.shutdown().await;
}
