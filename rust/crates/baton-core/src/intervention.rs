use crate::*;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InterventionState {
    Requested,
    Declined,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InterventionResult {
    Queued,
    Duplicate,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Intervention {
    pub request_id: RequestId,
    pub reason: String,
    pub state: InterventionState,
}
impl Session {
    pub fn request_user_control(
        &mut self,
        connection: ConnectionId,
        epoch: SafeInt,
        id: RequestId,
        reason: String,
    ) -> Result<InterventionResult, CoreError> {
        self.authorize(Principal::Agent(connection), epoch)?;
        if reason.len() > 2048 || reason.chars().any(char::is_control) {
            return Err(CoreError::InvalidReason);
        }
        if self.inputs.intervention_duplicate(id, &reason)? {
            return Ok(InterventionResult::Duplicate);
        }
        if self
            .intervention
            .as_ref()
            .is_some_and(|r| r.state == InterventionState::Requested)
        {
            return Err(CoreError::Busy);
        }
        self.inputs.record_intervention(id, &reason)?;
        self.intervention = Some(Intervention {
            request_id: id,
            reason,
            state: InterventionState::Requested,
        });
        Ok(InterventionResult::Queued)
    }
    /// Trusted desktop control only. Declining a notification never approves a command.
    pub fn decline_intervention(&mut self, epoch: SafeInt, id: RequestId) -> Result<(), CoreError> {
        if self.state == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if self.epoch != epoch {
            return Err(CoreError::StaleControlEpoch);
        }
        if self.state != State::AgentOwned {
            return Err(CoreError::ControlUnavailable);
        }
        let request = self
            .intervention
            .as_mut()
            .filter(|r| r.request_id == id)
            .ok_or(CoreError::UnknownId)?;
        request.state = InterventionState::Declined;
        Ok(())
    }
}
