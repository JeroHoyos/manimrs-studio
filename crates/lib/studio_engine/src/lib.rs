//! The bridge to `manimrs-studio/engine/studio.py`, which knows how to read the talks (they are
//! Python, so it reads them with Python's `ast`) and render them. Here the command is built and its
//! output read, and the status of each talk is kept until one of its files changes.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde_json::Value;

pub mod jobs;

/// How a library tells the window that something happened: the name of the event and its data.
/// The desktop app gives a function that sends the event to the window; a library never knows Tauri.
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// Where the engine lives inside the talks folder.
const SCRIPT: [&str; 3] = ["manimrs-studio", "engine", "studio.py"];
/// The talks the studio knows, wherever they are (studio.py writes it, the app only reads it):
/// `{"talks": [{"id": "charla-git", "path": "charla-git/presentacion"}]}`, the paths inside the
/// talks folder relative to it.
const REGISTRY: [&str; 2] = ["manimrs-studio", "talks.json"];
/// Each talk's own file with what it is (title, what it is about, language, resolution).
pub const PROJECT_FILE: &str = "talk.manimrs";
pub const QUALITIES: [&str; 3] = ["480p", "720p", "1080p"];
/// A short order (status, list, an edit) that takes longer than this is stuck, and is stopped.
const SHORT: Duration = Duration::from_secs(120);
/// Even if no file seems to have changed, the status is read again after this long.
const STATUS_MAX_AGE: Duration = Duration::from_secs(30);
/// The folders of a talk that never change its status (the same list as NOT_SHARED in studio.py).
const NOT_SHARED: [&str; 8] = [
    ".venv", "media", "slides", "diapos", "__pycache__", ".ruff_cache", ".complexipy_cache", ".git",
];

#[derive(Clone)]
pub struct Engine {
    pub root: PathBuf,
    python: Vec<String>,
    script: PathBuf,
    /// The PATH for the engine when uv is installed but not on the PATH (see `path_with_uv`).
    path: Option<OsString>,
    statuses: Arc<Mutex<HashMap<PathBuf, Cached>>>,
    /// The last list of talks read, with the stamp of its file.
    registry: Arc<Mutex<Option<(u64, Talks)>>>,
}

/// The name and the folder of each talk on the list.
type Talks = Vec<(String, PathBuf)>;

struct Cached {
    stamp: u64,
    at: Instant,
    value: Value,
}

/// A background process: on Windows it opens no black window; on Linux it gets a process group of
/// its own, so kill_tree can stop it together with its children.
pub fn no_window(c: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    c
}

/// The user's folder (USERPROFILE on Windows, HOME on Linux).
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// The file name of a program: “uv.exe” on Windows, “uv” on Linux.
pub fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// Locks a mutex even if a thread panicked while holding it: the data is still usable here, and
/// one failed job must not take the whole app down with it.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A talk is a folder name: letters, digits, “-” and “_”, never starting with a dash (it would be
/// read as an option) and never a path.
pub fn valid_talk(talk: &str) -> bool {
    !talk.is_empty()
        && talk.len() <= 80
        && !talk.starts_with('-')
        && talk.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn check_talk(talk: &str) -> Result<(), String> {
    if valid_talk(talk) { Ok(()) } else { Err("There is no such talk".into()) }
}

impl Engine {
    pub fn new() -> Result<Self, String> {
        let root = find_root().ok_or(
            "Can't find the talks folder (the one with manimrs-studio\\engine\\studio.py). Open the \
             app from its shortcut in the manimrs-studio folder, or set the STUDIO_ROOT variable \
             to the talks folder",
        )?;
        let script = SCRIPT.iter().fold(root.clone(), |p, part| p.join(part));
        let python = find_python(&root);
        let path = path_with_uv();
        Ok(Engine { root, python, script, path, statuses: Arc::default(), registry: Arc::default() })
    }

    pub fn command<I, S>(&self, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut c = Command::new(&self.python[0]);
        c.args(&self.python[1..])
            .args(["-X", "utf8", "-u"])
            .arg(&self.script)
            .args(args)
            .current_dir(&self.root)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUNBUFFERED", "1")
            .env_remove("VIRTUAL_ENV")
            .stdin(Stdio::null());
        if let Some(path) = &self.path {
            c.env("PATH", path);
        }
        no_window(&mut c);
        c
    }

    /// Runs a short command and returns what it printed (or the error it gave). If it hangs, it
    /// is stopped after a while instead of leaving the window waiting forever.
    pub fn text<I, S>(&self, args: I) -> Result<String, String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let child = self
            .command(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not run Python: {e}"))?;
        let pid = child.id();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || tx.send(child.wait_with_output()).ok());
        let out = match rx.recv_timeout(SHORT) {
            Ok(r) => r.map_err(|e| format!("Could not run Python: {e}"))?,
            Err(_) => {
                kill_tree(pid);
                return Err("The studio took too long to answer and was stopped".into());
            }
        };
        let stdout = String::from_utf8_lossy(&out.stdout).replace("\r\n", "\n");
        if out.status.success() {
            Ok(stdout)
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr).replace("\r\n", "\n");
            Err(format!("{stdout}{stderr}").trim().to_string())
        }
    }

    pub fn json<I, S>(&self, args: I) -> Result<Value, String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let text = self.text(args)?;
        serde_json::from_str(&text).map_err(|e| format!("Unexpected answer from the studio: {e}"))
    }

    /// The status of a talk (its slides, renders and reviews). Reading it means starting Python
    /// and hashing all the talk's code, so it is kept until one of the files it depends on changes.
    pub fn status(&self, talk: &str) -> Result<Value, String> {
        let pres = self.presentation(talk).ok_or("There is no such talk")?;
        let stamp = stamp(&pres);
        if let Some(c) = lock(&self.statuses).get(&pres) {
            if c.stamp == stamp && c.at.elapsed() < STATUS_MAX_AGE {
                return Ok(c.value.clone());
            }
        }
        let value = self.json([talk, "status"])?;
        // With the stamp from before reading: if something changed meanwhile, it is read again.
        lock(&self.statuses).insert(pres, Cached { stamp, at: Instant::now(), value: value.clone() });
        Ok(value)
    }

    /// Opens the manim-slides presenter (its own window) without waiting for it to close.
    pub fn present(&self, talk: &str, start: Option<&str>) -> Result<(), String> {
        check_talk(talk)?;
        let mut args = vec![talk, "present"];
        if let Some(s) = start {
            args.extend(["--", s]);
        }
        let mut child = self
            .command(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not open the presenter: {e}"))?;
        std::thread::spawn(move || child.wait().ok());
        Ok(())
    }

    /// The folder with the main.py of a talk (wherever it is), also accepting the short name
    /// (“git” for “charla-git”).
    pub fn presentation(&self, talk: &str) -> Option<PathBuf> {
        if !valid_talk(talk) {
            return None;
        }
        let list = self.registry();
        if list.is_empty() {
            // Before studio.py makes the list for the first time: the talks next to the studio.
            return [talk.to_string(), format!("charla-{talk}")]
                .into_iter()
                .map(|n| self.root.join(n).join("presentacion"))
                .find(|p| p.join("main.py").is_file());
        }
        let long = format!("charla-{talk}");
        list.iter()
            .find(|(id, _)| id == talk)
            .or_else(|| list.iter().find(|(id, _)| *id == long))
            .map(|(_, p)| p.clone())
            .filter(|p| p.join("main.py").is_file())
    }

    /// The folders of every talk on the list that is there.
    pub fn talk_folders(&self) -> Vec<PathBuf> {
        self.registry().into_iter().map(|(_, p)| p).filter(|p| p.join("main.py").is_file()).collect()
    }

    /// The talk's resolution, from its talk.manimrs (1080p if it doesn't say).
    pub fn resolution(&self, talk: &str) -> String {
        self.presentation(talk)
            .and_then(|p| std::fs::read_to_string(p.join(PROJECT_FILE)).ok())
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.get("resolution").and_then(Value::as_str).map(String::from))
            .filter(|r| QUALITIES.contains(&r.as_str()))
            .unwrap_or_else(|| "1080p".into())
    }

    /// The list of talks, read again only when its file changes. While studio.py replaces it the
    /// file can't be read for a moment: then the last list read is used.
    fn registry(&self) -> Talks {
        let path = REGISTRY.iter().fold(self.root.clone(), |p, part| p.join(part));
        let mut h = DefaultHasher::new();
        add_file(&mut h, &path);
        let stamp = h.finish();
        let mut cached = lock(&self.registry);
        if let Some((s, list)) = cached.as_ref() {
            if *s == stamp {
                return list.clone();
            }
        }
        let mut text = None;
        for _ in 0..5 {
            match std::fs::read_to_string(&path) {
                Ok(t) => {
                    text = Some(t);
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(_) => std::thread::sleep(Duration::from_millis(20)),
            }
        }
        let Some(value) = text.and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
            return cached.as_ref().map(|(_, l)| l.clone()).unwrap_or_default();
        };
        let list: Talks = value
            .get("talks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|e| {
                let id = e.get("id")?.as_str()?;
                let path = PathBuf::from(e.get("path")?.as_str()?);
                let path = if path.is_absolute() { path } else { self.root.join(path) };
                valid_talk(id).then(|| (id.to_string(), path))
            })
            .collect();
        *cached = Some((stamp, list.clone()));
        list
    }
}

/// A number that changes whenever a file the status depends on changes: the talk's code, the
/// bookkeeping and per-slide files in `diapos/`, its thumbnails, its talk.manimrs and the README
/// with the title.
fn stamp(pres: &Path) -> u64 {
    let mut h = DefaultHasher::new();
    add_file(&mut h, &pres.join(PROJECT_FILE));
    add_file(&mut h, &pres.join("README.md"));
    if let Some(talk) = pres.parent() {
        add_file(&mut h, &talk.join("README.md"));
    }
    add_code(&mut h, pres);
    let renders = pres.join("diapos");
    add_files(&mut h, &renders);
    add_files(&mut h, &renders.join("_thumbnails"));
    h.finish()
}

fn add_meta(h: &mut DefaultHasher, p: &Path, m: &std::fs::Metadata) {
    p.hash(h);
    m.len().hash(h);
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).hash(h);
}

fn add_file(h: &mut DefaultHasher, p: &Path) {
    if let Ok(m) = p.metadata() {
        add_meta(h, p, &m);
    }
}

fn sorted(dir: &Path) -> Vec<std::fs::DirEntry> {
    let mut v: Vec<_> = std::fs::read_dir(dir).map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default();
    v.sort_by_key(|e| e.file_name());
    v
}

/// The files directly inside a folder.
fn add_files(h: &mut DefaultHasher, dir: &Path) {
    for e in sorted(dir) {
        if let Ok(m) = e.metadata() {
            if m.is_file() {
                add_meta(h, &e.path(), &m);
            }
        }
    }
}

/// Every .py of the talk, outside the folders that are not code.
fn add_code(h: &mut DefaultHasher, dir: &Path) {
    for e in sorted(dir) {
        let Ok(m) = e.metadata() else { continue };
        let name = e.file_name();
        let name = name.to_string_lossy();
        if m.is_dir() {
            if !NOT_SHARED.contains(&name.as_ref()) {
                add_code(h, &e.path());
            }
        } else if name.ends_with(".py") {
            add_meta(h, &e.path(), &m);
        }
    }
}

/// Reads a stream line by line without stopping if something that isn't UTF-8 arrives.
pub fn by_lines(reader: impl Read, mut each: impl FnMut(String)) {
    for chunk in BufReader::new(reader).split(b'\n').map_while(Result::ok) {
        let line = String::from_utf8_lossy(&chunk).trim_end_matches('\r').to_string();
        if !line.trim().is_empty() {
            each(line);
        }
    }
}

/// Kills a process and its children (uv → python → manim, or claude and its tools).
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    let mut c = {
        let mut c = Command::new(system_tool(&["System32", "taskkill.exe"]));
        c.args(["/T", "/F", "/PID", &pid.to_string()]);
        c
    };
    // A negative id names the whole process group that no_window gave it.
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("kill");
        c.args(["-KILL", "--", &format!("-{pid}")]);
        c
    };
    c.stdout(Stdio::null()).stderr(Stdio::null());
    no_window(&mut c);
    c.status().ok();
}

fn find_root() -> Option<PathBuf> {
    let has_engine = |p: &Path| SCRIPT.iter().fold(p.to_path_buf(), |p, part| p.join(part)).is_file();
    if let Some(r) = std::env::var_os("STUDIO_ROOT").map(PathBuf::from) {
        if has_engine(&r) {
            return Some(r);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        candidates.extend(exe.ancestors().map(Path::to_path_buf));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.extend(cwd.ancestors().map(Path::to_path_buf));
    }
    if let Some(home) = home_dir() {
        candidates.push(home.join("Documents").join("charlas"));
    }
    candidates.into_iter().find(|p| has_engine(p))
}

/// uv's Python, so each query doesn't pay for starting `uv run`.
fn find_python(root: &Path) -> Vec<String> {
    let uv = uv();
    let mut c = Command::new(&uv);
    c.args(["python", "find"]).current_dir(root).stdin(Stdio::null());
    no_window(&mut c);
    if let Ok(out) = c.output() {
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && Path::new(&path).is_file() {
            return vec![path];
        }
    }
    vec![uv, "run".into(), "--no-project".into(), "--quiet".into(), "python".into()]
}

fn uv() -> String {
    find_uv().map_or("uv".into(), |p| p.to_string_lossy().into_owned())
}

/// uv: where its installer puts it, or else the one on the PATH.
pub fn find_uv() -> Option<PathBuf> {
    let local = home_dir().map(|h| h.join(".local").join("bin").join(exe("uv"))).filter(|p| p.is_file());
    local.or_else(|| on_path("uv"))
}

/// A program by its name (“uv”), in the folders of the PATH.
pub fn on_path(name: &str) -> Option<PathBuf> {
    let (path, file) = (std::env::var_os("PATH")?, exe(name));
    std::env::split_paths(&path).map(|dir| dir.join(&file)).find(|p| p.is_file())
}

/// The engine runs `uv` by name to render and present. The installer of uv adds its folder to the
/// PATH, but a window that was already open (or a shortcut made before) does not see it yet: then
/// the engine gets a PATH with that folder at the end.
fn path_with_uv() -> Option<OsString> {
    if on_path("uv").is_some() {
        return None;
    }
    let dir = find_uv()?.parent()?.to_path_buf();
    let current = std::env::var_os("PATH").unwrap_or_default();
    std::env::join_paths(std::env::split_paths(&current).chain(Some(dir))).ok()
}

/// A program that comes with Windows, by its whole path: a program with the same name in another
/// folder of the PATH is never run in its place.
#[cfg(windows)]
pub fn system_tool(parts: &[&str]) -> PathBuf {
    let whole = std::env::var_os("SystemRoot")
        .map(|r| parts.iter().fold(PathBuf::from(r), |p, part| p.join(part)))
        .filter(|p| p.is_file());
    whole.unwrap_or_else(|| PathBuf::from(parts.last().copied().unwrap_or_default()))
}
