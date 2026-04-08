#[allow(dead_code)]
mod agent_browser_daemon;
mod agent_loop;
mod copilot_server;
mod liteparse_env;
mod cdp_copilot;
mod config;
mod copilot_persistence;
mod error;
mod models;
mod registry;
mod tauri_bridge;

use tauri::Manager;

use crate::registry::SessionRegistry;

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
    relay_apply_webview2_cdp_from_env();

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
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            liteparse_env::apply(app);
            app.manage(SessionRegistry::new());
            match app.get_webview_window("main") {
                Some(win) => {
                    if let Err(e) = win.set_always_on_top(true) {
                        tracing::warn!("failed to set main window always-on-top: {e}");
                    }
                }
                None => tracing::warn!("main webview window not found for always-on-top"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tauri_bridge::start_agent,
            tauri_bridge::respond_approval,
            tauri_bridge::cancel_agent,
            tauri_bridge::get_session_history,
            tauri_bridge::compact_agent_session,
            tauri_bridge::connect_cdp,
            tauri_bridge::cdp_send_prompt,
            tauri_bridge::cdp_start_new_chat,
            tauri_bridge::cdp_screenshot,
            tauri_bridge::disconnect_cdp,
            tauri_bridge::warmup_copilot_bridge,
            tauri_bridge::mcp_list_servers,
            tauri_bridge::mcp_add_server,
            tauri_bridge::mcp_remove_server,
            tauri_bridge::mcp_check_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
