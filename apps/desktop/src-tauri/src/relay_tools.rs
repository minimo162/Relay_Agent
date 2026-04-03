use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use claw_tools::{Tool, ToolContext, ToolOutput, ToolRegistry};
use serde_json::{json, Value};

use crate::{
    file_support, models::SpreadsheetAction, storage::AppStorage, workbook::WorkbookEngine,
};

pub fn register_relay_tools(registry: &mut ToolRegistry, storage: Arc<Mutex<AppStorage>>) {
    registry.register(Arc::new(WorkbookInspectTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(SheetPreviewTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(SheetProfileColumnsTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(SessionDiffTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(TableRenameColumnsTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(TableCastColumnsTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(TableFilterRowsTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(TableDeriveColumnTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(TableGroupAggregateTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(WorkbookSaveCopyTool::new(Arc::clone(&storage))));
    registry.register(Arc::new(DocumentReadTextTool));
}

struct RelayStorageTool {
    storage: Arc<Mutex<AppStorage>>,
}

impl RelayStorageTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self { storage }
    }

    fn resolve_source(
        &self,
        ctx: &ToolContext,
        input: &Value,
    ) -> Result<crate::workbook::WorkbookSource, String> {
        let source_path = input.get("sourcePath").and_then(Value::as_str);
        let storage = self.storage.lock().expect("relay tool storage poisoned");
        storage.resolve_workbook_source_for_session(&ctx.session_id, source_path)
    }

    fn session_diff(&self, ctx: &ToolContext, input: &Value) -> Result<Value, String> {
        let artifact_id = input.get("artifactId").and_then(Value::as_str);
        let storage = self.storage.lock().expect("relay tool storage poisoned");
        let diff = storage.session_diff_from_base_for_session(&ctx.session_id, artifact_id)?;
        serde_json::to_value(diff)
            .map_err(|error| format!("failed to serialize diff summary: {error}"))
    }

    fn write_action_result(
        &self,
        ctx: &ToolContext,
        tool_name: &str,
        input: Value,
    ) -> Result<Value, String> {
        let source = self.resolve_source(ctx, &input)?;
        let actions = build_actions(tool_name, input)?;
        let execution = WorkbookEngine::default().execute_actions(&source, &actions)?;
        Ok(json!({
            "tool": tool_name,
            "outputPath": execution.output_path,
            "warnings": execution.warnings,
        }))
    }
}

struct WorkbookInspectTool(RelayStorageTool);
struct SheetPreviewTool(RelayStorageTool);
struct SheetProfileColumnsTool(RelayStorageTool);
struct SessionDiffTool(RelayStorageTool);
struct TableRenameColumnsTool(RelayStorageTool);
struct TableCastColumnsTool(RelayStorageTool);
struct TableFilterRowsTool(RelayStorageTool);
struct TableDeriveColumnTool(RelayStorageTool);
struct TableGroupAggregateTool(RelayStorageTool);
struct WorkbookSaveCopyTool(RelayStorageTool);
struct DocumentReadTextTool;

impl WorkbookInspectTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl SheetPreviewTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl SheetProfileColumnsTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl SessionDiffTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl TableRenameColumnsTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl TableCastColumnsTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl TableFilterRowsTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl TableDeriveColumnTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl TableGroupAggregateTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

impl WorkbookSaveCopyTool {
    fn new(storage: Arc<Mutex<AppStorage>>) -> Self {
        Self(RelayStorageTool::new(storage))
    }
}

fn json_tool_output(value: Value) -> anyhow::Result<ToolOutput> {
    Ok(ToolOutput {
        content: serde_json::to_string_pretty(&value)?,
        is_error: false,
        metadata: Some(value),
    })
}

fn required_string(input: &Value, field: &str, tool_name: &str) -> anyhow::Result<String> {
    input
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("{tool_name} requires `{field}`"))
}

fn build_actions(tool_name: &str, input: Value) -> Result<Vec<SpreadsheetAction>, String> {
    let mut args = input;
    let output_path = args
        .get("outputPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let sheet = args
        .get("sheet")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if let Some(object) = args.as_object_mut() {
        object.remove("sourcePath");
        if tool_name != "workbook.save_copy" {
            object.remove("outputPath");
        }
    }

    let mut actions = vec![SpreadsheetAction {
        id: None,
        tool: tool_name.to_string(),
        rationale: None,
        sheet,
        args,
    }];

    if tool_name != "workbook.save_copy" {
        if let Some(output_path) = output_path {
            actions.push(SpreadsheetAction {
                id: None,
                tool: "workbook.save_copy".to_string(),
                rationale: None,
                sheet: None,
                args: json!({ "outputPath": output_path }),
            });
        }
    }

    Ok(actions)
}

macro_rules! impl_write_tool {
    ($tool_ty:ident, $name:literal, $description:literal, $schema:expr) => {
        #[async_trait]
        impl Tool for $tool_ty {
            fn name(&self) -> &str {
                $name
            }

            fn description(&self) -> &str {
                $description
            }

            fn input_schema(&self) -> Value {
                $schema
            }

            async fn execute(&self, ctx: &ToolContext, input: Value) -> anyhow::Result<ToolOutput> {
                json_tool_output(
                    self.0
                        .write_action_result(ctx, $name, input)
                        .map_err(anyhow::Error::msg)?,
                )
            }
        }
    };
}

#[async_trait]
impl Tool for WorkbookInspectTool {
    fn name(&self) -> &str {
        "workbook.inspect"
    }

    fn description(&self) -> &str {
        "Inspect workbook metadata, sheets, columns, and CSV/XLSX summary information."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sourcePath": { "type": "string" }
            }
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: Value) -> anyhow::Result<ToolOutput> {
        let source = self
            .0
            .resolve_source(ctx, &input)
            .map_err(anyhow::Error::msg)?;
        let profile = WorkbookEngine::default()
            .inspect_workbook(&source)
            .map_err(anyhow::Error::msg)?;
        json_tool_output(serde_json::to_value(profile)?)
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[async_trait]
impl Tool for SheetPreviewTool {
    fn name(&self) -> &str {
        "sheet.preview"
    }

    fn description(&self) -> &str {
        "Read a row sample from a workbook sheet."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sourcePath": { "type": "string" },
                "sheet": { "type": "string" },
                "limit": { "type": "integer", "minimum": 1 }
            },
            "required": ["sheet"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: Value) -> anyhow::Result<ToolOutput> {
        let sheet = required_string(&input, "sheet", self.name())?;
        let source = self
            .0
            .resolve_source(ctx, &input)
            .map_err(anyhow::Error::msg)?;
        let preview = WorkbookEngine::default()
            .sheet_preview(
                &source,
                &sheet,
                input
                    .get("limit")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize),
            )
            .map_err(anyhow::Error::msg)?;
        json_tool_output(serde_json::to_value(preview)?)
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[async_trait]
impl Tool for SheetProfileColumnsTool {
    fn name(&self) -> &str {
        "sheet.profile_columns"
    }

    fn description(&self) -> &str {
        "Profile workbook sheet columns with inferred types and sample values."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sourcePath": { "type": "string" },
                "sheet": { "type": "string" },
                "sampleSize": { "type": "integer", "minimum": 1 }
            },
            "required": ["sheet"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: Value) -> anyhow::Result<ToolOutput> {
        let sheet = required_string(&input, "sheet", self.name())?;
        let source = self
            .0
            .resolve_source(ctx, &input)
            .map_err(anyhow::Error::msg)?;
        let profile = WorkbookEngine::default()
            .profile_sheet_columns(
                &source,
                &sheet,
                input
                    .get("sampleSize")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize),
            )
            .map_err(anyhow::Error::msg)?;
        json_tool_output(serde_json::to_value(profile)?)
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[async_trait]
impl Tool for SessionDiffTool {
    fn name(&self) -> &str {
        "session.diff_from_base"
    }

    fn description(&self) -> &str {
        "Read the latest diff summary for the current session compared to the original workbook."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "artifactId": { "type": "string" }
            }
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: Value) -> anyhow::Result<ToolOutput> {
        json_tool_output(
            self.0
                .session_diff(ctx, &input)
                .map_err(anyhow::Error::msg)?,
        )
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

impl_write_tool!(
    TableRenameColumnsTool,
    "table.rename_columns",
    "Rename one or more columns and write a save-copy output.",
    json!({
        "type": "object",
        "properties": {
            "sourcePath": { "type": "string" },
            "sheet": { "type": "string" },
            "outputPath": { "type": "string" },
            "renames": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "from": { "type": "string" },
                        "to": { "type": "string" }
                    },
                    "required": ["from", "to"]
                }
            }
        },
        "required": ["renames"]
    })
);

impl_write_tool!(
    TableCastColumnsTool,
    "table.cast_columns",
    "Cast one or more columns and write a save-copy output.",
    json!({
        "type": "object",
        "properties": {
            "sourcePath": { "type": "string" },
            "sheet": { "type": "string" },
            "outputPath": { "type": "string" },
            "casts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "column": { "type": "string" },
                        "toType": { "type": "string" }
                    },
                    "required": ["column", "toType"]
                }
            }
        },
        "required": ["casts"]
    })
);

impl_write_tool!(
    TableFilterRowsTool,
    "table.filter_rows",
    "Filter rows and write a save-copy output.",
    json!({
        "type": "object",
        "properties": {
            "sourcePath": { "type": "string" },
            "sheet": { "type": "string" },
            "outputPath": { "type": "string" },
            "predicate": { "type": "string" },
            "outputSheet": { "type": "string" }
        },
        "required": ["predicate"]
    })
);

impl_write_tool!(
    TableDeriveColumnTool,
    "table.derive_column",
    "Create a derived column and write a save-copy output.",
    json!({
        "type": "object",
        "properties": {
            "sourcePath": { "type": "string" },
            "sheet": { "type": "string" },
            "outputPath": { "type": "string" },
            "column": { "type": "string" },
            "expression": { "type": "string" },
            "position": { "type": "string" },
            "afterColumn": { "type": "string" }
        },
        "required": ["column", "expression"]
    })
);

impl_write_tool!(
    TableGroupAggregateTool,
    "table.group_aggregate",
    "Group and aggregate rows into a save-copy output.",
    json!({
        "type": "object",
        "properties": {
            "sourcePath": { "type": "string" },
            "sheet": { "type": "string" },
            "outputPath": { "type": "string" },
            "groupBy": { "type": "array", "items": { "type": "string" } },
            "measures": { "type": "array" },
            "outputSheet": { "type": "string" }
        },
        "required": ["groupBy", "measures"]
    })
);

impl_write_tool!(
    WorkbookSaveCopyTool,
    "workbook.save_copy",
    "Write the current workbook state to a new save-copy destination.",
    json!({
        "type": "object",
        "properties": {
            "sourcePath": { "type": "string" },
            "outputPath": { "type": "string" }
        }
    })
);

#[async_trait]
impl Tool for DocumentReadTextTool {
    fn name(&self) -> &str {
        "document.read_text"
    }

    fn description(&self) -> &str {
        "Extract text from DOCX, PPTX, PDF, and plain-text files."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "maxBytes": { "type": "integer", "minimum": 1 }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, _ctx: &ToolContext, input: Value) -> anyhow::Result<ToolOutput> {
        let value = file_support::execute_document_read_text(&input).map_err(anyhow::Error::msg)?;
        json_tool_output(value)
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use claw_permissions::{PermissionMode, RuleBasedPolicy};
    use tempfile::tempdir;

    use super::*;
    use crate::{
        models::{CreateSessionRequest, RelayMode, StartTurnRequest},
        storage::AppStorage,
    };

    fn tool_context(session_id: &str, cwd: PathBuf) -> ToolContext {
        ToolContext {
            cwd,
            permissions: Arc::new(RuleBasedPolicy::new(PermissionMode::AutoApprove)),
            session_id: session_id.to_string(),
        }
    }

    #[test]
    fn registers_all_relay_tools() {
        let mut registry = ToolRegistry::new();
        register_relay_tools(&mut registry, Arc::new(Mutex::new(AppStorage::default())));

        for tool_name in [
            "workbook.inspect",
            "sheet.preview",
            "sheet.profile_columns",
            "session.diff_from_base",
            "table.rename_columns",
            "table.cast_columns",
            "table.filter_rows",
            "table.derive_column",
            "table.group_aggregate",
            "workbook.save_copy",
            "document.read_text",
        ] {
            assert!(
                registry.get(tool_name).is_some(),
                "expected relay tool `{tool_name}` to be registered"
            );
        }
    }

    #[tokio::test]
    async fn workbook_inspect_tool_reads_session_workbook() {
        let temp_dir = tempdir().expect("temp dir");
        let csv_path = temp_dir.path().join("inspect.csv");
        fs::write(&csv_path, "customer_id,amount\n1,42\n2,24\n").expect("csv should be written");

        let storage = Arc::new(Mutex::new(AppStorage::default()));
        let session = storage
            .lock()
            .expect("storage")
            .create_session(CreateSessionRequest {
                title: "Inspect".to_string(),
                objective: "Inspect workbook".to_string(),
                primary_workbook_path: Some(csv_path.to_string_lossy().to_string()),
            })
            .expect("session should create");

        let tool = WorkbookInspectTool::new(Arc::clone(&storage));
        let output = tool
            .execute(
                &tool_context(&session.id, temp_dir.path().to_path_buf()),
                json!({}),
            )
            .await
            .expect("inspect should succeed");

        assert!(!output.is_error);
        let metadata = output.metadata.expect("metadata should exist");
        assert_eq!(
            metadata["sourcePath"],
            csv_path.to_string_lossy().to_string()
        );
    }

    #[tokio::test]
    async fn table_filter_rows_tool_writes_save_copy_output() {
        let temp_dir = tempdir().expect("temp dir");
        let csv_path = temp_dir.path().join("filter.csv");
        let output_path = temp_dir.path().join("filtered.csv");
        fs::write(&csv_path, "customer_id,approved\n1,true\n2,false\n3,true\n")
            .expect("csv should be written");

        let storage = Arc::new(Mutex::new(AppStorage::default()));
        let session = {
            let mut storage = storage.lock().expect("storage");
            let session = storage
                .create_session(CreateSessionRequest {
                    title: "Filter".to_string(),
                    objective: "Filter workbook".to_string(),
                    primary_workbook_path: Some(csv_path.to_string_lossy().to_string()),
                })
                .expect("session should create");
            storage
                .start_turn(StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Turn".to_string(),
                    objective: "Filter rows".to_string(),
                    mode: RelayMode::Plan,
                })
                .expect("turn should create");
            session
        };

        let tool = TableFilterRowsTool::new(Arc::clone(&storage));
        let output = tool
            .execute(
                &tool_context(&session.id, temp_dir.path().to_path_buf()),
                json!({
                    "predicate": "approved = true",
                    "outputPath": output_path.to_string_lossy().to_string()
                }),
            )
            .await
            .expect("filter should succeed");

        assert!(!output.is_error);
        let written = fs::read_to_string(&output_path).expect("filtered output should exist");
        assert!(written.contains("1,true"));
        assert!(written.contains("3,true"));
        assert!(!written.contains("2,false"));
    }
}
