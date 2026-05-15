use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Manager};

use crate::models::{
    RelayDocumentSearchEvidence, RelayDocumentSearchIntent, RelayDocumentSearchRequest,
    RelayDocumentSearchResponse, RelayDocumentSearchThoroughness, RelayOfficeCommandResponse,
    RelayOfficeExecuteRequest, RelayOfficeInspectRequest, RelaySearchResultCard,
    RelayWorkspaceState,
};

const DOCUMENT_SEARCH_DEFAULT_TIMEOUT_MS: u64 = 300_000;
const DOCUMENT_SEARCH_MIN_TIMEOUT_MS: u64 = 10_000;
const DOCUMENT_SEARCH_MAX_TIMEOUT_MS: u64 = 900_000;
const DOCUMENT_SEARCH_TEMP_MAX_AGE_SECS: u64 = 24 * 60 * 60;
const OFFICECLI_SMOKE_TIMEOUT_MS: u64 = 20_000;
static OFFICECLI_CAPABILITY_CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

#[tauri::command]
pub fn get_relay_workspace_state(
    app: AppHandle,
    workspace_path: Option<String>,
) -> Result<RelayWorkspaceState, String> {
    let app_local = app_local_data_dir(&app)?;
    let search_cache = app_local.join("document-search");
    let office_backups = app_local.join("office-backups");
    fs::create_dir_all(&search_cache)
        .map_err(|error| format!("create document-search cache dir: {error}"))?;
    fs::create_dir_all(&office_backups)
        .map_err(|error| format!("create office backup dir: {error}"))?;

    let document_search_script = resolve_document_search_cli(&app);
    let officecli = resolve_officecli_path(&app);
    let ripgrep = resolve_ripgrep_path(&app);

    Ok(RelayWorkspaceState {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        workspace_path: workspace_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        app_local_data_dir: app_local.display().to_string(),
        document_search_cache_dir: search_cache.display().to_string(),
        office_backup_dir: office_backups.display().to_string(),
        document_search_available: document_search_script.is_some()
            && crate::copilot_server::find_node().is_some()
            && ripgrep.is_some(),
        document_search_message: match (
            document_search_script,
            crate::copilot_server::find_node(),
            ripgrep.as_ref(),
        ) {
            (Some(_), Some(_), Some(_)) => "Document search is ready.".to_string(),
            (None, _, _) => "Document search runner was not found.".to_string(),
            (_, None, _) => {
                "Node.js runtime was not found for the document-search runner.".to_string()
            }
            (_, _, None) => "ripgrep was not found for local document search.".to_string(),
        },
        officecli_available: officecli.is_some(),
        officecli_path: officecli.as_ref().map(|path| path.display().to_string()),
        officecli_message: officecli
            .as_ref()
            .map(|path| format!("OfficeCLI is ready at {}.", path.display()))
            .unwrap_or_else(|| "OfficeCLI was not found in bundled resources or PATH.".to_string()),
        ripgrep_available: ripgrep.is_some(),
        ripgrep_path: ripgrep.map(|path| path.display().to_string()),
    })
}

#[tauri::command]
pub async fn run_relay_document_search(
    app: AppHandle,
    request: RelayDocumentSearchRequest,
) -> Result<RelayDocumentSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run_relay_document_search_blocking(app, request))
        .await
        .map_err(|error| format!("document-search task join failed: {error}"))?
}

fn run_relay_document_search_blocking(
    app: AppHandle,
    request: RelayDocumentSearchRequest,
) -> Result<RelayDocumentSearchResponse, String> {
    let started = Instant::now();
    let workspace = normalize_existing_dir(&request.workspace_path, "workspace")?;
    let node = crate::copilot_server::find_node()
        .ok_or_else(|| "Node.js runtime was not found for document search.".to_string())?;
    let script = resolve_document_search_cli(&app)
        .ok_or_else(|| "Relay document-search runner was not found.".to_string())?;
    let ripgrep = resolve_ripgrep_path(&app).ok_or_else(|| {
        "ripgrep was not found in bundled resources or PATH; document search requires ripgrep."
            .to_string()
    })?;
    let cache_root = app_local_data_dir(&app)?.join("document-search");
    prune_document_search_runtime(&cache_root);
    fs::create_dir_all(&cache_root).map_err(|error| {
        format!(
            "create document-search cache at {}: {error}",
            cache_root.display()
        )
    })?;
    let temp_dir = cache_root.join("tmp");
    fs::create_dir_all(&temp_dir).map_err(|error| {
        format!(
            "create document-search temp dir at {}: {error}",
            temp_dir.display()
        )
    })?;

    let mut request_payload = json!({
        "query": request.query.trim(),
        "roots": [workspace.display().to_string()],
        "intent": intent_as_str(&request.intent),
        "thoroughness": thoroughness_as_str(&request.thoroughness),
        "evidence": evidence_as_str(&request.evidence),
        "maxResults": request.max_results.clamp(1, 300),
        "fileTypes": if request.file_types.is_empty() { vec!["any".to_string()] } else { request.file_types.clone() },
    });
    if let Some(query_plan_hints) = request.query_plan_hints.as_ref() {
        request_payload["queryPlanHints"] =
            serde_json::to_value(query_plan_hints).map_err(|error| error.to_string())?;
    }

    let input = json!({
        "request": request_payload,
        "options": {
            "useMetadataCache": false,
            "useFilenameIndex": false,
            "useIndexDb": false,
            "indexDbPrimaryMode": "disabled",
            "useParsedDocumentCache": false,
            "useDerivedContentIndexCache": false,
            "useIndexCoordinator": false,
            "useFailureRegistry": false,
            "useJobStore": false,
            "useUserMemory": false,
            "useSyncJournal": false,
            "ripgrepPath": ripgrep.display().to_string(),
            "timeoutMs": 60_000,
            "maxContentInspectFiles": 120,
            "source": "relay-desktop",
            "appVersion": env!("CARGO_PKG_VERSION"),
        }
    });

    let input_file = tempfile::Builder::new()
        .prefix("relay-search-input-")
        .suffix(".json")
        .tempfile_in(&temp_dir)
        .map_err(|error| format!("create document-search input file: {error}"))?;
    fs::write(
        input_file.path(),
        serde_json::to_vec(&input).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("write document-search input file: {error}"))?;

    let mut command = Command::new(node);
    command.arg(script).arg(input_file.path());
    let output = run_command_with_timeout(command, document_search_timeout(), &temp_dir)?;
    let stdout = output.stdout;
    let stderr = output.stderr;

    if output.timed_out {
        let timeout_ms = document_search_timeout().as_millis() as u64;
        let message = format!(
            "Document search timed out after {} seconds. Try narrowing the workspace or query.",
            timeout_ms / 1000
        );
        return Ok(RelayDocumentSearchResponse {
            ok: false,
            status: "timeout".to_string(),
            summary: message.clone(),
            coverage_label: "検索を完了できませんでした。".to_string(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            cards: Vec::new(),
            raw: json!({
                "ok": false,
                "error": message,
                "stderr": trim_for_error(&stderr),
            }),
            error: Some(message),
        });
    }

    let envelope: JsonValue = serde_json::from_str(&stdout).map_err(|error| {
        format!(
            "document-search runner returned invalid JSON: {error}; stderr={}",
            trim_for_error(&stderr)
        )
    })?;
    if !output.success || envelope.get("ok").and_then(JsonValue::as_bool) == Some(false) {
        let message = envelope
            .get("error")
            .and_then(JsonValue::as_str)
            .unwrap_or("document-search runner failed")
            .to_string();
        return Ok(RelayDocumentSearchResponse {
            ok: false,
            status: "failed".to_string(),
            summary: message.clone(),
            coverage_label: "検索を完了できませんでした。".to_string(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            cards: Vec::new(),
            raw: envelope,
            error: Some(format!("{message}; stderr={}", trim_for_error(&stderr))),
        });
    }

    let result = envelope.get("result").cloned().unwrap_or(JsonValue::Null);
    Ok(response_from_document_search_result(
        result,
        started.elapsed().as_millis() as u64,
    ))
}

struct RelayProcessOutput {
    success: bool,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
    temp_dir: &Path,
) -> Result<RelayProcessOutput, String> {
    let stdout_file = tempfile::Builder::new()
        .prefix("relay-search-stdout-")
        .suffix(".log")
        .tempfile_in(temp_dir)
        .map_err(|error| format!("create document-search stdout file: {error}"))?;
    let stderr_file = tempfile::Builder::new()
        .prefix("relay-search-stderr-")
        .suffix(".log")
        .tempfile_in(temp_dir)
        .map_err(|error| format!("create document-search stderr file: {error}"))?;
    let stdout_path = stdout_file.path().to_path_buf();
    let stderr_path = stderr_file.path().to_path_buf();
    let stdout_handle = stdout_file
        .reopen()
        .map_err(|error| format!("open document-search stdout file: {error}"))?;
    let stderr_handle = stderr_file
        .reopen()
        .map_err(|error| format!("open document-search stderr file: {error}"))?;

    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_handle))
        .stderr(Stdio::from(stderr_handle));
    crate::windows_command::no_console_window(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("start document-search runner: {error}"))?;
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("wait for document-search runner: {error}"))?
        {
            return Ok(RelayProcessOutput {
                success: status.success(),
                stdout: read_lossy(&stdout_path),
                stderr: read_lossy(&stderr_path),
                timed_out: false,
            });
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(RelayProcessOutput {
                success: false,
                stdout: read_lossy(&stdout_path),
                stderr: read_lossy(&stderr_path),
                timed_out: true,
            });
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn read_lossy(path: &Path) -> String {
    fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

fn document_search_timeout() -> Duration {
    let millis = std::env::var("RELAY_DOCUMENT_SEARCH_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DOCUMENT_SEARCH_DEFAULT_TIMEOUT_MS)
        .clamp(
            DOCUMENT_SEARCH_MIN_TIMEOUT_MS,
            DOCUMENT_SEARCH_MAX_TIMEOUT_MS,
        );
    Duration::from_millis(millis)
}

fn prune_document_search_runtime(cache_root: &Path) {
    let max_age = Duration::from_secs(DOCUMENT_SEARCH_TEMP_MAX_AGE_SECS);
    prune_old_files(&cache_root.join("tmp"), max_age, true);
    prune_old_files(&cache_root.join("jobs"), max_age, false);
}

fn prune_old_files(dir: &Path, max_age: Duration, remove_any_file: bool) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        if !remove_any_file
            && !path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.ends_with(".tmp"))
        {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if modified.elapsed().is_ok_and(|age| age > max_age) {
            let _ = fs::remove_file(path);
        }
    }
}

#[tauri::command]
pub fn inspect_office_file(
    app: AppHandle,
    request: RelayOfficeInspectRequest,
) -> Result<RelayOfficeCommandResponse, String> {
    let file_path = normalize_existing_file(&request.file_path, "Office file")?;
    run_officecli(
        &app,
        vec![
            "view".to_string(),
            file_path.display().to_string(),
            "outline".to_string(),
            "--json".to_string(),
        ],
        None,
    )
}

#[tauri::command]
pub fn execute_officecli_command(
    app: AppHandle,
    request: RelayOfficeExecuteRequest,
) -> Result<RelayOfficeCommandResponse, String> {
    let file_path = normalize_existing_file(&request.file_path, "Office file")?;
    let args = parse_officecli_args(&request.officecli_args)?;
    if args.is_empty() {
        return Err("OfficeCLI arguments are required.".to_string());
    }
    let selected_file = file_path.display().to_string();
    if !args.iter().any(|arg| arg == &selected_file) {
        return Err(
            "OfficeCLI arguments must include the selected file path exactly; Relay will not run an Office edit against a different file.".to_string(),
        );
    }
    let backup = if request.create_backup {
        Some(create_office_backup(&app, &file_path)?)
    } else {
        None
    };
    run_officecli(&app, args, backup)
}

fn app_local_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve Relay Agent local data dir: {error}"))
}

fn normalize_existing_dir(path: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_dir() {
        return Err(format!("{label} folder does not exist: {}", path.display()));
    }
    Ok(path)
}

fn normalize_existing_file(path: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_file() {
        return Err(format!("{label} does not exist: {}", path.display()));
    }
    Ok(path)
}

fn resolve_document_search_cli(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("RELAY_DOCUMENT_SEARCH_CLI") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates
            .push(resource_dir.join("relay-document-search/scripts/relay-document-search-cli.mjs"));
        candidates.push(resource_dir.join("scripts/relay-document-search-cli.mjs"));
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let manifest_dir = PathBuf::from(manifest_dir);
        candidates.push(manifest_dir.join("../../../scripts/relay-document-search-cli.mjs"));
        candidates.push(manifest_dir.join("../../scripts/relay-document-search-cli.mjs"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn resolve_officecli_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("RELAY_OFFICECLI_PATH") {
        let path = PathBuf::from(path);
        if officecli_capability_ok(app, &path) {
            return Some(path);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("relay-tools/officecli/officecli.exe"));
        candidates.push(resource_dir.join("binaries/relay-officecli-win-x64.exe"));
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let manifest_dir = PathBuf::from(manifest_dir);
        candidates.push(manifest_dir.join("binaries/relay-officecli-win-x64.exe"));
        candidates.push(
            manifest_dir.join("binaries/.relay-officecli-download-cache/1.0.92/officecli.exe"),
        );
    }
    if let Some(found) = candidates
        .into_iter()
        .find(|path| officecli_capability_ok(app, path))
    {
        return Some(found);
    }
    for name in ["officecli", "officecli.exe"] {
        let path = PathBuf::from(name);
        if officecli_capability_ok(app, &path) {
            return Some(path);
        }
    }
    None
}

fn officecli_capability_ok(app: &AppHandle, path: &Path) -> bool {
    if !executable_ok(path, "--version") {
        return false;
    }
    if std::env::var("RELAY_OFFICECLI_SKIP_CAPABILITY_CHECK")
        .ok()
        .as_deref()
        == Some("1")
    {
        return true;
    }
    let cache_key = officecli_capability_cache_key(path);
    let cache = OFFICECLI_CAPABILITY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(&cache_key) {
            return *value;
        }
    }
    let ok = officecli_view_smoke_ok(app, path);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(cache_key, ok);
    }
    ok
}

fn officecli_capability_cache_key(path: &Path) -> String {
    let metadata = fs::metadata(path).ok();
    let size = metadata.as_ref().map(|item| item.len()).unwrap_or(0);
    let modified = metadata
        .and_then(|item| item.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{}|{}|{}", path.display(), size, modified)
}

fn officecli_view_smoke_ok(app: &AppHandle, officecli: &Path) -> bool {
    let temp_root = app_local_data_dir(app)
        .unwrap_or_else(|_| std::env::temp_dir().join("Relay Agent"))
        .join("officecli-smoke");
    if fs::create_dir_all(&temp_root).is_err() {
        return false;
    }
    let Ok(temp_file) = tempfile::Builder::new()
        .prefix("relay-officecli-smoke-")
        .suffix(".xlsx")
        .tempfile_in(&temp_root)
    else {
        return false;
    };
    if write_officecli_smoke_workbook(temp_file.path()).is_err() {
        return false;
    }
    let temp_path = temp_file.path().display().to_string();
    let mut command = Command::new(officecli);
    command
        .args(["view", temp_path.as_str(), "outline", "--json"])
        .stdin(Stdio::null());
    crate::windows_command::no_console_window(&mut command);
    run_command_with_timeout(
        command,
        Duration::from_millis(OFFICECLI_SMOKE_TIMEOUT_MS),
        &temp_root,
    )
    .is_ok_and(|output| output.success && output.stdout.contains("\"success\""))
}

fn write_officecli_smoke_workbook(path: &Path) -> Result<(), String> {
    let file = fs::File::create(path)
        .map_err(|error| format!("create OfficeCLI smoke workbook: {error}"))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let entries = [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        ),
        (
            "xl/sharedStrings.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Relay OfficeCLI smoke</t></si></sst>"#,
        ),
        (
            "xl/worksheets/sheet1.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>"#,
        ),
    ];
    for (name, body) in entries {
        writer
            .start_file(name, options)
            .map_err(|error| format!("write OfficeCLI smoke workbook entry {name}: {error}"))?;
        writer
            .write_all(body.as_bytes())
            .map_err(|error| format!("write OfficeCLI smoke workbook entry {name}: {error}"))?;
    }
    writer
        .finish()
        .map_err(|error| format!("finish OfficeCLI smoke workbook: {error}"))?;
    Ok(())
}

fn resolve_ripgrep_path(app: &AppHandle) -> Option<PathBuf> {
    for var_name in ["RELAY_RIPGREP_PATH", "RELAY_BUNDLED_RIPGREP"] {
        if let Ok(path) = std::env::var(var_name) {
            let path = PathBuf::from(path);
            if executable_ok(&path, "--version") {
                return Some(path);
            }
        }
    }
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("relay-tools/ripgrep/rg.exe"));
        candidates.push(resource_dir.join("relay-rg.exe"));
        candidates.push(resource_dir.join("relay-rg"));
        candidates.push(resource_dir.join("relay-rg-x86_64-pc-windows-msvc.exe"));
        candidates.push(resource_dir.join("relay-rg-x86_64-unknown-linux-gnu"));
    }
    if let Some(sidecar_dir) = sidecar_base_dir() {
        candidates.push(sidecar_dir.join("relay-rg.exe"));
        candidates.push(sidecar_dir.join("relay-rg"));
        candidates.push(sidecar_dir.join("relay-rg-x86_64-pc-windows-msvc.exe"));
        candidates.push(sidecar_dir.join("relay-rg-x86_64-unknown-linux-gnu"));
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let manifest_dir = PathBuf::from(manifest_dir);
        candidates.push(manifest_dir.join("binaries/relay-rg-x86_64-pc-windows-msvc.exe"));
        candidates.push(manifest_dir.join("binaries/relay-rg-x86_64-unknown-linux-gnu"));
    }
    candidates
        .into_iter()
        .find(|path| executable_ok(path, "--version"))
        .or_else(|| {
            ["rg", "rg.exe"]
                .into_iter()
                .map(PathBuf::from)
                .find(|path| executable_ok(path, "--version"))
        })
}

fn sidecar_base_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let base = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };
    Some(base.to_path_buf())
}

fn executable_ok(path: &Path, arg: &str) -> bool {
    let mut command = Command::new(path);
    command.arg(arg);
    crate::windows_command::no_console_window(&mut command);
    command.output().is_ok_and(|output| output.status.success())
}

fn run_officecli(
    app: &AppHandle,
    args: Vec<String>,
    backup_path: Option<PathBuf>,
) -> Result<RelayOfficeCommandResponse, String> {
    let started = Instant::now();
    let officecli = resolve_officecli_path(app)
        .ok_or_else(|| "OfficeCLI was not found in bundled resources or PATH.".to_string())?;
    let mut command = Command::new(&officecli);
    command.args(&args).stdin(Stdio::null());
    crate::windows_command::no_console_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("run OfficeCLI: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let error = (!output.status.success()).then(|| officecli_failure_message(&stdout, &stderr));
    Ok(RelayOfficeCommandResponse {
        ok: output.status.success(),
        command: std::iter::once(officecli.display().to_string())
            .chain(args)
            .collect(),
        stdout,
        stderr,
        exit_code: output.status.code(),
        backup_path: backup_path.map(|path| path.display().to_string()),
        elapsed_ms: started.elapsed().as_millis() as u64,
        error,
    })
}

fn officecli_failure_message(stdout: &str, stderr: &str) -> String {
    let combined = format!("{stderr}\n{stdout}");
    if combined.contains("System.Private.Xml") || combined.contains("FileNotFoundException") {
        return "OfficeCLI runtime dependency is missing or damaged. Relay Agent found OfficeCLI, but its Office read/edit command could not load required .NET assemblies. Update Relay Agent or refresh the bundled OfficeCLI payload.".to_string();
    }
    if combined.contains("Unhandled exception") {
        if let Some(line) = combined.lines().find(|line| !line.trim().is_empty()) {
            return format!(
                "OfficeCLI failed with an unhandled exception: {}",
                line.trim()
            );
        }
        return "OfficeCLI failed with an unhandled exception.".to_string();
    }
    "OfficeCLI command failed.".to_string()
}

fn create_office_backup(app: &AppHandle, file_path: &Path) -> Result<PathBuf, String> {
    let backup_dir = app_local_data_dir(app)?.join("office-backups");
    fs::create_dir_all(&backup_dir).map_err(|error| {
        format!(
            "create Office backup directory at {}: {error}",
            backup_dir.display()
        )
    })?;
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("office-file");
    let ext = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("bak");
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup = backup_dir.join(format!("{stem}.{timestamp}.backup.{ext}"));
    fs::copy(file_path, &backup).map_err(|error| {
        format!(
            "create Office backup from {} to {}: {error}",
            file_path.display(),
            backup.display()
        )
    })?;
    Ok(backup)
}

fn parse_officecli_args(input: &str) -> Result<Vec<String>, String> {
    if input
        .chars()
        .any(|ch| matches!(ch, '\n' | '\r' | '&' | '|' | ';' | '>' | '<' | '`'))
    {
        return Err("OfficeCLI arguments must not contain shell control characters.".to_string());
    }
    let mut args = split_command_words(input)?;
    if args.first().is_some_and(|first| {
        first.eq_ignore_ascii_case("officecli") || first.eq_ignore_ascii_case("officecli.exe")
    }) {
        args.remove(0);
    }
    if !args.iter().any(|arg| arg == "--json") {
        args.push("--json".to_string());
    }
    Ok(args)
}

fn split_command_words(input: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for ch in input.trim().chars() {
        if let Some(active) = quote {
            if ch == active {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if quote.is_some() {
        return Err("OfficeCLI arguments contain an unterminated quote.".to_string());
    }
    if !current.is_empty() {
        out.push(current);
    }
    Ok(out)
}

fn intent_as_str(value: &RelayDocumentSearchIntent) -> &'static str {
    match value {
        RelayDocumentSearchIntent::FindFiles => "find_files",
        RelayDocumentSearchIntent::AnswerWithEvidence => "answer_with_evidence",
        RelayDocumentSearchIntent::SummarizeWithEvidence => "summarize_with_evidence",
        RelayDocumentSearchIntent::InspectFile => "inspect_file",
        RelayDocumentSearchIntent::SimilarDocuments => "similar_documents",
    }
}

fn thoroughness_as_str(value: &RelayDocumentSearchThoroughness) -> &'static str {
    match value {
        RelayDocumentSearchThoroughness::Quick => "quick",
        RelayDocumentSearchThoroughness::Thorough => "thorough",
    }
}

fn evidence_as_str(value: &RelayDocumentSearchEvidence) -> &'static str {
    match value {
        RelayDocumentSearchEvidence::None => "none",
        RelayDocumentSearchEvidence::Candidate => "candidate",
        RelayDocumentSearchEvidence::Required => "required",
    }
}

fn response_from_document_search_result(
    raw: JsonValue,
    elapsed_ms: u64,
) -> RelayDocumentSearchResponse {
    let status = raw
        .get("status")
        .and_then(JsonValue::as_str)
        .unwrap_or("unknown")
        .to_string();
    let display = raw.get("display").and_then(JsonValue::as_object);
    let summary = display
        .and_then(|value| {
            value
                .get("beginnerSummary")
                .or_else(|| value.get("answerSummary"))
        })
        .and_then(JsonValue::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| fallback_search_summary(&raw));
    let coverage_label = display
        .and_then(|value| value.get("coverageLabel"))
        .and_then(JsonValue::as_str)
        .map(str::to_string)
        .or_else(|| {
            raw.get("coverage")
                .and_then(|coverage| coverage.get("scannedFiles"))
                .and_then(JsonValue::as_u64)
                .map(|count| format!("{count}件を確認しました。"))
        })
        .unwrap_or_else(|| "検索範囲を確認しました。".to_string());
    let cards = raw
        .get("results")
        .and_then(JsonValue::as_array)
        .map(|results| results.iter().take(80).map(card_from_result).collect())
        .unwrap_or_default();
    RelayDocumentSearchResponse {
        ok: status != "failed",
        status,
        summary,
        coverage_label,
        elapsed_ms,
        cards,
        raw,
        error: None,
    }
}

fn fallback_search_summary(raw: &JsonValue) -> String {
    let count = raw
        .get("results")
        .and_then(JsonValue::as_array)
        .map_or(0, Vec::len);
    if count == 0 {
        "候補ファイルは見つかりませんでした。".to_string()
    } else {
        format!("候補ファイルが{count}件見つかりました。")
    }
}

fn card_from_result(result: &JsonValue) -> RelaySearchResultCard {
    RelaySearchResultCard {
        title: string_field(result, &["display_name", "displayName", "name"])
            .unwrap_or_else(|| "Untitled".to_string()),
        path: string_field(result, &["path"]).unwrap_or_default(),
        display_path: string_field(result, &["display_path", "displayPath"]),
        file_type: string_field(result, &["file_type", "fileType"]),
        modified_time: string_field(result, &["modified_time", "modifiedTime"]),
        match_mode: string_field(result, &["match_mode", "matchMode"]),
        evidence_state: string_field(result, &["evidence_state", "evidenceState"]),
        score: result.get("score").and_then(JsonValue::as_f64),
        bucket: string_field(result, &["candidate_bucket", "candidateBucket"]),
        folder_role: string_field(result, &["folder_role", "folderRole"]),
        warnings: result
            .get("warnings")
            .and_then(JsonValue::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(JsonValue::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn string_field(result: &JsonValue, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| result.get(*name).and_then(JsonValue::as_str))
        .map(str::to_string)
}

fn trim_for_error(value: &str) -> String {
    const LIMIT: usize = 1200;
    let trimmed = value.trim();
    if trimmed.len() <= LIMIT {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..LIMIT])
    }
}

#[cfg(test)]
mod tests {
    use super::{officecli_failure_message, parse_officecli_args, split_command_words};

    #[test]
    fn officecli_parser_preserves_windows_backslashes_inside_quotes() {
        let args = split_command_words(r#"set "H:\shr1\book.xlsx" "/Sheet1/A1" --prop value=売上"#)
            .expect("split OfficeCLI args");

        assert_eq!(args[0], "set");
        assert_eq!(args[1], r#"H:\shr1\book.xlsx"#);
        assert_eq!(args[2], "/Sheet1/A1");
    }

    #[test]
    fn officecli_parser_appends_json_without_losing_selected_file_path() {
        let args = parse_officecli_args(r#"view "H:\shr1\book.xlsx" outline"#)
            .expect("parse OfficeCLI args");

        assert_eq!(
            args,
            vec!["view", r#"H:\shr1\book.xlsx"#, "outline", "--json"]
        );
    }

    #[test]
    fn officecli_failure_message_explains_missing_runtime_dependency() {
        let message = officecli_failure_message(
            "",
            "Unhandled exception: System.IO.FileNotFoundException: File name: 'System.Private.Xml, Version=10.0.0.0'",
        );

        assert!(message.contains("runtime dependency"));
        assert!(message.contains("OfficeCLI"));
    }
}
