mod data;

use data::{DataSource, EntityRef, EntityRow, LocalFsDataSource, WorldSummary};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

struct AppState {
    source: Arc<dyn DataSource>,
}

#[tauri::command]
fn load_world(path: String, state: State<'_, AppState>) -> Result<WorldSummary, String> {
    state.source.load_world(&PathBuf::from(path))
}

#[tauri::command]
fn get_world_bible(path: String, state: State<'_, AppState>) -> Result<Value, String> {
    state.source.get_world_bible(&PathBuf::from(path))
}

#[tauri::command]
fn list_entities(path: String, type_id: String, state: State<'_, AppState>) -> Result<Vec<EntityRef>, String> {
    state.source.list_entities(&PathBuf::from(path), &type_id)
}

#[tauri::command]
fn list_entity_rows(path: String, type_id: String, state: State<'_, AppState>) -> Result<Vec<EntityRow>, String> {
    state.source.list_entity_rows(&PathBuf::from(path), &type_id)
}

#[tauri::command]
fn get_entity(path: String, type_id: String, id: String, state: State<'_, AppState>) -> Result<Value, String> {
    state.source.get_entity(&PathBuf::from(path), &type_id, &id)
}

#[tauri::command]
fn resolve_asset(path: String, hint: String, state: State<'_, AppState>) -> Option<String> {
    state.source.resolve_asset(&PathBuf::from(path), &hint)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { source: Arc::new(LocalFsDataSource) })
        .invoke_handler(tauri::generate_handler![
            load_world,
            get_world_bible,
            list_entities,
            list_entity_rows,
            get_entity,
            resolve_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
