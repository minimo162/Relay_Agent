use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use serde_json::Value;
use tauri::Manager;

use crate::agent_projection::{MessageContent, RelayMessage};

const TOOL_RUNTIME_URL_ENV: &str = "RELAY_OPENCODE_TOOL_RUNTIME_URL";
const TOOL_RUNTIME_DIR_ENV: &str = "RELAY_OPENCODE_RUNTIME_DIR";
const TOOL_RUNTIME_BUN_ENV: &str = "RELAY_OPENCODE_BUN";
const WARMUP_DISABLE_ENV: &str = "RELAY_OPENCODE_RUNTIME_NO_WARMUP";
const TOOL_RUNTIME_TIMEOUT_MS_ENV: &str = "RELAY_OPENCODE_TOOL_RUNTIME_TIMEOUT_MS";
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

#[derive(Debug, Clone, Serialize)]
pub struct OpencodeRuntimeSnapshot {
    pub url: Option<String>,
    pub running: bool,
    pub message: String,
}

pub fn execution_backend_name() -> String {
    "opencode".to_string()
}

#[derive(Debug, Clone, Default)]
pub struct OpencodeToolExecutionContext {
    pub cwd: Option<String>,
    pub worktree: Option<String>,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
    pub agent: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExecuteToolRequest<'a> {
    tool: &'a str,
    input: &'a Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    directory: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree: Option<&'a str>,
    #[serde(rename = "sessionID", skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
    #[serde(rename = "messageID", skip_serializing_if = "Option::is_none")]
    message_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
struct ExecuteToolResponse {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    output: Option<Value>,
    #[serde(default)]
    error: Option<String>,
}

pub fn external_runtime_url() -> Option<String> {
    std::env::var(TOOL_RUNTIME_URL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn execute_tool_with_context(
    name: &str,
    input: &Value,
    context: &OpencodeToolExecutionContext,
) -> Result<String, String> {
    let base = external_runtime_url()
        .ok_or_else(|| format!("{TOOL_RUNTIME_URL_ENV} is required to execute OpenCode tools"))?;
    let url = format!("{}/experimental/tool/execute", base.trim_end_matches('/'));
    let timeout = std::env::var(TOOL_RUNTIME_TIMEOUT_MS_ENV)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(120_000);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(timeout))
        .build()
        .map_err(|error| format!("failed to create OpenCode tool client: {error}"))?;
    let normalized_cwd = normalize_runtime_path(context.cwd.as_deref());
    let normalized_worktree = context.worktree.as_deref().and_then(|worktree| {
        let normalized = normalize_runtime_path(Some(worktree));
        match (&normalized_cwd, &normalized) {
            (Some(cwd), Some(worktree)) if cwd == worktree => None,
            _ => normalized,
        }
    });
    let cwd = normalized_cwd.as_deref();
    let request = ExecuteToolRequest {
        tool: name,
        input,
        cwd,
        directory: cwd,
        worktree: normalized_worktree.as_deref(),
        session_id: context.session_id.as_deref(),
        message_id: context.message_id.as_deref(),
        agent: context.agent.as_deref(),
    };
    let mut builder = client.post(url).json(&request);
    if let Some(cwd) = cwd {
        builder = builder.header("x-opencode-directory", cwd);
    }
    let response = builder
        .send()
        .map_err(|error| format!("OpenCode tool request failed for `{name}`: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("failed to read OpenCode tool response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OpenCode tool `{name}` returned HTTP {status}: {body}"
        ));
    }
    let decoded: ExecuteToolResponse = serde_json::from_str(&body).map_err(|error| {
        format!("invalid OpenCode tool response for `{name}`: {error}; body={body}")
    })?;
    render_execute_tool_response(decoded)
}

fn render_execute_tool_response(response: ExecuteToolResponse) -> Result<String, String> {
    if let Some(error) = response.error {
        return Err(error);
    }
    let output = response.output.unwrap_or(Value::Null);
    let rendered = match output {
        Value::Null => String::new(),
        Value::String(value) => value,
        other => serde_json::to_string_pretty(&other)
            .map_err(|error| format!("failed to render OpenCode tool output: {error}"))?,
    };
    Ok(match response.title {
        Some(title) if !title.trim().is_empty() => format!("{title}\n\n{rendered}"),
        _ => rendered,
    })
}

fn normalize_runtime_path(path: Option<&str>) -> Option<String> {
    let raw = path?.trim();
    if raw.is_empty() {
        return None;
    }

    #[cfg(windows)]
    if let Some(unc) = windows_universal_name(raw) {
        return Some(unc);
    }

    let path = Path::new(raw);
    Some(
        path.canonicalize()
            .map_or_else(|_| raw.to_string(), |path| display_path_for_runtime(&path)),
    )
}

fn display_path_for_runtime(path: &Path) -> String {
    #[cfg(windows)]
    {
        strip_windows_extended_prefix(&path.to_string_lossy())
    }

    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

#[cfg(windows)]
fn strip_windows_extended_prefix(value: &str) -> String {
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    value.to_string()
}

#[cfg(windows)]
fn windows_universal_name(path: &str) -> Option<String> {
    let mut chars = path.chars();
    let drive = chars.next()?.to_ascii_uppercase();
    if !drive.is_ascii_alphabetic() || chars.next()? != ':' {
        return None;
    }

    let suffix = path
        .get(2..)
        .unwrap_or_default()
        .trim_start_matches(['\\', '/']);
    let query = format!(
        "(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='{}:'\").ProviderName",
        drive
    );
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &query])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let provider = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with(r"\\") && !line.ends_with(':'))?
        .trim_end_matches(['\\', '/'])
        .to_string();
    if provider.is_empty() {
        return None;
    }
    if suffix.is_empty() {
        Some(provider)
    } else {
        Some(format!(r"{provider}\{suffix}"))
    }
}

pub async fn snapshot() -> OpencodeRuntimeSnapshot {
    let Some(url) = external_runtime_url() else {
        return OpencodeRuntimeSnapshot {
            url: None,
            running: false,
            message: format!("{TOOL_RUNTIME_URL_ENV} is not set"),
        };
    };

    let client = reqwest::Client::new();
    let path_url = format!("{}/path", url.trim_end_matches('/'));
    let mut last_error = None;

    for attempt in 0..3 {
        let result = client
            .get(&path_url)
            .timeout(Duration::from_secs(3))
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => {
                return OpencodeRuntimeSnapshot {
                    url: Some(url),
                    running: true,
                    message: "OpenCode runtime responded to /path".to_string(),
                };
            }
            Ok(response) => {
                return OpencodeRuntimeSnapshot {
                    url: Some(url),
                    running: false,
                    message: format!("OpenCode runtime /path returned HTTP {}", response.status()),
                };
            }
            Err(error) => {
                last_error = Some(error);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(75)).await;
                }
            }
        }
    }

    match last_error {
        Some(error) => OpencodeRuntimeSnapshot {
            url: Some(url),
            running: false,
            message: format!("OpenCode runtime probe failed: {error}"),
        },
        None => OpencodeRuntimeSnapshot {
            url: Some(url),
            running: false,
            message: "OpenCode runtime probe failed before sending a request".to_string(),
        },
    }
}

#[derive(Debug, Deserialize)]
struct SessionInfo {
    id: String,
}

#[derive(Debug, Deserialize)]
struct AppendTranscriptInfo {
    #[serde(rename = "messageID")]
    message_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpencodeSessionMessage {
    pub info: OpencodeMessageInfo,
    #[serde(default)]
    pub parts: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpencodeMessageInfo {
    pub role: String,
}

pub async fn create_session(
    directory: Option<&str>,
    title: Option<&str>,
) -> Result<String, String> {
    let base = external_runtime_url()
        .ok_or_else(|| format!("{TOOL_RUNTIME_URL_ENV} is required to create OpenCode sessions"))?;
    let url = format!("{}/session", base.trim_end_matches('/'));
    let mut body = serde_json::Map::new();
    if let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) {
        body.insert(
            "title".to_string(),
            serde_json::Value::String(title.to_string()),
        );
    }
    let client = reqwest::Client::new();
    let mut request = client
        .post(url)
        .timeout(Duration::from_secs(10))
        .json(&serde_json::Value::Object(body));
    if let Some(directory) = directory.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header("x-opencode-directory", directory);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("OpenCode session create failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("failed to read OpenCode session create response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OpenCode session create returned HTTP {status}: {body}"
        ));
    }
    let session: SessionInfo = serde_json::from_str(&body).map_err(|error| {
        format!("invalid OpenCode session create response: {error}; body={body}")
    })?;
    Ok(session.id)
}

pub async fn session_messages(session_id: &str) -> Result<Vec<OpencodeSessionMessage>, String> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("OpenCode session id must not be empty".to_string());
    }
    let base = external_runtime_url()
        .ok_or_else(|| format!("{TOOL_RUNTIME_URL_ENV} is required to read OpenCode sessions"))?;
    let url = format!(
        "{}/session/{session_id}/message",
        base.trim_end_matches('/')
    );
    let response = reqwest::Client::new()
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| format!("OpenCode session messages request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("failed to read OpenCode session messages response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OpenCode session messages returned HTTP {status}: {body}"
        ));
    }
    serde_json::from_str(&body).map_err(|error| {
        format!("invalid OpenCode session messages response: {error}; body={body}")
    })
}

pub async fn append_text_message(
    session_id: &str,
    role: &str,
    text: &str,
    finish: Option<&str>,
) -> Result<String, String> {
    let role = match role {
        "user" | "assistant" => role,
        other => return Err(format!("unsupported OpenCode transcript role `{other}`")),
    };
    let mut body = json!({
        "role": role,
        "parts": [{ "type": "text", "text": text }]
    });
    if let Some(finish) = finish.map(str::trim).filter(|value| !value.is_empty()) {
        body["finish"] = Value::String(finish.to_string());
    }
    append_transcript_message(session_id, body).await
}

pub async fn append_tool_result_message(
    session_id: &str,
    tool_use_id: &str,
    tool_name: &str,
    input: Value,
    output: &str,
    is_error: bool,
) -> Result<String, String> {
    let mut tool_part = json!({
        "type": "tool",
        "callID": tool_use_id,
        "tool": tool_name,
        "input": input,
    });
    if is_error {
        tool_part["status"] = Value::String("error".to_string());
        tool_part["error"] = Value::String(output.to_string());
    } else {
        tool_part["status"] = Value::String("completed".to_string());
        tool_part["output"] = Value::String(output.to_string());
    }
    append_transcript_message(
        session_id,
        json!({
            "role": "assistant",
            "parts": [tool_part],
            "finish": "tool-calls"
        }),
    )
    .await
}

async fn append_transcript_message(session_id: &str, body: Value) -> Result<String, String> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("OpenCode session id must not be empty".to_string());
    }
    let base = external_runtime_url().ok_or_else(|| {
        format!("{TOOL_RUNTIME_URL_ENV} is required to append OpenCode transcript")
    })?;
    let url = format!(
        "{}/experimental/relay/session/{session_id}/transcript",
        base.trim_end_matches('/')
    );
    let response = reqwest::Client::new()
        .post(url)
        .timeout(Duration::from_secs(10))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("OpenCode transcript append request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("failed to read OpenCode transcript append response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OpenCode transcript append returned HTTP {status}: {body}"
        ));
    }
    let info: AppendTranscriptInfo = serde_json::from_str(&body).map_err(|error| {
        format!("invalid OpenCode transcript append response: {error}; body={body}")
    })?;
    Ok(info.message_id)
}

pub fn messages_to_relay(messages: &[OpencodeSessionMessage]) -> Vec<RelayMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let content = opencode_parts_to_relay_content(&message.parts);
            if content.is_empty() {
                return None;
            }
            Some(RelayMessage {
                role: opencode_role_to_relay(&message.info.role).to_string(),
                content,
            })
        })
        .collect()
}

fn opencode_role_to_relay(role: &str) -> &str {
    match role {
        "user" => "user",
        "system" => "system",
        _ => "assistant",
    }
}

fn opencode_parts_to_relay_content(parts: &[Value]) -> Vec<MessageContent> {
    let mut content = Vec::new();
    for part in parts {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        content.push(MessageContent::Text {
                            text: text.to_string(),
                        });
                    }
                }
            }
            Some("tool") => push_tool_part(&mut content, part),
            _ => {}
        }
    }
    content
}

fn push_tool_part(content: &mut Vec<MessageContent>, part: &Value) {
    let tool_use_id = part
        .get("callID")
        .and_then(Value::as_str)
        .or_else(|| part.get("id").and_then(Value::as_str))
        .unwrap_or("opencode-tool");
    let name = part
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let state = part.get("state").unwrap_or(&Value::Null);
    let input = state.get("input").cloned().unwrap_or_else(|| json!({}));
    content.push(MessageContent::ToolUse {
        id: tool_use_id.to_string(),
        name,
        input,
    });

    match state.get("status").and_then(Value::as_str) {
        Some("completed") => {
            let output = state
                .get("output")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            content.push(MessageContent::ToolResult {
                tool_use_id: tool_use_id.to_string(),
                content: output,
                is_error: false,
            });
        }
        Some("error") => {
            let output = state
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("OpenCode tool failed")
                .to_string();
            content.push(MessageContent::ToolResult {
                tool_use_id: tool_use_id.to_string(),
                content: output,
                is_error: true,
            });
        }
        _ => {}
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
    let context = OpencodeToolExecutionContext {
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
    let _ = execute_tool_with_context("grep", &input, &context)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_opencode_text_and_tool_parts_to_relay_messages() {
        let messages: Vec<OpencodeSessionMessage> = serde_json::from_value(json!([
            {
                "info": { "role": "assistant" },
                "parts": [
                    { "type": "text", "text": "Reading files" },
                    {
                        "type": "tool",
                        "id": "part_1",
                        "callID": "call_1",
                        "tool": "read",
                        "state": {
                            "status": "completed",
                            "input": { "path": "README.md" },
                            "output": "Hello"
                        }
                    }
                ]
            }
        ]))
        .expect("valid opencode message fixture");

        let relay = messages_to_relay(&messages);
        assert_eq!(relay.len(), 1);
        assert_eq!(relay[0].role, "assistant");
        assert_eq!(relay[0].content.len(), 3);
        assert!(matches!(
            &relay[0].content[1],
            MessageContent::ToolUse { id, name, .. } if id == "call_1" && name == "read"
        ));
        assert!(matches!(
            &relay[0].content[2],
            MessageContent::ToolResult { tool_use_id, content, is_error }
                if tool_use_id == "call_1" && content == "Hello" && !is_error
        ));
    }

    #[test]
    fn render_execute_tool_response_includes_title_and_json_output() {
        let rendered = render_execute_tool_response(ExecuteToolResponse {
            title: Some("Read".to_string()),
            output: Some(json!({ "path": "README.md", "lines": 3 })),
            error: None,
        })
        .expect("render tool response");

        assert!(rendered.starts_with("Read\n\n"));
        assert!(rendered.contains("\"path\": \"README.md\""));
    }

    #[test]
    fn render_execute_tool_response_propagates_tool_error() {
        let error = render_execute_tool_response(ExecuteToolResponse {
            title: None,
            output: None,
            error: Some("denied".to_string()),
        })
        .expect_err("tool error");

        assert_eq!(error, "denied");
    }
}
