use std::fs;

use serde_json::json;
use tempfile::tempdir;

use crate::{
    execution::parse_mcp_tool_name,
    file_support,
    mcp_client::McpToolDefinition,
    models::{
        CreateProjectRequest, McpServerConfig, McpTransport, ReadProjectRequest,
        UpdateProjectRequest,
    },
    storage::{is_within_project_scope, AppStorage},
    tool_catalog::ToolCatalog,
};

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

    assert!(tool_ids.len() >= 9);
    assert!(tool_ids.iter().any(|id| id == "file.stat"));
    assert!(tool_ids.iter().any(|id| id == "browser.send_to_copilot"));
}

#[test]
fn disabled_tool_returns_error() {
    let mut registry = ToolCatalog::new();
    registry
        .set_enabled("file.stat", false)
        .expect("tool should toggle");

    assert!(!registry
        .list()
        .iter()
        .any(|tool| tool.enabled && tool.phase == crate::models::ToolPhase::Read && tool.id == "file.stat"));
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
        .list()
        .into_iter()
        .find(|tool| tool.id == "mcp.demo.echo")
        .expect("mcp tool should be registered");
    assert_eq!(registration.source, crate::models::ToolSource::Mcp);
    assert_eq!(
        registration.mcp_server_url.as_deref(),
        Some("http://localhost:3100/mcp")
    );
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
