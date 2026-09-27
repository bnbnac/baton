use baton_core::{
    ConnectionId, CoreError, Geometry, GeometryRequest, InputCall, InputResult, Principal,
    ReadCall, ReadPage, RequestId, SafeInt, SessionId, Snapshot, State, StreamId,
    TransportCompletion, TransportOp, Usage, ViewBinding, ViewId, WriteOp, WriteResult,
};
use std::time::Duration;
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Connect(ConnectionId),
    Disconnect(ConnectionId),
    Open(SessionId),
    Connected(SessionId),
    Handoff(SessionId, ConnectionId, StreamId),
    Reclaim(SessionId),
    Submit(SessionId, InputCall),
    StartWrite(SessionId),
    FinishWrite(SessionId, SafeInt, WriteResult),
    BindView(SessionId, ViewId),
    Resize(SessionId, GeometryRequest),
    StartIo(SessionId),
    FinishIo(SessionId, SafeInt, TransportCompletion),
    Receive(SessionId, Vec<u8>),
    Read(SessionId, ReadCall),
    CancelInput(SessionId, Principal, SafeInt, RequestId),
    Tick(Duration),
    CloseSession(SessionId),
    CloseApp,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reply {
    Unit(Result<(), CoreError>),
    Input(Result<InputResult, CoreError>),
    Write(Result<Option<WriteOp>, CoreError>),
    Page(Result<ReadPage, CoreError>),
    Binding(Result<ViewBinding, CoreError>),
    Operation(Result<Option<TransportOp>, CoreError>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    pub reply: Reply,
    pub sessions: Vec<(SessionId, Snapshot, Usage)>,
    pub sent: Vec<(SessionId, SafeInt, Vec<u8>)>,
    pub geometry: Vec<(SessionId, Geometry)>,
    pub resizes: Vec<(SessionId, SafeInt, Geometry)>,
}
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone)]
struct Input {
    id: RequestId,
    data: Vec<u8>,
    result: InputResult,
    started: bool,
}
struct Shell {
    phase: State,
    generation: u64,
    owner: Option<ConnectionId>,
    stream: Option<StreamId>,
    next_stream: Option<StreamId>,
    expires: Option<Duration>,
    sequence: u64,
    input: Vec<Input>,
    active: Option<(u64, RequestId)>,
    public: String,
    oldest: u64,
    ui_bytes: usize,
    view: Option<ViewId>,
    resize_seq: u64,
    geometry: Geometry,
    pending_size: Option<Geometry>,
    resizing: Option<(u64, Geometry)>,
    next_resize: Duration,
    control_turn: bool,
}
fn safe(n: u64) -> SafeInt {
    SafeInt::new(n).unwrap()
}
impl Shell {
    fn new() -> Self {
        Self {
            phase: State::Connecting,
            generation: 0,
            owner: None,
            stream: None,
            next_stream: None,
            expires: None,
            sequence: 0,
            input: Vec::new(),
            active: None,
            public: String::new(),
            oldest: 0,
            ui_bytes: 0,
            view: None,
            resize_seq: 0,
            geometry: Geometry {
                columns: 120,
                rows: 32,
            },
            pending_size: None,
            resizing: None,
            next_resize: Duration::ZERO,
            control_turn: true,
        }
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            state: self.phase,
            epoch: safe(self.generation),
            assigned: self.owner,
            stream: self.stream,
        }
    }
    fn usage(&self) -> Usage {
        Usage {
            queued: self
                .input
                .iter()
                .filter(|i| i.result == InputResult::Pending && !i.started)
                .count(),
            active: usize::from(self.active.is_some()),
            history: self.input.len(),
            input_bytes: self.input.iter().map(|i| i.data.len()).sum(),
            public_units: self.public.encode_utf16().count(),
            ui_bytes: self.ui_bytes,
        }
    }
    fn close(&mut self) {
        self.phase = State::Closed;
        self.stream = None;
        self.next_stream = None;
        self.expires = None;
        self.active = None;
        self.input.clear();
        self.public.clear();
        self.oldest = 0;
        self.ui_bytes = 0;
        self.pending_size = None;
        self.resizing = None;
    }
    fn control_error(&self, from: State) -> Option<CoreError> {
        if self.phase == State::Closed {
            Some(CoreError::SessionClosed)
        } else if matches!(self.phase, State::Transferring | State::Reclaiming) {
            Some(CoreError::Busy)
        } else if self.phase != from {
            Some(CoreError::ControlUnavailable)
        } else {
            None
        }
    }
    fn permission(&self, p: Principal, e: SafeInt) -> Result<(), CoreError> {
        if let Principal::Agent(c) = p {
            if self.owner != Some(c) {
                return Err(CoreError::NotOwner);
            }
        }
        if self.phase == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if !matches!(
            (p, self.phase),
            (Principal::User, State::UserOwned) | (Principal::Agent(_), State::AgentOwned)
        ) {
            return Err(CoreError::ControlUnavailable);
        }
        if e.get() != self.generation {
            return Err(CoreError::StaleControlEpoch);
        }
        Ok(())
    }
    fn transition(&mut self, phase: State, now: Duration) {
        self.generation += 1;
        self.phase = phase;
        self.stream = None;
        self.public.clear();
        self.oldest = 0;
        self.input
            .retain(|entry| self.active.is_some_and(|(_, id)| id == entry.id));
        self.expires = Some(now + Duration::from_secs(5));
        self.complete_transition();
    }
    fn complete_transition(&mut self) {
        if self.active.is_some() || self.resizing.is_some() {
            return;
        }
        if self.phase == State::Reclaiming {
            self.phase = State::UserOwned;
        } else if self.phase == State::Transferring {
            self.phase = State::AgentOwned;
            self.stream = self.next_stream.take();
        } else {
            return;
        }
        self.input.clear();
        self.expires = None;
    }
    fn submit(&mut self, call: &InputCall) -> Result<InputResult, CoreError> {
        self.permission(call.principal, call.epoch)?;
        if call.payload.len() > 16384 {
            return Err(CoreError::InputTooLarge);
        }
        if let Some(old) = self.input.iter().find(|i| i.id == call.request_id) {
            return if old.data == call.payload {
                Ok(old.result)
            } else {
                Err(CoreError::RequestIdConflict)
            };
        }
        if self.usage().queued >= 32 {
            return Err(CoreError::InputQueueFull);
        }
        if self.input.len() >= 4096 {
            return Err(CoreError::RequestHistoryFull);
        }
        self.input.push(Input {
            id: call.request_id,
            data: call.payload.clone(),
            result: InputResult::Pending,
            started: false,
        });
        Ok(InputResult::Pending)
    }
    fn start(&mut self) -> Option<WriteOp> {
        if !matches!(self.phase, State::UserOwned | State::AgentOwned)
            || self.active.is_some()
            || self.resizing.is_some()
        {
            return None;
        }
        let entry = self
            .input
            .iter_mut()
            .find(|i| i.result == InputResult::Pending && !i.started)?;
        self.sequence += 1;
        entry.started = true;
        self.active = Some((self.sequence, entry.id));
        Some(WriteOp {
            id: safe(self.sequence),
            payload: entry.data.clone(),
        })
    }
    fn bind(&mut self, id: SessionId, view: ViewId) -> Result<ViewBinding, CoreError> {
        if self.phase == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if self.view.is_some_and(|old| old != view) {
            self.close();
            return Err(CoreError::StaleView);
        }
        self.view = Some(view);
        Ok(ViewBinding {
            session: id,
            generation: view,
        })
    }
    fn resize(&mut self, id: SessionId, request: GeometryRequest) -> Result<(), CoreError> {
        if self.phase == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if request.binding.session != id || Some(request.binding.generation) != self.view {
            return Err(CoreError::StaleView);
        }
        let g = request.geometry;
        if g.columns < 20 || g.columns > 500 || g.rows < 5 || g.rows > 200 {
            return Err(CoreError::InvalidGeometry);
        }
        if request.resize_seq.get() <= self.resize_seq {
            return Err(CoreError::StaleResize);
        }
        self.resize_seq = request.resize_seq.get();
        self.pending_size = Some(g);
        Ok(())
    }
    fn start_io(&mut self, now: Duration) -> Option<TransportOp> {
        if self.active.is_some()
            || self.resizing.is_some()
            || !matches!(self.phase, State::UserOwned | State::AgentOwned)
        {
            return None;
        }
        if self.pending_size == Some(self.geometry) {
            self.pending_size = None;
        }
        let ready = now >= self.next_resize && self.pending_size.is_some();
        let input_ready = self
            .input
            .iter()
            .any(|i| i.result == InputResult::Pending && !i.started);
        if ready && (self.control_turn || !input_ready) {
            let g = self.pending_size.take().unwrap();
            self.sequence += 1;
            self.resizing = Some((self.sequence, g));
            self.next_resize = now + Duration::from_millis(100);
            self.control_turn = false;
            Some(TransportOp::Resize {
                seq: safe(self.sequence),
                geometry: g,
            })
        } else {
            let op = self.start();
            if op.is_some() {
                self.control_turn = true;
            }
            op.map(TransportOp::Input)
        }
    }
    fn finish_io(&mut self, id: SafeInt, result: TransportCompletion) -> Result<(), CoreError> {
        if let Some((seq, g)) = self.resizing {
            if id.get() != seq {
                return Err(CoreError::InvalidCompletion);
            }
            match result {
                TransportCompletion::Resize(Ok(())) => {
                    self.geometry = g;
                    self.resizing = None;
                    self.complete_transition();
                    Ok(())
                }
                TransportCompletion::Resize(Err(_)) => {
                    self.close();
                    Ok(())
                }
                _ => Err(CoreError::InvalidCompletion),
            }
        } else {
            match result {
                TransportCompletion::Data(r) => self.finish(id, r),
                _ => Err(CoreError::InvalidCompletion),
            }
        }
    }
    fn finish(&mut self, id: SafeInt, result: WriteResult) -> Result<(), CoreError> {
        let Some((op, request)) = self.active else {
            return Err(CoreError::InvalidCompletion);
        };
        if id.get() != op {
            return Err(CoreError::InvalidCompletion);
        }
        let entry = self.input.iter_mut().find(|i| i.id == request).unwrap();
        entry.result = match result {
            WriteResult::Delivered => InputResult::Delivered,
            WriteResult::Uncertain => InputResult::Uncertain,
        };
        self.active = None;
        self.complete_transition();
        Ok(())
    }
    fn cancel(
        &mut self,
        p: Principal,
        e: SafeInt,
        id: RequestId,
    ) -> Result<InputResult, CoreError> {
        self.permission(p, e)?;
        let entry = self
            .input
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or(CoreError::UnknownId)?;
        if entry.result == InputResult::Pending && !entry.started {
            entry.result = InputResult::InputInvalidated;
        }
        Ok(entry.result)
    }
    fn receive(&mut self, bytes: &[u8]) -> Result<(), CoreError> {
        if self.phase == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if self.ui_bytes + bytes.len() > 1048576 {
            self.close();
            return Err(CoreError::Capacity);
        }
        self.ui_bytes += bytes.len();
        if self.phase == State::AgentOwned {
            // Generated model events are complete valid Unicode. Byte splitting is covered separately.
            self.public.push_str(std::str::from_utf8(bytes).unwrap());
            while self.public.encode_utf16().count() > 1048576 {
                let first = self.public.remove(0);
                self.oldest += first.len_utf16() as u64;
            }
        }
        Ok(())
    }
    fn read(&self, call: &ReadCall) -> Result<ReadPage, CoreError> {
        self.permission(Principal::Agent(call.connection), call.epoch)?;
        if self.stream != Some(call.stream) {
            return Err(CoreError::StaleStream);
        }
        if call.limit < 2 || call.limit > 32768 {
            return Err(CoreError::InvalidLimit);
        }
        let end = self.oldest + self.public.encode_utf16().count() as u64;
        let cursor = call.cursor.get();
        if cursor < self.oldest {
            return Err(CoreError::CursorExpired {
                oldest: safe(self.oldest),
            });
        }
        if cursor > end {
            return Err(CoreError::InvalidCursor);
        }
        let mut boundaries = Vec::new();
        let mut position = self.oldest;
        for c in self.public.chars() {
            boundaries.push((position, c));
            position += c.len_utf16() as u64;
        }
        if cursor != end && !boundaries.iter().any(|(pos, _)| *pos == cursor) {
            return Err(CoreError::InvalidCursor);
        }
        let mut used = 0;
        let mut text = String::new();
        for (_, c) in boundaries.into_iter().filter(|(pos, _)| *pos >= cursor) {
            if used + c.len_utf16() > call.limit {
                break;
            }
            used += c.len_utf16();
            text.push(c);
        }
        let next = cursor + used as u64;
        Ok(ReadPage {
            text,
            next: safe(next),
            oldest: safe(self.oldest),
            end: safe(end),
            has_more: next < end,
        })
    }
}
pub struct Reference {
    connections: BTreeSet<ConnectionId>,
    shells: BTreeMap<SessionId, Shell>,
    now: Duration,
    sent: Vec<(SessionId, SafeInt, Vec<u8>)>,
    resizes: Vec<(SessionId, SafeInt, Geometry)>,
}
impl Reference {
    pub fn new() -> Self {
        Self {
            connections: BTreeSet::new(),
            shells: BTreeMap::new(),
            now: Duration::ZERO,
            sent: Vec::new(),
            resizes: Vec::new(),
        }
    }
    pub fn view(&self, id: SessionId) -> Option<Snapshot> {
        self.shells.get(&id).map(Shell::snapshot)
    }
    pub fn active(&self, id: SessionId) -> Option<SafeInt> {
        self.shells.get(&id)?.active.map(|(op, _)| safe(op))
    }
    pub fn active_io(&self, id: SessionId) -> Option<(SafeInt, TransportCompletion)> {
        let s = self.shells.get(&id)?;
        if let Some((seq, _)) = s.resizing {
            Some((safe(seq), TransportCompletion::Resize(Ok(()))))
        } else {
            s.active
                .map(|(seq, _)| (safe(seq), TransportCompletion::Data(WriteResult::Delivered)))
        }
    }
    pub fn binding(&self, id: SessionId) -> ViewBinding {
        ViewBinding {
            session: id,
            generation: self
                .shells
                .get(&id)
                .and_then(|s| s.view)
                .unwrap_or(ViewId::from_u128(1)),
        }
    }
    pub fn apply(&mut self, event: &Event) -> Observation {
        let reply = self.step(event);
        Observation {
            reply,
            sessions: self
                .shells
                .iter()
                .map(|(id, s)| (*id, s.snapshot(), s.usage()))
                .collect(),
            sent: self.sent.clone(),
            geometry: self
                .shells
                .iter()
                .map(|(id, s)| (*id, s.geometry))
                .collect(),
            resizes: self.resizes.clone(),
        }
    }
    fn step(&mut self, event: &Event) -> Reply {
        match event {
            Event::BindView(id, v) => Reply::Binding(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.bind(*id, *v)),
            ),
            Event::Resize(id, r) => Reply::Unit(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.resize(*id, *r)),
            ),
            Event::StartIo(id) => {
                let result = self
                    .shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .map(|s| s.start_io(self.now));
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
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.finish_io(*seq, *r)),
            ),
            Event::Connect(c) => {
                let result = if self.connections.contains(c) {
                    Err(CoreError::DuplicateId)
                } else if self.connections.len() == 32 {
                    Err(CoreError::Capacity)
                } else {
                    self.connections.insert(*c);
                    Ok(())
                };
                Reply::Unit(result)
            }
            Event::Disconnect(c) => {
                if self.connections.remove(c) {
                    for shell in self.shells.values_mut().filter(|s| s.owner == Some(*c)) {
                        match shell.phase {
                            State::UserOwned | State::Reclaiming => shell.owner = None,
                            State::AgentOwned | State::Transferring => shell.close(),
                            _ => {}
                        }
                    }
                }
                Reply::Unit(Ok(()))
            }
            Event::Open(id) => {
                let result = if self.shells.contains_key(id) {
                    Err(CoreError::DuplicateId)
                } else if self.shells.len() == 16 {
                    Err(CoreError::Capacity)
                } else {
                    self.shells.insert(*id, Shell::new());
                    Ok(())
                };
                Reply::Unit(result)
            }
            Event::Tick(now) => {
                self.now = *now;
                for s in self.shells.values_mut() {
                    if s.expires.is_some_and(|end| *now >= end) {
                        s.close();
                    }
                }
                Reply::Unit(Ok(()))
            }
            Event::CloseApp => {
                for s in self.shells.values_mut() {
                    s.close();
                }
                Reply::Unit(Ok(()))
            }
            Event::Handoff(id, to, stream) => {
                if !self.connections.contains(to) {
                    return Reply::Unit(Err(CoreError::NotOwner));
                }
                let Some(s) = self.shells.get_mut(id) else {
                    return Reply::Unit(Err(CoreError::UnknownId));
                };
                if let Some(error) = s.control_error(State::UserOwned) {
                    return Reply::Unit(Err(error));
                }
                s.owner = Some(*to);
                s.next_stream = Some(*stream);
                s.transition(State::Transferring, self.now);
                Reply::Unit(Ok(()))
            }
            Event::Connected(id) => Reply::Unit(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| {
                        if s.phase == State::Closed {
                            Err(CoreError::SessionClosed)
                        } else if s.phase != State::Connecting {
                            Err(CoreError::ControlUnavailable)
                        } else {
                            s.phase = State::UserOwned;
                            Ok(())
                        }
                    }),
            ),
            Event::Reclaim(id) => Reply::Unit(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| {
                        if let Some(error) = s.control_error(State::AgentOwned) {
                            Err(error)
                        } else {
                            s.transition(State::Reclaiming, self.now);
                            Ok(())
                        }
                    }),
            ),
            Event::Submit(id, call) => Reply::Input(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.submit(call)),
            ),
            Event::StartWrite(id) => {
                let result = self
                    .shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .map(Shell::start);
                if let Ok(Some(op)) = &result {
                    self.sent.push((*id, op.id, op.payload.clone()));
                }
                Reply::Write(result)
            }
            Event::FinishWrite(id, op, result) => Reply::Unit(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.finish(*op, *result)),
            ),
            Event::Receive(id, bytes) => Reply::Unit(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.receive(bytes)),
            ),
            Event::Read(id, call) => Reply::Page(
                self.shells
                    .get(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.read(call)),
            ),
            Event::CancelInput(id, p, e, req) => Reply::Input(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .and_then(|s| s.cancel(*p, *e, *req)),
            ),
            Event::CloseSession(id) => Reply::Unit(
                self.shells
                    .get_mut(id)
                    .ok_or(CoreError::UnknownId)
                    .map(Shell::close),
            ),
        }
    }
}
