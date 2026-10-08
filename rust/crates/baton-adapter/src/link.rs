use baton_ipc::*;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::task::JoinHandle;

struct State {
    #[cfg(windows)]
    client: Option<Arc<LocalClient>>,
    failure: Option<WireError>,
}
pub struct AdapterLink {
    state: Arc<Mutex<State>>,
    stop: CancellationToken,
    worker: Mutex<Option<JoinHandle<()>>>,
}
impl Drop for AdapterLink {
    fn drop(&mut self) {
        self.stop.cancel();
        self.close_client();
        if let Some(worker) = self.worker.lock().unwrap().take() {
            worker.abort();
        }
    }
}
impl AdapterLink {
    pub fn start(path: PathBuf) -> Self {
        #[cfg(windows)]
        {
            let link = Self::unavailable(WireError::new(ErrorCode::AppOffline));
            *link.worker.lock().unwrap() = Some(tokio::spawn(supervise(
                path,
                link.state.clone(),
                link.stop.clone(),
            )));
            link
        }
        #[cfg(not(windows))]
        {
            let _ = path;
            Self::unavailable(WireError::new(ErrorCode::Unsupported))
        }
    }
    pub fn unavailable(error: WireError) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                #[cfg(windows)]
                client: None,
                failure: failure(error),
            })),
            stop: CancellationToken::new(),
            worker: Mutex::new(None),
        }
    }
    fn close_client(&self) {
        #[cfg(windows)]
        if let Some(client) = self.state.lock().unwrap().client.take() {
            client.close();
        }
    }
    pub async fn shutdown(&self) {
        self.stop.cancel();
        self.close_client();
        let worker = self.worker.lock().unwrap().take();
        if let Some(worker) = worker {
            let _ = worker.await;
        }
    }
    fn offline(&self, status: bool) -> Result<AgentResponse, WireError> {
        if let Some(error) = &self.state.lock().unwrap().failure {
            return Err(error.clone());
        }
        if status {
            Ok(AgentResponse::Status(StatusResult::offline()))
        } else {
            Err(WireError::new(ErrorCode::AppOffline))
        }
    }
    pub async fn call(
        &self,
        request: AgentRequest,
        cancel: CancellationToken,
    ) -> Result<AgentResponse, WireError> {
        request.validate()?;
        if cancel.is_cancelled() {
            return Err(WireError::new(ErrorCode::Cancelled));
        }
        let status = matches!(request, AgentRequest::Status {});
        #[cfg(windows)]
        {
            let client = self.state.lock().unwrap().client.clone();
            let Some(client) = client.filter(|c| c.is_connected()) else {
                return self.offline(status);
            };
            let input = matches!(
                request,
                AgentRequest::SendText { .. } | AgentRequest::SendKey { .. }
            );
            // Each call belongs to one transport; never queue or replay it on a
            // later connection, even when its outcome is uncertain.
            let result = client.call(request, cancel).await;
            let current = self
                .state
                .lock()
                .unwrap()
                .client
                .as_ref()
                .is_some_and(|c| Arc::ptr_eq(c, &client));
            if !current
                || !client.is_connected()
                || matches!(&result,Err(e) if matches!(e.code,ErrorCode::Disconnected|ErrorCode::AppOffline))
            {
                retire(&self.state, &client);
                if input {
                    return Err(WireError::new(ErrorCode::Uncertain));
                }
                return self.offline(status);
            }
            result
        }
        #[cfg(not(windows))]
        {
            let _ = request;
            self.offline(status)
        }
    }
}
fn failure(error: WireError) -> Option<WireError> {
    if matches!(error.code, ErrorCode::AppOffline | ErrorCode::Disconnected) {
        None
    } else {
        Some(error)
    }
}
#[cfg(windows)]
fn retire(state: &Mutex<State>, client: &Arc<LocalClient>) {
    let mut state = state.lock().unwrap();
    if state
        .client
        .as_ref()
        .is_some_and(|c| Arc::ptr_eq(c, client))
    {
        state.client = None;
    }
}
#[cfg(windows)]
async fn supervise(path: PathBuf, state: Arc<Mutex<State>>, stop: CancellationToken) {
    let mut backoff = crate::reconnect::Backoff::default();
    loop {
        let result = tokio::select! {biased;
            _=stop.cancelled()=>break,
            result=LocalClient::connect(&path)=>result,
        };
        match result {
            Ok(client) => {
                let client = Arc::new(client);
                {
                    let mut current = state.lock().unwrap();
                    current.failure = None;
                    current.client = Some(client.clone());
                }
                backoff.reset();
                tokio::select! {biased;_=stop.cancelled()=>client.close(),_=client.disconnected()=>{}}
                retire(&state, &client);
            }
            Err(error) => {
                state.lock().unwrap().failure = failure(error);
            }
        }
        tokio::select! {biased;_=stop.cancelled()=>break,_=tokio::time::sleep(backoff.next_delay())=>{}}
    }
    if let Some(client) = state.lock().unwrap().client.take() {
        client.close();
    }
}
