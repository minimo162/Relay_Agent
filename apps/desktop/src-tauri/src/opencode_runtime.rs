use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;
use tauri::Manager;

const TOOL_RUNTIME_URL_ENV: &str = "RELAY_OPENCODE_TOOL_RUNTIME_URL";
const TOOL_RUNTIME_DIR_ENV: &str = "RELAY_OPENCODE_RUNTIME_DIR";
const TOOL_RUNTIME_BUN_ENV: &str = "RELAY_OPENCODE_BUN";
const WARMUP_DISABLE_ENV: &str = "RELAY_OPENCODE_RUNTIME_NO_WARMUP";
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
            spawn_warmup();
            Some(runtime)
        }
        Err(error) => {
            tracing::warn!("bundled opencode runtime unavailable: {error}");
            None
        }
    }
}

fn spawn_warmup() {
    if std::env::var_os(WARMUP_DISABLE_ENV).is_some() {
        tracing::info!("bundled opencode runtime warmup disabled by {WARMUP_DISABLE_ENV}");
        return;
    }

    thread::spawn(|| {
        if let Err(error) = warmup() {
            tracing::warn!("bundled opencode runtime warmup failed: {error}");
        }
    });
}

fn warmup() -> Result<(), String> {
    let root = std::env::temp_dir()
        .join("RelayAgent")
        .join("opencode-warmup");
    std::fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create warmup directory {}: {error}",
            root.display()
        )
    })?;
    let probe = root.join("probe.txt");
    if !probe.is_file() {
        std::fs::write(&probe, "relay opencode warmup\n").map_err(|error| {
            format!("failed to write warmup probe {}: {error}", probe.display())
        })?;
    }

    let started = Instant::now();
    let context = tools::ToolExecutionContext {
        cwd: Some(root.to_string_lossy().into_owned()),
        worktree: None,
        session_id: None,
        message_id: None,
        agent: None,
    };
    let input = json!({
        "pattern": "__relay_opencode_warmup_no_match__",
        "path": "."
    });
    let _ = tools::execute_tool_with_context("grep", &input, &context)?;
    tracing::info!(
        "bundled opencode runtime warmup completed in {} ms",
        started.elapsed().as_millis()
    );
    Ok(())
}

fn start_inner(app: &tauri::App) -> Result<OpencodeRuntime, String> {
    let runtime_dir = runtime_dir(app)?;
    let bun = resolve_bun(&runtime_dir)?;
    let server = runtime_dir.join("server.js");
    require_file(&server)?;

    #[cfg(unix)]
    if bun.is_path() {
        ensure_executable(bun.program_path())?;
    }

    tracing::info!("starting bundled opencode runtime with {}", bun.display());

    let mut child = Command::new(bun.program())
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

#[derive(Debug)]
enum BunProgram {
    Path(PathBuf),
    Command(String),
}

impl BunProgram {
    fn program(&self) -> &std::ffi::OsStr {
        match self {
            Self::Path(path) => path.as_os_str(),
            Self::Command(command) => std::ffi::OsStr::new(command),
        }
    }

    fn display(&self) -> String {
        match self {
            Self::Path(path) => path.display().to_string(),
            Self::Command(command) => format!("{command} from PATH"),
        }
    }

    fn is_path(&self) -> bool {
        matches!(self, Self::Path(_))
    }

    fn program_path(&self) -> &Path {
        match self {
            Self::Path(path) => path,
            Self::Command(_) => unreachable!("PATH commands do not have a local file path"),
        }
    }
}

fn resolve_bun(runtime_dir: &Path) -> Result<BunProgram, String> {
    if let Ok(raw) = std::env::var(TOOL_RUNTIME_BUN_ENV) {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(format!("{TOOL_RUNTIME_BUN_ENV} is set but empty"));
        }
        let path = PathBuf::from(trimmed);
        if path.is_file() {
            return Ok(BunProgram::Path(path));
        }
        if path.components().count() == 1 {
            return Ok(BunProgram::Command(trimmed.to_string()));
        }
        return Err(format!(
            "{TOOL_RUNTIME_BUN_ENV} points to a missing Bun executable: {}",
            path.display()
        ));
    }

    let bundled = runtime_dir.join(bun_name());
    if bundled.is_file() {
        return Ok(BunProgram::Path(bundled));
    }

    if cfg!(debug_assertions) {
        tracing::warn!(
            "bundled opencode runtime bun missing at {}; trying `bun` from PATH for dev",
            bundled.display()
        );
        return Ok(BunProgram::Command("bun".to_string()));
    }

    Err(format!(
        "required opencode runtime file missing: {}. Set {TOOL_RUNTIME_BUN_ENV} to a Bun executable or {TOOL_RUNTIME_URL_ENV} to an already running runtime URL",
        bundled.display()
    ))
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
