mod data;
mod keys;

use data::{canon_world_root, DataSource, EntityRef, EntityRow, LocalFsDataSource, WorldSummary};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    source: Arc<dyn DataSource>,
}

// ===========================================================================
// Row P1-A5 — the agent sidecar (`canon agent serve`) lifecycle.
//
// Cradle spawns the service the way it spawns the play harness (the
// `play_level` + `reap_and_notify` precedent): one child, detached from the
// UI thread, its lifetime owned here. The one-line port handoff — the
// FIRST stdout line is `{"port": N, "pid": P}` — is the whole contract; the
// webview then talks to `127.0.0.1:<port>` directly over HTTP+SSE
// (`src/lib/agent.ts`; tauri.conf.json has `csp: null`). The service is
// started with `--parent-pid <cradle pid>` so it dies with cradle even if
// this module never gets to say goodbye; `agent_stop` and the app's exit
// hook say goodbye anyway (POST /shutdown, then reap).
//
// The port is per-process state, never persisted (I5/I8). Provider keys
// reach the child from the same env file `provider_keys` reads — the real
// key sources the missing-key copy names (Appendix I deviation 2).
//
// Deliberately absent, by row ownership: the JobQueue's Child retention and
// `cancel_job` (A4.5 — its map lives beside `JobQueue`, not here); play
// sessions' kill/registry (W2.0 extends A4.5's path, not this one).
// ===========================================================================

/// One running sidecar. `stderr` and `exit_code` are shared with the drain
/// and supervisor threads so the frontend's failure copy can quote them.
struct SidecarProc {
    child: std::process::Child,
    port: u16,
    pid: u32,
    pack: String,
    command: String,
    stderr: Arc<std::sync::Mutex<Vec<String>>>,
    exit_code: Arc<std::sync::Mutex<Option<i32>>>,
}

/// Managed state: at most one sidecar per cradle process (one open pack).
#[derive(Default)]
struct AgentSidecar {
    current: std::sync::Mutex<Option<SidecarProc>>,
}

/// How long `agent_start` waits for the port line before declaring the
/// service dead on arrival (README §3 "Nothing answered after 10 seconds").
const SIDECAR_PORT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
/// How long `agent_stop` waits after POST /shutdown before killing.
const SIDECAR_SHUTDOWN_GRACE: std::time::Duration = std::time::Duration::from_secs(3);
/// Lines of stderr kept for the failure copy (a ring, oldest dropped).
const SIDECAR_STDERR_KEEP: usize = 200;

/// Parse the sidecar's first stdout line. Pure so it is unit-testable.
fn parse_port_line(line: &str) -> Result<(u16, u32), String> {
    let v: Value = serde_json::from_str(line.trim())
        .map_err(|e| format!("the service's first line was not JSON ({e}): {line:?}"))?;
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        return Err(format!("the service refused to start: {err}"));
    }
    let port = v
        .get("port")
        .and_then(Value::as_u64)
        .filter(|p| *p > 0 && *p <= u16::MAX as u64)
        .ok_or_else(|| format!("the service's first line carried no port: {line:?}"))?;
    let pid = v.get("pid").and_then(Value::as_u64).unwrap_or(0);
    Ok((port as u16, pid as u32))
}

/// **THE ONE PLACE cradle builds a child's provider environment** (row P0-12 /
/// W3.4).
///
/// Before this row there were two: canon verbs got `--env-file` and the agent
/// sidecar got `env_file_pairs()` inline, so "which keys does a child see?" had
/// two answers and the keychain would have needed three implementations. Now
/// every CANON CHILD — the verbs through `CanonCommand::command`, which the
/// agent sidecar and the startup probe also go through, plus the pygame play
/// harness — calls this.
///
/// Non-goal, deliberately: the **Godot launch does not**. Godot is an engine,
/// not a canon child, and it has no business holding a provider secret; the
/// omission is restated at that spawn site so neither place drifts.
///
/// Precedence, lowest first:
///
/// 1. the resolved env file's pairs, for names cradle's own environment lacks
///    (the dev two-repo checkout's `.env`, unchanged);
/// 2. cradle's own inherited environment (a developer's exported key);
/// 3. **the keychain**, which overrides both — a key the user added in Settings
///    is the most explicit statement of intent on the machine, and canon's
///    `os.environ.setdefault` means the child's environment beats any env file
///    it is also handed.
///
/// Values pass from the store straight into the child; nothing here logs,
/// stores, or returns one.
fn apply_provider_env(cmd: &mut std::process::Command) {
    apply_provider_env_from(cmd, &keys::KeyStore::app(), env_file_pairs());
}

/// `apply_provider_env` over explicit inputs, so the precedence is testable
/// without a keychain, an env file, or a mutated process environment.
fn apply_provider_env_from(
    cmd: &mut std::process::Command,
    store: &keys::KeyStore,
    env_file: Vec<(String, String)>,
) {
    for (k, v) in env_file {
        cmd.env(k, v);
    }
    for (k, v) in store.all() {
        cmd.env(k, v);
    }
}

/// KEY=VALUE pairs of the env file `provider_keys` resolves — the keys the
/// service's providers read. Only names not already in cradle's own env.
fn env_file_pairs() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Some(path) = env_file_path() else {
        return out;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return out;
    };
    for line in text.lines() {
        let line = line.trim().trim_start_matches("export ").trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches(['"', '\'']);
            if !key.is_empty() && !value.is_empty() && std::env::var_os(key).is_none() {
                out.push((key.to_string(), value.to_string()));
            }
        }
    }
    out
}

/// A dependency-free `POST <path>` to the loopback service (std only — no
/// HTTP client crate for one request). Best-effort: errors are the caller's
/// cue to kill instead.
fn post_localhost(port: u16, path: &str) -> std::io::Result<()> {
    use std::io::{Read, Write};
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let mut s = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(800))?;
    s.set_read_timeout(Some(std::time::Duration::from_millis(800)))?;
    write!(
        s,
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
         Content-Length: 2\r\nConnection: close\r\n\r\n{{}}"
    )?;
    let mut buf = [0u8; 512];
    let _ = s.read(&mut buf);
    Ok(())
}

/// Stop `proc_` politely, then firmly. Returns once the child is reaped.
fn stop_sidecar(mut proc_: SidecarProc) {
    let _ = post_localhost(proc_.port, "/shutdown");
    let deadline = std::time::Instant::now() + SIDECAR_SHUTDOWN_GRACE;
    loop {
        match proc_.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            _ => break,
        }
    }
    let _ = proc_.child.kill();
    let _ = proc_.child.wait();
}

fn sidecar_status_json(proc_: Option<&SidecarProc>) -> Value {
    match proc_ {
        None => serde_json::json!({
            "running": false, "port": null, "pid": null, "pack": null, "exit_code": null, "stderr": []
        }),
        Some(p) => {
            let code = *p.exit_code.lock().unwrap_or_else(|e| e.into_inner());
            let stderr = p.stderr.lock().unwrap_or_else(|e| e.into_inner()).clone();
            serde_json::json!({
                "running": code.is_none(),
                "port": p.port,
                "pid": p.pid,
                "pack": p.pack,
                "command": p.command,
                "exit_code": code,
                "stderr": stderr,
            })
        }
    }
}

/// Spawn (or reuse) the sidecar for `pack` and answer its port. A sidecar
/// already running for the same pack is reused (`reused: true`); one for
/// another pack is stopped first. Failure to get a port line within the
/// timeout is a named error carrying the command and the stderr tail.
#[tauri::command]
fn agent_start(
    app: AppHandle,
    state: State<'_, AgentSidecar>,
    pack: String,
    backend: Option<String>,
    model: Option<String>,
) -> Result<Value, String> {
    let mut slot = state
        .current
        .lock()
        .map_err(|e| format!("agent sidecar lock poisoned: {e}"))?;
    if let Some(p) = slot.as_mut() {
        let alive = matches!(p.child.try_wait(), Ok(None));
        if alive && p.pack == pack {
            return Ok(serde_json::json!({
                "port": p.port, "pid": p.pid, "command": p.command, "reused": true
            }));
        }
        if let Some(old) = slot.take() {
            stop_sidecar(old);
        }
    }
    // Row P0-11: the sidecar resolves through the ONE resolver too — a
    // bundled app has no `canon` on PATH, and the agent panel is dead without
    // a service.
    let canon = canon_command();
    let parent = std::process::id().to_string();
    let mut argv: Vec<String> = vec![
        "agent".into(),
        "serve".into(),
        "--pack".into(),
        pack.clone(),
        "--port".into(),
        "0".into(),
        "--parent-pid".into(),
        parent,
    ];
    if let Some(b) = backend.as_deref().filter(|b| !b.trim().is_empty()) {
        argv.push("--backend".into());
        argv.push(b.to_string());
    }
    if let Some(m) = model.as_deref().filter(|m| !m.trim().is_empty()) {
        argv.push("--model".into());
        argv.push(m.to_string());
    }
    let command = format!("{} {}", canon.display(), argv.join(" "));
    let mut cmd = canon.command();
    cmd.args(&argv)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // The sidecar's provider keys used to be assembled here, from the env file
    // alone. Row P0-12 unified that: `canon.command()` already applied
    // `apply_provider_env`, so the service sees the SAME environment every
    // other canon child sees — including the chat-provider keys the panel's
    // real backends need.
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch `{command}`: {e}"))?;
    let stderr_buf: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let exit_code: Arc<std::sync::Mutex<Option<i32>>> = Arc::new(std::sync::Mutex::new(None));

    // Drain stderr for the failure copy (and so the child never blocks on a
    // full pipe).
    if let Some(err) = child.stderr.take() {
        let buf = stderr_buf.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                let mut b = buf.lock().unwrap_or_else(|e| e.into_inner());
                if b.len() >= SIDECAR_STDERR_KEEP {
                    b.remove(0);
                }
                b.push(line);
            }
        });
    }
    // The port line, read on its own thread so a silent child cannot hang
    // the command: `recv_timeout` is the 10 s promise the failure copy makes.
    let (tx, rx) = std::sync::mpsc::channel::<std::io::Result<String>>();
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            use std::io::BufRead;
            let mut reader = std::io::BufReader::new(out);
            let mut line = String::new();
            let res = reader.read_line(&mut line).map(|_| line);
            let _ = tx.send(res);
            // Keep draining so later stdout never blocks the child.
            for _ in reader.lines() {}
        });
    }
    let line = match rx.recv_timeout(SIDECAR_PORT_TIMEOUT) {
        Ok(Ok(line)) if !line.trim().is_empty() => line,
        other => {
            let _ = child.kill();
            let _ = child.wait();
            let tail = stderr_buf.lock().unwrap_or_else(|e| e.into_inner()).join("\n");
            let why = match other {
                Ok(Ok(_)) => "the service exited before printing its port".to_string(),
                Ok(Err(e)) => format!("could not read the service's stdout: {e}"),
                Err(_) => format!(
                    "Nothing answered after {} seconds",
                    SIDECAR_PORT_TIMEOUT.as_secs()
                ),
            };
            return Err(format!("{why}\ncommand: {command}\nstderr:\n{tail}"));
        }
    };
    let (port, pid) = match parse_port_line(&line) {
        Ok(v) => v,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            let tail = stderr_buf.lock().unwrap_or_else(|e| e.into_inner()).join("\n");
            return Err(format!("{e}\ncommand: {command}\nstderr:\n{tail}"));
        }
    };
    let pid = if pid == 0 { child.id() } else { pid };
    *slot = Some(SidecarProc {
        child,
        port,
        pid,
        pack: pack.clone(),
        command: command.clone(),
        stderr: stderr_buf.clone(),
        exit_code: exit_code.clone(),
    });
    drop(slot);

    // Supervise: poll `try_wait` through the managed state (the Child stays
    // in the slot so `agent_stop` can kill it) and tell the frontend when
    // the service goes away on its own — a crash becomes a named panel
    // state, never a hung request.
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let st = handle.state::<AgentSidecar>();
        let mut slot = match st.current.lock() {
            Ok(s) => s,
            Err(e) => e.into_inner(),
        };
        let Some(p) = slot.as_mut() else { return };
        if p.pid != pid {
            return; // a newer sidecar replaced this one; its own supervisor runs
        }
        match p.child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code().unwrap_or(-1);
                *p.exit_code.lock().unwrap_or_else(|e| e.into_inner()) = Some(code);
                let stderr = p.stderr.lock().unwrap_or_else(|e| e.into_inner()).clone();
                let _ = handle.emit(
                    "agent-exited",
                    serde_json::json!({ "pid": pid, "code": code, "stderr": stderr }),
                );
                return;
            }
            Ok(None) => {}
            Err(_) => return,
        }
    });
    Ok(serde_json::json!({ "port": port, "pid": pid, "command": command, "reused": false }))
}

/// POST /shutdown, wait briefly, then kill; reaps the child. Idempotent.
#[tauri::command]
fn agent_stop(state: State<'_, AgentSidecar>) -> Result<Value, String> {
    let taken = state
        .current
        .lock()
        .map_err(|e| format!("agent sidecar lock poisoned: {e}"))?
        .take();
    let stopped = taken.is_some();
    if let Some(p) = taken {
        stop_sidecar(p);
    }
    Ok(serde_json::json!({ "stopped": stopped }))
}

/// Is the sidecar running, on which port, and what did it say on stderr?
#[tauri::command]
fn agent_status(state: State<'_, AgentSidecar>) -> Result<Value, String> {
    let slot = state
        .current
        .lock()
        .map_err(|e| format!("agent sidecar lock poisoned: {e}"))?;
    Ok(sidecar_status_json(slot.as_ref()))
}

#[cfg(test)]
mod sidecar_tests {
    use super::parse_port_line;

    #[test]
    fn reads_the_port_line_the_service_prints_first() {
        assert_eq!(parse_port_line("{\"port\": 51234, \"pid\": 77}\n").unwrap(), (51234, 77));
        // pid is optional — cradle falls back to the child's own id.
        assert_eq!(parse_port_line("{\"port\": 8}").unwrap(), (8, 0));
    }

    #[test]
    fn a_usage_error_or_garbage_first_line_is_a_named_failure() {
        let err = parse_port_line("{\"error\": \"no such pack directory: /x\"}").unwrap_err();
        assert!(err.contains("no such pack directory"), "{err}");
        assert!(parse_port_line("Traceback (most recent call last):").is_err());
        assert!(parse_port_line("{\"port\": 0}").is_err());
        assert!(parse_port_line("{\"pid\": 3}").is_err());
    }
}

/// One generation job for the serial background worker. `args` is the
/// fully-built canon CLI vector (env-file already appended for paid ops); `id`
/// is a frontend-generated uuid so `job-updated` events correlate to the
/// in-memory job holding the tray metadata.
///
/// `progress_root` is the pack the job writes into. Row P1-A4.5 (master
/// §3.0-E) watches EVERY queued job: canon's pipeline appends structured
/// events to `<root>/.canon/log.jsonl` as it runs and the worker relays the
/// new lines as `job-progress` while the job is in flight — a verb that
/// writes no step log simply relays nothing. The same root hosts the job's
/// cancel file (`<root>/.canon/cancel/<job_id>`, §3.0-D).
struct QueuedJob {
    id: String,
    args: Vec<String>,
    progress_root: Option<PathBuf>,
}

// ---------------------------------------------------------------------------
// Row P1-A4.5 — JobQueue Child retention + ⏹ cancel (master §3.0-D, Q9)
// ---------------------------------------------------------------------------

/// The ONE process-tracking path: every running job's `Child` is RETAINED
/// here (generalizing `reap_and_notify`'s play-process pattern), reaped on
/// exit by the worker, and reachable by `cancel_job`. W2.0's play-session
/// kill/registry extends this map instead of adding a second one.
///
/// `queued` = ids the worker has not reached; `cancelled` = ids Stop was
/// pressed on (a queued id is dropped outright when the worker reaches it;
/// a running one gets its cancel FILE, a grace period, then `kill`);
/// `cancel_files` = the per-job `<pack>/.canon/cancel/<job_id>` the child
/// watches (env `CANON_CANCEL_FILE`, checked at every `node_item` boundary
/// canon-side — `canon.pipeline.steplog`). No signals anywhere.
#[derive(Default)]
struct JobState {
    queued: std::sync::Mutex<std::collections::HashSet<String>>,
    cancelled: std::sync::Mutex<std::collections::HashSet<String>>,
    children: std::sync::Mutex<std::collections::HashMap<String, std::process::Child>>,
    cancel_files: std::sync::Mutex<std::collections::HashMap<String, PathBuf>>,
}

/// Lock a mutex, surviving a poisoned one (a panicked worker must not take
/// the cancel path down with it).
fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl JobState {
    fn mark_queued(&self, id: &str) {
        lock(&self.queued).insert(id.to_string());
    }

    /// The worker reached `id`: it is no longer queued. `true` when Stop
    /// dropped it while it waited — the worker then skips it (`cancel_job`
    /// already emitted the terminal `cancelled` event).
    fn take_dropped(&self, id: &str) -> bool {
        lock(&self.queued).remove(id);
        lock(&self.cancelled).remove(id)
    }

    /// Stop on a job that has not started: drop it from the queue. `true`
    /// when it was queued (and is now marked cancelled).
    fn cancel_queued(&self, id: &str) -> bool {
        if lock(&self.queued).remove(id) {
            lock(&self.cancelled).insert(id.to_string());
            true
        } else {
            false
        }
    }

    fn is_running(&self, id: &str) -> bool {
        lock(&self.children).contains_key(id)
    }

    /// Has the retained child exited? (`try_wait` caches the status, so the
    /// worker's later `wait` still answers.) A child no longer retained
    /// counts as finished.
    fn child_finished(&self, id: &str) -> bool {
        let mut children = lock(&self.children);
        match children.get_mut(id) {
            Some(child) => matches!(child.try_wait(), Ok(Some(_))),
            None => true,
        }
    }

    fn kill(&self, id: &str) {
        if let Some(child) = lock(&self.children).get_mut(id) {
            let _ = child.kill();
        }
    }
}

/// Serial job queue: gen commands push here and return immediately so the UI
/// never blocks on generation; a single worker thread (spawned in `.setup`)
/// runs them one at a time off the UI thread and emits `job-updated` events.
/// Serial by construction — one receiver, one worker. `state` is shared with
/// that worker (Child retention + cancel bookkeeping, row P1-A4.5).
struct JobQueue {
    tx: std::sync::Mutex<std::sync::mpsc::Sender<QueuedJob>>,
    state: Arc<JobState>,
}

/// What cradle stamps on every user-driven canon write (`--actor`) — the ONE
/// place the string is spelled on the Rust side (master doctrine 8, I6). The
/// TS side mirrors it as `USER_ACTOR` in `src/lib/actor.ts`; the agent's own
/// `agent:<conversation>/<specialist>` is built by canon (`canon.agent.actors`),
/// never here.
pub const USER_ACTOR: &str = "cradle:user";

fn canon(path: String) -> PathBuf {
    canon_world_root(&PathBuf::from(path))
}

#[tauri::command]
fn load_world(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<WorldSummary, String> {
    let root = canon(path);
    // Row P0-11 (W3.6): the asset protocol's STATIC scope is now narrow — the
    // app's own resources and the project store. Any other root is granted
    // here, for that directory only, at the moment the user opens it.
    allow_world_assets(&app, &root);
    let mut summary = state.source.load_world(&root)?;
    summary.path = root.to_string_lossy().to_string();
    // `world_kind` is canon's `pack_type` verbatim — one vocabulary (P0 paper
    // P.4.6), asked of canon's registry resolver rather than guessed from the
    // tree: an unavailable canon is a named failure (doctrine 4), never a
    // silent platformer/dungeon sniff. Canon resolves the PACK directory —
    // `<root>/data/` for a MazeWorld world, the root for a platformer — which
    // is exactly what the store reads; `summary.path` stays the world root.
    let pack_dir = LocalFsDataSource::data_root(&root);
    let pack_dir_s = pack_dir.to_string_lossy().to_string();
    let info = run_canon(&["pack", "info", &pack_dir_s]).map_err(|e| {
        format!(
            "cannot resolve this world's kind — cradle asks `canon pack info` for it and that \
             failed: {e}. Fix: install canon-ai and set CANON_BIN to its `canon` binary (or put \
             `canon` on PATH)."
        )
    })?;
    summary.world_kind = pack_type_of(&info)?;
    // The rest of the document rides along (row P0-5): the store keeps the
    // registry's `grids` block for the room editor's Dock tabs without a
    // second shell-out.
    summary.pack_info = info;
    Ok(summary)
}

/// The registry id out of a `canon pack info` document — the one field
/// `load_world` reads from it. Pure so the missing / non-string case is unit
/// testable without a canon binary; an empty id is treated as missing (the
/// same rule as `data::pack_kind`'s mirror read).
fn pack_type_of(info: &Value) -> Result<String, String> {
    info.get("pack_type")
        .and_then(Value::as_str)
        .filter(|k| !k.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "`canon pack info` answered without a pack_type".to_string())
}

#[cfg(test)]
mod pack_type_tests {
    use super::pack_type_of;
    use serde_json::json;

    #[test]
    fn reads_the_pack_type_verbatim_as_open_data() {
        assert_eq!(pack_type_of(&json!({"pack_type": "platformer"})).unwrap(), "platformer");
        assert_eq!(pack_type_of(&json!({"pack_type": "shooter"})).unwrap(), "shooter");
    }

    #[test]
    fn a_missing_empty_or_non_string_pack_type_is_a_named_error() {
        for doc in [json!({}), json!({"pack_type": ""}), json!({"pack_type": 3}), json!({"pack_type": null})] {
            let err = pack_type_of(&doc).unwrap_err();
            assert!(err.contains("without a pack_type"), "{err}");
        }
    }
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

/// Row P0-11 (W3.6): one of the asset protocol's TWO grant points, the other
/// being `load_world`. This resolver only ever answers with a file INSIDE the
/// world root (`data::resolve_asset_rejects_paths_outside_world`). Granting
/// the root here — not only in `load_world` — is what lets the recents rail
/// and the returning hero show thumbnails of a project the user has NOT opened
/// yet, which the narrowed static scope would otherwise have made blank.
///
/// It is NOT the only source of paths that reach `convertFileSrc`. Portrait,
/// AudioPlayer, EntityTable and EntityOverview all render what this returns,
/// but `anim/AnimationTab` (`state.path_abs`) and `anim/AnimateModal`
/// (`base_sprite_abs` from `api.animInspect`) convert absolute paths handed
/// back by canon verbs directly. Those two work only because both surfaces
/// live inside an OPENED world, whose root `load_world` already granted
/// recursively. Anyone narrowing the scope further has to keep that grant, or
/// route those two through here first.
#[tauri::command]
fn resolve_asset(
    app: AppHandle,
    path: String,
    hint: String,
    state: State<'_, AppState>,
) -> Option<String> {
    let root = canon(path);
    let resolved = state.source.resolve_asset(&root, &hint);
    if resolved.is_some() {
        allow_world_assets(&app, &root);
    }
    resolved
}

/// Render-ready JSON bundle for one grid — a platformer level or, since row
/// P0-5, a dungeon room in the same shape (`canon level export` is the alias
/// of `canon grid export`; canon dispatches on the pack's registry).
///
/// Shells out to canon's `level export` verb (native subprocess — not routed
/// through the Tauri shell plugin) so cradle never has to decode canon's binary
/// `.npz` grids itself. The canon binary is resolved from the `CANON_BIN` env
/// var, falling back to `canon` on PATH. Canon gets the PACK directory —
/// `<root>/data/` for a MazeWorld world, the root for a platformer — the same
/// directory `load_world` hands `pack info`.
#[tauri::command]
fn export_level(path: String, level_id: String) -> Result<Value, String> {
    let root = canon(path);
    let pack_dir = LocalFsDataSource::data_root(&root);
    let canon = canon_command();
    let output = canon
        .command()
        .args(["level", "export"])
        .arg(pack_dir.as_os_str())
        .args(["--level", &level_id])
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon.display(), e))?;
    if !output.status.success() {
        return Err(format!(
            "canon level export failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let parsed: Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("parse canon output: {}", e))?;
    // Verb wraps the bundle as {"canon_version": ..., "level": {...}}.
    Ok(parsed.get("level").cloned().unwrap_or(parsed))
}

/// Persist a sparse-layer hand-edit (moved enemy/item/door/spawn/exit) by
/// shelling out to `canon level apply-edit`. Canon rewrites the layer files,
/// recomputes hashes, updates level.json, and stamps the level `user_edited`.
#[tauri::command]
fn save_level_edit(path: String, level_id: String, edit: Value) -> Result<Value, String> {
    let root = canon(path);
    let canon = canon_command();
    let edit_str = serde_json::to_string(&edit).map_err(|e| e.to_string())?;
    let output = canon
        .command()
        .args(["level", "apply-edit"])
        .arg(root.as_os_str())
        .args([
            "--level", &level_id, "--json", &edit_str, "--actor", USER_ACTOR,
        ])
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon.display(), e))?;
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
    let canon = canon_command();
    let output = canon
        .command()
        .args(args)
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon.display(), e))?;
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
        "level",
        "import-grids",
        &root_s,
        "--level",
        &level_id,
        "--json",
        &payload,
        "--actor",
        USER_ACTOR,
    ])
}

/// Re-roll ONE step of a grid via `canon grid roll` (row P0-8). Code-only and
/// $0 — the dungeon room's 🪄 layout / 🎲 npcs / events / items / monsters and
/// the whole-room roll, all journaled canon-side. `encounter` names the combat
/// event a monsters roll re-rolls; `seed` pins it for reproducibility.
#[tauri::command]
fn roll_grid_step(
    path: String,
    level_id: String,
    step: String,
    encounter: Option<String>,
    seed: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "grid".into(),
        "roll".into(),
        root,
        "--level".into(),
        level_id,
        "--step".into(),
        step,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(e) = encounter.filter(|e| !e.is_empty()) {
        args.push("--encounter".into());
        args.push(e);
    }
    if let Some(s) = seed.filter(|s| !s.is_empty()) {
        args.push("--seed".into());
        args.push(s);
    }
    run_canon_owned(args)
}

/// Make a stored version of one grid step current again via
/// `canon grid restore` (row P0-8). Nothing is deleted: the restore writes a
/// NEW version through the same writer (doctrine 6).
#[tauri::command]
fn restore_grid_step(
    path: String,
    level_id: String,
    step: String,
    to: String,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&[
        "grid",
        "restore",
        &root,
        "--level",
        &level_id,
        "--step",
        &step,
        "--to",
        &to,
        "--actor",
        USER_ACTOR,
    ])
}

/// Scaffold a new hand-built draft level via `canon level create`.
#[tauri::command]
fn create_level(path: String, stage_id: String, width: u32, height: u32) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let (w, h) = (width.to_string(), height.to_string());
    run_canon(&[
        "level",
        "create",
        &root,
        "--stage",
        &stage_id,
        "--width",
        &w,
        "--height",
        &h,
        "--actor",
        USER_ACTOR,
    ])
}

/// Create-or-reuse the flat DRAFT room the movement sandbox plays in.
/// Idempotent (reserved level id), so repeat launches journal nothing.
/// Row P1-A4.5 (C19): `level_id` sandboxes an EXISTING level instead (a
/// read), `spawn` = "x,y" start cell; both ride `canon level sandbox
/// --level / --spawn` and come back on the result with a `launch.env` block
/// (`PLAT_SANDBOX`, `PLAT_SPAWN`) for `play_level`.
#[tauri::command]
fn sandbox_level(
    path: String,
    level_id: Option<String>,
    spawn: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let args: Vec<String> = vec![
        "level".into(),
        "sandbox".into(),
        root,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    let args = with_opt_flag(args, "--level", level_id);
    let args = with_opt_flag(args, "--spawn", spawn);
    run_canon_owned(args)
}

/// The cradle project store: where a project CREATED in cradle lands
/// (Phase 0 §8.4, row P0-10). `~/CradleProjects/` — visible and browsable, not
/// app-data, because these are the user's own worlds. A project OPENED from
/// elsewhere is still written back in place; only create defaults here.
/// `CRADLE_PROJECTS_DIR` overrides it (tests, and the "Advanced — choose
/// location" escape hatch's future home).
fn project_store_root() -> Result<std::path::PathBuf, String> {
    Ok(project_store_resolved()?.0)
}

/// The store root AND which leg chose it — `env` (`CRADLE_PROJECTS_DIR`),
/// `settings` (the Environment pane's relocate control), or `default`. Row
/// P0-12 adds the middle leg; the env override still wins, so a dev machine
/// notices nothing.
fn project_store_resolved() -> Result<(std::path::PathBuf, &'static str), String> {
    if let Ok(dir) = std::env::var("CRADLE_PROJECTS_DIR") {
        if !dir.trim().is_empty() {
            return Ok((std::path::PathBuf::from(dir), "env"));
        }
    }
    if let Some(dir) = settings_read("project_store") {
        if !dir.trim().is_empty() {
            return Ok((std::path::PathBuf::from(dir), "settings"));
        }
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "cannot locate your home directory to place the project store".to_string())?;
    Ok((
        std::path::Path::new(&home).join("CradleProjects"),
        "default",
    ))
}

/// cradle's own per-machine settings file (row P0-12). Machine config, not
/// pack data (I5) and not a secret — the project-store location is the only
/// key in it today. It lives beside the key store's config directory.
fn settings_path() -> Option<std::path::PathBuf> {
    keys::config_dir().map(|d| d.join("settings.json"))
}

fn settings_read(key: &str) -> Option<String> {
    let text = std::fs::read_to_string(settings_path()?).ok()?;
    let doc: Value = serde_json::from_str(&text).ok()?;
    doc.get(key)?.as_str().map(str::to_string)
}

fn settings_write(key: &str, value: Option<&str>) -> Result<(), String> {
    let path = settings_path().ok_or_else(|| {
        "cradle has no config directory to remember this in — set CRADLE_CONFIG_DIR".to_string()
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let mut doc: Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(map) = doc.as_object_mut() {
        match value {
            Some(v) => {
                map.insert(key.to_string(), Value::String(v.to_string()));
            }
            None => {
                map.remove(key);
            }
        }
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&doc).unwrap_or_default(),
    )
    .map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Where new projects land, for the wizard to SHOW before it creates anything
/// (row P0-10) and for the Environment pane to relocate (row P0-12). Pure
/// read; creates nothing.
#[tauri::command]
fn project_store() -> Result<Value, String> {
    let (root, source) = project_store_resolved()?;
    Ok(serde_json::json!({
        "root": root.to_string_lossy(),
        "exists": root.is_dir(),
        "source": source,
        "locked_by_env": source == "env",
    }))
}

/// Move where NEW projects land (W3.5's Environment pane). Existing projects
/// are never moved or rewritten — a project opened from anywhere is still
/// written back in place — so this changes one default and nothing else.
/// `None` clears the override and returns to `~/CradleProjects`.
#[tauri::command]
fn set_project_store(path: Option<String>) -> Result<Value, String> {
    if std::env::var("CRADLE_PROJECTS_DIR").is_ok_and(|v| !v.trim().is_empty()) {
        return Err(
            "CRADLE_PROJECTS_DIR is set in this process and wins — unset it to relocate the \
             store from here."
                .into(),
        );
    }
    match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(dir) => {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("cannot use {dir} as the project store: {e}"))?;
            settings_write("project_store", Some(dir))?;
        }
        None => settings_write("project_store", None)?,
    }
    project_store()
}

/// `<name>` → a filesystem-safe directory name.
fn slugify(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    let slug = slug.trim_matches('_');
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug.to_string()
    }
}

/// The first free `<parent>/<slug>`, `<slug>_2`, `<slug>_3`, … (row P0-10).
///
/// W2 named the old behaviour a papercut: a second "My Platformer" hard-errored
/// out of `canon world new` ("target already exists and is not empty") after
/// the user had already picked backends and confirmed. Naming collisions are
/// normal, so create auto-uniquifies and reports the directory it chose; canon
/// keeps its refusal, which now only fires on a genuine race.
fn unique_pack_dir(parent: &std::path::Path, slug: &str) -> std::path::PathBuf {
    let occupied =
        |p: &std::path::Path| p.exists() && p.read_dir().is_ok_and(|mut d| d.next().is_some());
    let first = parent.join(slug);
    if !occupied(&first) {
        return first;
    }
    for n in 2..1000 {
        let candidate = parent.join(format!("{slug}_{n}"));
        if !occupied(&candidate) {
            return candidate;
        }
    }
    parent.join(format!("{slug}_{}", std::process::id()))
}

/// Scaffold a fresh project from a TEMPLATE via `canon world new --template`,
/// returning the pack path and a job id IMMEDIATELY — the run itself happens
/// on the job worker.
///
/// This used to run inline. A `#[tauri::command]` on a plain `fn` is a
/// BLOCKING command: Tauri runs it on the main thread, so a fully-paid world
/// (minutes of art, animation and audio) froze the whole app — no repaint, no
/// progress, indistinguishable from a crash. Every other paid verb here was
/// already on the queue; this was the one that wasn't. It watches the new
/// pack's step log, so the caller gets `job-progress` for the whole run —
/// which is how a DUNGEON create reports progress too, unchanged, now that
/// canon's dungeon runner writes one (row P0-10).
///
/// Row P0-10 additions, all pass-through: `template` (canon dispatches
/// through its pack registry — cradle never branches on it), the dungeon's
/// count flags beside the platformer's, `seed` and `model` (W2 papercuts: they
/// never reached the runner), an absent `parent_dir` meaning the project store
/// (§8.4), and auto-uniquify on collision.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn new_project(
    app: AppHandle,
    queue: State<'_, JobQueue>,
    job_id: String,
    parent_dir: Option<String>,
    name: String,
    template: Option<String>,
    counts: Option<std::collections::HashMap<String, u32>>,
    seed: Option<String>,
    model: Option<String>,
    llm_backend: Option<String>,
    image_backend: Option<String>,
    music_backend: Option<String>,
    sfx_backend: Option<String>,
    vlm_backend: Option<String>,
) -> Result<Value, String> {
    let parent = match parent_dir {
        Some(dir) if !dir.trim().is_empty() => std::path::PathBuf::from(dir),
        _ => project_store_root()?,
    };
    std::fs::create_dir_all(&parent)
        .map_err(|e| format!("cannot create the project folder {}: {e}", parent.display()))?;
    let out = unique_pack_dir(&parent, &slugify(&name));
    let mut args: Vec<String> = vec![
        "world".into(),
        "new".into(),
        out.to_string_lossy().into_owned(),
        "--name".into(),
        name,
    ];
    args = with_opt_flag(args, "--template", template);
    // The count flags are canon's vocabulary, sent by name: the wizard renders
    // them from `pack templates`, so a third template needs no Rust change.
    // An unknown flag is refused BY CANON with a reason (doctrine 4).
    if let Some(counts) = counts {
        let mut keys: Vec<&String> = counts.keys().collect();
        keys.sort();
        for key in keys {
            args.push(format!("--{key}"));
            args.push(counts[key].to_string());
        }
    }
    args = with_opt_flag(args, "--seed", seed);
    args = with_opt_flag(args, "--model", model);
    if let Some(b) = llm_backend {
        args.push("--llm-backend".into());
        args.push(b);
    }
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
    if let Some(b) = vlm_backend {
        args.push("--vlm-backend".into());
        args.push(b);
    }
    // Paid backends read their keys from CANON_ENV_FILE (harmless when fake).
    let mut ack = enqueue_watching(&app, &queue, job_id, with_env_file(args), Some(out.clone()))?;
    // The pack dir rides along on the ack: the frontend needs it to open the
    // world when the job lands, and only this function knows the slug rule.
    if let Value::Object(map) = &mut ack {
        map.insert(
            "pack_dir".into(),
            Value::String(out.to_string_lossy().into_owned()),
        );
    }
    Ok(ack)
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(),
        "regenerate".into(),
        root,
        "--level".into(),
        level_id,
        "--brief".into(),
        brief,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(d) = difficulty {
        args.push("--difficulty".into());
        args.push(d.to_string());
    }
    if let Some(w) = width {
        args.push("--width".into());
        args.push(w.to_string());
    }
    if let Some(h) = height {
        args.push("--height".into());
        args.push(h.to_string());
    }
    if let Some(a) = axis {
        args.push("--axis".into());
        args.push(a);
    }
    if let Some(s) = seed {
        if !s.is_empty() {
            args.push("--seed".into());
            args.push(s);
        }
    }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    let args = with_opt_flag(args, "--system-prompt", system_override);
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(),
        "improve".into(),
        root,
        "--level".into(),
        level_id,
        "--instruction".into(),
        instruction,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if fix_problems {
        args.push("--fix-problems".into());
    }
    if reroll_placements {
        args.push("--reroll-placements".into());
    }
    if let Some(s) = seed {
        if !s.is_empty() {
            args.push("--seed".into());
            args.push(s);
        }
    }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    let args = with_opt_flag(args, "--system-prompt", system_override);
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
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
        "level".into(),
        "publish".into(),
        root,
        "--level".into(),
        level_id,
        "--actor".into(),
        USER_ACTOR.into(),
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(),
        "generate".into(),
        root,
        "--stage".into(),
        stage_id,
        "--brief".into(),
        brief,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(d) = difficulty {
        args.push("--difficulty".into());
        args.push(d.to_string());
    }
    if let Some(w) = width {
        args.push("--width".into());
        args.push(w.to_string());
    }
    if let Some(h) = height {
        args.push("--height".into());
        args.push(h.to_string());
    }
    if let Some(a) = axis {
        args.push("--axis".into());
        args.push(a);
    }
    if let Some(e) = enemies {
        args.push("--enemies".into());
        args.push(e.to_string());
    }
    if let Some(i) = items {
        args.push("--items".into());
        args.push(i.to_string());
    }
    if let Some(s) = seed {
        if !s.is_empty() {
            args.push("--seed".into());
            args.push(s);
        }
    }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    let args = with_opt_flag(args, "--system-prompt", system_override);
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(),
        "music".into(),
        "generate".into(),
        root,
        "--level".into(),
        level_id,
        "--brief".into(),
        brief.unwrap_or_default(),
        "--music-backend".into(),
        music_backend.unwrap_or_else(|| "fake".into()),
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(s) = section {
        args.push("--section".into());
        args.push(s.to_string());
    }
    if let Some(sec) = seconds {
        args.push("--seconds".into());
        args.push(sec.to_string());
    }
    let args = with_opt_flag(args, "--prompt", prompt_override);
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(),
        "place-enemies".into(),
        root,
        "--level".into(),
        level_id,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(e) = enemies {
        args.push("--enemies".into());
        args.push(e.to_string());
    }
    if let Some(s) = seed {
        if !s.is_empty() {
            args.push("--seed".into());
            args.push(s);
        }
    }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "level".into(),
        "place-items".into(),
        root,
        "--level".into(),
        level_id,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(i) = items {
        args.push("--items".into());
        args.push(i.to_string());
    }
    if let Some(s) = seed {
        if !s.is_empty() {
            args.push("--seed".into());
            args.push(s);
        }
    }
    args.push("--llm-backend".into());
    args.push(llm_backend.unwrap_or_else(|| "fake".into()));
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
}

/// Append `--flag <value>` when the UI supplied one. An absent or blank value
/// adds nothing, so canon's own default applies — which is what makes every
/// optional knob (prompt overrides, backends, model ids) additive: leave the
/// field empty and the call is byte-identical to not having the field.
fn with_opt_flag(mut args: Vec<String>, flag: &str, value: Option<String>) -> Vec<String> {
    if let Some(text) = value {
        if !text.trim().is_empty() {
            args.push(flag.into());
            args.push(text);
        }
    }
    args
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

/// The names a resolved env file sets (values dropped at the door).
fn env_file_names() -> Vec<String> {
    let Some(path) = env_file_path() else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut names = Vec::new();
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
    names
}

/// Which provider keys cradle can actually hand to canon, and **from where**.
///
/// Row P0-12 extends W2's names-only answer with a SOURCE per variable
/// (`keychain` · `env` · `file`), reported in the same order
/// `apply_provider_env` applies them, so the chip on the Keys pane names the
/// store that will actually win. `also_in` lists the other places the same
/// name was seen — that is how "you added this in Settings but your shell also
/// exports it" becomes visible instead of mysterious.
///
/// **Names and sources only.** Never a value, not even masked; never a length.
/// The frontend passes `vars` (the canonical + alias names from `canon
/// providers list`, so the union stays DATA); anything else cradle can see is
/// still reported, so an unexpected key is never invisible.
///
/// Every asked-for name is resolved against the environment BY NAME. The
/// name-shaped scan below is discovery of extra names only — a var whose name
/// does not look like an API key (`PIXELLAB_SECRET`, canon's own) is still
/// answered correctly.
#[tauri::command]
fn provider_keys(vars: Option<Vec<String>>) -> Value {
    let store = keys::KeyStore::app();
    let backend = store.backend();
    // Indexed names split by whether this machine will actually release them:
    // a stale index or a keychain that refuses THIS binary must read as
    // unreadable, never as set (see `KeyStore::readable_names`).
    let (from_keychain, unreadable) = store.readable_names();
    let from_file = env_file_names();
    // DISCOVERY ONLY. This name-shaped scan exists so a key cradle can see but
    // was not asked about is never invisible; it must NEVER decide whether an
    // asked-for name is set — `PIXELLAB_SECRET`, the var this row makes
    // canonical, matches no such shape, and deciding by shape reported a
    // working machine's PixelLab key as "not set" and refused the wizard.
    let discovered_env: Vec<String> = std::env::vars()
        .filter(|(k, v)| {
            !v.trim().is_empty() && (k.ends_with("_API_KEY") || k.starts_with("FAL_KEY"))
        })
        .map(|(k, _)| k)
        .collect();
    // The one question asked of the environment per NAME, never per shape.
    let in_env = |name: &str| {
        std::env::var(name)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
    };

    // The vars to REPORT: whatever the caller asked about (canon's table),
    // plus everything cradle can see. A union of data, never a literal.
    let mut wanted: Vec<String> = vars.unwrap_or_default();
    wanted.extend(from_keychain.iter().cloned());
    wanted.extend(unreadable.iter().cloned());
    wanted.extend(discovered_env.iter().cloned());
    wanted.extend(from_file.iter().cloned());
    wanted.sort();
    wanted.dedup();

    let mut rows: Vec<Value> = Vec::new();
    let mut set_names: Vec<String> = Vec::new();
    for name in &wanted {
        // Highest-precedence source first — the same order the child gets.
        let mut places: Vec<&str> = Vec::new();
        if from_keychain.contains(name) {
            places.push(backend.id());
        }
        if in_env(name) {
            places.push("env");
        }
        if from_file.contains(name) {
            places.push("env_file");
        }
        if !places.is_empty() {
            set_names.push(name.clone());
        }
        rows.push(serde_json::json!({
            "name": name,
            "set": !places.is_empty(),
            "source": places.first().copied(),
            "also_in": places.iter().skip(1).collect::<Vec<_>>(),
            // Stored here, but this machine will not hand it over. Doctrine 4:
            // say so rather than showing a green chip over a key the child
            // never receives.
            "unreadable": unreadable.contains(name),
        }));
    }
    serde_json::json!({
        "env_file": env_file_path(),
        // The pre-P0-12 field, unchanged in meaning: the NAMES cradle can hand
        // over. Kept so nothing that reads it has to change at once.
        "keys": set_names,
        "vars": rows,
        "backend": backend.id(),
        "warning": backend.warning(),
        "config_dir": keys::config_dir().map(|p| p.to_string_lossy().into_owned()),
    })
}

/// Store one provider key in the OS keychain. **Write-only**: the value goes
/// in and never comes back out through any command (row P0-12's secrets
/// discipline). The answer carries the variable name, the store that took it,
/// and the loud warning when that store is the unencrypted fallback.
#[tauri::command]
fn set_provider_key(var: String, value: String) -> Result<Value, String> {
    let store = keys::KeyStore::app();
    let backend = store.set(&var, &value)?;
    Ok(serde_json::json!({
        "var": var,
        "stored": true,
        "backend": backend.id(),
        "warning": backend.warning(),
    }))
}

/// Forget one provider key. Idempotent: removing a key that is not there is a
/// success that says `removed: false`.
#[tauri::command]
fn delete_provider_key(var: String) -> Result<Value, String> {
    let store = keys::KeyStore::app();
    let (removed, backend) = store.delete(&var)?;
    Ok(serde_json::json!({
        "var": var,
        "removed": removed,
        "backend": backend.id(),
        "warning": backend.warning(),
    }))
}

/// The provider ROWS — `canon providers list`, verbatim (master §6 S6: rows
/// are data). Cradle holds no provider list of its own; this is the whole of
/// what the Keys pane renders and what the missing-key precheck maps backends
/// through.
#[tauri::command]
fn provider_rows() -> Result<Value, String> {
    run_canon(&["providers", "list"])
}

/// USER-INITIATED key test — `canon providers test <id>`, the cheapest
/// authenticated ping the row declares, never a generation (doctrine 3).
///
/// It runs in a canon child, which means the key reaches it through
/// `apply_provider_env` and never through this command's arguments or its
/// answer. Reached only from an explicit click on the Test button, whose copy
/// says it contacts the provider.
#[tauri::command]
async fn test_provider_key(provider: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_canon(&["providers", "test", &provider]))
        .await
        .map_err(|e| format!("the key test could not run: {e}"))?
}

/// Push a job onto the serial queue and emit its `queued` event, returning the
/// job id immediately — the generation runs on the worker thread so the UI
/// never blocks. `args` must already be fully built (env-file appended).
/// `root` is the pack the job writes into: every job is watched for
/// `job-progress` and hosts its cancel file there (row P1-A4.5, §3.0-D/E).
fn enqueue(
    app: &AppHandle,
    queue: &JobQueue,
    id: String,
    args: Vec<String>,
    root: PathBuf,
) -> Result<Value, String> {
    enqueue_watching(app, queue, id, args, Some(root))
}

/// `enqueue`, with an explicit (possibly absent) pack whose
/// `.canon/log.jsonl` the worker relays as `job-progress` while this job runs.
fn enqueue_watching(
    app: &AppHandle,
    queue: &JobQueue,
    id: String,
    args: Vec<String>,
    progress_root: Option<PathBuf>,
) -> Result<Value, String> {
    queue.state.mark_queued(&id);
    let sent = queue
        .tx
        .lock()
        .map_err(|e| format!("job queue lock poisoned: {e}"))?
        .send(QueuedJob {
            id: id.clone(),
            args,
            progress_root,
        });
    if let Err(e) = sent {
        queue.state.take_dropped(&id);
        return Err(format!("job worker is gone: {e}"));
    }
    let _ = app.emit(
        "job-updated",
        serde_json::json!({ "id": id, "status": "queued" }),
    );
    Ok(serde_json::json!({ "job_id": id, "status": "queued" }))
}

/// The env var canon reads the per-job cancel file path from
/// (`canon.pipeline.steplog.CANCEL_FILE_ENV`).
const CANCEL_FILE_ENV: &str = "CANON_CANCEL_FILE";

/// How long a running job gets to stop at its next item boundary after the
/// cancel file lands before the worker kills it (§3.0-D: keep what landed).
const CANCEL_GRACE: std::time::Duration = std::time::Duration::from_secs(10);

/// How often the grace watcher re-checks the child.
const CANCEL_POLL: std::time::Duration = std::time::Duration::from_millis(100);

/// Canon's exit status for a cancelled run (`steplog.EXIT_CANCELLED`).
const EXIT_CANCELLED: i32 = 3;

/// `<root>/.canon/cancel/<job_id>` — the file whose presence cancels the job.
fn cancel_file_path(root: &std::path::Path, job_id: &str) -> PathBuf {
    root.join(".canon").join("cancel").join(job_id)
}

/// `<root>/.canon/log.jsonl` — the step log every watched job relays.
fn step_log_path(root: &std::path::Path) -> PathBuf {
    root.join(".canon").join("log.jsonl")
}

/// What one job produced: canon's JSON (or the error), plus the exit code
/// when the process ran at all.
struct JobOutcome {
    result: Result<Value, String>,
    exit_code: Option<i32>,
}

/// The serial worker loop (spawned once in `.setup`): runs each queued job to
/// completion — blocking is fine here, it's off the UI thread — and emits a
/// terminal `job-updated` carrying the canon result (or the error). Row
/// P1-A4.5: a job Stop dropped while it waited is skipped (its terminal event
/// already went out); a job Stop reached while it ran ends as
/// `{status: "cancelled", result: {cancelled, kept, exit_code}}` with `kept`
/// read from the step log's cancel-aware `run_end`, whatever canon's exit
/// status was — the child was told to stop, and what landed stays.
fn run_job_worker(
    app: AppHandle,
    rx: std::sync::mpsc::Receiver<QueuedJob>,
    state: Arc<JobState>,
) {
    for job in rx {
        if state.take_dropped(&job.id) {
            continue;
        }
        let _ = app.emit(
            "job-updated",
            serde_json::json!({ "id": job.id, "status": "running" }),
        );
        let cancel_file = job
            .progress_root
            .as_ref()
            .map(|root| cancel_file_path(root, &job.id));
        let outcome = run_job_child(&app, &state, &job, cancel_file.as_deref());
        let was_cancelled = lock(&state.cancelled).remove(&job.id);
        if let Some(file) = &cancel_file {
            let _ = std::fs::remove_file(file);
        }
        let payload = if was_cancelled {
            let kept = job
                .progress_root
                .as_ref()
                .and_then(|root| std::fs::read_to_string(step_log_path(root)).ok())
                .and_then(|text| kept_from_log(&text))
                .unwrap_or_default();
            serde_json::json!({
                "id": job.id,
                "status": "cancelled",
                "result": {
                    "cancelled": true,
                    "kept": kept,
                    "exit_code": outcome.exit_code,
                    "clean": outcome.exit_code == Some(EXIT_CANCELLED),
                    "error": outcome.result.err(),
                },
            })
        } else {
            match outcome.result {
                Ok(result) => {
                    serde_json::json!({ "id": job.id, "status": "done", "result": result })
                }
                Err(error) => {
                    serde_json::json!({ "id": job.id, "status": "failed", "error": error })
                }
            }
        };
        let _ = app.emit("job-updated", payload);
    }
}

fn read_all<R: std::io::Read>(reader: Option<R>) -> Vec<u8> {
    let mut out = Vec::new();
    if let Some(mut reader) = reader {
        let _ = reader.read_to_end(&mut out);
    }
    out
}

/// Spawn canon for one job with its `Child` RETAINED in `state.children`
/// (so `cancel_job` can reach it), relay the step log while it runs, then
/// reap it and parse its output — `run_canon`'s contract, minus the
/// unreachable process. The cancel file path rides to the child as
/// `CANON_CANCEL_FILE`.
fn run_job_child(
    app: &AppHandle,
    state: &Arc<JobState>,
    job: &QueuedJob,
    cancel_file: Option<&std::path::Path>,
) -> JobOutcome {
    let canon = canon_command();
    let mut cmd = canon.command();
    cmd.args(&job.args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(file) = cancel_file {
        cmd.env(CANCEL_FILE_ENV, file);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return JobOutcome {
                result: Err(format!("failed to run '{}': {}", canon.display(), e)),
                exit_code: None,
            }
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    lock(&state.children).insert(job.id.clone(), child);
    if let Some(file) = cancel_file {
        lock(&state.cancel_files).insert(job.id.clone(), file.to_path_buf());
    }
    let out_reader = std::thread::spawn(move || read_all(stdout));
    let err_reader = std::thread::spawn(move || read_all(stderr));
    if let Some(root) = &job.progress_root {
        // Start past whatever an EARLIER run left in the log: only this job's
        // events are relayed, never a previous generation's replayed.
        let sent = std::fs::read_to_string(step_log_path(root))
            .map(|text| complete_lines(&text))
            .unwrap_or(0);
        relay_step_log(app, &job.id, root, || state.child_finished(&job.id), sent);
    }
    let status = match lock(&state.children).remove(&job.id) {
        Some(mut child) => child.wait().map_err(|e| format!("wait failed: {e}")),
        None => Err("job child vanished before it was reaped".to_string()),
    };
    lock(&state.cancel_files).remove(&job.id);
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    match status {
        Err(error) => JobOutcome {
            result: Err(error),
            exit_code: None,
        },
        Ok(status) => {
            let exit_code = status.code();
            if exit_code == Some(EXIT_CANCELLED) && lock(&state.cancelled).contains(&job.id) {
                // A clean stop at an item boundary is not a failure (§3.0-D:
                // keep what landed). The cancelled payload says `clean: true`;
                // its `error` stays null so the tray shows a stop, not a crash.
                return JobOutcome {
                    result: Ok(Value::Null),
                    exit_code,
                };
            }
            if !status.success() {
                let verb = job.args.get(1).cloned().unwrap_or_default();
                return JobOutcome {
                    result: Err(format!(
                        "canon {} failed: {}",
                        verb,
                        String::from_utf8_lossy(&stderr)
                    )),
                    exit_code,
                };
            }
            JobOutcome {
                result: serde_json::from_slice(&stdout)
                    .map_err(|e| format!("parse canon output: {}", e)),
                exit_code,
            }
        }
    }
}

/// ⏹ Stop on a queued or running job (row P1-A4.5; master §3.0-D — start
/// nothing new, keep what landed, say what it cost). Queued → dropped and
/// `job-updated {status: "cancelled"}` at once. Running → the job's cancel
/// file is created (canon stops at its next `node_item` boundary), a
/// watcher thread waits `CANCEL_GRACE` then `kill`s, and the WORKER emits the
/// terminal `job-updated {status: "cancelled", result: {kept…}}` when the
/// child exits. Returns immediately (never blocks the UI thread).
#[tauri::command]
fn cancel_job(app: AppHandle, queue: State<'_, JobQueue>, job_id: String) -> Result<Value, String> {
    let state = queue.state.clone();
    if state.cancel_queued(&job_id) {
        let _ = app.emit(
            "job-updated",
            serde_json::json!({
                "id": job_id,
                "status": "cancelled",
                "result": { "cancelled": true, "kept": [], "was": "queued" },
            }),
        );
        return Ok(serde_json::json!({ "job_id": job_id, "status": "cancelled", "was": "queued" }));
    }
    if !state.is_running(&job_id) {
        return Err(format!(
            "no queued or running job {job_id} — it already finished, or was never enqueued"
        ));
    }
    lock(&state.cancelled).insert(job_id.clone());
    let cancel_file = lock(&state.cancel_files).get(&job_id).cloned();
    if let Some(file) = &cancel_file {
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(file, b"cancel\n")
            .map_err(|e| format!("cannot write cancel file {}: {e}", file.display()))?;
    }
    let watcher = state.clone();
    let id = job_id.clone();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + CANCEL_GRACE;
        while watcher.is_running(&id) && !watcher.child_finished(&id) {
            if std::time::Instant::now() >= deadline {
                watcher.kill(&id);
                return;
            }
            std::thread::sleep(CANCEL_POLL);
        }
    });
    Ok(serde_json::json!({
        "job_id": job_id,
        "status": "cancelling",
        "was": "running",
        "cancel_file": cancel_file,
        "grace_ms": CANCEL_GRACE.as_millis() as u64,
    }))
}

/// How often the worker re-reads the step log while a job runs. Fast enough
/// that a phase boundary shows up as immediate, slow enough to be free.
const PROGRESS_POLL: std::time::Duration = std::time::Duration::from_millis(400);

/// Relay `<root>/.canon/log.jsonl` as `job-progress` events until
/// `finished()` answers true, then relay whatever it wrote last. `sent` is
/// how many complete lines to skip first (an earlier run's events).
///
/// Polling a file rather than watching it: the log is append-only JSONL
/// written by a subprocess we already own the lifetime of, so there is no
/// missed-event window a watcher would close — and it keeps the dependency
/// list where it is. Every emitted payload is one raw canon event plus the
/// job id and the §3.0-E contract keys (`progress_contract`); naming phases
/// is the frontend's job, not this one's.
fn relay_step_log(
    app: &AppHandle,
    job_id: &str,
    root: &std::path::Path,
    finished: impl Fn() -> bool,
    mut sent: usize,
) {
    let log = step_log_path(root);
    loop {
        let done = finished();
        if let Ok(text) = std::fs::read_to_string(&log) {
            let (fresh, seen) = unsent_lines(&text, sent);
            for line in fresh {
                if let Ok(Value::Object(mut event)) = serde_json::from_str::<Value>(line) {
                    event.insert("id".into(), Value::String(job_id.to_string()));
                    progress_contract(&mut event);
                    let _ = app.emit("job-progress", Value::Object(event));
                }
            }
            sent = seen;
        }
        if done {
            return; // one final read happened above, AFTER finished()
        }
        std::thread::sleep(PROGRESS_POLL);
    }
}

/// §3.0-E: every relayed event carries the progress contract keys —
/// `phase` (the node id minus its `phase:` prefix), `spentCents` (from the
/// event's own cost block when canon reports one; `null` otherwise — never
/// inferred client-side); `item` / `index` / `total` pass through as canon
/// wrote them.
fn progress_contract(event: &mut serde_json::Map<String, Value>) {
    if let Some(node) = event.get("node").and_then(Value::as_str) {
        let phase = node.strip_prefix("phase:").unwrap_or(node).to_string();
        event.entry("phase").or_insert(Value::String(phase));
    }
    let spent = event.get("spent_cents").cloned().or_else(|| {
        event
            .get("cost")
            .and_then(|cost| cost.get("usd"))
            .and_then(Value::as_f64)
            .map(|usd| Value::from((usd * 100.0).round() as i64))
    });
    event.entry("spentCents").or_insert(spent.unwrap_or(Value::Null));
}

/// The `kept` list of the LAST `run_end` in a step log (canon's cancel-aware
/// `run_end` carries it); `None` when the log has no `run_end` yet.
fn kept_from_log(text: &str) -> Option<Vec<String>> {
    text.lines().rev().find_map(|line| {
        let event: Value = serde_json::from_str(line).ok()?;
        if event.get("event").and_then(Value::as_str) != Some("run_end") {
            return None;
        }
        Some(
            event
                .get("kept")
                .and_then(Value::as_array)
                .map(|kept| {
                    kept.iter()
                        .filter_map(|k| k.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
        )
    })
}

/// How many COMPLETE lines a log already holds (the relay's starting offset).
fn complete_lines(text: &str) -> usize {
    unsent_lines(text, 0).1
}

#[cfg(test)]
mod cancel_tests {
    use super::{cancel_file_path, kept_from_log, progress_contract, JobState};
    use serde_json::{json, Value};
    use std::path::Path;

    #[test]
    fn the_cancel_file_lives_under_the_packs_canon_dir() {
        let path = cancel_file_path(Path::new("/packs/demo"), "job-1");
        assert_eq!(path, Path::new("/packs/demo/.canon/cancel/job-1"));
    }

    #[test]
    fn a_queued_job_is_dropped_outright_and_the_worker_skips_it() {
        let state = JobState::default();
        state.mark_queued("a");
        state.mark_queued("b");
        assert!(state.cancel_queued("a"), "a was queued");
        assert!(!state.cancel_queued("a"), "a is no longer queued");
        assert!(!state.cancel_queued("zzz"), "unknown ids are not queued");
        // The worker reaches the jobs: a was dropped (skip), b was not.
        assert!(state.take_dropped("a"));
        assert!(!state.take_dropped("b"));
        assert!(!state.is_running("a"));
        assert!(state.child_finished("a"), "an unretained child counts as finished");
    }

    #[test]
    fn kept_comes_from_the_last_run_end() {
        let log = concat!(
            "{\"event\":\"run_start\"}\n",
            "{\"event\":\"run_end\",\"ok\":true,\"kept\":[\"old\"]}\n",
            "{\"event\":\"node_item\",\"node\":\"phase:x\",\"item\":\"a\"}\n",
            "{\"event\":\"run_end\",\"ok\":false,\"cancelled\":true,\"kept\":[\"phase:w\",\"phase:x:a\"]}\n",
        );
        assert_eq!(kept_from_log(log).unwrap(), vec!["phase:w", "phase:x:a"]);
        assert_eq!(kept_from_log("{\"event\":\"node_start\"}\n"), None);
        assert_eq!(kept_from_log("{\"event\":\"run_end\",\"ok\":true}\n").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn the_progress_contract_adds_phase_and_never_infers_spend() {
        let mut event = json!({"event": "node_item", "node": "phase:plat:sprite_art", "item": "hopper", "index": 2, "total": 5})
            .as_object()
            .unwrap()
            .clone();
        progress_contract(&mut event);
        assert_eq!(event["phase"], "plat:sprite_art");
        assert_eq!(event["spentCents"], Value::Null);
        assert_eq!(event["index"], 2);
        let mut priced = json!({"event": "node_done", "node": "phase:x", "cost": {"usd": 0.123}})
            .as_object()
            .unwrap()
            .clone();
        progress_contract(&mut priced);
        assert_eq!(priced["spentCents"], 12);
    }
}

/// The COMPLETE lines of `text` past the first `sent`, plus the new total.
///
/// Split out because it is the only fiddly part of the relay: we read a file
/// mid-write, so the last line may be a half-flushed record. Emitting it would
/// hand the UI a truncated JSON object and then never re-send the real one, so
/// a trailing partial is deliberately left for the next tick.
fn unsent_lines(text: &str, sent: usize) -> (Vec<&str>, usize) {
    let lines: Vec<&str> = text.lines().collect();
    let complete = if text.ends_with('\n') {
        lines.len()
    } else {
        lines.len().saturating_sub(1)
    };
    let fresh = lines
        .into_iter()
        .take(complete)
        .skip(sent.min(complete))
        .collect();
    (fresh, complete.max(sent))
}

#[cfg(test)]
mod step_log_tests {
    use super::unsent_lines;

    #[test]
    fn emits_each_whole_line_exactly_once_across_polls() {
        let mut sent = 0;
        let (fresh, seen) = unsent_lines("a\nb\n", sent);
        assert_eq!(fresh, vec!["a", "b"]);
        sent = seen;
        // Same content next tick (canon wrote nothing) — nothing re-sent.
        let (fresh, seen) = unsent_lines("a\nb\n", sent);
        assert!(fresh.is_empty());
        sent = seen;
        let (fresh, _) = unsent_lines("a\nb\nc\n", sent);
        assert_eq!(fresh, vec!["c"]);
    }

    #[test]
    fn holds_a_half_written_line_until_its_newline_lands() {
        // The file is read WHILE canon appends: emitting "cc" here would ship
        // truncated JSON and then never ship the real record.
        let (fresh, seen) = unsent_lines("a\nb\ncc", 0);
        assert_eq!(fresh, vec!["a", "b"]);
        assert_eq!(seen, 2);
        let (fresh, _) = unsent_lines("a\nb\nccc\n", seen);
        assert_eq!(fresh, vec!["ccc"]);
    }

    #[test]
    fn survives_an_empty_or_truncated_file() {
        assert_eq!(unsent_lines("", 0), (vec![], 0));
        assert_eq!(unsent_lines("partial", 0), (vec![], 0));
        // A file that somehow SHRANK never rewinds the counter, so a stale
        // read can't replay events the UI already folded in.
        let (fresh, seen) = unsent_lines("a\n", 5);
        assert!(fresh.is_empty());
        assert_eq!(seen, 5);
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
        "db".into(),
        "new".into(),
        root,
        "--type".into(),
        entity_type,
        "--fields".into(),
        fields_str,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if complete {
        args.push("--complete".into());
        args.push("--llm-backend".into());
        args.push(llm_backend.unwrap_or_else(|| "anthropic".into()));
        args = with_opt_flag(args, "--system-prompt", system_override);
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
        "db".into(),
        "complete".into(),
        root,
        "--type".into(),
        entity_type,
        "--id".into(),
        id,
        "--llm-backend".into(),
        llm_backend.unwrap_or_else(|| "anthropic".into()),
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if !locked.is_empty() {
        args.push("--locked".into());
        args.push(locked.join(","));
    }
    let args = with_opt_flag(args, "--system-prompt", system_override);
    run_canon_owned(with_env_file(args))
}

/// Resolve the canon repo checkout: CANON_REPO env wins; else derived from
/// CANON_BIN when it points into `<repo>/.venv/bin/`. Row P0-11 narrowed this
/// to what genuinely needs a CHECKOUT — the dev `.env` lookup and
/// `canon_python()`'s last leg. The play harness itself no longer asks: it
/// goes through the resolver, so a bundled app never needs a repo.
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

/// Pre-run cost estimate for a NEW project (world scope) at these counts +
/// backends. Backend-aware (fake/none = $0) and count-aware. No API keys — it
/// is pure pricing math, so it runs even without CANON_ENV_FILE. Console-script
/// path like every other verb: the estimators ship inside the canon package
/// (canon row P0-4), so the old `python -m canon.cli.main` detour is gone.
/// Row P0-10: `template` + a by-name `counts` map, so the SAME command prices
/// a platformer and a dungeon (`canon world estimate --template <id>` is P0-7's
/// verb, and it already answers one shape for every template). Cradle sends the
/// count names the wizard rendered from `pack templates`; a name the template
/// does not use is refused by canon with a reason, in `estimate.warnings`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn estimate_world(
    template: Option<String>,
    counts: std::collections::HashMap<String, u32>,
    llm_backend: String,
    image_backend: String,
    music_backend: String,
    sfx_backend: String,
    vlm_backend: String,
) -> Result<Value, String> {
    let mut args: Vec<String> = vec!["world".into(), "estimate".into()];
    args = with_opt_flag(args, "--template", template);
    let mut keys: Vec<&String> = counts.keys().collect();
    keys.sort();
    for key in keys {
        args.push(format!("--{key}"));
        args.push(counts[key].to_string());
    }
    args.push("--llm-backend".into());
    args.push(llm_backend);
    args.push("--image-backend".into());
    args.push(image_backend);
    args.push("--music-backend".into());
    args.push(music_backend);
    args.push("--sfx-backend".into());
    args.push(sfx_backend);
    args.push("--vlm-backend".into());
    args.push(vlm_backend);
    run_canon_owned(args)
}

/// The installed templates + their wizard metadata (`canon pack templates`,
/// P0 paper P.4.4). What the create wizard's two cards, its count fields, its
/// ranges and every progress surface's phase labels RENDER FROM — the
/// hardcoded `TEMPLATES` array and the hardcoded `plat:*` label map are gone
/// (master §3.0-E). Pack-less and pure read: this is asked before a pack
/// exists.
#[tauri::command]
fn pack_templates() -> Result<Value, String> {
    run_canon(&["pack", "templates"])
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
        "level".into(),
        "estimate".into(),
        root,
        "--level".into(),
        level_id,
        "--op".into(),
        op,
        "--llm-backend".into(),
        llm_backend,
    ];
    if let Some(w) = width {
        args.push("--width".into());
        args.push(w.to_string());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon(&refs)
}

/// Pre-run cost estimate for animating ONE actor. Priced BY STATES (one
/// img2img edit per state per facing) plus one VLM authoring call unless
/// `reuse_spec`. fake/none = $0 with the counts still shown.
#[tauri::command]
fn estimate_asset(
    path: String,
    target: String,
    op: String,
    image_backend: String,
    vlm_backend: String,
    reuse_spec: bool,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "asset".into(),
        "estimate".into(),
        root,
        "--target".into(),
        target,
        "--op".into(),
        op,
        "--image-backend".into(),
        image_backend,
        "--vlm-backend".into(),
        vlm_backend,
    ];
    if reuse_spec {
        args.push("--reuse-spec".into());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon(&refs)
}

/// The level graph (`canon world map`) — nodes, typed edges, areas. Pure read.
#[tauri::command]
fn world_map(path: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["world", "map", &root])
}

/// Hand-author the world map (`canon world map-edit`). Overrides are DURABLE:
/// the map is recomputed from the seed on every resume, so without them the
/// next run would silently revert the layout.
#[tauri::command]
fn world_map_edit(path: String, edit: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let edit_str = serde_json::to_string(&edit).map_err(|e| e.to_string())?;
    run_canon(&[
        "world",
        "map-edit",
        &root,
        "--json",
        &edit_str,
        "--actor",
        USER_ACTOR,
    ])
}

/// Append one paid-op spend entry to the pack's ledger (`canon spend record`) —
/// cradle records what each op it fired actually cost.
#[tauri::command]
fn spend_record(path: String, entry: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let entry_str = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    run_canon(&["spend", "record", &root, "--json", &entry_str])
}

/// The pack's spend ledger + roll-up (`canon spend list`). Row P1-A6: this is
/// now a DERIVED compat index — the cost dashboard reads the journal. Kept for
/// pre-A6 history and the create run, which journals no cost yet.
#[tauri::command]
fn spend_list(path: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["spend", "list", &root])
}

/// Append one background-job entry to the pack's ledger (`canon jobs record`).
/// Row P1-A6 closes the C11 gap: this existed only in the browser dev-mock, so
/// the native JobTray's Completed tab lost every run the moment the app quit.
/// Agent-launched and button-launched jobs now share ONE durable history.
#[tauri::command]
fn jobs_record(path: String, entry: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let entry_str = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    run_canon(&["jobs", "record", &root, "--json", &entry_str])
}

/// The pack's job ledger + roll-up for the job tray (`canon jobs list`).
/// Run STATUS only (P.8.7): its `actual_usd` is informational and the cost
/// dashboard never sums it.
#[tauri::command]
fn jobs_list(path: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["jobs", "list", &root])
}

/// The provenance journal — the cost dashboard's ONE source (row P1-A6,
/// `canon journal list`). Every filter is optional and passes straight
/// through; `summary` adds the by-kind / by-identity / by-conversation
/// roll-up, computed canon-side so the tables sum one field and reconcile.
/// Pure read: writes nothing.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn journal_list(
    path: String,
    identity: Option<String>,
    session: Option<String>,
    gen_kind: Option<String>,
    since: Option<String>,
    artifact_prefix: Option<String>,
    limit: Option<u32>,
    summary: Option<bool>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["journal".into(), "list".into(), root];
    for (flag, value) in [
        ("--identity", identity),
        ("--session", session),
        ("--gen-kind", gen_kind),
        ("--since", since),
        ("--artifact-prefix", artifact_prefix),
    ] {
        if let Some(v) = value {
            if !v.is_empty() {
                args.push(flag.into());
                args.push(v);
            }
        }
    }
    if let Some(n) = limit {
        args.push("--limit".into());
        args.push(n.to_string());
    }
    if summary.unwrap_or(false) {
        args.push("--summary".into());
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_canon(&argv)
}

/// Every measurable fact about one actor's animation (`canon anim inspect`):
/// the shared frame square, playback timing, authored offsets, and the measured
/// content box of every frame. Pure read.
#[tauri::command]
fn anim_inspect(path: String, target: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["anim", "inspect", &root, "--target", &target])
}

/// Hand-correct one animation state's playback (`canon anim edit`) — per-frame
/// offsets, per-frame durations, loop mode. Synchronous: a JSON patch, not a
/// generation run, so it stays out of the job queue.
#[tauri::command]
fn anim_edit(path: String, target: String, state: String, edit: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let edit_str = serde_json::to_string(&edit).map_err(|e| e.to_string())?;
    run_canon(&[
        "anim",
        "edit",
        &root,
        "--target",
        &target,
        "--state",
        &state,
        "--json",
        &edit_str,
        "--actor",
        USER_ACTOR,
    ])
}

/// Is this pack's Godot runtime current with canon's template
/// (`canon engine status`)? The runtime is COPIED into a pack when it is
/// generated, so a pack keeps whatever engine code existed that day and every
/// engine fix shipped since is invisible to it. Pure read.
#[tauri::command]
fn engine_status(path: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["engine", "status", &root])
}

/// Refresh a pack's Godot runtime from the template (`canon engine sync`).
/// Hand-edited runtime files are refused by name unless `force`; only the
/// runtime is touched, never generated content. Synchronous — it is a local
/// file copy, not a generation run, so it has no place in the job queue.
#[tauri::command]
fn engine_sync(path: String, dry_run: bool, force: bool) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<&str> = vec!["engine", "sync", &root, "--actor", USER_ACTOR];
    if dry_run {
        args.push("--dry-run");
    }
    if force {
        args.push("--force");
    }
    run_canon(&args)
}

/// The PLAT_* hooks turn the play surfaces into scripted/headless sessions
/// (capture, trajectory dumps, forced start level, plain rendering) — strip
/// them all so Play starts from a clean slate, then set only what we mean.
const PLAT_HOOK_VARS: [&str; 13] = [
    "PLAT_CAPTURE",
    "PLAT_TRAJ",
    "PLAT_HOLD",
    "PLAT_HOLD_JUMP_EVERY",
    "PLAT_ACTIONS",
    "PLAT_CAPTURE_TICKS",
    "PLAT_CAPTURE_EVERY",
    "PLAT_LEVEL",
    "PLAT_PLAIN",
    "PLAT_ANIM",
    "PLAT_ANIM_MODE",
    "PLAT_SANDBOX",
    "PLAT_SPAWN",
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
/// The harness ships INSIDE the canon wheel (`canon.packs.platformer.play`,
/// 2026-09-01) so it is spawned in module form — no script path, no source
/// checkout needed for the harness itself. Row P0-11: the interpreter now
/// comes from `canon_python()` — the same resolution the CLI uses — so ▶ Play
/// works in a bundled app with no repo and no Python on the machine.
/// `plain` plays WITHOUT art: palette blocks + placeholder shapes.
/// `anim_target` (`enemy:<id>` | `item:<id>` | `player` | `all`) opens the
/// ANIMATION VIEWER instead of the level, so a sprite's states can be judged
/// in the same surface that renders the game.
#[tauri::command]
// Pre-existing (the `spawn` arg took it to 8); the same allow `estimate_world`
// carries. Noted here rather than left to fail `-D warnings` in CI.
#[allow(clippy::too_many_arguments)]
fn play_level(
    app: AppHandle,
    path: String,
    level_id: String,
    plain: Option<bool>,
    anim_target: Option<String>,
    anim_mode: Option<String>,
    sandbox: Option<bool>,
    spawn: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let python = canon_python()?;
    let mut cmd = std::process::Command::new(&python);
    // The vendored interpreter gets the same isolation every canon spawn gets
    // (row P0-11): a stray user site-packages must not shadow the bundled
    // pygame. No-op for a developer's own venv.
    isolate_if_bundled(&mut cmd, &python);
    // Row P0-12: the play harness is a canon child too — it imports the same
    // pack code, and a level whose art is generated on demand needs the same
    // keys. It spawns `python` DIRECTLY rather than through `CanonCommand`,
    // so it calls the one env builder itself.
    apply_provider_env(&mut cmd);
    cmd.arg("-m")
        .arg("canon.packs.platformer.play")
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
        // grid = every state on its own clock (judge one pose); sequence =
        // the chain through the game's own state ladder (judge a transition).
        if let Some(m) = anim_mode.as_deref().map(str::trim) {
            if !m.is_empty() {
                cmd.env("PLAT_ANIM_MODE", m);
            }
        }
    }
    // The SANDBOX plays a level with no win condition and a HUD naming the
    // animation state the game picked and why — "how does it feel".
    let sandboxing = sandbox.unwrap_or(false);
    if sandboxing {
        cmd.env("PLAT_SANDBOX", "1");
    }
    // PLAT_SPAWN="x,y" (row P1-A4.5, `sandbox_level(level_id?, spawn?)`):
    // start the player at this cell; canon's `level sandbox --spawn` hands
    // it back in the `launch.env` block and this is where it is applied.
    if let Some(cell) = spawn.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.env("PLAT_SPAWN", cell);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch play harness: {e}"))?;
    let pid = reap_and_notify(app, child, "pygame");
    Ok(serde_json::json!({
        "launched": true,
        "engine": "pygame",
        "pid": pid,
        "mode": if !previewing.is_empty() { "anim" }
                else if sandboxing { "sandbox" } else { "play" },
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
    anim_mode: Option<String>,
    sandbox: Option<bool>,
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
    // Row P0-12: the candidate order lives in ONE detector (`tool_candidates`),
    // which the Environment pane also reports from — so what the pane says it
    // found is literally what this launch will try. Provider keys are
    // deliberately NOT injected here: Godot is an engine, not a canon child,
    // and it has no business holding a provider secret.
    let candidates: Vec<String> = tool_candidates(&GODOT)
        .into_iter()
        .map(|(_, bin)| bin)
        .collect();

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
            if let Some(m) = anim_mode.as_deref().map(str::trim) {
                if !m.is_empty() {
                    cmd.env("PLAT_ANIM_MODE", m);
                }
            }
        }
        let sandboxing = sandbox.unwrap_or(false);
        if sandboxing {
            cmd.env("PLAT_SANDBOX", "1");
        }
        match cmd.spawn() {
            Ok(child) => {
                let pid = reap_and_notify(app.clone(), child, "godot");
                return Ok(serde_json::json!({
                    "launched": true, "engine": "godot", "pid": pid,
                    "mode": if !previewing.is_empty() { "anim" }
                            else if sandboxing { "sandbox" } else { "play" },
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
    let mut args: Vec<String> = vec!["prompt".into(), "show".into(), root, "--kind".into(), kind];
    if let Some(l) = level_id {
        if !l.is_empty() {
            args.push("--level".into());
            args.push(l);
        }
    }
    if let Some(t) = target {
        if !t.is_empty() {
            args.push("--target".into());
            args.push(t);
        }
    }
    if let Some(i) = instruction {
        if !i.is_empty() {
            args.push("--instruction".into());
            args.push(i);
        }
    }
    if let Some(b) = brief {
        if !b.is_empty() {
            args.push("--brief".into());
            args.push(b);
        }
    }
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
        "asset",
        "restore",
        &root,
        "--target",
        &target,
        "--to",
        &to,
        "--actor",
        USER_ACTOR,
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
        "library",
        "publish",
        &root,
        "--target",
        &target,
        "--actor",
        USER_ACTOR,
    ])
}

/// Import a library entry into the open pack via `canon library import`.
#[tauri::command]
fn library_import(path: String, id: String, into: Option<String>) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "library".into(),
        "import".into(),
        root,
        "--id".into(),
        id,
        "--actor".into(),
        USER_ACTOR.into(),
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
        "asset",
        "assign",
        &root,
        "--source",
        &source,
        "--to",
        &to,
        "--actor",
        USER_ACTOR,
    ])
}

/// Direct human edit of an existing DB row (or tile type's gameplay knobs)
/// via `canon db update` — values land verbatim; canon rehashes, stamps
/// user_edited, and journals op=edit with the field diff.
#[tauri::command]
fn db_update(path: String, entity_type: String, id: String, set: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let set_str = serde_json::to_string(&set).map_err(|e| e.to_string())?;
    run_canon(&[
        "db",
        "update",
        &root,
        "--type",
        &entity_type,
        "--id",
        &id,
        "--set",
        &set_str,
        "--actor",
        USER_ACTOR,
    ])
}

// ── Dialogue verbs (row P0-9) ────────────────────────────────────────────────
// The editor calls canon; cradle never writes pack files (doctrine 1). The
// three read verbs write nothing and take no `--actor`; `dialogue update` is
// the ONE write and stamps `USER_ACTOR`, so the journal and the ledger can
// filter this session's edits from the agent's.
//
// `--ops`, `--tree` and `--state` go inline as JSON. Canon also accepts a file
// path or `-` for stdin; inline is right here because an edit buffer for a
// 30-node tree is a few KB, far inside the platform argument limit.

/// The NPC's trees, selectors, ranks and gates via `canon dialogue show`.
#[tauri::command]
fn dialogue_show(path: String, npc: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["dialogue", "show", &root, "--npc", &npc])
}

/// Apply the unsaved edit-op buffer as ONE batch via `canon dialogue update`.
/// Fail-closed canon-side: a single validation error writes nothing.
#[tauri::command]
fn dialogue_update(
    path: String,
    npc: String,
    ops: Value,
    session: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let ops_str = serde_json::to_string(&ops).map_err(|e| e.to_string())?;
    let mut args: Vec<String> = vec![
        "dialogue".into(),
        "update".into(),
        root,
        "--npc".into(),
        npc,
        "--ops".into(),
        ops_str,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    // A quest-scope save writes one NPC at a time; the SHARED session id is
    // what makes the journal read as one undo entry across them.
    if let Some(session) = session {
        args.push("--session".into());
        args.push(session);
    }
    run_canon_owned(args)
}

/// `{errors[], warnings[]}` for one NPC via `canon dialogue validate`.
#[tauri::command]
fn dialogue_validate(path: String, npc: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["dialogue", "validate", &root, "--npc", &npc])
}

/// Walk the UNSAVED tree payload against a simulated state via
/// `canon dialogue test`. The tester tests the buffer, not the file, so the
/// tree travels as a payload and never as a pack lookup.
#[tauri::command]
fn dialogue_test(
    path: String,
    tree: Value,
    state: Value,
    node: Option<String>,
    choose: Option<i64>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let tree_str = serde_json::to_string(&tree).map_err(|e| e.to_string())?;
    let state_str = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    let mut args: Vec<String> = vec![
        "dialogue".into(),
        "test".into(),
        root,
        "--tree".into(),
        tree_str,
        "--state".into(),
        state_str,
    ];
    if let Some(node) = node {
        args.push("--node".into());
        args.push(node);
    }
    if let Some(choose) = choose {
        args.push("--choose".into());
        args.push(choose.to_string());
    }
    run_canon_owned(args)
}

/// Which tree a state selects, and why each other one did not, via
/// `canon dialogue select`.
#[tauri::command]
fn dialogue_select(path: String, npc: String, state: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let state_str = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    run_canon(&[
        "dialogue", "select", &root, "--npc", &npc, "--state", &state_str,
    ])
}

/// `canon dialogue improve` — a PROPOSAL, never a write. `none` / `fake` are
/// canon's $0 deterministic copy pass; any other backend id is a real provider
/// call, which is the user's to run (doctrine 3) and is gated by the paid card
/// before this command is ever reached.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn dialogue_improve(
    path: String,
    npc: String,
    instruction: String,
    tree_id: Option<String>,
    scope: String,
    backend: String,
    model: Option<String>,
    keep_structure: bool,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let mut args: Vec<String> = vec![
        "dialogue".into(),
        "improve".into(),
        root,
        "--npc".into(),
        npc,
        "--instruction".into(),
        instruction,
        "--scope".into(),
        scope,
        "--backend".into(),
        backend,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(tree_id) = tree_id {
        args.push("--tree-id".into());
        args.push(tree_id);
    }
    if let Some(model) = model {
        args.push("--model".into());
        args.push(model);
    }
    args.push(if keep_structure {
        "--keep-structure".into()
    } else {
        "--allow-structure".into()
    });
    run_canon_owned(args)
}

// ── Scene verbs (row P0-9, step 12) ──────────────────────────────────────────
// A scene is an EVENT of type `scene`; its writes go through the event kind's
// row path and never touch `event_positions`. `scene update` is the one write
// and stamps `USER_ACTOR`; `validate` and `test` write nothing.

/// Apply the unsaved scene buffer as ONE batch via `canon scene update`.
#[tauri::command]
fn scene_update(
    path: String,
    scene: Option<String>,
    ops: Value,
    create: bool,
    title: String,
    session: Option<String>,
) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let ops_str = serde_json::to_string(&ops).map_err(|e| e.to_string())?;
    let mut args: Vec<String> = vec![
        "scene".into(),
        "update".into(),
        root,
        "--ops".into(),
        ops_str,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    if let Some(scene) = scene {
        args.push("--scene".into());
        args.push(scene);
    }
    if create {
        args.push("--create".into());
        args.push("--title".into());
        args.push(title);
    }
    if let Some(session) = session {
        args.push("--session".into());
        args.push(session);
    }
    run_canon_owned(args)
}

/// `{errors[], warnings[]}` for one scene row via `canon scene validate`.
#[tauri::command]
fn scene_validate(path: String, scene: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&["scene", "validate", &root, "--scene", &scene])
}

/// Play the UNSAVED scene payload against a simulated state that carries actor
/// presence, via `canon scene test`.
#[tauri::command]
fn scene_test(path: String, scene: Value, state: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let scene_str = serde_json::to_string(&scene).map_err(|e| e.to_string())?;
    let state_str = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    run_canon(&[
        "scene",
        "test",
        &root,
        "--scene-payload",
        &scene_str,
        "--state",
        &state_str,
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
fn db_update_schema(path: String, entity_type: String, set: Value) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    let set_str = serde_json::to_string(&set).map_err(|e| e.to_string())?;
    run_canon(&[
        "db",
        "schema",
        &root,
        "--type",
        &entity_type,
        "--set",
        &set_str,
        "--actor",
        USER_ACTOR,
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let args: Vec<String> = vec![
        "asset".into(),
        "generate".into(),
        root,
        "--target".into(),
        target,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    let args = with_opt_flag(args, "--image-backend", image_backend);
    let args = with_opt_flag(args, "--image-model", image_model);
    let args = with_opt_flag(args, "--image-edit-model", image_edit_model);
    let args = with_opt_flag(args, "--image-edit-backend", image_edit_backend);
    let args = with_opt_flag(args, "--music-backend", music_backend);
    let args = with_opt_flag(args, "--sfx-backend", sfx_backend);
    let args = with_opt_flag(args, "--prompt", prompt_override);
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
}

/// Animate one actor (multi-image path) via `canon asset animate`.
///
/// Carries canon's FULL parameter set: only `fal` and `fake` implement
/// `ImageEditBackend`, so only they can animate — the UI gates on that.
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
    let pack = canon(path);
    let root = pack.to_string_lossy().to_string();
    let args: Vec<String> = vec![
        "asset".into(),
        "animate".into(),
        root,
        "--target".into(),
        target,
        "--actor".into(),
        USER_ACTOR.into(),
    ];
    let args = with_opt_flag(args, "--image-backend", image_backend);
    let args = with_opt_flag(args, "--image-model", image_model);
    let args = with_opt_flag(args, "--image-edit-model", image_edit_model);
    let args = with_opt_flag(args, "--image-edit-backend", image_edit_backend);
    let args = with_opt_flag(args, "--vlm-backend", vlm_backend);
    let args = with_opt_flag(args, "--vlm-model", vlm_model);
    let mut args = args;
    if reuse_spec {
        args.push("--reuse-spec".into());
    }
    // Inert under --reuse-spec (which never authors); canon says so too.
    let args = with_opt_flag(args, "--prompt", prompt_override);
    enqueue(&app, &queue, job_id, with_env_file(args), pack)
}

/// Replace an asset's bytes with a user-picked PNG via `canon asset replace`
/// (rehash + regen protection + `op:"import"` journal, canon-side).
#[tauri::command]
fn replace_asset(path: String, target: String, file: String) -> Result<Value, String> {
    let root = canon(path).to_string_lossy().to_string();
    run_canon(&[
        "asset",
        "replace",
        &root,
        "--target",
        &target,
        "--from",
        &file,
        "--actor",
        USER_ACTOR,
    ])
}

/// Record `generate` provenance events for a level's as-generated artifacts
/// (called when cradle imports a fresh generation). Idempotent server-side.
#[tauri::command]
fn baseline_level(path: String, level_id: String) -> Result<Value, String> {
    let root = canon(path);
    let canon = canon_command();
    let output = canon
        .command()
        .args(["level", "baseline"])
        .arg(root.as_os_str())
        .args(["--level", &level_id, "--actor", "cradle"])
        .output()
        .map_err(|e| format!("failed to run '{}': {}", canon.display(), e))?;
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

// ===========================================================================
// Row P0-11 — THE VENDORED RUNTIME: one resolver, one probe (W3.3, W3.6).
//
// Before this row every spawn site spelled `std::env::var("CANON_BIN")
// .unwrap_or("canon")` for itself and the play harness derived its
// interpreter from `canon_repo_root()` — so a bundled app on a machine with
// no Python and no checkout had nothing to run. This block is the ONE
// resolution order W3.3 specifies, and every spawn site goes through it:
//
//   1. `CANON_BIN`          the dev override. Set, it WINS — unchanged.
//   2. the bundled runtime  `<resource_dir>/runtime/<triple>/python/…`, the
//                           tree `scripts/fetch-runtime.sh` builds and
//                           tauri.conf.json's `bundle.resources` ships.
//   3. `canon` on PATH      an ordinary `pip install canon-ai`.
//
// EXTENDS, never replaces: `get_bundled_demo_path`'s `resource_dir()`
// precedent (the dir is remembered once in `.setup` so the plain, non-command
// functions — `run_canon`, `run_job_child` — can consult it without an
// `AppHandle`), and the module-form spawn `play_level` already used.
//
// Why the bundled leg runs `<python> -m canon.cli.main` and never the `canon`
// console script: pip bakes an ABSOLUTE interpreter path into that script's
// shebang (and into the Windows `.exe` wrapper) at install time, and the
// build machine's path is not `/Applications/Cradle.app/…`. Module form has
// no shebang to break — and it is the form the play harness already used.
//
// Why the bundled leg is spawned with `PYTHONNOUSERSITE=1` and without
// `PYTHONHOME`/`PYTHONPATH`: a stray `~/.local/lib/python3.x/site-packages`
// on the user's machine otherwise shadows the vendored wheels with whatever
// they happen to have. `scripts/fetch-runtime.sh` installs under `-E -s` for
// the same reason; canon's own `world new` re-spawns `sys.executable`, and
// the env var — not the flag — is what that child inherits.
//
// Deliberately absent, by row ownership: keychain key delivery (P0-12 —
// `env_file_pairs`/`env_file_path` are untouched here) and the create flow's
// commands (P0-10).
// ===========================================================================

/// Which leg of the resolution order answered.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum CanonOrigin {
    /// `CANON_BIN` — a developer's checkout venv.
    Env,
    /// The runtime shipped inside the app bundle.
    Bundled,
    /// `canon` found on (or left to) PATH.
    Path,
}

impl CanonOrigin {
    fn as_str(self) -> &'static str {
        match self {
            CanonOrigin::Env => "env",
            CanonOrigin::Bundled => "bundled",
            CanonOrigin::Path => "path",
        }
    }
}

/// A resolved canon invocation. `prefix` is what rides BEFORE the verb:
/// empty for a `canon` executable, `["-m", "canon.cli.main"]` for the bundled
/// interpreter.
#[derive(Clone, Debug, PartialEq, Eq)]
struct CanonCommand {
    program: PathBuf,
    prefix: Vec<String>,
    origin: CanonOrigin,
}

impl CanonCommand {
    /// A `Command` with the prefix pushed and the bundled runtime's isolation
    /// applied. EVERY spawn site starts here instead of `Command::new`.
    fn command(&self) -> std::process::Command {
        let mut cmd = std::process::Command::new(&self.program);
        cmd.args(&self.prefix);
        if self.origin == CanonOrigin::Bundled {
            apply_runtime_isolation(&mut cmd);
        }
        // Row P0-12: provider keys reach EVERY canon child from here — the
        // verbs, the job worker, the agent sidecar and the startup probe all
        // build their command through this method, which is why the keychain
        // needed exactly one injection point.
        apply_provider_env(&mut cmd);
        cmd
    }

    /// What to SHOW a human — error copy, the sidecar's `command` field.
    fn display(&self) -> String {
        let mut out = self.program.to_string_lossy().into_owned();
        for a in &self.prefix {
            out.push(' ');
            out.push_str(a);
        }
        out
    }
}

/// Keep the vendored interpreter's own wheels in front of anything the user
/// happens to have installed. See this block's header for why this is
/// correctness, not hygiene.
fn apply_runtime_isolation(cmd: &mut std::process::Command) {
    cmd.env("PYTHONNOUSERSITE", "1");
    cmd.env_remove("PYTHONHOME");
    cmd.env_remove("PYTHONPATH");
    cmd.env_remove("PYTHONSTARTUP");
}

/// Same isolation for a command that runs `python` DIRECTLY (the play
/// harness) — applied only when that interpreter is the vendored one.
fn isolate_if_bundled(cmd: &mut std::process::Command, python: &std::path::Path) {
    if resource_dir().is_some_and(|dir| python.starts_with(dir)) {
        apply_runtime_isolation(cmd);
    }
}

/// The platform directory name under `resources/runtime/`. Rust's target
/// triple IS python-build-standalone's triple IS the manifest's `sha256` key
/// — one vocabulary, so `scripts/runtime-manifest.txt` and this function can
/// never drift into two spellings of the same platform.
fn runtime_triple() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        ""
    }
}

/// The interpreter inside a fetched runtime tree, for whichever platform this
/// build targets. Mirrors `fetch-runtime.sh`'s `py_rel`.
fn bundled_python(resource_dir: &std::path::Path) -> PathBuf {
    let root = resource_dir.join("runtime").join(runtime_triple());
    if cfg!(windows) {
        root.join("python").join("python.exe")
    } else {
        root.join("python").join("bin").join("python3")
    }
}

/// Executable names to look for when resolving a bare command on PATH.
fn path_candidates(name: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            format!("{name}.exe"),
            format!("{name}.cmd"),
            format!("{name}.bat"),
        ]
    } else {
        vec![name.to_string()]
    }
}

/// The first `name` on PATH — cradle's own tiny `which`, so the failure
/// screen can say "no `canon` on PATH" instead of guessing.
fn find_on_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        for candidate in path_candidates(name) {
            let file = dir.join(candidate);
            if file.is_file() {
                return Some(file);
            }
        }
    }
    None
}

/// One line of the resolution order, for the guided failure screen (W3.6:
/// "what was tried, in what order, and what to do").
#[derive(Clone, Debug, serde::Serialize)]
struct CanonLeg {
    /// Stable id — the screen renders copy from it, never parses `note`.
    leg: String,
    /// What was actually looked for. Absent when the leg had nothing to try.
    tried: Option<String>,
    found: bool,
    note: String,
}

/// The resolution order itself. PURE over its inputs so the ordering is unit
/// testable without a Tauri app: `env_bin` is `CANON_BIN`, `resource_dir` is
/// the app's resource directory (`None` outside a bundle), `path_canon` is
/// whatever `canon` PATH offers.
fn resolve_canon_from(
    env_bin: Option<String>,
    resource_dir: Option<&std::path::Path>,
    path_canon: Option<PathBuf>,
) -> (CanonCommand, Vec<CanonLeg>) {
    let mut legs = Vec::new();
    let mut chosen: Option<CanonCommand> = None;

    // 1. CANON_BIN — the dev override. When it is set it WINS even if it does
    //    not resolve: silently ignoring a developer's explicit choice would be
    //    worse than failing loudly at it (doctrine 4).
    match env_bin.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(bin) => {
            let as_path = PathBuf::from(bin);
            let exists = as_path.is_file() || find_on_path(bin).is_some();
            legs.push(CanonLeg {
                leg: "env".into(),
                tried: Some(bin.to_string()),
                found: exists,
                note: if exists {
                    "CANON_BIN is set and points at a file — the dev override wins.".into()
                } else {
                    "CANON_BIN is set but nothing is there. It still wins: cradle never silently \
                     ignores an explicit override. Unset it to fall through to the bundled runtime."
                        .into()
                },
            });
            chosen = Some(CanonCommand {
                program: as_path,
                prefix: Vec::new(),
                origin: CanonOrigin::Env,
            });
        }
        None => legs.push(CanonLeg {
            leg: "env".into(),
            tried: None,
            found: false,
            note: "CANON_BIN is not set (normal for an installed app).".into(),
        }),
    }

    // 2. The runtime inside the bundle.
    let bundled = resource_dir.map(bundled_python);
    match bundled.as_ref() {
        Some(python) if python.is_file() => {
            legs.push(CanonLeg {
                leg: "bundled".into(),
                tried: Some(python.to_string_lossy().into_owned()),
                found: true,
                note: format!(
                    "the vendored {} runtime that ships with the app",
                    runtime_triple()
                ),
            });
            chosen.get_or_insert(CanonCommand {
                program: python.clone(),
                prefix: vec!["-m".into(), "canon.cli.main".into()],
                origin: CanonOrigin::Bundled,
            });
        }
        Some(python) => legs.push(CanonLeg {
            leg: "bundled".into(),
            tried: Some(python.to_string_lossy().into_owned()),
            found: false,
            note: "no vendored runtime there. In a checkout run `npm run fetch-runtime`; in an \
                   installed app the download is damaged — reinstall it."
                .into(),
        }),
        None => legs.push(CanonLeg {
            leg: "bundled".into(),
            tried: None,
            found: false,
            note: "the app has no resource directory, so there is no bundled runtime to try."
                .into(),
        }),
    }

    // 3. `canon` on PATH.
    match path_canon {
        Some(exe) => {
            legs.push(CanonLeg {
                leg: "path".into(),
                tried: Some(exe.to_string_lossy().into_owned()),
                found: true,
                note: "`canon` on PATH".into(),
            });
            chosen.get_or_insert(CanonCommand {
                program: exe,
                prefix: Vec::new(),
                origin: CanonOrigin::Path,
            });
        }
        None => legs.push(CanonLeg {
            leg: "path".into(),
            tried: None,
            found: false,
            note: "no `canon` on PATH (`pip install canon-ai[cli,platformer]` puts one there)."
                .into(),
        }),
    }

    // Nothing answered: keep spawning bare `canon` so the failure a caller
    // sees is the same OS error it has always been — the screen, not a new
    // error class, is what changed.
    let command = chosen.unwrap_or(CanonCommand {
        program: PathBuf::from("canon"),
        prefix: Vec::new(),
        origin: CanonOrigin::Path,
    });
    (command, legs)
}

// ===========================================================================
// External-tool detection (row P0-12 / W3.5's Environment pane).
//
// Godot's `$GODOT_BIN → PATH → /Applications` order already existed inside
// `play_game`, where nothing could report it. Blender needs the SAME order
// (`design_handoff_3d` HANDOFF: "detected exactly like Godot"), and W2.2's
// row 1 is specced to CONSUME this detection rather than build a second one.
// So the order became data (`ToolSpec`), one resolver reads it, and both the
// launcher and the pane read the resolver.
// ===========================================================================

/// How one external tool is found, and what counts as a usable version.
struct ToolSpec {
    /// Stable id the UI renders copy from.
    id: &'static str,
    label: &'static str,
    /// The override env var, tried first.
    env_var: &'static str,
    /// The bare name to look for on PATH.
    path_name: &'static str,
    /// Well-known install locations, tried last (macOS app bundles today).
    app_paths: &'static [&'static str],
    /// The major version the recipes are pinned to, or `None` when any
    /// version is fine. A different major is REPORTED, never silently used.
    pinned_major: Option<u32>,
    /// Where to get it, for the not-installed copy.
    install: &'static str,
}

static GODOT: ToolSpec = ToolSpec {
    id: "godot",
    label: "Godot",
    env_var: "GODOT_BIN",
    path_name: "godot",
    app_paths: &["/Applications/Godot.app/Contents/MacOS/Godot"],
    // Packs carry their own `project.godot`; cradle pins no Godot major.
    pinned_major: None,
    install: "https://godotengine.org/download",
};

/// W2.2 consumes this. `design_handoff_3d`: pinned to **4.x LTS**,
/// version-gated — "a 5.0 install is reported, not silently used".
static BLENDER: ToolSpec = ToolSpec {
    id: "blender",
    label: "Blender",
    env_var: "BLENDER_BIN",
    path_name: "blender",
    app_paths: &["/Applications/Blender.app/Contents/MacOS/Blender"],
    pinned_major: Some(4),
    install: "https://www.blender.org/download/",
};

/// The candidate binaries for `spec`, in resolution order, each tagged with
/// the leg that produced it. Pure over the environment so a launcher and a
/// status read can never disagree about what will be tried.
fn tool_candidates(spec: &ToolSpec) -> Vec<(&'static str, String)> {
    let mut out: Vec<(&'static str, String)> = Vec::new();
    if let Ok(bin) = std::env::var(spec.env_var) {
        if !bin.trim().is_empty() {
            out.push(("env", bin));
        }
    }
    out.push(("path", spec.path_name.to_string()));
    for app in spec.app_paths {
        out.push(("app", (*app).to_string()));
    }
    out
}

/// How long a `--version` probe of an external tool may take before it is
/// called dead (the `probe_canon` precedent: a silent child never hangs a
/// command).
const TOOL_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// `Blender 4.2.5 LTS` / `4.3.stable.official` → `(4, "…")`. Parses the first
/// dotted number it finds, so both tools' `--version` shapes work.
fn parse_major(text: &str) -> Option<u32> {
    for token in text.split(|c: char| !(c.is_ascii_digit() || c == '.')) {
        if let Some((head, _)) = token.split_once('.') {
            if let Ok(n) = head.parse::<u32>() {
                return Some(n);
            }
        }
    }
    None
}

/// Run `<bin> --version` and return its trimmed first line.
fn tool_version(bin: &str) -> Option<String> {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("--version").stdin(std::process::Stdio::null());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(cmd.output());
    });
    let out = rx.recv_timeout(TOOL_PROBE_TIMEOUT).ok()?.ok()?;
    let text = if out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stderr).into_owned()
    } else {
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    text.lines()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
}

/// What the Environment pane shows for one tool: whether it was found, which
/// leg found it, the version, and — for a pinned tool — whether that version
/// passes the gate. `gate` is a stable id: `ok` · `unpinned` · `off_major` ·
/// `unknown` · `missing`.
fn detect_tool(spec: &ToolSpec) -> Value {
    let mut legs: Vec<CanonLeg> = Vec::new();
    let mut found: Option<(&'static str, String)> = None;
    for (leg, bin) in tool_candidates(spec) {
        let resolved = if std::path::Path::new(&bin).is_absolute() {
            std::path::Path::new(&bin).is_file().then(|| bin.clone())
        } else {
            find_on_path(&bin).map(|p| p.to_string_lossy().into_owned())
        };
        let note = match leg {
            "env" => format!("${} — the explicit override", spec.env_var),
            "path" => format!("`{}` on PATH", spec.path_name),
            _ => "a standard install location".to_string(),
        };
        legs.push(CanonLeg {
            leg: leg.to_string(),
            tried: Some(bin.clone()),
            found: resolved.is_some(),
            note,
        });
        if found.is_none() {
            if let Some(path) = resolved {
                found = Some((leg, path));
            }
        }
    }
    let Some((leg, path)) = found else {
        return serde_json::json!({
            "tool": spec.id,
            "label": spec.label,
            "env_var": spec.env_var,
            "found": false,
            "origin": null,
            "path": null,
            "version": null,
            "major": null,
            "gate": "missing",
            "note": format!(
                "{} is not installed here. Set ${} to its binary, put `{}` on PATH, or install it.",
                spec.label, spec.env_var, spec.path_name
            ),
            "install": spec.install,
            "legs": legs,
        });
    };
    let version = tool_version(&path);
    let major = version.as_deref().and_then(parse_major);
    let (gate, note) = match (spec.pinned_major, major) {
        (None, _) => ("unpinned", format!("{} is available.", spec.label)),
        (Some(want), Some(got)) if got == want => {
            ("ok", format!("{} {want}.x — the pinned major.", spec.label))
        }
        (Some(want), Some(got)) => (
            "off_major",
            format!(
                "{} {got}.x is installed; cradle's recipes are pinned to {want}.x LTS. \
                 It is reported, not silently used — point ${} at a {want}.x build to use it.",
                spec.label, spec.env_var
            ),
        ),
        (Some(want), None) => (
            "unknown",
            format!(
                "{} answered no version cradle could read, so the {want}.x gate cannot be checked.",
                spec.label
            ),
        ),
    };
    serde_json::json!({
        "tool": spec.id,
        "label": spec.label,
        "env_var": spec.env_var,
        "found": true,
        "origin": leg,
        "path": path,
        "version": version,
        "major": major,
        "gate": gate,
        "note": note,
        "install": spec.install,
        "legs": legs,
    })
}

/// The app's resource directory, remembered once at `.setup` so the plain
/// helper functions can reach it (`get_bundled_demo_path` has an `AppHandle`;
/// `run_canon` does not). `None` until setup runs, and in any test binary.
static RESOURCE_DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

fn remember_resource_dir(app: &AppHandle) {
    let _ = RESOURCE_DIR.set(app.path().resource_dir().ok());
}

fn resource_dir() -> Option<&'static std::path::Path> {
    RESOURCE_DIR.get()?.as_deref()
}

/// THE resolver. Every canon spawn in this file goes through it.
fn canon_command() -> CanonCommand {
    resolve_canon_from(
        std::env::var("CANON_BIN").ok(),
        resource_dir(),
        find_on_path("canon"),
    )
    .0
}

/// Grant the asset protocol the world the user just opened (W3.6).
///
/// Why the static scope cannot simply be a literal list: a pack lives
/// wherever its author keeps it, and Open… is the whole point of the start
/// screen. So `tauri.conf.json` narrows the static scope to the two places
/// cradle itself owns — `$RESOURCE/**` (the bundled demo, the vendored
/// runtime) and `$HOME/CradleProjects/**` (the project store) — and every
/// other root is granted HERE: one directory, after a user action, instead of
/// the `["**"]` that let a page ask for any file on the machine.
/// Idempotent: `allow_directory` inserts into a pattern set, so the repeated
/// calls one thumbnail-heavy screen makes cost a hash lookup.
fn allow_world_assets(app: &AppHandle, root: &std::path::Path) {
    if let Err(e) = app.asset_protocol_scope().allow_directory(root, true) {
        // Not fatal: the world still loads, its images just will not render.
        eprintln!("asset scope: could not grant {}: {e}", root.display());
    }
}

/// The interpreter that runs the pygame play harness (`python -m
/// canon.packs.platformer.play`) — derived from the SAME resolution as the
/// CLI, so a bundled app never needs a checkout. Extends `canon_repo_root()`
/// rather than replacing it: the old `<repo>/.venv` derivation stays as the
/// last leg so no developer's setup regresses.
fn canon_python() -> Result<PathBuf, String> {
    let resolved = canon_command();
    if resolved.origin == CanonOrigin::Bundled {
        return Ok(resolved.program);
    }
    // `canon` and its interpreter are siblings in every venv layout:
    //   <venv>/bin/canon         → <venv>/bin/python3
    //   <venv>\Scripts\canon.exe → <venv>\Scripts\python.exe
    let exe = if resolved.program.components().count() > 1 {
        Some(resolved.program.clone())
    } else {
        find_on_path(&resolved.program.to_string_lossy())
    };
    if let Some(dir) = exe.as_deref().and_then(std::path::Path::parent) {
        let names: &[&str] = if cfg!(windows) {
            &["python.exe", "python3.exe"]
        } else {
            &["python3", "python"]
        };
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    // The pre-P0-11 shape: CANON_REPO, or a CANON_BIN inside <repo>/.venv/bin.
    if let Ok(repo) = canon_repo_root() {
        let python = if cfg!(windows) {
            repo.join(".venv").join("Scripts").join("python.exe")
        } else {
            repo.join(".venv").join("bin").join("python")
        };
        if python.is_file() {
            return Ok(python);
        }
    }
    Err(format!(
        "no python for the play harness. canon resolved to `{}` and no interpreter sits beside it; \
         no bundled runtime answered either. Fix: set CANON_BIN to a venv's `canon` (dev), or \
         reinstall the app so its vendored runtime is intact.",
        resolved.display()
    ))
}

/// How long the startup probe waits for `canon --version` before calling the
/// runtime dead (the sidecar's `recv_timeout` precedent — a silent child must
/// never hang the app).
const CANON_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Run `canon --version` and read the two version fields back. Cheap by
/// design: it is the smallest verb canon has.
fn probe_canon(resolved: &CanonCommand) -> Result<Value, String> {
    let mut cmd = resolved.command();
    cmd.arg("--version");
    cmd.stdin(std::process::Stdio::null());
    let display = resolved.display();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(cmd.output());
    });
    let output = match rx.recv_timeout(CANON_PROBE_TIMEOUT) {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("`{display} --version` could not start: {e}")),
        Err(_) => {
            return Err(format!(
                "`{display} --version` did not answer in {} seconds.",
                CANON_PROBE_TIMEOUT.as_secs()
            ))
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(6).collect();
        let tail = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "on a signal".into());
        return Err(if tail.trim().is_empty() {
            format!("`{display} --version` exited {code} and said nothing.")
        } else {
            format!("`{display} --version` exited {code}: {tail}")
        });
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("`{display} --version` answered with something that is not JSON: {e}"))
}

/// The startup probe (W3.6). Returns what was tried, in what order, what
/// answered, and — when nothing did — the reason, so the guided screen can
/// render it instead of a raw "No such file or directory".
///
/// `async` on purpose: a `#[tauri::command]` on a plain fn runs on the MAIN
/// THREAD, and a probe that spawns a process there reads exactly like a
/// freeze. The work rides `spawn_blocking`.
#[tauri::command]
async fn runtime_status(app: AppHandle) -> Result<Value, String> {
    let resource = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || runtime_status_value(resource.as_deref()))
        .await
        .map_err(|e| format!("the runtime probe could not run: {e}"))
}

/// The probe's answer, as a plain function — so the Environment pane (row
/// P0-12) READS P0-11's resolver and probe rather than re-deriving "which
/// canon is this". One resolution, two readers.
fn runtime_status_value(resource: Option<&std::path::Path>) -> Value {
    let (resolved, legs) = resolve_canon_from(
        std::env::var("CANON_BIN").ok(),
        resource,
        find_on_path("canon"),
    );
    let probe = probe_canon(&resolved);
    serde_json::json!({
        "ok": probe.is_ok(),
        "origin": resolved.origin.as_str(),
        "command": resolved.display(),
        "triple": runtime_triple(),
        "resource_dir": resource.map(|p| p.to_string_lossy().into_owned()),
        "legs": legs,
        "version": probe.as_ref().ok().cloned(),
        "error": probe.err(),
    })
}

/// Everything W3.5's **Environment** pane shows, in one stateless read: the
/// effective canon (bundled vs `CANON_BIN`, straight from P0-11's resolver +
/// probe), Godot detection, `BLENDER_BIN` detection beside it with its version
/// gate, and where the project store is.
///
/// `async` for the same reason `runtime_status` is: it spawns up to three
/// `--version` children, and doing that on the main thread reads as a freeze.
#[tauri::command]
async fn environment_status(app: AppHandle) -> Result<Value, String> {
    let resource = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        serde_json::json!({
            "canon": runtime_status_value(resource.as_deref()),
            "godot": detect_tool(&GODOT),
            "blender": detect_tool(&BLENDER),
            "project_store": project_store().unwrap_or_else(|e| serde_json::json!({
                "root": null, "exists": false, "source": "error", "error": e,
            })),
            "config_dir": keys::config_dir().map(|p| p.to_string_lossy().into_owned()),
        })
    })
    .await
    .map_err(|e| format!("the environment probe could not run: {e}"))
}

#[cfg(test)]
mod runtime_tests {
    use super::{bundled_python, probe_canon, resolve_canon_from, runtime_triple, CanonOrigin};
    use std::path::{Path, PathBuf};

    /// The runtime tree `scripts/fetch-runtime.sh` builds, if it has been run
    /// on this machine. `cargo test` must pass with and without it.
    fn payload_resources() -> Option<PathBuf> {
        let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        bundled_python(&resources).is_file().then_some(resources)
    }

    #[test]
    fn canon_bin_wins_and_is_spawned_exactly_as_given() {
        let (cmd, legs) = resolve_canon_from(
            Some("/venv/bin/canon".into()),
            Some(Path::new("/app/Resources")),
            Some(PathBuf::from("/usr/local/bin/canon")),
        );
        assert_eq!(cmd.origin, CanonOrigin::Env);
        assert_eq!(cmd.program, PathBuf::from("/venv/bin/canon"));
        assert!(cmd.prefix.is_empty(), "an executable takes no prefix args");
        // Every leg is still reported — the screen shows the whole order.
        assert_eq!(legs.len(), 3);
        assert_eq!(legs[0].leg, "env");
        assert_eq!(legs[1].leg, "bundled");
        assert_eq!(legs[2].leg, "path");
    }

    #[test]
    fn an_empty_canon_bin_is_not_an_override() {
        let (cmd, legs) = resolve_canon_from(
            Some("   ".into()),
            None,
            Some(PathBuf::from("/usr/local/bin/canon")),
        );
        assert_eq!(cmd.origin, CanonOrigin::Path);
        assert!(!legs[0].found);
    }

    #[test]
    fn path_answers_when_there_is_no_override_and_no_bundle() {
        let (cmd, legs) =
            resolve_canon_from(None, None, Some(PathBuf::from("/usr/local/bin/canon")));
        assert_eq!(cmd.origin, CanonOrigin::Path);
        assert_eq!(cmd.program, PathBuf::from("/usr/local/bin/canon"));
        assert!(legs[2].found);
    }

    #[test]
    fn nothing_resolving_still_spawns_bare_canon_and_names_all_three_legs() {
        let (cmd, legs) = resolve_canon_from(None, Some(Path::new("/nope/Resources")), None);
        assert_eq!(cmd.program, PathBuf::from("canon"));
        assert!(legs.iter().all(|l| !l.found));
        // The screen's whole job: what was tried, in what order.
        assert!(legs[1].tried.as_deref().unwrap().contains("runtime"));
        assert!(legs[1].note.contains("fetch-runtime"));
    }

    #[test]
    fn the_bundled_leg_runs_the_module_never_the_console_script() {
        let Some(resources) = payload_resources() else {
            eprintln!("skipped: no runtime payload — run `npm run fetch-runtime` to exercise this");
            return;
        };
        let (cmd, legs) = resolve_canon_from(None, Some(&resources), None);
        assert_eq!(cmd.origin, CanonOrigin::Bundled);
        assert_eq!(
            cmd.prefix,
            vec!["-m".to_string(), "canon.cli.main".to_string()]
        );
        let interpreter = if cfg!(windows) {
            "python.exe"
        } else {
            "python3"
        };
        assert!(cmd.program.ends_with(interpreter));
        assert!(legs[1].found);
        assert!(cmd.display().contains(runtime_triple()));
    }

    #[test]
    fn the_probe_reads_a_version_out_of_the_bundled_runtime() {
        let Some(resources) = payload_resources() else {
            eprintln!("skipped: no runtime payload — run `npm run fetch-runtime` to exercise this");
            return;
        };
        let (cmd, _) = resolve_canon_from(None, Some(&resources), None);
        let version = probe_canon(&cmd).expect("the vendored runtime answers --version");
        assert!(version.get("canon_version").is_some(), "got {version}");
    }

    #[test]
    fn a_runtime_that_is_not_there_fails_by_name_not_by_hang() {
        let (cmd, _) = resolve_canon_from(Some("/definitely/not/a/canon".into()), None, None);
        let err = probe_canon(&cmd).unwrap_err();
        assert!(err.contains("/definitely/not/a/canon"), "got {err}");
        assert!(err.contains("could not start"), "got {err}");
    }
}

/// Row P0-12 — key STATUS and external-tool detection.
///
/// The keychain round-trip itself lives in `keys.rs` beside the store. What is
/// pinned here is the part the frontend actually consumes: that a status read
/// carries names and sources and NEVER a value, and that Godot and Blender are
/// found by the one detector in the one documented order.
#[cfg(test)]
mod settings_tests {
    use super::{
        apply_provider_env_from, detect_tool, parse_major, provider_keys, tool_candidates, BLENDER,
        GODOT,
    };
    use crate::keys::KeyStore;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cradle-env-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The ONE child-environment builder. Before row P0-12 there were two —
    /// `--env-file` for canon verbs and an inline `env_file_pairs()` loop for
    /// the sidecar — so "which keys does a child see?" had two answers. This
    /// pins the merged answer AND its precedence: the keychain wins, because
    /// a key the user added in Settings is the most explicit statement of
    /// intent on the machine, and canon's `os.environ.setdefault` means the
    /// child's environment beats any env file it is also handed.
    #[test]
    fn every_child_gets_the_keys_and_the_keychain_wins() {
        let dir = temp_dir("inject");
        let store = KeyStore::with("cradle-test-inject", Some(dir.clone()), true);
        store.set("FAL_KEY", "from-the-store").unwrap();

        let mut cmd = std::process::Command::new("true");
        apply_provider_env_from(
            &mut cmd,
            &store,
            vec![
                ("FAL_KEY".into(), "from-the-env-file".into()),
                ("GOOGLE_API_KEY".into(), "only-in-the-env-file".into()),
            ],
        );
        let env: std::collections::HashMap<String, Option<String>> = cmd
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(env["FAL_KEY"].as_deref(), Some("from-the-store"));
        // The env file still supplies what the store does not carry.
        assert_eq!(
            env["GOOGLE_API_KEY"].as_deref(),
            Some("only-in-the-env-file")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A machine with nothing stored injects nothing — which is also why a
    /// fresh install never raises a keychain prompt before its first key.
    #[test]
    fn an_empty_store_injects_nothing() {
        let dir = temp_dir("empty");
        let store = KeyStore::with("cradle-test-empty-inject", Some(dir.clone()), true);
        let mut cmd = std::process::Command::new("true");
        apply_provider_env_from(&mut cmd, &store, Vec::new());
        assert_eq!(cmd.get_envs().count(), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_status_read_reports_names_and_sources_only() {
        let secret = "sk-this-value-must-never-appear";
        std::env::set_var("CRADLE_P012_TEST_API_KEY", secret);
        let doc = provider_keys(Some(vec!["CRADLE_P012_TEST_API_KEY".into()]));
        let flat = doc.to_string();
        std::env::remove_var("CRADLE_P012_TEST_API_KEY");

        // The name and the source are there…
        assert!(flat.contains("CRADLE_P012_TEST_API_KEY"), "{flat}");
        let row = doc["vars"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["name"] == "CRADLE_P012_TEST_API_KEY")
            .expect("the asked-for var is reported");
        assert_eq!(row["set"], true);
        assert_eq!(row["source"], "env");
        // …and the value is not, in any form — not raw, not its length.
        assert!(!flat.contains(secret), "a key VALUE reached the frontend");
        assert!(!flat.contains(&secret.len().to_string()));
    }

    /// The PixelLab shape, pinned. `PIXELLAB_SECRET` — canon's own canonical
    /// name — ends in neither `_API_KEY` nor anything else the discovery scan
    /// recognises, so a status read that decided `env` by NAME SHAPE reported
    /// a correctly-exported key as "not set" and the create wizard refused a
    /// working machine. Every asked-for name is now resolved by name.
    #[test]
    fn a_var_whose_name_is_not_api_key_shaped_is_still_seen_in_the_environment() {
        let secret = "pixellab-value-that-must-never-appear";
        std::env::set_var("CRADLE_P012_TEST_SECRET", secret);
        let doc = provider_keys(Some(vec!["CRADLE_P012_TEST_SECRET".into()]));
        std::env::remove_var("CRADLE_P012_TEST_SECRET");
        let row = doc["vars"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["name"] == "CRADLE_P012_TEST_SECRET")
            .expect("the asked-for var is reported");
        assert_eq!(row["set"], true);
        assert_eq!(row["source"], "env");
        assert!(!doc.to_string().contains(secret));
    }

    #[test]
    fn an_unset_var_is_reported_unset_rather_than_omitted() {
        let doc = provider_keys(Some(vec!["CRADLE_P012_ABSENT_KEY".into()]));
        let row = doc["vars"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["name"] == "CRADLE_P012_ABSENT_KEY")
            .expect("doctrine 4: an absent key is shown with its reason, never hidden");
        assert_eq!(row["set"], false);
        assert!(row["source"].is_null());
    }

    #[test]
    fn both_tools_are_detected_in_the_one_documented_order() {
        // `$X_BIN` → PATH → /Applications, for BOTH tools — the shared order
        // `design_handoff_3d` asks for ("detected exactly like Godot").
        for (spec, var) in [(&GODOT, "GODOT_BIN"), (&BLENDER, "BLENDER_BIN")] {
            std::env::set_var(var, "/tmp/an-explicit-override");
            let legs: Vec<&str> = tool_candidates(spec).iter().map(|(leg, _)| *leg).collect();
            std::env::remove_var(var);
            assert_eq!(
                legs.first(),
                Some(&"env"),
                "{} tries its override first",
                spec.id
            );
            assert!(legs.contains(&"path"));
            assert!(legs.contains(&"app"));
        }
    }

    /// A tool nothing on this machine can satisfy — the not-installed state,
    /// which must name the override var and the install pointer rather than
    /// rendering an empty row (doctrine 4). Its own spec, so the test does not
    /// depend on whether the developer happens to have Blender.
    static ABSENT: super::ToolSpec = super::ToolSpec {
        id: "absent",
        label: "Nothing",
        env_var: "CRADLE_P012_ABSENT_BIN",
        path_name: "cradle-p012-absent-binary",
        app_paths: &["/definitely/not/here/Nothing"],
        pinned_major: Some(4),
        install: "https://example.invalid/install",
    };

    #[test]
    fn a_missing_tool_says_what_to_do_instead_of_nothing() {
        let doc = detect_tool(&ABSENT);
        assert_eq!(doc["found"], false);
        assert_eq!(doc["gate"], "missing");
        assert!(doc["note"]
            .as_str()
            .unwrap()
            .contains("CRADLE_P012_ABSENT_BIN"));
        assert!(doc["install"].as_str().unwrap().starts_with("https://"));
        // Every leg is still reported, so the pane shows the whole order.
        assert_eq!(doc["legs"].as_array().unwrap().len(), 2);
        let legs = doc["legs"].as_array().unwrap();
        assert!(legs.iter().all(|l| l["found"] == false));
    }

    /// The real Blender detection on THIS machine — whatever the answer, the
    /// shape is complete and the gate is one of the named ids.
    #[test]
    fn blender_detection_answers_in_the_pane_shape() {
        let doc = detect_tool(&BLENDER);
        assert_eq!(doc["tool"], "blender");
        assert_eq!(doc["env_var"], "BLENDER_BIN");
        assert!(["ok", "off_major", "unknown", "missing"].contains(&doc["gate"].as_str().unwrap()));
        assert!(!doc["note"].as_str().unwrap().is_empty());
    }

    #[test]
    fn the_blender_version_gate_reads_a_major() {
        assert_eq!(parse_major("Blender 4.2.5 LTS"), Some(4));
        assert_eq!(parse_major("Blender 5.0.0"), Some(5));
        assert_eq!(parse_major("4.3.stable.official.abcdef"), Some(4));
        assert_eq!(parse_major("no numbers here"), None);
        // The gate is pinned to 4.x LTS; Godot is unpinned.
        assert_eq!(BLENDER.pinned_major, Some(4));
        assert_eq!(GODOT.pinned_major, None);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            source: Arc::new(LocalFsDataSource),
        })
        // Row P1-A5: the agent sidecar slot (see the sidecar block above).
        .manage(AgentSidecar::default())
        .setup(|app| {
            // Row P0-11: remember the resource directory once, so the plain
            // helper functions (`run_canon`, `run_job_child`, `canon_python`)
            // can reach the vendored runtime without an `AppHandle`. Must run
            // before anything spawns canon.
            remember_resource_dir(app.handle());
            // Serial generation queue: one worker thread drains jobs FIFO so paid
            // ops run off the UI thread. The Sender lives in managed state (app
            // lifetime), so the worker loop never ends until the app exits.
            let (tx, rx) = std::sync::mpsc::channel::<QueuedJob>();
            // Row P1-A4.5: the worker and the `cancel_job` command share the
            // Child-retention state (the one process-tracking path, §3.0-D).
            let state = Arc::new(JobState::default());
            app.manage(JobQueue {
                tx: std::sync::Mutex::new(tx),
                state: state.clone(),
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || run_job_worker(handle, rx, state));
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
            roll_grid_step,
            restore_grid_step,
            replace_asset,
            db_types,
            db_new,
            db_complete,
            db_update,
            db_schema,
            db_update_schema,
            dialogue_show,
            dialogue_update,
            dialogue_validate,
            dialogue_test,
            dialogue_select,
            dialogue_improve,
            scene_update,
            scene_validate,
            scene_test,
            play_level,
            play_game,
            validate_level,
            preview_prompt,
            // Row P0-12: keys + Settings. `provider_keys` reports names and
            // SOURCES; set/delete are write-only; `provider_rows` is canon's
            // table verbatim; the test is user-initiated and never generates.
            provider_keys,
            set_provider_key,
            delete_provider_key,
            provider_rows,
            test_provider_key,
            environment_status,
            set_project_store,
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
            sandbox_level,
            new_project,
            project_store,
            pack_templates,
            cancel_job,
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
            estimate_asset,
            world_map,
            world_map_edit,
            spend_record,
            spend_list,
            jobs_record,
            jobs_list,
            journal_list,
            engine_status,
            engine_sync,
            anim_inspect,
            anim_edit,
            get_bundled_demo_path,
            // Row P0-11: the startup probe behind the guided failure screen.
            runtime_status,
            // Row P1-A5: the agent sidecar's lifecycle.
            agent_start,
            agent_stop,
            agent_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // App quit stops the sidecar (row P1-A5): POST /shutdown, then
            // reap. `--parent-pid` is the belt to this suspender.
            if let tauri::RunEvent::Exit = event {
                if let Some(sidecar) = app.try_state::<AgentSidecar>() {
                    let taken = match sidecar.current.lock() {
                        Ok(mut s) => s.take(),
                        Err(e) => e.into_inner().take(),
                    };
                    if let Some(p) = taken {
                        stop_sidecar(p);
                    }
                }
            }
        });
}
