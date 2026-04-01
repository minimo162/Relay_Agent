use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::models::{McpServerConfig, McpTransport};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

#[derive(Clone)]
pub struct McpClient {
    config: McpServerConfig,
    http_client: reqwest::Client,
}

impl McpClient {
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .expect("reqwest client should build"),
        }
    }

    pub async fn list_tools(&self) -> Result<Vec<McpToolDefinition>, String> {
        let response = self.send_jsonrpc("tools/list", json!({})).await?;
        serde_json::from_value(response.get("tools").cloned().unwrap_or_else(|| json!([])))
            .map_err(|error| format!("failed to parse MCP tools: {error}"))
    }

    pub async fn call_tool(&self, tool_name: &str, arguments: &Value) -> Result<Value, String> {
        self.send_jsonrpc(
            "tools/call",
            json!({
                "name": tool_name,
                "arguments": arguments,
            }),
        )
        .await
    }

    async fn send_jsonrpc(&self, method: &str, params: Value) -> Result<Value, String> {
        match self.config.transport {
            McpTransport::Sse => self.send_http_jsonrpc(method, params).await,
            McpTransport::Stdio => self.send_stdio_jsonrpc(method, params).await,
        }
    }

    async fn send_http_jsonrpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });
        let response = self
            .http_client
            .post(&self.config.url)
            .json(&request)
            .send()
            .await
            .map_err(|error| format!("MCP request failed: {error}"))?;
        let body: Value = response
            .json()
            .await
            .map_err(|error| format!("MCP response parse failed: {error}"))?;

        if let Some(error) = body.get("error") {
            return Err(format!("MCP error: {error}"));
        }

        Ok(body.get("result").cloned().unwrap_or_else(|| json!(null)))
    }

    async fn send_stdio_jsonrpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let config = self.config.clone();
        let method = method.to_string();

        tauri::async_runtime::spawn_blocking(move || {
            send_stdio_jsonrpc_blocking(&config, &method, params)
        })
        .await
        .map_err(|error| format!("MCP stdio task failed: {error}"))?
    }
}

struct StdioSession {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    child: Child,
    program: String,
}

type SharedStdioSession = Arc<Mutex<StdioSession>>;

fn stdio_sessions() -> &'static Mutex<HashMap<String, SharedStdioSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, SharedStdioSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn send_stdio_jsonrpc_blocking(
    config: &McpServerConfig,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let session_key = stdio_session_key(config);
    let mut last_error = None;

    for _ in 0..2 {
        let session = get_or_spawn_stdio_session(config)?;
        let result = {
            let mut guard = session
                .lock()
                .map_err(|_| "MCP stdio session mutex was poisoned".to_string())?;
            guard.send_request(method, &params)
        };

        match result {
            Ok(body) => return extract_jsonrpc_result(body),
            Err(error) => {
                last_error = Some(error);
                drop_stdio_session(&session_key);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "MCP stdio request failed".to_string()))
}

impl StdioSession {
    fn send_request(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        })
        .to_string();

        self.stdin
            .write_all(request.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| {
                format!(
                    "failed to write MCP stdio request to `{}`: {error}",
                    self.program
                )
            })?;

        let mut line = String::new();
        loop {
            line.clear();
            let read = self
                .stdout
                .read_line(&mut line)
                .map_err(|error| format!("failed to read MCP stdio response: {error}"))?;
            if read == 0 {
                return Err(format!(
                    "MCP stdio session `{}` closed before returning a response",
                    self.program
                ));
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let body = match serde_json::from_str::<Value>(trimmed) {
                Ok(body) => body,
                Err(_) => continue,
            };

            if body.get("result").is_some() || body.get("error").is_some() {
                return Ok(body);
            }
        }
    }
}

impl Drop for StdioSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn extract_jsonrpc_result(body: Value) -> Result<Value, String> {
    if let Some(error) = body.get("error") {
        return Err(format!("MCP error: {error}"));
    }

    Ok(body.get("result").cloned().unwrap_or_else(|| json!(null)))
}

fn get_or_spawn_stdio_session(config: &McpServerConfig) -> Result<SharedStdioSession, String> {
    let key = stdio_session_key(config);
    let mut sessions = stdio_sessions()
        .lock()
        .map_err(|_| "MCP stdio session map mutex was poisoned".to_string())?;
    if let Some(existing) = sessions.get(&key) {
        return Ok(Arc::clone(existing));
    }

    let spawned = Arc::new(Mutex::new(spawn_stdio_session(config)?));
    sessions.insert(key, Arc::clone(&spawned));
    Ok(spawned)
}

fn drop_stdio_session(key: &str) {
    if let Ok(mut sessions) = stdio_sessions().lock() {
        sessions.remove(key);
    }
}

fn spawn_stdio_session(config: &McpServerConfig) -> Result<StdioSession, String> {
    #[cfg(target_os = "windows")]
    let (program, args) = split_windows_command(&config.url)?;

    #[cfg(not(target_os = "windows"))]
    let (program, args) = {
        let argv = shell_words::split(&config.url)
            .map_err(|error| format!("failed to parse MCP stdio command: {error}"))?;
        let mut iter = argv.into_iter();
        let program = iter
            .next()
            .ok_or_else(|| "MCP stdio command was empty".to_string())?;
        (program, iter.collect::<Vec<_>>())
    };

    let mut child = Command::new(&program)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to spawn MCP stdio command `{}`: {error}", program))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("failed to open stdin for MCP stdio command `{}`", program))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("failed to open stdout for MCP stdio command `{}`", program))?;

    Ok(StdioSession {
        stdin,
        stdout: BufReader::new(stdout),
        child,
        program: program.to_string(),
    })
}

#[cfg(target_os = "windows")]
fn split_windows_command(command: &str) -> Result<(String, Vec<String>), String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in command.trim().chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if in_quotes {
        return Err("failed to parse MCP stdio command: unterminated quote".to_string());
    }

    if !current.is_empty() {
        args.push(current);
    }

    let mut iter = args.into_iter();
    let program = iter
        .next()
        .ok_or_else(|| "MCP stdio command was empty".to_string())?;
    Ok((program, iter.collect()))
}

fn stdio_session_key(config: &McpServerConfig) -> String {
    format!("{:?}:{}", config.transport, config.url)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    use super::{McpClient, McpToolDefinition};
    use crate::models::{McpServerConfig, McpTransport};
    use serde_json::json;
    use uuid::Uuid;

    fn spawn_mock_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener.local_addr().expect("listener should have address");

        thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("connection should arrive");
                let mut buffer = [0_u8; 4096];
                let read_count = stream
                    .read(&mut buffer)
                    .expect("request should be readable");
                let request = String::from_utf8_lossy(&buffer[..read_count]);
                let body = request
                    .split("\r\n\r\n")
                    .nth(1)
                    .unwrap_or_default()
                    .trim_matches(char::from(0));
                let payload: serde_json::Value =
                    serde_json::from_str(body).expect("jsonrpc request should parse");
                let method = payload
                    .get("method")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();

                let result = match method {
                    "tools/list" => json!({
                        "tools": [{
                            "name": "echo",
                            "description": "Echo arguments",
                            "inputSchema": { "type": "object" }
                        }]
                    }),
                    "tools/call" => json!({
                        "ok": true,
                        "arguments": payload["params"]["arguments"].clone()
                    }),
                    _ => json!(null),
                };
                let response_body = json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": result
                })
                .to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("response should be writable");
            }
        });

        format!("http://{}", address)
    }

    fn write_stdio_mock_server() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("relay-agent-mcp-{}.cjs", Uuid::new_v4()));
        fs::write(
            &path,
            r#"const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const request = JSON.parse(line.trim());
  let result = null;
  if (request.method === "tools/list") {
    result = {
      tools: [{ name: "echo", description: "Echo arguments", inputSchema: { type: "object" } }]
    };
  } else if (request.method === "tools/call") {
    result = { ok: true, arguments: request.params.arguments };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result }) + "\n");
});"#,
        )
        .expect("mock stdio server should be written");
        path
    }

    fn write_persistent_stdio_mock_server() -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("relay-agent-mcp-persistent-{}.cjs", Uuid::new_v4()));
        fs::write(
            &path,
            r#"const readline = require("readline");
const sessionId = String(process.pid);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const request = JSON.parse(line.trim());
  let result = null;
  if (request.method === "tools/list") {
    result = {
      tools: [{ name: "echo", description: `session:${sessionId}`, inputSchema: { type: "object" } }]
    };
  } else if (request.method === "tools/call") {
    result = { ok: true, sessionId, arguments: request.params.arguments };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result }) + "\n");
});"#,
        )
        .expect("persistent mock stdio server should be written");
        path
    }

    #[test]
    fn discovers_and_calls_mcp_tools_over_http_jsonrpc() {
        let url = spawn_mock_server();
        let client = McpClient::new(McpServerConfig {
            url,
            name: "demo".to_string(),
            transport: McpTransport::Sse,
        });

        let tools = tauri::async_runtime::block_on(client.list_tools())
            .expect("tool discovery should succeed");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
        assert_eq!(tools[0].description, "Echo arguments");
        assert_eq!(
            tools,
            vec![McpToolDefinition {
                name: "echo".to_string(),
                description: "Echo arguments".to_string(),
                input_schema: json!({ "type": "object" }),
            }]
        );

        let result = tauri::async_runtime::block_on(
            client.call_tool("echo", &json!({ "message": "hello" })),
        )
        .expect("tool call should succeed");
        assert_eq!(result["ok"], json!(true));
        assert_eq!(result["arguments"]["message"], json!("hello"));
    }

    #[test]
    fn discovers_and_calls_mcp_tools_over_stdio() {
        let script_path = write_stdio_mock_server();
        #[cfg(target_os = "windows")]
        let url = format!("node \"{}\"", script_path.display());
        #[cfg(not(target_os = "windows"))]
        let url = format!("node {}", script_path.display());
        let config = McpServerConfig {
            url,
            name: "demo-stdio".to_string(),
            transport: McpTransport::Stdio,
        };
        let client = McpClient::new(config.clone());

        let tools = tauri::async_runtime::block_on(client.list_tools())
            .expect("stdio tool discovery should succeed");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");

        let result = tauri::async_runtime::block_on(
            client.call_tool("echo", &json!({ "message": "hello-stdio" })),
        )
        .expect("stdio tool call should succeed");
        assert_eq!(result["ok"], json!(true));
        assert_eq!(result["arguments"]["message"], json!("hello-stdio"));

        super::drop_stdio_session(&super::stdio_session_key(&config));
        fs::remove_file(script_path).expect("mock stdio script should clean up");
    }

    #[test]
    fn reuses_stdio_session_for_multiple_requests() {
        let script_path = write_persistent_stdio_mock_server();
        #[cfg(target_os = "windows")]
        let url = format!("node \"{}\"", script_path.display());
        #[cfg(not(target_os = "windows"))]
        let url = format!("node {}", script_path.display());
        let config = McpServerConfig {
            url,
            name: "demo-stdio-persistent".to_string(),
            transport: McpTransport::Stdio,
        };
        let client = McpClient::new(config.clone());

        let tools = tauri::async_runtime::block_on(client.list_tools())
            .expect("persistent stdio tool discovery should succeed");
        let session_description = tools[0].description.clone();
        let expected_session_id = session_description
            .strip_prefix("session:")
            .expect("description should contain a persistent session id");

        let first = tauri::async_runtime::block_on(
            client.call_tool("echo", &json!({ "message": "hello-1" })),
        )
        .expect("first persistent stdio call should succeed");
        let second = tauri::async_runtime::block_on(
            client.call_tool("echo", &json!({ "message": "hello-2" })),
        )
        .expect("second persistent stdio call should succeed");

        assert_eq!(first["sessionId"], json!(expected_session_id));
        assert_eq!(second["sessionId"], json!(expected_session_id));
        assert_eq!(second["arguments"]["message"], json!("hello-2"));

        super::drop_stdio_session(&super::stdio_session_key(&config));
        fs::remove_file(script_path).expect("persistent mock stdio script should clean up");
    }
}
