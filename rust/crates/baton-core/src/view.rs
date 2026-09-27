use crate::*;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ViewBinding {
    pub session: SessionId,
    pub generation: ViewId,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct QueryId(pub SafeInt);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueryKind {
    Dsr,
    Cpr,
    Da,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueryMark {
    pub id: QueryId,
    pub kind: QueryKind,
    pub epoch: SafeInt,
    pub end_offset: usize,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UiFrame {
    pub binding: ViewBinding,
    pub seq: SafeInt,
    pub bytes: Vec<u8>,
    pub queries: Vec<QueryMark>,
}
#[derive(Clone, Debug)]
pub struct ReplyCall {
    pub binding: ViewBinding,
    pub epoch: SafeInt,
    pub query: QueryId,
    pub kind: QueryKind,
    pub row: Option<u16>,
    pub column: Option<u16>,
}
impl Session {
    pub fn bind_view(&mut self, generation: ViewId) -> Result<ViewBinding, CoreError> {
        if self.state == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if self.view.is_some_and(|old| old != generation) {
            self.close(CloseReason::FrontendLost);
            return Err(CoreError::StaleView);
        }
        self.view = Some(generation);
        Ok(ViewBinding {
            session: self.id,
            generation,
        })
    }
    pub(crate) fn validate_view(&self, binding: ViewBinding) -> Result<(), CoreError> {
        if self.state == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        if binding.session != self.id || self.view != Some(binding.generation) {
            return Err(CoreError::StaleView);
        }
        Ok(())
    }
    pub fn next_ui_frame(&mut self, binding: ViewBinding) -> Result<Option<UiFrame>, CoreError> {
        self.validate_view(binding)?;
        Ok(self.next_ui_chunk().map(|chunk| UiFrame {
            binding,
            seq: chunk.seq,
            bytes: chunk.bytes,
            queries: chunk.queries,
        }))
    }
    pub fn ack_ui_frame(&mut self, binding: ViewBinding, seq: SafeInt) -> Result<(), CoreError> {
        self.validate_view(binding)?;
        self.ack_ui(seq)
    }
    /// Trusted core control assembly; returns only bytes derived from a live query.
    pub fn prepare_reply(&mut self, reply: ReplyCall) -> Result<Vec<u8>, CoreError> {
        self.validate_view(reply.binding)?;
        if !matches!(self.state, State::UserOwned | State::AgentOwned) {
            return Err(CoreError::ControlUnavailable);
        }
        if reply.epoch != self.epoch {
            return Err(CoreError::StaleControlEpoch);
        }
        self.queries.prepare_reply(&reply, self.clock)
    }
}
impl SessionHandle {
    pub async fn bind_view(&self, generation: ViewId) -> Result<ViewBinding, CoreError> {
        self.with_session(|s| s.bind_view(generation))
    }
    pub async fn next_ui_frame(&self, binding: ViewBinding) -> Result<Option<UiFrame>, CoreError> {
        self.with_session(|s| s.next_ui_frame(binding))
    }
    pub async fn ack_ui_frame(&self, binding: ViewBinding, seq: SafeInt) -> Result<(), CoreError> {
        self.with_session(|s| s.ack_ui_frame(binding, seq))
    }
}
