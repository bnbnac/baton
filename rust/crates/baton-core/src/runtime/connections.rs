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
    /// Registers `id` unless it already exists: `Ok(true)` when newly registered,
    /// `Ok(false)` when present (and marked as just used). At capacity, the least
    /// recently used connection no shell is assigned to is removed and registration
    /// is retried. The registry and the budgets
    /// change under the same locks so they never disagree.
    pub fn ensure_connection(&self, id: ConnectionId) -> Result<bool, CoreError> {
        let mut registry = lock(&self.shared.registry);
        if self.shared.stopping.load(Ordering::Acquire) {
            return Err(CoreError::SessionClosed);
        }
        if registry.has_connection(id) {
            registry.touch_connection(id);
            return Ok(false);
        }
        let mut budgets = lock(&self.shared.budgets);
        match registry.register_connection(id) {
            Err(CoreError::Capacity) => {
                if let Some(pruned) = registry.prune_least_recent_unassigned_connection() {
                    budgets.remove(&pruned);
                }
                registry.register_connection(id)?;
            }
            other => other?,
        }
        budgets.insert(
            id,
            Arc::new(ConnectionBudget {
                requests: Arc::new(Semaphore::new(limits::REQUESTS)),
                reads: Arc::new(Semaphore::new(limits::WAIT_READS)),
            }),
        );
        Ok(true)
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

    fn owned_registry(connections: u128, owners: &[u128]) -> Registry {
        let mut registry = Registry::new(AppId::from_u128(1));
        for n in 0..connections {
            registry
                .register_connection(ConnectionId::from_u128(n))
                .unwrap();
        }
        for (i, owner) in owners.iter().enumerate() {
            let n = i as u128 + 1;
            let mut session = crate::session::Session::new(SessionId::from_u128(n));
            session.connected().unwrap();
            session
                .handoff(
                    ConnectionId::from_u128(*owner),
                    StreamId::from_u128(n),
                    std::time::Duration::ZERO,
                )
                .unwrap();
            registry.insert_session(session).unwrap();
        }
        registry
    }
    #[tokio::test]
    async fn ensure_connection_is_idempotent() {
        let runtime = Runtime::spawn(Registry::new(AppId::from_u128(1)));
        let id = ConnectionId::from_u128(1);
        assert!(runtime.ensure_connection(id).unwrap());
        assert!(!runtime.ensure_connection(id).unwrap());
        assert_eq!(runtime.connection_ids(), vec![id]);
        runtime.shutdown().await;
    }
    #[tokio::test]
    async fn ensure_connection_prunes_only_the_least_recently_used_unassigned_when_full() {
        let runtime = Runtime::spawn(owned_registry(32, &[5]));
        let fresh = ConnectionId::from_u128(1000);
        assert!(runtime.ensure_connection(fresh).unwrap());
        let ids = runtime.connection_ids();
        assert_eq!(ids.len(), 32);
        assert!(ids.contains(&ConnectionId::from_u128(5)));
        assert!(ids.contains(&fresh));
        // Registered first and never used again, so it is the one given up.
        assert!(!ids.contains(&ConnectionId::from_u128(0)));
        assert!(ids.contains(&ConnectionId::from_u128(1)));
        let budget_ids: Vec<ConnectionId> = lock(&runtime.shared.budgets).keys().copied().collect();
        assert_eq!(budget_ids, ids);
        runtime.shutdown().await;
    }
    #[tokio::test]
    async fn ensure_connection_keeps_a_connection_that_was_used_recently() {
        let runtime = Runtime::spawn(owned_registry(32, &[5]));
        assert!(!runtime.ensure_connection(ConnectionId::from_u128(0)).unwrap());
        assert!(runtime.ensure_connection(ConnectionId::from_u128(1000)).unwrap());
        let ids = runtime.connection_ids();
        assert!(ids.contains(&ConnectionId::from_u128(0)));
        assert!(!ids.contains(&ConnectionId::from_u128(1)));
        assert_eq!(ids.len(), 32);
        runtime.shutdown().await;
    }
    #[tokio::test]
    async fn ensure_connection_never_evicts_a_connection_that_owns_a_shell() {
        let owners: Vec<u128> = (0..10).collect();
        let runtime = Runtime::spawn(owned_registry(32, &owners));
        for n in 1000..1100 {
            runtime
                .ensure_connection(ConnectionId::from_u128(n))
                .unwrap();
            let ids = runtime.connection_ids();
            for owner in &owners {
                assert!(ids.contains(&ConnectionId::from_u128(*owner)));
            }
            assert!(ids.len() <= 32);
        }
        runtime.shutdown().await;
    }
}
