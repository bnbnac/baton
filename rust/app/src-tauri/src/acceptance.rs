//! Trusted fixture assembly. Never registered by the product binary.
use crate::{dto::*, *};
use baton_core::*;
use std::sync::Arc;
pub fn service(sink: Arc<dyn EventSink>) -> Arc<AppService> {
    let mut registry = Registry::new(AppId::from_u128(1));
    registry
        .register_connection(ConnectionId::from_u128(1))
        .unwrap();
    AppService::with_registry(Arc::new(RealConnector), sink, registry)
}
pub async fn owner(
    app: &AppService,
    binding: Binding,
    user: bool,
    stream: u64,
) -> Result<SessionInfo, AppError> {
    let handle = app.handle(binding)?;
    if user {
        handle.reclaim().await
    } else {
        handle
            .handoff(
                ConnectionId::from_u128(1),
                StreamId::from_u128(stream.into()),
            )
            .await
    }
    .map_err(crate::app::core_error)?;
    let wanted = if user {
        State::UserOwned
    } else {
        State::AgentOwned
    };
    let mut changes = handle.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if changes.borrow_and_update().state == wanted {
                break;
            }
            changes
                .changed()
                .await
                .map_err(|_| AppError::new("closed"))?;
        }
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|_| AppError::new("owner_timeout"))??;
    app.publish();
    app.list()
        .into_iter()
        .find(|s| s.id == binding.session)
        .ok_or_else(|| AppError::new("missing_session"))
}
pub async fn public_read(app: &AppService, binding: Binding) -> Result<String, AppError> {
    let handle = app.handle(binding)?;
    let snapshot = handle.snapshot().await;
    handle
        .read(
            ReadCall {
                connection: ConnectionId::from_u128(1),
                epoch: snapshot.epoch,
                stream: snapshot.stream.ok_or_else(|| AppError::new("no_stream"))?,
                cursor: SafeInt::new(0).unwrap(),
                limit: 32768,
            },
            0,
        )
        .await
        .map(|p| p.text)
        .map_err(crate::app::core_error)
}
