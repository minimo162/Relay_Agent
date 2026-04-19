//! PDF text extraction via bundled or PATH `node` + `liteparse-runner/parse.mjs` (@llamaindex/liteparse, OCR off).

use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::Duration;

use wait_timeout::ChildExt;

const MAX_PDF_TEXT_BYTES: usize = 16 * 1024 * 1024;
const MAX_PDF_STDERR_BYTES: usize = 32 * 1024;
pub const PDF_LITEPARSE_HEADER: &str =
    "[PDF text via LiteParse — OCR disabled; spatial/layout-oriented extraction; quality varies by file.]\n\n";

fn parse_timeout() -> Duration {
    let secs = std::env::var("RELAY_PDF_PARSE_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0 && n <= 3600)
        .unwrap_or(120);
    Duration::from_secs(secs)
}

fn read_limited(reader: &mut impl Read, max: usize) -> io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        let n = reader.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        if buf.len() + n > max {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("PDF text exceeds maximum of {max} bytes"),
            ));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Ok(buf)
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

fn resolve_node_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("RELAY_BUNDLED_NODE") {
        let pb = PathBuf::from(p);
        return pb.is_file().then_some(pb);
    }
    if let Some(base) = sidecar_base_dir() {
        #[cfg(windows)]
        let p = base.join("relay-node.exe");
        #[cfg(not(windows))]
        let p = base.join("relay-node");
        if p.is_file() {
            return Some(p);
        }
    }
    for name in ["node", "node.exe"] {
        if Command::new(name)
            .arg("--version")
            .output()
            .ok()
            .is_some_and(|o| o.status.success())
        {
            return Some(PathBuf::from(name));
        }
    }
    None
}

fn liteparse_runner_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("RELAY_LITEPARSE_RUNNER_ROOT") {
        let pb = PathBuf::from(p);
        return pb.join("parse.mjs").is_file().then_some(pb);
    }
    let man = option_env!("CARGO_MANIFEST_DIR")?;
    let candidate = Path::new(man)
        .join("..")
        .join("..")
        .join("liteparse-runner");
    let canon = std::fs::canonicalize(&candidate).ok()?;
    if canon.join("parse.mjs").is_file() {
        return Some(canon);
    }
    None
}

pub struct LiteparsePaths {
    pub runner: PathBuf,
    pub parse_mjs: PathBuf,
    pub node: PathBuf,
}

pub fn resolve_liteparse_paths() -> io::Result<LiteparsePaths> {
    let runner = liteparse_runner_root().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "LiteParse runner not found (missing liteparse-runner/parse.mjs). Run: npm ci --omit=dev --prefix apps/desktop/src-tauri/liteparse-runner",
        )
    })?;
    let parse_mjs = runner.join("parse.mjs");
    let node = resolve_node_binary().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "Node.js not found for PDF parsing (set RELAY_BUNDLED_NODE or install `node` on PATH, or run apps/desktop/scripts/fetch-bundled-node.mjs before tauri build)",
        )
    })?;
    Ok(LiteparsePaths {
        runner,
        parse_mjs,
        node,
    })
}

fn run_liteparse_child(
    paths: &LiteparsePaths,
    pdf_path: &Path,
    pages_arg: &str,
) -> io::Result<(Vec<u8>, Vec<u8>, ExitStatus)> {
    let mut cmd = Command::new(&paths.node);
    cmd.arg(&paths.parse_mjs);
    cmd.arg(pdf_path.as_os_str());
    cmd.arg(pages_arg);
    cmd.current_dir(&paths.runner);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.env("NODE_NO_WARNINGS", "1");

    let mut child = cmd
        .spawn()
        .map_err(|e| io::Error::other(format!("failed to spawn PDF parser: {e}")))?;

    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("PDF parser child has no stdout handle"))?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("PDF parser child has no stderr handle"))?;

    let out_handle = thread::spawn(move || read_limited(&mut stdout_pipe, MAX_PDF_TEXT_BYTES));
    let err_handle = thread::spawn(move || read_limited(&mut stderr_pipe, MAX_PDF_STDERR_BYTES));

    let timeout = parse_timeout();
    let wait_result = child
        .wait_timeout(timeout)
        .map_err(|e| io::Error::other(format!("waiting for PDF parser: {e}")))?;

    let Some(status) = wait_result else {
        let _ = child.kill();
        let _ = child.wait();
        let _ = out_handle.join();
        let _ = err_handle.join();
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            format!(
                "PDF parse exceeded RELAY_PDF_PARSE_TIMEOUT_SECS (default 120s); path={}",
                pdf_path.display()
            ),
        ));
    };

    let stdout_bytes = out_handle
        .join()
        .map_err(|_| io::Error::other("PDF parser stdout reader thread panicked"))??;

    let stderr_bytes = err_handle
        .join()
        .map_err(|_| io::Error::other("PDF parser stderr reader thread panicked"))??;

    Ok((stdout_bytes, stderr_bytes, status))
}

pub(crate) fn read_pdf_as_payload(path: &Path, pages: Option<&str>) -> io::Result<String> {
    if let Some(spec) = pages {
        if spec.trim().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "pages string must not be empty",
            ));
        }
    }

    let lite_paths = resolve_liteparse_paths()?;
    let pages_arg = pages.unwrap_or("");
    let (stdout_bytes, stderr_bytes, status) = run_liteparse_child(&lite_paths, path, pages_arg)?;

    if !status.success() {
        let msg = String::from_utf8_lossy(&stderr_bytes);
        let msg = msg.trim();
        let tail = if msg.len() > 4000 {
            &msg[msg.len().saturating_sub(4000)..]
        } else {
            msg
        };
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "LiteParse exited with {}; stderr: {}",
                status
                    .code()
                    .map_or_else(|| "signal".into(), |c| c.to_string()),
                if tail.is_empty() { "(empty)" } else { tail }
            ),
        ));
    }

    let text = String::from_utf8(stdout_bytes).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("PDF parser stdout is not valid UTF-8: {e}"),
        )
    })?;

    Ok(text)
}

pub(crate) fn read_pdf_as_text(path: &Path, pages: Option<&str>) -> io::Result<String> {
    let payload = read_pdf_as_payload(path, pages)?;
    Ok(format!("{PDF_LITEPARSE_HEADER}{payload}"))
}
