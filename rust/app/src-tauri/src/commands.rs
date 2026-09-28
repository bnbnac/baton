use crate::{dto::*, *};
use std::sync::{Arc, Mutex};
use tauri::{State, WebviewWindow, ipc::Channel};
pub struct Pipe(pub Mutex<Option<Channel<UiEvent>>>);
struct OutputPipe(Channel<FrameDto>);
impl OutputSink for OutputPipe {
    fn frame(&self, frame: FrameDto) -> Result<(), AppError> {
        self.0
            .send(frame)
            .map_err(|_| AppError::new("frontend_lost"))
    }
}
impl EventSink for Pipe {
    fn emit(&self, event: UiEvent) -> Result<(), AppError> {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .ok_or_else(|| AppError::new("frontend_missing"))?
            .send(event)
            .map_err(|_| AppError::new("frontend_lost"))
    }
}
pub struct Managed {
    pub service: Arc<AppService>,
    pub pipe: Arc<Pipe>,
}
fn local(window: &WebviewWindow) -> Result<(), AppError> {
    if window.label() != "main" {
        Err(AppError::new("wrong_window"))
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn connect_session(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: ConnectionRequest,
) -> Result<SessionInfo, AppError> {
    local(&window)?;
    state.service.connect(request)
}
#[tauri::command]
pub fn answer_auth(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: AuthResponse,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.answer(request)
}
#[tauri::command]
pub fn cancel_connect(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: SessionRequest,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.close(request.id)
}
#[tauri::command]
pub async fn list_sessions(
    window: WebviewWindow,
    state: State<'_, Managed>,
    events: Channel<UiEvent>,
) -> Result<Vec<SessionInfo>, AppError> {
    local(&window)?;
    let mut pipe = state.pipe.0.lock().unwrap();
    if pipe.is_some() {
        drop(pipe);
        state.service.frontend_lost();
        return Err(AppError::new("frontend_lost"));
    }
    *pipe = Some(events);
    drop(pipe);
    state.service.start_frontend()?;
    Ok(state.service.list())
}
#[tauri::command]
pub fn close_session(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: SessionRequest,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.close(request.id)
}
#[tauri::command]
pub fn remove_closed_session(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: SessionRequest,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.remove(request.id)
}
#[tauri::command]
pub async fn bind_terminal(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: SessionRequest,
    output: Channel<FrameDto>,
) -> Result<Binding, AppError> {
    local(&window)?;
    let binding = state.service.bind(request.id).await?;
    state
        .service
        .start_output(binding, Arc::new(OutputPipe(output)))?;
    Ok(binding)
}
#[tauri::command]
pub async fn user_input(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: UserInput,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.user_input(request).await
}
#[tauri::command]
pub async fn ack_output(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: AckRequest,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.ack(request).await
}
#[tauri::command]
pub async fn terminal_reply(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: ReplyRequest,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.reply(request).await
}
#[tauri::command]
pub async fn resize_terminal(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: ResizeRequest,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.resize(request).await
}
#[tauri::command]
pub fn frontend_pong(
    window: WebviewWindow,
    state: State<'_, Managed>,
    request: SessionRequest,
) -> Result<(), AppError> {
    local(&window)?;
    state.service.pong(request.id)
}
