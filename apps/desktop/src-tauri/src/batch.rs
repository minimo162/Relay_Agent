use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::{
    models::{CreateSessionRequest, RelayMode, StartTurnRequest},
    state::DesktopState,
};

const BATCH_TARGET_UPDATE_EVENT: &str = "batch:target_update";

#[derive(Default)]
pub struct BatchRegistry {
    jobs: HashMap<String, BatchJob>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BatchJobStatus {
    Idle,
    Running,
    Done,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BatchTargetStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTarget {
    pub file_path: String,
    pub status: BatchTargetStatus,
    pub output_path: Option<String>,
    pub error_message: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchJob {
    pub id: String,
    pub workflow_goal: String,
    pub project_id: Option<String>,
    pub targets: Vec<BatchTarget>,
    pub concurrency: u8,
    pub stop_on_first_error: bool,
    pub status: BatchJobStatus,
    pub output_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCreateRequest {
    pub workflow_goal: String,
    pub project_id: Option<String>,
    pub target_paths: Vec<String>,
    pub stop_on_first_error: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStatusRequest {
    pub batch_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSkipTargetRequest {
    pub batch_id: String,
    pub target_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchTargetUpdateEvent {
    batch_job: BatchJob,
    target_path: String,
    status: BatchTargetStatus,
}

#[tauri::command]
pub fn batch_create(
    state: State<'_, DesktopState>,
    request: BatchCreateRequest,
) -> Result<BatchJob, String> {
    if request.workflow_goal.trim().is_empty() {
        return Err("batch workflow goal is required".to_string());
    }
    if request.target_paths.is_empty() {
        return Err("at least one batch target is required".to_string());
    }

    let timestamp = now();
    let output_dir = request
        .target_paths
        .first()
        .map(PathBuf::from)
        .and_then(|path| path.parent().map(|parent| parent.join("relay-batch-output")))
        .map(|path| path.to_string_lossy().to_string());
    let job = BatchJob {
        id: format!("batch-{}", Uuid::new_v4()),
        workflow_goal: request.workflow_goal.trim().to_string(),
        project_id: request.project_id.filter(|value| !value.trim().is_empty()),
        targets: request
            .target_paths
            .into_iter()
            .map(|target_path| BatchTarget {
                file_path: target_path,
                status: BatchTargetStatus::Pending,
                output_path: None,
                error_message: None,
                session_id: None,
            })
            .collect(),
        concurrency: 1,
        stop_on_first_error: request.stop_on_first_error,
        status: BatchJobStatus::Idle,
        output_dir,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };

    let mut registry = state.batch_registry.lock().expect("batch registry poisoned");
    registry.jobs.insert(job.id.clone(), job.clone());
    Ok(job)
}

#[tauri::command]
pub fn batch_get_status(
    state: State<'_, DesktopState>,
    request: BatchStatusRequest,
) -> Result<BatchJob, String> {
    let registry = state.batch_registry.lock().expect("batch registry poisoned");
    registry
        .jobs
        .get(&request.batch_id)
        .cloned()
        .ok_or_else(|| format!("unknown batch `{}`", request.batch_id))
}

#[tauri::command]
pub async fn batch_run(
    app: AppHandle,
    state: State<'_, DesktopState>,
    request: BatchStatusRequest,
) -> Result<(), String> {
    {
        let registry = state.batch_registry.lock().expect("batch registry poisoned");
        if !registry.jobs.contains_key(&request.batch_id) {
            return Err(format!("unknown batch `{}`", request.batch_id));
        }
    }

    let batch_id = request.batch_id;
    tauri::async_runtime::spawn(async move {
        let _ = run_batch(app, &batch_id).await;
    });
    Ok(())
}

#[tauri::command]
pub fn batch_skip_target(
    state: State<'_, DesktopState>,
    request: BatchSkipTargetRequest,
) -> Result<(), String> {
    let mut registry = state.batch_registry.lock().expect("batch registry poisoned");
    let job = registry
        .jobs
        .get_mut(&request.batch_id)
        .ok_or_else(|| format!("unknown batch `{}`", request.batch_id))?;
    let target = job
        .targets
        .iter_mut()
        .find(|target| target.file_path == request.target_path)
        .ok_or_else(|| format!("unknown batch target `{}`", request.target_path))?;
    target.status = BatchTargetStatus::Skipped;
    target.error_message = Some("Skipped manually.".to_string());
    job.updated_at = now();
    Ok(())
}

async fn run_batch(app: AppHandle, batch_id: &str) -> Result<(), String> {
    let target_count = {
        let state = app.state::<DesktopState>();
        let mut registry = state.batch_registry.lock().expect("batch registry poisoned");
        let job = registry
            .jobs
            .get_mut(batch_id)
            .ok_or_else(|| format!("unknown batch `{batch_id}`"))?;
        job.status = BatchJobStatus::Running;
        job.updated_at = now();
        job.targets.len()
    };

    for index in 0..target_count {
        let (target_path, workflow_goal, stop_on_first_error) = {
            let state = app.state::<DesktopState>();
            let mut registry = state.batch_registry.lock().expect("batch registry poisoned");
            let job = registry
                .jobs
                .get_mut(batch_id)
                .ok_or_else(|| format!("unknown batch `{batch_id}`"))?;
            let target_path = {
                let target = job
                    .targets
                    .get_mut(index)
                    .ok_or_else(|| format!("missing batch target {index}"))?;
                if target.status == BatchTargetStatus::Skipped {
                    continue;
                }
                target.status = BatchTargetStatus::Running;
                target.error_message = None;
                target.file_path.clone()
            };
            job.updated_at = now();
            let job_snapshot = job.clone();
            emit_batch_update(&app, job_snapshot, target_path.clone(), BatchTargetStatus::Running);
            (
                target_path,
                job.workflow_goal.clone(),
                job.stop_on_first_error,
            )
        };

        if target_path.contains("[fail]") || !Path::new(&target_path).exists() {
            mark_batch_target_failed(
                &app,
                batch_id,
                index,
                format!("Batch target input was not available: {target_path}"),
            )?;
            if stop_on_first_error {
                break;
            }
            continue;
        }

        let output_path = derive_batch_output_path(&app, batch_id, &target_path)?;
        if let Some(parent) = Path::new(&output_path).parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create batch output directory: {error}"))?;
        }
        fs::copy(&target_path, &output_path)
            .map_err(|error| format!("failed to create batch output copy: {error}"))?;

        let session_id = {
            let state = app.state::<DesktopState>();
            let mut storage = state.storage.lock().expect("desktop storage poisoned");
            let session = storage.create_session(CreateSessionRequest {
                title: format!("Batch / {}", file_name(&target_path)),
                objective: workflow_goal.clone(),
                primary_workbook_path: Some(target_path.clone()),
            })?;
            let _ = storage.start_turn(StartTurnRequest {
                session_id: session.id.clone(),
                title: "Batch target run".to_string(),
                objective: workflow_goal,
                mode: RelayMode::Discover,
            })?;
            session.id
        };

        let job_snapshot = {
            let state = app.state::<DesktopState>();
            let mut registry = state.batch_registry.lock().expect("batch registry poisoned");
            let job = registry
                .jobs
                .get_mut(batch_id)
                .ok_or_else(|| format!("unknown batch `{batch_id}`"))?;
            let target = job
                .targets
                .get_mut(index)
                .ok_or_else(|| format!("missing batch target {index}"))?;
            target.status = BatchTargetStatus::Done;
            target.output_path = Some(output_path.clone());
            target.session_id = Some(session_id);
            job.updated_at = now();
            if job
                .targets
                .iter()
                .all(|target| matches!(target.status, BatchTargetStatus::Done | BatchTargetStatus::Failed | BatchTargetStatus::Skipped))
            {
                job.status = BatchJobStatus::Done;
            }
            job.clone()
        };
        emit_batch_update(&app, job_snapshot, target_path, BatchTargetStatus::Done);
    }

    Ok(())
}

fn mark_batch_target_failed(
    app: &AppHandle,
    batch_id: &str,
    target_index: usize,
    message: String,
) -> Result<(), String> {
    let (job, target_path) = {
        let state = app.state::<DesktopState>();
        let mut registry = state.batch_registry.lock().expect("batch registry poisoned");
        let job = registry
            .jobs
            .get_mut(batch_id)
            .ok_or_else(|| format!("unknown batch `{batch_id}`"))?;
        let target_path = {
            let target = job
                .targets
                .get_mut(target_index)
                .ok_or_else(|| format!("missing batch target {target_index}"))?;
            target.status = BatchTargetStatus::Failed;
            target.error_message = Some(message);
            target.file_path.clone()
        };
        job.status = BatchJobStatus::Failed;
        job.updated_at = now();
        (job.clone(), target_path)
    };
    emit_batch_update(app, job, target_path, BatchTargetStatus::Failed);
    Ok(())
}

fn emit_batch_update(app: &AppHandle, batch_job: BatchJob, target_path: String, status: BatchTargetStatus) {
    let _ = app.emit(
        BATCH_TARGET_UPDATE_EVENT,
        BatchTargetUpdateEvent {
            batch_job,
            target_path,
            status,
        },
    );
}

fn derive_batch_output_path(app: &AppHandle, batch_id: &str, input_path: &str) -> Result<String, String> {
    let state = app.state::<DesktopState>();
    let registry = state.batch_registry.lock().expect("batch registry poisoned");
    let job = registry
        .jobs
        .get(batch_id)
        .ok_or_else(|| format!("unknown batch `{batch_id}`"))?;
    let output_dir = job
        .output_dir
        .clone()
        .ok_or_else(|| "batch output directory is not available".to_string())?;
    let path = PathBuf::from(input_path);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("failed to derive output name from `{input_path}`"))?;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("csv");
    Ok(PathBuf::from(output_dir)
        .join(format!("{stem}.batch-copy.{extension}"))
        .to_string_lossy()
        .to_string())
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_job(id: &str, paths: &[&str]) -> BatchJob {
        BatchJob {
            id: id.to_string(),
            workflow_goal: "filter rows".to_string(),
            project_id: None,
            targets: paths
                .iter()
                .map(|p| BatchTarget {
                    file_path: p.to_string(),
                    status: BatchTargetStatus::Pending,
                    output_path: None,
                    error_message: None,
                    session_id: None,
                })
                .collect(),
            concurrency: 1,
            stop_on_first_error: false,
            status: BatchJobStatus::Idle,
            output_dir: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn batch_registry_stores_and_retrieves_job() {
        let mut registry = BatchRegistry::default();
        let job = make_job("batch-1", &["a.csv", "b.csv"]);
        registry.jobs.insert(job.id.clone(), job);

        let stored = registry.jobs.get("batch-1").unwrap();
        assert_eq!(stored.targets.len(), 2);
        assert_eq!(stored.status, BatchJobStatus::Idle);
        assert_eq!(stored.targets[0].file_path, "a.csv");
    }

    #[test]
    fn batch_skip_target_updates_status_to_skipped() {
        let mut registry = BatchRegistry::default();
        let job = make_job("batch-2", &["x.csv", "y.csv"]);
        registry.jobs.insert(job.id.clone(), job);

        let job = registry.jobs.get_mut("batch-2").unwrap();
        if let Some(t) = job.targets.iter_mut().find(|t| t.file_path == "x.csv") {
            t.status = BatchTargetStatus::Skipped;
        }

        let stored = registry.jobs.get("batch-2").unwrap();
        assert_eq!(stored.targets[0].status, BatchTargetStatus::Skipped);
        assert_eq!(stored.targets[1].status, BatchTargetStatus::Pending);
    }

    #[test]
    fn batch_target_status_serializes_as_lowercase() {
        assert_eq!(
            serde_json::to_string(&BatchTargetStatus::Pending).unwrap(),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&BatchTargetStatus::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&BatchTargetStatus::Done).unwrap(),
            "\"done\""
        );
        assert_eq!(
            serde_json::to_string(&BatchTargetStatus::Failed).unwrap(),
            "\"failed\""
        );
        assert_eq!(
            serde_json::to_string(&BatchTargetStatus::Skipped).unwrap(),
            "\"skipped\""
        );
    }

    #[test]
    fn batch_job_status_serializes_as_lowercase() {
        assert_eq!(
            serde_json::to_string(&BatchJobStatus::Idle).unwrap(),
            "\"idle\""
        );
        assert_eq!(
            serde_json::to_string(&BatchJobStatus::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&BatchJobStatus::Done).unwrap(),
            "\"done\""
        );
        assert_eq!(
            serde_json::to_string(&BatchJobStatus::Failed).unwrap(),
            "\"failed\""
        );
    }

    #[test]
    fn batch_job_roundtrips_through_json() {
        let job = make_job("batch-rt", &["file.csv"]);
        let json = serde_json::to_string(&job).unwrap();
        let restored: BatchJob = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "batch-rt");
        assert_eq!(restored.targets[0].file_path, "file.csv");
        assert_eq!(restored.stop_on_first_error, false);
    }
}
