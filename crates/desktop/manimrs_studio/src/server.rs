//! Local server on 127.0.0.1: the MCP server Claude connects to (`/mcp`) and the videos and
//! thumbnails the panel shows (`/file/<talk>/<path inside diapos/>`).
//!
//! Only this computer can reach it, but a web page open in the browser could still try: requests
//! must name this server as their host (which stops DNS rebinding), and `/mcp` also needs the
//! secret this app gives to its own Claude session and refuses anything sent from a web page.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path as UrlPath, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::{mcp, Shared};

/// Where the window's page lives: Tauri serves it from here on Windows, and from its own scheme on
/// Linux.
#[cfg(windows)]
const APP_ORIGIN: &str = "http://tauri.localhost";
#[cfg(not(windows))]
const APP_ORIGIN: &str = "tauri://localhost";

/// A fresh random secret for this run of the app.
pub fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("No random numbers available: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn start(s: Arc<Shared>) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:8766")
        .or_else(|_| std::net::TcpListener::bind("127.0.0.1:0"))
        .map_err(|e| format!("Could not open the local server: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let hosts: Arc<[String]> = Arc::from([format!("127.0.0.1:{port}"), format!("localhost:{port}")]);
    let routes = Router::new()
        .route("/mcp", post(mcp::handle).get(not_allowed).delete(not_allowed))
        .route("/file/{talk}/{*path}", get(file))
        .layer(middleware::from_fn(move |req: Request, next: Next| {
            let hosts = hosts.clone();
            async move { only_this_host(&hosts, req, next).await }
        }))
        .with_state(s);
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => {
                let _ = axum::serve(l, routes).await;
            }
            Err(e) => eprintln!("Could not start the local server: {e}"),
        }
    });
    Ok(port)
}

async fn only_this_host(hosts: &[String], req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    if !hosts.iter().any(|h| h.eq_ignore_ascii_case(host)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut r = next.run(req).await;
    r.headers_mut().insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    r
}

async fn not_allowed() -> StatusCode {
    StatusCode::METHOD_NOT_ALLOWED
}

/// Serves a file from `presentacion/diapos/` (with ranges, so videos can be scrubbed).
async fn file(
    State(s): State<Arc<Shared>>,
    UrlPath((talk, path)): UrlPath<(String, String)>,
    req: Request,
) -> Response {
    let Some(pres) = s.engine.presentation(&talk) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let base = pres.join("diapos");
    let (Ok(base), Ok(p)) = (base.canonicalize(), base.join(&path).canonicalize()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !p.starts_with(&base) || !p.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match ServeFile::new(p).oneshot(req).await {
        Ok(r) => {
            let mut r = r.map(Body::new).into_response();
            // The app's own page may read the pixels of a video (to mark on a frame); no other may.
            r.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static(APP_ORIGIN));
            r.headers_mut().insert(header::VARY, HeaderValue::from_static("Origin"));
            r
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
