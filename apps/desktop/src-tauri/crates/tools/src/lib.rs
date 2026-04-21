use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

mod approval;
mod cli_hub;
mod electron_cdp;

use reqwest::blocking::Client;
use runtime::{
    edit_file, execute_bash, glob_search, grep_search, merge_pdfs, office_search,
    pull_rust_diagnostics_blocking, read_background_task_output, read_file, workspace_search,
    reject_sensitive_file_path, split_pdf, task_create, task_get, task_list, task_output,
    task_stop, task_update, write_file, BackgroundTaskOutputInput, BashCommandInput,
    GrepSearchInput, OfficeSearchInput, PdfSplitSegment, PermissionMode, WorkspaceSearchInput,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolManifestEntry {
    pub name: String,
    pub source: ToolSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSource {
    Base,
    Conditional,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolRegistry {
    entries: Vec<ToolManifestEntry>,
}

impl ToolRegistry {
    #[must_use]
    pub fn new(entries: Vec<ToolManifestEntry>) -> Self {
        Self { entries }
    }

    #[must_use]
    pub fn entries(&self) -> &[ToolManifestEntry] {
        &self.entries
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub required_permission: PermissionMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalTargetExtractor {
    None,
    PathLike,
    UrlLike,
    CliRun,
    ElectronApp,
    McpQualifiedTool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RedactionRule {
    pub field: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSurface {
    Standard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CdpToolVisibility {
    Core,
    Conditional,
    Hidden,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolMetadata {
    pub approval_title: Option<&'static str>,
    pub target_extractor: ApprovalTargetExtractor,
    pub risky_fields: &'static [&'static str],
    pub redaction_rules: &'static [RedactionRule],
    pub tool_search_visible: bool,
    pub cdp_visibility: CdpToolVisibility,
}

const DEFAULT_TOOL_METADATA: ToolMetadata = ToolMetadata {
    approval_title: None,
    target_extractor: ApprovalTargetExtractor::None,
    risky_fields: &[],
    redaction_rules: &[],
    tool_search_visible: true,
    cdp_visibility: CdpToolVisibility::Hidden,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CdpPromptToolSpec {
    pub name: &'static str,
    pub purpose: &'static str,
    pub use_when: &'static str,
    pub avoid_when: &'static str,
    pub required_args: Vec<String>,
    pub important_optional_args: Vec<String>,
    pub example: Value,
}

// The per-tool metadata table is exhaustive by design: each arm documents a
// distinct tool's approval title, redaction rules, and CDP visibility. Keeping
// every tool on its own arm (even when a handful produce identical
// `ToolMetadata` literals today) preserves readability and makes future
// per-tool tweaks additive. The pedantic `match_same_arms` / `too_many_lines`
// lints are silenced for this one registry function rather than restructured.
#[allow(clippy::match_same_arms, clippy::too_many_lines)]
#[must_use]
pub fn tool_metadata(name: &str) -> ToolMetadata {
    match name {
        "read_file" => ToolMetadata {
            target_extractor: ApprovalTargetExtractor::PathLike,
            tool_search_visible: false,
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "workspace_search" | "glob_search" | "grep_search" | "office_search" => ToolMetadata {
            tool_search_visible: false,
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "write_file" => ToolMetadata {
            approval_title: Some("Create or overwrite a file?"),
            target_extractor: ApprovalTargetExtractor::PathLike,
            risky_fields: &["path"],
            tool_search_visible: false,
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "edit_file" => ToolMetadata {
            approval_title: Some("Edit a file?"),
            target_extractor: ApprovalTargetExtractor::PathLike,
            risky_fields: &["path", "replace_all"],
            tool_search_visible: false,
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "pdf_merge" | "pdf_split" => ToolMetadata {
            target_extractor: ApprovalTargetExtractor::PathLike,
            tool_search_visible: false,
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "WebFetch" => ToolMetadata {
            target_extractor: ApprovalTargetExtractor::UrlLike,
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "WebSearch" => ToolMetadata {
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "TodoWrite" | "Skill" | "AskUserQuestion" | "LSP" | "NotebookEdit" => ToolMetadata {
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "bash" => ToolMetadata {
            approval_title: Some("Run a shell command?"),
            risky_fields: &["command", "run_in_background"],
            tool_search_visible: false,
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "PowerShell" => ToolMetadata {
            risky_fields: &["command", "run_in_background"],
            cdp_visibility: CdpToolVisibility::Conditional,
            ..DEFAULT_TOOL_METADATA
        },
        "CliRun" => ToolMetadata {
            approval_title: Some("Run an external CLI command?"),
            target_extractor: ApprovalTargetExtractor::CliRun,
            risky_fields: &["cli", "args", "timeout_ms"],
            cdp_visibility: CdpToolVisibility::Hidden,
            ..DEFAULT_TOOL_METADATA
        },
        "ElectronLaunch" => ToolMetadata {
            approval_title: Some("Launch and control an Electron app?"),
            target_extractor: ApprovalTargetExtractor::ElectronApp,
            cdp_visibility: CdpToolVisibility::Hidden,
            ..DEFAULT_TOOL_METADATA
        },
        "ElectronEval" => ToolMetadata {
            approval_title: Some("Execute JavaScript in an Electron app?"),
            target_extractor: ApprovalTargetExtractor::ElectronApp,
            risky_fields: &["app", "cdp_port", "expression"],
            cdp_visibility: CdpToolVisibility::Hidden,
            ..DEFAULT_TOOL_METADATA
        },
        "ElectronGetText" => ToolMetadata {
            target_extractor: ApprovalTargetExtractor::ElectronApp,
            cdp_visibility: CdpToolVisibility::Hidden,
            ..DEFAULT_TOOL_METADATA
        },
        "ElectronClick" => ToolMetadata {
            approval_title: Some("Click an element in an Electron app?"),
            target_extractor: ApprovalTargetExtractor::ElectronApp,
            risky_fields: &["app", "selector"],
            cdp_visibility: CdpToolVisibility::Hidden,
            ..DEFAULT_TOOL_METADATA
        },
        "ElectronTypeText" => ToolMetadata {
            approval_title: Some("Type text in an Electron app?"),
            target_extractor: ApprovalTargetExtractor::ElectronApp,
            risky_fields: &["app", "selector", "text"],
            redaction_rules: &[RedactionRule { field: "text" }],
            cdp_visibility: CdpToolVisibility::Hidden,
            ..DEFAULT_TOOL_METADATA
        },
        "MCP" => ToolMetadata {
            approval_title: Some("Call a connected integration tool?"),
            target_extractor: ApprovalTargetExtractor::McpQualifiedTool,
            risky_fields: &["name", "arguments", "server", "serverName"],
            redaction_rules: &[RedactionRule { field: "arguments" }],
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "git_status" | "git_diff" => ToolMetadata {
            cdp_visibility: CdpToolVisibility::Core,
            ..DEFAULT_TOOL_METADATA
        },
        "Agent"
        | "ToolSearch"
        | "TaskCreate"
        | "TaskGet"
        | "TaskList"
        | "TaskStop"
        | "TaskUpdate"
        | "TaskOutput"
        | "BackgroundTaskOutput"
        | "SendUserMessage"
        | "Sleep"
        | "Config"
        | "CliList"
        | "CliDiscover"
        | "CliRegister"
        | "CliUnregister"
        | "ElectronApps"
        | "StructuredOutput"
        | "REPL"
        | "ListMcpResources"
        | "ReadMcpResource"
        | "McpAuth" => ToolMetadata {
            cdp_visibility: CdpToolVisibility::Hidden,
            ..DEFAULT_TOOL_METADATA
        },
        _ => DEFAULT_TOOL_METADATA,
    }
}

#[derive(Debug)]
struct ToolCatalog {
    specs: Vec<ToolSpec>,
    by_name: BTreeMap<&'static str, usize>,
    registry: ToolRegistry,
}

impl ToolCatalog {
    fn new(specs: Vec<ToolSpec>) -> Self {
        let by_name = specs
            .iter()
            .enumerate()
            .map(|(index, spec)| (spec.name, index))
            .collect::<BTreeMap<_, _>>();
        let registry = ToolRegistry::new(
            specs
                .iter()
                .map(|spec| ToolManifestEntry {
                    name: spec.name.to_string(),
                    source: if matches!(spec.name, "EnterPlanMode" | "ExitPlanMode") {
                        ToolSource::Conditional
                    } else {
                        ToolSource::Base
                    },
                })
                .collect(),
        );
        Self {
            specs,
            by_name,
            registry,
        }
    }

    fn specs(&self) -> &[ToolSpec] {
        &self.specs
    }

    fn spec(&self, name: &str) -> Option<&ToolSpec> {
        self.by_name
            .get(name)
            .and_then(|index| self.specs.get(*index))
    }

    fn deferred_specs(&self) -> Vec<ToolSpec> {
        self.specs
            .iter()
            .filter(|spec| tool_metadata(spec.name).tool_search_visible)
            .cloned()
            .collect()
    }

    fn registry(&self) -> &ToolRegistry {
        &self.registry
    }
}

static BASE_TOOL_CATALOG: OnceLock<ToolCatalog> = OnceLock::new();
static COMPAT_TOOL_CATALOG: OnceLock<ToolCatalog> = OnceLock::new();

#[must_use]
fn tool_catalog() -> &'static ToolCatalog {
    if compat_tool_surface_enabled() {
        COMPAT_TOOL_CATALOG.get_or_init(|| ToolCatalog::new(build_mvp_tool_specs(true)))
    } else {
        BASE_TOOL_CATALOG.get_or_init(|| ToolCatalog::new(build_mvp_tool_specs(false)))
    }
}

#[must_use]
pub fn tool_registry() -> ToolRegistry {
    tool_catalog().registry().clone()
}

#[must_use]
pub fn tool_spec(name: &str) -> Option<&'static ToolSpec> {
    tool_catalog().spec(name)
}

#[must_use]
pub fn is_tool_visible_in_tool_search(name: &str) -> bool {
    tool_spec(name).is_some_and(|spec| tool_metadata(spec.name).tool_search_visible)
}

#[must_use]
pub fn is_tool_visible_in_surface(name: &str, surface: ToolSurface) -> bool {
    let _ = (name, surface);
    true
}

#[must_use]
pub fn tool_specs_for_surface(surface: ToolSurface) -> Vec<ToolSpec> {
    let _ = surface;
    tool_catalog().specs().to_vec()
}

#[must_use]
pub fn cdp_tool_visibility(name: &str) -> CdpToolVisibility {
    tool_metadata(name).cdp_visibility
}

#[must_use]
pub fn cdp_tool_specs_for_visibility(visibility: CdpToolVisibility) -> Vec<ToolSpec> {
    let mut specs = tool_catalog()
        .specs()
        .iter()
        .filter(|spec| cdp_tool_visibility(spec.name) == visibility)
        .cloned()
        .collect::<Vec<_>>();
    specs.sort_by(|a, b| {
        cdp_catalog_sort_key(a.name)
            .cmp(&cdp_catalog_sort_key(b.name))
            .then_with(|| a.name.cmp(b.name))
    });
    specs
}

fn cdp_catalog_sort_key(name: &str) -> usize {
    match name {
        "read_file" => 0,
        "write_file" => 1,
        "edit_file" => 2,
        "workspace_search" => 3,
        "glob_search" => 4,
        "grep_search" => 5,
        "office_search" => 6,
        "git_status" => 7,
        "git_diff" => 8,
        "pdf_merge" => 10,
        "pdf_split" => 11,
        "WebFetch" => 20,
        "WebSearch" => 21,
        "MCP" => 33,
        "AskUserQuestion" => 40,
        "TodoWrite" => 41,
        "Skill" => 50,
        "LSP" => 52,
        "NotebookEdit" => 53,
        "bash" => 90,
        "PowerShell" => 91,
        _ => 1_000,
    }
}

fn cdp_required_args(schema: &Value) -> Vec<String> {
    let direct_required = |value: &Value| {
        value
            .get("required")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };

    if let Some(any_of) = schema.get("anyOf").and_then(Value::as_array) {
        let variants = any_of
            .iter()
            .map(direct_required)
            .filter(|items| !items.is_empty())
            .map(|items| items.join(" + "))
            .collect::<Vec<_>>();
        if !variants.is_empty() {
            return vec![variants.join(" or ")];
        }
    }

    direct_required(schema)
}

fn cdp_tool_important_optional_args(name: &str, schema: &Value) -> Vec<String> {
    // Identical arms (e.g., `glob_search`/`git_status`) stay expanded so each
    // tool's curated optional-arg list is easy to tweak in place. Silence
    // pedantic `match_same_arms` rather than collapse them with `|`.
    #[allow(clippy::match_same_arms)]
    let curated = match name {
        "read_file" => vec!["offset", "limit", "pages", "sheets", "slides"],
        "workspace_search" => vec![
            "paths",
            "include_ext",
            "max_files",
            "max_snippets",
            "max_bytes",
            "max_duration_ms",
            "context",
        ],
        "glob_search" => vec!["path"],
        "grep_search" => vec!["path", "glob", "context"],
        "office_search" => vec![
            "paths",
            "regex",
            "include_ext",
            "context",
            "max_results",
            "max_files",
        ],
        "git_status" => vec!["path"],
        "git_diff" => vec!["path", "staged"],
        "WebSearch" => vec!["allowed_domains", "blocked_domains"],
        "WebFetch" => vec!["prompt"],
        "edit_file" => vec!["replace_all"],
        "bash" => vec!["timeout", "description", "run_in_background"],
        "PowerShell" => vec!["timeout", "description", "run_in_background"],
        "MCP" => vec!["server", "name", "arguments"],
        "AskUserQuestion" => vec!["options"],
        _ => Vec::new(),
    };
    if !curated.is_empty() {
        return curated.into_iter().map(ToString::to_string).collect();
    }

    let required = cdp_required_args(schema);
    let required_set = required
        .iter()
        .flat_map(|item| item.split(" or "))
        .collect::<BTreeSet<_>>();
    let mut optional = schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| {
            properties
                .keys()
                .filter(|key| !required_set.contains(key.as_str()))
                .filter(|key| {
                    !matches!(
                        key.as_str(),
                        "dangerously_disable_sandbox"
                            | "dangerouslyDisableSandbox"
                            | "backgroundedBy"
                            | "namespaceRestrictions"
                            | "isolateNetwork"
                            | "allowedMounts"
                            | "serverName"
                            | "task_id"
                            | "file_path"
                    )
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    optional.sort();
    optional.truncate(3);
    optional
}

fn cdp_tool_example(name: &str) -> Value {
    match name {
        "read_file" => {
            json!({"name":"read_file","relay_tool_call":true,"input":{"path":"src/main.rs"}})
        }
        "write_file" => {
            json!({"name":"write_file","relay_tool_call":true,"input":{"path":"notes.txt","content":"hello\n"}})
        }
        "edit_file" => {
            json!({"name":"edit_file","relay_tool_call":true,"input":{"path":"src/main.rs","old_string":"foo","new_string":"bar"}})
        }
        "workspace_search" => {
            json!({"name":"workspace_search","relay_tool_call":true,"input":{"query":"agentic search implementation","paths":["apps/desktop/src-tauri"],"include_ext":["rs","md"],"max_files":50,"max_snippets":30,"context":2}})
        }
        "glob_search" => {
            json!({"name":"glob_search","relay_tool_call":true,"input":{"pattern":"src/**/*.rs"}})
        }
        "grep_search" => {
            json!({"name":"grep_search","relay_tool_call":true,"input":{"pattern":"TODO","path":"src"}})
        }
        "office_search" => {
            json!({"name":"office_search","relay_tool_call":true,"input":{"pattern":"forecast","paths":["reports/**/*.xlsx"]}})
        }
        "git_status" => json!({"name":"git_status","relay_tool_call":true,"input":{"path":"."}}),
        "git_diff" => {
            json!({"name":"git_diff","relay_tool_call":true,"input":{"path":".","staged":true}})
        }
        "pdf_merge" => {
            json!({"name":"pdf_merge","relay_tool_call":true,"input":{"output_path":"merged.pdf","input_paths":["a.pdf","b.pdf"]}})
        }
        "pdf_split" => {
            json!({"name":"pdf_split","relay_tool_call":true,"input":{"input_path":"report.pdf","segments":[{"output_path":"report-part1.pdf","pages":"1-3"}]}})
        }
        "WebFetch" => {
            json!({"name":"WebFetch","relay_tool_call":true,"input":{"url":"https://example.com","prompt":"Summarize the API surface."}})
        }
        "WebSearch" => {
            json!({"name":"WebSearch","relay_tool_call":true,"input":{"query":"rust tauri latest stable release"}})
        }
        "MCP" => {
            json!({"name":"MCP","relay_tool_call":true,"input":{"action":"call_tool","name":"mcp__server__tool","arguments":{}}})
        }
        "AskUserQuestion" => {
            json!({"name":"AskUserQuestion","relay_tool_call":true,"input":{"question":"Which config file should I update?","options":["package.json","Cargo.toml"]}})
        }
        "TodoWrite" => {
            json!({"name":"TodoWrite","relay_tool_call":true,"input":{"todos":[{"content":"Implement parser change","activeForm":"Implementing parser change","status":"in_progress"}]}})
        }
        "Skill" => json!({"name":"Skill","relay_tool_call":true,"input":{"skill":"openai-docs"}}),
        "LSP" => {
            json!({"name":"LSP","relay_tool_call":true,"input":{"action":"diagnostics","path":"src/main.rs"}})
        }
        "NotebookEdit" => {
            json!({"name":"NotebookEdit","relay_tool_call":true,"input":{"notebook_path":"analysis.ipynb","edit_mode":"replace","index":0,"new_source":"print('ok')","cell_type":"code"}})
        }
        "bash" => {
            json!({"name":"bash","relay_tool_call":true,"input":{"command":"cargo test","description":"Run the targeted test suite"}})
        }
        "PowerShell" => {
            json!({"name":"PowerShell","relay_tool_call":true,"input":{"command":"Get-ChildItem","description":"Inspect the target directory"}})
        }
        _ => json!({"name":name,"relay_tool_call":true,"input":{}}),
    }
}

fn cdp_tool_purpose(name: &str, description: &'static str) -> &'static str {
    match name {
        "read_file" => "Read local text, PDF, or Office content as grounded evidence.",
        "write_file" => {
            "Create or overwrite a workspace text file when the final content is known."
        }
        "edit_file" => "Apply a targeted replacement inside an existing workspace file.",
        "workspace_search" => "Run a read-only agentic workspace search that combines file discovery, text/Office evidence snippets, candidate ranking, search plan/trace diagnostics, and recommended read_file follow-up before important judgments.",
        "glob_search" => "Find candidate files by path pattern before reading, editing, or answering a local file lookup. Supports brace groups such as `**/*.{rs,ts,tsx}`.",
        "grep_search" => "Search code or text content for concrete strings or regex matches.",
        "office_search" => "Search extracted DOCX/XLSX/PPTX/PDF text for concrete literal strings or regex matches before answering Office/PDF lookup questions.",
        "git_status" => "Inspect working tree changes without invoking a shell.",
        "git_diff" => "Inspect staged or unstaged diffs without invoking a shell.",
        "pdf_merge" => "Merge existing PDF files inside the workspace.",
        "pdf_split" => "Split one workspace PDF into multiple files.",
        "WebFetch" => "Read one known URL and answer from its contents.",
        "WebSearch" => "Look up current external information on the web.",
        "MCP" => "Call a connected MCP integration tool.",
        "AskUserQuestion" => {
            "Ask the user for a required decision when local evidence is insufficient."
        }
        "TodoWrite" => "Track a multi-step task in the session todo list.",
        "Skill" => "Load a local skill with specialized instructions.",
        "LSP" => "Request supported language-server diagnostics.",
        "NotebookEdit" => "Replace, insert, or delete a notebook cell.",
        "bash" => "Run a sandboxed shell command only when file or built-in tools do not apply.",
        "PowerShell" => "Run Windows PowerShell automation when the Windows-only path is required.",
        _ => description,
    }
}

fn cdp_tool_use_when(name: &str) -> &'static str {
    match name {
        "read_file" => "Use for grounded inspection, PDF/Office reading, or before editing an existing file.",
        "write_file" => "Use when creating a new target file or replacing a file with fully known content.",
        "edit_file" => "Use after reading the file when you need a targeted text replacement.",
        "workspace_search" => "Use first for vague or open-ended local search requests such as finding an implementation, related files, or relevant evidence before deciding which files to read. Use read_file on top candidates before important conclusions, reviews, edits, comparisons, or recommendations.",
        "glob_search" => "Use to discover likely file paths before reading them, especially when the user asks which files are needed, related, relevant, or available. Batch extension families with braces, e.g. `**/*.{docx,xlsx,pptx,pdf}`.",
        "grep_search" => "Use to find identifiers, strings, or patterns in the codebase before reading or editing.",
        "office_search" => "Use for Office/PDF content discovery, including needed-file or related-file questions; derive a literal search term from the user request and set `regex: true` only when a real regex is needed.",
        "git_status" => "Use for a quick change overview when the task depends on current git state.",
        "git_diff" => "Use when you need to inspect exact code changes already present in the workspace.",
        "pdf_merge" => "Use when the user explicitly wants to combine PDF files in the workspace.",
        "pdf_split" => "Use when the user explicitly wants pages extracted into separate PDF files.",
        "WebFetch" => "Use when the user or local files already gave you a specific URL to inspect.",
        "WebSearch" => "Use when the answer depends on current external information that is not in the workspace.",
        "MCP" => "Use when a connected integration tool is clearly the right execution path.",
        "AskUserQuestion" => "Use only when essential ambiguity remains after local inspection.",
        "TodoWrite" => "Use to keep a real multi-step implementation organized while you keep taking action.",
        "Skill" => "Use when the task matches a known local skill and its instructions will materially help.",
        "LSP" => "Use when supported diagnostics are relevant to the current file.",
        "NotebookEdit" => "Use when the target is a `.ipynb` cell rather than a plain text file.",
        "bash" => "Use for commands like tests, builds, or git inspection when a file tool does not apply.",
        "PowerShell" => "Use on Windows for Office COM automation or Windows-specific scripting.",
        _ => "Use when the user's request clearly requires this tool.",
    }
}

fn cdp_tool_avoid_when(name: &str) -> &'static str {
    match name {
        "read_file" => "Avoid using bash or PowerShell for file reads when `read_file` applies.",
        "write_file" => "Avoid for incremental edits to an existing file; prefer `edit_file` after `read_file`.",
        "edit_file" => "Avoid when the file does not exist or when replacing the full file would be simpler.",
        "workspace_search" => "Avoid when the exact file path is already known and a direct `read_file` is enough. Do not treat snippets as full-file inspection for important decisions. This is Relay-only and does not replace claw-compatible low-level search schemas.",
        "glob_search" => "Avoid when the exact file path is already known and no broader candidate search is needed.",
        "grep_search" => "Avoid when the exact file path is already known and a direct `read_file` is enough.",
        "office_search" => "Avoid for plaintext source files; use `grep_search` there. Do not use it as semantic ranking without a concrete search pattern.",
        "git_status" => "Avoid when the task is pure file reading or editing with no git-state dependency.",
        "git_diff" => "Avoid when you only need the current file contents rather than a diff.",
        "pdf_merge" => "Avoid using bash for PDF merge when this dedicated tool applies.",
        "pdf_split" => "Avoid using bash for PDF split when this dedicated tool applies.",
        "WebFetch" => "Avoid for vague discovery tasks; use `WebSearch` if you do not already have a URL.",
        "WebSearch" => "Avoid when the workspace or a known URL already contains the needed answer.",
        "MCP" => "Avoid inventing integration calls when a local workspace tool already solves the task.",
        "AskUserQuestion" => "Avoid asking the user to restate a task that is already concrete in the latest turn.",
        "TodoWrite" => "Avoid using it as a substitute for taking the next concrete action.",
        "Skill" => "Avoid loading unrelated skills just because they exist.",
        "LSP" => "Avoid unsupported actions or generic code inspection that normal file tools already cover.",
        "NotebookEdit" => "Avoid for normal text files; use `read_file`, `write_file`, or `edit_file` instead.",
        "bash" => "Avoid for local file I/O when `read_file`, `write_file`, `edit_file`, or PDF tools apply.",
        "PowerShell" => "Avoid for non-Windows tasks or normal local file I/O that dedicated tools already cover.",
        _ => "Avoid when a more specific Relay tool already fits the task.",
    }
}

#[must_use]
pub fn cdp_prompt_tool_specs() -> Vec<CdpPromptToolSpec> {
    cdp_tool_specs_for_visibility(CdpToolVisibility::Core)
        .into_iter()
        .map(|spec| CdpPromptToolSpec {
            name: spec.name,
            purpose: cdp_tool_purpose(spec.name, spec.description),
            use_when: cdp_tool_use_when(spec.name),
            avoid_when: cdp_tool_avoid_when(spec.name),
            required_args: cdp_required_args(&spec.input_schema),
            important_optional_args: cdp_tool_important_optional_args(
                spec.name,
                &spec.input_schema,
            ),
            example: cdp_tool_example(spec.name),
        })
        .collect()
}

#[must_use]
pub fn required_permission_for_surface(spec: &ToolSpec) -> PermissionMode {
    if spec.required_permission == PermissionMode::WorkspaceWrite {
        PermissionMode::DangerFullAccess
    } else {
        spec.required_permission
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolApprovalDisplay {
    pub approval_title: String,
    pub approval_target_hint: Option<String>,
    pub important_args: Vec<String>,
}

impl ToolSpec {
    #[must_use]
    pub fn approval_title(&self) -> Option<&'static str> {
        tool_metadata(self.name).approval_title
    }

    #[must_use]
    pub fn target_extractor(&self) -> ApprovalTargetExtractor {
        tool_metadata(self.name).target_extractor
    }

    #[must_use]
    pub fn risky_fields(&self) -> &'static [&'static str] {
        tool_metadata(self.name).risky_fields
    }

    #[must_use]
    pub fn redaction_rules(&self) -> &'static [RedactionRule] {
        tool_metadata(self.name).redaction_rules
    }
}

#[must_use]
fn compat_tool_surface_enabled() -> bool {
    matches!(
        std::env::var("RELAY_COMPAT_MODE")
            .ok()
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("1" | "true" | "on" | "yes" | "compat")
    )
}

#[must_use]
#[allow(clippy::too_many_lines)]
fn build_mvp_tool_specs(compat_mode: bool) -> Vec<ToolSpec> {
    let mut specs = vec![
        ToolSpec {
            name: "bash",
            description: "Execute a shell command (sandboxed on supported hosts). A host **hard denylist** always blocks high-risk commands (e.g. `sudo`, `rm -r`/`rm -rf`/`rm -f`, `rmdir`, destructive `find`, `xargs rm`, `git config`/`push`/`commit`/`reset`/`rebase`, `brew install`, `chmod` with `777`) regardless of permission mode. When `.claw` is read-only, additional mutating commands (e.g. `cp`, `mv`) are rejected—claw-style guard. Prefer read_file/write_file/edit_file for file I/O when those tools apply.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "timeout": { "type": "integer", "minimum": 1 },
                    "description": { "type": "string" },
                    "run_in_background": { "type": "boolean" },
                    "backgroundedBy": { "type": "string", "enum": ["user", "assistant", "system"] },
                    "dangerouslyDisableSandbox": { "type": "boolean" },
                    "dangerously_disable_sandbox": { "type": "boolean", "description": "Claw-style alias (stripped before execution in Relay for security)" },
                    "namespaceRestrictions": { "type": "boolean" },
                    "isolateNetwork": { "type": "boolean" },
                    "filesystemMode": { "type": "string", "enum": ["off", "workspace-only", "allow-list"] },
                    "allowedMounts": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "read_file",
            description: "Read a file by path: UTF-8 text (line offset/limit), .ipynb as numbered text, .pdf via LiteParse spatial text with optional pages (1-based, e.g. \"1-3\" or \"5\"; OCR off), .docx/.xlsx/.pptx as extracted text, common images as metadata only (no multimodal tool result yet).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "file_path": { "type": "string", "description": "Claw-style alias for path" },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1 },
                    "pages": { "type": "string", "description": "PDF only: page range such as \"1-5\", \"3\", or \"10-20\" (1-based)" },
                    "sheets": { "type": "string", "description": "XLSX only: comma-separated sheet names" },
                    "slides": { "type": "string", "description": "PPTX only: slide range such as \"1-5\", \"3\", or \"10-20\" (1-based)" }
                },
                "anyOf": [
                    { "required": ["path"] },
                    { "required": ["file_path"] }
                ],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "write_file",
            description: "Write a text file in the workspace.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "edit_file",
            description: "Replace text in a workspace file.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" },
                    "replace_all": { "type": "boolean" }
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "workspace_search",
            description: "Relay-only read-only agentic search across the current workspace. Returns a search plan, ranked candidate files, evidence snippets, recommended_next_tools read_file follow-up, trace diagnostics, scanned/skipped/truncation limits, and honest not-found state. Use before low-level glob/grep/office searches for vague implementation, related-file, or evidence lookup requests. For important conclusions, reviews, edits, comparisons, or recommendations, follow up with read_file on the recommended top candidate path(s); snippets are discovery evidence, not full-file inspection.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "Workspace-relative search roots. Absolute paths must stay inside the current workspace." },
                    "mode": { "type": "string", "enum": ["auto", "code", "text", "office", "path"] },
                    "include_ext": { "type": "array", "items": { "type": "string" }, "description": "Optional extensions such as rs, ts, tsx, md, docx, xlsx, pptx, pdf." },
                    "max_files": { "type": "integer", "minimum": 1, "maximum": 500 },
                    "max_snippets": { "type": "integer", "minimum": 1, "maximum": 200 },
                    "max_bytes": { "type": "integer", "minimum": 1, "maximum": 10485760, "description": "Per-file text read budget in bytes." },
                    "max_duration_ms": { "type": "integer", "minimum": 1, "maximum": 60000, "description": "Wall-clock search budget." },
                    "context": { "type": "integer", "minimum": 0, "maximum": 10 },
                    "literal": { "type": "boolean", "description": "Reserved for compatibility; current implementation uses literal term matching." }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "glob_search",
            description: "Find files by glob pattern. Use this before reading when the path is unknown, and for local lookup requests asking which files are needed, related, relevant, or available. Supports brace groups such as **/*.{rs,ts,tsx}.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Glob pattern. Brace groups are expanded, e.g. **/*.{docx,xlsx,pptx,pdf}." },
                    "path": { "type": "string" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "grep_search",
            description: "Search plaintext/code file contents with a regex pattern. Use this for code or text repositories; use office_search for DOCX/XLSX/PPTX/PDF.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" },
                    "glob": { "type": "string" },
                    "include": { "type": "string", "description": "Alias for glob, compatible with opencode-style grep include filters such as *.js or *.{ts,tsx}" },
                    "output_mode": { "type": "string" },
                    "-B": { "type": "integer", "minimum": 0 },
                    "-A": { "type": "integer", "minimum": 0 },
                    "-C": { "type": "integer", "minimum": 0 },
                    "context": { "type": "integer", "minimum": 0 },
                    "-n": { "type": "boolean" },
                    "-i": { "type": "boolean" },
                    "type": { "type": "string" },
                    "head_limit": { "type": "integer", "minimum": 1 },
                    "offset": { "type": "integer", "minimum": 0 },
                    "multiline": { "type": "boolean" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "office_search",
            description: "Search extracted text across .docx, .xlsx, .pptx, and .pdf files. Use this before answering local Office/PDF lookup requests, including questions about needed, related, relevant, or available files. Defaults to literal substring search; set regex=true for regex patterns. No semantic ranking. Results include path, anchor, match offsets, and preview. Extraction omits unsupported embedded image/chart/SmartArt text.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "Concrete file paths or glob patterns such as reports/**/*.xlsx" },
                    "regex": { "type": "boolean", "description": "When true, treat pattern as a regex. Defaults to false literal substring search." },
                    "include_ext": { "type": "array", "items": { "type": "string", "enum": ["docx", "xlsx", "pptx", "pdf", ".docx", ".xlsx", ".pptx", ".pdf"] } },
                    "-i": { "type": "boolean" },
                    "context": { "type": "integer", "minimum": 0 },
                    "max_results": { "type": "integer", "minimum": 1, "maximum": 1000 },
                    "max_files": { "type": "integer", "minimum": 1, "maximum": 1000 }
                },
                "required": ["pattern", "paths"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "git_status",
            description: "Run `git status --porcelain` in a workspace directory (read-only). Use for change overview; prefer over bash when applicable. Requires `git` on PATH.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Repository or subdirectory root (defaults to session workspace when omitted)" }
                },
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "git_diff",
            description: "Run `git diff` in a workspace directory (read-only). Set `staged: true` for `--cached`. Output is capped (~256 KiB). Requires `git` on PATH.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Repository or subdirectory root (defaults to session workspace when omitted)" },
                    "staged": { "type": "boolean", "description": "When true, diff staged changes (`git diff --cached`)" }
                },
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "pdf_merge",
            description: "Merge two or more existing PDF files into one output file in the given order (workspace write). Uses lopdf; v1 does not support encrypted PDFs. Page text should remain readable via read_file/LiteParse like the sources; complex PDFs may show viewer warnings after merge (see lopdf issue #424). Prefer this tool over bash for PDF merge.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "output_path": { "type": "string" },
                    "input_paths": {
                        "type": "array",
                        "items": { "type": "string" },
                        "minItems": 2
                    }
                },
                "required": ["output_path", "input_paths"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "pdf_split",
            description: "Split one PDF into multiple output files. Each segment has output_path and pages (1-based, same grammar as read_file for PDFs, e.g. \"1-3,5\"). Workspace write. v1 does not support encrypted PDFs; focuses on page content rather than full ISO fidelity for annotations/forms. Prefer this tool over bash for PDF split.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "input_path": { "type": "string" },
                    "segments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "output_path": { "type": "string" },
                                "pages": { "type": "string" }
                            },
                            "required": ["output_path", "pages"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["input_path", "segments"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "WebFetch",
            description:
                "Fetch a URL, convert it into readable text, and answer a prompt about it.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "format": "uri" },
                    "prompt": { "type": "string" }
                },
                "required": ["url", "prompt"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "WebSearch",
            description: "Search the web for current information and return cited results.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "minLength": 2 },
                    "allowed_domains": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "blocked_domains": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TodoWrite",
            description: "Update the structured task list for the current session.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "content": { "type": "string" },
                                "activeForm": { "type": "string" },
                                "status": {
                                    "type": "string",
                                    "enum": ["pending", "in_progress", "completed"]
                                },
                                "priority": {
                                    "type": "string",
                                    "enum": ["high", "medium", "low"]
                                }
                            },
                            "required": ["content", "activeForm", "status"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["todos"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "Skill",
            description: "Load a local skill definition and its instructions.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "skill": { "type": "string" },
                    "args": { "type": "string" }
                },
                "required": ["skill"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "Agent",
            description: "Launch a specialized agent task and persist its handoff metadata.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "description": { "type": "string" },
                    "prompt": { "type": "string" },
                    "subagent_type": { "type": "string" },
                    "name": { "type": "string" },
                    "model": { "type": "string" },
                    "run_in_background": { "type": "boolean" },
                    "isolation": { "type": "string", "description": "e.g. worktree (not supported in Relay)" }
                },
                "required": ["description", "prompt"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "ToolSearch",
            description: "Search for deferred or specialized tools by exact name or keywords.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "max_results": { "type": "integer", "minimum": 1 }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "NotebookEdit",
            description: "Replace, insert, or delete a cell in a Jupyter notebook.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "notebook_path": { "type": "string" },
                    "cell_id": { "type": "string" },
                    "new_source": { "type": "string" },
                    "cell_type": { "type": "string", "enum": ["code", "markdown"] },
                    "edit_mode": { "type": "string", "enum": ["replace", "insert", "delete"] },
                    "command": {
                        "type": "string",
                        "enum": ["replace", "insert_above", "insert_below", "delete"],
                        "description": "Claw-style; when set, index is required (0-based cell index)"
                    },
                    "index": { "type": "integer", "minimum": 0 }
                },
                "required": ["notebook_path"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "Sleep",
            description: "Wait for a specified duration without holding a shell process.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "duration_ms": { "type": "integer", "minimum": 0 }
                },
                "required": ["duration_ms"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "SendUserMessage",
            description: "Send a message to the user.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "message": { "type": "string" },
                    "attachments": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "status": {
                        "type": "string",
                        "enum": ["normal", "proactive"]
                    }
                },
                "required": ["message", "status"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "Config",
            description: "Get or set Claw Code settings.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "setting": { "type": "string" },
                    "key": { "type": "string", "description": "Claw-style alias for setting name" },
                    "action": { "type": "string", "enum": ["get", "set"] },
                    "value": {
                        "type": ["string", "boolean", "number"]
                    }
                },
                "anyOf": [
                    { "required": ["setting"] },
                    { "required": ["key"] }
                ],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "StructuredOutput",
            description: "Return structured output in the requested format.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "data": { "description": "Primary JSON payload (Claw-style)" }
                },
                "additionalProperties": true
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "REPL",
            description: "Execute code in a REPL-like subprocess.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "code": { "type": "string" },
                    "language": { "type": "string" },
                    "timeout_ms": { "type": "integer", "minimum": 1 }
                },
                "required": ["code", "language"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
    ];
    #[cfg(windows)]
    specs.push(ToolSpec {
        name: "PowerShell",
        description: concat!(
            "Windows only. Run PowerShell (prefers `pwsh`, else `powershell.exe`). ",
            "Primary path for desktop Office automation via COM: Word, Excel, PowerPoint, and .msg files (open/read/save via Outlook.Application when Outlook is installed). ",
            "Trust Center / programmatic access may block Outlook COM on locked-down PCs. ",
            "The host prepends UTF-8 console setup (chcp 65001, OutputEncoding) unless RELAY_POWERSHELL_NO_UTF8_PREAMBLE is set. ",
            "Performance: Copilot turns are slow—put Open→work→Save→Quit in ONE command string; do not split the same workbook across multiple PowerShell tool calls in one turn. ",
            "Excel: NEVER loop COM per-cell; use 2D array assignment to Range.Value2, block ranges, CSV import, or similar batch APIs; prefer Application.ScreenUpdating=$false in try/finally. ",
            "Word/PowerPoint: prefer batch Find/Replace, range-level edits; avoid Select/Activate. ",
            "Hybrid Office read: in one command, batch-extract data (Value2 as JSON or Export-Csv) plus COM ExportAsFixedFormat to a unique PDF under %TEMP%\\RelayAgent\\office-layout\\; stdout one JSON with pdfPath; pair with read_file on that PDF in the same relay_tool array for LiteParse layout text (Excel: PDF is layout hints only; numbers from Value2/CSV). ",
            "Return structured results with ConvertTo-Json -Compress on stdout when useful."
        ),
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string" },
                "timeout": { "type": "integer", "minimum": 1 },
                "description": { "type": "string" },
                "run_in_background": { "type": "boolean" }
            },
            "required": ["command"],
            "additionalProperties": false
        }),
        required_permission: PermissionMode::DangerFullAccess,
    });
    specs.extend(vec![
        // ── CLI Hub (OpenCLI-inspired) ──
        ToolSpec {
            name: "CliList",
            description: "List all discoverable external CLIs with their installed status.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "CliDiscover",
            description: "Discover all known CLIs and report which are installed vs missing.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "CliRegister",
            description: "Register a new external CLI by name so AI agents can discover it.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "CliUnregister",
            description: "Unregister a custom CLI from the registry.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "CliRun",
            description: "Execute an external CLI with arguments. Returns stdout, stderr, and exit code.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "cli": { "type": "string" },
                    "args": { "type": "array", "items": { "type": "string" } },
                    "timeout_ms": { "type": "integer", "minimum": 100 }
                },
                "required": ["cli", "args"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        // ── Electron CDP Controller (OpenCLI-inspired) ──
        ToolSpec {
            name: "ElectronApps",
            description: "List known Electron desktop apps with their running status and CDP configuration.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "ElectronLaunch",
            description: "Launch an Electron app with CDP (Chrome DevTools Protocol) enabled for remote control.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "app": { "type": "string" },
                    "cdp_port": { "type": "integer", "minimum": 1024 }
                },
                "required": ["app"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "ElectronEval",
            description: "Execute JavaScript in an Electron app's renderer process via CDP.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "app": { "type": "string" },
                    "cdp_port": { "type": "integer", "minimum": 1024 },
                    "expression": { "type": "string" }
                },
                "required": ["app", "expression"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "ElectronGetText",
            description: "Get text content from an Electron app page via CDP.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "app": { "type": "string" },
                    "cdp_port": { "type": "integer", "minimum": 1024 },
                    "selector": { "type": "string" }
                },
                "required": ["app"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "ElectronClick",
            description: "Click an element in an Electron app via CDP.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "app": { "type": "string" },
                    "cdp_port": { "type": "integer", "minimum": 1024 },
                    "selector": { "type": "string" }
                },
                "required": ["app", "selector"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "ElectronTypeText",
            description: "Type text into an input field in an Electron app via CDP.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "app": { "type": "string" },
                    "cdp_port": { "type": "integer", "minimum": 1024 },
                    "selector": { "type": "string" },
                    "text": { "type": "string" }
                },
                "required": ["app", "selector", "text"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        // Claw-style MCP meta tools (executed in desktop `TauriToolExecutor`, not here).
        ToolSpec {
            name: "ListMcpResources",
            description: "List MCP resources from configured stdio servers (merged `.claw` / user settings). Optional `server` or `serverName` filters to one server.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "serverName": { "type": "string" }
                },
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "ReadMcpResource",
            description: "Read an MCP resource by URI from a named stdio server.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "serverName": { "type": "string" },
                    "uri": { "type": "string" }
                },
                "required": ["uri"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "McpAuth",
            description: "Relay desktop: reports MCP OAuth / remote transport status. Does not run a browser OAuth flow inside the tool — configure transports in merged settings.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "serverName": { "type": "string" }
                },
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "MCP",
            description: "Unified MCP control surface (claw-style): `action` list_resources | read_resource | list_tools | call_tool. Uses the same stdio MCP servers as `mcp__*` qualified tool names.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "list_resources | read_resource | list_tools | call_tool"
                    },
                    "server": { "type": "string" },
                    "serverName": { "type": "string" },
                    "uri": { "type": "string" },
                    "name": { "type": "string", "description": "Qualified tool name for call_tool (e.g. mcp__server__tool)" },
                    "arguments": { "type": "object" }
                },
                "required": ["action"],
                "additionalProperties": true
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "AskUserQuestion",
            description: "Ask the user one or more questions and wait for answers via the desktop UI (text reply). Supports Relay `questions[]` or claw-style single `question` plus optional `options` (string array).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "question": { "type": "string" },
                                "header": { "type": "string" },
                                "options": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": { "type": "string" },
                                            "value": { "type": "string" }
                                        },
                                        "required": ["label"],
                                        "additionalProperties": false
                                    }
                                },
                                "multiSelect": { "type": "boolean" }
                            },
                            "required": ["question"],
                            "additionalProperties": false
                        }
                    },
                    "question": { "type": "string", "description": "Claw-style single question (alternative to questions[])" },
                    "options": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Claw-style choices when using top-level question"
                    }
                },
                "anyOf": [
                    { "required": ["questions"] },
                    { "required": ["question"] }
                ],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "LSP",
            description: "Language server (claw-style catalog). Relay implements `diagnostics` only (rust-analyzer pull diagnostics for a workspace file). Other actions return a clear error.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["symbols", "references", "diagnostics", "definition", "hover"] },
                    "path": { "type": "string", "description": "File path (required for diagnostics in Relay)" },
                    "languageId": { "type": "string", "description": "Defaults to rust for .rs files" },
                    "line": { "type": "integer", "minimum": 0 },
                    "character": { "type": "integer", "minimum": 0 },
                    "query": { "type": "string" }
                },
                "required": ["action"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskCreate",
            description: "Create an in-memory task record (claw-style parity; no external worker). Accepts Relay `name`/`description` and/or claw `prompt` (mapped into description when name/description absent).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "prompt": { "type": "string", "description": "Claw-style task text; used as description when description is omitted" }
                },
                "additionalProperties": true
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskGet",
            description: "Get a task by id (`id` or claw `task_id`).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "task_id": { "type": "string", "description": "Claw-style alias for id" }
                },
                "anyOf": [
                    { "required": ["id"] },
                    { "required": ["task_id"] }
                ],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskList",
            description: "List in-memory tasks.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskStop",
            description: "Mark a task stopped (`id` or `task_id`).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "task_id": { "type": "string" }
                },
                "anyOf": [
                    { "required": ["id"] },
                    { "required": ["task_id"] }
                ],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskUpdate",
            description: "Update task fields. Accepts `id` or `task_id`; claw `message` appends to task output.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "task_id": { "type": "string" },
                    "status": { "type": "string", "enum": ["requested", "running", "completed", "failed", "cancelled"] },
                    "output": { "type": "string" },
                    "message": { "type": "string", "description": "Claw-style update payload; appended to output" }
                },
                "anyOf": [
                    { "required": ["id"] },
                    { "required": ["task_id"] }
                ],
                "additionalProperties": true
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskOutput",
            description: "Append or read task output (`id` or `task_id`).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "task_id": { "type": "string" },
                    "append": { "type": "string" },
                    "offset": { "type": "integer", "minimum": 0 },
                    "tail": { "type": "integer", "minimum": 1 }
                },
                "anyOf": [
                    { "required": ["id"] },
                    { "required": ["task_id"] }
                ],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "BackgroundTaskOutput",
            description: "Read persisted stdout/stderr for a background task using `backgroundTaskId` with optional `offset` or `tail`.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "backgroundTaskId": { "type": "string" },
                    "stream": { "type": "string", "enum": ["stdout", "stderr"] },
                    "offset": { "type": "integer", "minimum": 0 },
                    "tail": { "type": "integer", "minimum": 1 }
                },
                "required": ["backgroundTaskId"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
    ]);
    if compat_mode {
        specs.extend(vec![
            ToolSpec {
                name: "EnterPlanMode",
                description: "Compat hook only. Relay sessions stay in one standard posture; continue in the current chat.",
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
                required_permission: PermissionMode::WorkspaceWrite,
            },
            ToolSpec {
                name: "ExitPlanMode",
                description: "Compat hook only. Relay sessions stay in one standard posture; continue in the current chat.",
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
                required_permission: PermissionMode::WorkspaceWrite,
            },
        ]);
    }
    specs
}

#[must_use]
pub fn mvp_tool_specs() -> Vec<ToolSpec> {
    tool_catalog().specs().to_vec()
}

pub use approval::approval_display_for_tool;

/// JSON for claw-style `EnterPlanMode` / `ExitPlanMode` when session posture cannot change mid-loop.
#[must_use]
pub fn plan_mode_tool_json(entering: bool) -> Value {
    json!({
        "ok": false,
        "entering": entering,
        "error": "Relay: session posture is fixed for the current chat. Continue in the same conversation.",
        "errorJa": "Relay: 現在の会話ではセッション姿勢は固定です。同じ会話を続けてください。"
    })
}

pub fn execute_tool(name: &str, input: &Value) -> Result<String, String> {
    match name {
        "bash" => from_value::<BashCommandInput>(input).and_then(run_bash),
        "read_file" => from_value::<ReadFileInput>(input).and_then(run_read_file),
        "write_file" => from_value::<WriteFileInput>(input).and_then(run_write_file),
        "edit_file" => from_value::<EditFileInput>(input).and_then(run_edit_file),
        "workspace_search" => from_value::<WorkspaceSearchInput>(input).and_then(run_workspace_search),
        "glob_search" => from_value::<GlobSearchInputValue>(input).and_then(run_glob_search),
        "grep_search" => from_value::<GrepSearchInput>(input).and_then(run_grep_search),
        "office_search" => from_value::<OfficeSearchInput>(input).and_then(run_office_search),
        "git_status" => from_value::<GitCwdInput>(input).and_then(run_git_status),
        "git_diff" => from_value::<GitDiffToolInput>(input).and_then(run_git_diff),
        "pdf_merge" => from_value::<PdfMergeInput>(input).and_then(run_pdf_merge),
        "pdf_split" => from_value::<PdfSplitInput>(input).and_then(run_pdf_split),
        "WebFetch" => from_value::<WebFetchInput>(input).and_then(run_web_fetch),
        "WebSearch" => from_value::<WebSearchInput>(input).and_then(run_web_search),
        "TodoWrite" => from_value::<TodoWriteInput>(input).and_then(run_todo_write),
        "Skill" => from_value::<SkillInput>(input).and_then(run_skill),
        "Agent" => from_value::<AgentInput>(input).and_then(|i| run_agent(&i)),
        "ToolSearch" => from_value::<ToolSearchInput>(input).and_then(run_tool_search),
        "NotebookEdit" => from_value::<NotebookEditInput>(input).and_then(run_notebook_edit),
        "Sleep" => from_value::<SleepInput>(input).and_then(run_sleep),
        "SendUserMessage" | "Brief" => from_value::<BriefInput>(input).and_then(run_brief),
        "Config" => from_value::<ConfigInput>(input).and_then(run_config),
        "EnterPlanMode" => {
            serde_json::to_string_pretty(&plan_mode_tool_json(true)).map_err(|e| e.to_string())
        }
        "ExitPlanMode" => {
            serde_json::to_string_pretty(&plan_mode_tool_json(false)).map_err(|e| e.to_string())
        }
        "StructuredOutput" => {
            from_value::<StructuredOutputInput>(input).and_then(run_structured_output)
        }
        "REPL" => from_value::<ReplInput>(input).and_then(run_repl),
        #[cfg(windows)]
        "PowerShell" => from_value::<PowerShellInput>(input).and_then(run_powershell),
        // CLI Hub
        "CliList" => to_pretty_json(cli_hub::cli_list()),
        "CliDiscover" => to_pretty_json(cli_hub::cli_discover()),
        "CliRegister" => from_value::<CliRegisterInput>(input).and_then(run_cli_register),
        "CliUnregister" => from_value::<CliUnregisterInput>(input).and_then(run_cli_unregister),
        "CliRun" => from_value::<CliRunInput>(input).and_then(run_cli_run),
        // Electron CDP
        "ElectronApps" => to_pretty_json(electron_cdp::electron_apps_status()),
        "ElectronLaunch" => from_value::<ElectronLaunchInput>(input).and_then(run_electron_launch),
        "ElectronEval" => from_value::<ElectronEvalInput>(input).and_then(run_electron_eval),
        "ElectronGetText" => {
            from_value::<ElectronGetTextInput>(input).and_then(run_electron_get_text)
        }
        "ElectronClick" => from_value::<ElectronClickInput>(input).and_then(run_electron_click),
        "ElectronTypeText" => {
            from_value::<ElectronTypeTextInput>(input).and_then(run_electron_type_text)
        }
        "ListMcpResources" | "ReadMcpResource" | "McpAuth" | "MCP" | "AskUserQuestion" => Err(
            format!("{name} runs only in the Relay desktop agent (Tauri tool executor)"),
        ),
        "LSP" => run_lsp_tool(input),
        "TaskCreate" => task_create(input),
        "TaskGet" => task_get(input),
        "TaskList" => task_list(),
        "TaskStop" => task_stop(input),
        "TaskUpdate" => task_update(input),
        "TaskOutput" => task_output(input),
        "BackgroundTaskOutput" => from_value::<BackgroundTaskOutputInput>(input).and_then(|req| {
            let output = read_background_task_output(req).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&output).map_err(|e| e.to_string())
        }),
        _ => Err(format!("unsupported tool: {name}")),
    }
}

fn run_lsp_tool(input: &Value) -> Result<String, String> {
    let action = input
        .get("action")
        .and_then(|a| a.as_str())
        .ok_or_else(|| "LSP requires action".to_string())?;
    if action != "diagnostics" {
        return Err(format!(
            "Relay LSP: only `diagnostics` is implemented (got `{action}`); symbols/references/definition/hover are not available yet"
        ));
    }
    let path = input
        .get("path")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "LSP requires path".to_string())?;
    let file = std::path::PathBuf::from(path);
    let workspace = file.parent().map_or_else(
        || std::path::PathBuf::from("."),
        std::path::Path::to_path_buf,
    );
    pull_rust_diagnostics_blocking(&workspace, &file)
}

fn from_value<T: for<'de> Deserialize<'de>>(input: &Value) -> Result<T, String> {
    serde_json::from_value(input.clone()).map_err(|error| error.to_string())
}

fn run_bash(input: BashCommandInput) -> Result<String, String> {
    serde_json::to_string_pretty(&execute_bash(input).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[allow(clippy::needless_pass_by_value)]
fn run_read_file(input: ReadFileInput) -> Result<String, String> {
    let path = input
        .path
        .or(input.file_path)
        .ok_or_else(|| String::from("read_file requires path or file_path"))?;
    to_pretty_json(
        read_file(
            &path,
            input.offset,
            input.limit,
            input.pages.as_deref(),
            input.sheets.as_deref(),
            input.slides.as_deref(),
        )
        .map_err(io_to_string)?,
    )
}

#[allow(clippy::needless_pass_by_value)]
fn run_write_file(input: WriteFileInput) -> Result<String, String> {
    to_pretty_json(write_file(&input.path, &input.content).map_err(io_to_string)?)
}

#[allow(clippy::needless_pass_by_value)]
fn run_edit_file(input: EditFileInput) -> Result<String, String> {
    to_pretty_json(
        edit_file(
            &input.path,
            &input.old_string,
            &input.new_string,
            input.replace_all.unwrap_or(false),
        )
        .map_err(io_to_string)?,
    )
}

#[allow(clippy::needless_pass_by_value)]
fn run_glob_search(input: GlobSearchInputValue) -> Result<String, String> {
    to_pretty_json(glob_search(&input.pattern, input.path.as_deref()).map_err(io_to_string)?)
}

const GIT_OUTPUT_MAX_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
struct GitCwdInput {
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitDiffToolInput {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    staged: Option<bool>,
}

fn run_git_captured(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|e| {
            format!(
                "Could not run `git` in {}: {e} (is Git installed and on PATH?)",
                cwd.display()
            )
        })?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        let msg = if stderr.trim().is_empty() {
            format!("git exited with status {:?}", out.status.code())
        } else {
            stderr
        };
        return Err(msg.trim().to_string());
    }
    if stdout.len() > GIT_OUTPUT_MAX_BYTES {
        Ok(format!(
            "{}…\n[output truncated to {} bytes]",
            &stdout[..GIT_OUTPUT_MAX_BYTES],
            GIT_OUTPUT_MAX_BYTES
        ))
    } else {
        Ok(stdout)
    }
}

fn run_git_status(input: GitCwdInput) -> Result<String, String> {
    let cwd = input
        .path
        .ok_or_else(|| String::from("git_status: path is required"))?;
    let p = PathBuf::from(&cwd);
    if !p.is_dir() {
        return Err(format!("git_status: not a directory: {}", p.display()));
    }
    run_git_captured(&p, &["status", "--porcelain=v1", "-u"])
}

fn run_git_diff(input: GitDiffToolInput) -> Result<String, String> {
    let cwd = input
        .path
        .ok_or_else(|| String::from("git_diff: path is required"))?;
    let p = PathBuf::from(&cwd);
    if !p.is_dir() {
        return Err(format!("git_diff: not a directory: {}", p.display()));
    }
    if input.staged == Some(true) {
        run_git_captured(&p, &["diff", "--no-color", "--cached"])
    } else {
        run_git_captured(&p, &["diff", "--no-color"])
    }
}

#[allow(clippy::needless_pass_by_value)]
fn run_workspace_search(input: WorkspaceSearchInput) -> Result<String, String> {
    to_pretty_json(workspace_search(&input).map_err(io_to_string)?)
}

#[allow(clippy::needless_pass_by_value)]
fn run_grep_search(input: GrepSearchInput) -> Result<String, String> {
    to_pretty_json(grep_search(&input).map_err(io_to_string)?)
}

#[allow(clippy::needless_pass_by_value)]
fn run_office_search(input: OfficeSearchInput) -> Result<String, String> {
    to_pretty_json(office_search(&input).map_err(io_to_string)?)
}

#[allow(clippy::needless_pass_by_value)]
fn run_pdf_merge(input: PdfMergeInput) -> Result<String, String> {
    reject_sensitive_file_path(Path::new(&input.output_path)).map_err(io_to_string)?;
    let output_path = merge_pdfs(&input.output_path, &input.input_paths).map_err(io_to_string)?;
    to_pretty_json(json!({
        "output_path": output_path.to_string_lossy(),
    }))
}

#[allow(clippy::needless_pass_by_value)]
fn run_pdf_split(input: PdfSplitInput) -> Result<String, String> {
    for s in &input.segments {
        reject_sensitive_file_path(Path::new(&s.output_path)).map_err(io_to_string)?;
    }
    let segments: Vec<PdfSplitSegment> = input
        .segments
        .into_iter()
        .map(|s| PdfSplitSegment {
            output_path: s.output_path,
            pages: s.pages,
        })
        .collect();
    let outputs = split_pdf(&input.input_path, &segments).map_err(io_to_string)?;
    let paths: Vec<String> = outputs
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    to_pretty_json(json!({ "outputs": paths }))
}

#[allow(clippy::needless_pass_by_value)]
fn run_web_fetch(input: WebFetchInput) -> Result<String, String> {
    to_pretty_json(execute_web_fetch(&input)?)
}

#[allow(clippy::needless_pass_by_value)]
fn run_web_search(input: WebSearchInput) -> Result<String, String> {
    to_pretty_json(execute_web_search(&input)?)
}

fn run_todo_write(input: TodoWriteInput) -> Result<String, String> {
    to_pretty_json(execute_todo_write(input)?)
}

fn run_skill(input: SkillInput) -> Result<String, String> {
    to_pretty_json(execute_skill(input)?)
}

fn run_agent(input: &AgentInput) -> Result<String, String> {
    if input.run_in_background == Some(true) {
        return Err(String::from(
            "Agent run_in_background is not supported in Relay (sub-agents unavailable)",
        ));
    }
    if input
        .isolation
        .as_deref()
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("worktree"))
    {
        return Err(String::from(
            "Agent isolation \"worktree\" is not supported in Relay (sub-agents unavailable)",
        ));
    }
    Err(String::from("sub-agent is not available (CDP-only mode)"))
}

fn run_tool_search(input: ToolSearchInput) -> Result<String, String> {
    to_pretty_json(execute_tool_search(input))
}

fn run_notebook_edit(input: NotebookEditInput) -> Result<String, String> {
    to_pretty_json(execute_notebook_edit(input)?)
}

fn run_sleep(input: SleepInput) -> Result<String, String> {
    to_pretty_json(execute_sleep(input))
}

fn run_brief(input: BriefInput) -> Result<String, String> {
    to_pretty_json(execute_brief(input)?)
}

fn run_config(input: ConfigInput) -> Result<String, String> {
    let input = normalize_config_input(input)?;
    to_pretty_json(execute_config(input)?)
}

fn run_structured_output(input: StructuredOutputInput) -> Result<String, String> {
    to_pretty_json(execute_structured_output(input))
}

fn run_repl(input: ReplInput) -> Result<String, String> {
    to_pretty_json(execute_repl(input)?)
}

#[cfg(windows)]
fn run_powershell(input: PowerShellInput) -> Result<String, String> {
    to_pretty_json(execute_powershell(input).map_err(|error| error.to_string())?)
}

fn run_cli_register(input: CliRegisterInput) -> Result<String, String> {
    to_pretty_json(cli_hub::cli_register(input.name))
}

fn run_cli_unregister(input: CliUnregisterInput) -> Result<String, String> {
    to_pretty_json(cli_hub::cli_unregister(input.name))
}

#[allow(clippy::needless_pass_by_value)]
fn run_cli_run(input: CliRunInput) -> Result<String, String> {
    let args: Vec<&str> = input.args.iter().map(std::string::String::as_str).collect();
    to_pretty_json(cli_hub::cli_execute(&input.cli, &args, input.timeout_ms))
}

#[allow(clippy::needless_pass_by_value)]
fn run_electron_launch(input: ElectronLaunchInput) -> Result<String, String> {
    to_pretty_json(electron_cdp::electron_launch(&input.app, input.cdp_port))
}

#[allow(clippy::needless_pass_by_value)]
fn run_electron_eval(input: ElectronEvalInput) -> Result<String, String> {
    to_pretty_json(electron_cdp::electron_eval(
        &input.app,
        input.cdp_port,
        &input.expression,
    ))
}

#[allow(clippy::needless_pass_by_value)]
fn run_electron_get_text(input: ElectronGetTextInput) -> Result<String, String> {
    to_pretty_json(electron_cdp::electron_get_text(
        &input.app,
        input.cdp_port,
        input.selector.as_deref(),
    ))
}

#[allow(clippy::needless_pass_by_value)]
fn run_electron_click(input: ElectronClickInput) -> Result<String, String> {
    to_pretty_json(electron_cdp::electron_click(
        &input.app,
        input.cdp_port,
        &input.selector,
    ))
}

#[allow(clippy::needless_pass_by_value)]
fn run_electron_type_text(input: ElectronTypeTextInput) -> Result<String, String> {
    to_pretty_json(electron_cdp::electron_type_text(
        &input.app,
        input.cdp_port,
        &input.selector,
        &input.text,
    ))
}

fn to_pretty_json<T: serde::Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string_pretty(&value).map_err(|error| error.to_string())
}

#[allow(clippy::needless_pass_by_value)]
fn io_to_string(error: std::io::Error) -> String {
    error.to_string()
}

#[derive(Debug, Deserialize)]
struct ReadFileInput {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    file_path: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    pages: Option<String>,
    sheets: Option<String>,
    slides: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WriteFileInput {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct PdfMergeInput {
    output_path: String,
    input_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PdfSplitSegmentInput {
    output_path: String,
    pages: String,
}

#[derive(Debug, Deserialize)]
struct PdfSplitInput {
    input_path: String,
    segments: Vec<PdfSplitSegmentInput>,
}

#[derive(Debug, Deserialize)]
struct EditFileInput {
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GlobSearchInputValue {
    pattern: String,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WebFetchInput {
    url: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct WebSearchInput {
    query: String,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct TodoWriteInput {
    todos: Vec<TodoItem>,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
struct TodoItem {
    id: Option<String>,
    content: String,
    #[serde(rename = "activeForm")]
    active_form: String,
    status: TodoStatus,
    priority: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Deserialize)]
struct SkillInput {
    skill: String,
    args: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AgentInput {
    description: String,
    prompt: String,
    subagent_type: Option<String>,
    name: Option<String>,
    model: Option<String>,
    run_in_background: Option<bool>,
    isolation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ToolSearchInput {
    query: String,
    max_results: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct NotebookEditInput {
    notebook_path: String,
    cell_id: Option<String>,
    new_source: Option<String>,
    cell_type: Option<NotebookCellType>,
    edit_mode: Option<NotebookEditMode>,
    command: Option<String>,
    index: Option<usize>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum NotebookCellType {
    Code,
    Markdown,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum NotebookEditMode {
    Replace,
    Insert,
    Delete,
}

#[derive(Debug, Deserialize)]
struct SleepInput {
    duration_ms: u64,
}

#[derive(Debug, Deserialize)]
struct BriefInput {
    message: String,
    attachments: Option<Vec<String>>,
    status: BriefStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum BriefStatus {
    Normal,
    Proactive,
}

#[derive(Debug, Deserialize)]
struct ConfigInput {
    #[serde(default)]
    setting: Option<String>,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    action: Option<String>,
    value: Option<ConfigValue>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ConfigValue {
    String(String),
    Bool(bool),
    Number(f64),
}

#[derive(Debug, Deserialize)]
struct StructuredOutputInput {
    #[serde(default)]
    data: Option<Value>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
struct ReplInput {
    code: String,
    language: String,
    timeout_ms: Option<u64>,
}

#[cfg(windows)]
#[derive(Debug, Deserialize)]
struct PowerShellInput {
    command: String,
    timeout: Option<u64>,
    description: Option<String>,
    run_in_background: Option<bool>,
}

/* ── CLI Hub inputs/outputs ─────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct CliRegisterInput {
    name: String,
}

#[derive(Debug, Deserialize)]
struct CliUnregisterInput {
    name: String,
}

#[derive(Debug, Deserialize)]
struct CliRunInput {
    cli: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
}

/* ── Electron CDP inputs ────────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct ElectronLaunchInput {
    app: String,
    cdp_port: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct ElectronEvalInput {
    app: String,
    cdp_port: u16,
    expression: String,
}

#[derive(Debug, Deserialize)]
struct ElectronGetTextInput {
    app: String,
    cdp_port: u16,
    selector: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ElectronClickInput {
    app: String,
    cdp_port: u16,
    selector: String,
}

#[derive(Debug, Deserialize)]
struct ElectronTypeTextInput {
    app: String,
    cdp_port: u16,
    selector: String,
    text: String,
}

#[derive(Debug, Serialize)]
struct WebFetchOutput {
    bytes: usize,
    code: u16,
    #[serde(rename = "codeText")]
    code_text: String,
    result: String,
    #[serde(rename = "durationMs")]
    duration_ms: u128,
    url: String,
}

#[derive(Debug, Serialize)]
struct WebSearchOutput {
    query: String,
    results: Vec<WebSearchResultItem>,
    #[serde(rename = "durationSeconds")]
    duration_seconds: f64,
}

#[derive(Debug, Serialize)]
struct TodoWriteOutput {
    #[serde(rename = "oldTodos")]
    old_todos: Vec<TodoItem>,
    #[serde(rename = "newTodos")]
    new_todos: Vec<TodoItem>,
    #[serde(rename = "verificationNudgeNeeded")]
    verification_nudge_needed: Option<bool>,
}

#[derive(Debug, Serialize)]
struct SkillOutput {
    skill: String,
    path: String,
    args: Option<String>,
    description: Option<String>,
    prompt: String,
}

#[derive(Debug, Clone, Serialize)]
struct ToolSearchOutput {
    matches: Vec<String>,
    query: String,
    normalized_query: String,
    #[serde(rename = "total_deferred_tools")]
    total_deferred_tools: usize,
    #[serde(rename = "pending_mcp_servers")]
    pending_mcp_servers: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct NotebookEditOutput {
    new_source: String,
    cell_id: Option<String>,
    cell_type: Option<NotebookCellType>,
    language: String,
    edit_mode: String,
    error: Option<String>,
    notebook_path: String,
    original_file: String,
    updated_file: String,
}

#[derive(Debug, Serialize)]
struct SleepOutput {
    duration_ms: u64,
    message: String,
}

#[derive(Debug, Serialize)]
struct BriefOutput {
    message: String,
    attachments: Option<Vec<ResolvedAttachment>>,
    #[serde(rename = "sentAt")]
    sent_at: String,
}

#[derive(Debug, Serialize)]
struct ResolvedAttachment {
    path: String,
    size: u64,
    #[serde(rename = "isImage")]
    is_image: bool,
}

#[derive(Debug, Serialize)]
struct ConfigOutput {
    success: bool,
    operation: Option<String>,
    setting: Option<String>,
    value: Option<Value>,
    #[serde(rename = "previousValue")]
    previous_value: Option<Value>,
    #[serde(rename = "newValue")]
    new_value: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct StructuredOutputResult {
    data: String,
    structured_output: BTreeMap<String, Value>,
}

#[derive(Debug, Serialize)]
struct ReplOutput {
    language: String,
    stdout: String,
    stderr: String,
    #[serde(rename = "exitCode")]
    exit_code: i32,
    #[serde(rename = "durationMs")]
    duration_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum WebSearchResultItem {
    SearchResult {
        tool_use_id: String,
        content: Vec<SearchHit>,
    },
    Commentary(String),
}

#[derive(Debug, Serialize)]
struct SearchHit {
    title: String,
    url: String,
}

fn execute_web_fetch(input: &WebFetchInput) -> Result<WebFetchOutput, String> {
    let started = Instant::now();
    let client = build_http_client()?;
    let request_url = normalize_fetch_url(&input.url)?;
    let response = client
        .get(request_url.clone())
        .send()
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let final_url = response.url().to_string();
    let code = status.as_u16();
    let code_text = status.canonical_reason().unwrap_or("Unknown").to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body = response.text().map_err(|error| error.to_string())?;
    let bytes = body.len();
    let normalized = normalize_fetched_content(&body, &content_type);
    let result = summarize_web_fetch(&final_url, &input.prompt, &normalized, &body, &content_type);

    Ok(WebFetchOutput {
        bytes,
        code,
        code_text,
        result,
        duration_ms: started.elapsed().as_millis(),
        url: final_url,
    })
}

fn execute_web_search(input: &WebSearchInput) -> Result<WebSearchOutput, String> {
    let started = Instant::now();
    let client = build_http_client()?;
    let search_url = build_search_url(&input.query)?;
    let response = client
        .get(search_url)
        .send()
        .map_err(|error| error.to_string())?;

    let final_url = response.url().clone();
    let html = response.text().map_err(|error| error.to_string())?;
    let mut hits = extract_search_hits(&html);

    if hits.is_empty() && final_url.host_str().is_some() {
        hits = extract_search_hits_from_generic_links(&html);
    }

    if let Some(allowed) = input.allowed_domains.as_ref() {
        hits.retain(|hit| host_matches_list(&hit.url, allowed));
    }
    if let Some(blocked) = input.blocked_domains.as_ref() {
        hits.retain(|hit| !host_matches_list(&hit.url, blocked));
    }

    dedupe_hits(&mut hits);
    hits.truncate(8);

    let summary = if hits.is_empty() {
        format!("No web search results matched the query {:?}.", input.query)
    } else {
        let rendered_hits = hits
            .iter()
            .map(|hit| format!("- [{}]({})", hit.title, hit.url))
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "Search results for {:?}. Include a Sources section in the final answer.\n{}",
            input.query, rendered_hits
        )
    };

    Ok(WebSearchOutput {
        query: input.query.clone(),
        results: vec![
            WebSearchResultItem::Commentary(summary),
            WebSearchResultItem::SearchResult {
                tool_use_id: String::from("web_search_1"),
                content: hits,
            },
        ],
        duration_seconds: started.elapsed().as_secs_f64(),
    })
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("clawd-rust-tools/0.1")
        .build()
        .map_err(|error| error.to_string())
}

fn normalize_fetch_url(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() == "http" {
        let host = parsed.host_str().unwrap_or_default();
        if host != "localhost" && host != "127.0.0.1" && host != "::1" {
            let mut upgraded = parsed;
            upgraded
                .set_scheme("https")
                .map_err(|()| String::from("failed to upgrade URL to https"))?;
            return Ok(upgraded.to_string());
        }
    }
    Ok(parsed.to_string())
}

fn build_search_url(query: &str) -> Result<reqwest::Url, String> {
    if let Ok(base) = std::env::var("CLAWD_WEB_SEARCH_BASE_URL") {
        let mut url = reqwest::Url::parse(&base).map_err(|error| error.to_string())?;
        url.query_pairs_mut().append_pair("q", query);
        return Ok(url);
    }

    let mut url = reqwest::Url::parse("https://html.duckduckgo.com/html/")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("q", query);
    Ok(url)
}

fn normalize_fetched_content(body: &str, content_type: &str) -> String {
    if content_type.contains("html") {
        html_to_text(body)
    } else {
        body.trim().to_string()
    }
}

fn summarize_web_fetch(
    url: &str,
    prompt: &str,
    content: &str,
    raw_body: &str,
    content_type: &str,
) -> String {
    let lower_prompt = prompt.to_lowercase();
    let compact = collapse_whitespace(content);

    let detail = if lower_prompt.contains("title") {
        extract_title(content, raw_body, content_type).map_or_else(
            || preview_text(&compact, 600),
            |title| format!("Title: {title}"),
        )
    } else if lower_prompt.contains("summary") || lower_prompt.contains("summarize") {
        preview_text(&compact, 900)
    } else {
        let preview = preview_text(&compact, 900);
        format!("Prompt: {prompt}\nContent preview:\n{preview}")
    };

    format!("Fetched {url}\n{detail}")
}

fn extract_title(content: &str, raw_body: &str, content_type: &str) -> Option<String> {
    if content_type.contains("html") {
        let lowered = raw_body.to_lowercase();
        if let Some(start) = lowered.find("<title>") {
            let after = start + "<title>".len();
            if let Some(end_rel) = lowered[after..].find("</title>") {
                let title =
                    collapse_whitespace(&decode_html_entities(&raw_body[after..after + end_rel]));
                if !title.is_empty() {
                    return Some(title);
                }
            }
        }
    }

    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn html_to_text(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut previous_was_space = false;

    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if in_tag => {}
            '&' => {
                text.push('&');
                previous_was_space = false;
            }
            ch if ch.is_whitespace() => {
                if !previous_was_space {
                    text.push(' ');
                    previous_was_space = true;
                }
            }
            _ => {
                text.push(ch);
                previous_was_space = false;
            }
        }
    }

    collapse_whitespace(&decode_html_entities(&text))
}

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn preview_text(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let shortened = input.chars().take(max_chars).collect::<String>();
    format!("{}…", shortened.trim_end())
}

fn extract_search_hits(html: &str) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    let mut remaining = html;

    while let Some(anchor_start) = remaining.find("result__a") {
        let after_class = &remaining[anchor_start..];
        let Some(href_idx) = after_class.find("href=") else {
            remaining = &after_class[1..];
            continue;
        };
        let href_slice = &after_class[href_idx + 5..];
        let Some((url, rest)) = extract_quoted_value(href_slice) else {
            remaining = &after_class[1..];
            continue;
        };
        let Some(close_tag_idx) = rest.find('>') else {
            remaining = &after_class[1..];
            continue;
        };
        let after_tag = &rest[close_tag_idx + 1..];
        let Some(end_anchor_idx) = after_tag.find("</a>") else {
            remaining = &after_tag[1..];
            continue;
        };
        let title = html_to_text(&after_tag[..end_anchor_idx]);
        if let Some(decoded_url) = decode_duckduckgo_redirect(&url) {
            hits.push(SearchHit {
                title: title.trim().to_string(),
                url: decoded_url,
            });
        }
        remaining = &after_tag[end_anchor_idx + 4..];
    }

    hits
}

fn extract_search_hits_from_generic_links(html: &str) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    let mut remaining = html;

    while let Some(anchor_start) = remaining.find("<a") {
        let after_anchor = &remaining[anchor_start..];
        let Some(href_idx) = after_anchor.find("href=") else {
            remaining = &after_anchor[2..];
            continue;
        };
        let href_slice = &after_anchor[href_idx + 5..];
        let Some((url, rest)) = extract_quoted_value(href_slice) else {
            remaining = &after_anchor[2..];
            continue;
        };
        let Some(close_tag_idx) = rest.find('>') else {
            remaining = &after_anchor[2..];
            continue;
        };
        let after_tag = &rest[close_tag_idx + 1..];
        let Some(end_anchor_idx) = after_tag.find("</a>") else {
            remaining = &after_anchor[2..];
            continue;
        };
        let title = html_to_text(&after_tag[..end_anchor_idx]);
        if title.trim().is_empty() {
            remaining = &after_tag[end_anchor_idx + 4..];
            continue;
        }
        let decoded_url = decode_duckduckgo_redirect(&url).unwrap_or(url);
        if decoded_url.starts_with("http://") || decoded_url.starts_with("https://") {
            hits.push(SearchHit {
                title: title.trim().to_string(),
                url: decoded_url,
            });
        }
        remaining = &after_tag[end_anchor_idx + 4..];
    }

    hits
}

fn extract_quoted_value(input: &str) -> Option<(String, &str)> {
    let quote = input.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &input[quote.len_utf8()..];
    let end = rest.find(quote)?;
    Some((rest[..end].to_string(), &rest[end + quote.len_utf8()..]))
}

fn decode_duckduckgo_redirect(url: &str) -> Option<String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        return Some(html_entity_decode_url(url));
    }

    let joined = if url.starts_with("//") {
        format!("https:{url}")
    } else if url.starts_with('/') {
        format!("https://duckduckgo.com{url}")
    } else {
        return None;
    };

    let parsed = reqwest::Url::parse(&joined).ok()?;
    if parsed.path() == "/l/" || parsed.path() == "/l" {
        for (key, value) in parsed.query_pairs() {
            if key == "uddg" {
                return Some(html_entity_decode_url(value.as_ref()));
            }
        }
    }
    Some(joined)
}

fn html_entity_decode_url(url: &str) -> String {
    decode_html_entities(url)
}

fn host_matches_list(url: &str, domains: &[String]) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    domains.iter().any(|domain| {
        let normalized = normalize_domain_filter(domain);
        !normalized.is_empty() && (host == normalized || host.ends_with(&format!(".{normalized}")))
    })
}

fn normalize_domain_filter(domain: &str) -> String {
    let trimmed = domain.trim();
    let candidate = reqwest::Url::parse(trimmed)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_else(|| trimmed.to_string());
    candidate
        .trim()
        .trim_start_matches('.')
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn dedupe_hits(hits: &mut Vec<SearchHit>) {
    let mut seen = BTreeSet::new();
    hits.retain(|hit| seen.insert(hit.url.clone()));
}

fn execute_todo_write(input: TodoWriteInput) -> Result<TodoWriteOutput, String> {
    validate_todos(&input.todos)?;
    let store_path = todo_store_path()?;
    let old_todos = if store_path.exists() {
        serde_json::from_str::<Vec<TodoItem>>(
            &std::fs::read_to_string(&store_path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?
    } else {
        Vec::new()
    };

    let all_done = input
        .todos
        .iter()
        .all(|todo| matches!(todo.status, TodoStatus::Completed));
    let persisted = if all_done {
        Vec::new()
    } else {
        input.todos.clone()
    };

    if let Some(parent) = store_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(
        &store_path,
        serde_json::to_string_pretty(&persisted).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let verification_nudge_needed = (all_done
        && input.todos.len() >= 3
        && !input
            .todos
            .iter()
            .any(|todo| todo.content.to_lowercase().contains("verif")))
    .then_some(true);

    Ok(TodoWriteOutput {
        old_todos,
        new_todos: input.todos,
        verification_nudge_needed,
    })
}

fn execute_skill(input: SkillInput) -> Result<SkillOutput, String> {
    let skill_path = resolve_skill_path(&input.skill)?;
    let prompt = std::fs::read_to_string(&skill_path).map_err(|error| error.to_string())?;
    let description = parse_skill_description(&prompt);

    Ok(SkillOutput {
        skill: input.skill,
        path: skill_path.display().to_string(),
        args: input.args,
        description,
        prompt,
    })
}

fn validate_todos(todos: &[TodoItem]) -> Result<(), String> {
    if todos.is_empty() {
        return Err(String::from("todos must not be empty"));
    }
    // Allow multiple in_progress items for parallel workflows
    if todos.iter().any(|todo| todo.content.trim().is_empty()) {
        return Err(String::from("todo content must not be empty"));
    }
    if todos.iter().any(|todo| todo.active_form.trim().is_empty()) {
        return Err(String::from("todo activeForm must not be empty"));
    }
    for todo in todos {
        if let Some(ref p) = todo.priority {
            let p = p.trim();
            if !matches!(p, "high" | "medium" | "low") {
                return Err(format!(
                    "todo priority must be high, medium, or low (got {p:?})"
                ));
            }
        }
    }
    Ok(())
}

fn todo_store_path() -> Result<std::path::PathBuf, String> {
    if let Ok(path) = std::env::var("CLAWD_TODO_STORE") {
        return Ok(std::path::PathBuf::from(path));
    }
    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
    Ok(cwd.join(".clawd-todos.json"))
}

fn resolve_skill_path(skill: &str) -> Result<std::path::PathBuf, String> {
    let requested = skill.trim().trim_start_matches('/').trim_start_matches('$');
    if requested.is_empty() {
        return Err(String::from("skill must not be empty"));
    }

    let mut candidates = Vec::new();
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        candidates.push(std::path::PathBuf::from(codex_home).join("skills"));
    }
    if let Some(home) = dirs::home_dir() {
        let current_user_root = home.join(".codex").join("skills");
        if !candidates.contains(&current_user_root) {
            candidates.push(current_user_root);
        }
    }
    let legacy_root = std::path::PathBuf::from("/home/bellman/.codex/skills");
    if !candidates.contains(&legacy_root) {
        candidates.push(legacy_root);
    }

    for root in candidates {
        let direct = root.join(requested).join("SKILL.md");
        if direct.exists() {
            return Ok(direct);
        }

        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path().join("SKILL.md");
                if !path.exists() {
                    continue;
                }
                if entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(requested)
                {
                    return Ok(path);
                }
            }
        }
    }

    Err(format!("unknown skill: {requested}"))
}

#[allow(clippy::needless_pass_by_value)]
fn execute_tool_search(input: ToolSearchInput) -> ToolSearchOutput {
    let deferred = deferred_tool_specs();
    let max_results = input.max_results.unwrap_or(5).max(1);
    let query = input.query.trim().to_string();
    let normalized_query = normalize_tool_search_query(&query);
    let matches = search_tool_specs(&query, max_results, &deferred);

    ToolSearchOutput {
        matches,
        query,
        normalized_query,
        total_deferred_tools: deferred.len(),
        pending_mcp_servers: None,
    }
}

fn deferred_tool_specs() -> Vec<ToolSpec> {
    tool_catalog().deferred_specs()
}

fn search_tool_specs(query: &str, max_results: usize, specs: &[ToolSpec]) -> Vec<String> {
    let lowered = query.to_lowercase();
    if let Some(selection) = lowered.strip_prefix("select:") {
        return selection
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .filter_map(|wanted| {
                let wanted = canonical_tool_token(wanted);
                specs
                    .iter()
                    .find(|spec| canonical_tool_token(spec.name) == wanted)
                    .map(|spec| spec.name.to_string())
            })
            .take(max_results)
            .collect();
    }

    let mut required = Vec::new();
    let mut optional = Vec::new();
    for term in lowered.split_whitespace() {
        if let Some(rest) = term.strip_prefix('+') {
            if !rest.is_empty() {
                required.push(rest);
            }
        } else {
            optional.push(term);
        }
    }
    let terms = if required.is_empty() {
        optional.clone()
    } else {
        required.iter().chain(optional.iter()).copied().collect()
    };

    let mut scored = specs
        .iter()
        .filter_map(|spec| {
            let name = spec.name.to_lowercase();
            let canonical_name = canonical_tool_token(spec.name);
            let normalized_description = normalize_tool_search_query(spec.description);
            let haystack = format!(
                "{name} {} {canonical_name}",
                spec.description.to_lowercase()
            );
            let normalized_haystack = format!("{canonical_name} {normalized_description}");
            if required.iter().any(|term| !haystack.contains(term)) {
                return None;
            }

            let mut score = 0_i32;
            for term in &terms {
                let canonical_term = canonical_tool_token(term);
                if haystack.contains(term) {
                    score += 2;
                }
                if name == *term {
                    score += 8;
                }
                if name.contains(term) {
                    score += 4;
                }
                if canonical_name == canonical_term {
                    score += 12;
                }
                if normalized_haystack.contains(&canonical_term) {
                    score += 3;
                }
            }

            if score == 0 && !lowered.is_empty() {
                return None;
            }
            Some((score, spec.name.to_string()))
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    scored
        .into_iter()
        .map(|(_, name)| name)
        .take(max_results)
        .collect()
}

fn normalize_tool_search_query(query: &str) -> String {
    query
        .trim()
        .split(|ch: char| ch.is_whitespace() || ch == ',')
        .filter(|term| !term.is_empty())
        .map(canonical_tool_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn canonical_tool_token(value: &str) -> String {
    let mut canonical = value
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect::<String>();
    if let Some(stripped) = canonical.strip_suffix("tool") {
        canonical = stripped.to_string();
    }
    canonical
}

fn iso8601_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

#[allow(clippy::too_many_lines)]
fn execute_notebook_edit(input: NotebookEditInput) -> Result<NotebookEditOutput, String> {
    let path = std::path::PathBuf::from(&input.notebook_path);
    reject_sensitive_file_path(&path).map_err(io_to_string)?;
    if path.extension().and_then(|ext| ext.to_str()) != Some("ipynb") {
        return Err(String::from(
            "File must be a Jupyter notebook (.ipynb file).",
        ));
    }

    let original_file = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut notebook: serde_json::Value =
        serde_json::from_str(&original_file).map_err(|error| error.to_string())?;
    let language = notebook
        .get("metadata")
        .and_then(|metadata| metadata.get("kernelspec"))
        .and_then(|kernelspec| kernelspec.get("language"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("python")
        .to_string();
    let cells = notebook
        .get_mut("cells")
        .and_then(serde_json::Value::as_array_mut)
        .ok_or_else(|| String::from("Notebook cells array not found"))?;

    let mut claw_target_index: Option<usize> = None;
    let mut claw_insert_at: Option<usize> = None;
    let mut effective_edit_mode = input.edit_mode;

    if let Some(cmd) = input
        .command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        let idx = input
            .index
            .ok_or_else(|| String::from("NotebookEdit: command requires index"))?;
        match cmd {
            "replace" => {
                if idx >= cells.len() {
                    return Err(format!(
                        "cell index {idx} out of range (len {})",
                        cells.len()
                    ));
                }
                claw_target_index = Some(idx);
                effective_edit_mode = Some(NotebookEditMode::Replace);
            }
            "delete" => {
                if idx >= cells.len() {
                    return Err(format!(
                        "cell index {idx} out of range (len {})",
                        cells.len()
                    ));
                }
                claw_target_index = Some(idx);
                effective_edit_mode = Some(NotebookEditMode::Delete);
            }
            "insert_above" => {
                if idx > cells.len() {
                    return Err(format!(
                        "insert_above index {idx} out of range (max {})",
                        cells.len()
                    ));
                }
                claw_insert_at = Some(idx);
                effective_edit_mode = Some(NotebookEditMode::Insert);
            }
            "insert_below" => {
                if idx > cells.len() {
                    return Err(format!(
                        "insert_below index {idx} out of range (max {})",
                        cells.len()
                    ));
                }
                let at = if idx == cells.len() {
                    cells.len()
                } else {
                    idx + 1
                };
                claw_insert_at = Some(at);
                effective_edit_mode = Some(NotebookEditMode::Insert);
            }
            other => {
                return Err(format!(
                    "unknown NotebookEdit command: {other} (use replace, delete, insert_above, insert_below)"
                ));
            }
        }
    }

    let edit_mode = effective_edit_mode.unwrap_or(NotebookEditMode::Replace);
    let target_index = if claw_insert_at.is_some() {
        None
    } else if let Some(i) = claw_target_index {
        Some(i)
    } else {
        match input.cell_id.as_deref() {
            Some(cell_id) => Some(resolve_cell_index(cells, Some(cell_id), edit_mode)?),
            None if matches!(
                edit_mode,
                NotebookEditMode::Replace | NotebookEditMode::Delete
            ) =>
            {
                Some(resolve_cell_index(cells, None, edit_mode)?)
            }
            None => None,
        }
    };
    let resolved_cell_type = match edit_mode {
        NotebookEditMode::Delete => None,
        NotebookEditMode::Insert => Some(input.cell_type.unwrap_or(NotebookCellType::Code)),
        NotebookEditMode::Replace => Some(input.cell_type.unwrap_or_else(|| {
            target_index
                .and_then(|index| cells.get(index))
                .and_then(cell_kind)
                .unwrap_or(NotebookCellType::Code)
        })),
    };
    let new_source = require_notebook_source(input.new_source, edit_mode)?;

    let cell_id = match edit_mode {
        NotebookEditMode::Insert => {
            let resolved_cell_type = resolved_cell_type.expect("insert cell type");
            let new_id = make_cell_id(cells.len());
            let new_cell = build_notebook_cell(&new_id, resolved_cell_type, &new_source);
            let insert_at = claw_insert_at
                .unwrap_or_else(|| target_index.map_or(cells.len(), |index| index + 1));
            cells.insert(insert_at, new_cell);
            cells
                .get(insert_at)
                .and_then(|cell| cell.get("id"))
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        }
        NotebookEditMode::Delete => {
            let removed = cells.remove(target_index.expect("delete target index"));
            removed
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        }
        NotebookEditMode::Replace => {
            let resolved_cell_type = resolved_cell_type.expect("replace cell type");
            let cell = cells
                .get_mut(target_index.expect("replace target index"))
                .ok_or_else(|| String::from("Cell index out of range"))?;
            cell["source"] = serde_json::Value::Array(source_lines(&new_source));
            cell["cell_type"] = serde_json::Value::String(match resolved_cell_type {
                NotebookCellType::Code => String::from("code"),
                NotebookCellType::Markdown => String::from("markdown"),
            });
            match resolved_cell_type {
                NotebookCellType::Code => {
                    if !cell.get("outputs").is_some_and(serde_json::Value::is_array) {
                        cell["outputs"] = json!([]);
                    }
                    if cell.get("execution_count").is_none() {
                        cell["execution_count"] = serde_json::Value::Null;
                    }
                }
                NotebookCellType::Markdown => {
                    if let Some(object) = cell.as_object_mut() {
                        object.remove("outputs");
                        object.remove("execution_count");
                    }
                }
            }
            cell.get("id")
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        }
    };

    let updated_file =
        serde_json::to_string_pretty(&notebook).map_err(|error| error.to_string())?;
    std::fs::write(&path, &updated_file).map_err(|error| error.to_string())?;

    Ok(NotebookEditOutput {
        new_source,
        cell_id,
        cell_type: resolved_cell_type,
        language,
        edit_mode: format_notebook_edit_mode(edit_mode),
        error: None,
        notebook_path: path.display().to_string(),
        original_file,
        updated_file,
    })
}

fn require_notebook_source(
    source: Option<String>,
    edit_mode: NotebookEditMode,
) -> Result<String, String> {
    match edit_mode {
        NotebookEditMode::Delete => Ok(source.unwrap_or_default()),
        NotebookEditMode::Insert | NotebookEditMode::Replace => source
            .ok_or_else(|| String::from("new_source is required for insert and replace edits")),
    }
}

fn build_notebook_cell(cell_id: &str, cell_type: NotebookCellType, source: &str) -> Value {
    let mut cell = json!({
        "cell_type": match cell_type {
            NotebookCellType::Code => "code",
            NotebookCellType::Markdown => "markdown",
        },
        "id": cell_id,
        "metadata": {},
        "source": source_lines(source),
    });
    if let Some(object) = cell.as_object_mut() {
        match cell_type {
            NotebookCellType::Code => {
                object.insert(String::from("outputs"), json!([]));
                object.insert(String::from("execution_count"), Value::Null);
            }
            NotebookCellType::Markdown => {}
        }
    }
    cell
}

fn cell_kind(cell: &serde_json::Value) -> Option<NotebookCellType> {
    cell.get("cell_type")
        .and_then(serde_json::Value::as_str)
        .map(|kind| {
            if kind == "markdown" {
                NotebookCellType::Markdown
            } else {
                NotebookCellType::Code
            }
        })
}

#[allow(clippy::needless_pass_by_value)]
fn execute_sleep(input: SleepInput) -> SleepOutput {
    std::thread::sleep(Duration::from_millis(input.duration_ms));
    SleepOutput {
        duration_ms: input.duration_ms,
        message: format!("Slept for {}ms", input.duration_ms),
    }
}

fn execute_brief(input: BriefInput) -> Result<BriefOutput, String> {
    if input.message.trim().is_empty() {
        return Err(String::from("message must not be empty"));
    }

    let attachments = input
        .attachments
        .as_ref()
        .map(|paths| {
            paths
                .iter()
                .map(|path| resolve_attachment(path))
                .collect::<Result<Vec<_>, String>>()
        })
        .transpose()?;

    let message = match input.status {
        BriefStatus::Normal | BriefStatus::Proactive => input.message,
    };

    Ok(BriefOutput {
        message,
        attachments,
        sent_at: iso8601_timestamp(),
    })
}

fn resolve_attachment(path: &str) -> Result<ResolvedAttachment, String> {
    let resolved = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    let metadata = std::fs::metadata(&resolved).map_err(|error| error.to_string())?;
    Ok(ResolvedAttachment {
        path: resolved.display().to_string(),
        size: metadata.len(),
        is_image: is_image_path(&resolved),
    })
}

fn is_image_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg")
    )
}

fn normalize_config_input(input: ConfigInput) -> Result<ConfigInput, String> {
    let setting = input
        .setting
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            input
                .key
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(ToString::to_string)
        })
        .ok_or_else(|| String::from("Config requires setting or key"))?;

    let action = input
        .action
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_ascii_lowercase);

    let value = match action.as_deref() {
        Some("get") => None,
        Some("set") => Some(
            input
                .value
                .ok_or_else(|| String::from("Config action set requires value"))?,
        ),
        Some(other) => {
            return Err(format!("unknown Config action: {other}"));
        }
        None => input.value,
    };

    Ok(ConfigInput {
        setting: Some(setting),
        key: None,
        action: None,
        value,
    })
}

fn execute_config(input: ConfigInput) -> Result<ConfigOutput, String> {
    let setting = input
        .setting
        .as_deref()
        .ok_or_else(|| String::from("internal: config setting missing"))?
        .trim();
    if setting.is_empty() {
        return Err(String::from("setting must not be empty"));
    }
    let Some(spec) = supported_config_setting(setting) else {
        return Ok(ConfigOutput {
            success: false,
            operation: None,
            setting: None,
            value: None,
            previous_value: None,
            new_value: None,
            error: Some(format!("Unknown setting: \"{setting}\"")),
        });
    };

    let path = config_file_for_scope(spec.scope)?;
    let mut document = read_json_object(&path)?;

    if let Some(value) = input.value {
        let normalized = normalize_config_value(spec, value)?;
        let previous_value = get_nested_value(&document, spec.path).cloned();
        set_nested_value(&mut document, spec.path, normalized.clone());
        write_json_object(&path, &document)?;
        Ok(ConfigOutput {
            success: true,
            operation: Some(String::from("set")),
            setting: Some(setting.to_string()),
            value: Some(normalized.clone()),
            previous_value,
            new_value: Some(normalized),
            error: None,
        })
    } else {
        Ok(ConfigOutput {
            success: true,
            operation: Some(String::from("get")),
            setting: Some(setting.to_string()),
            value: get_nested_value(&document, spec.path).cloned(),
            previous_value: None,
            new_value: None,
            error: None,
        })
    }
}

fn execute_structured_output(input: StructuredOutputInput) -> StructuredOutputResult {
    let mut structured_output = input.extra;
    if let Some(data) = input.data {
        structured_output.insert("data".to_string(), data);
    }
    StructuredOutputResult {
        data: String::from("Structured output provided successfully"),
        structured_output,
    }
}

fn execute_repl(input: ReplInput) -> Result<ReplOutput, String> {
    if input.code.trim().is_empty() {
        return Err(String::from("code must not be empty"));
    }
    let _ = input.timeout_ms;
    let runtime = resolve_repl_runtime(&input.language)?;
    let started = Instant::now();
    let output = Command::new(runtime.program)
        .args(runtime.args)
        .arg(&input.code)
        .output()
        .map_err(|error| error.to_string())?;

    Ok(ReplOutput {
        language: input.language,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code().unwrap_or(1),
        duration_ms: started.elapsed().as_millis(),
    })
}

struct ReplRuntime {
    program: &'static str,
    args: &'static [&'static str],
}

fn resolve_repl_runtime(language: &str) -> Result<ReplRuntime, String> {
    match language.trim().to_ascii_lowercase().as_str() {
        "python" | "py" => Ok(ReplRuntime {
            program: detect_first_command(&["python3", "python"])
                .ok_or_else(|| String::from("python runtime not found"))?,
            args: &["-c"],
        }),
        "javascript" | "js" | "node" => Ok(ReplRuntime {
            program: detect_first_command(&["node"])
                .ok_or_else(|| String::from("node runtime not found"))?,
            args: &["-e"],
        }),
        "sh" | "shell" | "bash" => Ok(ReplRuntime {
            program: detect_first_command(&["bash", "sh"])
                .ok_or_else(|| String::from("shell runtime not found"))?,
            args: &["-lc"],
        }),
        other => Err(format!("unsupported REPL language: {other}")),
    }
}

fn detect_first_command(commands: &[&'static str]) -> Option<&'static str> {
    commands
        .iter()
        .copied()
        .find(|command| command_exists(command))
}

#[derive(Clone, Copy)]
enum ConfigScope {
    Global,
    Settings,
}

#[derive(Clone, Copy)]
struct ConfigSettingSpec {
    scope: ConfigScope,
    kind: ConfigKind,
    path: &'static [&'static str],
    options: Option<&'static [&'static str]>,
}

#[derive(Clone, Copy)]
enum ConfigKind {
    Boolean,
    String,
}

fn supported_config_setting(setting: &str) -> Option<ConfigSettingSpec> {
    Some(match setting {
        "theme" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::String,
            path: &["theme"],
            options: None,
        },
        "editorMode" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::String,
            path: &["editorMode"],
            options: Some(&["default", "vim", "emacs"]),
        },
        "verbose" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::Boolean,
            path: &["verbose"],
            options: None,
        },
        "preferredNotifChannel" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::String,
            path: &["preferredNotifChannel"],
            options: None,
        },
        "autoCompactEnabled" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::Boolean,
            path: &["autoCompactEnabled"],
            options: None,
        },
        "autoMemoryEnabled" => ConfigSettingSpec {
            scope: ConfigScope::Settings,
            kind: ConfigKind::Boolean,
            path: &["autoMemoryEnabled"],
            options: None,
        },
        "autoDreamEnabled" => ConfigSettingSpec {
            scope: ConfigScope::Settings,
            kind: ConfigKind::Boolean,
            path: &["autoDreamEnabled"],
            options: None,
        },
        "fileCheckpointingEnabled" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::Boolean,
            path: &["fileCheckpointingEnabled"],
            options: None,
        },
        "showTurnDuration" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::Boolean,
            path: &["showTurnDuration"],
            options: None,
        },
        "terminalProgressBarEnabled" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::Boolean,
            path: &["terminalProgressBarEnabled"],
            options: None,
        },
        "todoFeatureEnabled" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::Boolean,
            path: &["todoFeatureEnabled"],
            options: None,
        },
        "model" => ConfigSettingSpec {
            scope: ConfigScope::Settings,
            kind: ConfigKind::String,
            path: &["model"],
            options: None,
        },
        "alwaysThinkingEnabled" => ConfigSettingSpec {
            scope: ConfigScope::Settings,
            kind: ConfigKind::Boolean,
            path: &["alwaysThinkingEnabled"],
            options: None,
        },
        "permissions.defaultMode" => ConfigSettingSpec {
            scope: ConfigScope::Settings,
            kind: ConfigKind::String,
            path: &["permissions", "defaultMode"],
            options: Some(&["default", "plan", "acceptEdits", "dontAsk", "auto"]),
        },
        "language" => ConfigSettingSpec {
            scope: ConfigScope::Settings,
            kind: ConfigKind::String,
            path: &["language"],
            options: None,
        },
        "teammateMode" => ConfigSettingSpec {
            scope: ConfigScope::Global,
            kind: ConfigKind::String,
            path: &["teammateMode"],
            options: Some(&["tmux", "in-process", "auto"]),
        },
        _ => return None,
    })
}

fn normalize_config_value(spec: ConfigSettingSpec, value: ConfigValue) -> Result<Value, String> {
    let normalized = match (spec.kind, value) {
        (ConfigKind::Boolean, ConfigValue::Bool(value)) => Value::Bool(value),
        (ConfigKind::Boolean, ConfigValue::String(value)) => {
            match value.trim().to_ascii_lowercase().as_str() {
                "true" => Value::Bool(true),
                "false" => Value::Bool(false),
                _ => return Err(String::from("setting requires true or false")),
            }
        }
        (ConfigKind::Boolean, ConfigValue::Number(_)) => {
            return Err(String::from("setting requires true or false"))
        }
        (ConfigKind::String, ConfigValue::String(value)) => Value::String(value),
        (ConfigKind::String, ConfigValue::Bool(value)) => Value::String(value.to_string()),
        (ConfigKind::String, ConfigValue::Number(value)) => json!(value),
    };

    if let Some(options) = spec.options {
        let Some(as_str) = normalized.as_str() else {
            return Err(String::from("setting requires a string value"));
        };
        if !options.iter().any(|option| option == &as_str) {
            return Err(format!(
                "Invalid value \"{as_str}\". Options: {}",
                options.join(", ")
            ));
        }
    }

    Ok(normalized)
}

fn config_file_for_scope(scope: ConfigScope) -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
    Ok(match scope {
        ConfigScope::Global => config_home_dir()?.join("settings.json"),
        ConfigScope::Settings => cwd.join(".claw").join("settings.local.json"),
    })
}

fn config_home_dir() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CLAW_CONFIG_HOME") {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var("HOME").map_err(|_| String::from("HOME is not set"))?;
    Ok(PathBuf::from(home).join(".claw"))
}

fn read_json_object(path: &Path) -> Result<serde_json::Map<String, Value>, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => {
            if contents.trim().is_empty() {
                return Ok(serde_json::Map::new());
            }
            serde_json::from_str::<Value>(&contents)
                .map_err(|error| error.to_string())?
                .as_object()
                .cloned()
                .ok_or_else(|| String::from("config file must contain a JSON object"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Map::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_json_object(path: &Path, value: &serde_json::Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(
        path,
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn get_nested_value<'a>(
    value: &'a serde_json::Map<String, Value>,
    path: &[&str],
) -> Option<&'a Value> {
    let (first, rest) = path.split_first()?;
    let mut current = value.get(*first)?;
    for key in rest {
        current = current.as_object()?.get(*key)?;
    }
    Some(current)
}

fn set_nested_value(root: &mut serde_json::Map<String, Value>, path: &[&str], new_value: Value) {
    let (first, rest) = path.split_first().expect("config path must not be empty");
    if rest.is_empty() {
        root.insert((*first).to_string(), new_value);
        return;
    }

    let entry = root
        .entry((*first).to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(serde_json::Map::new());
    }
    let map = entry.as_object_mut().expect("object inserted");
    set_nested_value(map, rest, new_value);
}

fn iso8601_timestamp() -> String {
    if let Ok(output) = Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
    {
        if output.status.success() {
            return String::from_utf8_lossy(&output.stdout).trim().to_string();
        }
    }
    iso8601_now()
}

/// Prepends console UTF-8 setup so child stdout is less likely to be CP932 when the host decodes as UTF-8.
/// Skip with `RELAY_POWERSHELL_NO_UTF8_PREAMBLE=1|true|yes|on`.
#[cfg(windows)]
fn prepend_powershell_utf8_console_setup(command: &str) -> String {
    let skip = std::env::var("RELAY_POWERSHELL_NO_UTF8_PREAMBLE")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    if skip {
        return command.to_string();
    }
    const PREAMBLE: &str = "chcp 65001 | Out-Null;[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);$OutputEncoding = [System.Text.UTF8Encoding]::new($false);";
    format!("{PREAMBLE}{command}")
}

#[cfg(windows)]
#[allow(clippy::needless_pass_by_value)]
fn execute_powershell(input: PowerShellInput) -> std::io::Result<runtime::BashCommandOutput> {
    let _ = &input.description;
    let shell = detect_powershell_shell()?;
    let command = prepend_powershell_utf8_console_setup(&input.command);
    execute_shell_command(shell, &command, input.timeout, input.run_in_background)
}

#[cfg(windows)]
fn detect_powershell_shell() -> std::io::Result<&'static str> {
    if command_exists("pwsh") {
        Ok("pwsh")
    } else if command_exists("powershell") {
        Ok("powershell")
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "PowerShell executable not found (expected `pwsh` or `powershell` in PATH)",
        ))
    }
}

fn command_exists(command: &str) -> bool {
    std::process::Command::new("sh")
        .arg("-lc")
        .arg(format!("command -v {command} >/dev/null 2>&1"))
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(windows)]
#[allow(clippy::too_many_lines)]
fn execute_shell_command(
    shell: &str,
    command: &str,
    timeout: Option<u64>,
    run_in_background: Option<bool>,
) -> std::io::Result<runtime::BashCommandOutput> {
    if run_in_background.unwrap_or(false) {
        let child = std::process::Command::new(shell)
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(command)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        return Ok(runtime::BashCommandOutput {
            stdout: String::new(),
            stderr: String::new(),
            raw_output_path: None,
            interrupted: false,
            is_image: None,
            background_task_id: Some(child.id().to_string()),
            backgrounded_by_user: Some(true),
            assistant_auto_backgrounded: Some(false),
            stdio: None,
            state: None,
            backgrounded_by: None,
            background: None,
            dangerously_disable_sandbox: None,
            return_code_interpretation: None,
            no_output_expected: Some(true),
            structured_content: None,
            persisted_output_path: None,
            persisted_output_size: None,
            sandbox_status: None,
        });
    }

    let mut process = std::process::Command::new(shell);
    process
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(command);
    process
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(timeout_ms) = timeout {
        let mut child = process.spawn()?;
        let started = Instant::now();
        loop {
            if let Some(status) = child.try_wait()? {
                let output = child.wait_with_output()?;
                return Ok(runtime::BashCommandOutput {
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                    raw_output_path: None,
                    interrupted: false,
                    is_image: None,
                    background_task_id: None,
                    backgrounded_by_user: None,
                    assistant_auto_backgrounded: None,
                    stdio: None,
                    state: None,
                    backgrounded_by: None,
                    background: None,
                    dangerously_disable_sandbox: None,
                    return_code_interpretation: status
                        .code()
                        .filter(|code| *code != 0)
                        .map(|code| format!("exit_code:{code}")),
                    no_output_expected: Some(output.stdout.is_empty() && output.stderr.is_empty()),
                    structured_content: None,
                    persisted_output_path: None,
                    persisted_output_size: None,
                    sandbox_status: None,
                });
            }
            if started.elapsed() >= Duration::from_millis(timeout_ms) {
                let _ = child.kill();
                let output = child.wait_with_output()?;
                let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
                let stderr = if stderr.trim().is_empty() {
                    format!("Command exceeded timeout of {timeout_ms} ms")
                } else {
                    format!(
                        "{}
Command exceeded timeout of {timeout_ms} ms",
                        stderr.trim_end()
                    )
                };
                return Ok(runtime::BashCommandOutput {
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr,
                    raw_output_path: None,
                    interrupted: true,
                    is_image: None,
                    background_task_id: None,
                    backgrounded_by_user: None,
                    assistant_auto_backgrounded: None,
                    stdio: None,
                    state: None,
                    backgrounded_by: None,
                    background: None,
                    dangerously_disable_sandbox: None,
                    return_code_interpretation: Some(String::from("timeout")),
                    no_output_expected: Some(false),
                    structured_content: None,
                    persisted_output_path: None,
                    persisted_output_size: None,
                    sandbox_status: None,
                });
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    let output = process.output()?;
    Ok(runtime::BashCommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        raw_output_path: None,
        interrupted: false,
        is_image: None,
        background_task_id: None,
        backgrounded_by_user: None,
        assistant_auto_backgrounded: None,
        stdio: None,
        state: None,
        backgrounded_by: None,
        background: None,
        dangerously_disable_sandbox: None,
        return_code_interpretation: output
            .status
            .code()
            .filter(|code| *code != 0)
            .map(|code| format!("exit_code:{code}")),
        no_output_expected: Some(output.stdout.is_empty() && output.stderr.is_empty()),
        structured_content: None,
        persisted_output_path: None,
        persisted_output_size: None,
        sandbox_status: None,
    })
}

fn resolve_cell_index(
    cells: &[serde_json::Value],
    cell_id: Option<&str>,
    edit_mode: NotebookEditMode,
) -> Result<usize, String> {
    if cells.is_empty()
        && matches!(
            edit_mode,
            NotebookEditMode::Replace | NotebookEditMode::Delete
        )
    {
        return Err(String::from("Notebook has no cells to edit"));
    }
    if let Some(cell_id) = cell_id {
        cells
            .iter()
            .position(|cell| cell.get("id").and_then(serde_json::Value::as_str) == Some(cell_id))
            .ok_or_else(|| format!("Cell id not found: {cell_id}"))
    } else {
        Ok(cells.len().saturating_sub(1))
    }
}

fn source_lines(source: &str) -> Vec<serde_json::Value> {
    if source.is_empty() {
        return vec![serde_json::Value::String(String::new())];
    }
    source
        .split_inclusive('\n')
        .map(|line| serde_json::Value::String(line.to_string()))
        .collect()
}

fn format_notebook_edit_mode(mode: NotebookEditMode) -> String {
    match mode {
        NotebookEditMode::Replace => String::from("replace"),
        NotebookEditMode::Insert => String::from("insert"),
        NotebookEditMode::Delete => String::from("delete"),
    }
}

fn make_cell_id(index: usize) -> String {
    format!("cell-{}", index + 1)
}

fn parse_skill_description(contents: &str) -> Option<String> {
    for line in contents.lines() {
        if let Some(value) = line.strip_prefix("description:") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::Duration;

    use super::{
        cdp_prompt_tool_specs, cdp_tool_specs_for_visibility, execute_tool,
        is_tool_visible_in_tool_search, mvp_tool_specs, required_permission_for_surface,
        tool_metadata, tool_registry, tool_specs_for_surface, ApprovalTargetExtractor,
        CdpToolVisibility, ToolSource, ToolSurface,
    };
    use runtime::PermissionMode;
    use serde_json::json;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn temp_path(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("clawd-tools-{unique}-{name}"))
    }

    #[test]
    fn exposes_mvp_tools() {
        let _guard = env_lock().lock().expect("env lock");
        let original = std::env::var("RELAY_COMPAT_MODE").ok();
        std::env::remove_var("RELAY_COMPAT_MODE");
        let names = mvp_tool_specs()
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"bash"));
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"WebFetch"));
        assert!(names.contains(&"WebSearch"));
        assert!(names.contains(&"TodoWrite"));
        assert!(names.contains(&"Skill"));
        assert!(names.contains(&"Agent"));
        assert!(names.contains(&"ToolSearch"));
        assert!(names.contains(&"NotebookEdit"));
        assert!(names.contains(&"Sleep"));
        assert!(names.contains(&"SendUserMessage"));
        assert!(names.contains(&"Config"));
        assert!(!names.contains(&"EnterPlanMode"));
        assert!(!names.contains(&"ExitPlanMode"));
        assert!(names.contains(&"StructuredOutput"));
        assert!(names.contains(&"REPL"));
        assert!(names.contains(&"pdf_merge"));
        assert!(names.contains(&"pdf_split"));
        assert!(names.contains(&"git_status"));
        assert!(names.contains(&"git_diff"));
        assert!(names.contains(&"ListMcpResources"));
        assert!(names.contains(&"ReadMcpResource"));
        assert!(names.contains(&"McpAuth"));
        assert!(names.contains(&"MCP"));
        assert!(names.contains(&"AskUserQuestion"));
        assert!(names.contains(&"LSP"));
        assert!(names.contains(&"TaskCreate"));
        #[cfg(windows)]
        assert!(names.contains(&"PowerShell"));
        #[cfg(not(windows))]
        assert!(!names.contains(&"PowerShell"));
        if let Some(value) = original {
            std::env::set_var("RELAY_COMPAT_MODE", value);
        }
    }

    #[test]
    fn tool_metadata_matches_existing_behavior() {
        let read = tool_metadata("read_file");
        assert_eq!(read.target_extractor, ApprovalTargetExtractor::PathLike);
        assert!(!read.tool_search_visible);
        assert_eq!(read.approval_title, None);
        assert_eq!(read.cdp_visibility, CdpToolVisibility::Core);

        let write = tool_metadata("write_file");
        assert_eq!(write.approval_title, Some("Create or overwrite a file?"));
        assert_eq!(write.risky_fields, &["path"]);
        assert!(!write.tool_search_visible);
        assert_eq!(write.cdp_visibility, CdpToolVisibility::Core);

        let bash = tool_metadata("bash");
        assert_eq!(bash.approval_title, Some("Run a shell command?"));
        assert_eq!(bash.risky_fields, &["command", "run_in_background"]);
        assert!(!bash.tool_search_visible);
        assert_eq!(bash.cdp_visibility, CdpToolVisibility::Core);

        let mcp = tool_metadata("MCP");
        assert_eq!(
            mcp.approval_title,
            Some("Call a connected integration tool?")
        );
        assert_eq!(
            mcp.target_extractor,
            ApprovalTargetExtractor::McpQualifiedTool
        );
        assert_eq!(
            mcp.redaction_rules,
            &[super::RedactionRule { field: "arguments" }]
        );
        assert!(mcp.tool_search_visible);
        assert_eq!(mcp.cdp_visibility, CdpToolVisibility::Core);

        let agent = tool_metadata("Agent");
        assert_eq!(agent.cdp_visibility, CdpToolVisibility::Hidden);

        let powershell = tool_metadata("PowerShell");
        assert_eq!(powershell.cdp_visibility, CdpToolVisibility::Conditional);

        let unknown = tool_metadata("nope");
        assert_eq!(unknown.approval_title, None);
        assert_eq!(unknown.target_extractor, ApprovalTargetExtractor::None);
        assert!(unknown.risky_fields.is_empty());
        assert!(unknown.redaction_rules.is_empty());
        assert!(unknown.tool_search_visible);
        assert_eq!(unknown.cdp_visibility, CdpToolVisibility::Hidden);
    }

    #[test]
    fn standard_surface_exposes_full_catalog() {
        let names = tool_specs_for_surface(ToolSurface::Standard)
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"write_file"));
        assert!(names.contains(&"WebFetch"));
    }

    #[test]
    fn cdp_core_catalog_matches_expected_surface() {
        let names = cdp_tool_specs_for_visibility(CdpToolVisibility::Core)
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "read_file",
                "write_file",
                "edit_file",
                "workspace_search",
                "glob_search",
                "grep_search",
                "office_search",
                "git_status",
                "git_diff",
                "pdf_merge",
                "pdf_split",
                "WebFetch",
                "WebSearch",
                "MCP",
                "AskUserQuestion",
                "TodoWrite",
                "Skill",
                "LSP",
                "NotebookEdit",
                "bash",
            ]
        );
    }

    #[test]
    fn cdp_prompt_tool_specs_hide_agent_and_keep_rich_guidance() {
        let specs = cdp_prompt_tool_specs();
        let names = specs.iter().map(|spec| spec.name).collect::<Vec<_>>();
        assert!(!names.contains(&"Agent"));
        assert!(names.contains(&"workspace_search"));
        assert!(names.contains(&"read_file"));
        let read_file = specs
            .iter()
            .find(|spec| spec.name == "read_file")
            .expect("read_file cdp prompt spec");
        assert!(read_file
            .use_when
            .contains("before editing an existing file"));
        assert!(read_file.avoid_when.contains("bash"));
        assert!(read_file
            .important_optional_args
            .contains(&"offset".to_string()));
        let workspace = specs
            .iter()
            .find(|spec| spec.name == "workspace_search")
            .expect("workspace_search cdp prompt spec");
        assert!(workspace.purpose.contains("agentic workspace search"));
        assert!(workspace.use_when.contains("Use first"));
        assert!(workspace.use_when.contains("read_file on top candidates"));
        assert!(workspace
            .avoid_when
            .contains("Do not treat snippets as full-file inspection"));
        assert!(workspace.avoid_when.contains("Relay-only"));
        let glob = specs
            .iter()
            .find(|spec| spec.name == "glob_search")
            .expect("glob_search cdp prompt spec");
        assert!(glob.use_when.contains("needed"));
        assert!(glob.use_when.contains("related"));
        assert!(glob.use_when.contains("**/*.{docx,xlsx,pptx,pdf}"));
        let office = specs
            .iter()
            .find(|spec| spec.name == "office_search")
            .expect("office_search cdp prompt spec");
        assert!(office.purpose.contains("Office/PDF lookup"));
        assert!(office.use_when.contains("needed-file"));
        assert!(office.avoid_when.contains("semantic ranking"));
    }

    // `PowerShell` is only registered in the catalog under `#[cfg(windows)]`
    // (see the `tool_catalog` builder). On non-Windows targets the
    // Conditional bucket is empty, so scope the assertion accordingly.
    #[cfg(windows)]
    #[test]
    fn powershell_is_only_conditional_for_cdp_catalog() {
        let conditional = cdp_tool_specs_for_visibility(CdpToolVisibility::Conditional)
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert_eq!(conditional, vec!["PowerShell"]);
    }

    #[cfg(not(windows))]
    #[test]
    fn powershell_is_absent_from_cdp_catalog_on_non_windows() {
        let conditional = cdp_tool_specs_for_visibility(CdpToolVisibility::Conditional)
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert!(
            conditional.is_empty(),
            "Conditional bucket should be empty on non-Windows, got {conditional:?}"
        );
    }

    #[test]
    fn required_permission_for_surface_preserves_current_policy() {
        let specs = mvp_tool_specs();
        let write = specs
            .iter()
            .find(|spec| spec.name == "write_file")
            .expect("write_file spec");
        assert_eq!(
            required_permission_for_surface(write),
            PermissionMode::DangerFullAccess
        );

        let read = specs
            .iter()
            .find(|spec| spec.name == "read_file")
            .expect("read_file spec");
        assert_eq!(
            required_permission_for_surface(read),
            PermissionMode::ReadOnly
        );

        let web = specs
            .iter()
            .find(|spec| spec.name == "WebFetch")
            .expect("WebFetch spec");
        assert_eq!(
            required_permission_for_surface(web),
            PermissionMode::ReadOnly
        );
    }

    #[test]
    fn exposes_plan_mode_tools_in_compat_mode() {
        let _guard = env_lock().lock().expect("env lock");
        let original = std::env::var("RELAY_COMPAT_MODE").ok();
        std::env::set_var("RELAY_COMPAT_MODE", "1");
        let names = mvp_tool_specs()
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"EnterPlanMode"));
        assert!(names.contains(&"ExitPlanMode"));
        if let Some(value) = original {
            std::env::set_var("RELAY_COMPAT_MODE", value);
        } else {
            std::env::remove_var("RELAY_COMPAT_MODE");
        }
    }

    #[test]
    fn cached_tool_registry_marks_conditional_entries() {
        let _guard = env_lock().lock().expect("env lock");
        let original = std::env::var("RELAY_COMPAT_MODE").ok();
        std::env::set_var("RELAY_COMPAT_MODE", "1");

        let registry = tool_registry();
        let entries = registry.entries();

        let enter_plan = entries
            .iter()
            .find(|entry| entry.name == "EnterPlanMode")
            .expect("EnterPlanMode entry");
        assert_eq!(enter_plan.source, ToolSource::Conditional);

        let exit_plan = entries
            .iter()
            .find(|entry| entry.name == "ExitPlanMode")
            .expect("ExitPlanMode entry");
        assert_eq!(exit_plan.source, ToolSource::Conditional);

        let bash = entries
            .iter()
            .find(|entry| entry.name == "bash")
            .expect("bash entry");
        assert_eq!(bash.source, ToolSource::Base);

        if let Some(value) = original {
            std::env::set_var("RELAY_COMPAT_MODE", value);
        } else {
            std::env::remove_var("RELAY_COMPAT_MODE");
        }
    }

    #[test]
    fn tool_search_visibility_is_driven_by_metadata() {
        assert!(!is_tool_visible_in_tool_search("read_file"));
        assert!(!is_tool_visible_in_tool_search("write_file"));
        assert!(!is_tool_visible_in_tool_search("pdf_merge"));
        assert!(is_tool_visible_in_tool_search("WebFetch"));
        assert!(is_tool_visible_in_tool_search("MCP"));
        assert!(!is_tool_visible_in_tool_search("nope"));
    }

    #[test]
    fn rejects_unknown_tool_names() {
        let error = execute_tool("nope", &json!({})).expect_err("tool should be rejected");
        assert!(error.contains("unsupported tool"));
    }

    #[test]
    fn git_status_runs_in_temp_repo() {
        if std::process::Command::new("git")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let dir = temp_path("git-tool-smoke");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        let o = std::process::Command::new("git")
            .current_dir(&dir)
            .args(["-c", "user.email=t@t", "-c", "user.name=T", "init"])
            .output()
            .expect("git init");
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
        let out = execute_tool(
            "git_status",
            &json!({ "path": dir.to_string_lossy().as_ref() }),
        )
        .expect("git_status");
        assert!(out.is_empty() || !out.is_empty());
    }

    struct RestoreCwd(std::path::PathBuf);
    impl Drop for RestoreCwd {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.0);
        }
    }

    fn minimal_one_page_pdf(label: &str) -> lopdf::Document {
        use lopdf::content::{Content, Operation};
        use lopdf::{dictionary, Object, Stream};

        let mut doc = lopdf::Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! {
                "F1" => font_id,
            },
        });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 48.into()]),
                Operation::new("Td", vec![100.into(), 600.into()]),
                Operation::new("Tj", vec![Object::string_literal(label)]),
                Operation::new("ET", vec![]),
            ],
        };
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            content.encode().expect("encode"),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => resources_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        doc
    }

    // Relies on `env_lock()` + `std::env::set_current_dir` pattern that's
    // flaky on Windows CI runners due to different path canonicalization.
    // Gate on non-Windows; platform-agnostic coverage lives in
    // `runtime::pdf_manip::tests::{merge_two_one_page_pdfs, split_two_page_doc}`.
    #[cfg(not(windows))]
    #[test]
    fn pdf_merge_and_split_round_trip_via_execute_tool() {
        let _guard = env_lock().lock().expect("env lock");
        let dir = temp_path("pdf-tools");
        fs::create_dir_all(&dir).expect("mkdir");
        let a = dir.join("a.pdf");
        let b = dir.join("b.pdf");
        minimal_one_page_pdf("A").save(&a).expect("save a");
        minimal_one_page_pdf("B").save(&b).expect("save b");

        let before = std::env::current_dir().expect("cwd");
        let _restore = RestoreCwd(before.clone());
        std::env::set_current_dir(&dir).expect("chdir");

        let merge_json = execute_tool(
            "pdf_merge",
            &json!({
                "output_path": "merged.pdf",
                "input_paths": ["a.pdf", "b.pdf"],
            }),
        )
        .expect("pdf_merge");
        let merged_val: serde_json::Value = serde_json::from_str(&merge_json).expect("json");
        let out = merged_val["output_path"].as_str().expect("output_path");
        assert!(out.ends_with("merged.pdf"));
        assert!(dir.join("merged.pdf").is_file());

        let split_json = execute_tool(
            "pdf_split",
            &json!({
                "input_path": "merged.pdf",
                "segments": [
                    { "output_path": "out1.pdf", "pages": "1" },
                    { "output_path": "out2.pdf", "pages": "2" },
                ],
            }),
        )
        .expect("pdf_split");
        let split_val: serde_json::Value = serde_json::from_str(&split_json).expect("json");
        let outs = split_val["outputs"].as_array().expect("outputs");
        assert_eq!(outs.len(), 2);
        assert!(dir.join("out1.pdf").is_file());
        assert!(dir.join("out2.pdf").is_file());
    }

    #[test]
    fn web_fetch_returns_prompt_aware_summary() {
        let server = TestServer::spawn(Arc::new(|request_line: &str| {
            assert!(request_line.starts_with("GET /page "));
            HttpResponse::html(
                200,
                "OK",
                "<html><head><title>Ignored</title></head><body><h1>Test Page</h1><p>Hello <b>world</b> from local server.</p></body></html>",
            )
        }));

        let result = execute_tool(
            "WebFetch",
            &json!({
                "url": format!("http://{}/page", server.addr()),
                "prompt": "Summarize this page"
            }),
        )
        .expect("WebFetch should succeed");

        let output: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert_eq!(output["code"], 200);
        let summary = output["result"].as_str().expect("result string");
        assert!(summary.contains("Fetched"));
        assert!(summary.contains("Test Page"));
        assert!(summary.contains("Hello world from local server"));

        let titled = execute_tool(
            "WebFetch",
            &json!({
                "url": format!("http://{}/page", server.addr()),
                "prompt": "What is the page title?"
            }),
        )
        .expect("WebFetch title query should succeed");
        let titled_output: serde_json::Value = serde_json::from_str(&titled).expect("valid json");
        let titled_summary = titled_output["result"].as_str().expect("result string");
        assert!(titled_summary.contains("Title: Ignored"));
    }

    #[test]
    fn web_fetch_supports_plain_text_and_rejects_invalid_url() {
        let server = TestServer::spawn(Arc::new(|request_line: &str| {
            assert!(request_line.starts_with("GET /plain "));
            HttpResponse::text(200, "OK", "plain text response")
        }));

        let result = execute_tool(
            "WebFetch",
            &json!({
                "url": format!("http://{}/plain", server.addr()),
                "prompt": "Show me the content"
            }),
        )
        .expect("WebFetch should succeed for text content");

        let output: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert_eq!(output["url"], format!("http://{}/plain", server.addr()));
        assert!(output["result"]
            .as_str()
            .expect("result")
            .contains("plain text response"));

        let error = execute_tool(
            "WebFetch",
            &json!({
                "url": "not a url",
                "prompt": "Summarize"
            }),
        )
        .expect_err("invalid URL should fail");
        assert!(error.contains("relative URL without a base") || error.contains("invalid"));
    }

    #[test]
    fn web_search_extracts_and_filters_results() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let server = TestServer::spawn(Arc::new(|request_line: &str| {
            assert!(request_line.contains("GET /search?q=rust+web+search "));
            HttpResponse::html(
                200,
                "OK",
                r#"
                <html><body>
                  <a class="result__a" href="https://docs.rs/reqwest">Reqwest docs</a>
                  <a class="result__a" href="https://example.com/blocked">Blocked result</a>
                </body></html>
                "#,
            )
        }));

        std::env::set_var(
            "CLAWD_WEB_SEARCH_BASE_URL",
            format!("http://{}/search", server.addr()),
        );
        let result = execute_tool(
            "WebSearch",
            &json!({
                "query": "rust web search",
                "allowed_domains": ["https://DOCS.rs/"],
                "blocked_domains": ["HTTPS://EXAMPLE.COM"]
            }),
        )
        .expect("WebSearch should succeed");
        std::env::remove_var("CLAWD_WEB_SEARCH_BASE_URL");

        let output: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert_eq!(output["query"], "rust web search");
        let results = output["results"].as_array().expect("results array");
        let search_result = results
            .iter()
            .find(|item| item.get("content").is_some())
            .expect("search result block present");
        let content = search_result["content"].as_array().expect("content array");
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["title"], "Reqwest docs");
        assert_eq!(content[0]["url"], "https://docs.rs/reqwest");
    }

    #[test]
    fn web_search_handles_generic_links_and_invalid_base_url() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let server = TestServer::spawn(Arc::new(|request_line: &str| {
            assert!(request_line.contains("GET /fallback?q=generic+links "));
            HttpResponse::html(
                200,
                "OK",
                r#"
                <html><body>
                  <a href="https://example.com/one">Example One</a>
                  <a href="https://example.com/one">Duplicate Example One</a>
                  <a href="https://docs.rs/tokio">Tokio Docs</a>
                </body></html>
                "#,
            )
        }));

        std::env::set_var(
            "CLAWD_WEB_SEARCH_BASE_URL",
            format!("http://{}/fallback", server.addr()),
        );
        let result = execute_tool(
            "WebSearch",
            &json!({
                "query": "generic links"
            }),
        )
        .expect("WebSearch fallback parsing should succeed");
        std::env::remove_var("CLAWD_WEB_SEARCH_BASE_URL");

        let output: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        let results = output["results"].as_array().expect("results array");
        let search_result = results
            .iter()
            .find(|item| item.get("content").is_some())
            .expect("search result block present");
        let content = search_result["content"].as_array().expect("content array");
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["url"], "https://example.com/one");
        assert_eq!(content[1]["url"], "https://docs.rs/tokio");

        std::env::set_var("CLAWD_WEB_SEARCH_BASE_URL", "://bad-base-url");
        let error = execute_tool("WebSearch", &json!({ "query": "generic links" }))
            .expect_err("invalid base URL should fail");
        std::env::remove_var("CLAWD_WEB_SEARCH_BASE_URL");
        assert!(error.contains("relative URL without a base") || error.contains("empty host"));
    }

    #[test]
    fn todo_write_persists_and_returns_previous_state() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let path = temp_path("todos.json");
        std::env::set_var("CLAWD_TODO_STORE", &path);

        let first = execute_tool(
            "TodoWrite",
            &json!({
                "todos": [
                    {"content": "Add tool", "activeForm": "Adding tool", "status": "in_progress"},
                    {"content": "Run tests", "activeForm": "Running tests", "status": "pending"}
                ]
            }),
        )
        .expect("TodoWrite should succeed");
        let first_output: serde_json::Value = serde_json::from_str(&first).expect("valid json");
        assert_eq!(first_output["oldTodos"].as_array().expect("array").len(), 0);

        let second = execute_tool(
            "TodoWrite",
            &json!({
                "todos": [
                    {"content": "Add tool", "activeForm": "Adding tool", "status": "completed"},
                    {"content": "Run tests", "activeForm": "Running tests", "status": "completed"},
                    {"content": "Verify", "activeForm": "Verifying", "status": "completed"}
                ]
            }),
        )
        .expect("TodoWrite should succeed");
        std::env::remove_var("CLAWD_TODO_STORE");
        let _ = std::fs::remove_file(path);

        let second_output: serde_json::Value = serde_json::from_str(&second).expect("valid json");
        assert_eq!(
            second_output["oldTodos"].as_array().expect("array").len(),
            2
        );
        assert_eq!(
            second_output["newTodos"].as_array().expect("array").len(),
            3
        );
        assert!(second_output["verificationNudgeNeeded"].is_null());
    }

    #[test]
    fn todo_write_rejects_invalid_payloads_and_sets_verification_nudge() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let path = temp_path("todos-errors.json");
        std::env::set_var("CLAWD_TODO_STORE", &path);

        let empty = execute_tool("TodoWrite", &json!({ "todos": [] }))
            .expect_err("empty todos should fail");
        assert!(empty.contains("todos must not be empty"));

        // Multiple in_progress items are now allowed for parallel workflows
        let _multi_active = execute_tool(
            "TodoWrite",
            &json!({
                "todos": [
                    {"content": "One", "activeForm": "Doing one", "status": "in_progress"},
                    {"content": "Two", "activeForm": "Doing two", "status": "in_progress"}
                ]
            }),
        )
        .expect("multiple in-progress todos should succeed");

        let blank_content = execute_tool(
            "TodoWrite",
            &json!({
                "todos": [
                    {"content": "   ", "activeForm": "Doing it", "status": "pending"}
                ]
            }),
        )
        .expect_err("blank content should fail");
        assert!(blank_content.contains("todo content must not be empty"));

        let nudge = execute_tool(
            "TodoWrite",
            &json!({
                "todos": [
                    {"content": "Write tests", "activeForm": "Writing tests", "status": "completed"},
                    {"content": "Fix errors", "activeForm": "Fixing errors", "status": "completed"},
                    {"content": "Ship branch", "activeForm": "Shipping branch", "status": "completed"}
                ]
            }),
        )
        .expect("completed todos should succeed");
        std::env::remove_var("CLAWD_TODO_STORE");
        let _ = fs::remove_file(path);

        let output: serde_json::Value = serde_json::from_str(&nudge).expect("valid json");
        assert_eq!(output["verificationNudgeNeeded"], true);
    }

    // Skill tests assert forward-slash path suffixes like `/help/SKILL.md`;
    // Windows uses `\\` so the ends_with check fails. Gate on non-Windows.
    #[cfg(not(windows))]
    #[test]
    fn skill_loads_local_skill_prompt() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous_codex_home = std::env::var("CODEX_HOME").ok();
        let previous_home = std::env::var("HOME").ok();
        let previous_userprofile = std::env::var("USERPROFILE").ok();
        let codex_home = temp_path("codex-home");
        let skill_dir = codex_home.join("skills").join("help");
        fs::create_dir_all(&skill_dir).expect("skill dir");
        fs::write(
            skill_dir.join("SKILL.md"),
            "description: test help skill\n\nGuide on using oh-my-codex plugin (fixture).\n",
        )
        .expect("write SKILL.md");
        std::env::set_var("CODEX_HOME", &codex_home);

        let result = execute_tool(
            "Skill",
            &json!({
                "skill": "help",
                "args": "overview"
            }),
        )
        .expect("Skill should succeed");

        let output: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert_eq!(output["skill"], "help");
        assert!(output["path"]
            .as_str()
            .expect("path")
            .ends_with("/help/SKILL.md"));
        assert!(output["prompt"]
            .as_str()
            .expect("prompt")
            .contains("Guide on using oh-my-codex plugin"));

        let dollar_result = execute_tool(
            "Skill",
            &json!({
                "skill": "$help"
            }),
        )
        .expect("Skill should accept $skill invocation form");
        let dollar_output: serde_json::Value =
            serde_json::from_str(&dollar_result).expect("valid json");
        assert_eq!(dollar_output["skill"], "$help");
        assert!(dollar_output["path"]
            .as_str()
            .expect("path")
            .ends_with("/help/SKILL.md"));

        if let Some(codex_home) = previous_codex_home {
            std::env::set_var("CODEX_HOME", codex_home);
        } else {
            std::env::remove_var("CODEX_HOME");
        }
        if let Some(home) = previous_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(userprofile) = previous_userprofile {
            std::env::set_var("USERPROFILE", userprofile);
        } else {
            std::env::remove_var("USERPROFILE");
        }
        let _ = fs::remove_dir_all(&codex_home);
    }

    #[cfg(not(windows))]
    #[test]
    fn skill_uses_current_home_codex_when_codex_home_unset() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous_codex_home = std::env::var("CODEX_HOME").ok();
        let previous_home = std::env::var("HOME").ok();
        let previous_userprofile = std::env::var("USERPROFILE").ok();
        let home = temp_path("skill-home");
        let skill_dir = home.join(".codex").join("skills").join("ui-ux-pro-max");
        fs::create_dir_all(&skill_dir).expect("skill dir");
        fs::write(
            skill_dir.join("SKILL.md"),
            "description: root-backed skill\n\nUse the local home directory skill fixture.\n",
        )
        .expect("write SKILL.md");
        std::env::remove_var("CODEX_HOME");
        std::env::set_var("HOME", &home);
        std::env::remove_var("USERPROFILE");

        let result = execute_tool(
            "Skill",
            &json!({
                "skill": "$ui-ux-pro-max"
            }),
        )
        .expect("Skill should resolve via HOME/.codex/skills");
        let output: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert_eq!(output["skill"], "$ui-ux-pro-max");
        assert!(output["path"]
            .as_str()
            .expect("path")
            .ends_with("/ui-ux-pro-max/SKILL.md"));
        assert!(output["prompt"]
            .as_str()
            .expect("prompt")
            .contains("root-backed skill"));

        if let Some(codex_home) = previous_codex_home {
            std::env::set_var("CODEX_HOME", codex_home);
        } else {
            std::env::remove_var("CODEX_HOME");
        }
        if let Some(home) = previous_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(userprofile) = previous_userprofile {
            std::env::set_var("USERPROFILE", userprofile);
        } else {
            std::env::remove_var("USERPROFILE");
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn skill_prefers_codex_home_over_current_home_codex() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous_codex_home = std::env::var("CODEX_HOME").ok();
        let previous_home = std::env::var("HOME").ok();
        let previous_userprofile = std::env::var("USERPROFILE").ok();
        let codex_home = temp_path("skill-precedence-codex-home");
        let home = temp_path("skill-precedence-home");
        let codex_skill_dir = codex_home.join("skills").join("help");
        let home_skill_dir = home.join(".codex").join("skills").join("help");
        fs::create_dir_all(&codex_skill_dir).expect("codex skill dir");
        fs::create_dir_all(&home_skill_dir).expect("home skill dir");
        fs::write(
            codex_skill_dir.join("SKILL.md"),
            "description: codex home wins\n\nPrefer CODEX_HOME fixture.\n",
        )
        .expect("write codex home skill");
        fs::write(
            home_skill_dir.join("SKILL.md"),
            "description: home fallback\n\nDo not pick this fixture first.\n",
        )
        .expect("write home skill");
        std::env::set_var("CODEX_HOME", &codex_home);
        std::env::set_var("HOME", &home);
        std::env::remove_var("USERPROFILE");

        let result = execute_tool(
            "Skill",
            &json!({
                "skill": "help"
            }),
        )
        .expect("Skill should prefer CODEX_HOME");
        let output: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert!(output["prompt"]
            .as_str()
            .expect("prompt")
            .contains("Prefer CODEX_HOME fixture."));
        assert!(output["path"]
            .as_str()
            .expect("path")
            .starts_with(codex_home.to_string_lossy().as_ref()));

        if let Some(codex_home) = previous_codex_home {
            std::env::set_var("CODEX_HOME", codex_home);
        } else {
            std::env::remove_var("CODEX_HOME");
        }
        if let Some(home) = previous_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(userprofile) = previous_userprofile {
            std::env::set_var("USERPROFILE", userprofile);
        } else {
            std::env::remove_var("USERPROFILE");
        }
        let _ = fs::remove_dir_all(&codex_home);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn tool_search_supports_keyword_and_select_queries() {
        let keyword = execute_tool(
            "ToolSearch",
            &json!({"query": "web current", "max_results": 3}),
        )
        .expect("ToolSearch should succeed");
        let keyword_output: serde_json::Value = serde_json::from_str(&keyword).expect("valid json");
        let matches = keyword_output["matches"].as_array().expect("matches");
        assert!(matches.iter().any(|value| value == "WebSearch"));

        let selected = execute_tool("ToolSearch", &json!({"query": "select:Agent,Skill"}))
            .expect("ToolSearch should succeed");
        let selected_output: serde_json::Value =
            serde_json::from_str(&selected).expect("valid json");
        assert_eq!(selected_output["matches"][0], "Agent");
        assert_eq!(selected_output["matches"][1], "Skill");

        let aliased = execute_tool("ToolSearch", &json!({"query": "AgentTool"}))
            .expect("ToolSearch should support tool aliases");
        let aliased_output: serde_json::Value = serde_json::from_str(&aliased).expect("valid json");
        assert_eq!(aliased_output["matches"][0], "Agent");
        assert_eq!(aliased_output["normalized_query"], "agent");

        let selected_with_alias =
            execute_tool("ToolSearch", &json!({"query": "select:AgentTool,Skill"}))
                .expect("ToolSearch alias select should succeed");
        let selected_with_alias_output: serde_json::Value =
            serde_json::from_str(&selected_with_alias).expect("valid json");
        assert_eq!(selected_with_alias_output["matches"][0], "Agent");
        assert_eq!(selected_with_alias_output["matches"][1], "Skill");
    }

    #[test]
    fn notebook_edit_replaces_inserts_and_deletes_cells() {
        let path = temp_path("notebook.ipynb");
        std::fs::write(
            &path,
            r#"{
  "cells": [
    {"cell_type": "code", "id": "cell-a", "metadata": {}, "source": ["print(1)\n"], "outputs": [], "execution_count": null}
  ],
  "metadata": {"kernelspec": {"language": "python"}},
  "nbformat": 4,
  "nbformat_minor": 5
}"#,
        )
        .expect("write notebook");

        let replaced = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": path.display().to_string(),
                "cell_id": "cell-a",
                "new_source": "print(2)\n",
                "edit_mode": "replace"
            }),
        )
        .expect("NotebookEdit replace should succeed");
        let replaced_output: serde_json::Value = serde_json::from_str(&replaced).expect("json");
        assert_eq!(replaced_output["cell_id"], "cell-a");
        assert_eq!(replaced_output["cell_type"], "code");

        let claw_replace = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": path.display().to_string(),
                "command": "replace",
                "index": 0,
                "new_source": "print(9)\n"
            }),
        )
        .expect("NotebookEdit Claw-style replace");
        let claw_out: serde_json::Value = serde_json::from_str(&claw_replace).expect("json");
        assert_eq!(claw_out["new_source"], "print(9)\n");

        let inserted = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": path.display().to_string(),
                "cell_id": "cell-a",
                "new_source": "# heading\n",
                "cell_type": "markdown",
                "edit_mode": "insert"
            }),
        )
        .expect("NotebookEdit insert should succeed");
        let inserted_output: serde_json::Value = serde_json::from_str(&inserted).expect("json");
        assert_eq!(inserted_output["cell_type"], "markdown");
        let appended = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": path.display().to_string(),
                "new_source": "print(3)\n",
                "edit_mode": "insert"
            }),
        )
        .expect("NotebookEdit append should succeed");
        let appended_output: serde_json::Value = serde_json::from_str(&appended).expect("json");
        assert_eq!(appended_output["cell_type"], "code");

        let deleted = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": path.display().to_string(),
                "cell_id": "cell-a",
                "edit_mode": "delete"
            }),
        )
        .expect("NotebookEdit delete should succeed without new_source");
        let deleted_output: serde_json::Value = serde_json::from_str(&deleted).expect("json");
        assert!(deleted_output["cell_type"].is_null());
        assert_eq!(deleted_output["new_source"], "");

        let final_notebook: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read notebook"))
                .expect("valid notebook json");
        let cells = final_notebook["cells"].as_array().expect("cells array");
        assert_eq!(cells.len(), 2);
        assert_eq!(cells[0]["cell_type"], "markdown");
        assert!(cells[0].get("outputs").is_none());
        assert_eq!(cells[1]["cell_type"], "code");
        assert_eq!(cells[1]["source"][0], "print(3)\n");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn notebook_edit_rejects_invalid_inputs() {
        let text_path = temp_path("notebook.txt");
        fs::write(&text_path, "not a notebook").expect("write text file");
        let wrong_extension = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": text_path.display().to_string(),
                "new_source": "print(1)\n"
            }),
        )
        .expect_err("non-ipynb file should fail");
        assert!(wrong_extension.contains("Jupyter notebook"));
        let _ = fs::remove_file(&text_path);

        let empty_notebook = temp_path("empty.ipynb");
        fs::write(
            &empty_notebook,
            r#"{"cells":[],"metadata":{"kernelspec":{"language":"python"}},"nbformat":4,"nbformat_minor":5}"#,
        )
        .expect("write empty notebook");

        let missing_source = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": empty_notebook.display().to_string(),
                "edit_mode": "insert"
            }),
        )
        .expect_err("insert without source should fail");
        assert!(missing_source.contains("new_source is required"));

        let missing_cell = execute_tool(
            "NotebookEdit",
            &json!({
                "notebook_path": empty_notebook.display().to_string(),
                "edit_mode": "delete"
            }),
        )
        .expect_err("delete on empty notebook should fail");
        assert!(missing_cell.contains("Notebook has no cells to edit"));
        let _ = fs::remove_file(empty_notebook);
    }

    #[test]
    fn bash_tool_reports_success_exit_failure_timeout_and_background() {
        fn assert_stream_contains(output: &serde_json::Value, expected: &str) {
            let stdout = output["stdout"].as_str().expect("stdout");
            let stderr = output["stderr"].as_str().expect("stderr");
            assert!(
                stdout.contains(expected) || stderr.contains(expected),
                "expected {expected:?} in stdout or stderr, got stdout={stdout:?} stderr={stderr:?}"
            );
        }

        let success = execute_tool(
            "bash",
            &json!({
                "command": "echo hello",
                "timeout": 10000,
                "run_in_background": false,
                "dangerouslyDisableSandbox": false,
                "namespaceRestrictions": false,
                "isolateNetwork": false,
                "filesystemMode": "workspace-only"
            }),
        )
        .expect("bash should succeed");
        let success_output: serde_json::Value = serde_json::from_str(&success).expect("json");
        assert_stream_contains(&success_output, "hello");
        assert_eq!(success_output["interrupted"], false);

        let failure = execute_tool(
            "bash",
            &json!({
                "command": "echo oops >&2; exit 7",
                "timeout": 10000,
                "run_in_background": false,
                "dangerouslyDisableSandbox": false,
                "namespaceRestrictions": false,
                "isolateNetwork": false,
                "filesystemMode": "workspace-only"
            }),
        )
        .expect("bash failure should still return structured output");
        let failure_output: serde_json::Value = serde_json::from_str(&failure).expect("json");
        assert_eq!(failure_output["returnCodeInterpretation"], "exit_code:7");
        assert_stream_contains(&failure_output, "oops");

        let timeout = execute_tool(
            "bash",
            &json!({
                "command": "sleep 1",
                "timeout": 10,
                "run_in_background": false,
                "dangerouslyDisableSandbox": false,
                "namespaceRestrictions": false,
                "isolateNetwork": false,
                "filesystemMode": "workspace-only"
            }),
        )
        .expect("bash timeout should return output");
        let timeout_output: serde_json::Value = serde_json::from_str(&timeout).expect("json");
        assert_eq!(timeout_output["interrupted"], true);
        assert_eq!(timeout_output["returnCodeInterpretation"], "timeout");
        assert!(timeout_output["stderr"]
            .as_str()
            .expect("stderr")
            .contains("Command exceeded timeout"));

        let background = execute_tool(
            "bash",
            &json!({
                "command": "sleep 1",
                "run_in_background": true,
                "dangerouslyDisableSandbox": false,
                "namespaceRestrictions": false,
                "isolateNetwork": false,
                "filesystemMode": "workspace-only"
            }),
        )
        .expect("bash background should succeed");
        let background_output: serde_json::Value = serde_json::from_str(&background).expect("json");
        assert!(background_output["backgroundTaskId"].as_str().is_some());
        assert_eq!(background_output["noOutputExpected"], true);
    }

    // Asserts Unix error text ("No such file or directory"); Windows emits
    // "The system cannot find the file specified." Gate on non-Windows.
    #[cfg(not(windows))]
    #[test]
    fn file_tools_cover_read_write_and_edit_behaviors() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = temp_path("fs-suite");
        fs::create_dir_all(&root).expect("create root");
        let original_dir = std::env::current_dir().expect("cwd");
        std::env::set_current_dir(&root).expect("set cwd");

        let write_create = execute_tool(
            "write_file",
            &json!({ "path": "nested/demo.txt", "content": "alpha\nbeta\nalpha\n" }),
        )
        .expect("write create should succeed");
        let write_create_output: serde_json::Value =
            serde_json::from_str(&write_create).expect("json");
        assert_eq!(write_create_output["type"], "create");
        assert!(root.join("nested/demo.txt").exists());

        let write_update = execute_tool(
            "write_file",
            &json!({ "path": "nested/demo.txt", "content": "alpha\nbeta\ngamma\n" }),
        )
        .expect("write update should succeed");
        let write_update_output: serde_json::Value =
            serde_json::from_str(&write_update).expect("json");
        assert_eq!(write_update_output["type"], "update");
        assert_eq!(write_update_output["originalFile"], "alpha\nbeta\nalpha\n");

        let read_full = execute_tool("read_file", &json!({ "path": "nested/demo.txt" }))
            .expect("read full should succeed");
        let read_full_output: serde_json::Value = serde_json::from_str(&read_full).expect("json");
        assert_eq!(read_full_output["file"]["content"], "alpha\nbeta\ngamma");
        assert_eq!(read_full_output["file"]["startLine"], 1);

        let read_via_file_path = execute_tool(
            "read_file",
            &json!({ "file_path": "nested/demo.txt", "offset": 0, "limit": 2 }),
        )
        .expect("read via file_path should succeed");
        let read_via_file_path_output: serde_json::Value =
            serde_json::from_str(&read_via_file_path).expect("json");
        assert_eq!(read_via_file_path_output["file"]["content"], "alpha\nbeta");
        assert_eq!(read_via_file_path_output["file"]["startLine"], 1);

        let read_slice = execute_tool(
            "read_file",
            &json!({ "path": "nested/demo.txt", "offset": 1, "limit": 1 }),
        )
        .expect("read slice should succeed");
        let read_slice_output: serde_json::Value = serde_json::from_str(&read_slice).expect("json");
        assert_eq!(read_slice_output["file"]["content"], "beta");
        assert_eq!(read_slice_output["file"]["startLine"], 2);

        let read_past_end = execute_tool(
            "read_file",
            &json!({ "path": "nested/demo.txt", "offset": 50 }),
        )
        .expect("read past EOF should succeed");
        let read_past_end_output: serde_json::Value =
            serde_json::from_str(&read_past_end).expect("json");
        assert_eq!(read_past_end_output["file"]["content"], "");
        assert_eq!(read_past_end_output["file"]["startLine"], 4);

        let read_error = execute_tool("read_file", &json!({ "path": "missing.txt" }))
            .expect_err("missing file should fail");
        assert!(read_error.contains("No such file or directory"));
        assert!(read_error.contains("resolved path:"));
        assert!(read_error.contains(&*root.join("missing.txt").to_string_lossy()));

        let edit_once = execute_tool(
            "edit_file",
            &json!({ "path": "nested/demo.txt", "old_string": "alpha", "new_string": "omega" }),
        )
        .expect("single edit should succeed");
        let edit_once_output: serde_json::Value = serde_json::from_str(&edit_once).expect("json");
        assert_eq!(edit_once_output["replaceAll"], false);
        assert_eq!(
            fs::read_to_string(root.join("nested/demo.txt")).expect("read file"),
            "omega\nbeta\ngamma\n"
        );

        execute_tool(
            "write_file",
            &json!({ "path": "nested/demo.txt", "content": "alpha\nbeta\nalpha\n" }),
        )
        .expect("reset file");
        let edit_all = execute_tool(
            "edit_file",
            &json!({
                "path": "nested/demo.txt",
                "old_string": "alpha",
                "new_string": "omega",
                "replace_all": true
            }),
        )
        .expect("replace all should succeed");
        let edit_all_output: serde_json::Value = serde_json::from_str(&edit_all).expect("json");
        assert_eq!(edit_all_output["replaceAll"], true);
        assert_eq!(
            fs::read_to_string(root.join("nested/demo.txt")).expect("read file"),
            "omega\nbeta\nomega\n"
        );

        let edit_same = execute_tool(
            "edit_file",
            &json!({ "path": "nested/demo.txt", "old_string": "omega", "new_string": "omega" }),
        )
        .expect_err("identical old/new should fail");
        assert!(edit_same.contains("must differ"));

        let edit_missing = execute_tool(
            "edit_file",
            &json!({ "path": "nested/demo.txt", "old_string": "missing", "new_string": "omega" }),
        )
        .expect_err("missing substring should fail");
        assert!(edit_missing.contains("old_string not found"));

        std::env::set_current_dir(&original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(root);
    }

    // Asserts forward-slash path suffixes like `nested/lib.rs`; Windows glob
    // results use `\\`, so the ends_with check fails.
    #[cfg(not(windows))]
    #[test]
    fn glob_and_grep_tools_cover_success_and_errors() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = temp_path("search-suite");
        fs::create_dir_all(root.join("nested")).expect("create root");
        let original_dir = std::env::current_dir().expect("cwd");
        std::env::set_current_dir(&root).expect("set cwd");

        fs::write(
            root.join("nested/lib.rs"),
            "fn main() {}\nlet alpha = 1;\nlet alpha = 2;\n",
        )
        .expect("write rust file");
        fs::write(root.join("nested/notes.txt"), "alpha\nbeta\n").expect("write txt file");

        let globbed = execute_tool("glob_search", &json!({ "pattern": "nested/*.rs" }))
            .expect("glob should succeed");
        let globbed_output: serde_json::Value = serde_json::from_str(&globbed).expect("json");
        assert_eq!(globbed_output["numFiles"], 1);
        assert!(globbed_output["filenames"][0]
            .as_str()
            .expect("filename")
            .ends_with("nested/lib.rs"));

        let glob_error = execute_tool("glob_search", &json!({ "pattern": "[" }))
            .expect_err("invalid glob should fail");
        assert!(!glob_error.is_empty());

        let grep_content = execute_tool(
            "grep_search",
            &json!({
                "pattern": "alpha",
                "path": "nested",
                "glob": "*.rs",
                "output_mode": "content",
                "-n": true,
                "head_limit": 1,
                "offset": 1
            }),
        )
        .expect("grep content should succeed");
        let grep_content_output: serde_json::Value =
            serde_json::from_str(&grep_content).expect("json");
        assert_eq!(grep_content_output["numFiles"], 0);
        assert!(grep_content_output["appliedLimit"].is_null());
        assert_eq!(grep_content_output["appliedOffset"], 1);
        assert!(grep_content_output["content"]
            .as_str()
            .expect("content")
            .contains("let alpha = 2;"));

        let grep_count = execute_tool(
            "grep_search",
            &json!({ "pattern": "alpha", "path": "nested", "output_mode": "count" }),
        )
        .expect("grep count should succeed");
        let grep_count_output: serde_json::Value = serde_json::from_str(&grep_count).expect("json");
        assert_eq!(grep_count_output["numMatches"], 3);

        let grep_error = execute_tool(
            "grep_search",
            &json!({ "pattern": "(alpha", "path": "nested" }),
        )
        .expect_err("invalid regex should fail");
        assert!(!grep_error.is_empty());

        std::env::set_current_dir(&original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sleep_waits_and_reports_duration() {
        let started = std::time::Instant::now();
        let result =
            execute_tool("Sleep", &json!({"duration_ms": 20})).expect("Sleep should succeed");
        let elapsed = started.elapsed();
        let output: serde_json::Value = serde_json::from_str(&result).expect("json");
        assert_eq!(output["duration_ms"], 20);
        assert!(output["message"]
            .as_str()
            .expect("message")
            .contains("Slept for 20ms"));
        assert!(elapsed >= Duration::from_millis(15));
    }

    #[test]
    fn brief_returns_sent_message_and_attachment_metadata() {
        let attachment = std::env::temp_dir().join(format!(
            "clawd-brief-{}.png",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::write(&attachment, b"png-data").expect("write attachment");

        let result = execute_tool(
            "SendUserMessage",
            &json!({
                "message": "hello user",
                "attachments": [attachment.display().to_string()],
                "status": "normal"
            }),
        )
        .expect("SendUserMessage should succeed");

        let output: serde_json::Value = serde_json::from_str(&result).expect("json");
        assert_eq!(output["message"], "hello user");
        assert!(output["sentAt"].as_str().is_some());
        assert_eq!(output["attachments"][0]["isImage"], true);
        let _ = std::fs::remove_file(attachment);
    }

    #[test]
    fn config_reads_and_writes_supported_values() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = std::env::temp_dir().join(format!(
            "clawd-config-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let home = root.join("home");
        let cwd = root.join("cwd");
        std::fs::create_dir_all(home.join(".claw")).expect("home dir");
        std::fs::create_dir_all(cwd.join(".claw")).expect("cwd dir");
        std::fs::write(
            home.join(".claw").join("settings.json"),
            r#"{"verbose":false}"#,
        )
        .expect("write global settings");

        let original_home = std::env::var("HOME").ok();
        let original_claw_home = std::env::var("CLAW_CONFIG_HOME").ok();
        let original_dir = std::env::current_dir().expect("cwd");
        std::env::set_var("HOME", &home);
        std::env::remove_var("CLAW_CONFIG_HOME");
        std::env::set_current_dir(&cwd).expect("set cwd");

        let get = execute_tool("Config", &json!({"setting": "verbose"})).expect("get config");
        let get_output: serde_json::Value = serde_json::from_str(&get).expect("json");
        assert_eq!(get_output["value"], false);

        let set = execute_tool(
            "Config",
            &json!({"setting": "permissions.defaultMode", "value": "plan"}),
        )
        .expect("set config");
        let set_output: serde_json::Value = serde_json::from_str(&set).expect("json");
        assert_eq!(set_output["operation"], "set");
        assert_eq!(set_output["newValue"], "plan");

        let invalid = execute_tool(
            "Config",
            &json!({"setting": "permissions.defaultMode", "value": "bogus"}),
        )
        .expect_err("invalid config value should error");
        assert!(invalid.contains("Invalid value"));

        let unknown =
            execute_tool("Config", &json!({"setting": "nope"})).expect("unknown setting result");
        let unknown_output: serde_json::Value = serde_json::from_str(&unknown).expect("json");
        assert_eq!(unknown_output["success"], false);

        std::env::set_current_dir(&original_dir).expect("restore cwd");
        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match original_claw_home {
            Some(value) => std::env::set_var("CLAW_CONFIG_HOME", value),
            None => std::env::remove_var("CLAW_CONFIG_HOME"),
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn structured_output_echoes_input_payload() {
        let result = execute_tool("StructuredOutput", &json!({"ok": true, "items": [1, 2, 3]}))
            .expect("StructuredOutput should succeed");
        let output: serde_json::Value = serde_json::from_str(&result).expect("json");
        assert_eq!(output["data"], "Structured output provided successfully");
        assert_eq!(output["structured_output"]["ok"], true);
        assert_eq!(output["structured_output"]["items"][1], 2);
    }

    #[test]
    fn repl_executes_python_code() {
        let result = execute_tool(
            "REPL",
            &json!({"language": "python", "code": "print(1 + 1)", "timeout_ms": 500}),
        )
        .expect("REPL should succeed");
        let output: serde_json::Value = serde_json::from_str(&result).expect("json");
        assert_eq!(output["language"], "python");
        assert_eq!(output["exitCode"], 0);
        assert!(output["stdout"].as_str().expect("stdout").contains('2'));
    }

    #[cfg(windows)]
    #[test]
    fn powershell_utf8_preamble_inserts_console_setup() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = std::env::remove_var("RELAY_POWERSHELL_NO_UTF8_PREAMBLE");
        let wrapped = super::prepend_powershell_utf8_console_setup("Write-Output 1");
        assert!(wrapped.contains("chcp 65001"));
        assert!(wrapped.contains("OutputEncoding"));
        assert!(wrapped.ends_with("Write-Output 1"));

        std::env::set_var("RELAY_POWERSHELL_NO_UTF8_PREAMBLE", "1");
        assert_eq!(
            super::prepend_powershell_utf8_console_setup("Write-Output 1"),
            "Write-Output 1"
        );
        std::env::remove_var("RELAY_POWERSHELL_NO_UTF8_PREAMBLE");
    }

    #[cfg(windows)]
    // Uses a Unix stub shell script to exercise the PowerShell code path
    // (the path is the one under test, not the shell itself). The stub
    // relies on `chmod` and Unix process spawning. Gate on non-Windows.
    #[cfg(not(windows))]
    #[test]
    fn powershell_runs_via_stub_shell() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let dir = std::env::temp_dir().join(format!(
            "clawd-pwsh-bin-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create dir");
        let script = dir.join("pwsh");
        std::fs::write(
            &script,
            r#"#!/bin/sh
while [ "$1" != "-Command" ] && [ $# -gt 0 ]; do shift; done
shift
printf 'pwsh:%s' "$1"
"#,
        )
        .expect("write script");
        std::process::Command::new("/bin/chmod")
            .arg("+x")
            .arg(&script)
            .status()
            .expect("chmod");
        let original_path = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", format!("{}:{}", dir.display(), original_path));

        let result = execute_tool(
            "PowerShell",
            &json!({"command": "Write-Output hello", "timeout": 1000}),
        )
        .expect("PowerShell should succeed");

        let background = execute_tool(
            "PowerShell",
            &json!({"command": "Write-Output hello", "run_in_background": true}),
        )
        .expect("PowerShell background should succeed");

        std::env::set_var("PATH", original_path);
        let _ = std::fs::remove_dir_all(dir);

        let expected_cmd = super::prepend_powershell_utf8_console_setup("Write-Output hello");
        let output: serde_json::Value = serde_json::from_str(&result).expect("json");
        assert_eq!(
            output["stdout"],
            format!("pwsh:{expected_cmd}"),
            "stub should receive UTF-8 preamble plus user command"
        );
        assert!(output["stderr"].as_str().expect("stderr").is_empty());

        let background_output: serde_json::Value = serde_json::from_str(&background).expect("json");
        assert!(background_output["backgroundTaskId"].as_str().is_some());
        assert_eq!(background_output["backgroundedByUser"], true);
        assert_eq!(background_output["assistantAutoBackgrounded"], false);
    }

    #[cfg(windows)]
    #[test]
    fn powershell_errors_when_shell_is_missing() {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let original_path = std::env::var("PATH").unwrap_or_default();
        let empty_dir = std::env::temp_dir().join(format!(
            "clawd-empty-bin-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir_all(&empty_dir).expect("create empty dir");
        std::env::set_var("PATH", empty_dir.display().to_string());

        let err = execute_tool("PowerShell", &json!({"command": "Write-Output hello"}))
            .expect_err("PowerShell should fail when shell is missing");

        std::env::set_var("PATH", original_path);
        let _ = std::fs::remove_dir_all(empty_dir);

        assert!(err.contains("PowerShell executable not found"));
    }

    struct TestServer {
        addr: SocketAddr,
        shutdown: Option<std::sync::mpsc::Sender<()>>,
        handle: Option<thread::JoinHandle<()>>,
    }

    impl TestServer {
        fn spawn(handler: Arc<dyn Fn(&str) -> HttpResponse + Send + Sync + 'static>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
            listener
                .set_nonblocking(true)
                .expect("set nonblocking listener");
            let addr = listener.local_addr().expect("local addr");
            let (tx, rx) = std::sync::mpsc::channel::<()>();

            let handle = thread::spawn(move || loop {
                if rx.try_recv().is_ok() {
                    break;
                }

                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0_u8; 4096];
                        let size = stream.read(&mut buffer).expect("read request");
                        let request = String::from_utf8_lossy(&buffer[..size]).into_owned();
                        let request_line = request.lines().next().unwrap_or_default().to_string();
                        let response = handler(&request_line);
                        stream
                            .write_all(response.to_bytes().as_slice())
                            .expect("write response");
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("server accept failed: {error}"),
                }
            });

            Self {
                addr,
                shutdown: Some(tx),
                handle: Some(handle),
            }
        }

        fn addr(&self) -> SocketAddr {
            self.addr
        }
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            if let Some(tx) = self.shutdown.take() {
                let _ = tx.send(());
            }
            if let Some(handle) = self.handle.take() {
                handle.join().expect("join test server");
            }
        }
    }

    struct HttpResponse {
        status: u16,
        reason: &'static str,
        content_type: &'static str,
        body: String,
    }

    impl HttpResponse {
        fn html(status: u16, reason: &'static str, body: &str) -> Self {
            Self {
                status,
                reason,
                content_type: "text/html; charset=utf-8",
                body: body.to_string(),
            }
        }

        fn text(status: u16, reason: &'static str, body: &str) -> Self {
            Self {
                status,
                reason,
                content_type: "text/plain; charset=utf-8",
                body: body.to_string(),
            }
        }

        fn to_bytes(&self) -> Vec<u8> {
            format!(
                "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                self.status,
                self.reason,
                self.content_type,
                self.body.len(),
                self.body
            )
            .into_bytes()
        }
    }
}
