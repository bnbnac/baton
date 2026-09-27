use baton_core::*;
use std::time::Duration;
mod support;
use support::transport::*;
fn response(v: ViewBinding, q: &QueryMark) -> ReplyCall {
    ReplyCall {
        binding: v,
        epoch: q.epoch,
        query: q.id,
        kind: q.kind,
        row: None,
        column: None,
    }
}
struct Immediate(std::sync::Arc<std::sync::Mutex<Vec<Vec<u8>>>>);
impl Transport for Immediate {
    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, WriteResult> {
        Box::pin(async move {
            self.0.lock().unwrap().push(bytes.to_vec());
            WriteResult::Delivered
        })
    }
    fn close(&mut self) -> IoFuture<'_, ()> {
        Box::pin(async {})
    }
}
#[tokio::test(start_paused = true)]
async fn queued_replies_drain_even_when_transport_completes_synchronously() {
    let id = SessionId::from_u128(1);
    let mut registry = Registry::new(AppId::from_u128(1));
    let mut s = Session::new(id);
    s.connected().unwrap();
    let v = s.bind_view(ViewId::from_u128(1)).unwrap();
    s.receive(b"\x1b[5n\x1b[5n\x1b[5n").unwrap();
    let frame = s.next_ui_frame(v).unwrap().unwrap();
    for q in frame.queries {
        s.queue_reply(response(v, &q)).unwrap();
    }
    registry.insert_session(s).unwrap();
    let runtime = Runtime::spawn(registry);
    let audit = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let _handle = runtime
        .attach(id, Box::new(Immediate(audit.clone())))
        .unwrap();
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        audit.lock().unwrap().len(),
        3,
        "no later UI message should be needed to drain work"
    );
    runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn reply_is_sent_once_and_blocks_transition_until_completion() {
    let f = RaceFixture::agent().await;
    let v = f.handle.bind_view(ViewId::from_u128(1)).await.unwrap();
    f.handle.receive(b"\x1b[5n".to_vec()).await.unwrap();
    let frame = f.handle.next_ui_frame(v).await.unwrap().unwrap();
    let call = response(v, &frame.queries[0]);
    assert_eq!(f.handle.protocol_reply(call.clone()).await, Ok(()));
    f.wait_write_started().await;
    assert_eq!(f.audit.lock().unwrap().started, vec![b"\x1b[0n".to_vec()]);
    assert_eq!(
        f.handle.protocol_reply(call).await,
        Err(CoreError::UnknownQuery)
    );
    f.handle.reclaim().await.unwrap();
    assert_eq!(f.handle.snapshot().await.state, State::Reclaiming);
    f.complete_write(WriteResult::Delivered);
    f.wait_state(State::UserOwned).await;
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn saturated_input_queue_cannot_force_a_reply_past_reclaim() {
    let f = RaceFixture::agent().await;
    let v = f.handle.bind_view(ViewId::from_u128(1)).await.unwrap();
    f.handle.submit(f.call(1, b"ACTIVE")).await.unwrap();
    f.wait_write_started().await;
    for id in 2..34 {
        f.handle.submit(f.call(id, b"QUEUED")).await.unwrap();
    }
    f.handle.receive(b"\x1b[5n".to_vec()).await.unwrap();
    let frame = f.handle.next_ui_frame(v).await.unwrap().unwrap();
    assert_eq!(
        f.handle
            .protocol_reply(response(v, &frame.queries[0]))
            .await,
        Ok(())
    );
    f.handle.reclaim().await.unwrap();
    f.complete_write(WriteResult::Delivered);
    f.wait_state(State::UserOwned).await;
    assert_eq!(f.audit.lock().unwrap().started, vec![b"ACTIVE".to_vec()]);
    f.runtime.shutdown().await;
}
#[tokio::test(start_paused = true)]
async fn claimed_reply_expires_before_write_start_and_never_replays() {
    let f = RaceFixture::agent().await;
    let v = f.handle.bind_view(ViewId::from_u128(1)).await.unwrap();
    f.handle.submit(f.call(1, b"ACTIVE")).await.unwrap();
    f.wait_write_started().await;
    f.handle.receive(b"\x1b[5n".to_vec()).await.unwrap();
    let frame = f.handle.next_ui_frame(v).await.unwrap().unwrap();
    f.handle
        .protocol_reply(response(v, &frame.queries[0]))
        .await
        .unwrap();
    tokio::time::advance(Duration::from_secs(2)).await;
    f.complete_write(WriteResult::Delivered);
    // FIFO subsequent input establishes driver progress after expiry.
    f.handle.submit(f.call(2, b"AFTER")).await.unwrap();
    f.wait_write_started().await;
    assert_eq!(
        f.audit.lock().unwrap().started,
        vec![b"ACTIVE".to_vec(), b"AFTER".to_vec()]
    );
    f.complete_write(WriteResult::Delivered);
    f.runtime.shutdown().await;
}
