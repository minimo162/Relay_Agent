use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::TurnArtifactRecord;
use crate::state::DesktopState;

const BUILTIN_TEMPLATE_FILES: [&str; 5] = [
    include_str!("../assets/templates/sales_filter.json"),
    include_str!("../assets/templates/monthly_rollup.json"),
    include_str!("../assets/templates/normalize_columns.json"),
    include_str!("../assets/templates/remove_duplicates.json"),
    include_str!("../assets/templates/invoice_cleanup.json"),
];

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowTemplateCategory {
    Sales,
    Accounting,
    Hr,
    General,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTemplate {
    pub id: String,
    pub title: String,
    pub category: WorkflowTemplateCategory,
    pub description: String,
    pub goal: String,
    pub expected_tools: Vec<String>,
    pub example_input_file: Option<String>,
    pub tags: Vec<String>,
    pub is_built_in: bool,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateListRequest {
    pub category: Option<WorkflowTemplateCategory>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateGetRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCreateRequest {
    pub title: String,
    pub category: WorkflowTemplateCategory,
    pub description: Option<String>,
    pub goal: String,
    pub expected_tools: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDeleteRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFromSessionRequest {
    pub session_id: String,
    pub title: Option<String>,
    pub category: WorkflowTemplateCategory,
    pub description: Option<String>,
}

#[tauri::command]
pub fn template_list(
    app: AppHandle,
    request: TemplateListRequest,
) -> Result<Vec<WorkflowTemplate>, String> {
    let templates = load_all_templates(&app)?;
    Ok(filter_by_category(templates, request.category))
}

#[tauri::command]
pub fn template_get(app: AppHandle, request: TemplateGetRequest) -> Result<WorkflowTemplate, String> {
    load_all_templates(&app)?
        .into_iter()
        .find(|template| template.id == request.id)
        .ok_or_else(|| format!("unknown template `{}`", request.id))
}

#[tauri::command]
pub fn template_create(
    app: AppHandle,
    request: TemplateCreateRequest,
) -> Result<WorkflowTemplate, String> {
    if request.title.trim().is_empty() || request.goal.trim().is_empty() {
        return Err("template title and goal are required".to_string());
    }

    let template = WorkflowTemplate {
        id: format!("template-{}", Uuid::new_v4()),
        title: request.title.trim().to_string(),
        category: request.category,
        description: request.description.unwrap_or_default(),
        goal: request.goal.trim().to_string(),
        expected_tools: request.expected_tools.unwrap_or_default(),
        example_input_file: None,
        tags: request.tags.unwrap_or_default(),
        is_built_in: false,
        created_at: now(),
    };
    persist_custom_template(&app, &template)?;
    Ok(template)
}

#[tauri::command]
pub fn template_delete(app: AppHandle, request: TemplateDeleteRequest) -> Result<(), String> {
    let template_path = custom_templates_dir(&app)?.join(format!("{}.json", request.id));
    if template_path.exists() {
        fs::remove_file(&template_path)
            .map_err(|error| format!("failed to delete template `{}`: {error}", request.id))?;
    }
    Ok(())
}

#[tauri::command]
pub fn template_from_session(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    request: TemplateFromSessionRequest,
) -> Result<WorkflowTemplate, String> {
    let (session, tools) = {
        let storage = state.storage.lock().expect("desktop storage poisoned");
        let session = storage.read_session(&request.session_id)?;
        let mut seen = HashSet::new();
        let mut tools = Vec::new();

        for turn_id in &session.session.turn_ids {
            if let Ok(response) = storage.read_turn_artifacts(&request.session_id, turn_id) {
                for artifact in &response.artifacts {
                    for tool_name in extract_tool_names_from_artifact(artifact) {
                        if seen.insert(tool_name.clone()) {
                            tools.push(tool_name);
                        }
                    }
                }
            }
        }

        (session.session, tools)
    };

    let template = WorkflowTemplate {
        id: format!("template-{}", Uuid::new_v4()),
        title: request
            .title
            .unwrap_or_else(|| format!("{} テンプレート", session.title)),
        category: request.category,
        description: request.description.unwrap_or_default(),
        goal: session.objective,
        expected_tools: tools,
        example_input_file: session.primary_workbook_path,
        tags: vec!["session-derived".to_string()],
        is_built_in: false,
        created_at: now(),
    };
    persist_custom_template(&app, &template)?;
    Ok(template)
}

fn extract_tool_names_from_artifact(artifact: &TurnArtifactRecord) -> Vec<String> {
    match artifact {
        TurnArtifactRecord::Preview { payload, .. } => payload
            .file_write_actions
            .iter()
            .filter_map(|action| {
                let tool_name = action.tool.trim();
                (!tool_name.is_empty()).then(|| tool_name.to_string())
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn filter_by_category(
    templates: Vec<WorkflowTemplate>,
    category: Option<WorkflowTemplateCategory>,
) -> Vec<WorkflowTemplate> {
    match category {
        Some(category) => templates
            .into_iter()
            .filter(|template| template.category == category)
            .collect(),
        None => templates,
    }
}

fn load_all_templates(app: &AppHandle) -> Result<Vec<WorkflowTemplate>, String> {
    let mut templates = BUILTIN_TEMPLATE_FILES
        .iter()
        .map(|raw| serde_json::from_str::<WorkflowTemplate>(raw))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to parse built-in templates: {error}"))?;
    templates.extend(load_custom_templates(app)?);
    Ok(templates)
}

fn load_custom_templates(app: &AppHandle) -> Result<Vec<WorkflowTemplate>, String> {
    let directory = custom_templates_dir(app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut templates = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("failed to read template directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read template entry: {error}"))?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(entry.path())
            .map_err(|error| format!("failed to read template file: {error}"))?;
        let template = serde_json::from_str::<WorkflowTemplate>(&raw)
            .map_err(|error| format!("failed to parse template file: {error}"))?;
        templates.push(template);
    }
    Ok(templates)
}

fn persist_custom_template(app: &AppHandle, template: &WorkflowTemplate) -> Result<(), String> {
    let directory = custom_templates_dir(app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create template directory: {error}"))?;
    let path = directory.join(format!("{}.json", template.id));
    let raw = serde_json::to_string_pretty(template)
        .map_err(|error| format!("failed to encode template: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("failed to persist template: {error}"))
}

fn custom_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = match env::var("RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR") {
        Ok(value) if !value.trim().is_empty() => PathBuf::from(value),
        Ok(_) => {
            return Err(
                "RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR was set but empty for template storage."
                    .to_string(),
            )
        }
        Err(_) => app.path().app_local_data_dir().map_err(|error| error.to_string())?,
    };
    Ok(base.join("storage-v1").join("templates"))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[allow(dead_code)]
fn _is_template_path(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str()) == Some("json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_template(
        id: &str,
        category: WorkflowTemplateCategory,
        is_built_in: bool,
    ) -> WorkflowTemplate {
        WorkflowTemplate {
            id: id.to_string(),
            title: format!("Template {id}"),
            category,
            description: "desc".to_string(),
            goal: "do something".to_string(),
            expected_tools: vec!["table.filter_rows".to_string()],
            example_input_file: None,
            tags: vec![],
            is_built_in,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn template_category_serializes_correctly() {
        assert_eq!(
            serde_json::to_string(&WorkflowTemplateCategory::Sales).unwrap(),
            "\"sales\""
        );
        assert_eq!(
            serde_json::to_string(&WorkflowTemplateCategory::Accounting).unwrap(),
            "\"accounting\""
        );
        assert_eq!(
            serde_json::to_string(&WorkflowTemplateCategory::Hr).unwrap(),
            "\"hr\""
        );
        assert_eq!(
            serde_json::to_string(&WorkflowTemplateCategory::General).unwrap(),
            "\"general\""
        );
        assert_eq!(
            serde_json::to_string(&WorkflowTemplateCategory::Custom).unwrap(),
            "\"custom\""
        );
    }

    #[test]
    fn template_is_built_in_serializes_as_camel_case_key() {
        let t = make_template("t1", WorkflowTemplateCategory::Sales, true);
        let v = serde_json::to_value(&t).unwrap();
        assert!(v.get("isBuiltIn").is_some(), "key must be camelCase 'isBuiltIn'");
        assert_eq!(v["isBuiltIn"], true);
    }

    #[test]
    fn filter_by_category_returns_matching_only() {
        let templates = vec![
            make_template("a", WorkflowTemplateCategory::Sales, true),
            make_template("b", WorkflowTemplateCategory::General, true),
            make_template("c", WorkflowTemplateCategory::Sales, false),
        ];

        let sales = filter_by_category(templates.clone(), Some(WorkflowTemplateCategory::Sales));
        assert_eq!(sales.len(), 2);
        assert!(sales
            .iter()
            .all(|t| matches!(t.category, WorkflowTemplateCategory::Sales)));
    }

    #[test]
    fn filter_by_category_none_returns_all() {
        let templates = vec![
            make_template("a", WorkflowTemplateCategory::Sales, true),
            make_template("b", WorkflowTemplateCategory::Hr, false),
        ];
        let all = filter_by_category(templates, None);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn builtin_template_jsons_parse_correctly() {
        let raws: &[&str] = &[
            include_str!("../assets/templates/sales_filter.json"),
            include_str!("../assets/templates/monthly_rollup.json"),
            include_str!("../assets/templates/normalize_columns.json"),
            include_str!("../assets/templates/remove_duplicates.json"),
            include_str!("../assets/templates/invoice_cleanup.json"),
        ];
        for raw in raws {
            let t: WorkflowTemplate =
                serde_json::from_str(raw).expect("builtin template JSON must be valid");
            assert!(t.is_built_in, "isBuiltIn must be true for bundled templates");
            assert!(!t.title.is_empty(), "title must not be empty");
            assert!(!t.goal.is_empty(), "goal must not be empty");
            assert!(!t.expected_tools.is_empty(), "expected_tools must not be empty");
        }
    }

    #[test]
    fn template_roundtrips_through_json() {
        let original = make_template("rt-1", WorkflowTemplateCategory::Custom, false);
        let json = serde_json::to_string(&original).unwrap();
        let restored: WorkflowTemplate = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "rt-1");
        assert!(!restored.is_built_in);
        assert_eq!(restored.expected_tools, vec!["table.filter_rows".to_string()]);
    }
}
