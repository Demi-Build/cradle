mod data;

use data::{canon_world_root, DataSource, EntityRef, EntityRow, LocalFsDataSource, WorldSummary};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

struct AppState {
    source: Arc<dyn DataSource>,
}

fn canon(path: String) -> PathBuf {
    canon_world_root(&PathBuf::from(path))
}

#[tauri::command]
fn load_world(path: String, state: State<'_, AppState>) -> Result<WorldSummary, String> {
    let root = canon(path);
    let mut summary = state.source.load_world(&root)?;
    summary.path = root.to_string_lossy().to_string();
    Ok(summary)
}

#[tauri::command]
fn get_world_bible(path: String, state: State<'_, AppState>) -> Result<Value, String> {
    state.source.get_world_bible(&canon(path))
}

#[tauri::command]
fn read_world_json(path: String, name: String, state: State<'_, AppState>) -> Result<Value, String> {
    state.source.read_world_json(&canon(path), &name)
}

#[tauri::command]
fn list_entities(path: String, type_id: String, state: State<'_, AppState>) -> Result<Vec<EntityRef>, String> {
    state.source.list_entities(&canon(path), &type_id)
}

#[tauri::command]
fn list_entity_rows(path: String, type_id: String, state: State<'_, AppState>) -> Result<Vec<EntityRow>, String> {
    state.source.list_entity_rows(&canon(path), &type_id)
}

#[tauri::command]
fn get_entity(path: String, type_id: String, id: String, state: State<'_, AppState>) -> Result<Value, String> {
    state.source.get_entity(&canon(path), &type_id, &id)
}

#[tauri::command]
fn resolve_asset(path: String, hint: String, state: State<'_, AppState>) -> Option<String> {
    state.source.resolve_asset(&canon(path), &hint)
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
            read_world_json,
            list_entities,
            list_entity_rows,
            get_entity,
            resolve_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
