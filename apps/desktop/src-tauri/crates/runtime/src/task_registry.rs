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
    pub status: String,
    pub output: String,
}

fn registry() -> &'static Mutex<HashMap<String, TaskRecord>> {
    static REG: OnceLock<Mutex<HashMap<String, TaskRecord>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn task_create(input: &Value) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let name = input.get("name").and_then(|v| v.as_str()).map(String::from);
    let description = input
        .get("description")
        .and_then(|v| v.as_str())
        .map(String::from);
    let rec = TaskRecord {
        id: id.clone(),
        name,
        description,
        status: "created".into(),
        output: String::new(),
    };
    registry()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), rec);
    serde_json::to_string_pretty(&json!({ "id": id, "status": "created" }))
        .map_err(|e| e.to_string())
}

pub fn task_get(input: &Value) -> Result<String, String> {
    let id = input
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "TaskGet requires id".to_string())?;
    let g = registry().lock().map_err(|e| e.to_string())?;
    let rec = g
        .get(id)
        .ok_or_else(|| format!("unknown task id `{id}`"))?;
    serde_json::to_string_pretty(rec).map_err(|e| e.to_string())
}

pub fn task_list() -> Result<String, String> {
    let g = registry().lock().map_err(|e| e.to_string())?;
    let mut v: Vec<&TaskRecord> = g.values().collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    serde_json::to_string_pretty(&json!({ "tasks": v })).map_err(|e| e.to_string())
}

pub fn task_stop(input: &Value) -> Result<String, String> {
    let id = input
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "TaskStop requires id".to_string())?;
    let mut g = registry().lock().map_err(|e| e.to_string())?;
    let Some(rec) = g.get_mut(id) else {
        return Err(format!("unknown task id `{id}`"));
    };
    rec.status = "stopped".into();
    serde_json::to_string_pretty(&json!({ "id": id, "status": "stopped" })).map_err(|e| e.to_string())
}

pub fn task_update(input: &Value) -> Result<String, String> {
    let id = input
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "TaskUpdate requires id".to_string())?;
    let mut g = registry().lock().map_err(|e| e.to_string())?;
    let Some(rec) = g.get_mut(id) else {
        return Err(format!("unknown task id `{id}`"));
    };
    if let Some(s) = input.get("status").and_then(|v| v.as_str()) {
        rec.status = s.to_string();
    }
    if let Some(o) = input.get("output").and_then(|v| v.as_str()) {
        rec.output = o.to_string();
    }
    serde_json::to_string_pretty(rec).map_err(|e| e.to_string())
}

pub fn task_output(input: &Value) -> Result<String, String> {
    let id = input
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "TaskOutput requires id".to_string())?;
    let mut g = registry().lock().map_err(|e| e.to_string())?;
    let Some(rec) = g.get_mut(id) else {
        return Err(format!("unknown task id `{id}`"));
    };
    if let Some(append) = input.get("append").and_then(|v| v.as_str()) {
        rec.output.push_str(append);
    }
    serde_json::to_string_pretty(&json!({
        "id": id,
        "output": rec.output
    }))
    .map_err(|e| e.to_string())
}
