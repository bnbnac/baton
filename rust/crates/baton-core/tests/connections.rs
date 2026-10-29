use baton_core::*;
mod support;
use support::transport::*;
#[tokio::test(start_paused = true)]
async fn stale_ui_ownership_actions_have_no_effect() {
    let f = RaceFixture::agent().await;
    let before = f.handle.snapshot().await;
    assert_eq!(
        f.handle
            .reclaim_expected(before.epoch.checked_next().unwrap())
            .await,
        Err(CoreError::StaleControlEpoch)
    );
    assert_eq!(f.handle.snapshot().await, before);
    f.handle.reclaim_expected(before.epoch).await.unwrap();
    let user = f.handle.snapshot().await;
    assert_eq!(user.state, State::UserOwned);
    assert_eq!(
        f.handle
            .handoff_expected(f.connection, StreamId::from_u128(900), before.epoch)
            .await,
        Err(CoreError::StaleControlEpoch)
    );
    assert_eq!(f.handle.snapshot().await, user);
    f.handle
        .handoff_expected(f.connection, StreamId::from_u128(900), user.epoch)
        .await
        .unwrap();
    assert_eq!(f.handle.snapshot().await.state, State::AgentOwned);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn dropped_submit_notifies_completion_waiter_while_another_write_is_active() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"FIRST")).await.unwrap();
    f.wait_write_started().await;
    let mut abandoned = Box::pin(f.handle.submit(f.call(2, b"NEVER")));
    assert!(poll_once(abandoned.as_mut()).await.is_pending());
    // FIFO marker: the abandoned request has been admitted, but its response was not polled.
    f.handle.submit(f.call(3, b"THIRD")).await.unwrap();
    let mut waiter = Box::pin(f.handle.wait_input_result(
        Principal::Agent(f.connection),
        f.epoch,
        RequestId::from_u128(2),
    ));
    assert!(poll_once(waiter.as_mut()).await.is_pending());
    drop(abandoned);
    let result = tokio::time::timeout(std::time::Duration::from_secs(1), waiter).await;
    assert_eq!(result, Ok(Ok(InputResult::InputInvalidated)));
    f.complete_write(WriteResult::Delivered);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn live_registration_disconnect_isolates_other_owner_and_reclaimed_shell() {
    let runtime = Runtime::spawn(Registry::new(AppId::from_u128(1)));
    let a = ConnectionId::from_u128(2);
    let b = ConnectionId::from_u128(3);
    runtime.register_connection(a).unwrap();
    runtime.register_connection(b).unwrap();
    let mut handles = Vec::new();
    for n in 0..3 {
        let id = SessionId::from_u128(10 + n);
        runtime.reserve_session(id).unwrap();
        let (t, _) = FaultTransport::pair();
        let h = runtime.activate_session(id, Box::new(t)).unwrap();
        h.handoff(if n < 2 { a } else { b }, StreamId::from_u128(20 + n))
            .await
            .unwrap();
        handles.push(h);
    }
    handles[1].reclaim().await.unwrap();
    runtime.disconnect(a).await;
    assert_eq!(handles[0].snapshot().await.state, State::Closed);
    assert_eq!(handles[1].snapshot().await.state, State::UserOwned);
    assert_eq!(handles[1].snapshot().await.assigned, None);
    assert_eq!(handles[2].snapshot().await.state, State::AgentOwned);
    assert_eq!(runtime.status_for(b).unwrap().len(), 1);
    assert_eq!(runtime.status_for(a), Err(CoreError::NotOwner));
    runtime.shutdown().await;
}
#[tokio::test]
async fn runtime_dynamic_connection_limits_and_shutdown() {
    let app = AppId::from_u128(7);
    let runtime = Runtime::spawn(Registry::new(app));
    assert_eq!(runtime.app_id(), app);
    for n in 1..=32 {
        let id = ConnectionId::from_u128(n);
        runtime.register_connection(id).unwrap();
        assert!(runtime.status_for(id).unwrap().is_empty());
    }
    assert_eq!(
        runtime.register_connection(ConnectionId::from_u128(1)),
        Err(CoreError::DuplicateId)
    );
    assert_eq!(
        runtime.register_connection(ConnectionId::from_u128(33)),
        Err(CoreError::Capacity)
    );
    runtime.disconnect(ConnectionId::from_u128(1)).await;
    assert_eq!(
        runtime.status_for(ConnectionId::from_u128(1)),
        Err(CoreError::NotOwner)
    );
    runtime
        .register_connection(ConnectionId::from_u128(33))
        .unwrap();
    runtime.shutdown().await;
    assert_eq!(
        runtime.register_connection(ConnectionId::from_u128(34)),
        Err(CoreError::SessionClosed)
    );
}
#[tokio::test(start_paused = true)]
async fn wait_completion_and_cancel_queued_without_polling() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"FIRST")).await.unwrap();
    f.wait_write_started().await;
    f.handle.submit(f.call(2, b"NEVER")).await.unwrap();
    let id = RequestId::from_u128(2);
    let p = Principal::Agent(f.connection);
    let mut wait = Box::pin(f.handle.wait_input_result(p, f.epoch, id));
    assert!(poll_once(wait.as_mut()).await.is_pending());
    assert_eq!(
        f.handle.cancel_input(p, f.epoch, id).await,
        Ok(InputResult::InputInvalidated)
    );
    assert_eq!(wait.await, Ok(InputResult::InputInvalidated));
    let mut first = Box::pin(
        f.handle
            .wait_input_result(p, f.epoch, RequestId::from_u128(1)),
    );
    assert!(poll_once(first.as_mut()).await.is_pending());
    f.complete_write(WriteResult::Delivered);
    assert_eq!(first.await, Ok(InputResult::Delivered));
    assert_eq!(f.audit.lock().unwrap().started, vec![b"FIRST".to_vec()]);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn cancel_does_not_wait_for_saturated_request_budget_or_undo_started_write() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"STARTED")).await.unwrap();
    f.wait_write_started().await;
    f.handle.submit(f.call(2, b"QUEUED")).await.unwrap();
    let p = Principal::Agent(f.connection);
    let mut waits = Vec::new();
    for _ in 0..16 {
        let mut w = Box::pin(
            f.handle
                .wait_input_result(p, f.epoch, RequestId::from_u128(2)),
        );
        assert!(poll_once(w.as_mut()).await.is_pending());
        waits.push(w);
    }
    assert_eq!(
        f.handle
            .cancel_input(p, f.epoch, RequestId::from_u128(2))
            .await,
        Ok(InputResult::InputInvalidated)
    );
    for w in waits {
        assert_eq!(w.await, Ok(InputResult::InputInvalidated));
    }
    assert_eq!(
        f.handle
            .cancel_input(p, f.epoch, RequestId::from_u128(1))
            .await,
        Ok(InputResult::Pending)
    );
    f.complete_write(WriteResult::Uncertain);
    assert_eq!(
        f.handle
            .wait_input_result(p, f.epoch, RequestId::from_u128(1))
            .await,
        Ok(InputResult::Uncertain)
    );
    f.runtime.shutdown().await;
}
