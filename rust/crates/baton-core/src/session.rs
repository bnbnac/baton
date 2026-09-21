use crate::*;
use std::time::Duration;

pub struct Session {
    pub(crate) id: SessionId,
    pub(crate) state: State,
    pub(crate) epoch: SafeInt,
    pub(crate) assigned: Option<ConnectionId>,
    pub(crate) stream: Option<StreamId>,
    pub(crate) close_reason: Option<CloseReason>,
    inputs: crate::input::Inputs,
    pending_stream: Option<StreamId>,
    deadline: Option<Duration>,
}
impl Session {
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
        if !matches!(self.state, State::UserOwned | State::AgentOwned) {
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
        self.inputs.usage()
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
            pending_stream: None,
            deadline: None,
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
        self.inputs.begin_epoch();
        self.deadline = now.checked_add(limits::TRANSITION_TIMEOUT);
        if self.deadline.is_none() {
            self.close(CloseReason::CounterExhausted);
            return Err(CoreError::CounterExhausted);
        }
        self.finish_transition();
        Ok(())
    }
    fn finish_transition(&mut self) {
        if self.inputs.active() {
            return;
        }
        match self.state {
            State::Transferring => {
                self.state = State::AgentOwned;
                self.stream = self.pending_stream.take();
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
        if self.deadline.is_some_and(|end| now >= end) {
            self.close(CloseReason::TransitionTimeout);
        }
    }
    pub fn close(&mut self, reason: CloseReason) {
        if self.state == State::Closed {
            return;
        }
        self.state = State::Closed;
        self.stream = None;
        self.close_reason = Some(reason);
        self.inputs.clear();
        self.deadline = None;
        self.pending_stream = None;
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
