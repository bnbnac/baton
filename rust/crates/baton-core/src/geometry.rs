use crate::*;
use std::{collections::VecDeque, time::Duration};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Geometry {
    pub columns: u16,
    pub rows: u16,
}
impl Geometry {
    pub fn new(columns: u16, rows: u16) -> Result<Self, CoreError> {
        if !(20..=500).contains(&columns) || !(5..=200).contains(&rows) {
            return Err(CoreError::InvalidGeometry);
        }
        Ok(Self { columns, rows })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GeometryRequest {
    pub binding: ViewBinding,
    pub resize_seq: SafeInt,
    pub geometry: Geometry,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportError {
    Disconnected,
    Failed,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransportOp {
    Input(WriteOp),
    Reply {
        seq: SafeInt,
        query: QueryId,
        bytes: Vec<u8>,
    },
    Resize {
        seq: SafeInt,
        geometry: Geometry,
    },
}
impl TransportOp {
    pub fn seq(&self) -> SafeInt {
        match self {
            Self::Input(op) => op.id,
            Self::Reply { seq, .. } | Self::Resize { seq, .. } => *seq,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportCompletion {
    Data(WriteResult),
    Resize(Result<(), TransportError>),
}
#[derive(Clone, Copy)]
enum ActiveKind {
    Reply(QueryId),
    Resize(Geometry),
}
struct QueuedReply {
    call: ReplyCall,
    bytes: Vec<u8>,
}
pub(crate) struct Controls {
    active: Option<(SafeInt, ActiveKind)>,
    replies: VecDeque<QueuedReply>,
    pending: Option<GeometryRequest>,
    latest_seq: SafeInt,
    last_sent: Geometry,
    last_started: Option<Duration>,
    prefer_control: bool,
    prefer_resize: bool,
}
impl Controls {
    pub fn new() -> Self {
        Self {
            active: None,
            replies: VecDeque::new(),
            pending: None,
            latest_seq: SafeInt::new(0).unwrap(),
            last_sent: Geometry {
                columns: 120,
                rows: 32,
            },
            last_started: None,
            prefer_control: true,
            prefer_resize: false,
        }
    }
    pub fn active(&self) -> bool {
        self.active.is_some()
    }
    pub fn invalidate_replies(&mut self) {
        self.replies.clear();
    }
    pub fn clear(&mut self) {
        self.active = None;
        self.replies.clear();
        self.pending = None;
    }
}
impl Session {
    pub fn resize(&mut self, request: GeometryRequest) -> Result<(), CoreError> {
        self.validate_view(request.binding)?;
        Geometry::new(request.geometry.columns, request.geometry.rows)?;
        if request.resize_seq <= self.controls.latest_seq {
            return Err(CoreError::StaleResize);
        }
        self.controls.latest_seq = request.resize_seq;
        self.controls.pending = Some(request);
        Ok(())
    }
    pub fn geometry(&self) -> Geometry {
        self.controls.last_sent
    }
    pub fn queue_reply(&mut self, call: ReplyCall) -> Result<(), CoreError> {
        let bytes = self.prepare_reply(call.clone())?;
        self.controls.replies.push_back(QueuedReply { call, bytes });
        Ok(())
    }
    pub fn start_transport_op(&mut self, now: Duration) -> Option<TransportOp> {
        self.tick(now);
        if !matches!(self.state, State::UserOwned | State::AgentOwned)
            || self.inputs.active()
            || self.controls.active()
        {
            return None;
        }
        if self.controls.prefer_control {
            if let Some(op) = self.start_control(now) {
                self.controls.prefer_control = false;
                return Some(op);
            }
        }
        if let Some(op) = self.start_write() {
            self.controls.prefer_control = true;
            return Some(TransportOp::Input(op));
        }
        let op = self.start_control(now);
        if op.is_some() {
            self.controls.prefer_control = false;
        }
        op
    }
    fn start_control(&mut self, now: Duration) -> Option<TransportOp> {
        if self.state == State::Closed {
            return None;
        }
        while let Some(reply) = self.controls.replies.front() {
            if self.validate_view(reply.call.binding).is_ok()
                && self.queries.claimed_live(reply.call.query, self.epoch, now)
            {
                break;
            }
            let reply = self.controls.replies.pop_front().unwrap();
            self.queries.release(reply.call.query);
        }
        if self.controls.pending.is_some_and(|r| {
            self.validate_view(r.binding).is_err() || r.geometry == self.controls.last_sent
        }) {
            self.controls.pending = None;
        }
        let resize_ready = self.controls.pending.is_some()
            && self
                .controls
                .last_started
                .is_none_or(|last| now.saturating_sub(last) >= Duration::from_millis(100));
        let resize =
            resize_ready && (self.controls.prefer_resize || self.controls.replies.is_empty());
        if !resize && self.controls.replies.is_empty() {
            return None;
        }
        let seq = match self.inputs.reserve_sequence() {
            Ok(seq) => seq,
            Err(_) => {
                self.close(CloseReason::CounterExhausted);
                return None;
            }
        };
        if resize {
            let geometry = self.controls.pending.take().unwrap().geometry;
            self.controls.last_started = Some(now);
            self.controls.prefer_resize = false;
            self.controls.active = Some((seq, ActiveKind::Resize(geometry)));
            Some(TransportOp::Resize { seq, geometry })
        } else {
            let reply = self.controls.replies.pop_front().unwrap();
            self.controls.prefer_resize = true;
            self.controls.active = Some((seq, ActiveKind::Reply(reply.call.query)));
            Some(TransportOp::Reply {
                seq,
                query: reply.call.query,
                bytes: reply.bytes,
            })
        }
    }
    pub fn finish_transport_op(
        &mut self,
        seq: SafeInt,
        result: TransportCompletion,
        now: Duration,
    ) -> Result<(), CoreError> {
        self.tick(now);
        let Some((active, kind)) = self.controls.active else {
            return match result {
                TransportCompletion::Data(result) => self.finish_write(seq, result),
                _ => Err(CoreError::InvalidCompletion),
            };
        };
        if active != seq {
            return Err(CoreError::InvalidCompletion);
        }
        match (kind, result) {
            (ActiveKind::Reply(query), TransportCompletion::Data(_)) => self.queries.release(query),
            (ActiveKind::Resize(geometry), TransportCompletion::Resize(Ok(()))) => {
                self.controls.last_sent = geometry
            }
            (ActiveKind::Resize(_), TransportCompletion::Resize(Err(_))) => {
                self.close(CloseReason::TransportLost);
                return Ok(());
            }
            _ => return Err(CoreError::InvalidCompletion),
        }
        self.controls.active = None;
        self.finish_transition();
        Ok(())
    }
    pub(crate) fn io_deadline(&self) -> Option<Duration> {
        if let Some(deadline) = self.transition_deadline() {
            return Some(deadline);
        }
        if self.inputs.active()
            || self.controls.active()
            || !matches!(self.state, State::UserOwned | State::AgentOwned)
        {
            return None;
        }
        self.controls
            .pending
            .and(self.controls.last_started)
            .and_then(|last| last.checked_add(Duration::from_millis(100)))
            .filter(|deadline| *deadline > self.clock)
    }
}
impl SessionHandle {
    pub async fn resize(&self, request: GeometryRequest) -> Result<(), CoreError> {
        let result = self.with_session(|s| s.resize(request));
        self.wake_driver();
        result
    }
    pub async fn geometry(&self) -> Geometry {
        self.with_session(|s| s.geometry())
    }
    pub async fn protocol_reply(&self, call: ReplyCall) -> Result<(), CoreError> {
        let result = self.with_session(|s| s.queue_reply(call));
        self.wake_driver();
        result
    }
}
