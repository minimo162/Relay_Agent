mod app_services;
mod cdp_copilot;
mod commands;
mod copilot_port_reclaim;
mod copilot_server;
mod dev_control;
pub mod doctor;
mod ipc_codegen;
mod liteparse_env;
pub mod models;
mod opencode_runtime;
mod tauri_bridge;
#[cfg(test)]
pub mod test_support;
mod windows_job;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::copilot::connect_cdp,
            commands::copilot::cdp_send_prompt,
            commands::copilot::cdp_start_new_chat,
            commands::copilot::cdp_screenshot,
            commands::copilot::disconnect_cdp,
            commands::copilot::warmup_copilot_bridge,
            commands::diagnostics::get_relay_diagnostics,
            commands::diagnostics::write_text_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
