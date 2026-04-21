mod agent_loop;
mod agent_loop_smoke;
mod app_services;
mod cdp_copilot;
mod commands;
mod config;
mod copilot_persistence;
mod copilot_port_reclaim;
mod copilot_server;
mod dev_control;
pub mod doctor;
mod error;
mod ipc_codegen;
mod liteparse_env;
mod lsp_probe;
pub mod models;
mod registry;
mod session_write_undo;
mod tauri_bridge;
pub mod test_support;
mod workspace_allowlist;
mod windows_job;
mod workspace_skills;
mod workspace_slash_commands;
mod workspace_surfaces;

use tauri::Manager;

use crate::app_services::AppServices;

/// When `RELAY_WEBVIEW2_CDP_PORT` is set (digits only), forward it to WebView2 so
/// Playwright / agent-browser can attach via CDP (`connectOverCDP`, `--cdp`).
/// Must run before any WebView2 environment is created.
#[cfg(windows)]
fn relay_apply_webview2_cdp_from_env() {
    let port = match std::env::var("RELAY_WEBVIEW2_CDP_PORT") {
        Ok(p) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => p,
        _ => return,
    };
    let args = format!("--remote-debugging-port={port}");
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", &args);
}

#[cfg(not(windows))]
fn relay_apply_webview2_cdp_from_env() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    windows_job::install_kill_on_close();
    relay_apply_webview2_cdp_from_env();
    agent_loop_smoke::apply_test_app_local_data_dir_override();

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_ok() {
        tracing::info!(
            "[webview2] remote debugging enabled via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            liteparse_env::apply(app);
            app.manage(AppServices::new());
            dev_control::spawn(app.handle());
            agent_loop_smoke::spawn_if_configured(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent::start_agent,
            commands::agent::continue_agent_session,
            commands::agent::respond_approval,
            commands::agent::respond_user_question,
            commands::agent::cancel_agent,
            commands::agent::get_session_history,
            commands::agent::compact_agent_session,
            commands::copilot::connect_cdp,
            commands::copilot::cdp_send_prompt,
            commands::copilot::cdp_start_new_chat,
            commands::copilot::cdp_screenshot,
            commands::copilot::disconnect_cdp,
            commands::copilot::warmup_copilot_bridge,
            commands::diagnostics::get_relay_diagnostics,
            commands::agent::undo_session_write,
            commands::agent::redo_session_write,
            commands::agent::get_session_write_undo_status,
            commands::diagnostics::probe_rust_analyzer,
            commands::mcp::mcp_list_servers,
            commands::mcp::mcp_add_server,
            commands::mcp::mcp_remove_server,
            commands::mcp::mcp_check_server_status,
            commands::diagnostics::write_text_export,
            commands::diagnostics::workspace_instruction_surfaces,
            commands::diagnostics::get_workspace_allowlist,
            commands::diagnostics::remove_workspace_allowlist_tool,
            commands::diagnostics::clear_workspace_allowlist,
            commands::diagnostics::list_workspace_slash_commands,
            commands::diagnostics::list_workspace_skills,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
