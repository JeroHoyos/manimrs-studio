//! ManimRS Studio: desktop app to make the slides of your talks with Claude.
//!
//! - The window (ui/) shows the list of slides, the video of each one and a chat with Claude.
//! - Claude Code runs headless behind the chat, connected to the app's MCP server (claude.rs, mcp.rs).
//! - Renders are made by engine/studio.py with manim, one slide at a time (engine.rs, jobs.rs).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude;
mod engine;
mod jobs;
mod mcp;
mod server;
mod shell;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::{Manager, RunEvent, State};

use claude::Session;
use engine::{check_talk, lock, Engine};
use jobs::{Jobs, Summary};

pub struct Shared {
    pub engine: Engine,
    pub jobs: Jobs,
    pub app: tauri::AppHandle,
    pub claude: Mutex<Option<Session>>,
    pub port: OnceLock<u16>,
    /// The secret Claude needs to use the local MCP server.
    pub token: String,
}

type St<'a> = State<'a, Arc<Shared>>;

const QUALITIES: [&str; 3] = ["480p", "720p", "1080p"];

/// Runs something that blocks (a Python process) without freezing the window.
async fn in_thread<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

#[tauri::command]
fn info(s: St<'_>) -> Value {
    json!({ "port": s.port.get(), "root": s.engine.root, "home": home(), "claude": claude::find_claude() })
}

#[tauri::command]
async fn talks(s: St<'_>) -> Result<Value, String> {
    let e = s.engine.clone();
    in_thread(move || e.json(["talks", "--json"])).await
}

/// Creates a talk with a title slide and a closing slide in `place`/`folder` (the talks folder and
/// charla-<title> if they are not given); returns `{id, title, path}`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn new_talk(
    s: St<'_>,
    title: String,
    about: String,
    language: String,
    place: Option<String>,
    folder: Option<String>,
) -> Result<Value, String> {
    let e = s.engine.clone();
    in_thread(move || {
        let mut args = vec![
            "new-talk".to_string(),
            "--json".into(),
            format!("--about={about}"),
            format!("--language={language}"),
        ];
        if let Some(p) = place.filter(|p| !p.trim().is_empty()) {
            if !Path::new(&p).is_absolute() {
                return Err("Choose the folder that will hold it".into());
            }
            args.push(format!("--in={p}"));
        }
        if let Some(f) = folder.filter(|f| !f.trim().is_empty()) {
            args.push(format!("--folder={f}"));
        }
        // After “--” everything is title, even if it starts with a dash.
        args.extend(["--".into(), title]);
        e.json(args)
    })
    .await
}

/// Adds the talk in a folder (its own folder, its presentacion/ or its talk.manimrs) to the list;
/// returns `{id, title, path}`.
#[tauri::command]
async fn open_talk(s: St<'_>, path: String) -> Result<Value, String> {
    if !Path::new(&path).is_absolute() {
        return Err("Choose a folder".into());
    }
    let e = s.engine.clone();
    in_thread(move || e.json(["open".to_string(), "--json".into(), "--".into(), path])).await
}

/// Changes what talk.manimrs says (title, what it is about, resolution…); returns all its fields.
#[tauri::command]
async fn save_talk(s: St<'_>, talk: String, fields: HashMap<String, String>) -> Result<Value, String> {
    const FIELDS: [&str; 5] = ["title", "about", "author", "language", "resolution"];
    check_talk(&talk)?;
    let mut args = vec![talk, "info".to_string(), "--json".into()];
    for (k, v) in fields {
        if !FIELDS.contains(&k.as_str()) {
            return Err("A talk has no such field".into());
        }
        args.push(format!("--{k}={v}"));
    }
    let e = s.engine.clone();
    in_thread(move || e.json(args)).await
}

/// Takes a talk off the list; its folder stays as it is.
#[tauri::command]
async fn forget_talk(s: St<'_>, talk: String) -> Result<String, String> {
    check_talk(&talk)?;
    let e = s.engine.clone();
    in_thread(move || e.text([talk.as_str(), "forget"]).map(|t| t.trim().to_string())).await
}

/// Opens the talk's folder in the file explorer.
#[tauri::command]
fn show_talk_folder(s: St<'_>, talk: String) -> Result<(), String> {
    let pres = s.engine.presentation(&talk).ok_or("There is no such talk")?;
    shell::open_folder(&pres)
}

/// The Windows folder picker, over the window. Returns `{path, empty}`, or nothing if it was closed.
#[tauri::command]
async fn pick_folder(window: tauri::WebviewWindow, title: String, start: Option<String>) -> Result<Option<Value>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    // A thread of its own: the dialog needs COM set up its way, and must not hold the window's.
    std::thread::spawn(move || {
        let mut dialog = rfd::FileDialog::new().set_title(title.chars().take(120).collect::<String>()).set_parent(&window);
        if let Some(dir) = start.map(PathBuf::from).filter(|p| p.is_absolute() && p.is_dir()) {
            dialog = dialog.set_directory(dir);
        }
        let picked = dialog.pick_folder().map(|p| {
            let empty = std::fs::read_dir(&p).map(|mut it| it.next().is_none()).unwrap_or(false);
            json!({ "path": p, "empty": empty })
        });
        tx.send(picked).ok();
    });
    in_thread(move || rx.recv().map_err(|_| "The folder picker closed unexpectedly".to_string())).await
}

#[tauri::command]
async fn status(s: St<'_>, talk: String) -> Result<Value, String> {
    check_talk(&talk)?;
    let e = s.engine.clone();
    in_thread(move || e.status(&talk)).await
}

#[tauri::command]
fn jobs(s: St<'_>) -> Vec<Summary> {
    s.jobs.summary()
}

/// `what` is a list of slides, "pending" or "all". `quality` is the talk's; the slides with a
/// resolution of their own come out in theirs.
#[tauri::command]
fn render(s: St<'_>, talk: String, what: Value, quality: String) -> Result<(), String> {
    check_talk(&talk)?;
    if !QUALITIES.contains(&quality.as_str()) {
        return Err("The quality is 480p, 720p or 1080p".into());
    }
    let mut args = vec![talk.clone(), "render".to_string(), format!("--quality={quality}")];
    let title = match &what {
        Value::String(w) if w == "pending" => {
            args.push("--pending".into());
            "Render of the pending slides".to_string()
        }
        Value::String(w) if w == "all" => {
            args.push("--all".into());
            "Render of the whole talk".to_string()
        }
        Value::Array(v) => {
            let names: Vec<String> = v.iter().filter_map(|x| x.as_str().map(String::from)).collect();
            let title = match names.as_slice() {
                [] => return Err("There are no slides to render".into()),
                [one] => format!("Render of {one} ({quality})"),
                many => format!("Render of {} slides", many.len()),
            };
            // After “--” a slide is always a slide, even if its name starts with a dash.
            args.push("--".into());
            args.extend(names);
            title
        }
        _ => return Err("I don't know what to render".into()),
    };
    s.jobs.add(&talk, &title, args);
    Ok(())
}

/// Changes to the talk: new, move, rename, restore, delete and resolution. Returns what
/// studio.py answered (for “new”, a JSON with the created slide).
#[tauri::command]
async fn edit(s: St<'_>, talk: String, args: Vec<String>) -> Result<String, String> {
    const ORDERS: [&str; 6] = ["new", "move", "rename", "restore", "delete", "resolution"];
    check_talk(&talk)?;
    if !args.first().is_some_and(|o| ORDERS.contains(&o.as_str())) {
        return Err("That order does not exist".into());
    }
    let e = s.engine.clone();
    in_thread(move || {
        let mut all = vec![talk];
        all.extend(args);
        e.text(&all).map(|t| t.trim().to_string())
    })
    .await
}

#[tauri::command]
fn export(s: St<'_>, talk: String, format: String) -> Result<(), String> {
    check_talk(&talk)?;
    let mut args = vec![talk.clone(), "export".to_string()];
    match format.as_str() {
        "pdf" => args.push("--pdf".into()),
        "html" => {}
        _ => return Err("The export is HTML or PDF".into()),
    }
    s.jobs.add(&talk, &format!("Export {talk} ({})", format.to_uppercase()), args);
    Ok(())
}

#[tauri::command]
fn cancel(s: St<'_>, id: u64) {
    s.jobs.cancel(id);
}

#[tauri::command]
async fn present(s: St<'_>, talk: String, start: Option<String>) -> Result<(), String> {
    let e = s.engine.clone();
    in_thread(move || e.present(&talk, start.as_deref())).await
}

/// `status`: "approved", "changes" or "clear".
#[tauri::command]
async fn review(s: St<'_>, talk: String, name: String, status: String, note: String) -> Result<(), String> {
    check_talk(&talk)?;
    let e = s.engine.clone();
    in_thread(move || {
        let mut args = vec![talk, "note".to_string()];
        match status.as_str() {
            "approved" => args.push("--approve".into()),
            "clear" => args.push("--clear".into()),
            "changes" => {}
            _ => return Err("That review does not exist".into()),
        }
        // After “--” everything is text, even if the note starts with a dash.
        args.extend(["--".into(), name]);
        if !note.trim().is_empty() {
            args.push(note);
        }
        e.text(&args).map(|_| ())
    })
    .await
}

#[tauri::command]
fn open_exported(s: St<'_>, talk: String) -> Result<(), String> {
    let pres = s.engine.presentation(&talk).ok_or("There is no such talk")?;
    let folder = pres.join("diapos").join("exported");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    shell::open_folder(&folder)
}

/// Opens a web link from the chat in the default browser.
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    shell::open_url(&url)
}

/// Saves an exported conversation in the Downloads folder and returns where it went, without
/// overwriting another file.
#[tauri::command]
async fn save_export(name: String, text: String) -> Result<String, String> {
    in_thread(move || {
        let folder = home().ok_or("No user folder")?.join("Downloads");
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let clean: String = name
            .chars()
            .take(120)
            .map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '-' })
            .collect();
        let clean = clean.trim_matches(['-', '.']);
        let clean = if clean.is_empty() { "conversation.txt" } else { clean };
        let (stem, ext) = clean.rsplit_once('.').unwrap_or((clean, "txt"));
        let mut path = folder.join(format!("{stem}.{ext}"));
        for n in 2.. {
            if !path.exists() {
                break;
            }
            path = folder.join(format!("{stem} ({n}).{ext}"));
        }
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Opens a Claude Code file or folder (a CLAUDE.md, the memory folder, a settings file) in the
/// editor or the file explorer. See shell::open_path for what is allowed.
#[tauri::command]
async fn open_path(s: St<'_>, path: String, create: Option<bool>) -> Result<(), String> {
    let mut allowed: Vec<PathBuf> = home().into_iter().collect();
    allowed.push(s.engine.root.clone());
    allowed.extend(std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from));
    in_thread(move || shell::open_path(&path, create == Some(true), &allowed)).await
}

/// Opens Claude Code in a terminal window, continuing this conversation when there is one.
#[tauri::command]
fn open_terminal(s: St<'_>, session: Option<String>) -> Result<(), String> {
    let claude = claude::find_claude().ok_or("Claude Code is not installed")?;
    let mut line = format!("& '{}'", claude.to_string_lossy().replace('\'', "''"));
    if let Some(id) = session.filter(|id| claude::valid_id(id)) {
        line.push_str(&format!(" --resume {id}"));
    }
    let mut c = Command::new("powershell.exe");
    c.args(["-NoLogo", "-NoExit", "-Command", &line]).current_dir(&s.engine.root);
    claude::clean_env(&mut c);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE: its own window
    }
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ───────────── Claude ─────────────

/// Starts a Claude session (a new one, or `resume` to continue a past one), closing the current one.
#[tauri::command]
async fn claude_start(s: St<'_>, options: claude::Options) -> Result<Value, String> {
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
        let session = Session::start(s.app.clone(), &s.engine.root, &others, port, &s.token, &options)?;
        let r = json!({ "generation": session.generation });
        *current = Some(session);
        Ok(r)
    })
    .await
}

#[tauri::command]
fn claude_send(s: St<'_>, message: Value) -> Result<(), String> {
    lock(&s.claude).as_mut().ok_or("Claude is not running")?.send(&message)
}

#[tauri::command]
async fn claude_stop(s: St<'_>) -> Result<(), String> {
    let s = s.inner().clone();
    in_thread(move || {
        let old = lock(&s.claude).take();
        drop(old); // stops it, outside the lock
        Ok(())
    })
    .await
}

#[tauri::command]
async fn claude_sessions(s: St<'_>) -> Result<Vec<Value>, String> {
    let root = s.engine.root.clone();
    in_thread(move || Ok(claude::sessions(&root))).await
}

#[tauri::command]
async fn claude_transcript(s: St<'_>, id: String) -> Result<Vec<Value>, String> {
    let root = s.engine.root.clone();
    in_thread(move || claude::transcript(&root, &id)).await
}

/// Files for “@”: those of the talks folder and, if the open talk is somewhere else, its own.
#[tauri::command]
async fn find_files(s: St<'_>, query: String, talk: Option<String>) -> Result<Vec<String>, String> {
    let root = s.engine.root.clone();
    let outside = talk.and_then(|t| s.engine.presentation(&t)).filter(|p| !p.starts_with(&root));
    in_thread(move || Ok(claude::files(&root, outside.as_deref(), &query))).await
}

fn main() {
    // Without the engine there is nothing to show: say so instead of closing without a word.
    let engine = match Engine::new() {
        Ok(e) => e,
        Err(e) => return shell::message("ManimRS Studio can't start", &e),
    };
    let token = match server::new_token() {
        Ok(t) => t,
        Err(e) => return shell::message("ManimRS Studio can't start", &e),
    };
    let app = tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            let s = Arc::new(Shared {
                jobs: Jobs::new(engine.clone(), handle.clone()),
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
            info,
            talks,
            new_talk,
            open_talk,
            save_talk,
            forget_talk,
            show_talk_folder,
            pick_folder,
            status,
            jobs,
            render,
            edit,
            export,
            cancel,
            present,
            review,
            open_exported,
            open_link,
            save_export,
            open_path,
            open_terminal,
            claude_start,
            claude_send,
            claude_stop,
            claude_sessions,
            claude_transcript,
            find_files,
        ])
        .build(tauri::generate_context!());
    let app = match app {
        Ok(a) => a,
        Err(e) => return shell::message("ManimRS Studio can't start", &e.to_string()),
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
