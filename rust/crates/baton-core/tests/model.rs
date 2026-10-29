use baton_core::*;
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;
mod support;
use support::generator::*;
use support::reference::*;

struct System {
    registry: Registry,
    ids: BTreeSet<SessionId>,
    now: Duration,
    sent: Vec<(SessionId, SafeInt, Vec<u8>)>,
    resizes: Vec<(SessionId, SafeInt, Geometry)>,
}
impl System {
    fn new() -> Self {
        Self {
            registry: Registry::new(AppId::from_u128(1)),
            ids: BTreeSet::new(),
            now: Duration::ZERO,
            sent: Vec::new(),
            resizes: Vec::new(),
        }
    }
    fn apply(&mut self, event: &Event) -> Observation {
        let reply = match event {
            Event::BindView(id, v) => {
                Reply::Binding(self.registry.session_mut(*id).and_then(|s| s.bind_view(*v)))
            }
            Event::Resize(id, r) => {
                Reply::Unit(self.registry.session_mut(*id).and_then(|s| s.resize(*r)))
            }
            Event::StartIo(id) => {
                let result = self
                    .registry
                    .session_mut(*id)
                    .map(|s| s.start_transport_op(self.now));
                match &result {
                    Ok(Some(TransportOp::Input(op))) => {
                        self.sent.push((*id, op.id, op.payload.clone()))
                    }
                    Ok(Some(TransportOp::Resize { seq, geometry })) => {
                        self.resizes.push((*id, *seq, *geometry))
                    }
                    _ => {}
                }
                Reply::Operation(result)
            }
            Event::FinishIo(id, seq, r) => Reply::Unit(
                self.registry
                    .session_mut(*id)
                    .and_then(|s| s.finish_transport_op(*seq, *r, self.now)),
            ),
            Event::Connect(c) => Reply::Unit(self.registry.register_connection(*c)),
            Event::Disconnect(c) => {
                self.registry.disconnect(*c);
                Reply::Unit(Ok(()))
            }
            Event::Open(id) => {
                let result = self.registry.insert_session(Session::new(*id));
                if result.is_ok() {
                    self.ids.insert(*id);
                }
                Reply::Unit(result)
            }
            Event::Connected(id) => {
                Reply::Unit(self.registry.session_mut(*id).and_then(Session::connected))
            }
            Event::Handoff(id, c, stream) => {
                Reply::Unit(self.registry.handoff(*id, *c, *stream, self.now))
            }
            Event::Reclaim(id) => Reply::Unit(
                self.registry
                    .session_mut(*id)
                    .and_then(|s| s.reclaim(self.now)),
            ),
            Event::Submit(id, call) => Reply::Input(
                self.registry
                    .session_mut(*id)
                    .and_then(|s| s.submit(call.clone())),
            ),
            Event::StartWrite(id) => {
                let result = self.registry.session_mut(*id).map(Session::start_write);
                if let Ok(Some(op)) = &result {
                    self.sent.push((*id, op.id, op.payload.clone()));
                }
                Reply::Write(result)
            }
            Event::FinishWrite(id, op, result) => Reply::Unit(
                self.registry
                    .session_mut(*id)
                    .and_then(|s| s.finish_write(*op, *result)),
            ),
            Event::Receive(id, bytes) => Reply::Unit(
                self.registry
                    .session_mut(*id)
                    .and_then(|s| s.receive(bytes)),
            ),
            Event::Read(id, call) => {
                Reply::Page(self.registry.session(*id).and_then(|s| s.read(call)))
            }
            Event::CancelInput(id, p, e, req) => Reply::Input(
                self.registry
                    .session_mut(*id)
                    .and_then(|s| s.cancel_input(*p, *e, *req)),
            ),
            Event::Tick(now) => {
                self.now = *now;
                for id in &self.ids {
                    self.registry.session_mut(*id).unwrap().tick(*now);
                }
                Reply::Unit(Ok(()))
            }
            Event::CloseSession(id) => Reply::Unit(
                self.registry
                    .session_mut(*id)
                    .map(|s| s.close(CloseReason::User)),
            ),
            Event::CloseApp => {
                self.registry.close_all(CloseReason::AppExit);
                Reply::Unit(Ok(()))
            }
        };
        Observation {
            reply,
            sessions: self
                .ids
                .iter()
                .map(|id| {
                    let s = self.registry.session(*id).unwrap();
                    (*id, s.snapshot(), s.usage())
                })
                .collect(),
            sent: self.sent.clone(),
            geometry: self
                .ids
                .iter()
                .map(|id| (*id, self.registry.session(*id).unwrap().geometry()))
                .collect(),
            resizes: self.resizes.clone(),
        }
    }
}
fn mismatch(events: &[Event]) -> bool {
    let (mut expected, mut actual) = (Reference::new(), System::new());
    events
        .iter()
        .any(|event| expected.apply(event) != actual.apply(event))
}
#[test]
fn model_1000_seeds_200_events() {
    check_model(1000, 200);
}
#[cfg(feature = "release-verification")]
#[test]
fn model_release_10000_seeds_500_events() {
    check_model(10000, 500);
}
fn check_model(seeds: u64, events_per_seed: usize) {
    let mut coverage = BTreeMap::<String, usize>::new();
    let mut accepted = 0;
    let mut rejected = 0;
    let mut transitioning = 0;
    for seed in 0..seeds {
        let events = generate(seed, events_per_seed);
        assert_eq!(events.len(), events_per_seed);
        let (mut expected, mut actual) = (Reference::new(), System::new());
        for (index, event) in events.iter().enumerate() {
            let want = expected.apply(event);
            let got = actual.apply(event);
            if got != want {
                let small = minimize(&events[..=index], mismatch);
                panic!(
                    "seed={seed}, index={index}, minimized={small:?}\nactual={got:?}\nexpected={want:?}"
                );
            }
            let name = format!("{event:?}")
                .split(['(', ' '])
                .next()
                .unwrap()
                .to_owned();
            *coverage.entry(name).or_default() += 1;
            let ok = match &got.reply {
                Reply::Unit(r) => r.is_ok(),
                Reply::Input(r) => r.is_ok(),
                Reply::Write(r) => r.is_ok(),
                Reply::Page(r) => r.is_ok(),
                Reply::Binding(r) => r.is_ok(),
                Reply::Operation(r) => r.is_ok(),
            };
            if ok {
                accepted += 1;
            } else {
                rejected += 1;
            }
            if let Reply::Page(Err(error)) = &got.reply {
                *coverage
                    .entry(format!("read_rejection_{error:?}"))
                    .or_default() += 1;
            }
            if matches!(
                (event, &got.reply),
                (Event::Resize(..), Reply::Unit(Err(CoreError::StaleView)))
            ) {
                *coverage.entry("stale_view_resizes".into()).or_default() += 1;
            }
            for (_, snapshot, usage) in &got.sessions {
                assert!(usage.queued <= 32 && usage.active <= 1 && usage.history <= 4096);
                assert!(usage.public_units <= 1048576 && usage.ui_bytes <= 1048576);
                if matches!(snapshot.state, State::Transferring | State::Reclaiming) {
                    transitioning += 1;
                }
            }
        }
    }
    for name in [
        "Connect",
        "Disconnect",
        "Open",
        "Connected",
        "Handoff",
        "Reclaim",
        "Submit",
        "StartWrite",
        "FinishWrite",
        "Receive",
        "Read",
        "CancelInput",
        "Tick",
        "CloseSession",
        "CloseApp",
        "BindView",
        "Resize",
        "StartIo",
        "FinishIo",
        "stale_view_resizes",
    ] {
        assert!(
            coverage.get(name).is_some_and(|count| *count > 0),
            "missing {name}"
        );
    }
    assert!(accepted > 0 && rejected > 0 && transitioning > 0);
    assert!(
        coverage
            .get("read_rejection_StaleControlEpoch")
            .copied()
            .unwrap_or(0)
            > 0,
        "stale_epoch_reads must be exercised"
    );
    assert!(
        coverage
            .get("read_rejection_StaleStream")
            .copied()
            .unwrap_or(0)
            > 0,
        "stale_stream_reads must be exercised"
    );
    println!(
        "MODEL seeds={seeds} events={} accepted={accepted} rejected={rejected} transition_observations={transitioning} coverage={coverage:?}",
        seeds * events_per_seed as u64
    );
}
#[test]
fn minimizer_preserves_the_two_ordered_causes() {
    let a = ConnectionId::from_u128(1);
    let b = ConnectionId::from_u128(2);
    let events = vec![
        Event::CloseApp,
        Event::Connect(a),
        Event::Tick(Duration::ZERO),
        Event::Disconnect(b),
        Event::CloseApp,
    ];
    let reduced = minimize(&events, |events| {
        let first = events.iter().position(|e| *e == Event::Connect(a));
        let second = events.iter().position(|e| *e == Event::Disconnect(b));
        matches!((first,second),(Some(x),Some(y)) if x<y)
    });
    assert_eq!(reduced, vec![Event::Connect(a), Event::Disconnect(b)]);
}
