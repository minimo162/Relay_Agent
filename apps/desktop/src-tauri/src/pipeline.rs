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

const PIPELINE_STEP_UPDATE_EVENT: &str = "pipeline:step_update";

#[derive(Default)]
pub struct PipelineRegistry {
    pipelines: HashMap<String, Pipeline>,
    cancelled: HashMap<String, bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStepStatus {
    Pending,
    Running,
    WaitingApproval,
    Done,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineInputSource {
    User,
    PrevStepOutput,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PipelineStatus {
    Idle,
    Running,
    Done,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStep {
    pub id: String,
    pub order: i64,
    pub goal: String,
    pub input_source: PipelineInputSource,
    pub output_artifact_key: Option<String>,
    pub status: PipelineStepStatus,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pipeline {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub initial_input_path: Option<String>,
    pub steps: Vec<PipelineStep>,
    pub status: PipelineStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepDraft {
    pub goal: String,
    pub input_source: PipelineInputSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineCreateRequest {
    pub title: String,
    pub project_id: Option<String>,
    pub initial_input_path: Option<String>,
    pub steps: Vec<PipelineStepDraft>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStatusRequest {
    pub pipeline_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PipelineStepUpdateEvent {
    pipeline: Pipeline,
    step_id: String,
    status: PipelineStepStatus,
}

impl PipelineRegistry {
    fn create(&mut self, request: PipelineCreateRequest) -> Pipeline {
        let timestamp = now();
        let pipeline = Pipeline {
            id: format!("pipeline-{}", Uuid::new_v4()),
            title: request.title.trim().to_string(),
            project_id: request.project_id.filter(|value| !value.trim().is_empty()),
            initial_input_path: request
                .initial_input_path
                .filter(|value| !value.trim().is_empty()),
            steps: request
                .steps
                .into_iter()
                .enumerate()
                .map(|(index, step)| PipelineStep {
                    id: format!("pipeline-step-{}", Uuid::new_v4()),
                    order: index as i64,
                    goal: step.goal.trim().to_string(),
                    input_source: step.input_source,
                    output_artifact_key: None,
                    status: PipelineStepStatus::Pending,
                    error_message: None,
                })
                .collect(),
            status: PipelineStatus::Idle,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        self.cancelled.insert(pipeline.id.clone(), false);
        self.pipelines.insert(pipeline.id.clone(), pipeline.clone());
        pipeline
    }

    fn get(&self, pipeline_id: &str) -> Option<Pipeline> {
        self.pipelines.get(pipeline_id).cloned()
    }
}

#[tauri::command]
pub fn pipeline_create(
    state: State<'_, DesktopState>,
    request: PipelineCreateRequest,
) -> Result<Pipeline, String> {
    if request.title.trim().is_empty() {
        return Err("pipeline title is required".to_string());
    }
    if request.steps.is_empty() {
        return Err("at least one pipeline step is required".to_string());
    }

    let mut registry = state
        .pipeline_registry
        .lock()
        .expect("pipeline registry poisoned");
    Ok(registry.create(request))
}

#[tauri::command]
pub fn pipeline_get_status(
    state: State<'_, DesktopState>,
    request: PipelineStatusRequest,
) -> Result<Pipeline, String> {
    let registry = state
        .pipeline_registry
        .lock()
        .expect("pipeline registry poisoned");
    registry
        .get(&request.pipeline_id)
        .ok_or_else(|| format!("unknown pipeline `{}`", request.pipeline_id))
}

#[tauri::command]
pub fn pipeline_cancel(
    state: State<'_, DesktopState>,
    request: PipelineStatusRequest,
) -> Result<(), String> {
    let mut registry = state
        .pipeline_registry
        .lock()
        .expect("pipeline registry poisoned");
    if !registry.pipelines.contains_key(&request.pipeline_id) {
        return Err(format!("unknown pipeline `{}`", request.pipeline_id));
    }
    registry.cancelled.insert(request.pipeline_id, true);
    Ok(())
}

#[tauri::command]
pub async fn pipeline_run(
    app: AppHandle,
    state: State<'_, DesktopState>,
    request: PipelineStatusRequest,
) -> Result<(), String> {
    {
        let registry = state
            .pipeline_registry
            .lock()
            .expect("pipeline registry poisoned");
        if !registry.pipelines.contains_key(&request.pipeline_id) {
            return Err(format!("unknown pipeline `{}`", request.pipeline_id));
        }
    }

    let pipeline_id = request.pipeline_id;
    tauri::async_runtime::spawn(async move {
        let _ = run_pipeline(app, &pipeline_id).await;
    });
    Ok(())
}

async fn run_pipeline(app: AppHandle, pipeline_id: &str) -> Result<(), String> {
    let step_count = {
        let state = app.state::<DesktopState>();
        let mut registry = state
            .pipeline_registry
            .lock()
            .expect("pipeline registry poisoned");
        let pipeline = registry
            .pipelines
            .get_mut(pipeline_id)
            .ok_or_else(|| format!("unknown pipeline `{pipeline_id}`"))?;
        pipeline.status = PipelineStatus::Running;
        pipeline.updated_at = now();
        pipeline.steps.len()
    };

    for index in 0..step_count {
        if is_pipeline_cancelled(&app, pipeline_id)? {
            mark_pipeline_failed(
                &app,
                pipeline_id,
                index,
                "Pipeline run was cancelled.".to_string(),
            )?;
            return Ok(());
        }

        let (step_id, step_goal, input_source, input_path, pipeline_snapshot) = {
            let state = app.state::<DesktopState>();
            let mut registry = state
                .pipeline_registry
                .lock()
                .expect("pipeline registry poisoned");
            let pipeline = registry
                .pipelines
                .get_mut(pipeline_id)
                .ok_or_else(|| format!("unknown pipeline `{pipeline_id}`"))?;
            let previous_output = if index == 0 {
                None
            } else {
                pipeline.steps[index - 1].output_artifact_key.clone()
            };
            let step = pipeline
                .steps
                .get_mut(index)
                .ok_or_else(|| format!("missing pipeline step {index}"))?;
            step.status = PipelineStepStatus::Running;
            step.error_message = None;
            pipeline.updated_at = now();
            let resolved_input = match step.input_source {
                PipelineInputSource::User => pipeline.initial_input_path.clone(),
                PipelineInputSource::PrevStepOutput => previous_output,
            };
            (
                step.id.clone(),
                step.goal.clone(),
                step.input_source,
                resolved_input,
                pipeline.clone(),
            )
        };
        emit_pipeline_update(&app, pipeline_snapshot, step_id.clone(), PipelineStepStatus::Running);

        let input_path = match input_path {
            Some(path) if !path.trim().is_empty() => path,
            _ => {
                mark_pipeline_failed(
                    &app,
                    pipeline_id,
                    index,
                    "This step did not have a usable input file.".to_string(),
                )?;
                return Ok(());
            }
        };

        if step_goal.contains("[fail]") || !Path::new(&input_path).exists() {
            mark_pipeline_failed(
                &app,
                pipeline_id,
                index,
                format!("Step input was not available: {input_path}"),
            )?;
            return Ok(());
        }

        let output_path = derive_copy_path(&input_path, &format!("pipeline-step-{}", index + 1))?;
        fs::copy(&input_path, &output_path)
            .map_err(|error| format!("failed to create pipeline output copy: {error}"))?;

        {
            let state = app.state::<DesktopState>();
            let mut storage = state.storage.lock().expect("desktop storage poisoned");
            let session = storage.create_session(CreateSessionRequest {
                title: format!("{} / Step {}", step_goal, index + 1),
                objective: step_goal.clone(),
                primary_workbook_path: Some(input_path.clone()),
            })?;
            let _ = storage.start_turn(StartTurnRequest {
                session_id: session.id,
                title: format!("Pipeline step {}", index + 1),
                objective: step_goal,
                mode: RelayMode::Discover,
            })?;
            drop(storage);
        }

        let pipeline_snapshot = {
            let state = app.state::<DesktopState>();
            let mut registry = state
                .pipeline_registry
                .lock()
                .expect("pipeline registry poisoned");
            let pipeline = registry
                .pipelines
                .get_mut(pipeline_id)
                .ok_or_else(|| format!("unknown pipeline `{pipeline_id}`"))?;
            let step = pipeline
                .steps
                .get_mut(index)
                .ok_or_else(|| format!("missing pipeline step {index}"))?;
            step.output_artifact_key = Some(output_path.clone());
            step.status = PipelineStepStatus::Done;
            pipeline.updated_at = now();
            if index + 1 == pipeline.steps.len() {
                pipeline.status = PipelineStatus::Done;
            }
            pipeline.clone()
        };
        emit_pipeline_update(&app, pipeline_snapshot, step_id, PipelineStepStatus::Done);
        let _ = input_source;
    }

    Ok(())
}

fn is_pipeline_cancelled(app: &AppHandle, pipeline_id: &str) -> Result<bool, String> {
    let state = app.state::<DesktopState>();
    let registry = state
        .pipeline_registry
        .lock()
        .expect("pipeline registry poisoned");
    Ok(*registry.cancelled.get(pipeline_id).unwrap_or(&false))
}

fn mark_pipeline_failed(
    app: &AppHandle,
    pipeline_id: &str,
    step_index: usize,
    message: String,
) -> Result<(), String> {
    let (pipeline, step_id) = {
        let state = app.state::<DesktopState>();
        let mut registry = state
            .pipeline_registry
            .lock()
            .expect("pipeline registry poisoned");
        let pipeline = registry
            .pipelines
            .get_mut(pipeline_id)
            .ok_or_else(|| format!("unknown pipeline `{pipeline_id}`"))?;
        pipeline.status = PipelineStatus::Failed;
        pipeline.updated_at = now();
        let step_id = {
            let step = pipeline
                .steps
                .get_mut(step_index)
                .ok_or_else(|| format!("missing pipeline step {step_index}"))?;
            step.status = PipelineStepStatus::Failed;
            step.error_message = Some(message);
            step.id.clone()
        };
        (pipeline.clone(), step_id)
    };
    emit_pipeline_update(app, pipeline, step_id, PipelineStepStatus::Failed);
    Ok(())
}

fn emit_pipeline_update(
    app: &AppHandle,
    pipeline: Pipeline,
    step_id: String,
    status: PipelineStepStatus,
) {
    let _ = app.emit(
        PIPELINE_STEP_UPDATE_EVENT,
        PipelineStepUpdateEvent {
            pipeline,
            step_id,
            status,
        },
    );
}

fn derive_copy_path(input_path: &str, suffix: &str) -> Result<String, String> {
    let path = PathBuf::from(input_path);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("failed to derive output name from `{input_path}`"))?;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("csv");
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    Ok(parent
        .join(format!("{stem}.{suffix}.{extension}"))
        .to_string_lossy()
        .to_string())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_step(id: &str, order: i64, source: PipelineInputSource) -> PipelineStep {
        PipelineStep {
            id: id.to_string(),
            order,
            goal: format!("goal for {id}"),
            input_source: source,
            output_artifact_key: None,
            status: PipelineStepStatus::Pending,
            error_message: None,
        }
    }

    fn make_pipeline(id: &str, steps: Vec<PipelineStep>) -> Pipeline {
        Pipeline {
            id: id.to_string(),
            title: "test pipeline".to_string(),
            project_id: None,
            initial_input_path: Some("source.csv".to_string()),
            steps,
            status: PipelineStatus::Idle,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn pipeline_registry_stores_and_retrieves_pipeline() {
        let mut registry = PipelineRegistry::default();
        let pipeline = make_pipeline(
            "pipe-1",
            vec![
                make_step("s1", 0, PipelineInputSource::User),
                make_step("s2", 1, PipelineInputSource::PrevStepOutput),
            ],
        );
        registry.pipelines.insert(pipeline.id.clone(), pipeline);

        let stored = registry.pipelines.get("pipe-1").unwrap();
        assert_eq!(stored.steps.len(), 2);
        assert_eq!(stored.steps[1].input_source, PipelineInputSource::PrevStepOutput);
    }

    #[test]
    fn pipeline_cancel_flag_is_set_and_read() {
        let mut registry = PipelineRegistry::default();
        registry.cancelled.insert("pipe-cancel".to_string(), true);

        assert!(*registry.cancelled.get("pipe-cancel").unwrap_or(&false));
        assert!(!*registry.cancelled.get("other-pipe").unwrap_or(&false));
    }

    #[test]
    fn pipeline_steps_sort_by_order() {
        let mut steps = vec![
            make_step("s3", 2, PipelineInputSource::PrevStepOutput),
            make_step("s1", 0, PipelineInputSource::User),
            make_step("s2", 1, PipelineInputSource::PrevStepOutput),
        ];
        steps.sort_by_key(|s| s.order);
        assert_eq!(steps[0].id, "s1");
        assert_eq!(steps[1].id, "s2");
        assert_eq!(steps[2].id, "s3");
    }

    #[test]
    fn pipeline_step_status_serializes_as_snake_case() {
        assert_eq!(
            serde_json::to_string(&PipelineStepStatus::Pending).unwrap(),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&PipelineStepStatus::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&PipelineStepStatus::WaitingApproval).unwrap(),
            "\"waiting_approval\""
        );
        assert_eq!(
            serde_json::to_string(&PipelineStepStatus::Done).unwrap(),
            "\"done\""
        );
        assert_eq!(
            serde_json::to_string(&PipelineStepStatus::Failed).unwrap(),
            "\"failed\""
        );
    }

    #[test]
    fn pipeline_input_source_serializes_as_snake_case() {
        assert_eq!(
            serde_json::to_string(&PipelineInputSource::User).unwrap(),
            "\"user\""
        );
        assert_eq!(
            serde_json::to_string(&PipelineInputSource::PrevStepOutput).unwrap(),
            "\"prev_step_output\""
        );
    }

    #[test]
    fn prev_step_output_key_chains_correctly() {
        let mut steps = vec![
            make_step("s1", 0, PipelineInputSource::User),
            make_step("s2", 1, PipelineInputSource::PrevStepOutput),
        ];
        steps[0].output_artifact_key = Some("/out/step1.csv".to_string());

        let resolved = match steps[1].input_source {
            PipelineInputSource::User => steps[1].output_artifact_key.clone().unwrap_or_default(),
            PipelineInputSource::PrevStepOutput => {
                steps[0].output_artifact_key.clone().unwrap_or_default()
            }
        };
        assert_eq!(resolved, "/out/step1.csv");
    }
}
