//! The Claude chat: start, send, stop, the past conversations and the files for “@”.

use std::path::PathBuf;

use serde_json::{json, Value};

use studio_agent::{Options, Session};
use studio_engine::lock;

use crate::{in_thread, St};

/// Starts a Claude session (a new one, or `resume` to continue a past one), closing the current one.
#[tauri::command]
pub async fn claude_start(s: St<'_>, options: Options) -> Result<Value, String> {
    let s = s.inner().clone();
    in_thread(move || {
        // A request that can't start must not close the conversation that is running.
        Session::check(&options)?;
        let mut current = lock(&s.claude);
        *current = None; // closes the previous one, so two never write the same conversation
        let port = *s.port.get().ok_or("The local server did not start")?;
        // The talks outside the talks folder, so Claude can work on their files too.
        let others: Vec<PathBuf> =
            s.engine.talk_folders().into_iter().filter(|p| !p.starts_with(&s.engine.root)).collect();
        let session = Session::start(s.emit(), &s.engine.root, &others, port, &s.token, &options)?;
        let r = json!({ "generation": session.generation });
        *current = Some(session);
        Ok(r)
    })
    .await
}

#[tauri::command]
pub fn claude_send(s: St<'_>, message: Value) -> Result<(), String> {
    lock(&s.claude).as_mut().ok_or("Claude is not running")?.send(&message)
}

#[tauri::command]
pub async fn claude_stop(s: St<'_>) -> Result<(), String> {
    let s = s.inner().clone();
    in_thread(move || {
        let old = lock(&s.claude).take();
        drop(old); // stops it, outside the lock
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn claude_sessions(s: St<'_>) -> Result<Vec<Value>, String> {
    let root = s.engine.root.clone();
    in_thread(move || Ok(studio_agent::sessions(&root))).await
}

#[tauri::command]
pub async fn claude_transcript(s: St<'_>, id: String) -> Result<Vec<Value>, String> {
    let root = s.engine.root.clone();
    in_thread(move || studio_agent::transcript(&root, &id)).await
}

/// Files for “@”: those of the talks folder and, if the open talk is somewhere else, its own.
#[tauri::command]
pub async fn find_files(s: St<'_>, query: String, talk: Option<String>) -> Result<Vec<String>, String> {
    let root = s.engine.root.clone();
    let outside = talk.and_then(|t| s.engine.presentation(&t)).filter(|p| !p.starts_with(&root));
    in_thread(move || Ok(studio_agent::files(&root, outside.as_deref(), &query))).await
}
