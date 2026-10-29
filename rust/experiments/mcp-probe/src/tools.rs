use rmcp::{ErrorData, RoleServer, ServerHandler, model::*, service::RequestContext};
use serde_json::json;
use tokio::sync::watch;

pub(crate) struct Probe {
    pub eof: watch::Receiver<bool>,
}
const NAMES: [&str; 6] = [
    "status",
    "read_output",
    "send_text",
    "send_key",
    "request_user_control",
    "probe_wait",
];

// MCP 2025-11-25 explicitly uses logging notifications. Newer SDK marks that
// protocol's API deprecated; this probe intentionally tests the legacy harness contract.
#[allow(deprecated)]
impl ServerHandler for Probe {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_logging()
                .build(),
        )
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult {
            tools: NAMES
                .iter()
                .map(|name| {
                    Tool::new(
                        *name,
                        "Phase 0 offline experiment; no SSH or IPC",
                        json!({"type":"object","properties":{}})
                            .as_object()
                            .unwrap()
                            .clone(),
                    )
                })
                .collect(),
            ..Default::default()
        })
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let result = match request.name.as_ref() {
            "status" => CallToolResult::success(vec![ContentBlock::text(
                json!({
                    "contract_version": 2, "app_state": "offline", "app_instance_id": null,
                    "connection_id": null, "sessions": []
                })
                .to_string(),
            )]),
            "probe_wait" => {
                context
                    .peer
                    .notify_logging_message(LoggingMessageNotificationParam::new(
                        LoggingLevel::Info,
                        json!("probe_wait_started"),
                    ))
                    .await
                    .map_err(|_| ErrorData::internal_error("notification_failed", None))?;
                let mut eof = self.eof.clone();
                tokio::select! {
                    _ = context.ct.cancelled() => {
                        context.peer.notify_logging_message(LoggingMessageNotificationParam::new(LoggingLevel::Info, json!("probe_wait_cancelled"))).await.map_err(|_| ErrorData::internal_error("notification_failed", None))?;
                    },
                    _ = async { let _ = eof.wait_for(|closed| *closed).await; } => {},
                }
                CallToolResult::error(vec![ContentBlock::text("cancelled")])
            }
            name if NAMES.contains(&name) => {
                CallToolResult::error(vec![ContentBlock::text("app_offline")])
            }
            _ => return Err(ErrorData::invalid_params("unknown_tool", None)),
        };
        Ok(result.into())
    }
}
