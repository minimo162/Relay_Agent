use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use claw_core::Message;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

use crate::models::{Project, Session, SessionStatus, ToolSettings, Turn};

const STORAGE_ROOT_DIR: &str = "storage-v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageManifest {
    pub schema_version: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_successful_migration: Option<String>,
}

#[derive(Debug)]
pub struct LoadedStorage {
    pub manifest: StorageManifest,
    pub tool_settings: ToolSettings,
    pub projects: HashMap<String, Project>,
    pub sessions: HashMap<String, Session>,
    pub turns: HashMap<String, Turn>,
    pub session_messages: HashMap<String, Vec<Message>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedArtifactMeta {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub artifact_type: String,
    pub created_at: String,
    pub relative_payload_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_output_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedLogEntry {
    pub timestamp: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    pub event_type: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionIndexEntry {
    id: String,
    title: String,
    status: SessionStatus,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    primary_workbook_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIndexEntry {
    id: String,
    name: String,
    root_folder: String,
    created_at: String,
    updated_at: String,
}

impl From<&Project> for ProjectIndexEntry {
    fn from(project: &Project) -> Self {
        Self {
            id: project.id.clone(),
            name: project.name.clone(),
            root_folder: project.root_folder.clone(),
            created_at: project.created_at.clone(),
            updated_at: project.updated_at.clone(),
        }
    }
}

impl From<&Session> for SessionIndexEntry {
    fn from(session: &Session) -> Self {
        Self {
            id: session.id.clone(),
            title: session.title.clone(),
            status: session.status,
            created_at: session.created_at.clone(),
            updated_at: session.updated_at.clone(),
            latest_turn_id: session.latest_turn_id.clone(),
            primary_workbook_path: session.primary_workbook_path.clone(),
        }
    }
}

pub fn storage_root(app_local_data_dir: &Path) -> PathBuf {
    app_local_data_dir.join(STORAGE_ROOT_DIR)
}

pub fn initialize_storage(app_local_data_dir: &Path, now: &str) -> Result<LoadedStorage, String> {
    let storage_root = storage_root(app_local_data_dir);
    let sessions_dir = sessions_dir(&storage_root);
    let projects_dir = projects_dir(&storage_root);

    fs::create_dir_all(&sessions_dir).map_err(|error| {
        format!(
            "failed to create storage directory `{}`: {error}",
            sessions_dir.display()
        )
    })?;
    fs::create_dir_all(&projects_dir).map_err(|error| {
        format!(
            "failed to create storage directory `{}`: {error}",
            projects_dir.display()
        )
    })?;

    let manifest_path = manifest_path(&storage_root);
    let manifest = if manifest_path.exists() {
        read_json_file(&manifest_path)?
    } else {
        let manifest = StorageManifest {
            schema_version: STORAGE_ROOT_DIR.to_string(),
            created_at: now.to_string(),
            updated_at: now.to_string(),
            last_successful_migration: None,
        };
        write_json_atomic(&manifest_path, &manifest)?;
        manifest
    };

    let index_path = session_index_path(&storage_root);
    if !index_path.exists() {
        write_json_atomic(&index_path, &Vec::<SessionIndexEntry>::new())?;
    }
    let project_index_path = project_index_path(&storage_root);
    if !project_index_path.exists() {
        write_json_atomic(&project_index_path, &Vec::<ProjectIndexEntry>::new())?;
    }
    let tool_settings_path = tool_settings_path(&storage_root);
    if !tool_settings_path.exists() {
        write_json_atomic(&tool_settings_path, &ToolSettings::default())?;
    }

    let project_index: Vec<ProjectIndexEntry> = read_json_file(&project_index_path)?;
    let session_index: Vec<SessionIndexEntry> = read_json_file(&index_path)?;
    let tool_settings: ToolSettings = read_json_file(&tool_settings_path)?;
    let mut projects = HashMap::new();
    let mut sessions = HashMap::new();
    let mut turns = HashMap::new();
    let mut session_messages = HashMap::new();

    for entry in project_index {
        let project_path = project_file_path(&storage_root, &entry.id);
        let project: Project = read_json_file(&project_path)?;
        projects.insert(project.id.clone(), project);
    }

    for entry in session_index {
        let session_path = session_file_path(&storage_root, &entry.id);
        let session: Session = read_json_file(&session_path)?;
        let messages = if session_history_path(&storage_root, &entry.id).is_file() {
            read_json_file(&session_history_path(&storage_root, &entry.id))?
        } else {
            Vec::new()
        };
        for turn_id in &session.turn_ids {
            let turn_path = turn_file_path(&storage_root, &session.id, turn_id);
            let turn: Turn = read_json_file(&turn_path)?;
            turns.insert(turn.id.clone(), turn);
        }
        session_messages.insert(session.id.clone(), messages);
        sessions.insert(session.id.clone(), session);
    }

    Ok(LoadedStorage {
        manifest,
        tool_settings,
        projects,
        sessions,
        turns,
        session_messages,
    })
}

pub fn persist_tool_settings(
    app_local_data_dir: &Path,
    manifest: &mut StorageManifest,
    tool_settings: &ToolSettings,
    now: &str,
) -> Result<(), String> {
    let storage_root = storage_root(app_local_data_dir);
    write_json_atomic(&tool_settings_path(&storage_root), tool_settings)?;

    manifest.updated_at = now.to_string();
    write_json_atomic(&manifest_path(&storage_root), manifest)?;

    Ok(())
}

pub fn persist_projects_state(
    app_local_data_dir: &Path,
    manifest: &mut StorageManifest,
    projects: &HashMap<String, Project>,
    now: &str,
) -> Result<(), String> {
    let storage_root = storage_root(app_local_data_dir);

    for project in projects.values() {
        write_json_atomic(&project_file_path(&storage_root, &project.id), project)?;
    }

    let mut project_index = projects
        .values()
        .map(ProjectIndexEntry::from)
        .collect::<Vec<_>>();
    project_index.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    write_json_atomic(&project_index_path(&storage_root), &project_index)?;

    manifest.updated_at = now.to_string();
    write_json_atomic(&manifest_path(&storage_root), manifest)?;

    Ok(())
}

pub fn persist_session_state(
    app_local_data_dir: &Path,
    manifest: &mut StorageManifest,
    sessions: &HashMap<String, Session>,
    turns: &HashMap<String, Turn>,
    session_id: &str,
    session_messages: &[Message],
    now: &str,
) -> Result<(), String> {
    let storage_root = storage_root(app_local_data_dir);
    let session = sessions
        .get(session_id)
        .ok_or_else(|| format!("session `{session_id}` was not found"))?;

    let session_dir = session_dir(&storage_root, &session.id);
    fs::create_dir_all(session_dir.join("turns")).map_err(|error| {
        format!(
            "failed to create session directory `{}`: {error}",
            session_dir.display()
        )
    })?;

    write_json_atomic(&session_file_path(&storage_root, &session.id), session)?;
    write_json_atomic(
        &session_history_path(&storage_root, &session.id),
        &session_messages,
    )?;
    for turn_id in &session.turn_ids {
        let turn = turns
            .get(turn_id)
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))?;
        write_json_atomic(&turn_file_path(&storage_root, &session.id, turn_id), turn)?;
    }

    let mut session_index = sessions
        .values()
        .map(SessionIndexEntry::from)
        .collect::<Vec<_>>();
    session_index.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    write_json_atomic(&session_index_path(&storage_root), &session_index)?;

    manifest.updated_at = now.to_string();
    write_json_atomic(&manifest_path(&storage_root), manifest)?;

    Ok(())
}

pub fn persist_artifact<T: Serialize>(
    app_local_data_dir: &Path,
    meta: &PersistedArtifactMeta,
    payload: &T,
) -> Result<(), String> {
    let storage_root = storage_root(app_local_data_dir);
    let artifact_dir = artifact_dir(&storage_root, &meta.session_id, &meta.id);

    write_json_atomic(&artifact_dir.join("meta.json"), meta)?;
    write_json_atomic(&artifact_dir.join("payload.json"), payload)?;

    Ok(())
}

pub fn read_artifact_meta(
    app_local_data_dir: &Path,
    session_id: &str,
    artifact_id: &str,
) -> Result<PersistedArtifactMeta, String> {
    let storage_root = storage_root(app_local_data_dir);
    read_json_file(&artifact_dir(&storage_root, session_id, artifact_id).join("meta.json"))
}

pub fn read_artifact_payload<T: DeserializeOwned>(
    app_local_data_dir: &Path,
    session_id: &str,
    artifact_id: &str,
) -> Result<T, String> {
    let storage_root = storage_root(app_local_data_dir);
    read_json_file(&artifact_dir(&storage_root, session_id, artifact_id).join("payload.json"))
}

pub fn append_session_log(
    app_local_data_dir: &Path,
    entry: &PersistedLogEntry,
) -> Result<(), String> {
    let storage_root = storage_root(app_local_data_dir);
    append_ndjson(&session_log_path(&storage_root, &entry.session_id), entry)
}

pub fn append_turn_log(app_local_data_dir: &Path, entry: &PersistedLogEntry) -> Result<(), String> {
    let turn_id = entry
        .turn_id
        .as_deref()
        .ok_or_else(|| "turn log entries require a turn_id".to_string())?;
    let storage_root = storage_root(app_local_data_dir);

    append_ndjson(
        &turn_log_path(&storage_root, &entry.session_id, turn_id),
        entry,
    )
}

fn manifest_path(storage_root: &Path) -> PathBuf {
    storage_root.join("manifest.json")
}

fn sessions_dir(storage_root: &Path) -> PathBuf {
    storage_root.join("sessions")
}

fn projects_dir(storage_root: &Path) -> PathBuf {
    storage_root.join("projects")
}

fn session_index_path(storage_root: &Path) -> PathBuf {
    sessions_dir(storage_root).join("index.json")
}

fn project_index_path(storage_root: &Path) -> PathBuf {
    projects_dir(storage_root).join("index.json")
}

fn tool_settings_path(storage_root: &Path) -> PathBuf {
    storage_root.join("tool-settings.json")
}

fn project_file_path(storage_root: &Path, project_id: &str) -> PathBuf {
    projects_dir(storage_root).join(format!("{project_id}.json"))
}

fn session_dir(storage_root: &Path, session_id: &str) -> PathBuf {
    sessions_dir(storage_root).join(session_id)
}

fn artifacts_dir(storage_root: &Path, session_id: &str) -> PathBuf {
    session_dir(storage_root, session_id).join("artifacts")
}

fn artifact_dir(storage_root: &Path, session_id: &str, artifact_id: &str) -> PathBuf {
    artifacts_dir(storage_root, session_id).join(artifact_id)
}

fn logs_dir(storage_root: &Path, session_id: &str) -> PathBuf {
    session_dir(storage_root, session_id).join("logs")
}

fn session_file_path(storage_root: &Path, session_id: &str) -> PathBuf {
    session_dir(storage_root, session_id).join("session.json")
}

fn session_history_path(storage_root: &Path, session_id: &str) -> PathBuf {
    session_dir(storage_root, session_id).join("history.json")
}

fn turn_file_path(storage_root: &Path, session_id: &str, turn_id: &str) -> PathBuf {
    session_dir(storage_root, session_id)
        .join("turns")
        .join(format!("{turn_id}.json"))
}

fn session_log_path(storage_root: &Path, session_id: &str) -> PathBuf {
    logs_dir(storage_root, session_id).join("session.ndjson")
}

fn turn_log_path(storage_root: &Path, session_id: &str, turn_id: &str) -> PathBuf {
    logs_dir(storage_root, session_id).join(format!("{turn_id}.ndjson"))
}

fn read_json_file<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse `{}`: {error}", path.display()))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create parent directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("failed to serialize `{}`: {error}", path.display()))?;
    bytes.push(b'\n');

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid storage filename `{}`", path.display()))?;
    let temp_path = path.with_file_name(format!("{file_name}.tmp"));

    fs::write(&temp_path, bytes)
        .map_err(|error| format!("failed to write `{}`: {error}", temp_path.display()))?;
    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "failed to promote `{}` to `{}`: {error}",
            temp_path.display(),
            path.display()
        )
    })?;

    Ok(())
}

fn append_ndjson<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create parent directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let mut bytes = serde_json::to_vec(value)
        .map_err(|error| format!("failed to serialize `{}`: {error}", path.display()))?;
    bytes.push(b'\n');

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("failed to open `{}` for append: {error}", path.display()))?;
    file.write_all(&bytes)
        .map_err(|error| format!("failed to append `{}`: {error}", path.display()))
}
