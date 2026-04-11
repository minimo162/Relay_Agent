//! Minimal LSP milestone hook: verify `rust-analyzer` is spawnable from a workspace (see `docs/LSP_MILESTONE.md`).

use std::path::Path;
use std::process::Command;

/// Run `rust-analyzer --version` with `current_dir` = `workspace` (or `.` if empty).
pub fn probe_rust_analyzer(workspace: Option<&str>) -> crate::models::RustAnalyzerProbeResponse {
    let cwd = workspace
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map_or_else(|| Path::new("."), Path::new);

    match Command::new("rust-analyzer").current_dir(cwd).arg("--version").output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if out.status.success() {
                let line = stdout
                    .lines()
                    .next()
                    .unwrap_or("rust-analyzer")
                    .to_string();
                crate::models::RustAnalyzerProbeResponse {
                    ok: true,
                    version_line: Some(line),
                    error: None,
                }
            } else {
                let msg = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    format!("exit code {:?}", out.status.code())
                };
                crate::models::RustAnalyzerProbeResponse {
                    ok: false,
                    version_line: None,
                    error: Some(msg),
                }
            }
        }
        Err(e) => crate::models::RustAnalyzerProbeResponse {
            ok: false,
            version_line: None,
            error: Some(format!(
                "failed to spawn rust-analyzer: {e} (install rust-analyzer and ensure it is on PATH)"
            )),
        },
    }
}
