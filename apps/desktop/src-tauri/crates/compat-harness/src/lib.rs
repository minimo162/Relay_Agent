//! Claw-code mock parity–style tests and vendored [`mock_parity_scenarios.json`](fixtures/mock_parity_scenarios.json).
//! Sync the fixture with ultraworkers/claw-code `rust/mock_parity_scenarios.json` when refreshing the upstream pin
//! (see `docs/CLAW_CODE_ALIGNMENT.md`).

#[cfg(test)]
mod mock_parity_manifest {
    use serde_json::Value;

    const FIXTURE: &str = include_str!("../fixtures/mock_parity_scenarios.json");

    /// Must match [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) `rust/mock_parity_scenarios.json` array order.
    const EXPECTED_SCENARIO_NAMES: &[&str] = &[
        "streaming_text",
        "read_file_roundtrip",
        "grep_chunk_assembly",
        "write_file_allowed",
        "write_file_denied",
        "multi_tool_turn_roundtrip",
        "bash_stdout_roundtrip",
        "bash_permission_prompt_approved",
        "bash_permission_prompt_denied",
        "plugin_tool_roundtrip",
        "auto_compact_triggered",
        "token_cost_reporting",
    ];

    #[test]
    fn mock_parity_scenario_manifest_matches_claw_canonical_order() {
        let entries: Vec<Value> = serde_json::from_str(FIXTURE).expect("fixture JSON");
        let names: Vec<String> = entries
            .iter()
            .map(|e| {
                e.get("name")
                    .and_then(Value::as_str)
                    .expect("scenario name")
                    .to_string()
            })
            .collect();
        let expected: Vec<String> = EXPECTED_SCENARIO_NAMES
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        assert_eq!(
            names, expected,
            "update fixtures/mock_parity_scenarios.json and EXPECTED_SCENARIO_NAMES from claw-code rust/mock_parity_scenarios.json"
        );
    }
}

/// Deterministic scenarios inspired by claw-code mock parity (tool + permission + workspace).
#[cfg(test)]
mod parity_style {
    use std::fs;

    use runtime::{
        assert_path_in_workspace, BashConfigCwdGuard, PermissionMode, PermissionOutcome,
        PermissionPolicy, PermissionPromptDecision, PermissionPrompter, PermissionRequest,
    };
    use serde_json::json;
    use tools::execute_tool;

    #[test]
    fn read_file_roundtrip_under_temp_workspace() {
        let dir = std::env::temp_dir().join(format!("relay-parity-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("hello.txt");
        fs::write(&f, "parity").unwrap();
        let v = json!({ "path": f.to_string_lossy() });
        let out = execute_tool("read_file", &v).expect("read_file");
        assert!(out.contains("parity"), "{out}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_file_denied_under_read_only_policy() {
        let policy = PermissionPolicy::new(PermissionMode::ReadOnly)
            .with_tool_requirement("write_file", PermissionMode::WorkspaceWrite);
        assert!(matches!(
            policy.authorize("write_file", "{}", None),
            PermissionOutcome::Deny { .. }
        ));
    }

    #[test]
    fn bash_escalation_prompts_under_workspace_write_policy() {
        let policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite)
            .with_tool_requirement("bash", PermissionMode::DangerFullAccess);
        struct AllowPrompter;
        impl PermissionPrompter for AllowPrompter {
            fn decide(&mut self, _request: &PermissionRequest) -> PermissionPromptDecision {
                PermissionPromptDecision::Allow
            }
        }
        let mut p = AllowPrompter;
        assert_eq!(
            policy.authorize("bash", r#"{"command":"echo hi"}"#, Some(&mut p)),
            PermissionOutcome::Allow
        );
    }

    /// claw `mock_parity_scenarios.json`: `bash_permission_prompt_denied` (policy layer; no interactive stdin in tests).
    #[test]
    fn bash_permission_prompt_denied_under_workspace_write_policy() {
        let policy = PermissionPolicy::new(PermissionMode::WorkspaceWrite)
            .with_tool_requirement("bash", PermissionMode::DangerFullAccess);
        struct DenyPrompter;
        impl PermissionPrompter for DenyPrompter {
            fn decide(&mut self, _request: &PermissionRequest) -> PermissionPromptDecision {
                PermissionPromptDecision::Deny { reason: "n".into() }
            }
        }
        let mut p = DenyPrompter;
        assert!(matches!(
            policy.authorize("bash", r#"{"command":"echo nope"}"#, Some(&mut p)),
            PermissionOutcome::Deny { .. }
        ));
    }

    #[test]
    fn workspace_boundary_rejects_outside_path() {
        let dir = std::env::temp_dir().join(format!("relay-ws-parity-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let outside = dir
            .parent()
            .expect("parent")
            .join("relay_ws_outside_probe.txt");
        let err = assert_path_in_workspace(&outside, &dir).expect_err("outside workspace");
        assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bash_read_only_project_rejects_rm_via_execute_tool() {
        let root =
            std::env::temp_dir().join(format!("relay-parity-bash-ro-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".claw")).expect("claw dir");
        std::fs::write(
            root.join(".claw/settings.json"),
            r#"{"permissionMode":"read-only"}"#,
        )
        .expect("settings");
        let _guard = BashConfigCwdGuard::set(Some(root.clone()));
        let err =
            execute_tool("bash", &json!({ "command": "rm -f x.txt" })).expect_err("rm blocked");
        assert!(
            err.to_ascii_lowercase().contains("read-only")
                || err.to_ascii_lowercase().contains("permission")
                || err.to_ascii_lowercase().contains("denylist"),
            "{err}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn glob_and_read_multi_step_style() {
        let dir = std::env::temp_dir().join(format!("relay-multi-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.rs"), "fn x() {}").unwrap();
        let glob = execute_tool(
            "glob_search",
            &json!({
                "pattern": "*.rs",
                "path": dir.to_string_lossy(),
            }),
        )
        .expect("glob");
        assert!(glob.contains("a.rs") || glob.contains("numFiles"), "{glob}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// claw `mock_parity_scenarios.json`: `write_file_allowed`
    #[test]
    fn write_file_allowed_under_temp_workspace() {
        let dir = std::env::temp_dir().join(format!("relay-write-parity-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("out.txt");
        let v = json!({
            "path": f.to_string_lossy(),
            "content": "parity-write-ok\n",
        });
        let out = execute_tool("write_file", &v).expect("write_file");
        assert!(
            out.contains("parity-write-ok") || out.contains("create") || out.contains("update"),
            "{out}"
        );
        assert_eq!(fs::read_to_string(&f).unwrap(), "parity-write-ok\n");
        let _ = fs::remove_dir_all(&dir);
    }

    /// claw `mock_parity_scenarios.json`: `grep_chunk_assembly` — count mode (mock harness expects 2 "parity" hits in fixture.txt).
    #[test]
    fn grep_search_count_mode_finds_expected_matches() {
        let dir = std::env::temp_dir().join(format!("relay-grep-count-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("fixture.txt"),
            "alpha parity line\nbeta line\ngamma parity line\n",
        )
        .unwrap();
        let out = execute_tool(
            "grep_search",
            &json!({
                "pattern": "parity",
                "path": dir.join("fixture.txt").to_string_lossy(),
                "output_mode": "count",
            }),
        )
        .expect("grep_search");
        assert!(
            out.contains("\"numMatches\":2") || out.contains(r#""numMatches": 2"#),
            "expected 2 matches in count output: {out}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// claw `mock_parity_scenarios.json`: `grep_chunk_assembly` (content mode)
    #[test]
    fn grep_search_finds_match_in_workspace_file() {
        let dir = std::env::temp_dir().join(format!("relay-grep-parity-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("needle.rs"), "fn find_me() {}\n").unwrap();
        let out = execute_tool(
            "grep_search",
            &json!({
                "pattern": "find_me",
                "path": dir.to_string_lossy(),
                "glob": "**/*.rs",
                "output_mode": "content",
            }),
        )
        .expect("grep_search");
        assert!(out.contains("find_me"), "{out}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// claw `mock_parity_scenarios.json`: `multi_tool_turn_roundtrip` — behavioral: read_file then grep_search in one workspace.
    #[test]
    fn multi_tool_read_file_then_grep_in_same_workspace() {
        let dir =
            std::env::temp_dir().join(format!("relay-multi-tool-parity-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let fixture = dir.join("fixture.txt");
        fs::write(
            &fixture,
            "alpha parity line\nbeta line\ngamma parity line\n",
        )
        .unwrap();

        let read_out = execute_tool("read_file", &json!({ "path": fixture.to_string_lossy() }))
            .expect("read_file");
        assert!(read_out.contains("alpha parity line"), "{read_out}");

        let grep_out = execute_tool(
            "grep_search",
            &json!({
                "pattern": "parity",
                "path": fixture.to_string_lossy(),
                "output_mode": "count",
            }),
        )
        .expect("grep_search");
        assert!(
            grep_out.contains("\"numMatches\":2") || grep_out.contains(r#""numMatches": 2"#),
            "{grep_out}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// claw `mock_parity_scenarios.json`: `bash_stdout_roundtrip` (workspace-write still allows non-destructive echo).
    #[test]
    fn bash_stdout_roundtrip_echo() {
        let root = std::env::temp_dir().join(format!("relay-bash-parity-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".claw")).unwrap();
        fs::write(
            root.join(".claw/settings.json"),
            r#"{"permissionMode":"workspace-write"}"#,
        )
        .unwrap();
        let _guard = BashConfigCwdGuard::set(Some(root.clone()));
        let out =
            execute_tool("bash", &json!({ "command": "printf 'parity-bash'" })).expect("bash echo");
        assert!(out.contains("parity-bash"), "{out}");
        let _ = fs::remove_dir_all(&root);
    }

    /// Same scenario with claw CLI `danger-full-access` permission mode string.
    #[test]
    fn bash_stdout_roundtrip_echo_danger_full_access() {
        let root = std::env::temp_dir().join(format!("relay-bash-dfa-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".claw")).unwrap();
        fs::write(
            root.join(".claw/settings.json"),
            r#"{"permissionMode":"danger-full-access"}"#,
        )
        .unwrap();
        let _guard = BashConfigCwdGuard::set(Some(root.clone()));
        let out = execute_tool("bash", &json!({ "command": "printf 'parity-bash-dfa'" }))
            .expect("bash echo");
        assert!(out.contains("parity-bash-dfa"), "{out}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn bash_hard_denylist_blocks_sudo_even_when_workspace_write() {
        let root = std::env::temp_dir().join(format!("relay-bash-deny-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".claw")).unwrap();
        fs::write(
            root.join(".claw/settings.json"),
            r#"{"permissionMode":"workspace-write"}"#,
        )
        .unwrap();
        let _guard = BashConfigCwdGuard::set(Some(root.clone()));
        let err =
            execute_tool("bash", &json!({ "command": "sudo ls /" })).expect_err("sudo blocked");
        assert!(
            err.to_ascii_lowercase().contains("denylist"),
            "unexpected err: {err}"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn read_file_hard_denylist_blocks_dot_env() {
        let dir = std::env::temp_dir().join(format!("relay-env-deny-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join(".env.local");
        fs::write(&f, "SECRET=x\n").unwrap();
        let err = execute_tool("read_file", &json!({ "path": f.to_string_lossy() }))
            .expect_err(".env blocked");
        assert!(
            err.to_ascii_lowercase().contains("denylist")
                || err.to_ascii_lowercase().contains(".env"),
            "{err}"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}

// The full-session harness links `relay_agent_desktop_lib`, which is the
// Tauri cdylib. On Windows CI runners the WebView2 / Win32 DLLs it depends
// on are unavailable and the test binary fails to load with
// STATUS_ENTRYPOINT_NOT_FOUND before any test runs. Cargo.toml already
// platform-gates the dev-dep, so match it on the consumer side.
#[cfg(all(test, not(windows)))]
mod full_session_harness {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use relay_agent_desktop_lib::test_support::{create_test_app, run_agent_loop_smoke};

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("{label}-{nanos}"));
        fs::create_dir_all(&root).expect("create temp dir");
        root
    }

    #[test]
    fn streaming_text_full_session_harness_matches_desktop_event_flow() {
        let app = create_test_app();
        let root = temp_dir("relay-compat-streaming");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");

        let summary = runtime.block_on(run_agent_loop_smoke(
            app.handle().clone(),
            Some(root.clone()),
        ));

        assert_eq!(summary.status, "ok", "{summary:?}");
        assert!(summary.text_delta_count > 1, "{summary:?}");
        assert!(
            summary.first_stream_at_ms.zip(summary.completion_event_at_ms).is_some_and(
                |(first_stream_at_ms, completion_event_at_ms)| first_stream_at_ms < completion_event_at_ms
            ),
            "{summary:?}"
        );
        assert!(summary.tool_start_count > 0, "{summary:?}");
        assert!(summary.approval_seen, "{summary:?}");
        assert_eq!(summary.final_stop_reason.as_deref(), Some("completed"));

        let _ = fs::remove_dir_all(root);
    }
}

#[cfg(test)]
mod missing_scenarios {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use runtime::{
        mcp_tool_name, ApiClient, ApiRequest, AssistantEvent, AutoCompactionEvent,
        ConfigSource, ContentBlock, ConversationRuntime, McpServerConfig, McpServerManager,
        McpStdioServerConfig, MessageRole, PermissionMode, PermissionPolicy, ScopedMcpServerConfig,
        Session, StaticToolExecutor, TokenUsage, UsageTracker,
    };
    use serde_json::json;

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("compat-harness-{nanos}"));
        fs::create_dir_all(&root).expect("temp dir");
        root
    }

    fn write_manager_mcp_server_script() -> PathBuf {
        let root = temp_dir();
        let script_path = root.join("manager-mcp-server.py");
        let script = [
            "#!/usr/bin/env python3",
            "import json, os, sys",
            "LABEL = os.environ.get('MCP_SERVER_LABEL', 'server')",
            "def read_message():",
            "    header = b''",
            r"    while not header.endswith(b'\r\n\r\n'):",
            "        chunk = sys.stdin.buffer.read(1)",
            "        if not chunk:",
            "            return None",
            "        header += chunk",
            "    length = 0",
            r"    for line in header.decode().split('\r\n'):",
            r"        if line.lower().startswith('content-length:'):",
            r"            length = int(line.split(':', 1)[1].strip())",
            "    payload = sys.stdin.buffer.read(length)",
            "    return json.loads(payload.decode())",
            "def send_message(message):",
            "    payload = json.dumps(message).encode()",
            r"    sys.stdout.buffer.write(f'Content-Length: {len(payload)}\r\n\r\n'.encode() + payload)",
            "    sys.stdout.buffer.flush()",
            "while True:",
            "    request = read_message()",
            "    if request is None:",
            "        break",
            "    method = request['method']",
            "    if method == 'initialize':",
            "        send_message({",
            "            'jsonrpc': '2.0',",
            "            'id': request['id'],",
            "            'result': {",
            "                'protocolVersion': request['params']['protocolVersion'],",
            "                'capabilities': {'tools': {}},",
            "                'serverInfo': {'name': LABEL, 'version': '1.0.0'}",
            "            }",
            "        })",
            "    elif method == 'tools/list':",
            "        send_message({",
            "            'jsonrpc': '2.0',",
            "            'id': request['id'],",
            "            'result': {",
            "                'tools': [{",
            "                    'name': 'echo',",
            "                    'description': f'Echo tool for {LABEL}',",
            "                    'inputSchema': {'type': 'object', 'properties': {'text': {'type': 'string'}}, 'required': ['text']}",
            "                }]",
            "            }",
            "        })",
            "    elif method == 'tools/call':",
            "        args = request['params'].get('arguments') or {}",
            "        text = args.get('text', '')",
            "        send_message({",
            "            'jsonrpc': '2.0',",
            "            'id': request['id'],",
            "            'result': {",
            "                'content': [{'type': 'text', 'text': f'{LABEL}:{text}'}],",
            "                'structuredContent': {'server': LABEL, 'echoed': text},",
            "                'isError': False",
            "            }",
            "        })",
            "    else:",
            "        send_message({",
            "            'jsonrpc': '2.0',",
            "            'id': request['id'],",
            "            'error': {'code': -32601, 'message': f'unknown method: {method}'},",
            "        })",
        ]
        .join("\n");
        fs::write(&script_path, script).expect("write script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(&script_path).expect("metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script_path, permissions).expect("chmod");
        }
        script_path
    }

    fn cleanup_script(script_path: &Path) {
        fs::remove_file(script_path).expect("cleanup script");
        fs::remove_dir_all(script_path.parent().expect("script parent")).expect("cleanup dir");
    }

    fn manager_server_config(script_path: &Path, label: &str) -> ScopedMcpServerConfig {
        ScopedMcpServerConfig {
            scope: ConfigSource::Local,
            config: McpServerConfig::Stdio(McpStdioServerConfig {
                command: "python3".to_string(),
                args: vec![script_path.to_string_lossy().into_owned()],
                env: BTreeMap::from([(
                    "MCP_SERVER_LABEL".to_string(),
                    label.to_string(),
                )]),
            }),
        }
    }

    #[test]
    fn plugin_tool_roundtrip_via_fake_stdio_server() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let script_path = write_manager_mcp_server_script();
            let servers = BTreeMap::from([(
                "alpha".to_string(),
                manager_server_config(&script_path, "alpha"),
            )]);
            let mut manager = McpServerManager::from_servers(&servers);

            manager.discover_tools().await.expect("discover tools");
            let response = manager
                .call_tool(
                    &mcp_tool_name("alpha", "echo"),
                    Some(json!({ "text": "roundtrip" })),
                )
                .await
                .expect("call tool");

            assert_eq!(
                response
                    .result
                    .as_ref()
                    .and_then(|result| result.structured_content.as_ref())
                    .and_then(|value| value.get("echoed")),
                Some(&json!("roundtrip"))
            );

            manager.shutdown().await.expect("shutdown");
            cleanup_script(&script_path);
        });
    }

    #[test]
    fn auto_compact_triggered_matches_runtime_defaults() {
        struct SimpleApi;
        impl ApiClient for SimpleApi {
            fn stream(
                &mut self,
                _request: &ApiRequest<'_>,
            ) -> Result<Vec<AssistantEvent>, runtime::RuntimeError> {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::Usage(TokenUsage {
                        input_tokens: 120_000,
                        output_tokens: 4,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0,
                    }),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let session = Session {
            version: 1,
            messages: vec![
                runtime::ConversationMessage::user_text("one"),
                runtime::ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "two".to_string(),
                }]),
                runtime::ConversationMessage::user_text("three"),
                runtime::ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "four".to_string(),
                }]),
            ],
        };

        let mut runtime = ConversationRuntime::new(
            session,
            SimpleApi,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::DangerFullAccess),
            vec!["system".to_string()],
        )
        .with_auto_compaction_input_tokens_threshold(100_000);

        let summary = runtime.run_turn("trigger", None).expect("turn should succeed");

        assert_eq!(
            summary.auto_compaction,
            Some(AutoCompactionEvent {
                removed_message_count: 1,
            })
        );
        assert_eq!(runtime.session().messages[0].role, MessageRole::System);
    }

    #[test]
    fn token_cost_reporting_tracks_cumulative_usage() {
        let mut tracker = UsageTracker::default();
        tracker.record(TokenUsage {
            input_tokens: 10,
            output_tokens: 4,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 1,
        });
        tracker.record(TokenUsage {
            input_tokens: 20,
            output_tokens: 6,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 2,
        });

        let usage = tracker.cumulative_usage();
        let lines = usage.summary_lines_for_model("usage", Some("claude-sonnet-4-20250514"));

        assert_eq!(usage.total_tokens(), 48);
        assert!(lines[0].contains("estimated_cost="), "{lines:?}");
        assert!(lines[0].contains("model=claude-sonnet-4-20250514"), "{lines:?}");
    }
}
