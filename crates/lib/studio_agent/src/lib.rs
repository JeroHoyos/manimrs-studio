//! The Claude panel. Claude Code runs headless (`claude -p` with stream-json in and out, the same
//! interface the Agent SDK and the editor extensions use), connected to the app's MCP server.
//! Every line Claude prints goes to the window as it is; the window draws the conversation and
//! answers permission requests and questions through `send`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};

use studio_engine::{by_lines, exe, home_dir, kill_tree, lock, no_window, on_path, Emit};

const INSTRUCTIONS: &str = "You are inside “ManimRS Studio”, a desktop app: next to this chat the \
user sees the list of slides of their manim talks and the video of each one. To see the status, \
render, look at and place slides use the tools of the “studio” MCP server (slides, notes, render, \
view, show, place) instead of the command line. Work one slide at a time: write or edit its file, \
render it, look at it with “view” and call “show” so the user reviews it in the panel. A talk can \
live in any folder: the “talks” tool gives each one's folder, and its talk.manimrs (next to its \
main.py) says what the talk is: title, what it is about, audience, language and resolution. Read it \
before making slides. The user talks to you from a chat panel, not from a terminal.";

static GENERATION: AtomicU64 = AtomicU64::new(0);

/// If the app was opened from another Claude Code session, these variables would make this one
/// believe it is a child session and it would not save its history. The other CLAUDE_* variables
/// (like the Git Bash path) belong to the user and stay.
const SESSION_VARS: [&str; 14] = [
    "CLAUDECODE",
    "CLAUDE_PID",
    "CLAUDE_AGENT_SDK_VERSION",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_EMIT_STARTUP_TIMING",
    "CLAUDE_CODE_STARTUP_FAILURE_RESULTS",
    "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
    "CLAUDE_CODE_ENABLE_TASKS",
    "CLAUDE_CODE_QUESTION_PREVIEW_FORMAT",
];

/// Removes the variables of a parent Claude Code session (see SESSION_VARS).
pub fn clean_env(c: &mut Command) -> &mut Command {
    for v in SESSION_VARS {
        c.env_remove(v);
    }
    c
}

/// How to install Claude Code, for the message shown when it is missing.
#[cfg(windows)]
pub const INSTALL: &str = "install it in PowerShell with: irm https://claude.ai/install.ps1 | iex";
#[cfg(not(windows))]
pub const INSTALL: &str = "install it in a terminal with: curl -fsSL https://claude.ai/install.sh | bash";

/// The permission modes the chat offers (“manual” is the newer name of “default”).
const MODES: [&str; 5] = ["default", "manual", "acceptEdits", "plan", "auto"];
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub resume: Option<String>,
    /// With `resume`: keep the conversation only up to this message (to rewind it).
    pub resume_session_at: Option<String>,
    /// With `resume`: continue in a new session, leaving the original as it was.
    pub fork_session: Option<bool>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub effort: Option<String>,
}

pub struct Session {
    stdin: ChildStdin,
    pid: u32,
    pub generation: u64,
}

impl Session {
    /// Checks the options and that Claude Code is installed, before closing the current session.
    pub fn check(o: &Options) -> Result<PathBuf, String> {
        if given(&o.model).is_some_and(|m| !valid_model(m)) {
            return Err("That model name is not valid".into());
        }
        if given(&o.permission_mode).is_some_and(|m| !MODES.contains(&m)) {
            return Err("That permission mode is not available here".into());
        }
        if given(&o.effort).is_some_and(|e| !EFFORTS.contains(&e)) {
            return Err("That effort level does not exist".into());
        }
        find_claude().ok_or_else(|| format!("Claude Code is not installed, {INSTALL}"))
    }

    /// `others` are folders outside `root` Claude may also work in (the talks kept elsewhere).
    pub fn start(
        emit: Emit,
        root: &Path,
        others: &[PathBuf],
        port: u16,
        token: &str,
        o: &Options,
    ) -> Result<Self, String> {
        let claude = Self::check(o)?;
        let (model, mode, effort) = (given(&o.model), given(&o.permission_mode), given(&o.effort));
        let mut c = Command::new(claude);
        c.args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--permission-prompt-tool",
            "stdio",
            // Echoes each message we send with its id, which “rewind” needs.
            "--replay-user-messages",
        ]);
        // Given as text, not as a file: the secret of the local server is never written to disk.
        c.arg("--mcp-config").arg(mcp_config(port, token));
        c.args(["--allowedTools", "mcp__studio"]);
        c.args(["--append-system-prompt", INSTRUCTIONS]);
        // One flag per folder: an absolute Windows path never starts with a dash.
        for dir in others {
            c.arg("--add-dir").arg(dir);
        }
        if let Some(id) = o.resume.as_deref().filter(|id| valid_id(id)) {
            c.args(["--resume", id]);
            if let Some(at) = o.resume_session_at.as_deref().filter(|at| valid_id(at)) {
                c.args(["--resume-session-at", at]);
            }
            if o.fork_session == Some(true) {
                c.arg("--fork-session");
            }
        }
        if let Some(m) = model {
            c.arg(format!("--model={m}"));
        }
        if let Some(m) = mode.filter(|m| *m != "default" && *m != "manual") {
            c.arg(format!("--permission-mode={m}"));
        }
        if let Some(e) = effort {
            c.arg(format!("--effort={e}"));
        }
        c.current_dir(root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        clean_env(&mut c);
        // Keeps a copy of each file before Claude edits it, so “rewind” can restore the code.
        c.env("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "true");
        no_window(&mut c);
        let mut child = c.spawn().map_err(|e| format!("Could not start Claude Code: {e}"))?;
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let stdin = child.stdin.take().ok_or("Claude Code has no input")?;
        let stdout = child.stdout.take().ok_or("Claude Code has no output")?;
        let stderr = child.stderr.take().ok_or("Claude Code has no error output")?;
        let pid = child.id();

        let out = emit.clone();
        thread::spawn(move || {
            by_lines(stdout, |line| {
                let m = serde_json::from_str::<Value>(&line)
                    .unwrap_or_else(|_| json!({ "type": "raw", "text": line }));
                out("claude-event", json!({ "g": generation, "m": m }));
            })
        });
        let err = emit.clone();
        thread::spawn(move || {
            by_lines(stderr, |line| {
                err("claude-stderr", json!({ "g": generation, "line": line }));
            })
        });
        thread::spawn(move || {
            let code = child.wait().ok().and_then(|s| s.code());
            emit("claude-exit", json!({ "g": generation, "code": code }));
        });
        Ok(Session { stdin, pid, generation })
    }

    /// Writes one message (a user message or a control request or response) to Claude.
    pub fn send(&mut self, message: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(message).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("Claude is not running: {e}"))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        kill_tree(self.pid);
    }
}

fn given(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty() && *s != "default")
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Model names and aliases: “opus”, “claude-opus-5-5”, “sonnet[1m]”…
fn valid_model(m: &str) -> bool {
    m.len() <= 80
        && !m.starts_with('-')
        && m.chars().all(|c| c.is_ascii_alphanumeric() || "-_.[]:".contains(c))
}

/// The configuration Claude Code uses to connect to this app's MCP server, with its secret.
fn mcp_config(port: u16, token: &str) -> String {
    json!({
        "mcpServers": {
            "studio": {
                "type": "http",
                "url": format!("http://127.0.0.1:{port}/mcp"),
                "headers": { "Authorization": format!("Bearer {token}") }
            }
        }
    })
    .to_string()
}

/// Claude Code: the one on the PATH, the one from the official installer or, if not, the one of
/// the VS Code extension.
pub fn find_claude() -> Option<PathBuf> {
    if let Some(p) = on_path("claude") {
        return Some(p);
    }
    let home = home_dir()?;
    let official = home.join(".local").join("bin").join(exe("claude"));
    if official.is_file() {
        return Some(official);
    }
    let mut from_vscode: Vec<PathBuf> = std::fs::read_dir(home.join(".vscode").join("extensions"))
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with("anthropic.claude-code"))
        .map(|e| e.path().join("resources").join("native-binary").join(exe("claude")))
        .filter(|p| p.is_file())
        .collect();
    from_vscode.sort();
    from_vscode.pop()
}

// ───────────── past conversations ─────────────

/// Where Claude Code keeps the conversations of a folder: ~/.claude/projects/<folder with every
/// character that is not a letter or digit turned into a dash>.
fn project_dir(root: &Path) -> Option<PathBuf> {
    let config = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|h| h.join(".claude")))?;
    let name: String = root
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let dir = config.join("projects").join(name);
    dir.is_dir().then_some(dir)
}

/// The text the user typed in a transcript message, or None if it was something else (a tool
/// result, a command, a reminder).
fn typed_text(message: &Value) -> Option<String> {
    let text = match message.get("content")? {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .filter(|t| !t.trim_start().starts_with('<'))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let text = text.trim();
    (!text.is_empty() && !text.starts_with('<')).then(|| text.to_string())
}

pub fn sessions(root: &Path) -> Vec<Value> {
    let Some(dir) = project_dir(root) else { return Vec::new() };
    let mut files: Vec<(u128, PathBuf)> = std::fs::read_dir(&dir)
        .map(|it| {
            it.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
                .filter_map(|p| {
                    let t = p.metadata().ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
                    Some((t.as_millis(), p))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    // Conversations can weigh megabytes: each one is read again only when it changed.
    type Read = HashMap<PathBuf, (u128, Option<Summary>)>;
    static SEEN: OnceLock<Mutex<Read>> = OnceLock::new();
    let seen = SEEN.get_or_init(Mutex::default);
    let mut out = Vec::new();
    for (date, path) in files.into_iter().take(60) {
        let known = lock(seen).get(&path).filter(|(d, _)| *d == date).map(|(_, v)| v.clone());
        let read = match known {
            Some(v) => v,
            None => {
                let v = summarize(&path);
                lock(seen).insert(path.clone(), (date, v.clone()));
                v
            }
        };
        let Some((title, first)) = read else { continue };
        let id = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let title = title.unwrap_or_else(|| first.chars().take(80).collect());
        out.push(json!({ "id": id, "title": title, "date": date as u64 }));
        if out.len() >= 40 {
            break;
        }
    }
    out
}

/// The title of a conversation (if it has one) and the first thing the user typed in it.
type Summary = (Option<String>, String);

fn summarize(path: &Path) -> Option<Summary> {
    let f = std::fs::File::open(path).ok()?;
    let (mut title, mut first) = (None::<String>, None::<String>);
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        if line.contains("\"ai-title\"") || line.contains("\"custom-title\"") {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let t = v.get("customTitle").or_else(|| v.get("aiTitle")).and_then(Value::as_str);
                if let Some(t) = t {
                    title = Some(t.to_string());
                }
            }
        } else if first.is_none() && line.contains("\"type\":\"user\"") {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let meta = v.get("isMeta").and_then(Value::as_bool).unwrap_or(false)
                    || v.get("isSidechain").and_then(Value::as_bool).unwrap_or(false);
                if !meta {
                    first = v.get("message").and_then(typed_text);
                }
            }
        }
    }
    first.map(|f| (title, f))
}

/// The messages of a past conversation, to show them before resuming it.
pub fn transcript(root: &Path, id: &str) -> Result<Vec<Value>, String> {
    if !valid_id(id) {
        return Err("That conversation does not exist".into());
    }
    let path = project_dir(root).map(|d| d.join(format!("{id}.jsonl"))).filter(|p| p.is_file());
    let path = path.ok_or("That conversation does not exist")?;
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        if !(line.contains("\"type\":\"user\"") || line.contains("\"type\":\"assistant\"")) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        let side = v.get("isSidechain").and_then(Value::as_bool).unwrap_or(false);
        let meta = v.get("isMeta").and_then(Value::as_bool).unwrap_or(false);
        if !matches!(kind, "user" | "assistant") || side || meta {
            continue;
        }
        out.push(json!({
            "type": kind,
            "uuid": v.get("uuid").cloned().unwrap_or(Value::Null),
            "message": v.get("message").cloned().unwrap_or(Value::Null),
            "timestamp": v.get("timestamp").cloned().unwrap_or(Value::Null),
            "parent_tool_use_id": Value::Null,
            "from_transcript": true,
        }));
    }
    let extra = out.len().saturating_sub(600);
    out.drain(..extra);
    Ok(out)
}

// ───────────── @ mentions ─────────────

const SKIPPED: [&str; 14] = [
    ".venv", "venv", "node_modules", "target", ".git", "media", "diapos", "__pycache__",
    ".ruff_cache", ".complexipy_cache", "slides", "gen", ".uv", "dist",
];

/// Files of the talks folder whose path contains `query`, the best matches first. Those of
/// `outside` (the open talk, when it lives somewhere else) come with their whole path.
pub fn files(root: &Path, outside: Option<&Path>, query: &str) -> Vec<String> {
    let q = query.to_lowercase().replace('\\', "/");
    let mut all = all_files(root);
    if let Some(dir) = outside {
        let base = dir.to_string_lossy().replace('\\', "/");
        all.extend(all_files(dir).into_iter().map(|rel| format!("{base}/{rel}")));
    }
    let mut found: Vec<String> =
        all.into_iter().filter(|rel| q.is_empty() || rel.to_lowercase().contains(&q)).collect();
    let score = |p: &String| {
        let name = p.rsplit('/').next().unwrap_or(p).to_lowercase();
        (!name.starts_with(&q), !name.contains(&q), p.len())
    };
    found.sort_by_key(score);
    found.truncate(30);
    found
}

/// The files of a folder, walked again at most every few seconds: each letter typed after “@”
/// asks for them.
fn all_files(root: &Path) -> Vec<String> {
    type Walked = HashMap<PathBuf, (Instant, Vec<String>)>;
    static LIST: OnceLock<Mutex<Walked>> = OnceLock::new();
    let list = LIST.get_or_init(Mutex::default);
    if let Some((at, files)) = lock(list).get(root) {
        if at.elapsed() < Duration::from_secs(10) {
            return files.clone();
        }
    }
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    'walk: while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.filter_map(Result::ok) {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(kind) = e.file_type() else { continue };
            if kind.is_dir() {
                if !SKIPPED.contains(&name.as_str()) && !name.starts_with('.') {
                    pending.push(e.path());
                }
                continue;
            }
            if files.len() >= 30000 {
                break 'walk;
            }
            let p = e.path();
            files.push(p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/"));
        }
    }
    lock(list).insert(root.to_path_buf(), (Instant::now(), files.clone()));
    files
}
