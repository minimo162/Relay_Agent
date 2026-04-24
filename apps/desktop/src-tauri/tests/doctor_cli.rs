use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

#[derive(Clone, Copy)]
enum StatusMode {
    Ready,
    LoginRequired,
    Unauthorized,
}

struct MockServer {
    url: String,
    stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.url.trim_start_matches("http://"));
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn temp_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time after epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("{label}-{nanos}"));
    fs::create_dir_all(&root).expect("create temp dir");
    root
}

fn create_workspace() -> PathBuf {
    let root = temp_dir("relay-doctor-workspace");
    let claw_dir = root.join(".claw");
    fs::create_dir_all(&claw_dir).expect("create claw dir");
    fs::write(claw_dir.join("settings.json"), "{}").expect("write settings");
    root
}

fn start_mock_server(mode: StatusMode, expected_boot_token: &str) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    listener.set_nonblocking(true).expect("set nonblocking");
    let addr = listener.local_addr().expect("local addr");
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::clone(&stop);
    let expected = expected_boot_token.to_string();
    let join = thread::spawn(move || {
        while !stop_flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let expected = expected.clone();
                    thread::spawn(move || handle_connection(&mut stream, mode, &expected));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });
    MockServer {
        url: format!("http://{}", addr),
        stop,
        join: Some(join),
    }
}

fn handle_connection(stream: &mut TcpStream, mode: StatusMode, expected_boot_token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let mut request = Vec::new();
    let mut buffer = [0_u8; 1024];
    while let Ok(read) = stream.read(&mut buffer) {
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8_lossy(&request);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");
    let boot_token = request.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("X-Relay-Boot-Token") {
            Some(value.trim().to_string())
        } else {
            None
        }
    });

    let (status_line, body) = match path {
        "/json/version" => (
            "HTTP/1.1 200 OK",
            serde_json::json!({
                "Browser": "Microsoft Edge 136.0",
                "User-Agent": "Mozilla/5.0 Edg/136.0",
            })
            .to_string(),
        ),
        "/health" => (
            "HTTP/1.1 200 OK",
            serde_json::json!({
                "status": "ok",
                "service": "relay_copilot_server",
                "instanceId": "mock-instance",
            })
            .to_string(),
        ),
        "/path" => ("HTTP/1.1 200 OK", serde_json::json!([]).to_string()),
        "/status" if boot_token.as_deref() == Some(expected_boot_token) => match mode {
            StatusMode::Ready => (
                "HTTP/1.1 200 OK",
                serde_json::json!({
                    "connected": true,
                    "loginRequired": false,
                    "url": "https://m365.cloud.microsoft/chat",
                    "repairStageStats": [],
                })
                .to_string(),
            ),
            StatusMode::LoginRequired => (
                "HTTP/1.1 200 OK",
                serde_json::json!({
                    "connected": false,
                    "loginRequired": true,
                    "url": "https://login.microsoftonline.com",
                    "error": "M365 sign-in required",
                    "repairStageStats": [],
                })
                .to_string(),
            ),
            StatusMode::Unauthorized => (
                "HTTP/1.1 401 Unauthorized",
                serde_json::json!({
                    "error": "unauthorized",
                    "message": "bad boot token",
                })
                .to_string(),
            ),
        },
        "/status" => (
            "HTTP/1.1 401 Unauthorized",
            serde_json::json!({
                "error": "unauthorized",
                "message": "bad boot token",
            })
            .to_string(),
        ),
        _ => (
            "HTTP/1.1 404 Not Found",
            serde_json::json!({
                "error": "not_found",
            })
            .to_string(),
        ),
    };

    let response = format!(
        "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn run_doctor(
    workspace: &PathBuf,
    server: &MockServer,
    boot_token: Option<&str>,
    extra_env: &[(&str, &str)],
) -> (std::process::ExitStatus, Value) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_relay-agent-doctor"));
    command
        .arg("--json")
        .arg("--workspace")
        .arg(workspace)
        .arg("--cdp-port")
        .arg(server.url.rsplit(':').next().expect("port"))
        .arg("--no-auto-launch-edge")
        .env("RELAY_DOCTOR_BRIDGE_URL", &server.url);
    if let Some(token) = boot_token {
        command.env("RELAY_DOCTOR_BOOT_TOKEN", token);
    }
    for (key, value) in extra_env {
        command.env(key, value);
    }
    let output = command.output().expect("run doctor");
    let report = serde_json::from_slice::<Value>(&output.stdout).expect("doctor json");
    (output.status, report)
}

#[test]
fn doctor_cli_reports_ready_status_json() {
    let workspace = create_workspace();
    let server = start_mock_server(StatusMode::Ready, "token-1");

    let (status, report) = run_doctor(
        &workspace,
        &server,
        Some("token-1"),
        &[("RELAY_OPENCODE_TOOL_RUNTIME_URL", &server.url)],
    );

    assert!(status.success(), "{report}");
    assert_eq!(report.get("status").and_then(Value::as_str), Some("ok"));
    assert!(report["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .any(|check| check["id"].as_str() == Some("bridge_status")
            && check["status"].as_str() == Some("ok")));
}

#[test]
fn doctor_cli_reports_login_required_as_warn() {
    let workspace = create_workspace();
    let server = start_mock_server(StatusMode::LoginRequired, "token-2");

    let (status, report) = run_doctor(&workspace, &server, Some("token-2"), &[]);

    assert_eq!(status.code(), Some(1), "{report}");
    assert_eq!(report.get("status").and_then(Value::as_str), Some("warn"));
    let sign_in = report["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .find(|check| check["id"].as_str() == Some("m365_sign_in"))
        .expect("m365_sign_in check");
    assert_eq!(sign_in["status"].as_str(), Some("warn"));
}

#[test]
fn doctor_cli_reports_bridge_auth_failure() {
    let workspace = create_workspace();
    let server = start_mock_server(StatusMode::Ready, "expected-token");

    let (status, report) = run_doctor(&workspace, &server, Some("wrong-token"), &[]);

    assert_eq!(status.code(), Some(2), "{report}");
    assert_eq!(report.get("status").and_then(Value::as_str), Some("fail"));
    let bridge_status = report["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .find(|check| check["id"].as_str() == Some("bridge_status"))
        .expect("bridge_status check");
    assert_eq!(bridge_status["status"].as_str(), Some("fail"));
}

#[test]
fn doctor_cli_reports_missing_workspace() {
    let workspace = temp_dir("relay-doctor-missing");
    let missing = workspace.join("does-not-exist");
    let server = start_mock_server(StatusMode::Ready, "token-3");

    let (status, report) = run_doctor(&missing, &server, Some("token-3"), &[]);

    assert_eq!(status.code(), Some(2), "{report}");
    let workspace_check = report["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .find(|check| check["id"].as_str() == Some("workspace_config"))
        .expect("workspace check");
    assert_eq!(workspace_check["status"].as_str(), Some("fail"));
}

#[test]
fn doctor_cli_reports_missing_runtime_asset() {
    let workspace = create_workspace();
    let server = start_mock_server(StatusMode::Ready, "token-4");

    let (status, report) = run_doctor(
        &workspace,
        &server,
        Some("token-4"),
        &[
            ("RELAY_BUNDLED_NODE", "/definitely/missing/node"),
            (
                "RELAY_LITEPARSE_RUNNER_ROOT",
                "/definitely/missing/liteparse-runner",
            ),
            ("PATH", ""),
        ],
    );

    assert_eq!(status.code(), Some(2), "{report}");
    let runtime_assets = report["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .find(|check| check["id"].as_str() == Some("runtime_assets"))
        .expect("runtime assets check");
    assert_eq!(runtime_assets["status"].as_str(), Some("fail"));
}
