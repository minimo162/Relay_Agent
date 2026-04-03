use serde_json::Value;

use crate::{
    file_support,
    models::{DiffSummary, Session, SpreadsheetAction, ToolExecutionResult, Turn},
    storage::AppStorage,
    workbook::WorkbookEngine,
};

pub fn execute_read_action(
    storage: &AppStorage,
    session: &Session,
    turn: &Turn,
    action: &SpreadsheetAction,
    current_diff: &DiffSummary,
) -> ToolExecutionResult {
    let outcome = invoke_read_action(storage, session, turn, current_diff, action);

    match outcome {
        Ok(result) => ToolExecutionResult {
            tool: action.tool.clone(),
            args: action.args.clone(),
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => ToolExecutionResult {
            tool: action.tool.clone(),
            args: action.args.clone(),
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

fn invoke_read_action(
    storage: &AppStorage,
    session: &Session,
    turn: &Turn,
    current_diff: &DiffSummary,
    action: &SpreadsheetAction,
) -> Result<Value, String> {
    match action.tool.as_str() {
        "workbook.inspect" => {
            let source = storage.resolve_workbook_source(
                session,
                action.args.get("sourcePath").and_then(Value::as_str),
            )?;
            serde_json::to_value(WorkbookEngine::default().inspect_workbook(&source)?)
                .map_err(|error| format!("failed to serialize workbook profile: {error}"))
        }
        "sheet.preview" => {
            let sheet = required_arg_string(&action.args, "sheet")?;
            let source = storage.resolve_workbook_source(session, None)?;
            let preview = WorkbookEngine::default().sheet_preview(
                &source,
                &sheet,
                action
                    .args
                    .get("limit")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize),
            )?;
            serde_json::to_value(preview)
                .map_err(|error| format!("failed to serialize sheet preview: {error}"))
        }
        "sheet.profile_columns" => {
            let sheet = required_arg_string(&action.args, "sheet")?;
            let source = storage.resolve_workbook_source(session, None)?;
            let profile = WorkbookEngine::default().profile_sheet_columns(
                &source,
                &sheet,
                action
                    .args
                    .get("sampleSize")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize),
            )?;
            serde_json::to_value(profile)
                .map_err(|error| format!("failed to serialize column profile: {error}"))
        }
        "session.diff_from_base" => {
            let diff = storage.session_diff_from_base(
                session,
                turn,
                action.args.get("artifactId").and_then(Value::as_str),
                current_diff,
            )?;
            serde_json::to_value(diff)
                .map_err(|error| format!("failed to serialize diff summary: {error}"))
        }
        "file.list" => file_support::execute_file_list(&action.args),
        "file.read_text" => file_support::execute_file_read_text(&action.args),
        "file.stat" => file_support::execute_file_stat(&action.args),
        "text.search" => file_support::execute_text_search(&action.args),
        "document.read_text" => file_support::execute_document_read_text(&action.args),
        "browser.send_to_copilot" => {
            Err("browser tools are executed via the desktop browser automation command".to_string())
        }
        tool => Err(format!("unknown read tool: {tool}")),
    }
}

fn required_arg_string(args: &Value, field: &str) -> Result<String, String> {
    args.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{field} is required"))
}
