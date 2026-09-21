use crate::{AppId, ConnectionId, CoreError};
use std::collections::BTreeSet;

pub struct Registry {
    app: AppId,
    connections: BTreeSet<ConnectionId>,
}
impl Registry {
    pub fn new(app: AppId) -> Self {
        Self {
            app,
            connections: BTreeSet::new(),
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
            Ok(())
        } else {
            Err(CoreError::UnknownId)
        }
    }
}
