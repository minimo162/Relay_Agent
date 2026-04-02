use std::{fs, path::Path};

use serde_json::json;
use tempfile::tempdir;

use crate::{
    execution::parse_mcp_tool_name,
    file_support,
    mcp_client::McpToolDefinition,
    models::{
        ApprovalDecision, CreateProjectRequest, CreateSessionRequest, McpServerConfig,
        McpTransport, OutputFormat, OutputSpec, PreviewExecutionRequest, ReadProjectRequest,
        RelayMode, RespondToApprovalRequest, RunExecutionMultiRequest, StartTurnRequest,
        SubmitCopilotResponseRequest, UpdateProjectRequest,
    },
    storage::{is_within_project_scope, AppStorage},
    tool_catalog::ToolCatalog,
};

fn copilot_response(summary: &str, actions: Vec<serde_json::Value>) -> String {
    json!({
        "version": "1.0",
        "summary": summary,
        "actions": actions,
        "followUpQuestions": [],
        "warnings": []
    })
    .to_string()
}

fn stage_multi_output_response(
    storage: &mut AppStorage,
    source_path: &str,
    default_output_path: &str,
) -> (String, String) {
    let session = storage
        .create_session(CreateSessionRequest {
            title: "Multi-output".to_string(),
            objective: "Prepare alternate save-copy outputs".to_string(),
            primary_workbook_path: Some(source_path.to_string()),
        })
        .expect("session should be created");
    let turn = storage
        .start_turn(StartTurnRequest {
            session_id: session.id.clone(),
            title: "Save copy".to_string(),
            objective: "Prepare alternate save-copy outputs".to_string(),
            mode: RelayMode::Plan,
        })
        .expect("turn should be created")
        .turn;

    storage
        .generate_relay_packet(crate::models::GenerateRelayPacketRequest {
            session_id: session.id.clone(),
            turn_id: turn.id.clone(),
        })
        .expect("packet should generate");
    storage
        .submit_copilot_response(SubmitCopilotResponseRequest {
            session_id: session.id.clone(),
            turn_id: turn.id.clone(),
            raw_response: copilot_response(
                "Prepare a save-copy output.",
                vec![json!({
                    "tool": "workbook.save_copy",
                    "args": {
                        "outputPath": default_output_path
                    }
                })],
            ),
        })
        .expect("response should parse");
    storage
        .preview_execution(PreviewExecutionRequest {
            session_id: session.id.clone(),
            turn_id: turn.id.clone(),
        })
        .expect("preview should succeed");
    storage
        .respond_to_approval(RespondToApprovalRequest {
            session_id: session.id.clone(),
            turn_id: turn.id.clone(),
            decision: ApprovalDecision::Approved,
            note: None,
        })
        .expect("approval should succeed");

    (session.id, turn.id)
}

#[test]
fn file_copy_creates_destination_and_keeps_source() {
    let workspace = tempdir().expect("temp dir should be created");
    let source_path = workspace.path().join("source.txt");
    let dest_path = workspace.path().join("copies").join("dest.txt");
    fs::write(&source_path, "copy me").expect("source file should be written");

    file_support::execute_file_copy(&json!({
        "sourcePath": source_path.display().to_string(),
        "destPath": dest_path.display().to_string(),
        "overwrite": true
    }))
    .expect("copy should succeed");

    assert!(source_path.exists());
    assert_eq!(
        fs::read_to_string(&dest_path).expect("destination should be readable"),
        "copy me"
    );
}

#[test]
fn file_move_removes_source() {
    let workspace = tempdir().expect("temp dir should be created");
    let source_path = workspace.path().join("source.txt");
    let dest_path = workspace.path().join("archive").join("dest.txt");
    fs::write(&source_path, "move me").expect("source file should be written");

    file_support::execute_file_move(&json!({
        "sourcePath": source_path.display().to_string(),
        "destPath": dest_path.display().to_string(),
        "overwrite": true
    }))
    .expect("move should succeed");

    assert!(!source_path.exists());
    assert_eq!(
        fs::read_to_string(&dest_path).expect("destination should be readable"),
        "move me"
    );
}

#[test]
fn file_delete_removes_target() {
    let workspace = tempdir().expect("temp dir should be created");
    let target_path = workspace.path().join("delete-me.txt");
    fs::write(&target_path, "delete me").expect("target file should be written");

    file_support::execute_file_delete(&json!({
        "path": target_path.display().to_string(),
        "toRecycleBin": false
    }))
    .expect("delete should succeed");

    assert!(!target_path.exists());
}

#[test]
fn text_search_returns_matching_lines() {
    let workspace = tempdir().expect("temp dir should be created");
    let target_path = workspace.path().join("notes.txt");
    fs::write(&target_path, "alpha\nTODO item\nomega\n").expect("notes should be written");

    let result = file_support::execute_text_search(&json!({
        "path": target_path.display().to_string(),
        "pattern": "TODO"
    }))
    .expect("search should succeed");

    assert_eq!(result["matchCount"], json!(1));
    assert_eq!(result["matches"][0]["lineNumber"], json!(2));
    assert_eq!(result["matches"][0]["matchedText"], json!("TODO item"));
}

#[test]
fn text_replace_modifies_content_and_creates_backup() {
    let workspace = tempdir().expect("temp dir should be created");
    let target_path = workspace.path().join("notes.txt");
    let backup_path = workspace.path().join("notes.txt.bak");
    fs::write(&target_path, "TODO first\nTODO second\n").expect("notes should be written");

    let result = file_support::execute_text_replace(&json!({
        "path": target_path.display().to_string(),
        "pattern": "TODO",
        "replacement": "DONE",
        "createBackup": true
    }))
    .expect("replace should succeed");

    assert_eq!(result["changeCount"], json!(2));
    assert!(backup_path.exists());
    assert_eq!(
        fs::read_to_string(&target_path).expect("updated file should be readable"),
        "DONE first\nDONE second\n"
    );
}

#[test]
fn project_crud_roundtrip() {
    let workspace = tempdir().expect("temp dir should be created");
    let mut storage = AppStorage::default();

    let created = storage
        .create_project(CreateProjectRequest {
            name: "Revenue Ops".to_string(),
            root_folder: workspace.path().display().to_string(),
            custom_instructions: Some("Use UTF-8 outputs".to_string()),
        })
        .expect("project should be created");
    let read_back = storage
        .read_project(ReadProjectRequest {
            project_id: created.id.clone(),
        })
        .expect("project should be readable");
    let updated = storage
        .update_project(UpdateProjectRequest {
            project_id: created.id.clone(),
            name: Some("Revenue Ops Updated".to_string()),
            custom_instructions: Some("Always keep outputs in scope".to_string()),
        })
        .expect("project should be updated");

    assert_eq!(read_back.name, "Revenue Ops");
    assert_eq!(updated.name, "Revenue Ops Updated");
    assert_eq!(updated.custom_instructions, "Always keep outputs in scope");
}

#[test]
fn project_scope_rejects_out_of_scope_path() {
    assert!(!is_within_project_scope(
        "C:\\other\\file.csv",
        "C:\\projects\\myproj"
    ));
}

#[test]
fn project_scope_accepts_in_scope_path() {
    assert!(is_within_project_scope(
        "C:\\projects\\myproj\\data.csv",
        "C:\\projects\\myproj"
    ));
}

#[test]
fn project_memory_add_then_remove() {
    let workspace = tempdir().expect("temp dir should be created");
    let mut storage = AppStorage::default();
    let project = storage
        .create_project(CreateProjectRequest {
            name: "Revenue Ops".to_string(),
            root_folder: workspace.path().display().to_string(),
            custom_instructions: None,
        })
        .expect("project should be created");

    let with_memory = storage
        .add_project_memory(crate::models::AddProjectMemoryRequest {
            project_id: project.id.clone(),
            key: "preferred_output".to_string(),
            value: "csv".to_string(),
            source: None,
        })
        .expect("memory should be added");
    let without_memory = storage
        .remove_project_memory(crate::models::RemoveProjectMemoryRequest {
            project_id: project.id.clone(),
            key: "preferred_output".to_string(),
        })
        .expect("memory should be removed");

    assert_eq!(with_memory.memory.len(), 1);
    assert!(without_memory.memory.is_empty());
}

#[test]
fn tool_registry_lists_current_builtin_tools() {
    let tool_ids = ToolCatalog::new()
        .list()
        .into_iter()
        .map(|tool| tool.id)
        .collect::<Vec<_>>();

    assert!(tool_ids.len() >= 10);
    assert!(tool_ids.iter().any(|id| id == "workbook.inspect"));
    assert!(tool_ids.iter().any(|id| id == "file.stat"));
    assert!(tool_ids.iter().any(|id| id == "browser.send_to_copilot"));
}

#[test]
fn disabled_tool_returns_error() {
    let mut registry = ToolCatalog::new();
    registry
        .set_enabled("workbook.inspect", false)
        .expect("tool should toggle");

    assert!(!registry
        .list_descriptors_by_phase(crate::models::ToolPhase::Read)
        .iter()
        .any(|tool| tool.id == "workbook.inspect"));
}

#[test]
fn mcp_tool_returns_delegation_error() {
    let mut registry = ToolCatalog::new();
    registry.register_mcp_tools(
        McpServerConfig {
            url: "http://localhost:3100/mcp".to_string(),
            name: "demo".to_string(),
            transport: McpTransport::Sse,
        },
        vec![McpToolDefinition {
            name: "echo".to_string(),
            description: "Echo arguments".to_string(),
            input_schema: json!({ "type": "object" }),
        }],
    );

    let registration = registry
        .get("mcp.demo.echo")
        .expect("mcp tool should be registered");
    assert_eq!(registration.source, crate::models::ToolSource::Mcp);
    assert_eq!(registration.mcp_server_url.as_deref(), Some("http://localhost:3100/mcp"));
}

#[test]
fn parse_mcp_tool_name_validation() {
    assert!(parse_mcp_tool_name("invalid").is_err());
    assert!(parse_mcp_tool_name("mcp.s").is_err());
    assert_eq!(
        parse_mcp_tool_name("mcp.server.tool").expect("tool id should parse"),
        "tool"
    );
}

#[test]
fn multi_output_csv_writes_requested_file() {
    let workspace = tempdir().expect("temp dir should be created");
    let source_path = workspace.path().join("input.csv");
    let default_output_path = workspace.path().join("default.csv");
    let requested_output_path = workspace.path().join("requested.csv");
    fs::write(&source_path, "name,value\nalpha,1\nbeta,2\n").expect("csv source should be written");

    let mut storage = AppStorage::default();
    let (session_id, turn_id) = stage_multi_output_response(
        &mut storage,
        &source_path.display().to_string(),
        &default_output_path.display().to_string(),
    );

    let results = storage
        .run_execution_multi(RunExecutionMultiRequest {
            session_id,
            turn_id,
            output_specs: vec![OutputSpec {
                format: OutputFormat::Csv,
                output_path: requested_output_path.display().to_string(),
            }],
        })
        .expect("csv multi-output should succeed");

    assert_eq!(results.len(), 1);
    assert!(Path::new(&requested_output_path).exists());
    assert!(!Path::new(&default_output_path).exists());
}

#[test]
fn multi_output_xlsx_copy_writes_requested_file() {
    let workspace = tempdir().expect("temp dir should be created");
    let source_path = workspace.path().join("input.xlsx");
    let default_output_path = workspace.path().join("default.xlsx");
    let requested_output_path = workspace.path().join("requested.xlsx");
    let source_bytes = b"placeholder xlsx bytes";
    fs::write(&source_path, source_bytes).expect("xlsx source should be written");

    let mut storage = AppStorage::default();
    let (session_id, turn_id) = stage_multi_output_response(
        &mut storage,
        &source_path.display().to_string(),
        &default_output_path.display().to_string(),
    );

    let results = storage
        .run_execution_multi(RunExecutionMultiRequest {
            session_id,
            turn_id,
            output_specs: vec![OutputSpec {
                format: OutputFormat::Xlsx,
                output_path: requested_output_path.display().to_string(),
            }],
        })
        .expect("xlsx multi-output should succeed");

    assert_eq!(results.len(), 1);
    assert_eq!(
        fs::read(&requested_output_path).expect("requested xlsx output should be readable"),
        source_bytes
    );
    assert!(!Path::new(&default_output_path).exists());
}
