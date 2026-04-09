//! Read-only listing of Claw-style instruction paths under workspace `cwd`.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionSurface {
    pub label: String,
    pub path: String,
    pub exists: bool,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInstructionSurfaces {
    pub workspace_root: Option<String>,
    pub surfaces: Vec<InstructionSurface>,
}

fn push_file(out: &mut Vec<InstructionSurface>, root: &Path, rel_label: &str, rel: &str) {
    let p = root.join(rel);
    out.push(InstructionSurface {
        label: rel_label.to_string(),
        path: p.to_string_lossy().into_owned(),
        exists: p.is_file(),
        is_directory: false,
    });
}

fn push_dir(out: &mut Vec<InstructionSurface>, root: &Path, rel_label: &str, rel: &str) {
    let p = root.join(rel);
    out.push(InstructionSurface {
        label: rel_label.to_string(),
        path: p.to_string_lossy().into_owned(),
        exists: p.is_dir(),
        is_directory: true,
    });
}

/// Scan project instruction surfaces (no writes). Empty `cwd` returns empty surfaces.
pub fn scan_workspace_instructions(cwd: Option<String>) -> WorkspaceInstructionSurfaces {
    let Some(raw) = cwd.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) else {
        return WorkspaceInstructionSurfaces {
            workspace_root: None,
            surfaces: Vec::new(),
        };
    };

    let root = PathBuf::from(&raw);
    let workspace_root = root
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .ok()
        .or(Some(raw.clone()));

    let base = match root.canonicalize() {
        Ok(p) => p,
        Err(_) => PathBuf::from(&raw),
    };

    let mut surfaces = Vec::new();
    push_file(&mut surfaces, &base, "CLAW.md (project root)", "CLAW.md");
    push_dir(&mut surfaces, &base, ".claw/ (config dir)", ".claw");
    push_file(&mut surfaces, &base, ".claw/CLAW.md", ".claw/CLAW.md");
    push_file(
        &mut surfaces,
        &base,
        ".claw/instructions.md",
        ".claw/instructions.md",
    );
    push_file(
        &mut surfaces,
        &base,
        ".claw/settings.json",
        ".claw/settings.json",
    );
    push_file(
        &mut surfaces,
        &base,
        ".claw/settings.local.json",
        ".claw/settings.local.json",
    );
    push_file(&mut surfaces, &base, ".claw.json (legacy)", ".claw.json");

    WorkspaceInstructionSurfaces {
        workspace_root,
        surfaces,
    }
}
