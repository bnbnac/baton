use baton_core::*;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{Notify, mpsc};

#[derive(Default)]
pub struct TransportAudit {
    pub started: Vec<Vec<u8>>,
    pub completed: Vec<WriteResult>,
    pub closes: usize,
    pub drops: usize,
}
pub struct FaultTransport {
    audit: Arc<Mutex<TransportAudit>>,
    started: Arc<Notify>,
    complete: mpsc::Receiver<WriteResult>,
}
pub struct TransportProbe {
    pub audit: Arc<Mutex<TransportAudit>>,
    started: Arc<Notify>,
    complete: mpsc::Sender<WriteResult>,
}
impl TransportProbe {
    pub async fn wait_started(&self) {
        tokio::time::timeout(Duration::from_secs(1), self.started.notified())
            .await
            .unwrap();
    }
    pub fn complete(&self, result: WriteResult) {
        self.complete.try_send(result).unwrap();
    }
}
impl FaultTransport {
    pub fn pair() -> (Self, TransportProbe) {
        let audit = Arc::new(Mutex::new(TransportAudit::default()));
        let started = Arc::new(Notify::new());
        let (complete, rx) = mpsc::channel(1);
        (
            Self {
                audit: audit.clone(),
                started: started.clone(),
                complete: rx,
            },
            TransportProbe {
                audit,
                started,
                complete,
            },
        )
    }
}
pub async fn wait_state(handle: &SessionHandle, state: State) {
    let mut change = handle.subscribe();
    tokio::time::timeout(Duration::from_secs(1), async {
        while change.borrow_and_update().state != state {
            change.changed().await.unwrap();
        }
    })
    .await
    .unwrap();
}
impl Transport for FaultTransport {
    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, WriteResult> {
        Box::pin(async move {
            self.audit.lock().unwrap().started.push(bytes.to_vec());
            self.started.notify_one();
            let result = self.complete.recv().await.unwrap_or(WriteResult::Uncertain);
            self.audit.lock().unwrap().completed.push(result);
            result
        })
    }
    fn close(&mut self) -> IoFuture<'_, ()> {
        Box::pin(async move {
            self.audit.lock().unwrap().closes += 1;
        })
    }
}
impl Drop for FaultTransport {
    fn drop(&mut self) {
        self.audit.lock().unwrap().drops += 1;
    }
}
pub struct RaceFixture {
    pub runtime: Runtime,
    pub handle: SessionHandle,
    pub connection: ConnectionId,
    pub epoch: SafeInt,
    pub stream: StreamId,
    pub audit: Arc<Mutex<TransportAudit>>,
    started: Arc<Notify>,
    complete: mpsc::Sender<WriteResult>,
}
impl RaceFixture {
    pub async fn agent() -> Self {
        let (s, a, e, stream) = super::agent_session();
        let id = s.id();
        let mut registry = Registry::new(AppId::from_u128(1));
        registry.register_connection(a).unwrap();
        registry.insert_session(s).unwrap();
        let runtime = Runtime::spawn(registry);
        let audit = Arc::new(Mutex::new(TransportAudit::default()));
        let started = Arc::new(Notify::new());
        let (complete, rx) = mpsc::channel(1);
        let handle = runtime
            .attach(
                id,
                Box::new(FaultTransport {
                    audit: audit.clone(),
                    started: started.clone(),
                    complete: rx,
                }),
            )
            .unwrap();
        Self {
            runtime,
            handle,
            connection: a,
            epoch: e,
            stream,
            audit,
            started,
            complete,
        }
    }
    pub fn call(&self, id: u128, text: &[u8]) -> InputCall {
        super::agent_call(self.connection, self.epoch, RequestId::from_u128(id), text)
    }
    pub fn read_call(&self) -> ReadCall {
        ReadCall {
            connection: self.connection,
            epoch: self.epoch,
            stream: self.stream,
            cursor: SafeInt::new(0).unwrap(),
            limit: 32,
        }
    }
    pub async fn wait_write_started(&self) {
        tokio::time::timeout(Duration::from_secs(1), self.started.notified())
            .await
            .unwrap();
    }
    pub fn complete_write(&self, result: WriteResult) {
        self.complete.try_send(result).unwrap();
    }
    pub async fn wait_state(&self, state: State) {
        let mut change = self.handle.subscribe();
        tokio::time::timeout(Duration::from_secs(1), async {
            while change.borrow_and_update().state != state {
                change.changed().await.unwrap();
            }
        })
        .await
        .unwrap();
    }
}
pub async fn poll_once<F: std::future::Future>(
    future: std::pin::Pin<&mut F>,
) -> std::task::Poll<F::Output> {
    let mut future = future;
    std::future::poll_fn(|cx| std::task::Poll::Ready(future.as_mut().poll(cx))).await
}
