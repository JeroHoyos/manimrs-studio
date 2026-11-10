//! ManimRS Studio: desktop app to make the slides of your talks with Claude.
//!
//! - The window (frontend/apps/studio) shows the list of slides, the video of each one and a chat
//!   with Claude. It calls the commands in `commands/`.
//! - Claude Code runs headless behind the chat (studio_agent), connected to the app's MCP server
//!   (mcp.rs, server.rs).
//! - Renders are made by engine/studio.py with manim, one slide at a time (studio_engine).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod mcp;
mod server;

use std::sync::{Arc, Mutex, OnceLock};

use serde_json::Value;
use tauri::{Emitter, Manager, RunEvent, State};

use studio_agent::Session;
use studio_engine::jobs::Jobs;
use studio_engine::{lock, Emit, Engine};

pub struct Shared {
    pub engine: Engine,
    pub jobs: Jobs,
    pub app: tauri::AppHandle,
    pub claude: Mutex<Option<Session>>,
    pub port: OnceLock<u16>,
    /// The secret Claude needs to use the local MCP server.
    pub token: String,
}

impl Shared {
    /// The function the libraries call to send an event to the window.
    pub fn emit(&self) -> Emit {
        emitter(self.app.clone())
    }
}

pub type St<'a> = State<'a, Arc<Shared>>;

fn emitter(app: tauri::AppHandle) -> Emit {
    Arc::new(move |event: &str, data: Value| {
        let _ = app.emit(event, data);
    })
}

/// Runs something that blocks (a Python process) without freezing the window.
pub async fn in_thread<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// The window only shows the app's own page. If a link got past the page's own handling, the web
/// page would load here, in place of the app: it is refused instead.
fn stays_in_app(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") || url.as_str() == "about:blank"
}

/// Where Microsoft gives the WebView2 runtime (Windows 11 has it, an older Windows 10 may not).
#[cfg(windows)]
const WEBVIEW2: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

fn main() {
    // On Windows the window is a WebView2: without it the app would close without a word.
    #[cfg(windows)]
    {
        if tauri::webview_version().is_err() {
            return studio_shell::message(
                "ManimRS Studio can't start",
                &format!("The app needs the Microsoft Edge WebView2 Runtime. Install it from {WEBVIEW2} and open the app again"),
            );
        }
    }
    // Without the engine there is nothing to show: say so instead of closing without a word.
    let engine = match Engine::new() {
        Ok(e) => e,
        Err(e) => return studio_shell::message("ManimRS Studio can't start", &e),
    };
    let token = match server::new_token() {
        Ok(t) => t,
        Err(e) => return studio_shell::message("ManimRS Studio can't start", &e),
    };
    let app = tauri::Builder::default()
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("stay").on_navigation(|_, url| stays_in_app(url)).build())
        .setup(move |app| {
            let handle = app.handle().clone();
            let s = Arc::new(Shared {
                jobs: Jobs::new(engine.clone(), emitter(handle.clone())),
                engine,
                app: handle,
                claude: Mutex::new(None),
                port: OnceLock::new(),
                token,
            });
            let port = server::start(s.clone())?;
            s.port.set(port).ok();
            app.manage(s);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::info,
            commands::system::open_link,
            commands::system::save_export,
            commands::system::open_path,
            commands::system::open_terminal,
            commands::talks::talks,
            commands::talks::new_talk,
            commands::talks::open_talk,
            commands::talks::save_talk,
            commands::talks::forget_talk,
            commands::talks::show_talk_folder,
            commands::talks::pick_folder,
            commands::slides::status,
            commands::slides::jobs,
            commands::slides::render,
            commands::slides::edit,
            commands::slides::export,
            commands::slides::cancel,
            commands::slides::present,
            commands::slides::review,
            commands::slides::open_exported,
            commands::chat::claude_start,
            commands::chat::claude_send,
            commands::chat::claude_stop,
            commands::chat::claude_sessions,
            commands::chat::claude_transcript,
            commands::chat::find_files,
        ])
        .build(tauri::generate_context!());
    let app = match app {
        Ok(a) => a,
        Err(e) => return studio_shell::message("ManimRS Studio can't start", &e.to_string()),
    };

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(s) = app.try_state::<Arc<Shared>>() {
                lock(&s.claude).take();
                s.jobs.cancel_all();
            }
        }
    });
}
