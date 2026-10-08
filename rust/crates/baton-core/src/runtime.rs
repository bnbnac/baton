use crate::*;
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore, mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;
mod connections;
mod driver;
mod lifecycle;

pub type IoFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
/// Implementations must never block a polling thread. Dropping the transport
/// must release the underlying connection, including when a write is cancelled.
pub trait Transport: Send + 'static {
    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, WriteResult>;
    fn close(&mut self) -> IoFuture<'_, ()>;
    fn resize(&mut self, _geometry: Geometry) -> IoFuture<'_, Result<(), TransportError>> {
        Box::pin(async { Err(TransportError::Failed) })
    }
}
fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
struct ConnectionBudget {
    requests: Arc<Semaphore>,
    reads: Arc<Semaphore>,
}
struct Shared {
    registry: Mutex<Registry>,
    budgets: Mutex<BTreeMap<ConnectionId, Arc<ConnectionBudget>>>,
    links: Mutex<BTreeMap<SessionId, Arc<Link>>>,
    origin: Instant,
    stopping: AtomicBool,
    #[cfg(test)]
    lifecycle_hooks: LifecycleHooks,
}
#[cfg(test)]
#[derive(Default)]
struct LifecycleHooks {
    before_attach_insert: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    before_shutdown_close: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}
#[cfg(test)]
fn run_hook(hook: &Mutex<Option<Arc<dyn Fn() + Send + Sync>>>) {
    let callback = lock(hook).clone();
    if let Some(callback) = callback {
        callback();
    }
}
struct Link {
    id: SessionId,
    commands: mpsc::Sender<Submit>,
    incoming: mpsc::Sender<Receive>,
    changed: watch::Sender<Snapshot>,
    wake: Notify,
    close_deadline: Mutex<Option<Instant>>,
    task: Mutex<Option<JoinHandle<()>>>,
    finished: AtomicBool,
    retired: AtomicBool,
}
impl Link {
    fn publish(&self, s: &Session) {
        self.changed.send_replace(s.snapshot());
        self.wake.notify_one();
    }
}
struct Submit {
    call: InputCall,
    cancelled: Arc<AtomicBool>,
    reply: oneshot::Sender<Result<InputResult, CoreError>>,
}
struct Receive {
    bytes: Vec<u8>,
    scope: crate::session::ReceiveScope,
    reply: oneshot::Sender<Result<(), CoreError>>,
}
struct CancelOnDrop {
    shared: Arc<Shared>,
    link: Arc<Link>,
    flag: Arc<AtomicBool>,
    armed: bool,
}
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if self.armed {
            let _gate = lock(&self.shared.registry);
            self.flag.store(true, Ordering::Release);
            self.link.wake.notify_one();
        }
    }
}
pub struct Runtime {
    shared: Arc<Shared>,
}
#[derive(Clone)]
pub struct SessionHandle {
    shared: Arc<Shared>,
    link: Arc<Link>,
}
impl Runtime {
    pub fn spawn(registry: Registry) -> Self {
        let budgets = registry
            .connection_ids()
            .into_iter()
            .map(|id| {
                (
                    id,
                    Arc::new(ConnectionBudget {
                        requests: Arc::new(Semaphore::new(limits::REQUESTS)),
                        reads: Arc::new(Semaphore::new(limits::WAIT_READS)),
                    }),
                )
            })
            .collect();
        Self {
            shared: Arc::new(Shared {
                registry: Mutex::new(registry),
                budgets: Mutex::new(budgets),
                links: Mutex::new(BTreeMap::new()),
                origin: Instant::now(),
                stopping: AtomicBool::new(false),
                #[cfg(test)]
                lifecycle_hooks: LifecycleHooks::default(),
            }),
        }
    }
    pub fn attach(
        &self,
        id: SessionId,
        transport: Box<dyn Transport>,
    ) -> Result<SessionHandle, CoreError> {
        self.attach_inner(id, transport, false)
    }
    fn attach_inner(
        &self,
        id: SessionId,
        transport: Box<dyn Transport>,
        activate: bool,
    ) -> Result<SessionHandle, CoreError> {
        if self.shared.stopping.load(Ordering::Acquire) {
            return Err(CoreError::SessionClosed);
        }
        let mut registry = lock(&self.shared.registry);
        if self.shared.stopping.load(Ordering::Acquire) {
            return Err(CoreError::SessionClosed);
        }
        let session = registry.session_mut(id)?;
        if session.snapshot().state == State::Closed {
            return Err(CoreError::SessionClosed);
        }
        #[cfg(test)]
        run_hook(&self.shared.lifecycle_hooks.before_attach_insert);
        let mut links = lock(&self.shared.links);
        if links.contains_key(&id) {
            return Err(CoreError::Busy);
        }
        if activate {
            session.connected()?;
        }
        let (commands, rx) = mpsc::channel(32);
        let (incoming, output_rx) = mpsc::channel(1);
        let (changed, _) = watch::channel(session.snapshot());
        let link = Arc::new(Link {
            id,
            commands,
            incoming,
            changed,
            wake: Notify::new(),
            close_deadline: Mutex::new(None),
            task: Mutex::new(None),
            finished: AtomicBool::new(false),
            retired: AtomicBool::new(false),
        });
        links.insert(id, link.clone());
        *lock(&link.task) = Some(tokio::spawn(driver::run(
            self.shared.clone(),
            link.clone(),
            transport,
            rx,
            output_rx,
        )));
        Ok(SessionHandle {
            shared: self.shared.clone(),
            link,
        })
    }
    pub async fn disconnect(&self, id: ConnectionId) {
        {
            let mut registry = lock(&self.shared.registry);
            registry.disconnect(id);
            lock(&self.shared.budgets).remove(&id);
        }
        self.publish_all();
    }
    fn publish_all(&self) {
        let links: Vec<_> = lock(&self.shared.links).values().cloned().collect();
        let registry = lock(&self.shared.registry);
        for link in links {
            if let Ok(s) = registry.session(link.id) {
                link.publish(s);
            }
        }
    }
    pub async fn shutdown(&self) {
        let deadline = Instant::now() + limits::TRANSITION_TIMEOUT;
        #[cfg(test)]
        run_hook(&self.shared.lifecycle_hooks.before_shutdown_close);
        // Attachment and shutdown share admission and link-registration ordering.
        // Every admitted transport receives this deadline and is joined below.
        let links: Vec<_> = {
            let mut registry = lock(&self.shared.registry);
            self.shared.stopping.store(true, Ordering::Release);
            let links: Vec<_> = lock(&self.shared.links).values().cloned().collect();
            for link in &links {
                let mut end = lock(&link.close_deadline);
                *end = Some(end.map_or(deadline, |old| old.min(deadline)));
            }
            registry.close_all(CloseReason::AppExit);
            links
        };
        self.publish_all();
        let tasks: Vec<_> = links
            .iter()
            .filter_map(|link| lock(&link.task).take())
            .collect();
        for mut task in tasks {
            if tokio::time::timeout_at(deadline, &mut task).await.is_err() {
                task.abort();
                let _ = task.await;
            }
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.shared.stopping.store(true, Ordering::Release);
        lock(&self.shared.registry).close_all(CloseReason::AppExit);
        self.publish_all();
        for link in lock(&self.shared.links).values() {
            if let Some(task) = lock(&link.task).take() {
                task.abort();
            }
        }
    }
}
impl SessionHandle {
    pub(crate) fn wake_driver(&self) {
        self.link.wake.notify_one();
    }
    pub(crate) fn with_session<R>(&self, f: impl FnOnce(&mut Session) -> R) -> R {
        let mut r = lock(&self.shared.registry);
        if self.link.retired.load(Ordering::Acquire) {
            // A retired handle has a permanent closed view, even if a trusted
            // assembler accidentally registers the same ID again.
            let snapshot = self.link.changed.borrow().clone();
            let mut closed = Session::new(self.link.id);
            closed.epoch = snapshot.epoch;
            closed.assigned = snapshot.assigned;
            closed.close(CloseReason::User);
            return f(&mut closed);
        }
        let s = r
            .session_mut(self.link.id)
            .expect("live link retains session");
        let before = s.snapshot();
        s.tick(self.shared.origin.elapsed());
        let result = f(s);
        if before != s.snapshot() {
            self.link.publish(s);
        }
        result
    }
    fn budget(&self, c: ConnectionId) -> Result<Arc<ConnectionBudget>, CoreError> {
        if !lock(&self.shared.registry).has_connection(c) {
            return Err(CoreError::NotOwner);
        }
        lock(&self.shared.budgets)
            .get(&c)
            .cloned()
            .ok_or(CoreError::NotOwner)
    }
    fn request(&self, principal: Principal) -> Result<Option<OwnedSemaphorePermit>, CoreError> {
        match principal {
            Principal::User => Ok(None),
            Principal::Agent(c) => self
                .budget(c)?
                .requests
                .clone()
                .try_acquire_owned()
                .map(Some)
                .map_err(|_| CoreError::RequestLimit),
        }
    }
    pub fn subscribe(&self) -> watch::Receiver<Snapshot> {
        self.link.changed.subscribe()
    }
    pub async fn snapshot(&self) -> Snapshot {
        self.with_session(|s| s.snapshot())
    }
    pub async fn submit(&self, call: InputCall) -> Result<InputResult, CoreError> {
        let _permit = self.request(call.principal)?;
        self.with_session(|s| s.authorize(call.principal, call.epoch))?;
        if call.payload.len() > limits::INPUT_BYTES {
            return Err(CoreError::InputTooLarge);
        }
        let (reply, rx) = oneshot::channel();
        let flag = Arc::new(AtomicBool::new(false));
        let mut guard = CancelOnDrop {
            shared: self.shared.clone(),
            link: self.link.clone(),
            flag: flag.clone(),
            armed: true,
        };
        let principal = call.principal;
        let epoch = call.epoch;
        self.link
            .commands
            .try_send(Submit {
                call,
                cancelled: flag,
                reply,
            })
            .map_err(|e| match e {
                mpsc::error::TrySendError::Full(_) => CoreError::Busy,
                mpsc::error::TrySendError::Closed(_) => CoreError::SessionClosed,
            })?;
        let result = rx.await.unwrap_or_else(|_| {
            self.with_session(|s| {
                Err(s
                    .authorize(principal, epoch)
                    .err()
                    .unwrap_or(CoreError::SessionClosed))
            })
        });
        guard.armed = false;
        result
    }
    pub async fn cancel_input(
        &self,
        p: Principal,
        e: SafeInt,
        id: RequestId,
    ) -> Result<InputResult, CoreError> {
        // Cancellation remains available when all ordinary request slots are occupied.
        if let Principal::Agent(c) = p {
            self.budget(c)?;
        }
        let result = self.with_session(|s| {
            let result = s.cancel_input(p, e, id);
            self.link.publish(s);
            result
        });
        self.link.wake.notify_one();
        result
    }
    pub async fn input_result(
        &self,
        p: Principal,
        e: SafeInt,
        id: RequestId,
    ) -> Result<InputResult, CoreError> {
        let _permit = self.request(p)?;
        self.with_session(|s| s.input_result(p, e, id))
    }
    pub async fn reclaim(&self) -> Result<(), CoreError> {
        self.with_session(|s| s.reclaim(self.shared.origin.elapsed()))
    }
    pub async fn reclaim_expected(&self, epoch: SafeInt) -> Result<(), CoreError> {
        self.with_session(|s| {
            if s.snapshot().epoch != epoch {
                return Err(CoreError::StaleControlEpoch);
            }
            s.reclaim(self.shared.origin.elapsed())
        })
    }
    pub async fn handoff_expected(
        &self,
        to: ConnectionId,
        stream: StreamId,
        epoch: SafeInt,
    ) -> Result<(), CoreError> {
        self.handoff_checked(to, stream, Some(epoch))
    }
    pub async fn handoff(&self, to: ConnectionId, stream: StreamId) -> Result<(), CoreError> {
        self.handoff_checked(to, stream, None)
    }
    fn handoff_checked(
        &self,
        to: ConnectionId,
        stream: StreamId,
        epoch: Option<SafeInt>,
    ) -> Result<(), CoreError> {
        let mut r = lock(&self.shared.registry);
        if self.link.retired.load(Ordering::Acquire) {
            return Err(CoreError::SessionClosed);
        }
        r.session_mut(self.link.id)?
            .tick(self.shared.origin.elapsed());
        if epoch.is_some_and(|expected| {
            r.session(self.link.id)
                .is_ok_and(|s| s.snapshot().epoch != expected)
        }) {
            return Err(CoreError::StaleControlEpoch);
        }
        let result = r.handoff(self.link.id, to, stream, self.shared.origin.elapsed());
        self.link.publish(r.session(self.link.id)?);
        result
    }
    pub async fn close(&self, reason: CloseReason) {
        let deadline = Instant::now() + limits::TRANSITION_TIMEOUT;
        {
            let mut end = lock(&self.link.close_deadline);
            *end = Some(end.map_or(deadline, |old| old.min(deadline)));
        }
        self.with_session(|s| s.close(reason));
        self.link.wake.notify_one();
    }
    pub async fn receive(&self, bytes: Vec<u8>) -> Result<(), CoreError> {
        let scope = self.with_session(|s| {
            if s.snapshot().state == State::Closed {
                Err(CoreError::SessionClosed)
            } else {
                Ok(s.receive_scope())
            }
        })?;
        if bytes.len() > limits::UI_CHUNK {
            return Err(CoreError::InputTooLarge);
        }
        let (reply, rx) = oneshot::channel();
        self.link
            .incoming
            .try_send(Receive {
                bytes,
                scope,
                reply,
            })
            .map_err(|e| match e {
                mpsc::error::TrySendError::Full(_) => CoreError::Busy,
                mpsc::error::TrySendError::Closed(_) => CoreError::SessionClosed,
            })?;
        rx.await.unwrap_or(Err(CoreError::SessionClosed))
    }
    pub async fn next_ui_chunk(&self) -> Option<UiChunk> {
        self.with_session(|s| s.next_ui_chunk())
    }
    pub async fn ack_ui(&self, seq: SafeInt) -> Result<(), CoreError> {
        self.with_session(|s| s.ack_ui(seq))
    }
    pub async fn read(&self, call: ReadCall, wait_ms: u32) -> Result<ReadPage, CoreError> {
        let _request = self.request(Principal::Agent(call.connection))?;
        self.with_session(|s| s.authorize(Principal::Agent(call.connection), call.epoch))?;
        if wait_ms > limits::WAIT_MS {
            return Err(CoreError::InvalidLimit);
        }
        let budget = self.budget(call.connection)?;
        let mut changed = self.subscribe();
        let first = self.with_session(|s| s.read(&call))?;
        if !first.text.is_empty() || wait_ms == 0 {
            return Ok(first);
        }
        let _read = budget
            .reads
            .clone()
            .try_acquire_owned()
            .map_err(|_| CoreError::ReadLimit)?;
        let deadline = Instant::now() + std::time::Duration::from_millis(wait_ms.into());
        loop {
            // Recheck after registering and immediately before returning a page.
            self.budget(call.connection)?;
            let page = self.with_session(|s| s.read(&call))?;
            if !page.text.is_empty() || Instant::now() >= deadline {
                return Ok(page);
            }
            tokio::select! {
                biased;
                _=tokio::time::sleep_until(deadline)=>{},
                result=changed.changed()=> { if result.is_err() { return Err(CoreError::SessionClosed); } }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Barrier, atomic::AtomicUsize};

    struct PendingClose(Arc<AtomicUsize>);
    impl Transport for PendingClose {
        fn write<'a>(&'a mut self, _: &'a [u8]) -> IoFuture<'a, WriteResult> {
            Box::pin(std::future::pending())
        }
        fn close(&mut self) -> IoFuture<'_, ()> {
            Box::pin(std::future::pending())
        }
    }
    impl Drop for PendingClose {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn shutdown_joins_attach_admitted_before_close_gate() {
        let id = SessionId::from_u128(1);
        let mut registry = Registry::new(AppId::from_u128(1));
        let mut session = Session::new(id);
        session.connected().unwrap();
        registry.insert_session(session).unwrap();
        let runtime = Arc::new(Runtime::spawn(registry));
        let barrier = Arc::new(Barrier::new(2));
        let (entered, attached) = std::sync::mpsc::channel();
        let attach_barrier = barrier.clone();
        *lock(&runtime.shared.lifecycle_hooks.before_attach_insert) = Some(Arc::new(move || {
            entered.send(()).unwrap();
            attach_barrier.wait();
        }));
        *lock(&runtime.shared.lifecycle_hooks.before_shutdown_close) = Some(Arc::new(move || {
            barrier.wait();
        }));
        let drops = Arc::new(AtomicUsize::new(0));
        let attach_runtime = runtime.clone();
        let attach_drops = drops.clone();
        let executor = tokio::runtime::Handle::current();
        let attach = std::thread::spawn(move || {
            let _entered = executor.enter();
            attach_runtime.attach(id, Box::new(PendingClose(attach_drops)))
        });
        attached
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        runtime.shutdown().await;
        let handle = attach.join().unwrap().unwrap();
        assert_eq!(handle.snapshot().await.state, State::Closed);
        assert_eq!(
            drops.load(Ordering::SeqCst),
            1,
            "shutdown returned before attached transport dropped"
        );
    }
}
