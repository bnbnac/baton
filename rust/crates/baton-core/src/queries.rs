use crate::*;
use std::{collections::BTreeMap, time::Duration};

enum Parser {
    Ground,
    Escape(Option<SafeInt>),
    Csi {
        bytes: [u8; 64],
        len: usize,
        origin: Option<SafeInt>,
        discarded: bool,
    },
    String {
        osc: bool,
    },
}
struct Pending {
    kind: QueryKind,
    epoch: SafeInt,
    created: Duration,
    claimed: bool,
}
pub(crate) struct Queries {
    parser: Parser,
    next: SafeInt,
    pending: BTreeMap<QueryId, Pending>,
}
impl Queries {
    pub fn new() -> Self {
        Self {
            parser: Parser::Ground,
            next: SafeInt::new(0).unwrap(),
            pending: BTreeMap::new(),
        }
    }
    pub fn invalidate(&mut self) {
        self.pending.clear();
    }
    pub fn receive(
        &mut self,
        bytes: &[u8],
        origin: Option<SafeInt>,
        now: Duration,
    ) -> Result<Vec<QueryMark>, CoreError> {
        self.pending
            .retain(|_, p| now.saturating_sub(p.created) < Duration::from_secs(2));
        let mut marks = vec![];
        for (end_offset, byte) in bytes.iter().copied().enumerate() {
            let state = std::mem::replace(&mut self.parser, Parser::Ground);
            let mut issued = None;
            self.parser = match state {
                Parser::Ground => {
                    if byte == 0x1b {
                        Parser::Escape(origin)
                    } else {
                        Parser::Ground
                    }
                }
                Parser::Escape(start) => match byte {
                    b'[' => Parser::Csi {
                        bytes: [0; 64],
                        len: 0,
                        origin: start,
                        discarded: false,
                    },
                    b']' => Parser::String { osc: true },
                    b'P' | b'_' | b'^' | b'X' => Parser::String { osc: false },
                    0x1b => Parser::Escape(origin),
                    _ => Parser::Ground,
                },
                Parser::String { osc } => match byte {
                    0x1b => Parser::Escape(origin),
                    0x18 | 0x1a => Parser::Ground,
                    7 if osc => Parser::Ground,
                    _ => Parser::String { osc },
                },
                Parser::Csi {
                    mut bytes,
                    mut len,
                    origin: start,
                    mut discarded,
                } => {
                    if (0x40..=0x7e).contains(&byte) {
                        if !discarded && start.is_some() && start == origin {
                            let params = &bytes[..len];
                            let first = params
                                .iter()
                                .position(|b| *b != b'0')
                                .unwrap_or(params.len());
                            let kind = match (&params[first..], byte) {
                                (b"5", b'n') => Some(QueryKind::Dsr),
                                (b"6", b'n') => Some(QueryKind::Cpr),
                                (b"", b'c') => Some(QueryKind::Da),
                                _ => None,
                            };
                            issued = kind.map(|kind| (kind, start.unwrap()));
                        }
                        Parser::Ground
                    } else if byte == 0x1b {
                        Parser::Escape(origin)
                    } else if byte == 0x18 || byte == 0x1a {
                        Parser::Ground
                    } else {
                        if len == bytes.len() {
                            discarded = true;
                        } else {
                            bytes[len] = byte;
                            len += 1;
                        }
                        Parser::Csi {
                            bytes,
                            len,
                            origin: start,
                            discarded,
                        }
                    }
                }
            };
            if let Some((kind, epoch)) = issued {
                if self.pending.len() >= 32 {
                    return Err(CoreError::QueryLimit);
                }
                self.next = self.next.checked_next()?;
                let id = QueryId(self.next);
                self.pending.insert(
                    id,
                    Pending {
                        kind,
                        epoch,
                        created: now,
                        claimed: false,
                    },
                );
                marks.push(QueryMark {
                    id,
                    kind,
                    epoch,
                    end_offset,
                });
            }
        }
        Ok(marks)
    }
    pub fn prepare_reply(&mut self, call: &ReplyCall, now: Duration) -> Result<Vec<u8>, CoreError> {
        let p = self
            .pending
            .get_mut(&call.query)
            .ok_or(CoreError::UnknownQuery)?;
        if p.claimed {
            return Err(CoreError::UnknownQuery);
        }
        if p.epoch != call.epoch {
            return Err(CoreError::StaleControlEpoch);
        }
        if now.saturating_sub(p.created) >= Duration::from_secs(2) {
            self.pending.remove(&call.query);
            return Err(CoreError::QueryExpired);
        }
        if p.kind != call.kind {
            return Err(CoreError::WrongQueryKind);
        }
        let bytes = match call.kind {
            QueryKind::Dsr if call.row.is_none() && call.column.is_none() => b"\x1b[0n".to_vec(),
            QueryKind::Da if call.row.is_none() && call.column.is_none() => b"\x1b[?1;2c".to_vec(),
            QueryKind::Cpr => {
                let row = call
                    .row
                    .filter(|v| (1..=200).contains(v))
                    .ok_or(CoreError::InvalidPosition)?;
                let column = call
                    .column
                    .filter(|v| (1..=501).contains(v))
                    .ok_or(CoreError::InvalidPosition)?;
                format!("\x1b[{row};{column}R").into_bytes()
            }
            _ => return Err(CoreError::InvalidPosition),
        };
        p.claimed = true;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn query_counter_overflow_closes_without_issuing_wrapped_token() {
        let mut s = Session::new(SessionId::from_u128(1));
        s.connected().unwrap();
        s.queries.next = SafeInt::new(SafeInt::MAX).unwrap();
        assert_eq!(s.receive(b"\x1b[5n"), Err(CoreError::CounterExhausted));
        assert_eq!(s.snapshot().state, State::Closed);
        assert_eq!(s.close_reason(), Some(CloseReason::CounterExhausted));
        assert!(s.next_ui_chunk().is_none());
    }
}
