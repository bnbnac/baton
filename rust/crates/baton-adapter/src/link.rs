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
    // Connection IDs change on reconnect, so the name is replayed to each new one.
    name: Option<String>,
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
                name: None,
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
        if let AgentRequest::SetConnectionName { name } = &request {
            self.state.lock().unwrap().name = Some(name.clone());
        }
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
async fn announce_name(state: &Mutex<State>, client: &Arc<LocalClient>) {
    let name = state.lock().unwrap().name.clone();
    let Some(name) = name else { return };
    // Best effort: a stalled app must not delay supervision, and the tool can be called again.
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        client.call(AgentRequest::SetConnectionName { name }, CancellationToken::new()),
    )
    .await;
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
                // Announcing shares the select so a stalled app cannot delay stop or disconnect detection.
                let watch = async {
                    announce_name(&state, &client).await;
                    client.disconnected().await;
                };
                tokio::select! {biased;_=stop.cancelled()=>client.close(),_=watch=>{}}
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    struct Backend;
    impl AgentBackend for Backend {
        fn connected(&self, _: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnected(&self, _: ConnectionContext) -> IpcFuture<'_, ()> {
            Box::pin(async {})
        }
        fn dispatch(
            &self,
            c: ConnectionContext,
            _: AgentRequest,
            _: CancellationToken,
        ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
            Box::pin(async move {
                Ok(AgentResponse::Status(StatusResult {
                    contract_version: 2,
                    app_state: AppState::Online,
                    app_instance_id: Some(c.app_instance_id()),
                    connection_id: Some(c.connection_id()),
                    sessions: vec![],
                }))
            })
        }
    }
    #[derive(Default)]
    struct Recorder(Mutex<Vec<(WireId, String)>>);
    impl AgentBackend for Recorder {
        fn connected(&self, _: ConnectionContext) -> IpcFuture<'_, Result<(), WireError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnected(&self, _: ConnectionContext) -> IpcFuture<'_, ()> {
            Box::pin(async {})
        }
        fn dispatch(
            &self,
            c: ConnectionContext,
            request: AgentRequest,
            _: CancellationToken,
        ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
            Box::pin(async move {
                if let AgentRequest::SetConnectionName { name } = request {
                    self.0.lock().unwrap().push((c.connection_id(), name));
                }
                Ok(AgentResponse::ConnectionName {})
            })
        }
    }
    #[tokio::test]
    async fn name_set_while_offline_is_announced_on_the_next_connection() {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase4-race");
        std::fs::create_dir_all(&root).unwrap();
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = root.canonicalize().unwrap().join(id.to_string());
        let link = AdapterLink::start(path.clone());
        let offline = link
            .call(
                AgentRequest::SetConnectionName {
                    name: "세션 A".into(),
                },
                CancellationToken::new(),
            )
            .await;
        assert!(offline.is_err());
        let recorder = Arc::new(Recorder::default());
        let server = LocalServer::start(&path, WireId::from_u128(id), recorder.clone())
            .await
            .unwrap();
        // Reconnect backoff is at most 5 seconds.
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            while recorder.0.lock().unwrap().is_empty() {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("name was not announced after connecting");
        assert_eq!(recorder.0.lock().unwrap()[0].1, "세션 A");
        link.shutdown().await;
        server.shutdown().await;
    }
    #[tokio::test]
    async fn late_retirement_of_old_client_preserves_replacement_connection() {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase4-race");
        std::fs::create_dir_all(&root).unwrap();
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = root.canonicalize().unwrap().join(id.to_string());
        let server = LocalServer::start(&path, WireId::from_u128(id), Arc::new(Backend))
            .await
            .unwrap();
        let old = Arc::new(LocalClient::connect(&path).await.unwrap());
        let new = Arc::new(LocalClient::connect(&path).await.unwrap());
        let state = Mutex::new(State {
            client: Some(new.clone()),
            failure: None,
            name: None,
        });        old.close();
        retire(&state, &old);
        let current = state
            .lock()
            .unwrap()
            .client
            .clone()
            .expect("old error removed replacement");
        let response = current
            .call(AgentRequest::Status {}, CancellationToken::new())
            .await
            .unwrap();
        let AgentResponse::Status(status) = response else {
            panic!("wrong response")
        };
        assert_eq!(status.connection_id, Some(new.context().connection_id()));
        retire(&state, &new);
        assert!(state.lock().unwrap().client.is_none());
        new.close();
        server.shutdown().await;
    }
}
