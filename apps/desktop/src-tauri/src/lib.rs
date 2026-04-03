mod agent_loop_smoke;
mod app;
mod approval_store;
mod batch;
mod browser_automation;
mod copilot_provider;
mod execution;
mod file_support;
#[cfg(test)]
mod integration_tests;
mod mcp_client;
mod models;
mod persistence;
mod pipeline;
mod project;
mod quality_validator;
mod read_action_executor;
mod relay;
mod relay_tools;
mod risk_evaluator;
mod session;
mod session_store;
mod startup;
mod state;
mod storage;
mod tauri_bridge;
mod template;
mod tool_catalog;
mod workbook;
mod workbook_state;
mod workflow_smoke;

use std::{env, path::PathBuf};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let sample_workbook_path = discover_sample_workbook_path(&app.handle());
            let app_local_data_dir = resolve_app_local_data_dir(&app.handle());
            let desktop_state =
                startup::bootstrap_desktop_state(app_local_data_dir, sample_workbook_path);

            app.manage(desktop_state);
            agent_loop_smoke::spawn_if_configured(app.handle().clone());
            workflow_smoke::spawn_if_configured(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::ping,
            app::preflight_workbook,
            app::inspect_workbook,
            app::initialize_app,
            session::create_session,
            session::add_inbox_file,
            session::remove_inbox_file,
            project::create_project,
            project::list_projects,
            project::read_project,
            project::update_project,
            project::add_project_memory,
            project::link_session_to_project,
            project::remove_project_memory,
            project::set_session_project,
            session::list_sessions,
            session::read_session,
            session::read_turn_artifacts,
            session::start_turn,
            relay::assess_copilot_handoff,
            relay::record_structured_response,
            execution::list_tools,
            execution::set_tool_enabled,
            execution::execute_claw_tool,
            execution::connect_mcp_server,
            execution::invoke_mcp_tool,
            browser_automation::send_copilot_prompt,
            browser_automation::check_copilot_connection,
            execution::execute_read_actions,
            execution::approve_plan,
            execution::get_plan_progress,
            execution::record_plan_progress,
            execution::preview_execution,
            execution::respond_to_approval,
            execution::record_scope_approval,
            execution::run_execution,
            execution::run_execution_multi,
            execution::validate_output_quality,
            pipeline::pipeline_create,
            pipeline::pipeline_run,
            pipeline::pipeline_get_status,
            pipeline::pipeline_cancel,
            batch::batch_create,
            batch::batch_run,
            batch::batch_get_status,
            batch::batch_skip_target,
            template::template_list,
            template::template_get,
            template::template_create,
            template::template_delete,
            template::template_from_session,
            execution::get_approval_policy,
            execution::set_approval_policy,
            tauri_bridge::start_agent,
            tauri_bridge::respond_approval,
            tauri_bridge::cancel_agent,
            tauri_bridge::get_session_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn discover_sample_workbook_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("examples")
                .join("revenue-workflow-demo.csv"),
        );
        candidates.push(resource_dir.join("revenue-workflow-demo.csv"));
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(
            current_dir
                .join("examples")
                .join("revenue-workflow-demo.csv"),
        );
    }

    candidates.push(
        manifest_dir
            .join("../../..")
            .join("examples")
            .join("revenue-workflow-demo.csv"),
    );

    startup::discover_sample_workbook_path_from_candidates(candidates)
}

fn resolve_app_local_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match env::var("RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR") {
        Ok(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        Ok(_) => Err(
            "RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR was set but did not contain a usable path."
                .to_string(),
        ),
        Err(_) => app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string()),
    }
}

pub use copilot_provider::CopilotChatProvider;
pub use startup::{
    bootstrap_desktop_state, bootstrap_retry_recovery_state, build_initialize_app_response,
    discover_sample_workbook_path_from_candidates, InitializeAppResponse,
    InitializeAppStartupIssue, StartupRecoveryAction, StartupStatus,
};
