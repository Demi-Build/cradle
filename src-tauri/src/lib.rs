mod data;

use data::{canon_world_root, DataSource, EntityRef, EntityRow, LocalFsDataSource, WorldSummary};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    source: Arc<dyn DataSource>,
}

/// One generation job for the serial background worker. `args` is the
/// fully-built canon CLI vector (env-file already appended for paid ops); `id`
/// is a frontend-generated uuid so `job-updated` events correlate to the
/// in-memory job holding the tray metadata.
struct QueuedJob {
    id: String,
    args: Vec<String>,
}

/// Serial job queue: gen commands push here and return immediately so the UI
/// never blocks on generation; a single worker thread (spawned in `.setup`)
/// runs them one at a time off the UI thread and emits `job-updated` events.
/// Serial by construction — one receiver, one worker.
struct JobQueue {
    tx: std::sync::Mutex<std::sync::mpsc::Sender<QueuedJob>>,
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

/// Scaffold a fresh platformer project via `canon world new` (the fake
/// pipeline — $0, no API keys), returning the created pack path for the
/// frontend to open. The pack dir is `<parent>/<slug(name)>`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn new_project(
    parent_dir: String,
    name: String,
    stages: Option<u32>,
    levels: Option<u32>,
    enemies: Option<u32>,
    items: Option<u32>,
    llm_backend: Option<String>,
    image_backend: Option<String>,
    music_backend: Option<String>,
    sfx_backend: Option<String>,
    vlm_backend: Option<String>,
) -> Result<Value, String> {
    let slug: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect();
    let slug = slug.trim_matches('_');
    let slug = if slug.is_empty() { "project" } else { slug };
    let out = std::path::Path::new(&parent_dir).join(slug);
    let mut args: Vec<String> = vec![
        "world".into(),
        "new".into(),
        out.to_string_lossy().into_owned(),
        "--name".into(),
        name,
    ];
    if let Some(s) = stages { args.push("--stages".into()); args.push(s.to_string()); }
    if let Some(l) = levels { args.push("--levels".into()); args.push(l.to_string()); }
    if let Some(e) = enemies { args.push("--enemies".into()); args.push(e.to_string()); }
    if let Some(i) = items { args.push("--items".into()); args.push(i.to_string()); }
    if let Some(b) = llm_backend { args.push("--llm-backend".into()); args.push(b); }
    if let Some(b) = image_backend { args.push("--image-backend".into()); args.push(b); }
    if let Some(b) = music_backend { args.push("--music-backend".into()); args.push(b); }
    if let Some(b) = sfx_backend { args.push("--sfx-backend".into()); args.push(b); }
    if let Some(b) = vlm_backend { args.push("--vlm-backend".into()); args.push(b); }
    // Paid backends read their keys from CANON_ENV_FILE (harmless when fake).
    run_canon_owned(with_env_file(args))
}

/// Regenerate an existing level's layout in place via `canon level regenerate`
/// (a flat draft becomes designed, or a level is redesigned). Paid path.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn regenerate_layout(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    level_id: String,
    brief: String,
    difficulty: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
    axis: Option<String>,
    seed: Option<String>,
    llm_backend: Option<String>,
    system_override: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "regenerate".into(), root,
        "--level".into(), level_id, "--brief".into(), brief,
        "--actor".into(), "cradle:user".into(),
    ];
    if let Some(d) = difficulty { args.push("--difficulty".into()); args.push(d.to_string()); }
    if let Some(w) = width { args.push("--width".into()); args.push(w.to_string()); }
    if let Some(h) = height { args.push("--height".into()); args.push(h.to_string()); }
    if let Some(a) = axis { args.push("--axis".into()); args.push(a); }
    if let Some(s) = seed { if !s.is_empty() { args.push("--seed".into()); args.push(s); } }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    let args = with_prompt_override(args, "--system-prompt", system_override);
    enqueue(&app, &queue, job_id, with_env_file(args))
}

/// Context-aware IMPROVE via `canon level improve`: the layout LLM SEES the
/// current level (its terrain serialized to text) + an `instruction` and
/// re-authors it in place, keeping dims/axis. Unlike `regenerate_layout` it is
/// not blind and does NOT clear placements (kept by default; `reroll_placements`
/// re-adapts them). `fix_problems` also feeds the level's validation problems to
/// the model. Paid path — `with_env_file` threads keys for `anthropic`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn improve_layout(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    level_id: String,
    instruction: String,
    fix_problems: bool,
    reroll_placements: bool,
    seed: Option<String>,
    llm_backend: Option<String>,
    system_override: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "improve".into(), root,
        "--level".into(), level_id, "--instruction".into(), instruction,
        "--actor".into(), "cradle:user".into(),
    ];
    if fix_problems { args.push("--fix-problems".into()); }
    if reroll_placements { args.push("--reroll-placements".into()); }
    if let Some(s) = seed { if !s.is_empty() { args.push("--seed".into()); args.push(s); } }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    let args = with_prompt_override(args, "--system-prompt", system_override);
    enqueue(&app, &queue, job_id, with_env_file(args))
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

/// Generate a whole draft level (terrain + enemies + items) via
/// `canon level generate`. Paid path — `with_env_file` threads provider keys
/// for `--llm-backend anthropic`; `fake` is $0. Lands a DRAFT (publish stays
/// separate).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn generate_level(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    stage_id: String,
    brief: String,
    difficulty: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
    axis: Option<String>,
    enemies: Option<u32>,
    items: Option<u32>,
    seed: Option<String>,
    llm_backend: Option<String>,
    system_override: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "generate".into(), root,
        "--stage".into(), stage_id, "--brief".into(), brief,
        "--actor".into(), "cradle:user".into(),
    ];
    if let Some(d) = difficulty { args.push("--difficulty".into()); args.push(d.to_string()); }
    if let Some(w) = width { args.push("--width".into()); args.push(w.to_string()); }
    if let Some(h) = height { args.push("--height".into()); args.push(h.to_string()); }
    if let Some(a) = axis { args.push("--axis".into()); args.push(a); }
    if let Some(e) = enemies { args.push("--enemies".into()); args.push(e.to_string()); }
    if let Some(i) = items { args.push("--items".into()); args.push(i.to_string()); }
    if let Some(s) = seed { if !s.is_empty() { args.push("--seed".into()); args.push(s); } }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    let args = with_prompt_override(args, "--system-prompt", system_override);
    enqueue(&app, &queue, job_id, with_env_file(args))
}

/// Generate ONE music track for a level (or one of its user music sections)
/// via `canon level music generate` — Lyria is paid (GOOGLE_API_KEY reaches it
/// through CANON_ENV_FILE), fake is $0. Returns the actual cost block.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn generate_level_music(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    level_id: String,
    brief: Option<String>,
    section: Option<u32>,
    music_backend: Option<String>,
    seconds: Option<u32>,
    prompt_override: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "music".into(), "generate".into(), root,
        "--level".into(), level_id,
        "--brief".into(), brief.unwrap_or_default(),
        "--music-backend".into(), music_backend.unwrap_or_else(|| "fake".into()),
        "--actor".into(), "cradle:user".into(),
    ];
    if let Some(s) = section { args.push("--section".into()); args.push(s.to_string()); }
    if let Some(sec) = seconds { args.push("--seconds".into()); args.push(sec.to_string()); }
    let args = with_prompt_override(args, "--prompt", prompt_override);
    enqueue(&app, &queue, job_id, with_env_file(args))
}

/// List the pack's existing music tracks (for the 'assign a track' dropdown).
/// Read-only.
#[tauri::command]
fn list_music_tracks(path: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["level", "music", "list", &root])
}

/// Place enemies onto an existing level via `canon level place-enemies`
/// (works on generated OR hand-painted terrain). Paid path.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn place_enemies(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    level_id: String,
    enemies: Option<u32>,
    seed: Option<String>,
    llm_backend: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "place-enemies".into(), root,
        "--level".into(), level_id, "--actor".into(), "cradle:user".into(),
    ];
    if let Some(e) = enemies { args.push("--enemies".into()); args.push(e.to_string()); }
    if let Some(s) = seed { if !s.is_empty() { args.push("--seed".into()); args.push(s); } }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    enqueue(&app, &queue, job_id, with_env_file(args))
}

/// Place items onto an existing level via `canon level place-items`. Paid path.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn place_items(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    level_id: String,
    items: Option<u32>,
    seed: Option<String>,
    llm_backend: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "place-items".into(), root,
        "--level".into(), level_id, "--actor".into(), "cradle:user".into(),
    ];
    if let Some(i) = items { args.push("--items".into()); args.push(i.to_string()); }
    if let Some(s) = seed { if !s.is_empty() { args.push("--seed".into()); args.push(s); } }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    enqueue(&app, &queue, job_id, with_env_file(args))
}

/// Append `--flag <value>` when the UI actually supplied one. An absent or
/// blank value adds nothing, so canon's own default applies — which is what a
/// cleared free-text field (a model name, say) has to mean: passing `--model ""`
/// would ask the provider for a model literally named "".
///
/// The value is forwarded verbatim: the prompt-override contract is byte-for-byte
/// ("what you saw in the textarea is what the generator got"), so this must not
/// reshape it. Callers that want whitespace tidied do it at the field.
fn with_opt(mut args: Vec<String>, flag: &str, value: Option<String>) -> Vec<String> {
    if let Some(text) = value {
        if !text.trim().is_empty() {
            args.push(flag.into());
            args.push(text);
        }
    }
    args
}

/// Append a per-call prompt override (`--system-prompt` for LLM verbs,
/// `--prompt` for image/audio/vlm verbs) when the user edited it in the UI.
/// Same "blank means default" contract as every other optional flag.
fn with_prompt_override(args: Vec<String>, flag: &str, value: Option<String>) -> Vec<String> {
    with_opt(args, flag, value)
}

/// The provider-key file passed to canon's paid verbs. `CANON_ENV_FILE` wins;
/// otherwise fall back to `<canon repo>/.env`, which is where the keys live in
/// a normal two-repo checkout.
///
/// canon itself still never auto-reads a .env — it requires an explicit
/// `--env-file`, and that doctrine is unchanged. This is the HOST deciding
/// which file to hand it. Without the fallback, launching cradle the ordinary
/// way (`npm run tauri dev`) silently dropped every key, and paid generation
/// failed with a provider-level "needs FAL_KEY" that pointed nowhere near the
/// actual cause.
fn env_file_path() -> Option<String> {
    if let Ok(env_file) = std::env::var("CANON_ENV_FILE") {
        if !env_file.is_empty() {
            return Some(env_file);
        }
    }
    let candidate = canon_repo_root().ok()?.join(".env");
    if candidate.is_file() {
        return Some(candidate.to_string_lossy().to_string());
    }
    None
}

/// Append `--env-file <resolved>` so provider keys reach paid verbs.
fn with_env_file(mut args: Vec<String>) -> Vec<String> {
    if let Some(env_file) = env_file_path() {
        args.push("--env-file".into());
        args.push(env_file);
    }
    args
}

fn run_canon_owned(args: Vec<String>) -> Result<Value, String> {
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon(&refs)
}

/// Which provider keys cradle can actually hand to canon, and from where.
/// Returns key NAMES only — never values — so the UI can say "fal needs
/// FAL_KEY and I don't have it" before spending a confirm on a job that is
/// going to die at the provider.
#[tauri::command]
fn provider_keys() -> Value {
    let mut names: Vec<String> = Vec::new();
    // Anything already exported to cradle's own environment counts.
    for (k, v) in std::env::vars() {
        if !v.is_empty() && (k.ends_with("_API_KEY") || k.starts_with("FAL_KEY")) {
            names.push(k);
        }
    }
    let resolved = env_file_path();
    if let Some(ref path) = resolved {
        if let Ok(text) = std::fs::read_to_string(path) {
            for line in text.lines() {
                let line = line.trim().trim_start_matches("export ").trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    if !value.trim().trim_matches(['"', '\'']).is_empty() {
                        names.push(key.trim().to_string());
                    }
                }
            }
        }
    }
    names.sort();
    names.dedup();
    serde_json::json!({ "env_file": resolved, "keys": names })
}

/// Push a job onto the serial queue and emit its `queued` event, returning the
/// job id immediately — the generation runs on the worker thread so the UI
/// never blocks. `args` must already be fully built (env-file appended).
fn enqueue(
    app: &AppHandle,
    queue: &JobQueue,
    id: String,
    args: Vec<String>,
) -> Result<Value, String> {
    queue
        .tx
        .lock()
        .map_err(|e| format!("job queue lock poisoned: {e}"))?
        .send(QueuedJob { id: id.clone(), args })
        .map_err(|e| format!("job worker is gone: {e}"))?;
    let _ = app.emit("job-updated", serde_json::json!({ "id": id, "status": "queued" }));
    Ok(serde_json::json!({ "job_id": id, "status": "queued" }))
}

/// The serial worker loop (spawned once in `.setup`): runs each queued job to
/// completion — blocking is fine here, it's off the UI thread — and emits a
/// terminal `job-updated` carrying the canon result (or the error). Generalizes
/// `reap_and_notify` (detached spawn + AppHandle + emit) but CAPTURES the output.
fn run_job_worker(app: AppHandle, rx: std::sync::mpsc::Receiver<QueuedJob>) {
    for job in rx {
        let _ = app.emit(
            "job-updated",
            serde_json::json!({ "id": job.id, "status": "running" }),
        );
        let payload = match run_canon_owned(job.args) {
            Ok(result) => {
                serde_json::json!({ "id": job.id, "status": "done", "result": result })
            }
            Err(error) => {
                serde_json::json!({ "id": job.id, "status": "failed", "error": error })
            }
        };
        let _ = app.emit("job-updated", payload);
    }
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
    system_override: Option<String>,
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
        args = with_prompt_override(args, "--system-prompt", system_override);
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
    system_override: Option<String>,
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
    let args = with_prompt_override(args, "--system-prompt", system_override);
    run_canon_owned(with_env_file(args))
}

/// Resolve the canon repo checkout (for the pygame play harness): CANON_REPO
/// env wins; else derived from CANON_BIN when it points into `<repo>/.venv/bin/`.
fn canon_repo_root() -> Result<PathBuf, String> {
    if let Ok(repo) = std::env::var("CANON_REPO") {
        if !repo.is_empty() {
            return Ok(PathBuf::from(repo));
        }
    }
    let bin = std::env::var("CANON_BIN").map_err(|_| {
        "set CANON_BIN (or CANON_REPO) so cradle can find the play harness".to_string()
    })?;
    let p = PathBuf::from(&bin);
    p.parent() // bin/
        .and_then(|b| b.parent()) // .venv/
        .and_then(|v| v.parent()) // repo
        .map(|r| r.to_path_buf())
        .ok_or_else(|| format!("cannot derive the canon repo from CANON_BIN={bin}"))
}

/// Run a canon verb that imports `examples.*` (the platformer cost estimator
/// lives there). The `canon` console script can't resolve those modules, so
/// invoke `python -m canon.cli.main` with the repo checkout as cwd. Blocking +
/// JSON, same contract as run_canon. Estimate needs no provider keys.
fn run_canon_module(args: &[&str]) -> Result<Value, String> {
    let repo = canon_repo_root()?;
    let python = if cfg!(windows) {
        repo.join(".venv").join("Scripts").join("python.exe")
    } else {
        repo.join(".venv").join("bin").join("python")
    };
    if !python.is_file() {
        return Err(format!("python not found at {}", python.display()));
    }
    let output = std::process::Command::new(&python)
        .current_dir(&repo)
        .arg("-m")
        .arg("canon.cli.main")
        .args(args)
        .output()
        .map_err(|e| format!("failed to run python -m canon.cli.main: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "canon {} estimate failed: {}",
            args.first().unwrap_or(&""),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("parse canon output: {}", e))
}

/// Pre-run cost estimate for a NEW project (world scope) at these counts +
/// backends. Backend-aware (fake/none = $0) and count-aware. No API keys — it
/// is pure pricing math, so it runs even without CANON_ENV_FILE.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn estimate_world(
    stages: u32,
    levels: u32,
    enemies: u32,
    items: u32,
    llm_backend: String,
    image_backend: String,
    music_backend: String,
    sfx_backend: String,
    vlm_backend: String,
) -> Result<Value, String> {
    let (s, l, e, i) = (
        stages.to_string(),
        levels.to_string(),
        enemies.to_string(),
        items.to_string(),
    );
    run_canon_module(&[
        "world", "estimate", "--stages", &s, "--levels", &l, "--enemies", &e,
        "--items", &i, "--llm-backend", &llm_backend, "--image-backend",
        &image_backend, "--music-backend", &music_backend, "--sfx-backend",
        &sfx_backend, "--vlm-backend", &vlm_backend,
    ])
}

/// Pre-run cost estimate for ONE per-level op (generate|layout|enemies|items)
/// on an existing level. LLM-only; fake = $0.
#[tauri::command]
fn estimate_level(
    path: String,
    level_id: String,
    op: String,
    llm_backend: String,
    width: Option<u32>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(), "estimate".into(), root, "--level".into(), level_id,
        "--op".into(), op, "--llm-backend".into(), llm_backend,
    ];
    if let Some(w) = width {
        args.push("--width".into());
        args.push(w.to_string());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon_module(&refs)
}

/// Pre-run cost estimate for animating ONE actor. Priced by the actor's real
/// STATE set (canon reads the row: a hopper's extra `jump`, the player's own
/// six, an `asymmetric` second facing) — cradle can't compute that itself, so
/// it asks rather than guessing. fake = $0.
#[tauri::command]
fn estimate_animate(
    path: String,
    target: String,
    image_backend: String,
    vlm_backend: String,
    vlm_model: Option<String>,
    reuse_spec: bool,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "asset".into(), "estimate".into(), root, "--target".into(), target,
        "--op".into(), "animate".into(), "--image-backend".into(), image_backend,
        "--vlm-backend".into(), vlm_backend,
    ];
    args = with_opt(args, "--vlm-model", vlm_model);
    if reuse_spec {
        args.push("--reuse-spec".into());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon_module(&refs)
}

/// Append one paid-op spend entry to the pack's ledger (`canon spend record`) —
/// cradle records what each op it fired actually cost. Console-script path (the
/// spend verbs don't touch examples.*).
#[tauri::command]
fn spend_record(path: String, entry: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let entry_str = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    run_canon(&["spend", "record", &root, "--json", &entry_str])
}

/// The pack's spend ledger + roll-up for the cost dashboard (`canon spend list`).
#[tauri::command]
fn spend_list(path: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["spend", "list", &root])
}

/// The PLAT_* hooks turn the play surfaces into scripted/headless sessions
/// (capture, trajectory dumps, forced start level, plain rendering) — strip
/// them all so Play starts from a clean slate, then set only what we mean.
const PLAT_HOOK_VARS: [&str; 10] = [
    "PLAT_CAPTURE", "PLAT_TRAJ", "PLAT_HOLD", "PLAT_HOLD_JUMP_EVERY",
    "PLAT_ACTIONS", "PLAT_CAPTURE_TICKS", "PLAT_CAPTURE_EVERY", "PLAT_LEVEL",
    "PLAT_PLAIN", "PLAT_ANIM",
];

/// Reap the detached child (a dropped Child is never waited on → zombie)
/// and tell the frontend when the session ends so "playing…" notes clear.
fn reap_and_notify(app: AppHandle, mut child: std::process::Child, engine: &'static str) -> u32 {
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app.emit(
            "play-exited",
            serde_json::json!({ "pid": pid, "engine": engine }),
        );
    });
    pid
}

/// Launch the pygame play harness on ONE level, detached — the editor's
/// "how does this level feel" loop (exact physics parity with godot).
/// `plain` plays WITHOUT art: palette blocks + placeholder shapes.
/// `anim_target` (`enemy:<id>` | `item:<id>` | `player` | `all`) opens the
/// ANIMATION VIEWER instead of the level, so a sprite's states can be judged
/// in the same surface that renders the game.
#[tauri::command]
fn play_level(
    app: AppHandle,
    path: String,
    level_id: String,
    plain: Option<bool>,
    anim_target: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let repo = canon_repo_root()?;
    // Windows venvs put the interpreter at .venv\Scripts\python.exe; Unix at
    // .venv/bin/python. Resolve per-OS so ▶ Play works cross-platform.
    let python = if cfg!(windows) {
        repo.join(".venv").join("Scripts").join("python.exe")
    } else {
        repo.join(".venv").join("bin").join("python")
    };
    let script = repo.join("examples").join("platformer_play.py");
    if !python.is_file() {
        return Err(format!("python not found at {}", python.display()));
    }
    if !script.is_file() {
        return Err(format!("play harness not found at {}", script.display()));
    }
    let mut cmd = std::process::Command::new(&python);
    cmd.arg(&script)
        .arg(&root)
        .arg(&level_id)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for var in PLAT_HOOK_VARS {
        cmd.env_remove(var);
    }
    if plain.unwrap_or(false) {
        cmd.env("PLAT_PLAIN", "1");
    }
    let previewing = anim_target.as_deref().unwrap_or("").trim().to_string();
    if !previewing.is_empty() {
        cmd.env("PLAT_ANIM", &previewing);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch play harness: {e}"))?;
    let pid = reap_and_notify(app, child, "pygame");
    Ok(serde_json::json!({
        "launched": true,
        "engine": "pygame",
        "pid": pid,
        "mode": if previewing.is_empty() { "play" } else { "anim" },
    }))
}

/// Launch the FULL game (splash → world map → progression) in Godot,
/// detached. GODOT_BIN wins; falls back to `godot` on PATH, then the macOS
/// app bundle. Packs carry project.godot at their root.
#[tauri::command]
fn play_game(
    app: AppHandle,
    path: String,
    level_id: Option<String>,
    anim_target: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    // A pack generated without the godot engine has nothing to boot — say
    // so instead of "launching" godot into an error dialog.
    if !std::path::Path::new(&root).join("project.godot").is_file() {
        return Err(format!(
            "no project.godot in {root} — this pack was generated without the \
             godot engine; use ▶ Play on a level (pygame) instead"
        ));
    }
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(bin) = std::env::var("GODOT_BIN") {
        if !bin.is_empty() {
            candidates.push(bin);
        }
    }
    candidates.push("godot".to_string());
    candidates.push("/Applications/Godot.app/Contents/MacOS/Godot".to_string());

    let mut errs: Vec<String> = Vec::new();
    for bin in &candidates {
        let mut cmd = std::process::Command::new(bin);
        cmd.arg("--path")
            .arg(&root)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        for var in PLAT_HOOK_VARS {
            cmd.env_remove(var);
        }
        if let Some(ref lid) = level_id {
            // PLAT_LEVEL boots straight into one level, skipping splash/map.
            cmd.env("PLAT_LEVEL", lid);
        }
        let previewing = anim_target.as_deref().unwrap_or("").trim().to_string();
        if !previewing.is_empty() {
            // PLAT_ANIM opens the animation viewer instead of the game — the
            // Godot half of "watch it in both surfaces".
            cmd.env("PLAT_ANIM", &previewing);
        }
        match cmd.spawn() {
            Ok(child) => {
                let pid = reap_and_notify(app.clone(), child, "godot");
                return Ok(serde_json::json!({
                    "launched": true, "engine": "godot", "pid": pid,
                    "mode": if previewing.is_empty() { "play" } else { "anim" },
                }));
            }
            // Every candidate's failure matters — a broken GODOT_BIN is the
            // diagnostic the user actually needs, not the last fallback's.
            Err(e) => errs.push(format!("{bin}: {e}")),
        }
    }
    Err(format!(
        "godot not found ({}) — set GODOT_BIN or put godot on PATH. \
         Per-level playtesting (▶ Play on a level) uses the built-in pygame harness instead.",
        errs.join("; ")
    ))
}

/// Run generation's real validation suite on one level via `canon level validate`.
#[tauri::command]
fn validate_level(path: String, level_id: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["level", "validate", &root, "--level", &level_id])
}

/// The DEFAULT prompt a generator would send, via `canon prompt show` — what
/// the "✎ Edit prompt" expander fills its textarea with. Pure read (no LLM
/// call, no cost, no journal), so it stays synchronous instead of queued.
#[tauri::command]
fn preview_prompt(
    path: String,
    kind: String,
    level_id: Option<String>,
    target: Option<String>,
    instruction: Option<String>,
    brief: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "prompt".into(), "show".into(), root, "--kind".into(), kind,
    ];
    if let Some(l) = level_id { if !l.is_empty() { args.push("--level".into()); args.push(l); } }
    if let Some(t) = target { if !t.is_empty() { args.push("--target".into()); args.push(t); } }
    if let Some(i) = instruction { if !i.is_empty() { args.push("--instruction".into()); args.push(i); } }
    if let Some(b) = brief { if !b.is_empty() { args.push("--brief".into()); args.push(b); } }
    run_canon_owned(args)
}

/// The artifact's family tree (journal + CAS) via `canon asset lineage`.
#[tauri::command]
fn asset_lineage(path: String, target: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["asset", "lineage", &root, "--target", &target])
}

/// Make a historic version current again via `canon asset restore`.
#[tauri::command]
fn asset_restore(path: String, target: String, to: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&[
        "asset", "restore", &root, "--target", &target, "--to", &to,
        "--actor", "cradle:user",
    ])
}

/// Fetch a stored version's bytes (base64) via `canon object cat` — history
/// thumbnails live only in the object store.
#[tauri::command]
fn object_cat(path: String, hash: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["object", "cat", &root, &hash])
}

/// Browse the GLOBAL asset library index via `canon library list`.
#[tauri::command]
fn library_list(
    kind: Option<String>,
    query: Option<String>,
    project: Option<String>,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec!["library".into(), "list".into()];
    if let Some(k) = kind.filter(|s| !s.is_empty()) {
        args.push("--kind".into());
        args.push(k);
    }
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        args.push("--query".into());
        args.push(q);
    }
    if let Some(p) = project.filter(|s| !s.is_empty()) {
        args.push("--project".into());
        args.push(p);
    }
    run_canon_owned(args)
}

/// Publish an asset into the global library via `canon library publish`.
#[tauri::command]
fn library_publish(path: String, target: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&[
        "library", "publish", &root, "--target", &target,
        "--actor", "cradle:user",
    ])
}

/// Import a library entry into the open pack via `canon library import`.
#[tauri::command]
fn library_import(
    path: String,
    id: String,
    into: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "library".into(), "import".into(), root, "--id".into(), id,
        "--actor".into(), "cradle:user".into(),
    ];
    if let Some(i) = into.filter(|s| !s.is_empty()) {
        args.push("--into".into());
        args.push(i);
    }
    run_canon_owned(args)
}

/// Library object bytes (previews) via `canon library cat`.
#[tauri::command]
fn library_cat(hash: String) -> Result<Value, String> {
    run_canon(&["library", "cat", &hash])
}

/// Copy one row's art bundle onto another via `canon asset assign`.
#[tauri::command]
fn asset_assign(path: String, source: String, to: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&[
        "asset", "assign", &root, "--source", &source, "--to", &to,
        "--actor", "cradle:user",
    ])
}

/// Direct human edit of an existing DB row (or tile type's gameplay knobs)
/// via `canon db update` — values land verbatim; canon rehashes, stamps
/// user_edited, and journals op=edit with the field diff.
#[tauri::command]
fn db_update(
    path: String,
    entity_type: String,
    id: String,
    set: Value,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let set_str = serde_json::to_string(&set).map_err(|e| e.to_string())?;
    run_canon(&[
        "db", "update", &root, "--type", &entity_type, "--id", &id,
        "--set", &set_str, "--actor", "cradle:user",
    ])
}

/// The effective roll-table schema for one entity type via `canon db schema`.
#[tauri::command]
fn db_schema(path: String, entity_type: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["db", "schema", &root, "--type", &entity_type])
}

/// Edit roll tables (validated fail-closed canon-side; lands as a pack-local
/// override) via `canon db schema --set`.
#[tauri::command]
fn db_update_schema(
    path: String,
    entity_type: String,
    set: Value,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let set_str = serde_json::to_string(&set).map_err(|e| e.to_string())?;
    run_canon(&[
        "db", "schema", &root, "--type", &entity_type,
        "--set", &set_str, "--actor", "cradle:user",
    ])
}

/// (Re)generate one asset (sprite/backdrop/audio) via `canon asset generate`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn generate_asset(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    target: String,
    image_backend: Option<String>,
    image_model: Option<String>,
    image_edit_model: Option<String>,
    image_edit_backend: Option<String>,
    music_backend: Option<String>,
    sfx_backend: Option<String>,
    prompt_override: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "asset".into(), "generate".into(), root, "--target".into(), target,
        "--actor".into(), "cradle:user".into(),
    ];
    // Every flag `canon asset generate` takes, not just the backend names: a
    // dropped --image-model silently pinned every paid run to the backend's
    // built-in default, with no way to say so from the UI.
    args = with_opt(args, "--image-backend", image_backend);
    args = with_opt(args, "--image-model", image_model);
    args = with_opt(args, "--image-edit-model", image_edit_model);
    args = with_opt(args, "--image-edit-backend", image_edit_backend);
    args = with_opt(args, "--music-backend", music_backend);
    args = with_opt(args, "--sfx-backend", sfx_backend);
    let args = with_prompt_override(args, "--prompt", prompt_override);
    enqueue(&app, &queue, job_id, with_env_file(args))
}

/// Animate one actor (multi-image path) via `canon asset animate`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn animate_asset(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    path: String,
    target: String,
    image_backend: Option<String>,
    image_model: Option<String>,
    image_edit_model: Option<String>,
    image_edit_backend: Option<String>,
    vlm_backend: Option<String>,
    vlm_model: Option<String>,
    reuse_spec: bool,
    prompt_override: Option<String>,
    job_id: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "asset".into(), "animate".into(), root, "--target".into(), target,
        "--actor".into(), "cradle:user".into(),
    ];
    // canon's animate has been fully parameterized for a while; cradle was
    // forwarding 2 of the 7 knobs, so the edit model and the VLM model were
    // unreachable from the editor no matter what the user picked.
    args = with_opt(args, "--image-backend", image_backend);
    args = with_opt(args, "--image-model", image_model);
    args = with_opt(args, "--image-edit-model", image_edit_model);
    args = with_opt(args, "--image-edit-backend", image_edit_backend);
    args = with_opt(args, "--vlm-backend", vlm_backend);
    args = with_opt(args, "--vlm-model", vlm_model);
    if reuse_spec {
        args.push("--reuse-spec".into());
    }
    // The motion-spec authoring prompt (`canon prompt show --kind animate`).
    let args = with_prompt_override(args, "--prompt", prompt_override);
    enqueue(&app, &queue, job_id, with_env_file(args))
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
        .setup(|app| {
            // Serial generation queue: one worker thread drains jobs FIFO so paid
            // ops run off the UI thread. The Sender lives in managed state (app
            // lifetime), so the worker loop never ends until the app exits.
            let (tx, rx) = std::sync::mpsc::channel::<QueuedJob>();
            app.manage(JobQueue {
                tx: std::sync::Mutex::new(tx),
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || run_job_worker(handle, rx));
            Ok(())
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
            db_update,
            db_schema,
            db_update_schema,
            play_level,
            play_game,
            validate_level,
            preview_prompt,
            provider_keys,
            asset_lineage,
            asset_restore,
            object_cat,
            library_list,
            library_publish,
            library_import,
            library_cat,
            asset_assign,
            generate_asset,
            animate_asset,
            create_level,
            new_project,
            regenerate_layout,
            improve_layout,
            generate_level,
            place_enemies,
            place_items,
            generate_level_music,
            list_music_tracks,
            publish_level,
            baseline_level,
            estimate_world,
            estimate_level,
            estimate_animate,
            spend_record,
            spend_list,
            get_bundled_demo_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
