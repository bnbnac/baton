use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Dsr,
    Cpr,
    Da,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub id: String,
    pub kind: Kind,
    pub end_offset: usize,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reply {
    pub session_id: String,
    pub epoch: u64,
    pub query_id: String,
    pub kind: Kind,
    pub row: Option<u16>,
    pub column: Option<u16>,
}
use std::collections::HashMap;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
enum Parser {
    Ground,
    Escape,
    Csi(Vec<u8>),
    String(bool),
}
pub struct Queries {
    session: String,
    epoch: u64,
    seq: u64,
    next: u64,
    parser: Parser,
    pending: HashMap<String, (Kind, u64)>,
}
impl Queries {
    pub fn new(session: &str, epoch: u64) -> Self {
        Self {
            session: session.into(),
            epoch,
            seq: 0,
            next: 0,
            parser: Parser::Ground,
            pending: HashMap::new(),
        }
    }
    pub fn receive(
        &mut self,
        seq: u64,
        bytes: &[u8],
        now: u64,
    ) -> Result<Vec<Query>, &'static str> {
        if seq > MAX_SAFE || seq <= self.seq || self.epoch > MAX_SAFE {
            return Err("invalid_sequence");
        }
        self.seq = seq;
        self.pending
            .retain(|_, (_, created)| now.saturating_sub(*created) < 2000);
        let mut result = Vec::new();
        for (offset, byte) in bytes.iter().copied().enumerate() {
            let state = std::mem::replace(&mut self.parser, Parser::Ground);
            let mut kind = None;
            self.parser = match state {
                Parser::Ground => {
                    if byte == 0x1b {
                        Parser::Escape
                    } else {
                        Parser::Ground
                    }
                }
                Parser::Escape => match byte {
                    b'[' => Parser::Csi(Vec::new()),
                    b']' => Parser::String(true),
                    b'P' | b'_' | b'^' | b'X' => Parser::String(false),
                    0x1b => Parser::Escape,
                    _ => Parser::Ground,
                },
                Parser::Csi(mut params) => {
                    if (0x40..=0x7e).contains(&byte) {
                        params.push(byte);
                        let first = params
                            .iter()
                            .position(|b| *b != b'0')
                            .unwrap_or(params.len());
                        kind = match &params[first..] {
                            b"5n" => Some(Kind::Dsr),
                            b"6n" => Some(Kind::Cpr),
                            b"c" => Some(Kind::Da),
                            _ => None,
                        };
                        Parser::Ground
                    } else if byte == 0x1b {
                        Parser::Escape
                    } else if params.len() >= 64 || byte == 0x18 || byte == 0x1a {
                        Parser::Ground
                    } else {
                        params.push(byte);
                        Parser::Csi(params)
                    }
                }
                Parser::String(osc) => {
                    if byte == 0x1b {
                        // xterm terminates the string on ESC; the next byte is
                        // parsed as an escape command, including a new CSI.
                        Parser::Escape
                    } else if byte == 0x18 || byte == 0x1a || (osc && byte == 7) {
                        Parser::Ground
                    } else {
                        Parser::String(osc)
                    }
                }
            };
            if let Some(kind) = kind {
                if self.pending.len() >= 32 {
                    return Err("query_limit");
                }
                self.next = self
                    .next
                    .checked_add(1)
                    .filter(|v| *v <= MAX_SAFE)
                    .ok_or("sequence_overflow")?;
                let id = format!("{}:{}:{}", self.session, self.epoch, self.next);
                self.pending.insert(id.clone(), (kind, now));
                result.push(Query {
                    id,
                    kind,
                    end_offset: offset,
                });
            }
        }
        Ok(result)
    }
    pub fn reply(&mut self, reply: Reply, now: u64) -> Result<Vec<u8>, &'static str> {
        if reply.session_id != self.session || reply.epoch != self.epoch || reply.epoch > MAX_SAFE {
            return Err("not_owner");
        }
        let (kind, created) = *self.pending.get(&reply.query_id).ok_or("unknown_query")?;
        if now.saturating_sub(created) >= 2000 {
            self.pending.remove(&reply.query_id);
            return Err("query_expired");
        }
        if kind != reply.kind {
            return Err("wrong_kind");
        }
        let bytes = match kind {
            Kind::Cpr => {
                let row = reply
                    .row
                    .filter(|v| (1..=200).contains(v))
                    .ok_or("invalid_position")?;
                let column = reply
                    .column
                    // xterm keeps a virtual column after the rightmost cell until wrap.
                    // A 500-column PTY therefore reports CPR column 501 in this state.
                    .filter(|v| (1..=501).contains(v))
                    .ok_or("invalid_position")?;
                format!("\x1b[{row};{column}R").into_bytes()
            }
            Kind::Dsr if reply.row.is_none() && reply.column.is_none() => b"\x1b[0n".to_vec(),
            Kind::Da if reply.row.is_none() && reply.column.is_none() => b"\x1b[?1;2c".to_vec(),
            _ => return Err("invalid_position"),
        };
        self.pending.remove(&reply.query_id);
        Ok(bytes)
    }
    pub fn transition(&mut self, epoch: u64) -> Result<(), &'static str> {
        if epoch > MAX_SAFE || epoch <= self.epoch {
            return Err("invalid_epoch");
        }
        self.epoch = epoch;
        self.pending.clear();
        Ok(())
    }
    pub fn pending(&self) -> usize {
        self.pending.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cpr(q: &Query) -> Reply {
        Reply {
            session_id: "s".into(),
            epoch: 1,
            query_id: q.id.clone(),
            kind: Kind::Cpr,
            row: Some(2),
            column: Some(3),
        }
    }
    #[test]
    fn fragmented_cpr_is_matched_and_consumed_once() {
        for split in 1..4 {
            let mut tracker = Queries::new("s", 1);
            assert!(
                tracker
                    .receive(1, &b"\x1b[6n"[..split], 0)
                    .unwrap()
                    .is_empty()
            );
            let queries = tracker.receive(2, &b"\x1b[6n"[split..], 0).unwrap();
            assert_eq!(queries.len(), 1);
            assert_eq!(tracker.reply(cpr(&queries[0]), 1).unwrap(), b"\x1b[2;3R");
            assert!(tracker.reply(cpr(&queries[0]), 1).is_err());
        }
    }
    #[test]
    fn expiry_owner_epoch_and_kind_are_enforced() {
        let mut tracker = Queries::new("s", 1);
        let qs = tracker.receive(1, b"\x1b[6n", 0).unwrap();
        assert_eq!(qs.len(), 1);
        let mut other = cpr(&qs[0]);
        other.session_id = "other".into();
        assert!(tracker.reply(other, 1).is_err());
        let mut stale = cpr(&qs[0]);
        stale.epoch = 0;
        assert!(tracker.reply(stale, 1).is_err());
        let mut wrong = cpr(&qs[0]);
        wrong.kind = Kind::Da;
        assert!(tracker.reply(wrong, 1).is_err());
        let mut out_of_range = cpr(&qs[0]);
        out_of_range.row = Some(201);
        assert!(tracker.reply(out_of_range, 1).is_err());
        assert!(tracker.reply(cpr(&qs[0]), 2000).is_err());
    }
    #[test]
    fn replay_and_overflow_do_not_create_live_queries() {
        let mut tracker = Queries::new("s", 1);
        let qs = tracker.receive(1, b"\x1b[6n", 0).unwrap();
        assert_eq!(qs.len(), 1);
        assert!(tracker.receive(1, b"\x1b[6n", 0).is_err());
        tracker.transition(2).unwrap();
        assert_eq!(tracker.pending(), 0);
        assert!(tracker.reply(cpr(&qs[0]), 1).is_err());
        assert!(tracker.receive(9_007_199_254_740_992, b"", 1).is_err());
        assert!(tracker.transition(9_007_199_254_740_992).is_err());
    }
    #[test]
    fn escape_interrupts_osc_and_dcs_like_xterm() {
        let mut tracker = Queries::new("s", 1);
        let qs = tracker
            .receive(1, b"\x1b]52;c;\x1b[6n\x07\x1bP\x1b[6n\x1b\\\x1b[5n", 0)
            .unwrap();
        assert_eq!(qs.len(), 3);
        assert_eq!(
            qs.iter().map(|q| q.kind).collect::<Vec<_>>(),
            [Kind::Cpr, Kind::Cpr, Kind::Dsr]
        );
        assert!(
            tracker
                .receive(2, b"\x1b]0;literal[6n\x07\x1bPqliteral[6n\x1b\\", 0)
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn leading_zero_queries_follow_xterm_numeric_parameters() {
        let mut tracker = Queries::new("s", 1);
        let qs = tracker
            .receive(1, b"\x1b[06n\x1b[005n\x1b[000c", 0)
            .unwrap();
        assert_eq!(
            qs.iter().map(|q| q.kind).collect::<Vec<_>>(),
            [Kind::Cpr, Kind::Dsr, Kind::Da]
        );
    }
    #[test]
    fn thirty_third_query_is_rejected_without_growing_pending() {
        let mut tracker = Queries::new("s", 1);
        assert_eq!(
            tracker.receive(1, &b"\x1b[6n".repeat(32), 0).unwrap().len(),
            32
        );
        assert!(tracker.receive(2, b"\x1b[6n", 0).is_err());
        assert!(tracker.pending() <= 32);
    }
}
