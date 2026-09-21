use super::reference::{Event, Reference};
use baton_core::*;
use std::time::Duration;
fn n(value: u64) -> SafeInt {
    SafeInt::new(value).unwrap()
}
fn next(seed: &mut u64) -> u64 {
    *seed = seed.wrapping_add(0x9E3779B97F4A7C15);
    let mut z = *seed;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}
fn call(owner: ConnectionId, epoch: u64, id: u128, text: &[u8]) -> InputCall {
    InputCall {
        principal: Principal::Agent(owner),
        epoch: n(epoch),
        request_id: RequestId::from_u128(id),
        payload: text.to_vec(),
    }
}
pub fn generate(mut seed: u64, max_events: usize) -> Vec<Event> {
    let a = ConnectionId::from_u128(1);
    let b = ConnectionId::from_u128(2);
    let s = SessionId::from_u128(1);
    let prefix = vec![
        Event::Connect(a),
        Event::Connect(b),
        Event::Open(s),
        Event::Connected(s),
        Event::Receive(s, b"PRIVATE".to_vec()),
        Event::Handoff(s, a, StreamId::from_u128(1)),
        Event::Submit(s, call(a, 1, 1, b"ONE")),
        Event::Submit(s, call(a, 1, 1, b"ONE")),
        Event::Submit(s, call(a, 1, 1, b"CONFLICT")),
        Event::Submit(s, call(a, 1, 2, b"CANCEL")),
        Event::CancelInput(s, Principal::Agent(a), n(1), RequestId::from_u128(2)),
        Event::StartWrite(s),
        Event::Reclaim(s),
        Event::Receive(s, b"HIDDEN".to_vec()),
        Event::FinishWrite(s, n(1), WriteResult::Delivered),
        Event::Handoff(s, b, StreamId::from_u128(2)),
        Event::Submit(s, call(a, 1, 1, b"STALE")),
        Event::Submit(s, call(b, 3, 1, b"ACTIVE")),
        Event::StartWrite(s),
        Event::Receive(s, "한😀".as_bytes().to_vec()),
        Event::Read(
            s,
            ReadCall {
                connection: b,
                epoch: n(3),
                stream: StreamId::from_u128(2),
                cursor: n(0),
                limit: 2,
            },
        ),
        Event::Tick(Duration::from_millis(4999)),
        Event::Reclaim(s),
        Event::Tick(Duration::from_millis(9998)),
        Event::Tick(Duration::from_millis(9999)),
        Event::FinishWrite(s, n(2), WriteResult::Uncertain),
        Event::Disconnect(b),
        Event::CloseSession(s),
        Event::Connect(b),
        Event::Open(SessionId::from_u128(2)),
        Event::Connected(SessionId::from_u128(2)),
        Event::Handoff(SessionId::from_u128(2), a, StreamId::from_u128(3)),
    ];
    let mut reference = Reference::new();
    let mut events = Vec::new();
    let mut clock = 0;
    for event in prefix.into_iter().take(max_events) {
        if let Event::Tick(now) = event {
            clock = now.as_millis() as u64;
        }
        reference.apply(&event);
        events.push(event);
    }
    while events.len() < max_events {
        let r = next(&mut seed);
        let id = SessionId::from_u128(((r >> 8) % 18 + 1).into());
        let view = reference.view(id);
        let epoch = if r % 4 != 0 {
            view.as_ref().map_or(n(0), |s| s.epoch)
        } else {
            n((r >> 18) % 8)
        };
        let owner = if r % 5 != 0 {
            view.as_ref().and_then(|s| s.assigned).unwrap_or(a)
        } else {
            b
        };
        let principal = if r % 3 == 0 {
            Principal::User
        } else {
            Principal::Agent(owner)
        };
        let request = RequestId::from_u128(((r >> 24) % 8).into());
        let payload = match (r >> 32) % 3 {
            0 => b"X".to_vec(),
            1 => "한😀".as_bytes().to_vec(),
            _ => b"\x1b[31mR".to_vec(),
        };
        let stream = if r % 4 != 0 {
            view.as_ref()
                .and_then(|s| s.stream)
                .unwrap_or(StreamId::from_u128(0))
        } else {
            StreamId::from_u128(900)
        };
        let event = if events.len() + 1 == max_events {
            Event::CloseApp
        } else {
            match r % 32 {
                0 => Event::Connect(ConnectionId::from_u128(((r >> 16) % 34).into())),
                1 => Event::Disconnect(if r & 64 == 0 { a } else { b }),
                2 | 3 => Event::Open(id),
                4 | 5 => Event::Connected(id),
                6..=9 => Event::Handoff(id, owner, StreamId::from_u128(events.len() as u128 + 100)),
                10..=12 => Event::Reclaim(id),
                13..=19 => Event::Submit(
                    id,
                    InputCall {
                        principal,
                        epoch,
                        request_id: request,
                        payload,
                    },
                ),
                20 | 21 => Event::StartWrite(id),
                22 | 23 => Event::FinishWrite(
                    id,
                    if r % 3 != 0 {
                        reference.active(id).unwrap_or(n(1))
                    } else {
                        n((r >> 16) % 8)
                    },
                    if r & 64 == 0 {
                        WriteResult::Delivered
                    } else {
                        WriteResult::Uncertain
                    },
                ),
                24 | 25 => Event::Receive(id, payload),
                26 | 27 => Event::Read(
                    id,
                    ReadCall {
                        connection: owner,
                        epoch,
                        stream,
                        cursor: n((r >> 40) % 8),
                        limit: [0, 1, 2, 32, 32769][((r >> 48) % 5) as usize],
                    },
                ),
                28 => Event::CancelInput(id, principal, epoch, request),
                29 | 30 => {
                    clock += [0, 1, 4999, 5000][((r >> 16) % 4) as usize];
                    Event::Tick(Duration::from_millis(clock))
                }
                _ => Event::CloseSession(id),
            }
        };
        reference.apply(&event);
        events.push(event);
    }
    events
}
pub fn minimize(events: &[Event], fails: impl Fn(&[Event]) -> bool) -> Vec<Event> {
    let mut kept = events.to_vec();
    let mut width = kept.len();
    while width > 0 {
        let mut index = 0;
        while index + width <= kept.len() {
            let mut candidate = kept.clone();
            candidate.drain(index..index + width);
            if fails(&candidate) {
                kept = candidate;
                index = 0;
            } else {
                index += 1;
            }
        }
        width -= 1;
    }
    kept
}
