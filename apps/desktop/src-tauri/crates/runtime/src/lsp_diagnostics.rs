//! Minimal stdio LSP client for pull diagnostics (rust-analyzer). See `docs/LSP_MILESTONE.md`.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const MAX_FILE_BYTES: usize = 512 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(12);

fn file_uri(path: &Path) -> String {
    let abs = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    #[cfg(windows)]
    {
        let s = abs.to_string_lossy().replace('\\', "/");
        format!("file:///{}", s.trim_start_matches('/'))
    }
    #[cfg(not(windows))]
    {
        format!("file://{}", abs.to_string_lossy())
    }
}

fn workspace_uri(root: &Path) -> String {
    file_uri(root)
}

fn encode_frame(payload: &[u8]) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    let mut framed = header.into_bytes();
    framed.extend_from_slice(payload);
    framed
}

async fn read_frame(stdout: &mut BufReader<ChildStdout>) -> std::io::Result<Vec<u8>> {
    let mut line = String::new();
    let mut len: Option<usize> = None;
    loop {
        line.clear();
        let n = stdout.read_line(&mut line).await?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "LSP stdout closed",
            ));
        }
        let t = line.trim();
        if t.is_empty() {
            break;
        }
        let lower = t.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length:") {
            len = Some(
                rest.trim()
                    .parse::<usize>()
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
            );
        }
    }
    let nbytes = len.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "missing Content-Length in LSP frame",
        )
    })?;
    let mut buf = vec![0u8; nbytes];
    stdout.read_exact(&mut buf).await?;
    Ok(buf)
}

async fn write_msg(stdin: &mut ChildStdin, msg: &Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(msg).map_err(|e| std::io::Error::other(e.to_string()))?;
    stdin.write_all(&encode_frame(&bytes)).await?;
    stdin.flush().await
}

async fn next_json_response(stdout: &mut BufReader<ChildStdout>) -> std::io::Result<Value> {
    let buf = read_frame(stdout).await?;
    serde_json::from_slice(&buf)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

fn spawn_rust_analyzer(
    workspace_root: &Path,
) -> Result<(Child, ChildStdin, BufReader<ChildStdout>), String> {
    let mut child = Command::new("rust-analyzer")
        .current_dir(workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn rust-analyzer: {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "rust-analyzer missing stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "rust-analyzer missing stdout".to_string())?;
    let reader = BufReader::new(stdout);
    Ok((child, stdin, reader))
}

async fn lsp_initialize_session(
    child: &mut Child,
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    root_uri: &str,
) -> Result<(), String> {
    let init = json!({
        "jsonrpc": "2.0",
        "id": 1_u64,
        "method": "initialize",
        "params": {
            "processId": null,
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "diagnostic": {
                        "dynamicRegistration": false
                    }
                }
            },
            "clientInfo": { "name": "relay-agent", "version": "0.1" }
        }
    });

    timeout(IO_TIMEOUT, write_msg(stdin, &init))
        .await
        .map_err(|_| "LSP initialize timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let init_resp = timeout(IO_TIMEOUT, next_json_response(reader))
        .await
        .map_err(|_| "LSP initialize response timed out".to_string())?
        .map_err(|e| e.to_string())?;

    if let Some(err) = init_resp.get("error") {
        let _ = child.kill().await;
        return Err(format!("rust-analyzer initialize error: {err}"));
    }

    let notif = json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    });
    timeout(IO_TIMEOUT, write_msg(stdin, &notif))
        .await
        .map_err(|_| "LSP initialized notification timed out".to_string())?
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn lsp_request_pull_diagnostics(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    doc_uri: &str,
    text: &str,
) -> Result<Value, String> {
    let did_open = json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": doc_uri,
                "languageId": "rust",
                "version": 1,
                "text": text
            }
        }
    });
    timeout(IO_TIMEOUT, write_msg(stdin, &did_open))
        .await
        .map_err(|_| "LSP didOpen timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let diag_req = json!({
        "jsonrpc": "2.0",
        "id": 2_u64,
        "method": "textDocument/diagnostic",
        "params": {
            "textDocument": { "uri": doc_uri }
        }
    });
    timeout(IO_TIMEOUT, write_msg(stdin, &diag_req))
        .await
        .map_err(|_| "LSP diagnostic request timed out".to_string())?
        .map_err(|e| e.to_string())?;

    timeout(IO_TIMEOUT, next_json_response(reader))
        .await
        .map_err(|_| "LSP diagnostic response timed out".to_string())?
        .map_err(|e| e.to_string())
}

/// Run `textDocument/diagnostic` (LSP pull) for a Rust file via `rust-analyzer` on PATH.
pub async fn pull_rust_diagnostics(
    workspace_root: &Path,
    file_path: &Path,
) -> Result<String, String> {
    if !file_path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("rs"))
    {
        return Err("LSP diagnostics in this build support Rust (.rs) files only".to_string());
    }
    let text = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    if text.len() > MAX_FILE_BYTES {
        return Err(format!(
            "file too large for LSP diagnostics (max {MAX_FILE_BYTES} bytes)"
        ));
    }

    let root_uri = workspace_uri(workspace_root);
    let doc_uri = file_uri(file_path);

    let (mut child, mut stdin, mut reader) = spawn_rust_analyzer(workspace_root)?;
    lsp_initialize_session(&mut child, &mut stdin, &mut reader, &root_uri).await?;
    let diag_resp = lsp_request_pull_diagnostics(&mut stdin, &mut reader, &doc_uri, &text).await?;

    let _ = child.kill().await;

    if let Some(err) = diag_resp.get("error") {
        return Err(format!(
            "textDocument/diagnostic not available or failed: {err}. If rust-analyzer is older, upgrade or use IDE diagnostics."
        ));
    }

    serde_json::to_string_pretty(&diag_resp).map_err(|e| e.to_string())
}

/// Blocking wrapper for synchronous tool execution paths.
pub fn pull_rust_diagnostics_blocking(
    workspace_root: &Path,
    file_path: &Path,
) -> Result<String, String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    rt.block_on(pull_rust_diagnostics(workspace_root, file_path))
}
