use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::Manager;

const TOOL_RUNTIME_URL_ENV: &str = "RELAY_OPENCODE_TOOL_RUNTIME_URL";
const TOOL_RUNTIME_DIR_ENV: &str = "RELAY_OPENCODE_RUNTIME_DIR";
const READY_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug)]
pub struct OpencodeRuntime {
    child: Mutex<Option<Child>>,
    url: String,
}

impl OpencodeRuntime {
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }
}

impl Drop for OpencodeRuntime {
    fn drop(&mut self) {
        let Ok(mut guard) = self.child.lock() else {
            return;
        };
        let Some(mut child) = guard.take() else {
            return;
        };
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[derive(Debug, Deserialize)]
struct ReadyMessage {
    #[serde(rename = "type")]
    kind: String,
    url: String,
}

pub fn start(app: &tauri::App) -> Option<OpencodeRuntime> {
    if let Ok(url) = std::env::var(TOOL_RUNTIME_URL_ENV) {
        tracing::info!("using external opencode runtime at {url}");
        return None;
    }

    match start_inner(app) {
        Ok(runtime) => {
            tracing::info!("bundled opencode runtime ready at {}", runtime.url());
            std::env::set_var(TOOL_RUNTIME_URL_ENV, runtime.url());
            Some(runtime)
        }
        Err(error) => {
            tracing::warn!("bundled opencode runtime unavailable: {error}");
            None
        }
    }
}

fn start_inner(app: &tauri::App) -> Result<OpencodeRuntime, String> {
    let runtime_dir = runtime_dir(app)?;
    let bun = runtime_dir.join(bun_name());
    let server = runtime_dir.join("server.js");
    require_file(&bun)?;
    require_file(&server)?;

    #[cfg(unix)]
    ensure_executable(&bun)?;

    let mut child = Command::new(&bun)
        .arg(&server)
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("0")
        .current_dir(&runtime_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start {}: {error}", bun.display()))?;

    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                tracing::info!("[opencode-runtime] {line}");
            }
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "opencode runtime stdout was not captured".to_string())?;
    let ready = wait_ready(stdout, &mut child)?;
    Ok(OpencodeRuntime {
        child: Mutex::new(Some(child)),
        url: ready.url,
    })
}

fn runtime_dir(app: &tauri::App) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var(TOOL_RUNTIME_DIR_ENV) {
        return Ok(PathBuf::from(dir));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("opencode-runtime");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let dev_candidate =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/opencode-runtime");
    if dev_candidate.exists() {
        return Ok(dev_candidate);
    }

    Err("opencode-runtime resource directory was not found".to_string())
}

fn bun_name() -> &'static str {
    if cfg!(windows) {
        "bun.exe"
    } else {
        "bun"
    }
}

fn require_file(path: &Path) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err(format!(
            "required opencode runtime file missing: {}",
            path.display()
        ))
    }
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("failed to stat {}: {error}", path.display()))?;
    let mut permissions = metadata.permissions();
    if permissions.mode() & 0o111 != 0 {
        return Ok(());
    }
    permissions.set_mode(permissions.mode() | 0o755);
    std::fs::set_permissions(path, permissions)
        .map_err(|error| format!("failed to mark {} executable: {error}", path.display()))
}

fn wait_ready(
    stdout: impl std::io::Read + Send + 'static,
    child: &mut Child,
) -> Result<ReadyMessage, String> {
    let start = Instant::now();
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = tx.send(Err(
                        "opencode runtime stdout closed before ready".to_string()
                    ));
                    return;
                }
                Ok(_) => {
                    if tx.send(Ok(line.trim().to_string())).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = tx.send(Err(format!(
                        "failed reading opencode runtime stdout: {error}"
                    )));
                    return;
                }
            }
        }
    });

    while start.elapsed() < READY_TIMEOUT {
        if let Ok(Some(status)) = child.try_wait() {
            if !status.success() {
                return Err(format!("opencode runtime exited before ready: {status}"));
            }
        }
        let remaining = READY_TIMEOUT
            .checked_sub(start.elapsed())
            .unwrap_or_else(|| Duration::from_millis(1));
        let line = match rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("opencode runtime stdout reader stopped before ready".to_string())
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let ready: ReadyMessage = serde_json::from_str(trimmed).map_err(|error| {
            format!("invalid opencode runtime ready message `{trimmed}`: {error}")
        })?;
        if ready.kind == "relay-runtime-ready" {
            return Ok(ready);
        }
    }

    Err("timed out waiting for opencode runtime ready message".to_string())
}
