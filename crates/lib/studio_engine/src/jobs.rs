//! Queue of long jobs (renders and exports): one at a time, cancellable, with their progress sent
//! to the window. The panel asks for them, or Claude through MCP.

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;

use crate::{by_lines, kill_tree, lock, Emit, Engine};

/// Finished jobs kept for the log; older ones are forgotten.
const KEPT: usize = 40;
/// Lines kept per job: a long render keeps its last ones.
const LOG_LINES: usize = 1000;
/// Progress is sent to the window at most this often, however fast the lines come.
const PAINT_EVERY: Duration = Duration::from_millis(100);

#[derive(Clone, Serialize)]
pub struct Summary {
    pub id: u64,
    pub talk: String,
    pub title: String,
    pub status: String, // queued, running, ok, error, cancelled
    pub log: Vec<String>,
}

struct Job {
    s: Summary,
    args: Vec<String>,
    pid: Option<u32>,
    cancelled: bool,
    waiting: Vec<mpsc::Sender<Summary>>,
}

impl Job {
    fn finished(&self) -> bool {
        !matches!(self.s.status.as_str(), "queued" | "running")
    }
}

#[derive(Clone)]
pub struct Jobs {
    inner: Arc<(Mutex<Vec<Job>>, Condvar)>,
    next_id: Arc<AtomicU64>,
    paint: mpsc::Sender<()>,
    engine: Engine,
}

impl Jobs {
    pub fn new(engine: Engine, emit: Emit) -> Self {
        let (paint, wanted) = mpsc::channel();
        let j = Jobs {
            inner: Arc::new((Mutex::new(Vec::new()), Condvar::new())),
            next_id: Arc::new(AtomicU64::new(1)),
            paint,
            engine,
        };
        let worker = j.clone();
        thread::spawn(move || worker.run_loop());
        let painter = j.clone();
        thread::spawn(move || painter.paint_loop(&emit, &wanted));
        j
    }

    /// Queues a job; the receiver gets its summary when it ends.
    pub fn add(&self, talk: &str, title: &str, args: Vec<String>) -> mpsc::Receiver<Summary> {
        let (tx, rx) = mpsc::channel();
        {
            let (list, ready) = &*self.inner;
            let mut l = lock(list);
            l.push(Job {
                s: Summary {
                    id: self.next_id.fetch_add(1, Ordering::SeqCst),
                    talk: talk.into(),
                    title: title.into(),
                    status: "queued".into(),
                    log: Vec::new(),
                },
                args,
                pid: None,
                cancelled: false,
                waiting: vec![tx],
            });
            ready.notify_all();
        }
        self.notify();
        rx
    }

    pub fn cancel(&self, id: u64) {
        let pid = self.with(id, |j| {
            if j.finished() {
                return None;
            }
            j.cancelled = true;
            if j.s.status == "queued" {
                j.s.status = "cancelled".into();
                for tx in j.waiting.drain(..) {
                    tx.send(j.s.clone()).ok();
                }
                None
            } else {
                j.s.log.push("Cancelling…".into());
                j.pid
            }
        });
        if let Some(Some(pid)) = pid {
            kill_tree(pid);
        }
        self.notify();
    }

    /// Cancels whatever is running or queued (when the app closes).
    pub fn cancel_all(&self) {
        let ids: Vec<u64> = lock(&self.inner.0).iter().filter(|j| !j.finished()).map(|j| j.s.id).collect();
        for id in ids {
            self.cancel(id);
        }
    }

    pub fn summary(&self) -> Vec<Summary> {
        let l = lock(&self.inner.0);
        let from = l.len().saturating_sub(12);
        l[from..]
            .iter()
            .map(|j| {
                let mut s = j.s.clone();
                let extra = s.log.len().saturating_sub(200);
                s.log.drain(..extra);
                s
            })
            .collect()
    }

    /// Asks for the window to be updated; many requests in a row become a single update.
    fn notify(&self) {
        self.paint.send(()).ok();
    }

    fn paint_loop(&self, emit: &Emit, wanted: &mpsc::Receiver<()>) {
        while wanted.recv().is_ok() {
            thread::sleep(PAINT_EVERY);
            while wanted.try_recv().is_ok() {}
            if let Ok(jobs) = serde_json::to_value(self.summary()) {
                emit("jobs", jobs);
            }
        }
    }

    fn with<T>(&self, id: u64, f: impl FnOnce(&mut Job) -> T) -> Option<T> {
        lock(&self.inner.0).iter_mut().find(|j| j.s.id == id).map(f)
    }

    fn append(&self, id: u64, line: String) {
        self.with(id, |j| {
            j.s.log.push(line);
            if j.s.log.len() > LOG_LINES + 200 {
                j.s.log.drain(..200);
            }
        });
        self.notify();
    }

    fn run_loop(&self) {
        loop {
            let (id, args) = {
                let (list, ready) = &*self.inner;
                let mut l = lock(list);
                loop {
                    if let Some(j) = l.iter_mut().find(|j| j.s.status == "queued") {
                        j.s.status = "running".into();
                        break (j.s.id, j.args.clone());
                    }
                    l = ready.wait(l).unwrap_or_else(|p| p.into_inner());
                }
            };
            self.notify();
            let ok = self.run(id, &args);
            {
                let mut l = lock(&self.inner.0);
                if let Some(j) = l.iter_mut().find(|j| j.s.id == id) {
                    j.s.status = if ok && !j.cancelled { "ok" } else if j.cancelled { "cancelled" } else { "error" }.into();
                    j.pid = None;
                    for tx in j.waiting.drain(..) {
                        tx.send(j.s.clone()).ok();
                    }
                }
                // Forgets the oldest finished jobs.
                while l.len() > KEPT {
                    match l.iter().position(Job::finished) {
                        Some(i) => {
                            l.remove(i);
                        }
                        None => break,
                    }
                }
            }
            self.notify();
        }
    }

    fn run(&self, id: u64, args: &[String]) -> bool {
        let mut cmd = self.engine.command(args);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                self.append(id, format!("Could not start the job: {e}"));
                return false;
            }
        };
        let pid = child.id();
        // If it was cancelled while it was starting, there was no process to stop yet.
        let cancelled = self
            .with(id, |j| {
                j.pid = Some(pid);
                j.cancelled
            })
            .unwrap_or(true);
        if cancelled {
            kill_tree(pid);
        }
        let stderr = child.stderr.take();
        let me = self.clone();
        let err_reader = thread::spawn(move || {
            if let Some(err) = stderr {
                by_lines(err, |l| me.append(id, l));
            }
        });
        if let Some(out) = child.stdout.take() {
            by_lines(out, |l| self.append(id, l));
        }
        err_reader.join().ok();
        child.wait().map(|s| s.success()).unwrap_or(false)
    }
}
