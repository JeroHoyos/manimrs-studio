//! MCP server (HTTP transport, JSON-RPC) that Claude Code connects to from the app's Claude panel.
//! It gives Claude tools to see the status, render, look at, show and place slides; everything
//! it does is visible in the window while it happens.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};
use tauri::Emitter;

use studio_engine::{check_talk, QUALITIES};
use crate::Shared;

const INSTRUCTIONS: &str = "Tools of the “ManimRS Studio” app. Each slide of a manim talk is \
rendered on its own: rendering one never touches the others. Flow to create or change one: edit \
its .py with your own tools, register it in diapositivas/__init__.py if it is new, place it in \
main.py with “place”, render it with “render”, check it with “view” and finish with “show” so the \
user sees it. A talk can live in any folder: “talks” gives the folder of each one. Before editing, \
read its talk.manimrs (what the talk is: title, what it is about, language, resolution) and its \
AGENTS.md or README.";

/// Only the Claude session this app started knows the secret. Browsers always say where a request
/// comes from (`Origin`); Claude Code does not, so a request that says it is refused.
fn allowed(s: &Shared, headers: &HeaderMap) -> bool {
    if headers.contains_key(header::ORIGIN) {
        return false;
    }
    let want = format!("Bearer {}", s.token);
    headers
        .get(header::AUTHORIZATION)
        .is_some_and(|got| same(got.as_bytes(), want.as_bytes()))
}

/// Compares without stopping at the first difference, so timing says nothing about the secret.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub async fn handle(State(s): State<Arc<Shared>>, headers: HeaderMap, Json(msg): Json<Value>) -> Response {
    if !allowed(&s, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match msg {
        Value::Array(batch) => {
            let mut answers = Vec::new();
            for m in batch {
                if let Some(r) = answer(&s, m).await {
                    answers.push(r);
                }
            }
            if answers.is_empty() {
                StatusCode::ACCEPTED.into_response()
            } else {
                Json(Value::Array(answers)).into_response()
            }
        }
        m => match answer(&s, m).await {
            Some(r) => Json(r).into_response(),
            None => StatusCode::ACCEPTED.into_response(),
        },
    }
}

/// Notifications (no `id`) get no answer.
async fn answer(s: &Arc<Shared>, msg: Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
    let result: Result<Value, (i64, String)> = match method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "studio", "title": "ManimRS Studio", "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let s = s.clone();
            let name = params.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let r = tauri::async_runtime::spawn_blocking(move || call(&s, &name, &args)).await;
            Ok(r.unwrap_or_else(|e| failure(e.to_string())))
        }
        other => Err((-32601, format!("Method not supported: {other}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    })
}

fn tools() -> Value {
    let talk = json!({ "type": "string", "description": "The talk, as “talks” lists it: charla-git, charla-claude… (works without “charla-”). The user can create new talks from the app, or add them from any folder." });
    let slide = json!({ "type": "string", "description": "Name of the slide as “slides” lists it (sobre_mi, practica-2…) or its number." });
    let read_only = json!({ "readOnlyHint": true });
    json!([
        { "name": "talks", "description": "Lists the talks: name, title and folder of each one. The folder has the talk's main.py and its talk.manimrs, with what the talk is (title, what it is about, language, resolution).",
          "inputSchema": { "type": "object", "properties": {} }, "annotations": read_only },
        { "name": "slides", "description": "The slides of a talk in the order of main.py: number, name, render status, the user's review and its .py file.",
          "inputSchema": { "type": "object", "properties": { "talk": talk }, "required": ["talk"] }, "annotations": read_only },
        { "name": "notes", "description": "The changes the user requested from the review panel, with the slide and its file.",
          "inputSchema": { "type": "object", "properties": { "talk": talk }, "required": ["talk"] }, "annotations": read_only },
        { "name": "render", "description": "Renders only those slides, without touching the others, and waits for them to finish. The user sees the progress and the video in the app. Takes about 10 s per slide at 480p and 30 s at 1080p.",
          "inputSchema": { "type": "object", "properties": {
              "talk": talk,
              "slides": { "type": "array", "items": { "type": "string" }, "description": "Names or numbers of the slides." },
              "quality": { "type": "string", "enum": ["480p", "720p", "1080p"], "description": "The talk's resolution by default (its talk.manimrs); 480p to test quickly." }
          }, "required": ["talk", "slides"] } },
        { "name": "view", "description": "Images of the end of each pause of an already rendered slide, to check how it came out.",
          "inputSchema": { "type": "object", "properties": { "talk": talk, "slide": slide }, "required": ["talk", "slide"] }, "annotations": read_only },
        { "name": "show", "description": "Opens that slide in the app's panel so the user sees it.",
          "inputSchema": { "type": "object", "properties": { "talk": talk, "slide": slide }, "required": ["talk", "slide"] } },
        { "name": "place", "description": "Adds self.<method>() to construct() in main.py, after the given slide (or at the end). The method must already be registered in diapositivas/__init__.py.",
          "inputSchema": { "type": "object", "properties": {
              "talk": talk,
              "method": { "type": "string", "description": "The slide's method, like slide_git_stash." },
              "after": slide
          }, "required": ["talk", "method"] } },
        { "name": "export", "description": "Builds the package for another device with what is already rendered: HTML folder in a .zip, or a PDF with the last frame of each pause. Only if the user asks.",
          "inputSchema": { "type": "object", "properties": {
              "talk": talk,
              "format": { "type": "string", "enum": ["html", "pdf"] }
          }, "required": ["talk"] } },
        { "name": "present", "description": "Opens the full-screen presenter. Only if the user asks.",
          "inputSchema": { "type": "object", "properties": { "talk": talk, "start": slide }, "required": ["talk"] } }
    ])
}

fn text(t: impl Into<String>) -> Value {
    json!({ "type": "text", "text": t.into() })
}

fn failure(e: String) -> Value {
    json!({ "content": [text(e)], "isError": true })
}

fn call(s: &Shared, name: &str, a: &Value) -> Value {
    let field = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let talk = field("talk");
    if name != "talks" {
        if let Err(e) = check_talk(&talk) {
            return failure(format!("{e}: use one of the talks the “talks” tool lists."));
        }
    }
    let r = match name {
        "talks" => s.engine.text(["talks"]).map(|t| vec![text(t)]),
        "slides" => s.engine.text([talk.as_str(), "list"]).map(|t| vec![text(t)]),
        "notes" => s.engine.text([talk.as_str(), "notes"]).map(|t| vec![text(t)]),
        "render" => render(s, &talk, a),
        "view" => view(s, &talk, &field("slide")),
        "show" => {
            show(s, &talk, &field("slide"));
            Ok(vec![text("Done: the app shows that slide.")])
        }
        "place" => {
            let mut args = vec![talk.clone(), "place".into()];
            let after = field("after");
            if !after.is_empty() {
                args.push(format!("--after={after}"));
            }
            args.extend(["--".into(), field("method")]);
            s.engine.text(&args).map(|t| vec![text(t)])
        }
        "export" => export(s, &talk, &field("format")),
        "present" => {
            let start = field("start");
            let start = (!start.is_empty()).then_some(start.as_str());
            s.engine.present(&talk, start).map(|_| vec![text("Opening the presenter.")])
        }
        other => Err(format!("Unknown tool “{other}”.")),
    };
    match r {
        Ok(content) => json!({ "content": content, "isError": false }),
        Err(e) => failure(e),
    }
}

fn show(s: &Shared, talk: &str, slide: &str) {
    let _ = s.app.emit("show", json!({ "talk": talk, "slide": slide }));
}

fn render(s: &Shared, talk: &str, a: &Value) -> Result<Vec<Value>, String> {
    let slides: Vec<String> = match a.get("slides") {
        Some(Value::Array(v)) => v
            .iter()
            .filter_map(|x| x.as_str().map(String::from).or_else(|| x.as_i64().map(|n| n.to_string())))
            .collect(),
        Some(Value::String(t)) => vec![t.clone()],
        _ => Vec::new(),
    };
    let Some(first) = slides.first().cloned() else {
        return Err("Tell me which slides to render.".into());
    };
    let quality = match a.get("quality").and_then(Value::as_str).filter(|q| !q.is_empty()) {
        Some(q) => q.to_string(),
        None => s.engine.resolution(talk),
    };
    if !QUALITIES.contains(&quality.as_str()) {
        return Err("The quality is 480p, 720p or 1080p.".into());
    }
    // After “--” a slide is always a slide, even if its name starts with a dash.
    let mut args = vec![talk.to_string(), "render".into(), format!("--quality={quality}"), "--".into()];
    args.extend(slides.iter().cloned());
    let what = if slides.len() == 1 { first.clone() } else { format!("{} slides", slides.len()) };
    show(s, talk, &first);
    let end = s
        .jobs
        .add(talk, &format!("Claude: render of {what} ({quality})"), args)
        .recv()
        .map_err(|_| "The job was lost.".to_string())?;
    show(s, talk, &first);
    let log = end.log.join("\n");
    if end.status == "ok" {
        Ok(vec![text(log)])
    } else {
        Err(format!("The render ended as “{}”:\n{log}", end.status))
    }
}

fn view(s: &Shared, talk: &str, slide: &str) -> Result<Vec<Value>, String> {
    let out = s.engine.text([talk, "stills", "--width=1280", "--", slide])?;
    let paths: Vec<&str> =
        out.lines().map(str::trim).filter(|l| l.to_lowercase().ends_with(".png")).collect();
    if paths.is_empty() {
        return Err(format!("No frames came out.\n{out}"));
    }
    // Only images the studio just left in this talk's stills folder are read.
    let stills = s
        .engine
        .presentation(talk)
        .and_then(|p| p.join("diapos").join("_stills").canonicalize().ok())
        .ok_or("This talk has no stills folder.")?;
    let n = paths.len();
    let mut content = vec![text(format!("{slide}: {n} pause(s); each image is the end of a pause."))];
    for (i, path) in paths.iter().enumerate() {
        let inside = std::path::Path::new(path).canonicalize().is_ok_and(|p| p.starts_with(&stills));
        if !inside {
            return Err(format!("Unexpected image path from the studio: {path}"));
        }
        let bytes = std::fs::read(path).map_err(|e| format!("Could not read {path}: {e}"))?;
        content.push(text(format!("Pause {} of {n}", i + 1)));
        content.push(json!({ "type": "image", "data": B64.encode(bytes), "mimeType": "image/png" }));
    }
    Ok(content)
}

fn export(s: &Shared, talk: &str, format: &str) -> Result<Vec<Value>, String> {
    let mut args = vec![talk.to_string(), "export".into()];
    if format == "pdf" {
        args.push("--pdf".into());
    }
    let end = s
        .jobs
        .add(talk, &format!("Claude: export {talk}"), args)
        .recv()
        .map_err(|_| "The job was lost.".to_string())?;
    let log = end.log.join("\n");
    if end.status == "ok" { Ok(vec![text(log)]) } else { Err(log) }
}
