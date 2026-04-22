use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;

use runtime::MAX_TEXT_FILE_READ_BYTES;

#[derive(Debug, Clone)]
pub enum PathUndoOp {
    Restore {
        path: PathBuf,
        previous: Option<Vec<u8>>,
    },
}

#[derive(Debug, Default)]
pub struct WriteUndoStacks {
    undo: Vec<Vec<PathUndoOp>>,
    redo: Vec<Vec<PathUndoOp>>,
}

impl WriteUndoStacks {
    pub fn push_mutation(&mut self, ops: Vec<PathUndoOp>) {
        if ops.is_empty() {
            return;
        }
        self.redo.clear();
        self.undo.push(ops);
    }

    pub fn undo(&mut self) -> Result<(), String> {
        let frame = self
            .undo
            .pop()
            .ok_or_else(|| "Nothing to undo for this session.".to_string())?;
        let inverse = apply_undo_frame(&frame)?;
        self.redo.push(inverse);
        Ok(())
    }

    pub fn redo(&mut self) -> Result<(), String> {
        let frame = self
            .redo
            .pop()
            .ok_or_else(|| "Nothing to redo.".to_string())?;
        let inverse = apply_undo_frame(&frame)?;
        self.undo.push(inverse);
        Ok(())
    }

    #[must_use]
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    #[must_use]
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

fn read_snapshot(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_TEXT_FILE_READ_BYTES {
        return Err(format!(
            "file too large for undo (limit {MAX_TEXT_FILE_READ_BYTES} bytes): {}",
            path.display()
        ));
    }
    let mut buf = Vec::new();
    fs::File::open(path)
        .and_then(|mut f| f.read_to_end(&mut buf))
        .map_err(|e| e.to_string())?;
    Ok(Some(buf))
}

fn apply_restore(path: &Path, previous: Option<&Vec<u8>>) -> Result<(), String> {
    match previous {
        None => {
            let _ = fs::remove_file(path);
            Ok(())
        }
        Some(bytes) => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(path, bytes).map_err(|e| e.to_string())
        }
    }
}

fn apply_undo_frame(ops: &[PathUndoOp]) -> Result<Vec<PathUndoOp>, String> {
    let mut inverse = Vec::new();
    for op in ops.iter().rev() {
        match op {
            PathUndoOp::Restore { path, previous } => {
                let current = read_snapshot(path)?;
                inverse.push(PathUndoOp::Restore {
                    path: path.clone(),
                    previous: current,
                });
                apply_restore(path, previous.as_ref())?;
            }
        }
    }
    inverse.reverse();
    Ok(inverse)
}

fn path_from_value(input: &Value, key: &str) -> Option<PathBuf> {
    input
        .get(key)
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

pub fn snapshots_before_mutation(tool_name: &str, input: &Value) -> Option<Vec<PathUndoOp>> {
    let mut out = Vec::new();
    match tool_name {
        "write" | "edit" => {
            let path = path_from_value(input, "path")?;
            match read_snapshot(&path) {
                Ok(prev) => out.push(PathUndoOp::Restore {
                    path,
                    previous: prev,
                }),
                Err(e) => {
                    tracing::warn!("[write_undo] skip snapshot for {}: {e}", path.display());
                    return None;
                }
            }
        }
        "NotebookEdit" => {
            let path = path_from_value(input, "notebook_path")?;
            match read_snapshot(&path) {
                Ok(prev) => out.push(PathUndoOp::Restore {
                    path,
                    previous: prev,
                }),
                Err(e) => {
                    tracing::warn!("[write_undo] skip notebook snapshot: {e}");
                    return None;
                }
            }
        }
        "pdf_merge" => {
            let path = path_from_value(input, "output_path")?;
            match read_snapshot(&path) {
                Ok(prev) => out.push(PathUndoOp::Restore {
                    path,
                    previous: prev,
                }),
                Err(e) => {
                    tracing::warn!("[write_undo] skip pdf_merge output snapshot: {e}");
                    return None;
                }
            }
        }
        "pdf_split" => {
            let Some(Value::Array(segs)) = input.get("segments") else {
                return None;
            };
            for seg in segs {
                let Some(path) = seg
                    .get("output_path")
                    .and_then(|v| v.as_str())
                    .map(PathBuf::from)
                else {
                    continue;
                };
                if path.as_os_str().is_empty() {
                    continue;
                }
                match read_snapshot(&path) {
                    Ok(prev) => out.push(PathUndoOp::Restore {
                        path,
                        previous: prev,
                    }),
                    Err(e) => {
                        tracing::warn!(
                            "[write_undo] skip pdf_split output {}: {e}",
                            path.display()
                        );
                        return None;
                    }
                }
            }
            if out.is_empty() {
                return None;
            }
        }
        _ => return None,
    }
    Some(out)
}
