use crate::*;
use std::time::Duration;

pub struct Session {
    pub(crate) id: SessionId,
    pub(crate) state: State,
    pub(crate) epoch: SafeInt,
    pub(crate) assigned: Option<ConnectionId>,
    pub(crate) stream: Option<StreamId>,
    pub(crate) close_reason: Option<CloseReason>,
}
impl Session {
    pub fn new(id: SessionId) -> Self {
        Self {
            id,
            state: State::Connecting,
            epoch: SafeInt::new(0).unwrap(),
            assigned: None,
            stream: None,
            close_reason: None,
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
        _now: Duration,
    ) -> Result<(), CoreError> {
        self.require_transition(State::UserOwned)?;
        self.advance_epoch()?;
        self.state = State::Transferring;
        self.assigned = Some(to);
        self.stream = Some(stream);
        self.state = State::AgentOwned;
        Ok(())
    }
    pub fn reclaim(&mut self, _now: Duration) -> Result<(), CoreError> {
        self.require_transition(State::AgentOwned)?;
        self.advance_epoch()?;
        self.state = State::Reclaiming;
        self.stream = None;
        self.state = State::UserOwned;
        Ok(())
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
    pub fn tick(&mut self, _now: Duration) {}
    pub fn close(&mut self, reason: CloseReason) {
        if self.state == State::Closed {
            return;
        }
        self.state = State::Closed;
        self.stream = None;
        self.close_reason = Some(reason);
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
