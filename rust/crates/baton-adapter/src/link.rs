use baton_ipc::*;
#[cfg(windows)]
use std::sync::{Arc, Mutex};
pub struct AdapterLink {
    #[cfg(windows)]
    client: Mutex<Option<Arc<LocalClient>>>,
    failure: Option<WireError>,
}
impl AdapterLink {
    pub async fn connect(path: &std::path::Path) -> Self {
        #[cfg(windows)]
        {
            match LocalClient::connect(path).await {
                Ok(client) => Self {
                    client: Mutex::new(Some(Arc::new(client))),
                    failure: None,
                },
                Err(error) => Self {
                    client: Mutex::new(None),
                    failure: if error.code == ErrorCode::AppOffline {
                        None
                    } else {
                        Some(error)
                    },
                },
            }
        }
        #[cfg(not(windows))]
        {
            let _ = path;
            Self {
                failure: Some(WireError::new(ErrorCode::Unsupported)),
            }
        }
    }
    pub fn unavailable(error: WireError) -> Self {
        Self {
            #[cfg(windows)]
            client: Mutex::new(None),
            failure: if error.code == ErrorCode::AppOffline {
                None
            } else {
                Some(error)
            },
        }
    }
    fn offline(&self, status: bool) -> Result<AgentResponse, WireError> {
        if let Some(error) = &self.failure {
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
        let status = matches!(request, AgentRequest::Status {});
        #[cfg(windows)]
        {
            let client = {
                let mut current = self.client.lock().unwrap();
                if current.as_ref().is_some_and(|c| !c.is_connected()) {
                    *current = None;
                }
                current.clone()
            };
            let Some(client) = client else {
                return self.offline(status);
            };
            let input = matches!(
                request,
                AgentRequest::SendText { .. } | AgentRequest::SendKey { .. }
            );
            let result = client.call(request, cancel).await;
            if matches!(&result,Err(error) if matches!(error.code,ErrorCode::Disconnected|ErrorCode::AppOffline))
            {
                *self.client.lock().unwrap() = None;
                if input {
                    return Err(WireError::new(ErrorCode::Uncertain));
                }
                return self.offline(status);
            }
            result
        }
        #[cfg(not(windows))]
        {
            let _ = (request, cancel);
            self.offline(status)
        }
    }
}
