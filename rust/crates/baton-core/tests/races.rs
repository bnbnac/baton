use baton_core::*;
use std::task::Poll;
use std::time::Duration;
mod support;
use support::transport::*;

#[tokio::test(start_paused = true)]
async fn queued_receive_never_crosses_into_a_later_public_epoch() {
    for was_public in [false, true] {
        let f = RaceFixture::agent().await;
        if !was_public {
            f.handle.reclaim().await.unwrap();
        }
        let mut receive = Box::pin(f.handle.receive(b"OLD_BOUNDARY".to_vec()));
        assert!(poll_once(receive.as_mut()).await.is_pending());
        if was_public {
            f.handle.reclaim().await.unwrap();
        }
        let stream = StreamId::from_u128(500);
        f.handle.handoff(f.connection, stream).await.unwrap();
        assert_eq!(receive.await, Ok(()));
        let page = f
            .handle
            .read(
                ReadCall {
                    connection: f.connection,
                    epoch: f.handle.snapshot().await.epoch,
                    stream,
                    cursor: SafeInt::new(0).unwrap(),
                    limit: 100,
                },
                0,
            )
            .await
            .unwrap();
        assert_eq!(page.text, "", "queued public={was_public} bytes leaked");
        assert_eq!(
            f.handle.next_ui_chunk().await.unwrap().bytes,
            b"OLD_BOUNDARY"
        );
        f.runtime.shutdown().await;
    }
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_accepted_call_is_invalidated_before_later_write_start() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"FIRST")).await.unwrap();
    f.wait_write_started().await;
    let mut second = Box::pin(f.handle.submit(f.call(2, b"CANCELLED")));
    assert!(poll_once(second.as_mut()).await.is_pending());
    // FIFO marker proves the second call was accepted, without polling its response.
    f.handle.submit(f.call(3, b"THIRD")).await.unwrap();
    drop(second);
    f.complete_write(WriteResult::Delivered);
    f.wait_write_started().await;
    assert_eq!(
        f.audit.lock().unwrap().started,
        vec![b"FIRST".to_vec(), b"THIRD".to_vec()]
    );
    assert_eq!(
        f.handle
            .input_result(
                Principal::Agent(f.connection),
                f.epoch,
                RequestId::from_u128(2)
            )
            .await,
        Ok(InputResult::InputInvalidated)
    );
    f.complete_write(WriteResult::Delivered);
    f.runtime.shutdown().await;
}

#[tokio::test(start_paused = true)]
async fn hundred_duplicate_calls_admit_sixteen_but_deliver_once() {
    let f = RaceFixture::agent().await;
    let mut pending_calls = Vec::new();
    let mut rejected = 0;
    for _ in 0..100 {
        let mut call = Box::pin(f.handle.submit(f.call(1, b"ONCE")));
        match poll_once(call.as_mut()).await {
            Poll::Pending => pending_calls.push(call),
            Poll::Ready(Err(CoreError::RequestLimit)) => rejected += 1,
            other => panic!("unexpected admission: {other:?}"),
        }
    }
    assert_eq!(rejected, 84);
    for call in pending_calls {
        assert_eq!(call.await, Ok(InputResult::Pending));
    }
    f.wait_write_started().await;
    assert_eq!(f.audit.lock().unwrap().started, vec![b"ONCE".to_vec()]);
    f.complete_write(WriteResult::Delivered);
    f.runtime.shutdown().await;
}

#[tokio::test(start_paused = true)]
async fn full_ordinary_mailbox_cannot_block_frontend_loss_close() {
    let f = RaceFixture::agent().await;
    f.handle.reclaim().await.unwrap();
    let epoch = f.handle.snapshot().await.epoch;
    let mut calls = Vec::new();
    for id in 0..32 {
        let mut call = Box::pin(f.handle.submit(InputCall {
            principal: Principal::User,
            epoch,
            request_id: RequestId::from_u128(id),
            payload: b"NEVER".to_vec(),
        }));
        assert!(poll_once(call.as_mut()).await.is_pending());
        calls.push(call);
    }
    assert_eq!(
        f.handle
            .submit(InputCall {
                principal: Principal::User,
                epoch,
                request_id: RequestId::from_u128(99),
                payload: b"EXTRA".to_vec()
            })
            .await,
        Err(CoreError::Busy)
    );
    f.handle.close(CloseReason::FrontendLost).await;
    for call in calls {
        assert_eq!(call.await, Err(CoreError::SessionClosed));
    }
    f.runtime.shutdown().await;
    assert!(f.audit.lock().unwrap().started.is_empty());
    assert_eq!(f.audit.lock().unwrap().drops, 1);
}

#[tokio::test(start_paused = true)]
async fn shared_read_budget_spans_three_sessions_and_another_owner_stays_live() {
    let mut ids = support::Ids::new();
    let mut registry = Registry::new(ids.app());
    let a = ids.connection();
    let b = ids.connection();
    registry.register_connection(a).unwrap();
    registry.register_connection(b).unwrap();
    let mut setups = Vec::new();
    for index in 0..4 {
        let id = ids.session();
        let owner = if index < 3 { a } else { b };
        let stream = ids.stream();
        let mut session = Session::new(id);
        session.connected().unwrap();
        session.handoff(owner, stream, Duration::ZERO).unwrap();
        let epoch = session.snapshot().epoch;
        registry.insert_session(session).unwrap();
        setups.push((
            id,
            ReadCall {
                connection: owner,
                epoch,
                stream,
                cursor: SafeInt::new(0).unwrap(),
                limit: 32,
            },
        ));
    }
    let runtime = Runtime::spawn(registry);
    let mut handles = Vec::new();
    let mut probes = Vec::new();
    for (id, _) in &setups {
        let (transport, probe) = FaultTransport::pair();
        handles.push(runtime.attach(*id, Box::new(transport)).unwrap());
        probes.push(probe);
    }
    let mut reads = Vec::new();
    for index in 0..8 {
        let target = index % 3;
        let mut read = Box::pin(handles[target].read(setups[target].1.clone(), 10000));
        assert!(poll_once(read.as_mut()).await.is_pending());
        reads.push(read);
    }
    assert_eq!(
        handles[2].read(setups[2].1.clone(), 1).await,
        Err(CoreError::ReadLimit)
    );
    handles[0]
        .submit(support::agent_call(
            a,
            setups[0].1.epoch,
            RequestId::from_u128(1),
            b"A",
        ))
        .await
        .unwrap();
    probes[0].wait_started().await;
    handles[0].reclaim().await.unwrap();
    handles[2].reclaim().await.unwrap();
    runtime.disconnect(a).await;
    for read in reads {
        assert_eq!(read.await, Err(CoreError::NotOwner));
    }
    assert_eq!(handles[0].snapshot().await.state, State::Reclaiming);
    assert_eq!(handles[1].snapshot().await.state, State::Closed);
    assert_eq!(handles[2].snapshot().await.state, State::UserOwned);
    assert_eq!(handles[2].snapshot().await.assigned, None);
    assert_eq!(handles[3].snapshot().await.state, State::AgentOwned);
    probes[0].complete(WriteResult::Delivered);
    wait_state(&handles[0], State::UserOwned).await;
    handles[3]
        .submit(support::agent_call(
            b,
            setups[3].1.epoch,
            RequestId::from_u128(1),
            b"B",
        ))
        .await
        .unwrap();
    probes[3].wait_started().await;
    assert_eq!(probes[3].audit.lock().unwrap().started, vec![b"B".to_vec()]);
    probes[3].complete(WriteResult::Delivered);
    runtime.shutdown().await;
    for probe in probes {
        assert_eq!(probe.audit.lock().unwrap().drops, 1);
    }
}

#[tokio::test(start_paused = true)]
async fn shutdown_does_not_extend_write_deadline_by_another_close_timeout() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"STALLED")).await.unwrap();
    f.wait_write_started().await;
    let begin = tokio::time::Instant::now();
    f.runtime.shutdown().await;
    assert!(begin.elapsed() <= Duration::from_secs(5));
    assert_eq!(f.handle.snapshot().await.state, State::Closed);
    assert_eq!(f.audit.lock().unwrap().drops, 1);
}

#[tokio::test(start_paused = true)]
async fn closed_and_foreign_receive_calls_are_rejected_before_limits() {
    let f = RaceFixture::agent().await;
    let foreign = ConnectionId::from_u128(999);
    assert_eq!(
        f.handle
            .read(
                ReadCall {
                    connection: foreign,
                    ..f.read_call()
                },
                10001
            )
            .await,
        Err(CoreError::NotOwner)
    );
    f.handle.close(CloseReason::User).await;
    assert_eq!(
        f.handle.read(f.read_call(), 10001).await,
        Err(CoreError::SessionClosed)
    );
    f.runtime.shutdown().await;
}

#[tokio::test(start_paused = true)]
async fn queued_write_never_reaches_transport_after_reclaim() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"FIRST")).await.unwrap();
    f.wait_write_started().await;
    f.handle.submit(f.call(2, b"SECOND")).await.unwrap();
    f.handle.reclaim().await.unwrap();
    assert_eq!(f.handle.snapshot().await.state, State::Reclaiming);
    f.complete_write(WriteResult::Delivered);
    f.wait_state(State::UserOwned).await;
    assert_eq!(f.audit.lock().unwrap().started, vec![b"FIRST".to_vec()]);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn accepted_control_before_first_poll_prevents_all_writes() {
    let f = RaceFixture::agent().await;
    let mut submit = Box::pin(f.handle.submit(f.call(1, b"NEVER")));
    assert!(poll_once(submit.as_mut()).await.is_pending());
    f.handle.reclaim().await.unwrap();
    assert_eq!(submit.await, Err(CoreError::ControlUnavailable));
    assert!(f.audit.lock().unwrap().started.is_empty());
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn read_rechecks_after_wakeup_before_return() {
    let f = RaceFixture::agent().await;
    let mut read = Box::pin(f.handle.read(f.read_call(), 10000));
    assert!(poll_once(read.as_mut()).await.is_pending());
    f.handle.receive(b"OLD".to_vec()).await.unwrap();
    f.handle.reclaim().await.unwrap();
    f.handle.receive(b"PRIVATE".to_vec()).await.unwrap();
    f.handle
        .handoff(f.connection, StreamId::from_u128(900))
        .await
        .unwrap();
    assert_eq!(read.await, Err(CoreError::StaleControlEpoch));
    let current = f.handle.snapshot().await;
    let page = f
        .handle
        .read(
            ReadCall {
                epoch: current.epoch,
                stream: current.stream.unwrap(),
                ..f.read_call()
            },
            0,
        )
        .await
        .unwrap();
    assert_eq!(page.text, "");
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn read_timeout_drop_and_utf8_carry_release_permits() {
    let f = RaceFixture::agent().await;
    let mut reads = Vec::new();
    for _ in 0..8 {
        let mut read = Box::pin(f.handle.read(f.read_call(), 10000));
        assert!(poll_once(read.as_mut()).await.is_pending());
        reads.push(read);
    }
    assert_eq!(
        f.handle.read(f.read_call(), 1).await,
        Err(CoreError::ReadLimit)
    );
    reads.pop();
    let mut replacement = Box::pin(f.handle.read(f.read_call(), 100));
    assert!(poll_once(replacement.as_mut()).await.is_pending());
    f.handle.receive(vec![0xe2]).await.unwrap();
    assert!(poll_once(replacement.as_mut()).await.is_pending());
    tokio::time::advance(Duration::from_millis(100)).await;
    assert_eq!(replacement.await.unwrap().text, "");
    drop(reads);
    f.handle.receive(vec![0x82, 0xac]).await.unwrap();
    assert_eq!(f.handle.read(f.read_call(), 0).await.unwrap().text, "€");
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn request_limit_rejects_without_accumulating_waiters_and_drop_cancels_unsent() {
    let f = RaceFixture::agent().await;
    let mut calls = Vec::new();
    for id in 0..16 {
        let mut call = Box::pin(f.handle.submit(f.call(id, b"DROP")));
        assert!(poll_once(call.as_mut()).await.is_pending());
        calls.push(call);
    }
    assert_eq!(
        f.handle.submit(f.call(17, b"EXTRA")).await,
        Err(CoreError::RequestLimit)
    );
    drop(calls);
    f.handle.submit(f.call(100, b"AFTER")).await.unwrap();
    f.wait_write_started().await;
    assert_eq!(f.audit.lock().unwrap().started, vec![b"AFTER".to_vec()]);
    f.complete_write(WriteResult::Delivered);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn full_input_queue_does_not_delay_control() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"ACTIVE")).await.unwrap();
    f.wait_write_started().await;
    for id in 2..34 {
        f.handle.submit(f.call(id, b"QUEUED")).await.unwrap();
    }
    assert_eq!(
        f.handle.submit(f.call(34, b"EXTRA")).await,
        Err(CoreError::InputQueueFull)
    );
    f.handle.reclaim().await.unwrap();
    f.complete_write(WriteResult::Delivered);
    f.wait_state(State::UserOwned).await;
    assert_eq!(f.audit.lock().unwrap().started.len(), 1);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn stalled_transition_closes_at_five_seconds_and_drops_transport() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"ACTIVE")).await.unwrap();
    f.wait_write_started().await;
    f.handle.reclaim().await.unwrap();
    tokio::time::advance(Duration::from_millis(4999)).await;
    assert_eq!(f.handle.snapshot().await.state, State::Reclaiming);
    tokio::time::advance(Duration::from_millis(1)).await;
    assert_eq!(f.handle.snapshot().await.state, State::Closed);
    f.runtime.shutdown().await;
    assert_eq!(f.audit.lock().unwrap().drops, 1);
    assert_eq!(f.audit.lock().unwrap().started.len(), 1);
}
#[tokio::test(start_paused = true)]
async fn uncertain_is_a_final_result_and_never_automatically_replayed() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"PARTIAL")).await.unwrap();
    f.wait_write_started().await;
    f.complete_write(WriteResult::Uncertain);
    let mut changes = f.handle.subscribe();
    loop {
        let result = f
            .handle
            .input_result(
                Principal::Agent(f.connection),
                f.epoch,
                RequestId::from_u128(1),
            )
            .await
            .unwrap();
        if result == InputResult::Uncertain {
            break;
        }
        changes.changed().await.unwrap();
    }
    assert_eq!(
        f.handle.submit(f.call(1, b"PARTIAL")).await,
        Ok(InputResult::Uncertain)
    );
    assert_eq!(f.audit.lock().unwrap().started.len(), 1);
    f.runtime.shutdown().await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_multithreaded_reclaim_waits_for_existing_write() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"FIRST")).await.unwrap();
    f.wait_write_started().await;
    f.handle.submit(f.call(2, b"SECOND")).await.unwrap();
    f.handle.reclaim().await.unwrap();
    f.complete_write(WriteResult::Delivered);
    f.wait_state(State::UserOwned).await;
    assert_eq!(f.audit.lock().unwrap().started, vec![b"FIRST".to_vec()]);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn connection_loss_wakes_pending_read_and_closes_only_owned_shell() {
    let f = RaceFixture::agent().await;
    let mut read = Box::pin(f.handle.read(f.read_call(), 10000));
    assert!(matches!(poll_once(read.as_mut()).await, Poll::Pending));
    f.runtime.disconnect(f.connection).await;
    assert_eq!(read.await, Err(CoreError::NotOwner));
    assert_eq!(f.handle.snapshot().await.state, State::Closed);
    f.runtime.shutdown().await;
}
