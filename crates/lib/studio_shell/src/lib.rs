//! What the app opens outside itself: web links in the browser, folders in the file explorer,
//! settings and CLAUDE.md files in the editor, and the message shown when the app can't start.
//!
//! Nothing goes through `cmd /C`: cmd reads `&`, `|` and `^` inside an argument as commands, so a
//! link like `https://x.com/?a=1&calc` would have run `calc`. The Windows shell is called directly.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use studio_engine::no_window;

/// Opens a web link (only http and https) in the default browser.
pub fn open_url(url: &str) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    let web = lower.starts_with("https://") || lower.starts_with("http://");
    if !web || url.len() > 4096 || url.chars().any(|c| c.is_control() || c == ' ' || c == '"') {
        return Err("Only web links open from here".into());
    }
    shell_open(OsStr::new(url), "open")
}

/// Opens a folder in the file explorer.
pub fn open_folder(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("That folder does not exist".into());
    }
    shell_open(path.as_os_str(), "explore")
}

/// The files that can be opened from the app's actions (settings, instructions and memories):
/// text the editor shows. Anything else is only pointed at in the explorer, never run.
const READABLE: [&str; 5] = ["md", "json", "jsonl", "txt", "toml"];

/// The files the app may create empty when you ask to edit one that does not exist yet.
const CREATABLE: [&str; 4] = ["CLAUDE.md", "CLAUDE.local.md", "settings.json", "settings.local.json"];

/// Opens a Claude Code file or folder (a CLAUDE.md, the memory folder, a settings file): folders
/// in the explorer, text files in VS Code (or the explorer if it is not installed). Only absolute
/// paths inside `allowed` folders; `create` makes an empty file first if it does not exist.
pub fn open_path(path: &str, create: bool, allowed: &[PathBuf]) -> Result<(), String> {
    let p = PathBuf::from(path);
    let plain = p.is_absolute() && p.components().all(|c| !matches!(c, Component::ParentDir));
    if !plain || !allowed.iter().any(|a| p.starts_with(a)) {
        return Err("That path is outside your Claude and talks folders".into());
    }
    if create && !p.exists() {
        let name = p.file_name().and_then(OsStr::to_str).unwrap_or("");
        if !CREATABLE.contains(&name) {
            return Err("Only CLAUDE.md and settings files can be created from here".into());
        }
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let empty = if name.ends_with(".json") { "{}\n" } else { "" };
        std::fs::write(&p, empty).map_err(|e| e.to_string())?;
    }
    if p.is_dir() {
        return open_folder(&p);
    }
    if !p.is_file() {
        return Err("That file does not exist".into());
    }
    let ext = p.extension().and_then(OsStr::to_str).unwrap_or("").to_ascii_lowercase();
    if READABLE.contains(&ext.as_str()) {
        if let Some(code) = vscode() {
            // Rust quotes arguments of a .cmd so cmd can't read them as commands (and refuses the
            // ones it can't quote safely).
            let mut c = Command::new(code);
            c.arg("-g").arg(&p);
            no_window(&mut c);
            if c.spawn().is_ok() {
                return Ok(());
            }
        }
    }
    reveal(&p)
}

/// Shows a file selected in its folder, without opening it.
#[cfg(windows)]
fn reveal(p: &Path) -> Result<(), String> {
    // explorer wants /select,"<path>" exactly like this; a Windows path can't contain quotes.
    use std::os::windows::process::CommandExt;
    let mut c = Command::new(studio_engine::system_tool(&["explorer.exe"]));
    c.raw_arg(format!("/select,\"{}\"", p.display()));
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// On Linux the file managers have no common way to select a file: its folder opens.
#[cfg(not(windows))]
fn reveal(p: &Path) -> Result<(), String> {
    open_folder(p.parent().ok_or("That file has no folder")?)
}

/// The folder picker of the system, over the window. Ok(None) if it was closed.
#[cfg(windows)]
pub fn pick_folder<W>(window: &W, title: &str, start: Option<PathBuf>) -> Result<Option<PathBuf>, String>
where
    W: raw_window_handle::HasWindowHandle + raw_window_handle::HasDisplayHandle,
{
    let mut dialog = rfd::FileDialog::new().set_title(title).set_parent(window);
    if let Some(dir) = start {
        dialog = dialog.set_directory(dir);
    }
    Ok(dialog.pick_folder())
}

/// On Linux the desktop's own dialog program is asked: zenity (GNOME and most others) or kdialog
/// (KDE). It prints the chosen folder; closing it prints nothing.
#[cfg(not(windows))]
pub fn pick_folder<W>(_window: &W, title: &str, start: Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    use studio_engine::on_path;
    let mut c = if let Some(zenity) = on_path("zenity") {
        let mut c = Command::new(zenity);
        c.args(["--file-selection", "--directory", "--title", title]);
        if let Some(dir) = &start {
            c.arg(format!("--filename={}/", dir.display()));
        }
        c
    } else if let Some(kdialog) = on_path("kdialog") {
        let mut c = Command::new(kdialog);
        c.args(["--title", title, "--getexistingdirectory"]).arg(start.unwrap_or_else(|| PathBuf::from(".")));
        c
    } else {
        return Err("To choose a folder, install zenity or kdialog".into());
    };
    let out = c.output().map_err(|e| e.to_string())?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok((out.status.success() && !path.is_empty()).then(|| PathBuf::from(path)))
}

/// VS Code's command line launcher.
#[cfg(not(windows))]
fn vscode() -> Option<PathBuf> {
    studio_engine::on_path("code")
}

#[cfg(windows)]
fn vscode() -> Option<PathBuf> {
    let on_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .map(|d| d.join("code.cmd"));
    let installed = std::env::var_os("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("Programs").join("Microsoft VS Code").join("bin").join("code.cmd"));
    on_path.chain(installed).find(|p| p.is_file())
}

/// A message box for errors that happen before the window exists.
pub fn message(title: &str, text: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let (title, text) = (wide(OsStr::new(title)), wide(OsStr::new(text)));
        unsafe {
            MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
        }
    }
    #[cfg(not(windows))]
    eprintln!("{title}: {text}");
}

#[cfg(windows)]
fn wide(s: &OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn shell_open(target: &OsStr, verb: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let (verb, target) = (wide(OsStr::new(verb)), wide(target));
    let r = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // Values above 32 mean it worked.
    if r as isize > 32 { Ok(()) } else { Err(format!("Windows could not open it (error {})", r as isize)) }
}

#[cfg(not(windows))]
fn shell_open(target: &OsStr, _verb: &str) -> Result<(), String> {
    Command::new("xdg-open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}
