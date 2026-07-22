mod data;

use data::{canon_world_root, DataSource, EntityRef, EntityRow, LocalFsDataSource, WorldSummary};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

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
fn read_world_json(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state.source.read_world_json(&canon(path), &name)
}

#[tauri::command]
fn list_entities(
    path: String,
    type_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<EntityRef>, String> {
    state.source.list_entities(&canon(path), &type_id)
}

#[tauri::command]
fn list_entity_rows(
    path: String,
    type_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<EntityRow>, String> {
    state.source.list_entity_rows(&canon(path), &type_id)
}

#[tauri::command]
fn get_entity(
    path: String,
    type_id: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state.source.get_entity(&canon(path), &type_id, &id)
}

#[tauri::command]
fn resolve_asset(path: String, hint: String, state: State<'_, AppState>) -> Option<String> {
    state.source.resolve_asset(&canon(path), &hint)
}

/// Render-ready JSON bundle for one platformer level.
///
/// Shells out to canon's `level export` verb (native subprocess — not routed
/// through the Tauri shell plugin) so cradle never has to decode canon's binary
/// `.npz` grids itself. The canon binary is resolved from the `CANON_BIN` env
/// var, falling back to `canon` on PATH.
#[tauri::command]
fn export_level(path: String, level_id: String) -> Result<Value, String> {
    let root = canon(path);
    let canon_bin = std::env::var("CANON_BIN").unwrap_or_else(|_| "canon".to_string());
    let output = std::process::Command::new(&canon_bin)
        .args(["level", "export"])
        .arg(root.as_os_str())
        .args(["--level", &level_id])
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon_bin, e))?;
    if !output.status.success() {
        return Err(format!(
            "canon level export failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let parsed: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("parse canon output: {}", e))?;
    // Verb wraps the bundle as {"canon_version": ..., "level": {...}}.
    Ok(parsed.get("level").cloned().unwrap_or(parsed))
}

/// Persist a sparse-layer hand-edit (moved enemy/item/door/spawn/exit) by
/// shelling out to `canon level apply-edit`. Canon rewrites the layer files,
/// recomputes hashes, updates level.json, and stamps the level `user_edited`.
#[tauri::command]
fn save_level_edit(path: String, level_id: String, edit: Value) -> Result<Value, String> {
    let root = canon(path);
    let canon_bin = std::env::var("CANON_BIN").unwrap_or_else(|_| "canon".to_string());
    let edit_str = serde_json::to_string(&edit).map_err(|e| e.to_string())?;
    let output = std::process::Command::new(&canon_bin)
        .args(["level", "apply-edit"])
        .arg(root.as_os_str())
        .args(["--level", &level_id, "--json", &edit_str, "--actor", "cradle:user"])
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon_bin, e))?;
    if !output.status.success() {
        return Err(format!(
            "canon level apply-edit failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("parse canon output: {}", e))
}

/// Shared canon-CLI runner for the level verbs.
fn run_canon(args: &[&str]) -> Result<Value, String> {
    let canon_bin = std::env::var("CANON_BIN").unwrap_or_else(|_| "canon".to_string());
    let output = std::process::Command::new(&canon_bin)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon_bin, e))?;
    if !output.status.success() {
        return Err(format!(
            "canon {} failed: {}",
            args.get(1).unwrap_or(&""),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("parse canon output: {}", e))
}

/// Persist a painted/resized collision grid via `canon level import-grids`
/// (terrain/background/hazards re-derived canon-side, journaled).
#[tauri::command]
fn save_level_grids(path: String, level_id: String, collision: Value) -> Result<Value, String> {
    let root = canon(path);
    let payload = serde_json::to_string(&serde_json::json!({ "collision": collision }))
        .map_err(|e| e.to_string())?;
    let root_s = root.to_string_lossy().to_string();
    run_canon(&[
        "level", "import-grids", &root_s, "--level", &level_id, "--json", &payload,
        "--actor", "cradle:user",
    ])
}

/// Scaffold a new hand-built draft level via `canon level create`.
#[tauri::command]
fn create_level(path: String, stage_id: String, width: u32, height: u32) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let (w, h) = (width.to_string(), height.to_string());
    run_canon(&[
        "level", "create", &root, "--stage", &stage_id, "--width", &w, "--height", &h,
        "--actor", "cradle:user",
    ])
}

/// Insert a level into (or remove it from) the progression via `canon level publish`.
#[tauri::command]
fn publish_level(
    path: String,
    level_id: String,
    position: Option<u32>,
    remove: bool,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "publish".into(), root, "--level".into(), level_id,
        "--actor".into(), "cradle:user".into(),
    ];
    if let Some(p) = position {
        args.push("--position".into());
        args.push(p.to_string());
    }
    if remove {
        args.push("--remove".into());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon(&arg_refs)
}

/// Append `--env-file $CANON_ENV_FILE` when the host was launched with one —
/// canon never auto-reads .env; this is how provider keys reach paid verbs.
fn with_env_file(mut args: Vec<String>) -> Vec<String> {
    if let Ok(env_file) = std::env::var("CANON_ENV_FILE") {
        if !env_file.is_empty() {
            args.push("--env-file".into());
            args.push(env_file);
        }
    }
    args
}

fn run_canon_owned(args: Vec<String>) -> Result<Value, String> {
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon(&refs)
}

/// The generic DB registry (entity types + field specs) for form UIs.
#[tauri::command]
fn db_types(path: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["db", "types", &root])
}

/// Create one anchored DB row (user fields locked; skeleton rolls the rest;
/// optional LLM completion) via `canon db new`.
#[tauri::command]
fn db_new(
    path: String,
    entity_type: String,
    fields: Value,
    complete: bool,
    llm_backend: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let fields_str = serde_json::to_string(&fields).map_err(|e| e.to_string())?;
    let mut args: Vec<String> = vec![
        "db".into(), "new".into(), root, "--type".into(), entity_type,
        "--fields".into(), fields_str, "--actor".into(), "cradle:user".into(),
    ];
    if complete {
        args.push("--complete".into());
        args.push("--llm-backend".into());
        args.push(llm_backend.unwrap_or_else(|| "anthropic".into()));
    }
    run_canon_owned(with_env_file(args))
}

/// LLM-complete an existing row (locked fields preserved) via `canon db complete`.
#[tauri::command]
fn db_complete(
    path: String,
    entity_type: String,
    id: String,
    locked: Vec<String>,
    llm_backend: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "db".into(), "complete".into(), root, "--type".into(), entity_type,
        "--id".into(), id, "--llm-backend".into(),
        llm_backend.unwrap_or_else(|| "anthropic".into()),
        "--actor".into(), "cradle:user".into(),
    ];
    if !locked.is_empty() {
        args.push("--locked".into());
        args.push(locked.join(","));
    }
    run_canon_owned(with_env_file(args))
}

/// (Re)generate one asset (sprite/backdrop/audio) via `canon asset generate`.
#[tauri::command]
fn generate_asset(
    path: String,
    target: String,
    image_backend: Option<String>,
    music_backend: Option<String>,
    sfx_backend: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "asset".into(), "generate".into(), root, "--target".into(), target,
        "--actor".into(), "cradle:user".into(),
    ];
    if let Some(b) = image_backend {
        args.push("--image-backend".into());
        args.push(b);
    }
    if let Some(b) = music_backend {
        args.push("--music-backend".into());
        args.push(b);
    }
    if let Some(b) = sfx_backend {
        args.push("--sfx-backend".into());
        args.push(b);
    }
    run_canon_owned(with_env_file(args))
}

/// Animate one actor (multi-image path) via `canon asset animate`.
#[tauri::command]
fn animate_asset(
    path: String,
    target: String,
    image_backend: Option<String>,
    vlm_backend: Option<String>,
    reuse_spec: bool,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "asset".into(), "animate".into(), root, "--target".into(), target,
        "--actor".into(), "cradle:user".into(),
    ];
    if let Some(b) = image_backend {
        args.push("--image-backend".into());
        args.push(b);
    }
    if let Some(b) = vlm_backend {
        args.push("--vlm-backend".into());
        args.push(b);
    }
    if reuse_spec {
        args.push("--reuse-spec".into());
    }
    run_canon_owned(with_env_file(args))
}

/// Replace an asset's bytes with a user-picked PNG via `canon asset replace`
/// (rehash + regen protection + `op:"import"` journal, canon-side).
#[tauri::command]
fn replace_asset(path: String, target: String, file: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&[
        "asset", "replace", &root, "--target", &target, "--from", &file,
        "--actor", "cradle:user",
    ])
}

/// Record `generate` provenance events for a level's as-generated artifacts
/// (called when cradle imports a fresh generation). Idempotent server-side.
#[tauri::command]
fn baseline_level(path: String, level_id: String) -> Result<Value, String> {
    let root = canon(path);
    let canon_bin = std::env::var("CANON_BIN").unwrap_or_else(|_| "canon".to_string());
    let output = std::process::Command::new(&canon_bin)
        .args(["level", "baseline"])
        .arg(root.as_os_str())
        .args(["--level", &level_id, "--actor", "cradle"])
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon_bin, e))?;
    if !output.status.success() {
        return Err(format!(
            "canon level baseline failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("parse canon output: {}", e))
}

#[tauri::command]
fn get_bundled_demo_path(app: AppHandle) -> Result<String, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let demo = resource_dir.join("demo");
    if demo.is_dir() {
        Ok(demo.to_string_lossy().into_owned())
    } else {
        Err(format!("bundled demo not found at {}", demo.display()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            source: Arc::new(LocalFsDataSource),
        })
        .invoke_handler(tauri::generate_handler![
            load_world,
            get_world_bible,
            read_world_json,
            list_entities,
            list_entity_rows,
            get_entity,
            resolve_asset,
            export_level,
            save_level_edit,
            save_level_grids,
            replace_asset,
            db_types,
            db_new,
            db_complete,
            generate_asset,
            animate_asset,
            create_level,
            publish_level,
            baseline_level,
            get_bundled_demo_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
