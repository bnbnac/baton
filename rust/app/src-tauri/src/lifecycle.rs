use crate::{app::*, dto::*};
use baton_core::{CloseReason, SessionId};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;
impl AppService {
    pub(crate) fn stop(&self, reason: CloseReason) {
        let mut state = self.state.lock().unwrap();
        state.stopping = true;
        for (id, entry) in &state.entries {
            entry.cancel.cancel();
            let _ = self
                .runtime
                .close_session(SessionId::from_u128(id.0), reason);
        }
    }
    pub fn frontend_lost(&self) {
        self.stop(CloseReason::FrontendLost);
    }
    pub async fn shutdown(&self) {
        let deadline = Instant::now() + Duration::from_secs(5);
        self.stop(CloseReason::AppExit);
        let tasks: Vec<_> = {
            let mut state = self.state.lock().unwrap();
            state
                .entries
                .values_mut()
                .flat_map(|e| std::mem::take(&mut e.tasks))
                .collect()
        };
        let drain = async {
            for mut task in tasks {
                if tokio::time::timeout_at(deadline, &mut task).await.is_err() {
                    task.abort();
                    let _ = task.await;
                }
            }
        };
        tokio::join!(self.runtime.shutdown(), drain);
    }
    pub fn start_frontend(self: &Arc<Self>) -> Result<(), AppError> {
        {
            let mut state = self.state.lock().unwrap();
            if state.frontend_started || state.stopping {
                drop(state);
                self.frontend_lost();
                return Err(AppError::new("frontend_lost"));
            }
            state.frontend_started = true;
            state.last_pong = Instant::now();
        }
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                let Some(app) = weak.upgrade() else { break };
                if app.heartbeat().is_err() {
                    break;
                }
            }
        });
        self.publish();
        self.publish_connections();
        Ok(())
    }
    pub fn heartbeat(&self) -> Result<(), AppError> {
        let challenge = {
            let mut state = self.state.lock().unwrap();
            if state.stopping {
                return Err(AppError::new("app_closed"));
            }
            if Instant::now().duration_since(state.last_pong) >= Duration::from_secs(30) {
                drop(state);
                self.frontend_lost();
                return Err(AppError::new("frontend_lost"));
            }
            let id = crate::ids::fresh()?;
            state.heartbeat = Some(id);
            id
        };
        self.send(UiEvent::Heartbeat { challenge })
    }
    pub fn pong(&self, id: Id) -> Result<(), AppError> {
        let mut state = self.state.lock().unwrap();
        if state.stopping || state.heartbeat != Some(id) {
            return Err(AppError::new("stale_heartbeat"));
        }
        state.heartbeat = None;
        state.last_pong = Instant::now();
        Ok(())
    }
}
