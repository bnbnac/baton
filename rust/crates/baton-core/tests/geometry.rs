use baton_core::*;
use std::time::Duration;
fn n(v: u64) -> SafeInt {
    SafeInt::new(v).unwrap()
}
#[test]
fn control_fairness_and_transition_timeout_cover_all_transport_work() {
    let (mut s, v) = setup();
    s.receive(b"\x1b[5n\x1b[5n").unwrap();
    let frame = s.next_ui_frame(v).unwrap().unwrap();
    for q in frame.queries {
        s.queue_reply(ReplyCall {
            binding: v,
            epoch: q.epoch,
            query: q.id,
            kind: q.kind,
            row: None,
            column: None,
        })
        .unwrap();
    }
    for id in 1..=2 {
        s.submit(InputCall {
            principal: Principal::User,
            epoch: n(0),
            request_id: RequestId::from_u128(id),
            payload: b"input".to_vec(),
        })
        .unwrap();
    }
    s.resize(request(v, 1, 91, 27)).unwrap();
    for (i, kind) in ["reply", "input", "resize", "input", "reply"]
        .into_iter()
        .enumerate()
    {
        let op = s.start_transport_op(Duration::ZERO).unwrap();
        assert_eq!(op.seq(), n(i as u64 + 1));
        assert!(s.start_write().is_none());
        let result = match op {
            TransportOp::Input(_) => {
                assert_eq!(kind, "input");
                TransportCompletion::Data(WriteResult::Delivered)
            }
            TransportOp::Reply { .. } => {
                assert_eq!(kind, "reply");
                TransportCompletion::Data(WriteResult::Delivered)
            }
            TransportOp::Resize { .. } => {
                assert_eq!(kind, "resize");
                TransportCompletion::Resize(Ok(()))
            }
        };
        s.finish_transport_op(n(i as u64 + 1), result, Duration::ZERO)
            .unwrap();
    }
    s.resize(request(v, 2, 80, 24)).unwrap();
    let op = s.start_transport_op(Duration::from_millis(100)).unwrap();
    s.handoff(
        ConnectionId::from_u128(1),
        StreamId::from_u128(1),
        Duration::from_millis(100),
    )
    .unwrap();
    s.tick(Duration::from_millis(5099));
    assert_eq!(s.snapshot().state, State::Transferring);
    s.tick(Duration::from_millis(5100));
    assert_eq!(s.close_reason(), Some(CloseReason::TransitionTimeout));
    assert_eq!(
        s.finish_transport_op(
            op.seq(),
            TransportCompletion::Resize(Ok(())),
            Duration::from_millis(5100)
        ),
        Err(CoreError::InvalidCompletion)
    );
    assert_eq!(
        s.geometry(),
        Geometry {
            columns: 91,
            rows: 27
        }
    );
}
#[test]
fn claimed_tokens_stay_in_budget_until_sent_or_cancelled() {
    let (mut s, v) = setup();
    s.receive(&b"\x1b[5n".repeat(32)).unwrap();
    let frame = s.next_ui_frame(v).unwrap().unwrap();
    for q in frame.queries {
        s.queue_reply(ReplyCall {
            binding: v,
            epoch: q.epoch,
            query: q.id,
            kind: q.kind,
            row: None,
            column: None,
        })
        .unwrap();
    }
    s.tick(Duration::from_secs(2));
    assert_eq!(s.receive(b"\x1b[5n"), Err(CoreError::QueryLimit));
    assert_eq!(s.snapshot().state, State::Closed);
}
struct ResizeTransport {
    starts: std::sync::Arc<std::sync::Mutex<Vec<(tokio::time::Instant, Geometry)>>>,
    complete: tokio::sync::mpsc::Receiver<()>,
}
impl Transport for ResizeTransport {
    fn write<'a>(&'a mut self, _: &'a [u8]) -> IoFuture<'a, WriteResult> {
        Box::pin(async { panic!("unexpected write") })
    }
    fn resize(&mut self, g: Geometry) -> IoFuture<'_, Result<(), TransportError>> {
        Box::pin(async move {
            self.starts
                .lock()
                .unwrap()
                .push((tokio::time::Instant::now(), g));
            self.complete
                .recv()
                .await
                .ok_or(TransportError::Disconnected)
        })
    }
    fn close(&mut self) -> IoFuture<'_, ()> {
        Box::pin(async {})
    }
}
#[tokio::test(start_paused = true)]
async fn driver_wakes_at_resize_deadline_and_serializes_with_handoff() {
    let (s, _) = setup();
    let id = s.id();
    let a = ConnectionId::from_u128(1);
    let mut r = Registry::new(AppId::from_u128(1));
    r.register_connection(a).unwrap();
    r.insert_session(s).unwrap();
    let rt = Runtime::spawn(r);
    let starts = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let (tx, rx) = tokio::sync::mpsc::channel(1);
    let h = rt
        .attach(
            id,
            Box::new(ResizeTransport {
                starts: starts.clone(),
                complete: rx,
            }),
        )
        .unwrap();
    let v = h.bind_view(ViewId::from_u128(1)).await.unwrap();
    h.resize(request(v, 1, 91, 27)).await.unwrap();
    tokio::task::yield_now().await;
    assert_eq!(starts.lock().unwrap().len(), 1);
    h.handoff(a, StreamId::from_u128(1)).await.unwrap();
    assert_eq!(h.snapshot().await.state, State::Transferring);
    h.resize(request(v, 2, 80, 24)).await.unwrap();
    tx.send(()).await.unwrap();
    tokio::task::yield_now().await;
    assert_eq!(h.snapshot().await.state, State::AgentOwned);
    tokio::time::advance(Duration::from_millis(99)).await;
    tokio::task::yield_now().await;
    assert_eq!(starts.lock().unwrap().len(), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    tokio::task::yield_now().await;
    {
        let starts = starts.lock().unwrap();
        assert_eq!(starts.len(), 2);
        assert!(starts[1].0 - starts[0].0 >= Duration::from_millis(100));
        assert_eq!(
            starts[1].1,
            Geometry {
                columns: 80,
                rows: 24
            }
        );
    }
    tx.send(()).await.unwrap();
    rt.shutdown().await;
}
fn setup() -> (Session, ViewBinding) {
    let mut s = Session::new(SessionId::from_u128(1));
    s.connected().unwrap();
    let v = s.bind_view(ViewId::from_u128(1)).unwrap();
    (s, v)
}
fn request(v: ViewBinding, seq: u64, c: u16, r: u16) -> GeometryRequest {
    GeometryRequest {
        binding: v,
        resize_seq: n(seq),
        geometry: Geometry {
            columns: c,
            rows: r,
        },
    }
}
#[test]
fn invalid_and_old_geometry_never_change_remote_target() {
    let (mut s, v) = setup();
    for (c, r) in [(0, 0), (19, 5), (501, 5), (20, 4), (20, 201)] {
        assert_eq!(Geometry::new(c, r), Err(CoreError::InvalidGeometry));
        assert_eq!(
            s.resize(request(v, 1, c, r)),
            Err(CoreError::InvalidGeometry)
        );
    }
    assert_eq!(
        s.geometry(),
        Geometry {
            columns: 120,
            rows: 32
        }
    );
    assert_eq!(s.resize(request(v, 1, 91, 27)), Ok(()));
    assert_eq!(s.resize(request(v, 1, 80, 24)), Err(CoreError::StaleResize));
    let mut foreign = v;
    foreign.generation = ViewId::from_u128(99);
    assert_eq!(
        s.resize(request(foreign, 2, 80, 24)),
        Err(CoreError::StaleView)
    );
    assert!(matches!(
        s.start_transport_op(Duration::ZERO),
        Some(TransportOp::Resize {
            geometry: Geometry {
                columns: 91,
                rows: 27
            },
            ..
        })
    ));
}
#[test]
fn resize_coalesces_and_limits_starts_without_resetting_public_cursors() {
    let (mut s, v) = setup();
    s.handoff(
        ConnectionId::from_u128(1),
        StreamId::from_u128(2),
        Duration::ZERO,
    )
    .unwrap();
    s.receive(b"PUBLIC").unwrap();
    let snapshot = s.snapshot();
    let units = s.usage().public_units;
    s.resize(request(v, 1, 91, 27)).unwrap();
    s.resize(request(v, 2, 80, 24)).unwrap();
    let first = s.start_transport_op(Duration::ZERO).unwrap();
    assert!(matches!(
        first,
        TransportOp::Resize {
            geometry: Geometry {
                columns: 80,
                rows: 24
            },
            ..
        }
    ));
    s.finish_transport_op(
        first.seq(),
        TransportCompletion::Resize(Ok(())),
        Duration::ZERO,
    )
    .unwrap();
    s.resize(request(v, 3, 91, 27)).unwrap();
    assert!(s.start_transport_op(Duration::from_millis(99)).is_none());
    let last = s.start_transport_op(Duration::from_millis(100)).unwrap();
    assert!(last.seq() > first.seq());
    s.finish_transport_op(
        last.seq(),
        TransportCompletion::Resize(Ok(())),
        Duration::from_millis(100),
    )
    .unwrap();
    assert_eq!(
        s.geometry(),
        Geometry {
            columns: 91,
            rows: 27
        }
    );
    assert_eq!(s.snapshot(), snapshot);
    assert_eq!(s.usage().public_units, units);
    s.resize(request(v, 4, 91, 27)).unwrap();
    assert!(s.start_transport_op(Duration::from_millis(200)).is_none());
}
#[test]
fn latest_request_back_to_previous_size_survives_inflight_resize() {
    let (mut s, v) = setup();
    s.resize(request(v, 1, 91, 27)).unwrap();
    let op = s.start_transport_op(Duration::ZERO).unwrap();
    s.resize(request(v, 2, 120, 32)).unwrap();
    assert!(s.start_transport_op(Duration::ZERO).is_none());
    s.finish_transport_op(
        op.seq(),
        TransportCompletion::Resize(Ok(())),
        Duration::ZERO,
    )
    .unwrap();
    let back = s.start_transport_op(Duration::from_millis(100)).unwrap();
    assert!(matches!(
        back,
        TransportOp::Resize {
            geometry: Geometry {
                columns: 120,
                rows: 32
            },
            ..
        }
    ));
    s.finish_transport_op(
        back.seq(),
        TransportCompletion::Resize(Err(TransportError::Disconnected)),
        Duration::from_millis(100),
    )
    .unwrap();
    assert_eq!(
        s.geometry(),
        Geometry {
            columns: 91,
            rows: 27
        }
    );
    assert_eq!(s.snapshot().state, State::Closed);
}
#[test]
fn handoff_waits_for_resize_and_transition_keeps_only_latest_geometry() {
    let (mut s, v) = setup();
    s.resize(request(v, 1, 91, 27)).unwrap();
    let op = s.start_transport_op(Duration::ZERO).unwrap();
    s.handoff(
        ConnectionId::from_u128(1),
        StreamId::from_u128(1),
        Duration::ZERO,
    )
    .unwrap();
    assert_eq!(s.snapshot().state, State::Transferring);
    s.resize(request(v, 2, 100, 30)).unwrap();
    s.resize(request(v, 3, 150, 40)).unwrap();
    assert!(s.start_transport_op(Duration::from_millis(100)).is_none());
    s.finish_transport_op(
        op.seq(),
        TransportCompletion::Resize(Ok(())),
        Duration::from_millis(100),
    )
    .unwrap();
    assert_eq!(s.snapshot().state, State::AgentOwned);
    assert!(matches!(
        s.start_transport_op(Duration::from_millis(100)),
        Some(TransportOp::Resize {
            geometry: Geometry {
                columns: 150,
                rows: 40
            },
            ..
        })
    ));
}
