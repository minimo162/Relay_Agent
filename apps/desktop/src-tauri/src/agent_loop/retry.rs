use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Value};

use runtime::{ContentBlock, RuntimeError};

use crate::agent_loop::prompt::{
    extract_path_anchors_from_text, LATEST_REQUEST_MARKER, ORIGINAL_GOAL_MARKER,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LoopStopReason {
    Completed,
    Cancelled,
    MetaStall,
    RetryExhausted,
    CompactionFailed,
    MaxTurnsReached,
    PermissionDenied,
    ToolError,
    DoomLoop,
}

impl LoopStopReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::MetaStall => "meta_stall",
            Self::RetryExhausted => "retry_exhausted",
            Self::CompactionFailed => "compaction_failed",
            Self::MaxTurnsReached => "max_turns_reached",
            Self::PermissionDenied => "permission_denied",
            Self::ToolError => "tool_error",
            Self::DoomLoop => "doom_loop",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LoopDecision {
    Continue {
        next_input: String,
        kind: LoopContinueKind,
    },
    Stop(LoopStopReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LoopContinueKind {
    MetaNudge,
    PathRepair,
}

#[derive(Clone, Copy)]
pub(crate) struct RetryHeuristicsFns {
    pub(crate) is_meta_stall_text: fn(&str) -> bool,
    pub(crate) is_concrete_local_file_write_goal: fn(&str) -> bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ReadFileToolErrorContext {
    requested_path: Option<String>,
    output: String,
}

pub(crate) fn tool_protocol_repair_stage(attempt_index: usize) -> usize {
    match attempt_index {
        0 => 1,
        1 => 2,
        _ => 3,
    }
}

pub(crate) fn repair_attempt_index_from_text(
    text: &str,
    is_tool_protocol_repair_text: fn(&str) -> bool,
) -> Option<usize> {
    if !is_tool_protocol_repair_text(text) {
        return None;
    }
    if text.contains("Final repair for this turn") {
        Some(2)
    } else if text.contains("Your previous repair still drifted into planning-only text") {
        Some(1)
    } else {
        Some(0)
    }
}

pub(crate) fn is_repair_refusal_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.contains("sorry, it looks like i can’t respond")
        || lower.contains("sorry, it looks like i can't respond")
        || lower.contains("cannot respond to this")
        || lower.contains("can't respond to this")
        || lower.contains("let’s try a different topic")
        || lower.contains("let's try a different topic")
        || (lower.contains("different topic") && lower.contains("new chat"))
}

fn is_false_completion_success_claim_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let mentions_local_file = lower.contains("write_file")
        || lower.contains("edit_file")
        || lower.contains("/root/")
        || lower.contains("workspace")
        || lower.contains(".html")
        || lower.contains(".txt")
        || trimmed.contains("ファイル")
        || trimmed.contains("内容");
    let success_claim = lower.contains("created")
        || lower.contains("written")
        || lower.contains("wrote")
        || lower.contains("saved")
        || lower.contains("completed")
        || lower.contains("done")
        || lower.contains("has been created")
        || lower.contains("was used")
        || lower.contains("status: ok")
        || trimmed.contains("作成")
        || trimmed.contains("作成済")
        || trimmed.contains("保存")
        || trimmed.contains("完了")
        || trimmed.contains("書き込")
        || trimmed.contains("書かれ")
        || trimmed.contains("生成");
    mentions_local_file && success_claim
}

fn is_required_or_related_file_lookup(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let mentions_file = lower.contains("file")
        || lower.contains("document")
        || lower.contains("spreadsheet")
        || trimmed.contains("ファイル")
        || trimmed.contains("資料")
        || trimmed.contains("帳票");
    let lookup_marker = lower.contains("needed file")
        || lower.contains("required file")
        || lower.contains("relevant file")
        || lower.contains("related file")
        || lower.contains("which file")
        || lower.contains("files needed")
        || lower.contains("files required")
        || trimmed.contains("必要")
        || trimmed.contains("関連")
        || trimmed.contains("関係")
        || trimmed.contains("教えて")
        || trimmed.contains("洗い出")
        || trimmed.contains("候補");
    mentions_file && lookup_marker
}

fn is_concrete_local_write_body_without_tools(
    latest_turn_input: &str,
    assistant_text: &str,
    is_concrete_local_file_write_goal: fn(&str) -> bool,
) -> bool {
    if !is_concrete_local_file_write_goal(latest_turn_input) {
        return false;
    }
    let trimmed = assistant_text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let looks_like_generated_file_body = lower.contains("<!doctype html")
        || lower.contains("<html")
        || lower.contains("```html")
        || lower.contains("```css")
        || lower.contains("```javascript")
        || lower.contains("```js")
        || lower.contains("```json")
        || lower.contains("```")
        || trimmed.chars().count() >= 900;
    looks_like_generated_file_body && !is_tool_protocol_confusion_text(trimmed)
}

fn is_concrete_local_mutation_plan_without_tools(
    latest_turn_input: &str,
    assistant_text: &str,
    is_concrete_local_file_write_goal: fn(&str) -> bool,
) -> bool {
    if !is_concrete_local_file_write_goal(latest_turn_input) {
        return false;
    }
    let trimmed = assistant_text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let mentions_target = lower.contains("/root/")
        || lower.contains("workspace")
        || lower.contains(".html")
        || lower.contains(".txt")
        || lower.contains(".md")
        || trimmed.contains("ファイル")
        || trimmed.contains("変更")
        || trimmed.contains("適用");
    let mutation_intent = lower.contains("apply")
        || lower.contains("update")
        || lower.contains("edit")
        || lower.contains("change")
        || lower.contains("modify")
        || lower.contains("reflect")
        || trimmed.contains("適用")
        || trimmed.contains("変更")
        || trimmed.contains("反映")
        || trimmed.contains("追加");
    let planning_language = lower.contains("will ")
        || lower.contains("going to")
        || lower.contains("only this change")
        || lower.contains("this change only")
        || lower.contains("existing")
        || trimmed.contains("します")
        || trimmed.contains("反映します")
        || trimmed.contains("変更だけ")
        || trimmed.contains("追加適用")
        || trimmed.contains("既存の");
    trimmed.chars().count() <= 1600
        && mentions_target
        && mutation_intent
        && planning_language
        && !lower.contains("\"relay_tool_call\"")
        && !lower.contains("```relay_tool")
        && !lower.contains("<!doctype html")
        && !lower.contains("<html")
}

fn contains_plain_relay_tool_mention(lower: &str) -> bool {
    lower.contains("relay_tool ")
        || lower.contains("relay_tool\n")
        || lower.contains("relay_tool\r")
        || lower.contains("`relay_tool`")
}

fn looks_like_truncated_relay_tool_fragment(trimmed: &str) -> bool {
    if trimmed.is_empty() {
        return false;
    }
    let first = trimmed.chars().next();
    if !matches!(first, Some('{' | '[')) {
        return false;
    }
    let char_count = trimmed.chars().count();
    if char_count > 400 {
        return false;
    }
    let has_tool_key = trimmed.contains("\"name\"")
        || trimmed.contains("\"input\"")
        || trimmed.contains("\"path\"")
        || trimmed.contains("\"content\"")
        || trimmed.contains("\"arguments\"")
        || trimmed.contains("\"parameters\"")
        || trimmed.contains("\"relay_tool_call\"");
    if !has_tool_key {
        return false;
    }
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;
    for ch in trimmed.chars() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' | '[' => depth += 1,
            '}' | ']' => depth -= 1,
            _ => {}
        }
    }
    depth > 0 || in_string
}

fn looks_like_malformed_relay_tool_fragment(trimmed: &str) -> bool {
    if trimmed.is_empty() {
        return false;
    }
    if !matches!(trimmed.chars().next(), Some('{' | '[')) {
        return false;
    }
    if trimmed.chars().count() > 1200 {
        return false;
    }
    let has_tool_keys = trimmed.contains("\"name\"")
        && trimmed.contains("\"input\"")
        && trimmed.contains("\"relay_tool_call\"");
    if !has_tool_keys {
        return false;
    }
    serde_json::from_str::<Value>(trimmed).is_err()
}

#[allow(clippy::too_many_lines)]
pub(crate) fn is_tool_protocol_confusion_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    if looks_like_truncated_relay_tool_fragment(trimmed)
        || looks_like_malformed_relay_tool_fragment(trimmed)
    {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    let local_tool_refusal = lower.contains("local_tools_unavailable")
        || lower.contains("local workspace editing tools")
        || lower.contains("workspace file tools")
        || lower.contains("can't create files on their system")
        || lower.contains("cannot create files on their system")
        || ((lower.contains("can't directly create") || lower.contains("cannot directly create"))
            && (lower.contains("local filesystem") || lower.contains("local file system")));
    let local_write_refusal = (lower.contains("can't directly write")
        || lower.contains("cannot directly write"))
        && (lower.contains("/root/") || lower.contains("workspace"));
    let foreign_tool_drift = lower.contains("python tool")
        || lower.contains("creating a file with python")
        || lower.contains("filesystem access in a python sandbox")
        || lower.contains("use the python tool instead")
        || lower.contains("preparing to use python to open and write")
        || lower.contains("sub-agent")
        || lower.contains("sub agent")
        || lower.contains("agent tool")
        || lower.contains("pages")
        || lower.contains("coding and executing")
        || lower.contains("\"executedcode\"")
        || lower.contains("outputfiles")
        || lower.contains("coderesultfileurl")
        || lower.contains("/mnt/file_upload/")
        || lower.contains("here's your new page")
        || lower.contains("here is your new page")
        || lower.contains("created your single")
        || lower.contains("created your playable")
        || lower.contains("websearch")
        || lower.contains("search tool")
        || lower.contains("i'll search for")
        || lower.contains("turn1search")
        || lower.contains("cite")
        || lower.contains("[1](http")
        || lower.contains("[2](http")
        || lower.contains("save as `")
        || lower.contains("save as \"")
        || lower.contains("open in any modern browser")
        || lower.contains("office365_search");
    let planning_only_file_drift = (lower.contains("planning file creation")
        || lower.contains("considering the steps to create")
        || lower.contains("determining the approach for creating")
        || lower.contains("weighing the options")
        || lower.contains("checking for existing files")
        || lower.contains("deciding on file writing"))
        && (lower.contains("write to the file")
            || lower.contains("creating the tetris game file")
            || lower.contains("create a playable html tetris")
            || lower.contains("tetris game file"));
    let relay_planning_write_drift = (lower.contains("show**planning")
        || lower.contains("planning tetris html creation")
        || lower.contains("show**preparing file request")
        || lower.contains("show**generating file output")
        || lower.contains("show**requesting html output")
        || lower.contains("show**requesting html file creation")
        || lower.contains("looking into generating a full html file")
        || lower.contains("preparing to use the relay tool")
        || lower.contains("preparing to utilize a relay tool")
        || lower.contains("show**creating html for tetris")
        || lower.contains("working on creating an html file")
        || lower.contains("preparing to generate a single-file html version of tetris")
        || lower.contains("organizing the process to create")
        || lower.contains("show**deciding on file output")
        || lower.contains("show**determining file name choice")
        || lower.contains("deciding on the filename")
        || lower.contains("deciding on using")
        || lower.contains("single-file approach")
        || lower.contains("single file approach"))
        && ((lower.contains("relay tools") || lower.contains("relay tool"))
            || lower.contains("write the new")
            || lower.contains("write the complete file")
            || lower.contains("using specific tools to write")
            || lower.contains("using a relay tool to write the complete file")
            || lower.contains("write_file function")
            || lower.contains("relay_tool's write_file action")
            || lower.contains("index.html")
            || lower.contains("html, js, and css")
            || lower.contains("specified tool")
            || lower.contains("relay via a specified tool")
            || lower.contains("requesting the content of tetris.html to be written")
            || lower.contains("no specific path was provided")
            || lower.contains("reasonable and straightforward naming convention"));
    let generic_show_hide_relay_write_drift = lower.contains("show**")
        && (lower.contains("relay tool") || lower.contains("relay tools"))
        && (lower.contains("write") || lower.contains("file"))
        && !lower.contains("\"relay_tool_call\"");
    let generic_show_hide_html_creation_drift = lower.contains("show**")
        && lower.contains("tetris")
        && ((lower.contains("html file")
            || lower.contains("single document")
            || lower.contains("canvas and controls")
            || lower.contains("full html"))
            || ((lower.contains("single file") || lower.contains("tetris.html"))
                && (lower.contains("requesting")
                    || lower.contains("creation")
                    || lower.contains("written")
                    || lower.contains("write"))))
        && !lower.contains("\"relay_tool_call\"")
        && !lower.contains("<!doctype html")
        && !lower.contains("<html");
    let mentioned_relay_tools_without_payload = (lower.contains("write_file")
        || lower.contains("edit_file")
        || lower.contains("read_file")
        || lower.contains("workspace_search")
        || lower.contains("glob_search")
        || lower.contains("grep_search"))
        && (lower.contains("```")
            || contains_plain_relay_tool_mention(&lower)
            || lower.contains("adjusting tool use"));
    let defers_concrete_local_read_without_tool = trimmed.chars().count() <= 500
        && ((lower.contains("need to read")
            || lower.contains("need to inspect")
            || lower.contains("need to review")
            || lower.contains("must read")
            || lower.contains("must inspect"))
            || trimmed.contains("読む必要があります")
            || trimmed.contains("読み取る必要があります")
            || trimmed.contains("確認する必要があります")
            || trimmed.contains("以下で読み取ります")
            || trimmed.contains("以下で確認します"))
        && (lower.contains("first") || trimmed.contains("まず") || trimmed.contains("以下で"));
    let defers_concrete_local_write_without_tool = trimmed.chars().count() <= 500
        && !lower.contains("\"relay_tool_call\"")
        && !lower.contains("```relay_tool")
        && (lower.contains("need to create")
            || lower.contains("need to write")
            || lower.contains("need to edit")
            || lower.contains("preparing to create")
            || lower.contains("preparing to write"))
        && (lower.contains("html file")
            || lower.contains("tetris.html")
            || lower.contains("write_file")
            || trimmed.contains("ファイルを作成")
            || trimmed.contains("書き込みます"))
        && (lower.contains("available tools")
            || lower.contains("utilizing available tools")
            || lower.contains("using the available tools")
            || lower.contains("following the instructions")
            || lower.contains("addressing conflicting guidance"));
    let planning_commits_to_relay_without_payload = trimmed.chars().count() <= 800
        && !lower.contains("\"relay_tool_call\"")
        && !lower.contains("```relay_tool")
        && !lower.contains("<!doctype html")
        && !lower.contains("<html")
        && (lower.contains("i'll use relay")
            || lower.contains("i'll use the relay")
            || lower.contains("i will use relay")
            || lower.contains("i will use the relay")
            || lower.contains("use relay to save")
            || lower.contains("use relay to write")
            || lower.contains("use the relay to save")
            || lower.contains("use the relay to write")
            || lower.contains("using relay to save")
            || lower.contains("using relay to write")
            || lower.contains("save it as tetris")
            || lower.contains("save this as tetris")
            || lower.contains("planning to create a tetris")
            || lower.contains("planning to write tetris")
            || lower.contains("planning to save tetris"));
    let declines_tools_for_local_write = trimmed.chars().count() <= 800
        && !lower.contains("\"relay_tool_call\"")
        && !lower.contains("```relay_tool")
        && !lower.contains("<!doctype html")
        && !lower.contains("<html")
        && (lower.contains("avoiding unnecessary tools")
            || lower.contains("without using tools")
            || lower.contains("without the need for tools")
            || lower.contains("bypassing the need for tool")
            || lower.contains("bypassing the tool")
            || lower.contains("no need to use tools")
            || lower.contains("no need for tools")
            || lower.contains("avoiding the tool")
            || lower.contains("avoid unnecessary tool")
            || lower.contains("opting to create")
            || lower.contains("opting to write")
            || lower.contains("opting to save")
            || lower.contains("opting for a simple")
            || lower.contains("deciding on file creation"))
        && (lower.contains("tetris")
            || lower.contains("tetris.html")
            || lower.contains("index.html")
            || lower.contains("html file")
            || lower.contains("canvas")
            || lower.contains("single file")
            || lower.contains("workspace"));
    local_tool_refusal
        || local_write_refusal
        || foreign_tool_drift
        || planning_only_file_drift
        || relay_planning_write_drift
        || generic_show_hide_relay_write_drift
        || generic_show_hide_html_creation_drift
        || mentioned_relay_tools_without_payload
        || defers_concrete_local_read_without_tool
        || defers_concrete_local_write_without_tool
        || planning_commits_to_relay_without_payload
        || declines_tools_for_local_write
        || is_repair_refusal_text(trimmed)
}

fn tool_protocol_repair_escalation(attempt_index: usize) -> &'static str {
    match tool_protocol_repair_stage(attempt_index) {
        1 => concat!(
            "Use the Relay tool catalog and emit the next required `relay_tool` JSON block in this reply.\n",
            "For local file creation or edits inside the workspace, prefer `write_file` / `edit_file` (and `read_file` first only when actually needed).\n",
            "Output exactly one fenced `relay_tool` block and nothing before or after it.\n",
            "Do not answer with prose only.\n",
            "Do not mention `relay_tool` in plain text.\n\n",
        ),
        2 => concat!(
            "Your previous repair still drifted into planning-only text instead of usable Relay tool JSON.\n",
            "Ignore any Pages, uploads, citations, links, `outputFiles`, or remote artifacts from prior replies: they do not satisfy a local workspace request.\n",
            "In this reply, output exactly one Relay `relay_tool` fence and nothing else.\n",
            "Do not include any explanatory sentence before or after the fence.\n",
            "Do not emit plain-text `relay_tool` mentions.\n",
            "The following outputs are invalid for this repair turn: `Show**...` wrappers, 'preparing' text, 'requesting' text, 'specific function' text, or any sentence that says you are about to write the file.\n",
            "If the task is to create or overwrite a workspace file and you already know the content, emit `write_file` now instead of describing Python, page creation, or the tool you plan to use.\n\n",
        ),
        _ => concat!(
            "Final repair for this turn.\n",
            "Your previous repairs still drifted into planning-only text instead of usable Relay tool JSON.\n",
            "Output exactly one Relay `relay_tool` fence and nothing else.\n",
            "Any text before or after the fence is a failed repair.\n",
            "Do not include `Show**...`, planning text, 'preparing', 'requesting', 'specific function', or plain-text `relay_tool` mentions.\n",
            "Emit the actual local file write now. Do not switch tools, do not verify, and do not describe the content instead of writing it.\n\n",
        ),
    }
}

fn build_write_file_repair_action_instruction(
    attempt_index: usize,
    requested_path: &str,
    inferred_path: bool,
) -> String {
    let path_sentence = if inferred_path {
        "No file path was supplied by the user. Use the workspace-root-relative filename below exactly as written. Do not spend another turn choosing or explaining the filename. Do not switch to `index.html` or any other filename; use `tetris.html`."
    } else {
        "Use the path anchor below exactly as written for this concrete file-creation request."
    };
    match tool_protocol_repair_stage(attempt_index) {
        1 => format!(
            "{path_sentence} Emit exactly one `write_file` Relay tool call now. Do not describe the content in prose; put the final file body in `input.content`."
        ),
        2 => format!(
            "{path_sentence} Emit the actual `write_file` JSON now, not a wrapper that says you are preparing or requesting the write. `Show**...`, planning text, and plain-text `relay_tool` mentions are invalid."
        ),
        _ => format!(
            "{path_sentence} Final repair for this turn: the only valid reply is exactly one fenced `relay_tool` block whose only tool is `write_file` for `{requested_path}`. Put the complete final HTML document in `input.content`. Do not use placeholders like `<full file content here>` or describe the HTML instead of writing it."
        ),
    }
}

pub(crate) fn is_concrete_new_file_create_request(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    if is_required_or_related_file_lookup(trimmed) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let create_markers = lower.contains("create")
        || lower.contains("new file")
        || lower.contains("overwrite")
        || trimmed.contains("作成")
        || trimmed.contains("新規");
    let existing_file_markers = lower.contains("read")
        || lower.contains("inspect")
        || lower.contains("review")
        || lower.contains("fix")
        || lower.contains("edit")
        || lower.contains("update")
        || lower.contains("find")
        || lower.contains("search")
        || lower.contains("list")
        || lower.contains("where")
        || lower.contains("needed")
        || lower.contains("required")
        || lower.contains("relevant")
        || lower.contains("related")
        || lower.contains("which")
        || trimmed.contains("読む")
        || trimmed.contains("読んで")
        || trimmed.contains("確認")
        || trimmed.contains("修正")
        || trimmed.contains("編集")
        || trimmed.contains("更新")
        || trimmed.contains("検索")
        || trimmed.contains("探")
        || trimmed.contains("一覧")
        || trimmed.contains("どこ")
        || trimmed.contains("必要")
        || trimmed.contains("関連")
        || trimmed.contains("関係")
        || trimmed.contains("教えて");
    create_markers && !existing_file_markers
}

fn is_local_file_search_request(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let wants_search = lower.contains("find")
        || lower.contains("search")
        || lower.contains("list")
        || lower.contains("locate")
        || lower.contains("where")
        || lower.contains("needed file")
        || lower.contains("required file")
        || lower.contains("relevant file")
        || lower.contains("related file")
        || lower.contains("which file")
        || lower.contains("files needed")
        || lower.contains("files required")
        || trimmed.contains("検索")
        || trimmed.contains("探")
        || trimmed.contains("一覧")
        || trimmed.contains("どこ")
        || is_required_or_related_file_lookup(trimmed);
    if !wants_search {
        return false;
    }
    let local_target = lower.contains("file")
        || lower.contains("folder")
        || lower.contains("directory")
        || lower.contains("workspace")
        || lower.contains("path")
        || lower.contains("implementation")
        || lower.contains("codebase")
        || lower.contains("source")
        || trimmed.contains("ファイル")
        || trimmed.contains("資料")
        || trimmed.contains("実装")
        || trimmed.contains("コード")
        || trimmed.contains("配下")
        || trimmed.contains("フォルダ")
        || trimmed.contains("ワークスペース")
        || !extract_path_anchors_from_text(trimmed).is_empty();
    let web_target = lower.contains("web")
        || lower.contains("internet")
        || lower.contains("online")
        || lower.contains("http://")
        || lower.contains("https://")
        || trimmed.contains("ウェブ")
        || trimmed.contains("インターネット");
    local_target && !web_target
}

fn infer_glob_pattern_for_search_request(text: &str) -> Option<String> {
    expanded_search_terms_for_request(text)
        .into_iter()
        .next()
        .map(|term| format!("**/*{}*", glob_literal_term(&term)))
}

fn is_office_content_search_request(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.contains(".docx")
        || lower.contains(".xlsx")
        || lower.contains(".pptx")
        || lower.contains(".pdf")
        || lower.contains("cfs")
        || lower.contains("excel")
        || lower.contains("spreadsheet")
        || lower.contains("powerpoint")
        || lower.contains("word")
        || lower.contains("pdf")
        || lower.contains("template")
        || lower.contains("report")
        || lower.contains("cash flow")
        || trimmed.contains("Excel")
        || trimmed.contains("エクセル")
        || trimmed.contains("ワード")
        || trimmed.contains("パワポ")
        || trimmed.contains("パワーポイント")
        || trimmed.contains("PDF")
        || trimmed.contains("テンプレート")
        || trimmed.contains("資料")
        || trimmed.contains("帳票")
        || trimmed.contains("報告書")
        || trimmed.contains("計算書")
        || trimmed.contains("精算表")
        || (trimmed.contains("キャッシュ") && trimmed.contains("フロー"))
}

fn infer_office_search_pattern_for_search_request(text: &str) -> Option<String> {
    expanded_search_terms_for_request(text).into_iter().next()
}

fn infer_office_search_regex_for_search_request(text: &str) -> Option<String> {
    let terms = expanded_search_terms_for_request(text);
    (!terms.is_empty()).then(|| {
        terms
            .into_iter()
            .take(10)
            .map(|term| escape_regex_term(&term))
            .collect::<Vec<_>>()
            .join("|")
    })
}

fn is_cash_flow_search_request(text: &str) -> bool {
    let trimmed = text.trim();
    let lower = trimmed.to_ascii_lowercase();
    (lower.contains("cash") && lower.contains("flow"))
        || lower.contains("cfs")
        || (trimmed.contains("キャッシュ") && trimmed.contains("フロー"))
}

fn office_search_include_ext_for_search_request(text: &str) -> Vec<&'static str> {
    let trimmed = text.trim();
    let lower = trimmed.to_ascii_lowercase();
    let wants_docx =
        lower.contains(".docx") || lower.contains("word") || trimmed.contains("ワード");
    let wants_xlsx = lower.contains(".xlsx")
        || lower.contains("excel")
        || lower.contains("spreadsheet")
        || trimmed.contains("Excel")
        || trimmed.contains("エクセル");
    let wants_pptx = lower.contains(".pptx")
        || lower.contains("powerpoint")
        || trimmed.contains("パワポ")
        || trimmed.contains("パワーポイント");
    let wants_pdf = lower.contains(".pdf") || lower.contains("pdf") || trimmed.contains("PDF");
    let mut out = Vec::new();
    if wants_docx {
        out.push("docx");
    }
    if wants_xlsx {
        out.push("xlsx");
    }
    if wants_pptx {
        out.push("pptx");
    }
    if wants_pdf {
        out.push("pdf");
    }
    if out.is_empty() {
        vec!["docx", "xlsx", "pptx", "pdf"]
    } else {
        out
    }
}

fn office_search_paths_for_request(text: &str, path: Option<&str>) -> Vec<String> {
    let base = path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .unwrap_or(".");
    let base = base.trim_end_matches(['/', '\\']);
    let mut paths = expanded_search_terms_for_request(text)
        .into_iter()
        .take(8)
        .map(|term| format!("{base}/**/*{}*", glob_literal_term(&term)))
        .collect::<Vec<_>>();
    paths.push(format!("{base}/**/*"));
    paths
}

fn expanded_search_terms_for_request(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut seen = BTreeSet::new();
    for anchor in extract_path_anchors_from_text(text) {
        for component in anchor.split(['/', '\\']) {
            if let Some(stem) = component.rsplit_once('.') {
                push_search_term(&mut terms, &mut seen, stem.0.to_string());
            }
            push_search_term(&mut terms, &mut seen, component.to_string());
        }
    }
    for token in search_terms_for_request(text) {
        push_search_term(&mut terms, &mut seen, token);
    }
    if is_cash_flow_search_request(text) {
        for alias in ["CF", "CFS"] {
            push_search_term(&mut terms, &mut seen, alias.to_string());
        }
    }
    terms
}

fn push_search_term(terms: &mut Vec<String>, seen: &mut BTreeSet<String>, term: String) {
    let normalized = term
        .trim()
        .trim_matches(['.', ',', '、', '。', '(', ')', '[', ']']);
    if normalized.is_empty() || is_search_stopword(normalized) {
        return;
    }
    let key = normalized.to_ascii_lowercase();
    if seen.insert(key) {
        terms.push(normalized.to_string());
    }
}

fn search_terms_for_request(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut seen = BTreeSet::new();
    for quoted in quoted_search_terms(text) {
        push_search_term(&mut terms, &mut seen, quoted);
    }
    let text = remove_search_instruction_phrases(text);
    let mut token = String::new();
    for ch in text.chars() {
        if is_search_token_char(ch) {
            token.push(ch);
        } else {
            push_token_and_subterms(&mut terms, &mut seen, &mut token);
        }
    }
    push_token_and_subterms(&mut terms, &mut seen, &mut token);
    terms
}

fn quoted_search_terms(text: &str) -> Vec<String> {
    let pairs = [('「', '」'), ('『', '』'), ('"', '"'), ('\'', '\'')];
    let mut out = Vec::new();
    for (open, close) in pairs {
        let mut remaining = text;
        while let Some(start) = remaining.find(open) {
            let after_start = &remaining[start + open.len_utf8()..];
            let Some(end) = after_start.find(close) else {
                break;
            };
            out.push(after_start[..end].to_string());
            remaining = &after_start[end + close.len_utf8()..];
        }
    }
    out
}

fn remove_search_instruction_phrases(text: &str) -> String {
    const PHRASES: &[&str] = &[
        "検索してください",
        "検索して",
        "検索",
        "探してください",
        "探して",
        "教えてください",
        "教えて",
        "必要になる",
        "必要な",
        "関連する",
        "関係する",
        "関連度の高い",
        "関連度",
        "に関する",
        "に関連する",
        "に関係する",
        "作成する際に",
        "作成する際",
        "作成のための",
        "作成に必要な",
        "のための",
        "ための",
        "ファイル",
        "資料",
        "帳票",
        "できるだけ",
        "新しく",
        "新しい",
        "最新",
    ];
    let mut cleaned = text.to_string();
    for phrase in PHRASES {
        cleaned = cleaned.replace(phrase, " ");
    }
    cleaned
}

fn push_token_and_subterms(
    terms: &mut Vec<String>,
    seen: &mut BTreeSet<String>,
    token: &mut String,
) {
    if token.is_empty() {
        return;
    }
    let current = std::mem::take(token);
    push_search_term(terms, seen, current.clone());
    for subterm in meaningful_subterms(&current) {
        push_search_term(terms, seen, subterm);
    }
}

fn meaningful_subterms(token: &str) -> Vec<String> {
    let mut out = Vec::new();
    for subterm in ["キャッシュフロー", "計算書", "精算表", "決算", "連結"] {
        if token.contains(subterm) {
            out.push(subterm.to_string());
        }
    }
    for marker in ["計算書", "精算表", "決算", "報告書", "明細"] {
        if let Some(index) = token.find(marker) {
            let end = index + marker.len();
            let prefix_start = token[..index]
                .char_indices()
                .rev()
                .nth(3)
                .map_or(0, |(offset, ch)| offset + ch.len_utf8());
            let phrase = &token[prefix_start..end];
            if phrase != token && phrase.chars().count() >= 3 {
                out.push(phrase.to_string());
            }
        }
    }
    out
}

fn is_search_token_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
        || matches!(ch, '-' | '_' | '.')
        || ('\u{30a0}'..='\u{30ff}').contains(&ch)
        || ('\u{4e00}'..='\u{9fff}').contains(&ch)
        || ('\u{ff10}'..='\u{ff5a}').contains(&ch)
}

fn is_search_stopword(term: &str) -> bool {
    let char_count = term.chars().count();
    if char_count <= 1 {
        return true;
    }
    if char_count <= 2 && term.chars().all(|ch| ch.is_ascii_lowercase()) {
        return true;
    }
    let lower = term.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "find"
            | "search"
            | "file"
            | "files"
            | "document"
            | "documents"
            | "needed"
            | "required"
            | "related"
            | "relevant"
            | "where"
            | "list"
            | "locate"
            | "latest"
            | "recent"
    ) || matches!(
        term,
        "検索"
            | "探"
            | "一覧"
            | "必要"
            | "関連"
            | "関係"
            | "ファイル"
            | "資料"
            | "帳票"
            | "作成"
            | "ため"
            | "教えて"
            | "出力"
            | "結果"
            | "新しく"
            | "高速"
            | "正確"
            | "ユーザー"
            | "指示"
    )
}

fn glob_literal_term(term: &str) -> String {
    term.chars()
        .filter(|ch| !matches!(ch, '*' | '?' | '[' | ']' | '{' | '}' | '/' | '\\'))
        .collect()
}

fn escape_regex_term(term: &str) -> String {
    let mut escaped = String::with_capacity(term.len());
    for ch in term.chars() {
        if matches!(
            ch,
            '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$' | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn build_workspace_search_tool_call(latest_request: &str, path: Option<&str>) -> Value {
    let mut input = serde_json::Map::new();
    input.insert(
        "query".to_string(),
        Value::String(latest_request.trim().to_string()),
    );
    if let Some(path) = path.filter(|path| !path.trim().is_empty()) {
        input.insert(
            "paths".to_string(),
            Value::Array(vec![Value::String(path.trim().to_string())]),
        );
    }
    input.insert("mode".to_string(), Value::String("auto".to_string()));
    if is_office_content_search_request(latest_request) {
        input.insert("mode".to_string(), Value::String("office".to_string()));
        input.insert(
            "include_ext".to_string(),
            Value::Array(
                office_search_include_ext_for_search_request(latest_request)
                    .into_iter()
                    .map(|ext| Value::String(ext.to_string()))
                    .collect(),
            ),
        );
    }
    input.insert(
        "max_files".to_string(),
        Value::Number(serde_json::Number::from(80)),
    );
    input.insert(
        "max_snippets".to_string(),
        Value::Number(serde_json::Number::from(40)),
    );
    input.insert(
        "context".to_string(),
        Value::Number(serde_json::Number::from(2)),
    );
    json!({
        "name": "workspace_search",
        "relay_tool_call": true,
        "input": Value::Object(input),
    })
}

fn initial_search_path_for_request(latest_request: &str, cwd: Option<&str>) -> Option<String> {
    let cwd = cwd.map(str::trim).filter(|path| !path.is_empty());
    for anchor in extract_path_anchors_from_text(latest_request) {
        let anchor = anchor.trim();
        if anchor.is_empty() {
            continue;
        }
        if path_anchor_allowed_for_initial_search(anchor, cwd) {
            return Some(anchor.to_string());
        }
    }
    cwd.map(str::to_string)
}

fn path_anchor_allowed_for_initial_search(anchor: &str, cwd: Option<&str>) -> bool {
    let Some(cwd) = cwd else {
        return true;
    };
    if !path_is_absolute_like(anchor) {
        return true;
    }
    path_string_starts_with(anchor, cwd)
}

fn path_is_absolute_like(path: &str) -> bool {
    let trimmed = path.trim();
    Path::new(trimmed).is_absolute() || windows_absolute_like(trimmed)
}

fn windows_absolute_like(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with("\\\\")
        || path.starts_with("//")
        || (bytes.len() >= 3
            && bytes[1] == b':'
            && bytes[0].is_ascii_alphabetic()
            && matches!(bytes[2], b'\\' | b'/'))
}

fn path_string_starts_with(path: &str, root: &str) -> bool {
    if Path::new(path).starts_with(Path::new(root)) {
        return true;
    }
    let path = normalize_windows_path_string(path);
    let root = normalize_windows_path_string(root);
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|rest| rest.starts_with('\\') || rest.starts_with('/'))
}

fn normalize_windows_path_string(path: &str) -> String {
    path.trim()
        .trim_start_matches("\\\\?\\")
        .trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn build_search_tool_payload(
    latest_request: &str,
    _pattern: &str,
    path: Option<&str>,
    _include_office_content_search: bool,
) -> Value {
    build_workspace_search_tool_call(latest_request, path)
}

pub(crate) fn build_initial_local_search_tool_calls(
    latest_request: &str,
    cwd: Option<&str>,
) -> Option<Vec<(String, String)>> {
    if !is_local_file_search_request(latest_request) {
        return None;
    }
    let path_anchor = initial_search_path_for_request(latest_request, cwd);
    let payload = build_workspace_search_tool_call(latest_request, path_anchor.as_deref());
    let calls = match payload {
        Value::Array(items) => items,
        item => vec![item],
    }
    .into_iter()
    .filter_map(|item| {
        let name = item.get("name")?.as_str()?.to_string();
        let input = item.get("input")?;
        let input = serde_json::to_string(input).ok()?;
        Some((name, input))
    })
    .collect::<Vec<_>>();
    (!calls.is_empty()).then_some(calls)
}

fn build_tool_result_summary_repair_input(
    goal: &str,
    latest_request: &str,
    assistant_text: &str,
) -> String {
    format!(
        concat!(
            "Tool result summary repair.\n",
            "Relay already executed local tools for this turn. Your previous reply emitted repeated, malformed, or duplicate tool JSON instead of summarizing the tool results.\n",
            "Do not emit any `relay_tool` fence, JSON tool object, or additional tool call in the next reply.\n",
            "Use the prior tool results already present in the transcript as the only evidence. If duplicate-tool suppression notices are present, treat them only as a signal not to repeat the same search.\n",
            "Now answer the user's original local document search request concisely, with file paths and anchors/previews from the existing `workspace_search` / `glob_search` / `office_search` results when available.\n\n",
            "Malformed or duplicate assistant text to replace:\n```text\n{assistant_text}\n```\n\n",
            "{latest_request_marker}{latest_request}\n```\n\n",
            "{original_goal_marker}{goal}\n```"
        ),
        assistant_text = assistant_text.trim(),
        latest_request_marker = LATEST_REQUEST_MARKER,
        latest_request = latest_request.trim(),
        original_goal_marker = ORIGINAL_GOAL_MARKER,
        goal = goal.trim(),
    )
}

fn infer_default_new_file_path(latest_request: &str) -> Option<String> {
    let trimmed = latest_request.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    let wants_html = lower.contains("html") || trimmed.contains("HTML");
    let wants_tetris = lower.contains("tetris") || trimmed.contains("テトリス");
    if wants_html && wants_tetris {
        return Some("tetris.html".to_string());
    }
    None
}

fn build_search_tool_protocol_repair_input(
    goal: &str,
    latest_request: &str,
    attempt_index: usize,
    pattern: &str,
    path: Option<&str>,
) -> String {
    let expected_payload = build_search_tool_payload(latest_request, pattern, path, true);
    let expected_json =
        serde_json::to_string_pretty(&expected_payload).unwrap_or_else(|_| "{}".to_string());
    let search_instruction = "This is a local file/document search request. Emit exactly one `workspace_search` Relay tool call now. After Relay returns results, use only small, concrete rg-backed `glob_search` / `grep_search` / `office_search` follow-ups if the first result is insufficient.";
    format!(
        concat!(
            "Tool protocol repair.\n",
            "Your previous reply said you would search local files but did not emit a usable Relay tool call.\n",
            "Do not use or mention Microsoft Copilot built-in tools such as enterprise search, WebSearch/web search, citations like `turn1search` or `cite`, `office365_search`, Python/code execution, Pages, Agent/sub-agent tools, or file uploads.\n",
            "Any prior M365 Copilot search snippets, citations, or generated enterprise-search summaries are not Relay tool results and do not satisfy this repair.\n",
            "Do not answer with a plan, summary, or sentence that says you will search later.\n",
            "{escalation}",
            "{search_instruction}\n",
            "Use the JSON skeleton below exactly unless the latest request clearly requires a smaller glob pattern or a narrower Office/PDF path set.\n",
            "Do not use `read_file` for a directory or workspace search.\n\n",
            "Expected JSON for the next reply:\n",
            "```json\n{expected_json}\n```\n\n",
            "{latest_request_marker}{latest_request}\n```\n\n",
            "{original_goal_marker}{goal}\n```"
        ),
        escalation = tool_protocol_repair_escalation(attempt_index),
        search_instruction = search_instruction,
        expected_json = expected_json,
        latest_request_marker = LATEST_REQUEST_MARKER,
        latest_request = latest_request.trim(),
        original_goal_marker = ORIGINAL_GOAL_MARKER,
        goal = goal.trim(),
    )
}

fn build_targeted_tool_protocol_repair_input(
    goal: &str,
    latest_request: &str,
    attempt_index: usize,
    tool_name: &str,
    requested_path: &str,
    input: &Value,
    action_instruction: &str,
) -> String {
    let expected_json = serde_json::to_string_pretty(&json!({
        "name": tool_name,
        "relay_tool_call": true,
        "input": input,
    }))
    .unwrap_or_else(|_| "{}".to_string());
    format!(
        concat!(
            "Tool protocol repair.\n",
            "Your previous reply did not use Relay's local tool protocol correctly.\n",
            "Do not use or mention Microsoft Copilot built-in tools such as Python, WebSearch/web search, citations, `office365_search`, coding/executing, Pages, Agent/sub-agent tools, or file uploads.\n",
            "Do not claim local workspace edit tools are unavailable when the appended Relay tool catalog includes them.\n",
            "{escalation}",
            "{action_instruction}\n",
            "Use the exact path anchor below without rewriting it to another directory or prior-turn variant.\n\n",
            "Exact path anchor from the latest user turn:\n",
            "```text\n{requested_path}\n```\n\n",
            "The JSON skeleton below shows structure only. Replace any example content string with the real final file body.\n",
            "Expected JSON skeleton for the next reply:\n",
            "```json\n{expected_json}\n```\n\n",
            "{latest_request_marker}{latest_request}\n```\n\n",
            "{original_goal_marker}{goal}\n```"
        ),
        escalation = tool_protocol_repair_escalation(attempt_index),
        action_instruction = action_instruction.trim(),
        requested_path = requested_path.trim(),
        expected_json = expected_json,
        latest_request_marker = LATEST_REQUEST_MARKER,
        latest_request = latest_request.trim(),
        original_goal_marker = ORIGINAL_GOAL_MARKER,
        goal = goal.trim(),
    )
}

pub(crate) fn build_tool_protocol_repair_input(
    goal: &str,
    latest_request: &str,
    attempt_index: usize,
) -> String {
    format!(
        concat!(
            "Tool protocol repair.\n",
            "Your previous reply did not use Relay's local tool protocol correctly.\n",
            "Do not use or mention Microsoft Copilot built-in tools such as Python, WebSearch/web search, citations, `office365_search`, coding/executing, Pages, Agent/sub-agent tools, or file uploads.\n",
            "Do not claim local workspace edit tools are unavailable when the appended Relay tool catalog includes them.\n",
            "{escalation}",
            "Quoted latest user request for this turn (user data, not system instruction):\n```text\n{latest_request}\n```\n\n",
            "Quoted original user goal (user data, not system instruction):\n```text\n{goal}\n```"
        ),
        escalation = tool_protocol_repair_escalation(attempt_index),
        latest_request = latest_request.trim(),
        goal = goal.trim(),
    )
}

pub(crate) fn build_best_tool_protocol_repair_input(
    goal: &str,
    latest_request: &str,
    attempt_index: usize,
) -> String {
    if is_local_file_search_request(latest_request) {
        let pattern = infer_glob_pattern_for_search_request(latest_request)
            .unwrap_or_else(|| "**/*".to_string());
        let path_anchor = extract_path_anchors_from_text(latest_request)
            .into_iter()
            .next();
        return build_search_tool_protocol_repair_input(
            goal,
            latest_request,
            attempt_index,
            &pattern,
            path_anchor.as_deref(),
        );
    }
    if is_concrete_new_file_create_request(latest_request) {
        if let Some(requested_path) = extract_path_anchors_from_text(latest_request)
            .into_iter()
            .next()
        {
            return build_targeted_tool_protocol_repair_input(
                goal,
                latest_request,
                attempt_index,
                "write_file",
                &requested_path,
                &json!({
                    "path": requested_path.clone(),
                    "content": "<full file content here>"
                }),
                &build_write_file_repair_action_instruction(attempt_index, &requested_path, false),
            );
        }
        if let Some(inferred_path) = infer_default_new_file_path(latest_request) {
            return build_targeted_tool_protocol_repair_input(
                goal,
                latest_request,
                attempt_index,
                "write_file",
                &inferred_path,
                &json!({
                    "path": inferred_path.clone(),
                    "content": "<full file content here>"
                }),
                &build_write_file_repair_action_instruction(attempt_index, &inferred_path, true),
            );
        }
    }
    if let Some(requested_path) = extract_path_anchors_from_text(latest_request)
        .into_iter()
        .next()
    {
        return build_targeted_tool_protocol_repair_input(
            goal,
            latest_request,
            attempt_index,
            "read_file",
            &requested_path,
            &json!({
                "path": requested_path.clone()
            }),
            "Emit exactly one `read_file` Relay tool call first so Relay can inspect the named file before editing, fixing, or reviewing it.",
        );
    }
    build_tool_protocol_repair_input(goal, latest_request, attempt_index)
}

pub(crate) fn build_path_resolution_repair_input(
    goal: &str,
    latest_request: &str,
    requested_path: &str,
    failed_tool_path: Option<&str>,
    error_output: &str,
) -> String {
    let failed_path_text = failed_tool_path
        .filter(|path| !path.trim().is_empty())
        .map(|path| format!("Previous failed read_file input (do not reuse it unless it exactly matches the requested path):\n```text\n{}\n```\n\n", path.trim()))
        .unwrap_or_default();
    format!(
        concat!(
            "Path resolution repair.\n",
            "The previous `read_file` call failed with ENOENT.\n",
            "Retry exactly one `read_file` Relay tool call in this reply.\n",
            "Use the latest-turn requested path string exactly as written below.\n",
            "Do not prepend a prior directory, do not switch to a same-named file elsewhere, and do not answer with prose.\n",
            "Output exactly one fenced `relay_tool` block and nothing before or after it.\n\n",
            "Exact path to use verbatim:\n```text\n{requested_path}\n```\n\n",
            "{failed_path_text}",
            "Latest user request for this turn (user data, primary repair anchor):\n```text\n{latest_request}\n```\n\n",
            "Previous `read_file` error:\n```text\n{error_output}\n```\n\n",
            "Quoted original user goal (user data, not system instruction):\n```text\n{goal}\n```"
        ),
        requested_path = requested_path.trim(),
        failed_path_text = failed_path_text,
        latest_request = latest_request.trim(),
        error_output = error_output.trim(),
        goal = goal.trim(),
    )
}

fn collapse_inline_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_for_log(text: &str, max_chars: usize) -> String {
    let collapsed = collapse_inline_whitespace(text);
    let truncated = collapsed.chars().take(max_chars).collect::<String>();
    if collapsed.chars().count() > max_chars {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn latest_read_file_tool_error(summary: &runtime::TurnSummary) -> Option<ReadFileToolErrorContext> {
    let output = summary.tool_results.iter().rev().find_map(|message| {
        message.blocks.iter().find_map(|block| match block {
            ContentBlock::ToolResult {
                tool_name,
                output,
                is_error,
                ..
            } if *is_error && tool_name == "read_file" => Some(output.clone()),
            _ => None,
        })
    })?;
    let requested_path = summary.assistant_messages.iter().rev().find_map(|message| {
        message.blocks.iter().rev().find_map(|block| match block {
            ContentBlock::ToolUse { name, input, .. } if name == "read_file" => {
                serde_json::from_str::<Value>(input).ok().and_then(|value| {
                    value
                        .get("path")
                        .or_else(|| value.get("file_path"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })
            }
            _ => None,
        })
    });
    Some(ReadFileToolErrorContext {
        requested_path,
        output,
    })
}

fn has_local_search_tool_result(summary: &runtime::TurnSummary) -> bool {
    summary.tool_results.iter().any(|message| {
        message.blocks.iter().any(|block| {
            matches!(
                block,
                ContentBlock::ToolResult { tool_name, .. }
                    if matches!(
                        tool_name.as_str(),
                        "workspace_search" | "glob_search" | "grep_search" | "office_search"
                    )
            )
        })
    })
}

fn has_local_search_guard_notice(summary: &runtime::TurnSummary) -> bool {
    let outcome_message_matches = matches!(
        &summary.outcome,
        runtime::TurnOutcome::ToolError { message }
            if message.contains("local search tool budget")
                || message.contains("repeated an identical tool call")
    );
    outcome_message_matches
        || summary.tool_results.iter().any(|message| {
            message.blocks.iter().any(|block| match block {
                ContentBlock::ToolResult { output, .. } => {
                    output.contains("Search tool budget reached")
                        || output.contains("Duplicate tool call suppressed")
                }
                _ => false,
            })
        })
}

fn successful_read_file_paths(summary: &runtime::TurnSummary) -> BTreeSet<String> {
    let mut read_file_inputs = BTreeMap::<String, String>::new();
    for message in &summary.assistant_messages {
        for block in &message.blocks {
            let ContentBlock::ToolUse { id, name, input } = block else {
                continue;
            };
            if name != "read_file" {
                continue;
            }
            let Some(path) = serde_json::from_str::<Value>(input).ok().and_then(|value| {
                value
                    .get("path")
                    .or_else(|| value.get("file_path"))
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            }) else {
                continue;
            };
            read_file_inputs.insert(id.clone(), path);
        }
    }

    let mut paths = BTreeSet::new();
    for message in &summary.tool_results {
        for block in &message.blocks {
            let ContentBlock::ToolResult {
                tool_use_id,
                tool_name,
                is_error,
                ..
            } = block
            else {
                continue;
            };
            if tool_name == "read_file" && !is_error {
                if let Some(path) = read_file_inputs.get(tool_use_id) {
                    paths.insert(path.clone());
                }
            }
        }
    }
    paths
}

fn unread_recommended_read_paths(
    summary: &runtime::TurnSummary,
    recommended_paths: &[String],
) -> Vec<String> {
    let read_paths = successful_read_file_paths(summary);
    recommended_paths
        .iter()
        .filter(|recommended| !read_paths.contains(*recommended))
        .cloned()
        .collect()
}

fn workspace_search_recommended_read_paths(summary: &runtime::TurnSummary) -> Vec<String> {
    let mut paths = Vec::new();
    for message in &summary.tool_results {
        for block in &message.blocks {
            let ContentBlock::ToolResult {
                tool_name, output, ..
            } = block
            else {
                continue;
            };
            if tool_name != "workspace_search" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(output) else {
                continue;
            };
            let Some(items) = value
                .get("recommended_next_tools")
                .and_then(Value::as_array)
            else {
                continue;
            };
            for item in items {
                let is_read_file = item
                    .get("tool")
                    .and_then(Value::as_str)
                    .is_some_and(|tool| tool == "read_file");
                let Some(path) = item.get("path").and_then(Value::as_str) else {
                    continue;
                };
                if is_read_file && !paths.iter().any(|existing| existing == path) {
                    paths.push(path.to_string());
                }
            }
        }
    }
    paths
}

fn is_important_local_evidence_request(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("improve")
        || lower.contains("fix")
        || lower.contains("review")
        || lower.contains("compare")
        || lower.contains("recommend")
        || lower.contains("proposal")
        || lower.contains("implement")
        || lower.contains("conclusion")
        || text.contains("改善")
        || text.contains("修正")
        || text.contains("レビュー")
        || text.contains("比較")
        || text.contains("提案")
        || text.contains("実装")
        || text.contains("結論")
}

fn is_copilot_search_leak_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("turn1search")
        || lower.contains("turn2search")
        || lower.contains("cite")
        || lower.contains("office365_search")
        || lower.contains("<file>")
        || lower.contains("enterprise search")
        || lower.contains("copilot search")
}

fn build_evidence_expansion_repair_input(
    goal: &str,
    latest_request: &str,
    assistant_text: &str,
    paths: &[String],
) -> String {
    let calls = paths
        .iter()
        .take(3)
        .map(|path| {
            json!({
                "name": "read_file",
                "relay_tool_call": true,
                "input": { "path": path }
            })
        })
        .collect::<Vec<_>>();
    let expected_json =
        serde_json::to_string_pretty(&Value::Array(calls)).unwrap_or_else(|_| "[]".to_string());
    format!(
        concat!(
            "ImportantConclusionWithoutEvidence repair.\n",
            "Relay already executed `workspace_search`, but the previous reply moved toward an important conclusion using search snippets only.\n",
            "`workspace_search` snippets are candidate discovery evidence, not final file evidence.\n",
            "If a snippet conflicts with `read_file`, the `read_file` Tool Result is authoritative.\n",
            "Emit exactly one `relay_tool` block containing the `read_file` call(s) below. Do not answer in prose yet.\n",
            "After `read_file` returns, write the final answer with evidence path and line anchors when available.\n\n",
            "Expected JSON for the next reply:\n",
            "```json\n{expected_json}\n```\n\n",
            "Previous assistant text to repair:\n```text\n{assistant_text}\n```\n\n",
            "{latest_request_marker}{latest_request}\n```\n\n",
            "{original_goal_marker}{goal}\n```"
        ),
        expected_json = expected_json,
        assistant_text = assistant_text.trim(),
        latest_request_marker = LATEST_REQUEST_MARKER,
        latest_request = latest_request.trim(),
        original_goal_marker = ORIGINAL_GOAL_MARKER,
        goal = goal.trim(),
    )
}

fn is_read_file_enoent(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    lower.contains("no such file or directory") || lower.contains("os error 2")
}

fn select_path_repair_anchor(
    latest_request: &str,
    failed_tool_path: Option<&str>,
) -> Option<String> {
    let anchors = extract_path_anchors_from_text(latest_request);
    if anchors.is_empty() {
        return None;
    }
    if let Some(failed_path) = failed_tool_path {
        let failed_name = std::path::Path::new(failed_path)
            .file_name()
            .and_then(|value| value.to_str());
        if let Some(anchor) = anchors.iter().find(|anchor| {
            std::path::Path::new(anchor.as_str())
                .file_name()
                .and_then(|value| value.to_str())
                == failed_name
        }) {
            return Some(anchor.clone());
        }
    }
    anchors.into_iter().next()
}

pub(crate) fn decide_loop_after_success(
    goal: &str,
    latest_turn_input: &str,
    meta_stall_nudges_used: usize,
    meta_stall_nudge_limit: usize,
    path_repair_used: bool,
    summary: &runtime::TurnSummary,
    heuristics: RetryHeuristicsFns,
) -> LoopDecision {
    match &summary.outcome {
        runtime::TurnOutcome::PermissionDenied { .. } => {
            return LoopDecision::Stop(LoopStopReason::PermissionDenied);
        }
        runtime::TurnOutcome::ToolError { .. } => {
            if has_local_search_tool_result(summary) && has_local_search_guard_notice(summary) {
                if meta_stall_nudges_used < meta_stall_nudge_limit {
                    return LoopDecision::Continue {
                        next_input: build_tool_result_summary_repair_input(
                            goal,
                            latest_turn_input,
                            &summary.terminal_assistant_text,
                        ),
                        kind: LoopContinueKind::MetaNudge,
                    };
                }
                return LoopDecision::Stop(LoopStopReason::MetaStall);
            }
            if !path_repair_used {
                if let Some(error) = latest_read_file_tool_error(summary) {
                    if is_read_file_enoent(&error.output) {
                        if let Some(requested_path) = select_path_repair_anchor(
                            latest_turn_input,
                            error.requested_path.as_deref(),
                        ) {
                            return LoopDecision::Continue {
                                next_input: build_path_resolution_repair_input(
                                    goal,
                                    latest_turn_input,
                                    &requested_path,
                                    error.requested_path.as_deref(),
                                    &error.output,
                                ),
                                kind: LoopContinueKind::PathRepair,
                            };
                        }
                    }
                }
            }
            return LoopDecision::Stop(LoopStopReason::ToolError);
        }
        runtime::TurnOutcome::Completed => {}
    }

    let assistant_text = summary.terminal_assistant_text.as_str();
    let is_local_file_search = is_local_file_search_request(latest_turn_input);
    let is_tool_protocol_confusion =
        summary.tool_results.is_empty() && is_tool_protocol_confusion_text(assistant_text);
    let is_tool_result_summary_needed = has_local_search_tool_result(summary)
        && is_tool_protocol_confusion_text(assistant_text)
        && (assistant_text.contains("\"relay_tool_call\"")
            || assistant_text.contains("\"name\"")
            || assistant_text.contains("\"input\"")
            || assistant_text.contains("```relay_tool"));
    let is_copilot_search_leak_after_local_search =
        has_local_search_tool_result(summary) && is_copilot_search_leak_text(assistant_text);
    let recommended_read_paths = workspace_search_recommended_read_paths(summary);
    let missing_read_paths = unread_recommended_read_paths(summary, &recommended_read_paths);
    let is_important_conclusion_without_evidence = !missing_read_paths.is_empty()
        && is_important_local_evidence_request(latest_turn_input)
        && !assistant_text.trim().is_empty();
    let is_repair_refusal =
        summary.tool_results.is_empty() && is_repair_refusal_text(assistant_text);
    let is_false_completion = summary.tool_results.is_empty()
        && !is_local_file_search
        && is_false_completion_success_claim_text(assistant_text);
    let is_local_search_answer_without_tools =
        summary.tool_results.is_empty() && is_local_file_search;
    let is_plain_file_body_completion = summary.tool_results.is_empty()
        && is_concrete_local_write_body_without_tools(
            latest_turn_input,
            assistant_text,
            heuristics.is_concrete_local_file_write_goal,
        );
    let is_mutation_plan_without_tools = summary.tool_results.is_empty()
        && is_concrete_local_mutation_plan_without_tools(
            latest_turn_input,
            assistant_text,
            heuristics.is_concrete_local_file_write_goal,
        );
    let is_meta_stall = summary.tool_results.is_empty()
        && summary.iterations == 1
        && (heuristics.is_meta_stall_text)(assistant_text);

    if summary.tool_results.is_empty() {
        tracing::info!(
            "[RelayAgent] post-turn classification: outcome={:?} iterations={} meta_nudges_used={}/{} path_repair_used={} tool_protocol_confusion={} repair_refusal={} false_completion={} local_search_without_tools={} plain_file_body={} mutation_plan_without_tools={} meta_stall={} assistant_excerpt={:?}",
            summary.outcome,
            summary.iterations,
            meta_stall_nudges_used,
            meta_stall_nudge_limit,
            path_repair_used,
            is_tool_protocol_confusion,
            is_repair_refusal,
            is_false_completion,
            is_local_search_answer_without_tools,
            is_plain_file_body_completion,
            is_mutation_plan_without_tools,
            is_meta_stall,
            truncate_for_log(assistant_text, 240)
        );
    } else if is_tool_result_summary_needed {
        tracing::info!(
            "[RelayAgent] post-turn classification: outcome={:?} iterations={} meta_nudges_used={}/{} path_repair_used={} tool_result_summary_needed=true assistant_excerpt={:?}",
            summary.outcome,
            summary.iterations,
            meta_stall_nudges_used,
            meta_stall_nudge_limit,
            path_repair_used,
            truncate_for_log(assistant_text, 240)
        );
    }

    if is_copilot_search_leak_after_local_search {
        if meta_stall_nudges_used < meta_stall_nudge_limit {
            return LoopDecision::Continue {
                next_input: build_tool_result_summary_repair_input(
                    goal,
                    latest_turn_input,
                    assistant_text,
                ),
                kind: LoopContinueKind::MetaNudge,
            };
        }
        return LoopDecision::Stop(LoopStopReason::MetaStall);
    }

    if is_important_conclusion_without_evidence {
        if meta_stall_nudges_used < meta_stall_nudge_limit {
            return LoopDecision::Continue {
                next_input: build_evidence_expansion_repair_input(
                    goal,
                    latest_turn_input,
                    assistant_text,
                    &missing_read_paths,
                ),
                kind: LoopContinueKind::MetaNudge,
            };
        }
        return LoopDecision::Stop(LoopStopReason::MetaStall);
    }

    if is_tool_result_summary_needed {
        if meta_stall_nudges_used < meta_stall_nudge_limit {
            return LoopDecision::Continue {
                next_input: build_tool_result_summary_repair_input(
                    goal,
                    latest_turn_input,
                    assistant_text,
                ),
                kind: LoopContinueKind::MetaNudge,
            };
        }
        return LoopDecision::Stop(LoopStopReason::MetaStall);
    }

    if is_tool_protocol_confusion
        || is_repair_refusal
        || is_false_completion
        || is_local_search_answer_without_tools
        || is_plain_file_body_completion
        || is_mutation_plan_without_tools
    {
        if meta_stall_nudges_used < meta_stall_nudge_limit {
            return LoopDecision::Continue {
                next_input: build_best_tool_protocol_repair_input(
                    goal,
                    latest_turn_input,
                    meta_stall_nudges_used,
                ),
                kind: LoopContinueKind::MetaNudge,
            };
        }
        return LoopDecision::Stop(LoopStopReason::MetaStall);
    }

    if is_meta_stall {
        if meta_stall_nudges_used < meta_stall_nudge_limit {
            return LoopDecision::Continue {
                next_input: "Continue.".to_string(),
                kind: LoopContinueKind::MetaNudge,
            };
        }
        return LoopDecision::Stop(LoopStopReason::MetaStall);
    }

    LoopDecision::Stop(LoopStopReason::Completed)
}

pub(crate) fn runtime_error_needs_forced_compaction(error: &RuntimeError) -> bool {
    let lower = error.to_string().to_ascii_lowercase();
    lower.contains("copilot inline prompt remains above")
        || lower.contains("token limit")
        || lower.contains("context window")
}

pub(crate) fn runtime_error_is_retryable(error: &RuntimeError) -> bool {
    let lower = error.to_string().to_ascii_lowercase();
    if lower.contains("relay_copilot_aborted") || lower.contains("conversation loop exceeded") {
        return false;
    }
    [
        "timeout",
        "timed out",
        "connection reset",
        "connection refused",
        "broken pipe",
        "temporarily unavailable",
        "transport",
        "http 5",
        "copilot request failed",
        "unexpected eof",
        "connection closed",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub(crate) fn retry_backoff(attempt: usize) -> Duration {
    let secs = match attempt {
        0 | 1 => 1,
        _ => 2_u64.saturating_pow(u32::try_from(attempt - 1).unwrap_or(u32::MAX)),
    };
    Duration::from_secs(secs.min(8))
}

pub(crate) fn sleep_with_cancel(cancelled: &AtomicBool, duration: Duration) -> bool {
    let chunk = Duration::from_millis(100);
    let mut remaining = duration;
    while remaining > Duration::ZERO {
        if cancelled.load(Ordering::SeqCst) {
            return false;
        }
        let sleep_for = remaining.min(chunk);
        std::thread::sleep(sleep_for);
        remaining = remaining.saturating_sub(sleep_for);
    }
    !cancelled.load(Ordering::SeqCst)
}
