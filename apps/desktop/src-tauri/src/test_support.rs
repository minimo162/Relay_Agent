use crate::app_services::AppServices;
use tauri::Manager;

#[must_use]
pub fn create_test_app() -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    app.manage(AppServices::new());
    app
}
