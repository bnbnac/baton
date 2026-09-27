use super::*;
impl Runtime {
    pub fn reserve_session(&self, id: SessionId) -> Result<(), CoreError> {
        let mut registry = lock(&self.shared.registry);
        if self.shared.stopping.load(Ordering::Acquire) {
            return Err(CoreError::SessionClosed);
        }
        registry.insert_session(Session::new(id))
    }
    pub fn activate_session(
        &self,
        id: SessionId,
        io: Box<dyn Transport>,
    ) -> Result<SessionHandle, CoreError> {
        self.attach_inner(id, io, true)
    }
    pub fn close_session(&self, id: SessionId, reason: CloseReason) -> Result<(), CoreError> {
        let mut registry = lock(&self.shared.registry);
        let session = registry.session_mut(id)?;
        if let Some(link) = lock(&self.shared.links).get(&id) {
            let deadline = Instant::now() + limits::TRANSITION_TIMEOUT;
            let mut end = lock(&link.close_deadline);
            *end = Some(end.map_or(deadline, |old| old.min(deadline)));
            session.close(reason);
            link.publish(session);
        } else {
            session.close(reason);
        }
        Ok(())
    }
    pub fn forget_closed(&self, id: SessionId) -> Result<(), CoreError> {
        let mut registry = lock(&self.shared.registry);
        if registry.session(id)?.snapshot().state != State::Closed {
            return Err(CoreError::Busy);
        }
        let mut links = lock(&self.shared.links);
        if let Some(link) = links.get(&id) {
            if !link.finished.load(Ordering::Acquire) {
                return Err(CoreError::Busy);
            }
            link.retired.store(true, Ordering::Release);
        }
        registry.forget_closed(id)?;
        links.remove(&id);
        Ok(())
    }
    pub fn session_handle(&self, id: SessionId) -> Result<SessionHandle, CoreError> {
        let registry = lock(&self.shared.registry);
        registry.session(id)?;
        let link = lock(&self.shared.links)
            .get(&id)
            .cloned()
            .ok_or(CoreError::ControlUnavailable)?;
        Ok(SessionHandle {
            shared: self.shared.clone(),
            link,
        })
    }
    pub fn snapshots(&self) -> Vec<(SessionId, Snapshot)> {
        lock(&self.shared.registry)
            .sessions
            .iter()
            .map(|(id, s)| (*id, s.snapshot()))
            .collect()
    }
}
