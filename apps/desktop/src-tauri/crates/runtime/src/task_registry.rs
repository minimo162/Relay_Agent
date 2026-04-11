//! In-memory task records (claw-style `Task*` tool surface; no external worker).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct TaskRecord {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: TaskStatus,
    pub output: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Requested,
    Running,
    Completed,
    Failed,
    Cancelled,
}

fn registry() -> &'static Mutex<HashMap<String, TaskRecord>> {
    static REG: OnceLock<Mutex<HashMap<String, TaskRecord>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn task_id_str(input: &Value) -> Option<&str> {
    input
        .get("id")
        .or_else(|| input.get("task_id"))
        .and_then(|v| v.as_str())
}

pub fn task_create(input: &Value) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let prompt = input.get("prompt").and_then(|v| v.as_str());
    let mut name = input.get("name").and_then(|v| v.as_str()).map(String::from);
    let mut description = input
        .get("description")
        .and_then(|v| v.as_str())
        .map(String::from);
    if description.is_none() {
        description = prompt.map(String::from);
    }
    if name.is_none() {
        name = prompt.map(|p| {
            let line = p.lines().next().unwrap_or(p).trim();
            if line.chars().count() > 80 {
                line.chars().take(80).collect()
            } else {
                line.to_string()
            }
        });
    }
    let rec = TaskRecord {
        id: id.clone(),
        name,
        description,
        status: TaskStatus::Requested,
        output: String::new(),
    };
    registry()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), rec);
    serde_json::to_string_pretty(&json!({ "id": id, "status": TaskStatus::Requested }))
        .map_err(|e| e.to_string())
}

pub fn task_get(input: &Value) -> Result<String, String> {
    let id = task_id_str(input).ok_or_else(|| "TaskGet requires id or task_id".to_string())?;
    let g = registry().lock().map_err(|e| e.to_string())?;
    let rec = g.get(id).ok_or_else(|| format!("unknown task id `{id}`"))?;
    serde_json::to_string_pretty(rec).map_err(|e| e.to_string())
}

pub fn task_list() -> Result<String, String> {
    let g = registry().lock().map_err(|e| e.to_string())?;
    let mut v: Vec<&TaskRecord> = g.values().collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    serde_json::to_string_pretty(&json!({ "tasks": v })).map_err(|e| e.to_string())
}

pub fn task_stop(input: &Value) -> Result<String, String> {
    let id = task_id_str(input).ok_or_else(|| "TaskStop requires id or task_id".to_string())?;
    let mut g = registry().lock().map_err(|e| e.to_string())?;
    let Some(rec) = g.get_mut(id) else {
        return Err(format!("unknown task id `{id}`"));
    };
    rec.status = TaskStatus::Cancelled;
    serde_json::to_string_pretty(&json!({ "id": id, "status": TaskStatus::Cancelled }))
        .map_err(|e| e.to_string())
}

pub fn task_update(input: &Value) -> Result<String, String> {
    let id = task_id_str(input).ok_or_else(|| "TaskUpdate requires id or task_id".to_string())?;
    let mut g = registry().lock().map_err(|e| e.to_string())?;
    let Some(rec) = g.get_mut(id) else {
        return Err(format!("unknown task id `{id}`"));
    };
    if let Some(s) = input.get("status").and_then(|v| v.as_str()) {
        rec.status = parse_task_status(s)?;
    }
    if let Some(o) = input.get("output").and_then(|v| v.as_str()) {
        rec.output = o.to_string();
    }
    if let Some(m) = input.get("message").and_then(|v| v.as_str()) {
        if !m.is_empty() {
            if !rec.output.is_empty() && !rec.output.ends_with('\n') {
                rec.output.push('\n');
            }
            rec.output.push_str(m);
        }
    }
    serde_json::to_string_pretty(rec).map_err(|e| e.to_string())
}

pub fn task_output(input: &Value) -> Result<String, String> {
    let id = task_id_str(input).ok_or_else(|| "TaskOutput requires id or task_id".to_string())?;
    let mut g = registry().lock().map_err(|e| e.to_string())?;
    let Some(rec) = g.get_mut(id) else {
        return Err(format!("unknown task id `{id}`"));
    };
    if let Some(append) = input.get("append").and_then(|v| v.as_str()) {
        rec.output.push_str(append);
    }
    let bytes = rec.output.as_bytes();
    let start = input
        .get("tail")
        .and_then(|v| v.as_u64())
        .map(|tail| bytes.len().saturating_sub(tail as usize))
        .or_else(|| input.get("offset").and_then(|v| v.as_u64()).map(|v| v as usize))
        .unwrap_or(0)
        .min(bytes.len());
    let sliced = String::from_utf8_lossy(&bytes[start..]).to_string();
    serde_json::to_string_pretty(&json!({
        "id": id,
        "offset": start,
        "nextOffset": bytes.len(),
        "output": sliced
    }))
    .map_err(|e| e.to_string())
}

fn parse_task_status(value: &str) -> Result<TaskStatus, String> {
    match value {
        "requested" => Ok(TaskStatus::Requested),
        "running" => Ok(TaskStatus::Running),
        "completed" => Ok(TaskStatus::Completed),
        "failed" => Ok(TaskStatus::Failed),
        "cancelled" | "canceled" => Ok(TaskStatus::Cancelled),
        other => Err(format!(
            "invalid task status `{other}` (expected requested|running|completed|failed|cancelled)"
        )),
    }
}
