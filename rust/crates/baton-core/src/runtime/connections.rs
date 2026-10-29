use super::*;
impl Runtime {
    /// Lock order for connection admission/removal is registry -> budgets -> links.
    /// No lock is held across an await.
    pub fn register_connection(&self, id: ConnectionId) -> Result<(), CoreError> {
        let mut registry = lock(&self.shared.registry);
        if self.shared.stopping.load(Ordering::Acquire) {
            return Err(CoreError::SessionClosed);
        }
        registry.register_connection(id)?;
        lock(&self.shared.budgets).insert(
            id,
            Arc::new(ConnectionBudget {
                requests: Arc::new(Semaphore::new(limits::REQUESTS)),
                reads: Arc::new(Semaphore::new(limits::WAIT_READS)),
            }),
        );
        Ok(())
    }
    pub fn status_for(&self, id: ConnectionId) -> Result<Vec<(SessionId, Snapshot)>, CoreError> {
        lock(&self.shared.registry).status_for(id)
    }
    pub fn app_id(&self) -> AppId {
        lock(&self.shared.registry).app()
    }
    pub fn connection_ids(&self) -> Vec<ConnectionId> {
        lock(&self.shared.registry).connection_ids()
    }
    /// The callback is the response commit point, serialized with reclaim and
    /// disconnect. It must not await or re-enter the runtime. Bytes committed
    /// here may already be on their way to the peer when reclaim happens later.
    pub fn commit_agent_response<T>(
        &self,
        connection: ConnectionId,
        session: SessionId,
        epoch: SafeInt,
        stream: Option<StreamId>,
        commit: impl FnOnce() -> T,
    ) -> Result<T, CoreError> {
        let registry = lock(&self.shared.registry);
        if !registry.has_connection(connection) {
            return Err(CoreError::NotOwner);
        }
        let session = registry.session(session)?;
        session.authorize(Principal::Agent(connection), epoch)?;
        if stream.is_some() && session.snapshot().stream != stream {
            return Err(CoreError::StaleStream);
        }
        Ok(commit())
    }
    /// Build a filtered status response under the same ownership gate.
    pub fn commit_agent_status<T>(
        &self,
        connection: ConnectionId,
        commit: impl FnOnce(Vec<(SessionId, Snapshot, Geometry)>) -> T,
    ) -> Result<T, CoreError> {
        let registry = lock(&self.shared.registry);
        let rows = registry
            .status_for(connection)?
            .into_iter()
            .map(|(id, snapshot)| {
                (
                    id,
                    snapshot,
                    registry
                        .session(id)
                        .expect("filtered live entry")
                        .geometry(),
                )
            })
            .collect();
        Ok(commit(rows))
    }
}
impl SessionHandle {
    pub async fn request_user_control(
        &self,
        connection: ConnectionId,
        epoch: SafeInt,
        id: RequestId,
        reason: String,
    ) -> Result<InterventionResult, CoreError> {
        let _permit = self.request(Principal::Agent(connection))?;
        self.with_session(|s| s.request_user_control(connection, epoch, id, reason))
    }
    pub async fn decline_intervention(
        &self,
        epoch: SafeInt,
        id: RequestId,
    ) -> Result<(), CoreError> {
        self.with_session(|s| s.decline_intervention(epoch, id))
    }
    pub async fn wait_input_result(
        &self,
        principal: Principal,
        epoch: SafeInt,
        id: RequestId,
    ) -> Result<InputResult, CoreError> {
        let _permit = self.request(principal)?;
        let mut changed = self.subscribe();
        loop {
            changed.borrow_and_update();
            if let Principal::Agent(c) = principal {
                self.budget(c)?;
            }
            let result = self.with_session(|s| s.input_result(principal, epoch, id))?;
            if result != InputResult::Pending {
                return Ok(result);
            }
            changed
                .changed()
                .await
                .map_err(|_| CoreError::SessionClosed)?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn registration_and_disconnect_never_leave_a_ghost_budget() {
        let runtime = Arc::new(Runtime::spawn(Registry::new(AppId::from_u128(1))));
        let executor = tokio::runtime::Handle::current();
        for n in 0..64 {
            let id = ConnectionId::from_u128(n);
            let barrier = std::sync::Barrier::new(2);
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    barrier.wait();
                    runtime.register_connection(id).unwrap();
                });
                scope.spawn(|| {
                    barrier.wait();
                    executor.block_on(runtime.disconnect(id));
                });
            });
            assert_eq!(
                lock(&runtime.shared.registry).has_connection(id),
                lock(&runtime.shared.budgets).contains_key(&id)
            );
            runtime.disconnect(id).await;
        }
        runtime.shutdown().await;
    }
}
