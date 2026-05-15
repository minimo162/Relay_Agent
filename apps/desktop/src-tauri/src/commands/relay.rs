use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Manager};

use crate::models::{
    RelayCodeContextFile, RelayCodeContextRequest, RelayCodeContextResponse,
    RelayCodePatchApplyRequest, RelayCodePatchApplyResponse, RelayCodePatchEdit,
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
const OFFICECLI_SMOKE_RETRY_COUNT: usize = 3;
const OFFICECLI_SMOKE_RETRY_SLEEP_MS: u64 = 250;
const CODE_CONTEXT_DEFAULT_MAX_FILES: usize = 8;
const CODE_CONTEXT_MAX_FILES: usize = 16;
const CODE_CONTEXT_MAX_SCAN_FILES: u32 = 5_000;
const CODE_CONTEXT_MAX_FILE_BYTES: u64 = 160_000;
const CODE_CONTEXT_MAX_CONTENT_BYTES: usize = 20_000;
const CODE_CONTEXT_TOTAL_CONTENT_BYTES: usize = 80_000;
const CODE_PATCH_MAX_EDITS: usize = 12;
const CODE_PATCH_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
static OFFICECLI_CAPABILITY_CACHE: OnceLock<Mutex<HashMap<String, OfficeCliCandidateCheck>>> =
    OnceLock::new();

#[derive(Debug, Clone)]
struct OfficeCliCandidateCheck {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone)]
struct OfficeCliResolution {
    path: Option<PathBuf>,
    message: String,
}

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
    let officecli = resolve_officecli(&app);
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
        officecli_available: officecli.path.is_some(),
        officecli_path: officecli
            .path
            .as_ref()
            .map(|path| path.display().to_string()),
        officecli_message: officecli.message,
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

#[tauri::command]
pub async fn collect_code_context(
    request: RelayCodeContextRequest,
) -> Result<RelayCodeContextResponse, String> {
    tauri::async_runtime::spawn_blocking(move || collect_code_context_blocking(request))
        .await
        .map_err(|error| format!("code context task join failed: {error}"))?
}

#[tauri::command]
pub async fn apply_code_patch(
    request: RelayCodePatchApplyRequest,
) -> Result<RelayCodePatchApplyResponse, String> {
    tauri::async_runtime::spawn_blocking(move || apply_code_patch_blocking(request))
        .await
        .map_err(|error| format!("code patch task join failed: {error}"))?
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

#[derive(Debug)]
struct CodeCandidate {
    relative_path: String,
    path: PathBuf,
    size_bytes: u64,
    modified_time: Option<String>,
    score: i32,
    reasons: Vec<String>,
}

fn collect_code_context_blocking(
    request: RelayCodeContextRequest,
) -> Result<RelayCodeContextResponse, String> {
    let started = Instant::now();
    let workspace = normalize_existing_dir(&request.workspace_path, "workspace")?;
    let workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("canonicalize workspace {}: {error}", workspace.display()))?;
    let instruction = request.instruction.trim();
    if instruction.is_empty() {
        return Err("Code instruction is required.".to_string());
    }
    let max_files = request
        .max_files
        .map(|value| value as usize)
        .unwrap_or(CODE_CONTEXT_DEFAULT_MAX_FILES)
        .clamp(1, CODE_CONTEXT_MAX_FILES);
    let tokens = tokenize_code_instruction(instruction);
    let explicit_targets = explicit_code_targets(&request);
    let mut scanned_files = 0_u32;
    let mut candidates = Vec::new();
    let explicit_target_set: HashSet<String> = explicit_targets
        .iter()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .collect();

    for target in explicit_targets {
        if let Ok((path, relative_path)) = resolve_existing_workspace_file(&workspace, &target) {
            if is_code_file(&path) {
                let candidate = code_candidate_from_file(
                    &workspace,
                    &path,
                    Some(relative_path),
                    &tokens,
                    &explicit_target_set,
                    true,
                );
                if let Some(candidate) = candidate {
                    candidates.push(candidate);
                }
            }
        }
    }
    scan_code_candidates(
        &workspace,
        &workspace,
        &tokens,
        &explicit_target_set,
        &mut candidates,
        &mut scanned_files,
    );

    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    let mut seen = HashSet::new();
    let mut total_content_bytes = 0_usize;
    let mut files = Vec::new();
    for candidate in candidates {
        if files.len() >= max_files || total_content_bytes >= CODE_CONTEXT_TOTAL_CONTENT_BYTES {
            break;
        }
        if !seen.insert(candidate.relative_path.clone()) || candidate.score <= 0 {
            continue;
        }
        let Some((content, truncated)) = read_code_context_content(&candidate.path) else {
            continue;
        };
        let budget_left = CODE_CONTEXT_TOTAL_CONTENT_BYTES.saturating_sub(total_content_bytes);
        if budget_left == 0 {
            break;
        }
        let content = truncate_to_byte_boundary(&content, budget_left.min(content.len()));
        total_content_bytes += content.len();
        files.push(RelayCodeContextFile {
            relative_path: candidate.relative_path,
            language: language_for_path(&candidate.path),
            size_bytes: candidate.size_bytes,
            modified_time: candidate.modified_time,
            content,
            truncated: truncated || total_content_bytes >= CODE_CONTEXT_TOTAL_CONTENT_BYTES,
            score: candidate.score,
            reasons: candidate.reasons,
        });
    }

    let summary = if files.is_empty() {
        "変更案に使えるコードファイルを特定できませんでした。対象ファイル名や相対パスを指示に含めてください。".to_string()
    } else {
        format!(
            "{}件のコードファイルを確認しました。Copilotにはこの範囲だけを渡します。",
            files.len()
        )
    };
    Ok(RelayCodeContextResponse {
        ok: true,
        workspace_path: workspace.display().to_string(),
        summary,
        files,
        scanned_files,
        elapsed_ms: started.elapsed().as_millis() as u64,
        error: None,
    })
}

fn apply_code_patch_blocking(
    request: RelayCodePatchApplyRequest,
) -> Result<RelayCodePatchApplyResponse, String> {
    let started = Instant::now();
    let workspace = normalize_existing_dir(&request.workspace_path, "workspace")?;
    let workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("canonicalize workspace {}: {error}", workspace.display()))?;
    if request.edits.is_empty() {
        return Err("At least one code edit is required.".to_string());
    }
    if request.edits.len() > CODE_PATCH_MAX_EDITS {
        return Err(format!(
            "Too many edits: maximum {CODE_PATCH_MAX_EDITS} edits are allowed per apply."
        ));
    }

    let mut file_contents: HashMap<String, (PathBuf, String)> = HashMap::new();
    for edit in &request.edits {
        validate_code_patch_edit(edit)?;
        let relative_path = safe_relative_path(&edit.relative_path)?;
        let (path, normalized_relative_path) =
            resolve_existing_workspace_file(&workspace, &relative_path)?;
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("read metadata for {normalized_relative_path}: {error}"))?;
        if metadata.len() > CODE_PATCH_MAX_FILE_BYTES {
            return Err(format!(
                "{normalized_relative_path} is too large for safe exact-string editing."
            ));
        }
        let entry = if let Some(entry) = file_contents.get_mut(&normalized_relative_path) {
            entry
        } else {
            let content = fs::read_to_string(&path)
                .map_err(|error| format!("read {normalized_relative_path}: {error}"))?;
            file_contents.insert(normalized_relative_path.clone(), (path.clone(), content));
            file_contents
                .get_mut(&normalized_relative_path)
                .expect("inserted code patch file")
        };
        let occurrences = entry.1.matches(&edit.old_string).count();
        if occurrences != 1 {
            return Err(format!(
                "{} oldString must match exactly once; found {} occurrence(s).",
                normalized_relative_path, occurrences
            ));
        }
        entry.1 = entry.1.replacen(&edit.old_string, &edit.new_string, 1);
    }

    let mut changed_files: Vec<String> = file_contents.keys().cloned().collect();
    changed_files.sort();
    for relative_path in &changed_files {
        if let Some((path, content)) = file_contents.get(relative_path) {
            fs::write(path, content).map_err(|error| format!("write {relative_path}: {error}"))?;
        }
    }

    let diff_stat = git_diff_for_paths(&workspace, &["diff", "--stat"], &changed_files);
    let diff = git_diff_for_paths(&workspace, &["diff", "--"], &changed_files);
    Ok(RelayCodePatchApplyResponse {
        ok: true,
        changed_files,
        diff_stat,
        diff,
        elapsed_ms: started.elapsed().as_millis() as u64,
        error: None,
    })
}

fn validate_code_patch_edit(edit: &RelayCodePatchEdit) -> Result<(), String> {
    if edit.relative_path.trim().is_empty() {
        return Err("Code edit relativePath is required.".to_string());
    }
    if edit.old_string.is_empty() {
        return Err(format!(
            "{} oldString must not be empty.",
            edit.relative_path.trim()
        ));
    }
    if edit.old_string == edit.new_string {
        return Err(format!(
            "{} oldString and newString are identical.",
            edit.relative_path.trim()
        ));
    }
    if edit.old_string.contains('\0') || edit.new_string.contains('\0') {
        return Err(format!(
            "{} edit contains a NUL byte.",
            edit.relative_path.trim()
        ));
    }
    Ok(())
}

fn scan_code_candidates(
    workspace: &Path,
    dir: &Path,
    tokens: &[String],
    explicit_targets: &HashSet<String>,
    candidates: &mut Vec<CodeCandidate>,
    scanned_files: &mut u32,
) {
    if *scanned_files >= CODE_CONTEXT_MAX_SCAN_FILES {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *scanned_files >= CODE_CONTEXT_MAX_SCAN_FILES {
            break;
        }
        let path = entry.path();
        let file_name = entry.file_name();
        if path.is_dir() {
            if !is_ignored_code_dir(&file_name) {
                scan_code_candidates(
                    workspace,
                    &path,
                    tokens,
                    explicit_targets,
                    candidates,
                    scanned_files,
                );
            }
            continue;
        }
        if !path.is_file() || !is_code_file(&path) {
            continue;
        }
        *scanned_files += 1;
        if let Some(candidate) =
            code_candidate_from_file(workspace, &path, None, tokens, explicit_targets, false)
        {
            candidates.push(candidate);
        }
    }
}

fn code_candidate_from_file(
    workspace: &Path,
    path: &Path,
    known_relative_path: Option<String>,
    tokens: &[String],
    explicit_targets: &HashSet<String>,
    explicit: bool,
) -> Option<CodeCandidate> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > CODE_CONTEXT_MAX_FILE_BYTES {
        return None;
    }
    let relative_path = known_relative_path.or_else(|| relative_display_path(workspace, path))?;
    let content = fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default();
    let (score, reasons) =
        score_code_candidate(&relative_path, &content, tokens, explicit_targets, explicit);
    if score <= 0 {
        return None;
    }
    Some(CodeCandidate {
        relative_path,
        path: path.to_path_buf(),
        size_bytes: metadata.len(),
        modified_time: metadata.modified().ok().map(system_time_iso),
        score,
        reasons,
    })
}

fn score_code_candidate(
    relative_path: &str,
    content: &str,
    tokens: &[String],
    explicit_targets: &HashSet<String>,
    explicit: bool,
) -> (i32, Vec<String>) {
    let mut score = 0_i32;
    let mut reasons = Vec::new();
    let lower_path = relative_path.to_lowercase();
    let lower_content = content.to_lowercase();
    if explicit || explicit_targets.contains(relative_path) {
        score += 1000;
        reasons.push("explicit target".to_string());
    }
    for token in tokens {
        let token = token.to_lowercase();
        if token.is_empty() {
            continue;
        }
        if lower_path.contains(&token) {
            score += 25;
            reasons.push(format!("path matches `{token}`"));
        }
        if lower_content.contains(&token) {
            score += 8;
            reasons.push(format!("content matches `{token}`"));
        }
    }
    if lower_path.ends_with("readme.md")
        || lower_path.ends_with("package.json")
        || lower_path.ends_with("cargo.toml")
    {
        score += 3;
        reasons.push("project metadata".to_string());
    }
    if lower_path.contains("/src/")
        || lower_path.starts_with("src/")
        || lower_path.contains("apps/")
    {
        score += 2;
        reasons.push("source tree".to_string());
    }
    reasons.sort();
    reasons.dedup();
    (score, reasons)
}

fn read_code_context_content(path: &Path) -> Option<(String, bool)> {
    let bytes = fs::read(path).ok()?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    if content.len() <= CODE_CONTEXT_MAX_CONTENT_BYTES {
        return Some((content, false));
    }
    Some((
        truncate_to_byte_boundary(&content, CODE_CONTEXT_MAX_CONTENT_BYTES),
        true,
    ))
}

fn truncate_to_byte_boundary(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn tokenize_code_instruction(instruction: &str) -> Vec<String> {
    let mut tokens = HashSet::new();
    let mut current = String::new();
    for character in instruction.chars() {
        if character.is_alphanumeric()
            || matches!(character, '_' | '-' | '.' | '/' | '\\')
            || is_cjk_character(character)
        {
            current.push(character);
        } else {
            push_code_token(&mut tokens, &current);
            current.clear();
        }
    }
    push_code_token(&mut tokens, &current);
    let mut out: Vec<String> = tokens.into_iter().collect();
    out.sort();
    out.truncate(80);
    out
}

fn push_code_token(tokens: &mut HashSet<String>, value: &str) {
    let trimmed = value.trim_matches(|character: char| {
        matches!(
            character,
            '"' | '\'' | '`' | '「' | '」' | '『' | '』' | '、' | '。'
        )
    });
    if trimmed.is_empty() {
        return;
    }
    let has_non_ascii = trimmed.chars().any(|character| !character.is_ascii());
    if (!has_non_ascii && trimmed.len() < 3) || (has_non_ascii && trimmed.chars().count() < 2) {
        return;
    }
    tokens.insert(trimmed.to_lowercase().replace('\\', "/"));
}

fn is_cjk_character(character: char) -> bool {
    matches!(
        character as u32,
        0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff
    )
}

fn explicit_code_targets(request: &RelayCodeContextRequest) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for value in request
        .target_paths
        .iter()
        .cloned()
        .chain(path_like_tokens(&request.instruction))
    {
        if let Ok(path) = safe_relative_path(&value) {
            let key = path.to_string_lossy().replace('\\', "/");
            if seen.insert(key) {
                out.push(path);
            }
        }
    }
    out
}

fn path_like_tokens(instruction: &str) -> Vec<String> {
    instruction
        .split_whitespace()
        .map(|value| {
            let trimmed = value.trim_matches(|character: char| {
                matches!(
                    character,
                    '"' | '\'' | '`' | '「' | '」' | '『' | '』' | '、' | '。' | ',' | ';'
                )
            });
            trim_code_path_suffix(trimmed)
        })
        .filter(|value| {
            (value.contains('/')
                || value.contains('\\')
                || code_extension_from_name(value).is_some())
                && !PathBuf::from(value).is_absolute()
        })
        .collect()
}

fn trim_code_path_suffix(value: &str) -> String {
    let lower = value.to_lowercase();
    for extension in CODE_EXTENSIONS {
        let marker = format!(".{extension}");
        if let Some(index) = lower.find(&marker) {
            return value[..index + marker.len()].to_string();
        }
    }
    value.to_string()
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("relative path is required.".to_string());
    }
    if normalized.contains(':') {
        return Err(format!(
            "absolute or drive-qualified paths are not allowed: {normalized}"
        ));
    }
    let path = PathBuf::from(&normalized);
    if path.is_absolute() {
        return Err(format!("absolute paths are not allowed: {normalized}"));
    }
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => safe.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("path must stay inside the workspace: {normalized}"));
            }
        }
    }
    if safe.as_os_str().is_empty() {
        return Err("relative path is required.".to_string());
    }
    Ok(safe)
}

fn resolve_existing_workspace_file(
    workspace: &Path,
    relative_path: &Path,
) -> Result<(PathBuf, String), String> {
    let relative_path = safe_relative_path(&relative_path.to_string_lossy())?;
    let joined = workspace.join(&relative_path);
    if !joined.is_file() {
        return Err(format!(
            "workspace file does not exist: {}",
            relative_path.display()
        ));
    }
    let canonical = fs::canonicalize(&joined)
        .map_err(|error| format!("canonicalize {}: {error}", joined.display()))?;
    if !canonical.starts_with(workspace) {
        return Err(format!(
            "path must stay inside the workspace: {}",
            relative_path.display()
        ));
    }
    Ok((
        canonical,
        relative_path.to_string_lossy().replace('\\', "/"),
    ))
}

fn relative_display_path(workspace: &Path, path: &Path) -> Option<String> {
    let canonical = fs::canonicalize(path).ok()?;
    let relative = canonical.strip_prefix(workspace).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn is_ignored_code_dir(name: &OsStr) -> bool {
    let name = name.to_string_lossy().to_lowercase();
    matches!(
        name.as_str(),
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "coverage"
            | ".next"
            | ".turbo"
            | ".svelte-kit"
            | "out"
            | "vendor"
            | "__pycache__"
    )
}

fn is_code_file(path: &Path) -> bool {
    code_extension(path).is_some_and(|extension| CODE_EXTENSIONS.contains(&extension.as_str()))
}

const CODE_EXTENSIONS: &[&str] = &[
    "tsx", "jsx", "mjs", "cjs", "json", "mdx", "scss", "html", "java", "kts", "cpp", "hpp", "yaml",
    "toml", "ps1", "rs", "ts", "js", "md", "css", "htm", "py", "go", "kt", "cs", "c", "h", "yml",
    "xml", "sh", "sql",
];

fn language_for_path(path: &Path) -> Option<String> {
    Some(
        match code_extension(path)?.as_str() {
            "rs" => "rust",
            "ts" => "typescript",
            "tsx" => "tsx",
            "js" | "mjs" | "cjs" => "javascript",
            "jsx" => "jsx",
            "json" => "json",
            "md" | "mdx" => "markdown",
            "css" => "css",
            "scss" => "scss",
            "html" | "htm" => "html",
            "py" => "python",
            "go" => "go",
            "java" => "java",
            "kt" | "kts" => "kotlin",
            "cs" => "csharp",
            "cpp" | "c" | "h" | "hpp" => "c-cpp",
            "yml" | "yaml" => "yaml",
            "toml" => "toml",
            "xml" => "xml",
            "sh" => "shell",
            "ps1" => "powershell",
            "sql" => "sql",
            other => other,
        }
        .to_string(),
    )
}

fn code_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_lowercase())
}

fn code_extension_from_name(value: &str) -> Option<String> {
    Path::new(value)
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_lowercase())
}

fn system_time_iso(time: std::time::SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339()
}

fn git_diff_for_paths(workspace: &Path, args: &[&str], relative_paths: &[String]) -> String {
    if relative_paths.is_empty() {
        return String::new();
    }
    let mut command = Command::new("git");
    command.arg("-C").arg(workspace).args(args);
    if !args.contains(&"--") {
        command.arg("--");
    }
    command.args(relative_paths).stdin(Stdio::null());
    crate::windows_command::no_console_window(&mut command);
    let Ok(output) = command.output() else {
        return String::new();
    };
    if !output.status.success() {
        return String::new();
    }
    String::from_utf8_lossy(&output.stdout).to_string()
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

fn resolve_officecli(app: &AppHandle) -> OfficeCliResolution {
    let mut failures: Vec<(PathBuf, String)> = Vec::new();
    let mut missing: Vec<PathBuf> = Vec::new();
    for path in officecli_candidate_paths(app) {
        let check = officecli_capability_check(app, &path);
        if check.ok {
            return OfficeCliResolution {
                path: Some(path.clone()),
                message: format!("OfficeCLI is ready at {}.", path.display()),
            };
        }
        if officecli_candidate_can_exist_as_file(&path) && !path.is_file() {
            missing.push(path);
        } else {
            failures.push((path, check.reason));
        }
    }

    let message = officecli_resolution_failure_message(&failures, missing.len());
    OfficeCliResolution {
        path: None,
        message,
    }
}

fn officecli_candidate_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("RELAY_OFFICECLI_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("relay-tools/officecli/officecli.exe"));
        candidates.push(resource_dir.join("binaries/relay-officecli-win-x64.exe"));
        candidates.push(resource_dir.join("officecli.exe"));
    }
    if let Ok(app_local) = app_local_data_dir(app) {
        candidates.push(app_local.join("tools/officecli/1.0.92/officecli.exe"));
    }
    if let Some(sidecar_dir) = sidecar_base_dir() {
        candidates.push(sidecar_dir.join("resources/relay-tools/officecli/officecli.exe"));
        candidates.push(sidecar_dir.join("relay-tools/officecli/officecli.exe"));
        candidates.push(sidecar_dir.join("binaries/relay-officecli-win-x64.exe"));
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let manifest_dir = PathBuf::from(manifest_dir);
        candidates.push(manifest_dir.join("binaries/relay-officecli-win-x64.exe"));
        candidates.push(
            manifest_dir.join("binaries/.relay-officecli-download-cache/1.0.92/officecli.exe"),
        );
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        candidates
            .push(PathBuf::from(home).join(".relay-agent/tools/officecli/1.0.92/officecli.exe"));
    }
    candidates.extend(
        ["officecli", "officecli.exe"]
            .into_iter()
            .map(PathBuf::from),
    );

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|path| {
            let key = path.display().to_string();
            seen.insert(key)
        })
        .collect()
}

fn officecli_candidate_can_exist_as_file(path: &Path) -> bool {
    path.is_absolute()
        || path
            .parent()
            .is_some_and(|parent| !parent.as_os_str().is_empty())
}

fn officecli_resolution_failure_message(
    failures: &[(PathBuf, String)],
    missing_count: usize,
) -> String {
    if let Some((path, reason)) = failures.first() {
        return format!(
            "OfficeCLI was found at {}, but it is not ready: {reason}",
            path.display()
        );
    }
    if missing_count > 0 {
        return format!(
            "OfficeCLI was not found in bundled resources, the user-local tool cache, or PATH (checked {missing_count} packaged/cache path(s))."
        );
    }
    "OfficeCLI was not found in bundled resources, the user-local tool cache, or PATH.".to_string()
}

fn officecli_capability_check(app: &AppHandle, path: &Path) -> OfficeCliCandidateCheck {
    if !executable_ok(path, "--version") {
        return OfficeCliCandidateCheck {
            ok: false,
            reason: "the executable did not run successfully with --version".to_string(),
        };
    }
    if std::env::var("RELAY_OFFICECLI_SKIP_CAPABILITY_CHECK")
        .ok()
        .as_deref()
        == Some("1")
    {
        return OfficeCliCandidateCheck {
            ok: true,
            reason: "capability check skipped".to_string(),
        };
    }
    let cache_key = officecli_capability_cache_key(path);
    let cache = OFFICECLI_CAPABILITY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(&cache_key) {
            return value.clone();
        }
    }
    let check = match officecli_view_smoke_check(app, path) {
        Ok(()) => OfficeCliCandidateCheck {
            ok: true,
            reason: "view smoke test passed".to_string(),
        },
        Err(error) => OfficeCliCandidateCheck {
            ok: false,
            reason: error,
        },
    };
    if let Ok(mut guard) = cache.lock() {
        guard.insert(cache_key, check.clone());
    }
    check
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

fn officecli_view_smoke_check(app: &AppHandle, officecli: &Path) -> Result<(), String> {
    let temp_root = app_local_data_dir(app)
        .unwrap_or_else(|_| std::env::temp_dir().join("Relay Agent"))
        .join("officecli-smoke");
    fs::create_dir_all(&temp_root).map_err(|error| {
        format!(
            "create OfficeCLI smoke directory at {}: {error}",
            temp_root.display()
        )
    })?;
    prune_old_files(&temp_root, Duration::from_secs(60 * 60), true);

    let smoke_path = unique_officecli_smoke_path(&temp_root);
    write_officecli_smoke_workbook(&smoke_path)?;
    let smoke_arg = smoke_path.display().to_string();
    let mut last_output: Option<RelayProcessOutput> = None;

    for attempt in 1..=OFFICECLI_SMOKE_RETRY_COUNT {
        let mut command = Command::new(officecli);
        command
            .args(["view", smoke_arg.as_str(), "outline", "--json"])
            .stdin(Stdio::null());
        crate::windows_command::no_console_window(&mut command);

        let output = run_command_with_timeout(
            command,
            Duration::from_millis(OFFICECLI_SMOKE_TIMEOUT_MS),
            &temp_root,
        )?;
        if output.success && output.stdout.contains("\"success\"") {
            let _ = fs::remove_file(&smoke_path);
            return Ok(());
        }

        let should_retry =
            officecli_smoke_sharing_violation(&output) && attempt < OFFICECLI_SMOKE_RETRY_COUNT;
        last_output = Some(output);
        if should_retry {
            thread::sleep(Duration::from_millis(OFFICECLI_SMOKE_RETRY_SLEEP_MS));
        } else {
            break;
        }
    }

    let _ = fs::remove_file(&smoke_path);
    if let Some(output) = last_output {
        if officecli_smoke_sharing_violation(&output) {
            return Err(format!(
                "OfficeCLI view smoke test failed because the smoke workbook stayed locked after {} attempts; stdout={}; stderr={}",
                OFFICECLI_SMOKE_RETRY_COUNT,
                trim_for_error(&output.stdout),
                trim_for_error(&output.stderr)
            ));
        }
        return Err(format!(
            "OfficeCLI view smoke test failed; stdout={}; stderr={}",
            trim_for_error(&output.stdout),
            trim_for_error(&output.stderr)
        ));
    }

    Err("OfficeCLI view smoke test failed without process output".to_string())
}

fn unique_officecli_smoke_path(temp_root: &Path) -> PathBuf {
    temp_root.join(format!(
        "relay-officecli-smoke-{}.xlsx",
        uuid::Uuid::new_v4().simple()
    ))
}

fn officecli_smoke_sharing_violation(output: &RelayProcessOutput) -> bool {
    let text = format!("{} {}", output.stdout, output.stderr).to_ascii_lowercase();
    text.contains("being used by another process")
        || text.contains("used by another process")
        || text.contains("cannot access the file")
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
    let resolution = resolve_officecli(app);
    let officecli = resolution.path.ok_or_else(|| resolution.message.clone())?;
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
    use super::{
        apply_code_patch_blocking, collect_code_context_blocking, officecli_failure_message,
        officecli_resolution_failure_message, officecli_smoke_sharing_violation,
        parse_officecli_args, safe_relative_path, split_command_words, unique_officecli_smoke_path,
    };
    use crate::models::{RelayCodeContextRequest, RelayCodePatchApplyRequest, RelayCodePatchEdit};
    use std::fs;
    use std::path::PathBuf;

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

    #[test]
    fn officecli_resolution_message_distinguishes_failed_candidate_from_missing_tool() {
        let message = officecli_resolution_failure_message(
            &[(
                PathBuf::from(r#"C:\Relay Agent\resources\relay-tools\officecli\officecli.exe"#),
                "OfficeCLI view smoke test failed".to_string(),
            )],
            4,
        );

        assert!(message.contains("was found"));
        assert!(message.contains("not ready"));
        assert!(message.contains("smoke test failed"));
    }

    #[test]
    fn officecli_smoke_check_detects_file_lock_without_marking_missing() {
        let output = super::RelayProcessOutput {
            success: false,
            stdout: r#"{ "success": false, "error": { "error": "The process cannot access the file 'C:\\Users\\m242054\\AppData\\Local\\com.relayagent.desktop\\officecli-smoke\\relay-officecli-smoke-8Uoknw.xlsx' because it is being used by another process." } }"#.to_string(),
            stderr: String::new(),
            timed_out: false,
        };

        assert!(officecli_smoke_sharing_violation(&output));
    }

    #[test]
    fn officecli_smoke_path_is_closed_workbook_path() {
        let root = PathBuf::from(r#"C:\Users\relay\AppData\Local\Relay Agent\officecli-smoke"#);
        let path = unique_officecli_smoke_path(&root);

        assert_eq!(path.parent(), Some(root.as_path()));
        assert_eq!(
            path.extension().and_then(|value| value.to_str()),
            Some("xlsx")
        );
        assert!(path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .starts_with("relay-officecli-smoke-"));
    }

    #[test]
    fn code_relative_path_rejects_parent_escape() {
        let error = safe_relative_path("../src/main.rs").expect_err("parent path should fail");
        assert!(error.contains("inside the workspace"));
    }

    #[test]
    fn code_context_prefers_explicit_target_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let readme = dir.path().join("README.md");
        fs::write(&readme, "# Relay\n\nOld setup\n").expect("write readme");
        fs::create_dir_all(dir.path().join("src")).expect("create src");
        fs::write(dir.path().join("src/main.ts"), "console.log('other');\n").expect("write main");

        let response = collect_code_context_blocking(RelayCodeContextRequest {
            workspace_path: dir.path().display().to_string(),
            instruction: "README.md の setup を更新して".to_string(),
            target_paths: Vec::new(),
            max_files: Some(4),
        })
        .expect("collect code context");

        assert_eq!(response.files[0].relative_path, "README.md");
        assert!(response.files[0].content.contains("Old setup"));
    }

    #[test]
    fn code_context_trims_japanese_suffix_from_explicit_path() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::create_dir_all(dir.path().join("src")).expect("create src");
        fs::write(
            dir.path().join("src/main.ts"),
            "export const title = 'old';\n",
        )
        .expect("write main");

        let response = collect_code_context_blocking(RelayCodeContextRequest {
            workspace_path: dir.path().display().to_string(),
            instruction: "src/main.tsを更新して".to_string(),
            target_paths: Vec::new(),
            max_files: Some(4),
        })
        .expect("collect code context");

        assert_eq!(response.files[0].relative_path, "src/main.ts");
    }

    #[test]
    fn code_patch_replaces_unique_string() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join("README.md"), "# Old title\n").expect("write readme");

        let response = apply_code_patch_blocking(RelayCodePatchApplyRequest {
            workspace_path: dir.path().display().to_string(),
            edits: vec![RelayCodePatchEdit {
                relative_path: "README.md".to_string(),
                old_string: "# Old title\n".to_string(),
                new_string: "# New title\n".to_string(),
                summary: "update title".to_string(),
            }],
        })
        .expect("apply patch");

        assert!(response.ok);
        assert_eq!(response.changed_files, vec!["README.md"]);
        assert_eq!(
            fs::read_to_string(dir.path().join("README.md")).expect("read readme"),
            "# New title\n"
        );
    }

    #[test]
    fn code_patch_rejects_ambiguous_old_string() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join("README.md"), "same\nsame\n").expect("write readme");

        let error = apply_code_patch_blocking(RelayCodePatchApplyRequest {
            workspace_path: dir.path().display().to_string(),
            edits: vec![RelayCodePatchEdit {
                relative_path: "README.md".to_string(),
                old_string: "same".to_string(),
                new_string: "changed".to_string(),
                summary: "ambiguous".to_string(),
            }],
        })
        .expect_err("ambiguous edit should fail");

        assert!(error.contains("exactly once"));
    }
}
