use baton_app::{commands::*, dto::*, *};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[tauri::command]
fn fixture_config() -> serde_json::Value {
    eprintln!("fixture frontend ready");
    serde_json::json!({"port":std::env::var("BATON_FIXTURE_PORT").unwrap().parse::<u16>().unwrap(),"second":std::env::var("BATON_SECOND_PORT").unwrap().parse::<u16>().unwrap(),"single":std::env::var("BATON_DESKTOP_CASE").ok(),"suite":std::env::var("BATON_DESKTOP_SUITE").unwrap_or("terminal".into()),"openssh":std::env::var("BATON_PROBE_SSH_PORT").ok(),"otherOpenSsh":std::env::var("BATON_PROBE_OTHER_SSH_PORT").ok(),"fingerprint":std::env::var("BATON_PROBE_HOST_KEY").ok(),"hold":std::env::var("BATON_DESKTOP_HOLD").ok()})
}
#[tauri::command]
async fn fixture(request: serde_json::Value) -> Result<serde_json::Value, String> {
    if request["action"] == "barrier" {
        std::fs::write(
            std::env::var("BATON_DESKTOP_BARRIER").map_err(|_| "barrier_path_missing")?,
            serde_json::to_vec(&serde_json::json!({"stage":request["stage"]})).unwrap(),
        )
        .map_err(|e| e.to_string())?;
        return Ok(serde_json::Value::Null);
    }
    if request["action"] == "progress" {
        eprintln!("case: {}", request["name"]);
        return Ok(serde_json::Value::Null);
    }
    let port = std::env::var(if request["server"] == 2 {
        "BATON_SECOND_CONTROL"
    } else {
        "BATON_CONTROL_PORT"
    })
    .map_err(|_| "no_control")?
    .parse::<u16>()
    .map_err(|_| "bad_control")?;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut socket = tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|e| e.to_string())?;
        socket
            .write_all(format!("{request}\n").as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(socket)
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&line).map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "control_timeout".to_string())?
}
#[tauri::command]
async fn set_owner(
    state: State<'_, Managed>,
    binding: Binding,
    user: bool,
    stream: u64,
) -> Result<SessionInfo, AppError> {
    acceptance::owner(&state.service, binding, user, stream).await
}
#[tauri::command]
async fn public_read(state: State<'_, Managed>, binding: Binding) -> Result<String, AppError> {
    acceptance::public_read(&state.service, binding).await
}
#[tauri::command]
async fn finish(
    app: tauri::AppHandle,
    state: State<'_, Managed>,
    outcomes: serde_json::Value,
) -> Result<(), String> {
    state.service.shutdown().await;
    let runtime = tauri::webview_version().map_err(|e| e.to_string())?;
    let result = serde_json::json!({"outcomes":outcomes,"webviewVersion":runtime});
    std::fs::write(
        std::env::var("BATON_DESKTOP_REPORT").map_err(|_| "no_report")?,
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let pipe = Arc::new(Pipe(Mutex::new(None)));
            let service = acceptance::service(pipe.clone());
            app.manage(Managed { service, pipe });
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_directory(std::path::PathBuf::from(
                    std::env::var("BATON_WEBVIEW_DATA").expect("unique fixture data directory"),
                ))
                .on_navigation(|url| {
                    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_page_load(|_, p| eprintln!("page {:?}", p.event()))
        .invoke_handler(tauri::generate_handler![
            connect_session,
            answer_auth,
            cancel_connect,
            list_sessions,
            close_session,
            remove_closed_session,
            bind_terminal,
            user_input,
            ack_output,
            terminal_reply,
            resize_terminal,
            frontend_pong,
            fixture_config,
            fixture,
            set_owner,
            public_read,
            finish
        ])
        .run(tauri::generate_context!("acceptance/tauri.conf.json"))
        .expect("acceptance startup failed");
}
