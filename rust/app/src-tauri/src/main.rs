#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use baton_app::{commands::*, *};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::Manager;
fn main() {
    let exiting = Arc::new(AtomicBool::new(false));
    let allow_exit = Arc::new(AtomicBool::new(false));
    let app = tauri::Builder::default()
        .setup(|app| {
            let pipe = Arc::new(Pipe(Mutex::new(None)));
            let service = AppService::with_connector(Arc::new(RealConnector), pipe.clone());
            #[cfg(windows)]
            {
                let base = std::env::var_os("LOCALAPPDATA").ok_or("local_app_data_unavailable")?;
                let dir = baton_ipc::endpoint::prepare_endpoint_dir(std::path::Path::new(&base))
                    .map_err(|_| "ipc_directory_unavailable")?;
                let server = tauri::async_runtime::block_on(service.start_agent_server(&dir))
                    .map_err(|_| "ipc_start_failed")?;
                app.manage(Arc::new(server));
            }
            app.manage(Managed { service, pipe });
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(|url| {
                    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                let state = webview.state::<Managed>();
                if state.pipe.0.lock().unwrap().is_some() {
                    state.service.frontend_lost();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            connect_session,
            answer_auth,
            cancel_connect,
            list_sessions,
            list_agent_connections,
            handoff_session,
            reclaim_session,
            decline_intervention,
            close_session,
            remove_closed_session,
            bind_terminal,
            user_input,
            ack_output,
            terminal_reply,
            resize_terminal,
            frontend_pong
        ])
        .build(tauri::generate_context!())
        .expect("Baton startup failed");
    app.run(move |app, event| {
        let request = match event {
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                true
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                if allow_exit.load(Ordering::Acquire) {
                    return;
                }
                api.prevent_exit();
                true
            }
            _ => false,
        };
        if request && !exiting.swap(true, Ordering::AcqRel) {
            let service = app.state::<Managed>().service.clone();
            let handle = app.clone();
            let allow = allow_exit.clone();
            #[cfg(windows)]
            let ipc = app.state::<Arc<baton_ipc::LocalServer>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                #[cfg(windows)]
                tokio::join!(ipc.shutdown(), service.shutdown());
                #[cfg(not(windows))]
                service.shutdown().await;
                allow.store(true, Ordering::Release);
                handle.exit(0);
            });
        }
    });
}
