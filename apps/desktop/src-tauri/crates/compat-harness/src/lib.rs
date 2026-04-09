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
                PermissionPromptDecision::Deny {
                    reason: "n".into(),
                }
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
        let root = std::env::temp_dir().join(format!("relay-parity-bash-ro-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".claw")).expect("claw dir");
        std::fs::write(
            root.join(".claw/settings.json"),
            r#"{"permissionMode":"read-only"}"#,
        )
        .expect("settings");
        let _guard = BashConfigCwdGuard::set(Some(root.clone()));
        let err = execute_tool("bash", &json!({ "command": "rm -f x.txt" })).expect_err("rm blocked");
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
        assert!(
            glob.contains("a.rs") || glob.contains("numFiles"),
            "{glob}"
        );
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

        let read_out = execute_tool(
            "read_file",
            &json!({ "path": fixture.to_string_lossy() }),
        )
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
        let out = execute_tool("bash", &json!({ "command": "printf 'parity-bash'" }))
            .expect("bash echo");
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
        let err = execute_tool("bash", &json!({ "command": "sudo ls /" })).expect_err("sudo blocked");
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
