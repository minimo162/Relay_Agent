pub mod catalog {
    use serde_json::{json, Value};

    const MVP_TOOL_NAMES: &[&str] = &[
        "invalid",
        "bash",
        "read",
        "write",
        "edit",
        "glob",
        "grep",
        "task",
        "webfetch",
        "todowrite",
        "websearch",
        "codesearch",
        "skill",
        "apply_patch",
        "question",
        "lsp",
    ];

    const CDP_TOOL_NAMES: &[&str] = &[
        "read",
        "write",
        "edit",
        "glob",
        "grep",
        "webfetch",
        "websearch",
        "codesearch",
        "task",
        "question",
        "todowrite",
        "skill",
        "apply_patch",
        "lsp",
        "bash",
    ];

    #[derive(Debug, Clone, PartialEq)]
    pub struct CdpPromptToolSpec {
        pub name: &'static str,
        pub purpose: &'static str,
        pub use_when: &'static str,
        pub avoid_when: &'static str,
        pub required_args: Vec<String>,
        pub important_optional_args: Vec<String>,
        pub example: Value,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub enum OpencodeToolPermissionMode {
        ReadOnly,
        WorkspaceWrite,
        DangerFullAccess,
        Prompt,
        Allow,
    }

    impl OpencodeToolPermissionMode {
        #[must_use]
        pub fn as_str(self) -> &'static str {
            match self {
                Self::ReadOnly => "read-only",
                Self::WorkspaceWrite => "workspace-write",
                Self::DangerFullAccess => "danger-full-access",
                Self::Prompt => "prompt",
                Self::Allow => "allow",
            }
        }

        #[must_use]
        pub fn from_permission_label(value: &str) -> Self {
            match value {
                "read-only" => Self::ReadOnly,
                "workspace-write" => Self::WorkspaceWrite,
                "prompt" => Self::Prompt,
                "allow" => Self::Allow,
                _ => Self::DangerFullAccess,
            }
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct OpencodeToolPermissionRequirement {
        pub name: &'static str,
        pub required_permission: OpencodeToolPermissionMode,
    }

    #[must_use]
    pub fn desktop_tool_permission_requirements() -> Vec<OpencodeToolPermissionRequirement> {
        MVP_TOOL_NAMES
            .iter()
            .map(|name| OpencodeToolPermissionRequirement {
                name,
                required_permission: OpencodeToolPermissionMode::ReadOnly,
            })
            .collect()
    }

    #[must_use]
    pub fn mvp_tool_names() -> Vec<&'static str> {
        MVP_TOOL_NAMES.to_vec()
    }

    #[must_use]
    pub fn cdp_prompt_tool_specs() -> Vec<CdpPromptToolSpec> {
        CDP_TOOL_NAMES
            .iter()
            .copied()
            .map(cdp_prompt_tool_spec)
            .collect()
    }

    #[must_use]
    pub fn cdp_json_fence_tool_names() -> Vec<&'static str> {
        CDP_TOOL_NAMES.to_vec()
    }

    fn cdp_prompt_tool_spec(name: &'static str) -> CdpPromptToolSpec {
        CdpPromptToolSpec {
            name,
            purpose: cdp_tool_purpose(name),
            use_when: cdp_tool_use_when(name),
            avoid_when: cdp_tool_avoid_when(name),
            required_args: cdp_required_args(name),
            important_optional_args: cdp_important_optional_args(name),
            example: cdp_tool_example(name),
        }
    }

    fn cdp_required_args(name: &str) -> Vec<String> {
        match name {
            "bash" => vec!["command", "description"],
            "read" => vec!["filePath"],
            "write" => vec!["filePath", "content"],
            "edit" => vec!["filePath", "oldString", "newString"],
            "glob" | "grep" => vec!["pattern"],
            "task" => vec!["description", "prompt"],
            "webfetch" => vec!["url"],
            "todowrite" => vec!["todos"],
            "websearch" | "codesearch" => vec!["query"],
            "skill" => vec!["name"],
            "apply_patch" => vec!["patchText"],
            "question" => vec!["questions"],
            "lsp" => vec!["action", "path"],
            _ => Vec::new(),
        }
        .into_iter()
        .map(ToString::to_string)
        .collect()
    }

    fn cdp_important_optional_args(name: &str) -> Vec<String> {
        match name {
            "read" => vec!["offset", "limit"],
            "glob" => vec!["path"],
            "grep" => vec!["path", "include"],
            "websearch" => vec!["allowed_domains", "blocked_domains"],
            "webfetch" => vec!["format", "timeout"],
            "edit" => vec!["replaceAll"],
            "bash" => vec!["timeout", "workdir"],
            "task" => vec!["subagent_type"],
            _ => Vec::new(),
        }
        .into_iter()
        .map(ToString::to_string)
        .collect()
    }

    fn cdp_tool_example(name: &str) -> Value {
        match name {
            "read" => {
                json!({"name":"read","relay_tool_call":true,"input":{"filePath":"src/main.rs"}})
            }
            "write" => {
                json!({"name":"write","relay_tool_call":true,"input":{"filePath":"notes.txt","content":"hello\n"}})
            }
            "edit" => {
                json!({"name":"edit","relay_tool_call":true,"input":{"filePath":"src/main.rs","oldString":"foo","newString":"bar"}})
            }
            "glob" => {
                json!({"name":"glob","relay_tool_call":true,"input":{"pattern":"src/**/*.rs"}})
            }
            "grep" => {
                json!({"name":"grep","relay_tool_call":true,"input":{"pattern":"TODO","path":"src","include":"*.rs"}})
            }
            "webfetch" => {
                json!({"name":"webfetch","relay_tool_call":true,"input":{"url":"https://example.com","format":"markdown"}})
            }
            "websearch" => {
                json!({"name":"websearch","relay_tool_call":true,"input":{"query":"rust tauri latest stable release"}})
            }
            "codesearch" => {
                json!({"name":"codesearch","relay_tool_call":true,"input":{"query":"tool registry"}})
            }
            "task" => {
                json!({"name":"task","relay_tool_call":true,"input":{"description":"Investigate parser behavior","prompt":"Find the parser entrypoint and summarize the required change."}})
            }
            "question" => {
                json!({"name":"question","relay_tool_call":true,"input":{"questions":[{"question":"Which config file should I update?","options":["package.json","Cargo.toml"]}]}})
            }
            "todowrite" => {
                json!({"name":"todowrite","relay_tool_call":true,"input":{"todos":[{"content":"Implement parser change","status":"in_progress","priority":"medium"}]}})
            }
            "skill" => {
                json!({"name":"skill","relay_tool_call":true,"input":{"name":"openai-docs"}})
            }
            "apply_patch" => {
                json!({"name":"apply_patch","relay_tool_call":true,"input":{"patchText":"*** Begin Patch\n*** End Patch\n"}})
            }
            "lsp" => {
                json!({"name":"lsp","relay_tool_call":true,"input":{"action":"diagnostics","path":"src/main.rs"}})
            }
            "bash" => {
                json!({"name":"bash","relay_tool_call":true,"input":{"command":"cargo test","description":"Run the targeted test suite"}})
            }
            _ => json!({"name":name,"relay_tool_call":true,"input":{}}),
        }
    }

    fn cdp_tool_purpose(name: &str) -> &'static str {
        match name {
            "read" => "Read a file or directory from the local filesystem.",
            "write" => "Create or overwrite a workspace text file when the final content is known.",
            "edit" => "Apply a targeted replacement inside an existing workspace file.",
            "glob" => "Fast file pattern matching that works with any codebase size.",
            "grep" => "Fast content search over plaintext/code files.",
            "webfetch" => "Read one known URL and return content through opencode.",
            "websearch" => "Look up current external information on the web through opencode.",
            "codesearch" => "Search code through opencode.",
            "task" => "Delegate work to an opencode subagent.",
            "question" => "Ask the user for a required decision through opencode.",
            "todowrite" => "Track a multi-step task in the session todo list through opencode.",
            "skill" => "Load a local skill with specialized instructions through opencode.",
            "apply_patch" => "Apply a patch through opencode.",
            "lsp" => "Request supported language-server diagnostics through opencode.",
            "bash" => {
                "Run a sandboxed shell command only when file or built-in tools do not apply."
            }
            _ => "Use an OpenCode tool.",
        }
    }

    fn cdp_tool_use_when(name: &str) -> &'static str {
        match name {
            "read" => "Use an absolute filePath. If unsure of the path, use glob first. Directories return entries; files return numbered lines.",
            "write" => "Use when creating a new target file or replacing a file with fully known content.",
            "edit" => "Use after reading the file when you need a targeted text replacement.",
            "glob" => "Use when you need to find files by name patterns such as `**/*.js` or `src/**/*.ts`. You may call multiple useful search tools in one response.",
            "grep" => "Use when you need to find plaintext/code files containing a regex pattern. Filter files with `include` such as `*.js` or `*.{ts,tsx}`. For Office/PDF documents, use glob to find candidates, then read exact files.",
            "webfetch" => "Use when the user or local files already gave you a specific URL to inspect.",
            "websearch" => "Use when the answer depends on current external information that is not in the workspace.",
            "codesearch" => "Use when semantic or remote code search is available in the opencode runtime.",
            "task" => "Use for bounded subagent work that can run outside the main thread.",
            "question" => "Use only when essential ambiguity remains after local inspection.",
            "todowrite" => "Use to keep a real multi-step implementation organized while you keep taking action.",
            "skill" => "Use when the task matches a known local skill and its instructions will materially help.",
            "apply_patch" => "Use when the model provides a full patch and patch application is preferable to edit/write.",
            "lsp" => "Use when supported diagnostics are relevant to the current file.",
            "bash" => "Use for commands like tests, builds, or git inspection when a file tool does not apply.",
            _ => "Use when the user's request clearly requires this tool.",
        }
    }

    fn cdp_tool_avoid_when(name: &str) -> &'static str {
        match name {
            "read" => "Avoid using bash or PowerShell for file reads when `read` applies.",
            "write" => "Avoid for incremental edits to an existing file; prefer `edit` after `read`.",
            "edit" => "Avoid when the file does not exist or when replacing the full file would be simpler.",
            "glob" => "Avoid for content search; use grep for plaintext/code contents.",
            "grep" => "Avoid for filename-only lookup; use glob there. Avoid Office/PDF container search; use glob plus read. For exact match counts, use bash with rg directly when that exact count is required.",
            "webfetch" => "Avoid for vague discovery tasks; use `websearch` if you do not already have a URL.",
            "websearch" => "Avoid when the workspace or a known URL already contains the needed answer.",
            "codesearch" => "Avoid when local grep/glob can answer more directly.",
            "task" => "Avoid for immediate blocking work that should be done in the current thread.",
            "question" => "Avoid asking the user to restate a task that is already concrete in the latest turn.",
            "todowrite" => "Avoid using it as a substitute for taking the next concrete action.",
            "skill" => "Avoid loading unrelated skills just because they exist.",
            "apply_patch" => "Avoid for small targeted replacements where edit is clearer.",
            "lsp" => "Avoid unsupported actions or generic code inspection that normal file tools already cover.",
            "bash" => "Avoid for local file I/O when `read`, `write`, `edit`, or PDF tools apply.",
            _ => "Avoid when a more specific Relay tool already fits the task.",
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn cdp_prompt_tool_specs_are_local_dtos() {
            let specs = cdp_prompt_tool_specs();
            let write = specs
                .iter()
                .find(|spec| spec.name == "write")
                .expect("write spec");

            assert!(!write.purpose.is_empty());
            assert!(write.required_args.iter().any(|arg| arg == "filePath"));
            assert!(write.example.is_object());
        }

        #[test]
        fn permission_labels_are_local_dtos() {
            let requirements = desktop_tool_permission_requirements();

            assert!(requirements.iter().any(|requirement| {
                requirement.name == "read"
                    && requirement.required_permission == OpencodeToolPermissionMode::ReadOnly
            }));
            assert_eq!(
                OpencodeToolPermissionMode::WorkspaceWrite.as_str(),
                "workspace-write"
            );
        }
    }
}
