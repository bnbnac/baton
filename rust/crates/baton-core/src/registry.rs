use crate::*;
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

pub struct Registry {
    app: AppId,
    connections: BTreeSet<ConnectionId>,
    pub(crate) sessions: BTreeMap<SessionId, Session>,
}
impl Registry {
    pub fn new(app: AppId) -> Self {
        Self {
            app,
            connections: BTreeSet::new(),
            sessions: BTreeMap::new(),
        }
    }
    pub fn app(&self) -> AppId {
        self.app
    }
    pub fn register_connection(&mut self, id: ConnectionId) -> Result<(), CoreError> {
        if self.connections.contains(&id) {
            return Err(CoreError::DuplicateId);
        }
        if self.connections.len() >= crate::limits::CONNECTIONS {
            return Err(CoreError::Capacity);
        }
        self.connections.insert(id);
        Ok(())
    }
    pub fn remove_connection(&mut self, id: ConnectionId) -> Result<(), CoreError> {
        if self.connections.remove(&id) {
            for s in self.sessions.values_mut() {
                s.disconnected(id);
            }
            Ok(())
        } else {
            Err(CoreError::UnknownId)
        }
    }
    pub fn has_connection(&self, id: ConnectionId) -> bool {
        self.connections.contains(&id)
    }
    pub fn insert_session(&mut self, session: Session) -> Result<(), CoreError> {
        if self.sessions.contains_key(&session.id()) {
            return Err(CoreError::DuplicateId);
        }
        if self.sessions.len() >= limits::SESSIONS {
            return Err(CoreError::Capacity);
        }
        self.sessions.insert(session.id(), session);
        Ok(())
    }
    pub fn session(&self, id: SessionId) -> Result<&Session, CoreError> {
        self.sessions.get(&id).ok_or(CoreError::UnknownId)
    }
    pub fn session_mut(&mut self, id: SessionId) -> Result<&mut Session, CoreError> {
        self.sessions.get_mut(&id).ok_or(CoreError::UnknownId)
    }
    pub fn status_for(&self, c: ConnectionId) -> Result<Vec<(SessionId, Snapshot)>, CoreError> {
        if !self.has_connection(c) {
            return Err(CoreError::NotOwner);
        }
        Ok(self
            .sessions
            .iter()
            .filter_map(|(id, s)| s.status_for(c).ok().map(|view| (*id, view)))
            .collect())
    }
    pub fn handoff(
        &mut self,
        id: SessionId,
        to: ConnectionId,
        stream: StreamId,
        now: Duration,
    ) -> Result<(), CoreError> {
        if !self.has_connection(to) {
            return Err(CoreError::NotOwner);
        }
        self.session_mut(id)?.handoff(to, stream, now)
    }
    pub fn disconnect(&mut self, id: ConnectionId) {
        let _ = self.remove_connection(id);
    }
    pub fn close_all(&mut self, reason: CloseReason) {
        for s in self.sessions.values_mut() {
            s.close(reason);
        }
    }
    pub fn forget_closed(&mut self, id: SessionId) -> Result<(), CoreError> {
        if self.session(id)?.snapshot().state != State::Closed {
            return Err(CoreError::Busy);
        }
        self.sessions.remove(&id);
        Ok(())
    }
}
