//! What the app does outside its window: links, files, folders and a terminal with Claude Code.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

use studio_engine::{find_uv, home_dir};

use crate::{in_thread, St};

/// What the window needs to start, and whether uv and Claude Code are installed.
#[tauri::command]
pub fn info(s: St<'_>) -> Value {
    json!({
        "port": s.port.get(),
        "root": s.engine.root,
        "home": home_dir(),
        "claude": studio_agent::find_claude(),
        "uv": find_uv().is_some(),
        "install": studio_agent::INSTALL,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// Opens a web link from the chat in the default browser.
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    studio_shell::open_url(&url)
}

/// Saves an exported conversation in the Downloads folder and returns where it went, without
/// overwriting another file.
#[tauri::command]
pub async fn save_export(name: String, text: String) -> Result<String, String> {
    in_thread(move || {
        let folder = home_dir().ok_or("No user folder")?.join("Downloads");
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
/// editor or the file explorer. See studio_shell::open_path for what is allowed.
#[tauri::command]
pub async fn open_path(s: St<'_>, path: String, create: Option<bool>) -> Result<(), String> {
    let mut allowed: Vec<PathBuf> = home_dir().into_iter().collect();
    allowed.push(s.engine.root.clone());
    allowed.extend(std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from));
    in_thread(move || studio_shell::open_path(&path, create == Some(true), &allowed)).await
}

/// Opens Claude Code in a terminal window, continuing this conversation when there is one.
#[tauri::command]
pub fn open_terminal(s: St<'_>, session: Option<String>) -> Result<(), String> {
    let claude = studio_agent::find_claude().ok_or("Claude Code is not installed")?;
    let session = session.filter(|id| studio_agent::valid_id(id));
    let mut c = terminal(&claude, session.as_deref())?;
    c.current_dir(&s.engine.root);
    studio_agent::clean_env(&mut c);
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// The command that opens a terminal window with Claude Code in it.
#[cfg(windows)]
fn terminal(claude: &Path, session: Option<&str>) -> Result<Command, String> {
    use std::os::windows::process::CommandExt;
    let mut line = format!("& '{}'", claude.to_string_lossy().replace('\'', "''"));
    if let Some(id) = session {
        line.push_str(&format!(" --resume {id}"));
    }
    let mut c =
        Command::new(studio_engine::system_tool(&["System32", "WindowsPowerShell", "v1.0", "powershell.exe"]));
    c.args(["-NoLogo", "-NoExit", "-Command", &line]);
    c.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE: its own window
    Ok(c)
}

/// On Linux: the first terminal program found. gnome-terminal takes the command after “--”,
/// xfce4-terminal after “-x” and the others after “-e”.
#[cfg(not(windows))]
fn terminal(claude: &Path, session: Option<&str>) -> Result<Command, String> {
    const TERMINALS: [(&str, &str); 5] = [
        ("x-terminal-emulator", "-e"),
        ("gnome-terminal", "--"),
        ("konsole", "-e"),
        ("xfce4-terminal", "-x"),
        ("xterm", "-e"),
    ];
    let (program, flag) = TERMINALS
        .iter()
        .find_map(|(name, flag)| studio_engine::on_path(name).map(|p| (p, *flag)))
        .ok_or("No terminal program was found")?;
    let mut c = Command::new(program);
    c.arg(flag).arg(claude);
    if let Some(id) = session {
        c.args(["--resume", id]);
    }
    Ok(c)
}
