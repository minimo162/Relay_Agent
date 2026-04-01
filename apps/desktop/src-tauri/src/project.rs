use tauri::State;

use crate::models::{
    AddProjectMemoryRequest, CreateProjectRequest, LinkSessionToProjectRequest,
    ListProjectsResponse, Project, ReadProjectRequest, RemoveProjectMemoryRequest,
    SetSessionProjectRequest, UpdateProjectRequest,
};
use crate::state::DesktopState;

#[tauri::command]
pub fn create_project(
    state: State<'_, DesktopState>,
    request: CreateProjectRequest,
) -> Result<Project, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.create_project(request)
}

#[tauri::command]
pub fn list_projects(state: State<'_, DesktopState>) -> ListProjectsResponse {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.list_projects()
}

#[tauri::command]
pub fn read_project(
    state: State<'_, DesktopState>,
    request: ReadProjectRequest,
) -> Result<Project, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.read_project(request)
}

#[tauri::command]
pub fn update_project(
    state: State<'_, DesktopState>,
    request: UpdateProjectRequest,
) -> Result<Project, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.update_project(request)
}

#[tauri::command]
pub fn add_project_memory(
    state: State<'_, DesktopState>,
    request: AddProjectMemoryRequest,
) -> Result<Project, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.add_project_memory(request)
}

#[tauri::command]
pub fn remove_project_memory(
    state: State<'_, DesktopState>,
    request: RemoveProjectMemoryRequest,
) -> Result<Project, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.remove_project_memory(request)
}

#[tauri::command]
pub fn link_session_to_project(
    state: State<'_, DesktopState>,
    request: LinkSessionToProjectRequest,
) -> Result<Project, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.link_session_to_project(request)
}

#[tauri::command]
pub fn set_session_project(
    state: State<'_, DesktopState>,
    request: SetSessionProjectRequest,
) -> Result<ListProjectsResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.set_session_project(request)
}
