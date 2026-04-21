//! Set bundled sidecar environment variables before tools run.

use tauri::Manager;

fn sidecar_base_dir() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let base = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };
    Some(base.to_path_buf())
}

pub fn apply(app: &tauri::App) {
    if let Ok(dir) = app.path().resource_dir() {
        let root = dir.join("liteparse-runner");
        if root.join("parse.mjs").is_file() {
            std::env::set_var("RELAY_LITEPARSE_RUNNER_ROOT", &root);
            tracing::info!("[liteparse] RELAY_LITEPARSE_RUNNER_ROOT={}", root.display());
        }
    }

    if let Some(base) = sidecar_base_dir() {
        #[cfg(windows)]
        let node = base.join("relay-node.exe");
        #[cfg(not(windows))]
        let node = base.join("relay-node");
        if node.is_file() {
            std::env::set_var("RELAY_BUNDLED_NODE", &node);
            tracing::info!("[liteparse] RELAY_BUNDLED_NODE={}", node.display());
        }

        #[cfg(windows)]
        let rg = base.join("relay-rg.exe");
        #[cfg(not(windows))]
        let rg = base.join("relay-rg");
        if rg.is_file() {
            std::env::set_var("RELAY_BUNDLED_RIPGREP", &rg);
            tracing::info!("[search] RELAY_BUNDLED_RIPGREP={}", rg.display());
        }
    }
}
