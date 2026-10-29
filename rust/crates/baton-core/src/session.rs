use crate::*;
use std::time::Duration;

#[derive(Clone, Copy)]
pub(crate) struct ReceiveScope {
    pub epoch: SafeInt,
    pub control_allowed: bool,
    pub public_allowed: bool,
    pub received_at: Duration,
}

pub struct Session {
    pub(crate) id: SessionId,
    pub(crate) state: State,
    pub(crate) epoch: SafeInt,
    pub(crate) assigned: Option<ConnectionId>,
    pub(crate) stream: Option<StreamId>,
    pub(crate) close_reason: Option<CloseReason>,
    pub(crate) inputs: crate::input::Inputs,
    pub(crate) controls: crate::geometry::Controls,
    pending_stream: Option<StreamId>,
    deadline: Option<Duration>,
    public: Option<PublicOutput>,
    pub(crate) ui: crate::ui_output::UiOutput,
    pub(crate) view: Option<ViewId>,
    pub(crate) queries: crate::queries::Queries,
    pub(crate) clock: Duration,
    pub(crate) intervention: Option<Intervention>,
}
impl Session {
    pub(crate) fn transition_deadline(&self) -> Option<Duration> {
        self.deadline
    }
    pub(crate) fn next_input(&self) -> Option<RequestId> {
        self.inputs.next_request()
    }
    pub fn receive(&mut self, bytes: &[u8]) -> Result<(), CoreError> {
        self.receive_scoped(bytes, self.receive_scope())
    }
    pub(crate) fn receive_scope(&self) -> ReceiveScope {
        ReceiveScope {
            epoch: self.epoch,
            control_allowed: matches!(self.state, State::UserOwned | State::AgentOwned),
            public_allowed: self.state == State::AgentOwned,
            received_at: self.clock,
        }
    }
    pub(crate) fn receive_scoped(
        &mut self,
        bytes: &[u8],
        scope: ReceiveScope,
    ) -> Result<(), CoreError> {
        if self.state == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        let origin = (scope.epoch == self.epoch
            && scope.control_allowed
            && matches!(self.state, State::UserOwned | State::AgentOwned))
        .then_some(scope.epoch);
        let queries = match self.queries.receive(bytes, origin, scope.received_at) {
            Ok(queries) => queries,
            Err(e) => {
                self.close(if e == CoreError::CounterExhausted {
                    CloseReason::CounterExhausted
                } else {
                    CloseReason::OutputOverload
                });
                return Err(e);
            }
        };
        if let Err(error) = self.ui.push(bytes, queries) {
            self.close(if error == CoreError::CounterExhausted {
                CloseReason::CounterExhausted
            } else {
                CloseReason::OutputOverload
            });
            return Err(error);
        }
        if self.state == State::AgentOwned && scope.public_allowed && scope.epoch == self.epoch {
            if let Err(error) = self
                .public
                .as_mut()
                .expect("AgentOwned has a public stream")
                .receive(bytes)
            {
                self.close(CloseReason::CounterExhausted);
                return Err(error);
            }
        }
        Ok(())
    }
    pub fn read(&self, call: &ReadCall) -> Result<ReadPage, CoreError> {
        self.authorize(Principal::Agent(call.connection), call.epoch)?;
        if self.stream != Some(call.stream) {
            return Err(CoreError::StaleStream);
        }
        self.public
            .as_ref()
            .expect("AgentOwned has a public stream")
            .read(call.cursor, call.limit)
    }
    pub fn next_ui_chunk(&mut self) -> Option<UiChunk> {
        self.ui.next()
    }
    pub fn ack_ui(&mut self, seq: SafeInt) -> Result<(), CoreError> {
        self.ui.ack(seq)
    }
    pub fn submit(&mut self, call: InputCall) -> Result<InputResult, CoreError> {
        self.authorize(call.principal, call.epoch)?;
        self.inputs.submit(call.request_id, call.payload)
    }
    pub fn input_result(
        &self,
        principal: Principal,
        epoch: SafeInt,
        id: RequestId,
    ) -> Result<InputResult, CoreError> {
        self.authorize(principal, epoch)?;
        self.inputs.result(id)
    }
    pub fn cancel_input(
        &mut self,
        principal: Principal,
        epoch: SafeInt,
        id: RequestId,
    ) -> Result<InputResult, CoreError> {
        self.authorize(principal, epoch)?;
        self.inputs.cancel(id)
    }
    pub(crate) fn authorize(&self, principal: Principal, epoch: SafeInt) -> Result<(), CoreError> {
        if let Principal::Agent(c) = principal {
            if self.assigned != Some(c) {
                return Err(CoreError::NotOwner);
            }
        }
        if self.state == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        let allowed = matches!(
            (principal, self.state),
            (Principal::User, State::UserOwned) | (Principal::Agent(_), State::AgentOwned)
        );
        if !allowed {
            return Err(CoreError::ControlUnavailable);
        }
        if self.epoch != epoch {
            return Err(CoreError::StaleControlEpoch);
        }
        Ok(())
    }
    pub fn start_write(&mut self) -> Option<WriteOp> {
        if !matches!(self.state, State::UserOwned | State::AgentOwned) || self.controls.active() {
            return None;
        }
        match self.inputs.start() {
            Ok(op) => op,
            Err(_) => {
                self.close(CloseReason::CounterExhausted);
                None
            }
        }
    }
    pub fn finish_write(&mut self, id: SafeInt, result: WriteResult) -> Result<(), CoreError> {
        self.inputs.finish(id, result)?;
        self.finish_transition();
        Ok(())
    }
    pub fn usage(&self) -> Usage {
        let mut usage = self.inputs.usage();
        usage.public_units = self.public.as_ref().map_or(0, PublicOutput::units);
        usage.ui_bytes = self.ui.bytes();
        usage
    }
    pub fn new(id: SessionId) -> Self {
        Self {
            id,
            state: State::Connecting,
            epoch: SafeInt::new(0).unwrap(),
            assigned: None,
            stream: None,
            close_reason: None,
            inputs: crate::input::Inputs::new(),
            controls: crate::geometry::Controls::new(),
            pending_stream: None,
            deadline: None,
            public: None,
            ui: crate::ui_output::UiOutput::new(),
            view: None,
            queries: crate::queries::Queries::new(),
            clock: Duration::ZERO,
            intervention: None,
        }
    }
    pub fn id(&self) -> SessionId {
        self.id
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            state: self.state,
            epoch: self.epoch,
            assigned: self.assigned,
            stream: self.stream,
            intervention: self.intervention.clone(),
        }
    }
    pub fn close_reason(&self) -> Option<CloseReason> {
        self.close_reason
    }
    pub fn connected(&mut self) -> Result<(), CoreError> {
        if self.state == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if self.state != State::Connecting {
            return Err(CoreError::ControlUnavailable);
        }
        self.state = State::UserOwned;
        Ok(())
    }
    pub fn handoff(
        &mut self,
        to: ConnectionId,
        stream: StreamId,
        now: Duration,
    ) -> Result<(), CoreError> {
        self.require_transition(State::UserOwned)?;
        self.advance_epoch()?;
        self.state = State::Transferring;
        self.assigned = Some(to);
        self.pending_stream = Some(stream);
        self.stream = None;
        self.begin_transition(now)?;
        Ok(())
    }
    pub fn reclaim(&mut self, now: Duration) -> Result<(), CoreError> {
        self.require_transition(State::AgentOwned)?;
        self.advance_epoch()?;
        self.state = State::Reclaiming;
        self.stream = None;
        self.begin_transition(now)?;
        Ok(())
    }
    fn begin_transition(&mut self, now: Duration) -> Result<(), CoreError> {
        self.intervention = None;
        self.clock = self.clock.max(now);
        self.queries.invalidate();
        self.public = None;
        self.controls.invalidate_replies();
        self.inputs.begin_epoch();
        self.deadline = now.checked_add(limits::TRANSITION_TIMEOUT);
        if self.deadline.is_none() {
            self.close(CloseReason::CounterExhausted);
            return Err(CoreError::CounterExhausted);
        }
        self.finish_transition();
        Ok(())
    }
    pub(crate) fn finish_transition(&mut self) {
        if self.inputs.active() || self.controls.active() {
            return;
        }
        match self.state {
            State::Transferring => {
                self.state = State::AgentOwned;
                self.stream = self.pending_stream.take();
                self.public = Some(PublicOutput::new(limits::PUBLIC_UNITS).unwrap());
            }
            State::Reclaiming => self.state = State::UserOwned,
            _ => return,
        }
        self.inputs.clear();
        self.deadline = None;
    }
    fn require_transition(&self, from: State) -> Result<(), CoreError> {
        match self.state {
            State::Closed => Err(CoreError::SessionClosed),
            State::Transferring | State::Reclaiming => Err(CoreError::Busy),
            state if state == from => Ok(()),
            _ => Err(CoreError::ControlUnavailable),
        }
    }
    fn advance_epoch(&mut self) -> Result<(), CoreError> {
        match self.epoch.checked_next() {
            Ok(next) => {
                self.epoch = next;
                Ok(())
            }
            Err(e) => {
                self.close(CloseReason::CounterExhausted);
                Err(e)
            }
        }
    }
    pub fn tick(&mut self, now: Duration) {
        self.clock = self.clock.max(now);
        if self.deadline.is_some_and(|end| now >= end) {
            self.close(CloseReason::TransitionTimeout);
        }
    }
    pub fn close(&mut self, reason: CloseReason) {
        if self.state == State::Closed {
            return;
        }
        self.state = State::Closed;
        self.intervention = None;
        self.stream = None;
        self.close_reason = Some(reason);
        self.inputs.clear();
        self.deadline = None;
        self.pending_stream = None;
        self.public = None;
        if reason != CloseReason::RemoteClosed {
            self.ui.clear();
        }
        self.queries.invalidate();
        self.controls.clear();
    }
    pub fn status_for(&self, connection: ConnectionId) -> Result<Snapshot, CoreError> {
        if self.assigned != Some(connection) {
            return Err(CoreError::NotOwner);
        }
        Ok(self.snapshot())
    }
    pub(crate) fn disconnected(&mut self, connection: ConnectionId) {
        if self.assigned != Some(connection) {
            return;
        }
        match self.state {
            State::UserOwned | State::Reclaiming => self.assigned = None,
            State::AgentOwned | State::Transferring => self.close(CloseReason::ConnectionLost),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_io_counter_overflow_closes_session_without_wrapping() {
        for counter in ["input", "public", "ui"] {
            let mut s = Session::new(SessionId::from_u128(1));
            s.connected().unwrap();
            let a = ConnectionId::from_u128(2);
            s.handoff(a, StreamId::from_u128(3), Duration::ZERO)
                .unwrap();
            let max = SafeInt::new(SafeInt::MAX).unwrap();
            match counter {
                "input" => {
                    s.inputs.sequence = max;
                    s.submit(InputCall {
                        principal: Principal::Agent(a),
                        epoch: s.epoch,
                        request_id: RequestId::from_u128(1),
                        payload: b"x".to_vec(),
                    })
                    .unwrap();
                    assert!(s.start_write().is_none());
                }
                "public" => {
                    s.public.as_mut().unwrap().end = max;
                    assert_eq!(s.receive(b"x"), Err(CoreError::CounterExhausted));
                }
                _ => {
                    s.ui.sequence = max;
                    assert_eq!(s.receive(b"x"), Err(CoreError::CounterExhausted));
                }
            }
            assert_eq!(s.state, State::Closed, "{counter}");
            assert_eq!(s.close_reason(), Some(CloseReason::CounterExhausted));
            assert!(s.next_ui_chunk().is_none());
            assert!(s.start_write().is_none());
        }
    }
    #[test]
    fn epoch_exhaustion_closes_instead_of_wrapping() {
        let mut s = Session::new(SessionId::from_u128(1));
        s.connected().unwrap();
        s.epoch = SafeInt::new(SafeInt::MAX).unwrap();
        assert_eq!(
            s.handoff(
                ConnectionId::from_u128(2),
                StreamId::from_u128(3),
                Duration::ZERO
            ),
            Err(CoreError::CounterExhausted)
        );
        assert_eq!(s.snapshot().state, State::Closed);
        assert_eq!(s.snapshot().epoch.get(), SafeInt::MAX);
        assert_eq!(s.close_reason(), Some(CloseReason::CounterExhausted));
    }
}
