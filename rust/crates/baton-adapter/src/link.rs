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
    // An app instance that dropped the connection right at a name request is only suspected.
    // It is confirmed unsupported when the same instance answers the next connection; a
    // restart changes the instance ID, which clears both marks on its own.
    #[cfg(windows)]
    suspect: Option<WireId>,
    #[cfg(windows)]
    unsupported: Option<WireId>,
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
                #[cfg(windows)]
                suspect: None,
                #[cfg(windows)]
                unsupported: None,
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
            let named = matches!(request, AgentRequest::SetConnectionName { .. });
            let app = client.context().app_instance_id();
            if named && self.state.lock().unwrap().unsupported == Some(app) {
                return Err(WireError::new(ErrorCode::ProtocolMismatch));
            }
            // Each call belongs to one transport; never queue or replay it on a
            // later connection, even when its outcome is uncertain.
            let result = client.call(request, cancel).await;
            let dropped = !client.is_connected()
                || matches!(&result,Err(e) if matches!(e.code,ErrorCode::Disconnected|ErrorCode::AppOffline));
            if named && dropped {
                self.state.lock().unwrap().suspect = Some(app);
            }
            let current = self
                .state
                .lock()
                .unwrap()
                .client
                .as_ref()
                .is_some_and(|c| Arc::ptr_eq(c, &client));
            if !current || dropped {
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
async fn announce_name(state: &Mutex<State>, client: &Arc<LocalClient>) -> bool {
    let app = client.context().app_instance_id();
    let name = {
        let state = state.lock().unwrap();
        if state.unsupported == Some(app) {
            None
        } else {
            state.name.clone()
        }
    };
    let Some(name) = name else { return true };
    // A timeout leaves the outcome unknown, so it is not counted as a drop; the tool can be called again.
    let reply = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        client.call(
            AgentRequest::SetConnectionName { name },
            CancellationToken::new(),
        ),
    )
    .await;
    let dropped = !client.is_connected()
        || matches!(&reply,Ok(Err(e)) if matches!(e.code,ErrorCode::Disconnected|ErrorCode::AppOffline));
    if dropped {
        state.lock().unwrap().suspect = Some(app);
    }
    !dropped
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
                    let app = client.context().app_instance_id();
                    let mut current = state.lock().unwrap();
                    current.failure = None;
                    current.client = Some(client.clone());
                    if current.suspect.take() == Some(app) {
                        current.unsupported = Some(app);
                    }
                }
                // Announcing shares the select so a stalled app cannot delay stop or disconnect detection.
                // Backoff resets only once the name went through; otherwise an app that drops
                // the connection on it would be reconnected at the minimum interval forever.
                let watch = async {
                    if announce_name(&state, &client).await {
                        backoff.reset();
                    }
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
    // With `hang`, a name request never completes, like an app that drops the connection on it.
    #[derive(Default)]
    struct Recorder {
        names: Mutex<Vec<(WireId, String)>>,
        hang: bool,
    }
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
            cancel: CancellationToken,
        ) -> IpcFuture<'_, Result<AgentResponse, WireError>> {
            Box::pin(async move {
                match request {
                    AgentRequest::SetConnectionName { name } => {
                        self.names.lock().unwrap().push((c.connection_id(), name));
                        if self.hang {
                            cancel.cancelled().await;
                            return Err(WireError::new(ErrorCode::Cancelled));
                        }
                        Ok(AgentResponse::ConnectionName {})
                    }
                    _ => Ok(AgentResponse::Status(StatusResult {
                        contract_version: 2,
                        app_state: AppState::Online,
                        app_instance_id: Some(c.app_instance_id()),
                        connection_id: Some(c.connection_id()),
                        sessions: vec![],
                    })),
                }
            })
        }
    }
    fn unique_path() -> (PathBuf, u128) {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase4-race");
        std::fs::create_dir_all(&root).unwrap();
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        (root.canonicalize().unwrap().join(id.to_string()), id)
    }
    async fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        // Reconnect backoff is at most 5 seconds.
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            while !done() {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
    }
    async fn online(link: &AdapterLink) -> bool {
        matches!(
            link.call(AgentRequest::Status {}, CancellationToken::new()).await,
            Ok(AgentResponse::Status(s)) if s.app_state == AppState::Online
        )
    }
    async fn wait_online(link: &AdapterLink) {
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            while !online(link).await {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("link did not connect");
    }
    fn set_name(name: &str) -> AgentRequest {
        AgentRequest::SetConnectionName { name: name.into() }
    }
    #[tokio::test]
    async fn name_set_while_offline_is_announced_on_the_next_connection() {
        let (path, id) = unique_path();
        let link = AdapterLink::start(path.clone());
        let offline = link
            .call(set_name("세션 A"), CancellationToken::new())
            .await;
        assert!(offline.is_err());
        let recorder = Arc::new(Recorder::default());
        let server = LocalServer::start(&path, WireId::from_u128(id), recorder.clone())
            .await
            .unwrap();
        wait_for("name announcement", || {
            !recorder.names.lock().unwrap().is_empty()
        })
        .await;
        assert_eq!(recorder.names.lock().unwrap()[0].1, "세션 A");
        link.shutdown().await;
        server.shutdown().await;
        let _ = std::fs::remove_dir_all(&path);
    }
    // An app that drops the connection on a name request, then is seen again as the same
    // instance, is treated as not supporting it: no further announcements, explicit error.
    async fn drop_on_name_then_reconnect(
        second_app: fn(u128) -> u128,
    ) -> (Arc<Recorder>, Arc<AdapterLink>, LocalServer, PathBuf) {
        let (path, id) = unique_path();
        let first = Arc::new(Recorder {
            hang: true,
            ..Default::default()
        });
        let server = LocalServer::start(&path, WireId::from_u128(id), first.clone())
            .await
            .unwrap();
        let link = Arc::new(AdapterLink::start(path.clone()));
        wait_online(&link).await;
        let caller = {
            let link = link.clone();
            tokio::spawn(async move {
                link.call(set_name("세션 A"), CancellationToken::new())
                    .await
            })
        };
        wait_for("first name request", || {
            !first.names.lock().unwrap().is_empty()
        })
        .await;
        server.shutdown().await;
        assert!(caller.await.unwrap().is_err());
        let second = Arc::new(Recorder::default());
        let server = LocalServer::start(&path, WireId::from_u128(second_app(id)), second.clone())
            .await
            .unwrap();
        wait_online(&link).await;
        // Leave time for an announcement that would have been sent right after connecting.
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        (second, link, server, path)
    }
    #[tokio::test]
    async fn same_app_dropping_on_a_name_request_is_confirmed_unsupported() {
        let (second, link, server, path) = drop_on_name_then_reconnect(|id| id).await;
        assert!(second.names.lock().unwrap().is_empty());
        let error = link
            .call(set_name("세션 A"), CancellationToken::new())
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::ProtocolMismatch);
        assert!(second.names.lock().unwrap().is_empty());
        link.shutdown().await;
        server.shutdown().await;
        let _ = std::fs::remove_dir_all(&path);
    }
    #[tokio::test]
    async fn restarted_app_gets_the_name_again() {
        let (second, link, server, path) = drop_on_name_then_reconnect(|id| id + 1).await;
        wait_for("name announcement to the new app", || {
            !second.names.lock().unwrap().is_empty()
        })
        .await;
        assert!(
            link.call(set_name("세션 A"), CancellationToken::new())
                .await
                .is_ok()
        );
        link.shutdown().await;
        server.shutdown().await;
        let _ = std::fs::remove_dir_all(&path);
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
            suspect: None,
            unsupported: None,
        });
        old.close();
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
