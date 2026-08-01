use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSummary {
    pub path: String,
    pub name: String,
    pub entity_counts: Vec<EntityTypeCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityTypeCount {
    pub type_id: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityRef {
    pub type_id: String,
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityRow {
    pub id: String,
    pub data: Value,
}

pub trait DataSource: Send + Sync {
    fn load_world(&self, path: &Path) -> Result<WorldSummary, String>;
    fn get_world_bible(&self, path: &Path) -> Result<Value, String>;
    fn read_world_json(&self, path: &Path, name: &str) -> Result<Value, String>;
    fn list_entities(&self, path: &Path, type_id: &str) -> Result<Vec<EntityRef>, String>;
    fn list_entity_rows(&self, path: &Path, type_id: &str) -> Result<Vec<EntityRow>, String>;
    fn get_entity(&self, path: &Path, type_id: &str, id: &str) -> Result<Value, String>;
    fn resolve_asset(&self, path: &Path, hint: &str) -> Option<String>;
}

pub struct LocalFsDataSource;

const ENTITY_TYPES: &[&str] = &[
    "npcs", "items", "monsters", "quests", "rooms", "events", "classes", "music", "sfx",
];

const AUDIO_TYPES: &[&str] = &["music", "sfx"];

fn is_audio_type(type_id: &str) -> bool {
    AUDIO_TYPES.contains(&type_id)
}

fn audio_file_stems(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let fname = entry.file_name().to_string_lossy().to_string();
        let lower = fname.to_lowercase();
        if lower.ends_with(".mp3") || lower.ends_with(".wav") || lower.ends_with(".ogg") {
            if let Some(stem) = Path::new(&fname).file_stem().and_then(|s| s.to_str()) {
                out.push(stem.to_string());
            }
        }
    }
    out.sort();
    Ok(out)
}

fn synthesize_audio_entity(type_id: &str, id: &str, filename: &str) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("name".into(), Value::String(id.to_string()));
    m.insert("filename".into(), Value::String(filename.to_string()));
    m.insert("kind".into(), Value::String(type_id.to_string()));
    Value::Object(m)
}

/// The PLAYER row, synthesized. No pack has a `player.json` — canon keeps the
/// hero's art under `sprite/player/` and its physics in the manifest, with no
/// row file anywhere — but canon DOES treat `player` as a first-class asset
/// target (`asset generate`/`animate`/`replace`, library publish, lineage), so
/// the editor was the only place it didn't exist.
///
/// Shaped like an enemy row (`sprite_path` + `stats.animation`) so every
/// existing surface — Portrait, the card grid, the animation preview — works
/// on it unchanged. Same synthesize-a-row precedent as audio above.
fn synthesize_player_entity(root: &Path) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("player_id".into(), Value::String("player".into()));
    m.insert("artifact_id".into(), Value::String("player".into()));
    m.insert("name".into(), Value::String("Player".into()));
    m.insert("kind".into(), Value::String("player".into()));
    // Empty (not null, not absent) when there is no art: the portrait
    // resolvers pick the first NON-EMPTY hint, and canon itself writes "" for
    // "no art" — matching that keeps the loud fallback working.
    let base = root.join("sprite/player/base.png");
    m.insert(
        "sprite_path".into(),
        Value::String(if base.is_file() { "sprite/player/base.png".into() } else { String::new() }),
    );
    if let Some(frames) = read_json_opt(&root.join("sprite/player/frames.json")) {
        let mut anim = serde_json::Map::new();
        let states: Vec<Value> = frames
            .as_object()
            .map(|o| o.keys().map(|k| Value::String(k.clone())).collect())
            .unwrap_or_default();
        anim.insert("states".into(), frames);
        m.insert("animation_states".into(), Value::Array(states));
        let mut stats = serde_json::Map::new();
        stats.insert("animation".into(), Value::Object(anim));
        m.insert("stats".into(), Value::Object(stats));
    }
    if let Some(manifest) = read_json_opt(&root.join("manifest.json")) {
        if let Some(movement) = manifest.get("movement") {
            m.insert("movement".into(), movement.clone());
        }
    }
    Value::Object(m)
}

/// One ref when the pack has player art, none otherwise — a pack generated
/// without the art track shows `Player (0)`, exactly as `audio` already does.
fn platformer_player_refs(root: &Path) -> Result<Vec<EntityRef>, String> {
    let has_art = root.join("sprite/player/base.png").is_file()
        || root.join("sprite/player/frames.json").is_file();
    Ok(if has_art {
        vec![EntityRef {
            type_id: "player".into(),
            id: "player".into(),
            name: Some("Player".into()),
        }]
    } else {
        Vec::new()
    })
}

pub fn canon_world_root(input: &Path) -> PathBuf {
    // If the user selected a `/data` subfolder that actually contains world_bible.json,
    // treat the parent as the canonical world root. Otherwise return the path unchanged.
    let last = input.file_name().and_then(|n| n.to_str());
    if last == Some("data") && input.join("world_bible.json").is_file() {
        if let Some(parent) = input.parent() {
            return parent.to_path_buf();
        }
    }
    input.to_path_buf()
}

// ---------------------------------------------------------------------------
// Platformer pack support
//
// Canon's platformer output is grid/tilemap-centric and structurally distinct
// from MazeWorld (see `manifest.json` + `world.json` + `level/<stage>/<level>/`
// + `enemy/<id>.json`, no `world_bible.json`). We detect it and expose two
// entity types — `levels` and `enemies` — instead of the MazeWorld set. Level
// geometry (binary `.npz` grids) is NOT read here; the frontend renders a level
// from the JSON bundle emitted by `canon level export`, which we shell out to.
// ---------------------------------------------------------------------------

pub fn is_platformer_pack(root: &Path) -> bool {
    root.join("manifest.json").is_file() && root.join("level").is_dir()
}

fn read_json_opt(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn platformer_level_display_names(root: &Path) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    if let Some(nodes) = read_json_opt(&root.join("manifest.json"))
        .as_ref()
        .and_then(|m| m.get("world_map"))
        .and_then(|w| w.get("nodes"))
        .and_then(|n| n.as_array())
    {
        for node in nodes {
            if let (Some(lid), Some(dn)) = (
                node.get("level_id").and_then(|x| x.as_str()),
                node.get("display_name").and_then(|x| x.as_str()),
            ) {
                out.insert(lid.to_string(), dn.to_string());
            }
        }
    }
    out
}

fn platformer_level_order(root: &Path) -> Vec<String> {
    read_json_opt(&root.join("manifest.json"))
        .and_then(|m| {
            m.get("levels").and_then(|l| l.as_array()).map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
        })
        .unwrap_or_default()
}

fn platformer_level_refs(root: &Path) -> Result<Vec<EntityRef>, String> {
    let display = platformer_level_display_names(root);
    let order = platformer_level_order(root);
    // Discover levels on disk (level/<stage>/<level>/level.json), carrying each
    // level's parent_level so secret rooms can slot in beside their parent.
    let mut found: Vec<(String, Option<String>)> = Vec::new();
    let level_root = root.join("level");
    if level_root.is_dir() {
        for stage in std::fs::read_dir(&level_root).map_err(|e| e.to_string())? {
            let stage = stage.map_err(|e| e.to_string())?;
            if !stage.path().is_dir() {
                continue;
            }
            for lvl in std::fs::read_dir(stage.path()).map_err(|e| e.to_string())? {
                let lvl = lvl.map_err(|e| e.to_string())?;
                let level_json = lvl.path().join("level.json");
                if level_json.is_file() {
                    if let Some(name) = lvl.file_name().to_str() {
                        let parent = read_json_opt(&level_json).and_then(|v| {
                            v.get("parent_level")
                                .and_then(|x| x.as_str())
                                .map(|s| s.to_string())
                        });
                        found.push((name.to_string(), parent));
                    }
                }
            }
        }
    }
    // Manifest play-order; a secret room sorts DIRECTLY AFTER its parent level
    // (never as a trailing appendix — with 100 levels that's unusable).
    let pos = |id: &str| order.iter().position(|x| x == id).unwrap_or(usize::MAX);
    let key = |entry: &(String, Option<String>)| {
        let (id, parent) = entry;
        match parent {
            Some(p) => (pos(p.as_str()), 1u8, id.clone()),
            None => (pos(id.as_str()), 0u8, id.clone()),
        }
    };
    found.sort_by(|a, b| key(a).cmp(&key(b)));
    Ok(found
        .into_iter()
        .map(|(id, parent)| {
            let name = if parent.is_some() {
                format!("↳ {}", id)
            } else {
                display.get(&id).cloned().unwrap_or_else(|| id.clone())
            };
            EntityRef {
                type_id: "levels".to_string(),
                name: Some(name),
                id,
            }
        })
        .collect())
}

/// Flat per-file DBs: `<dir>/<id>.json` with a display `name` field
/// (enemy/, item/).
fn platformer_file_db_refs(root: &Path, dir: &str, type_id: &str) -> Result<Vec<EntityRef>, String> {
    let base = root.join(dir);
    let mut out = Vec::new();
    if base.is_dir() {
        for entry in std::fs::read_dir(&base).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let fname = entry.file_name().to_string_lossy().to_string();
            if let Some(stem) = fname.strip_suffix(".json") {
                let name = read_json_opt(&entry.path())
                    .and_then(|v| {
                        v.get("name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| stem.to_string());
                out.push(EntityRef {
                    type_id: type_id.to_string(),
                    id: stem.to_string(),
                    name: Some(name),
                });
            }
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Per-stage manifest DBs: `<dir>/<stage>/manifest.json`
/// (tileset/, backdrop/, audio/). The stage id is the entity id.
fn platformer_stage_manifest_refs(
    root: &Path,
    dir: &str,
    type_id: &str,
) -> Result<Vec<EntityRef>, String> {
    let base = root.join(dir);
    let mut out = Vec::new();
    if base.is_dir() {
        for entry in std::fs::read_dir(&base).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().join("manifest.json").is_file() {
                if let Some(stage) = entry.file_name().to_str() {
                    out.push(EntityRef {
                        type_id: type_id.to_string(),
                        id: stage.to_string(),
                        name: Some(stage.to_string()),
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// The platformer catalog: every browsable type and its refs.
const PLATFORMER_TYPES: &[&str] = &[
    "levels", "player", "enemies", "items", "tilesets", "backdrops", "audio",
];

fn platformer_refs(root: &Path, type_id: &str) -> Result<Vec<EntityRef>, String> {
    match type_id {
        "levels" => platformer_level_refs(root),
        "player" => platformer_player_refs(root),
        "enemies" => platformer_file_db_refs(root, "enemy", "enemies"),
        "items" => platformer_file_db_refs(root, "item", "items"),
        "tilesets" => platformer_stage_manifest_refs(root, "tileset", "tilesets"),
        "backdrops" => platformer_stage_manifest_refs(root, "backdrop", "backdrops"),
        "audio" => platformer_stage_manifest_refs(root, "audio", "audio"),
        _ => Ok(Vec::new()),
    }
}

fn find_level_json(root: &Path, level_id: &str) -> Option<PathBuf> {
    let level_root = root.join("level");
    if let Ok(stages) = std::fs::read_dir(&level_root) {
        for stage in stages.flatten() {
            let candidate = stage.path().join(level_id).join("level.json");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

impl LocalFsDataSource {
    fn data_root(world_path: &Path) -> PathBuf {
        let data = world_path.join("data");
        if data.is_dir() {
            data
        } else {
            world_path.to_path_buf()
        }
    }

    fn read_json(path: &Path) -> Result<Value, String> {
        let s =
            std::fs::read_to_string(path).map_err(|e| format!("read {}: {}", path.display(), e))?;
        serde_json::from_str(&s).map_err(|e| format!("parse {}: {}", path.display(), e))
    }

    fn collection_entries(root: &Path, type_id: &str) -> Result<Vec<EntityRef>, String> {
        if is_audio_type(type_id) {
            let stems = audio_file_stems(&root.join(type_id))?;
            return Ok(stems
                .into_iter()
                .map(|id| EntityRef {
                    type_id: type_id.to_string(),
                    name: Some(id.clone()),
                    id,
                })
                .collect());
        }
        let flat = root.join(type_id).join(format!("{}.json", type_id));
        if flat.is_file() {
            let v = Self::read_json(&flat)?;
            return Ok(Self::extract_refs(type_id, &v));
        }
        let dir = root.join(type_id);
        if dir.is_dir() {
            let mut out = Vec::new();
            for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().to_string();
                let id = name.trim_end_matches(".json").to_string();
                out.push(EntityRef {
                    type_id: type_id.to_string(),
                    id,
                    name: None,
                });
            }
            out.sort_by(|a, b| a.id.cmp(&b.id));
            return Ok(out);
        }
        Ok(Vec::new())
    }

    fn extract_refs(type_id: &str, v: &Value) -> Vec<EntityRef> {
        fn display_name(item: &Value) -> Option<String> {
            for key in ["name", "title", "environment_name"] {
                if let Some(s) = item.get(key).and_then(|n| n.as_str()) {
                    return Some(s.to_string());
                }
            }
            None
        }
        match v {
            Value::Array(a) => a
                .iter()
                .enumerate()
                .map(|(i, item)| {
                    let id = item
                        .get("id")
                        .map(|x| x.to_string().trim_matches('"').to_string())
                        .unwrap_or_else(|| i.to_string());
                    let name = display_name(item);
                    EntityRef {
                        type_id: type_id.to_string(),
                        id,
                        name,
                    }
                })
                .collect(),
            Value::Object(o) => o
                .iter()
                .map(|(k, item)| {
                    let name = display_name(item);
                    EntityRef {
                        type_id: type_id.to_string(),
                        id: k.clone(),
                        name,
                    }
                })
                .collect(),
            _ => Vec::new(),
        }
    }
}

impl DataSource for LocalFsDataSource {
    fn load_world(&self, path: &Path) -> Result<WorldSummary, String> {
        let root = Self::data_root(path);
        if !root.is_dir() {
            return Err(format!("world path is not a directory: {}", path.display()));
        }
        let mut counts = Vec::new();
        if is_platformer_pack(&root) {
            for t in PLATFORMER_TYPES {
                counts.push(EntityTypeCount {
                    type_id: (*t).to_string(),
                    count: platformer_refs(&root, t)?.len(),
                });
            }
        } else {
            for t in ENTITY_TYPES {
                let refs = Self::collection_entries(&root, t)?;
                counts.push(EntityTypeCount {
                    type_id: (*t).to_string(),
                    count: refs.len(),
                });
            }
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("world")
            .to_string();
        Ok(WorldSummary {
            path: path.to_string_lossy().to_string(),
            name,
            entity_counts: counts,
        })
    }

    fn get_world_bible(&self, path: &Path) -> Result<Value, String> {
        let bible = Self::data_root(path).join("world_bible.json");
        Self::read_json(&bible)
    }

    fn read_world_json(&self, path: &Path, name: &str) -> Result<Value, String> {
        if name.contains("..") || name.contains('/') || name.contains('\\') {
            return Err(format!("invalid name: {}", name));
        }
        let fname = if name.ends_with(".json") {
            name.to_string()
        } else {
            format!("{}.json", name)
        };
        let target = Self::data_root(path).join(&fname);
        Self::read_json(&target)
    }

    fn list_entities(&self, path: &Path, type_id: &str) -> Result<Vec<EntityRef>, String> {
        let root = Self::data_root(path);
        if is_platformer_pack(&root) {
            return platformer_refs(&root, type_id);
        }
        Self::collection_entries(&root, type_id)
    }

    fn list_entity_rows(&self, path: &Path, type_id: &str) -> Result<Vec<EntityRow>, String> {
        let root = Self::data_root(path);
        if is_platformer_pack(&root) {
            let refs = platformer_refs(&root, type_id)?;
            return Ok(refs
                .into_iter()
                .map(|r| {
                    let data = self.get_entity(path, type_id, &r.id).unwrap_or(Value::Null);
                    EntityRow { id: r.id, data }
                })
                .collect());
        }
        if is_audio_type(type_id) {
            let dir = root.join(type_id);
            let stems = audio_file_stems(&dir)?;
            return Ok(stems
                .into_iter()
                .map(|id| {
                    let filename = format!("{}.mp3", id);
                    EntityRow {
                        id: id.clone(),
                        data: synthesize_audio_entity(type_id, &id, &filename),
                    }
                })
                .collect());
        }
        let flat = root.join(type_id).join(format!("{}.json", type_id));
        if flat.is_file() {
            let v = Self::read_json(&flat)?;
            return Ok(match v {
                Value::Array(a) => a
                    .into_iter()
                    .enumerate()
                    .map(|(i, item)| {
                        let id = item
                            .get("id")
                            .map(|x| x.to_string().trim_matches('"').to_string())
                            .unwrap_or_else(|| i.to_string());
                        EntityRow { id, data: item }
                    })
                    .collect(),
                Value::Object(o) => o
                    .into_iter()
                    .map(|(id, data)| EntityRow { id, data })
                    .collect(),
                _ => Vec::new(),
            });
        }
        let dir = root.join(type_id);
        if dir.is_dir() {
            let mut rows = Vec::new();
            for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().to_string();
                let id = name.trim_end_matches(".json").to_string();
                let data = self.get_entity(path, type_id, &id).unwrap_or(Value::Null);
                rows.push(EntityRow { id, data });
            }
            rows.sort_by(|a, b| a.id.cmp(&b.id));
            return Ok(rows);
        }
        Ok(Vec::new())
    }

    fn resolve_asset(&self, path: &Path, hint: &str) -> Option<String> {
        // Invariant: never return a path outside the current world's tree.
        // Canon emits absolute paths into a shared MazeWorld scratch dir, which
        // is the same for every generation — so a naive fallback to the raw
        // hint makes every world show the last-generated image.
        let root = Self::data_root(path);
        let world_root = path;
        let normalized = hint.replace('\\', "/");
        let basename = Path::new(&normalized)
            .file_name()?
            .to_string_lossy()
            .to_string();

        let under_world = |p: &Path| -> bool { p.starts_with(&root) || p.starts_with(world_root) };
        let accept = |p: PathBuf| -> Option<String> {
            if p.exists() && under_world(&p) {
                Some(p.to_string_lossy().into())
            } else {
                None
            }
        };

        // Platformer packs reference assets by output-relative path
        // (sprite/…, tileset/…, review/…, music/…): resolve directly against
        // the pack root. `join` passes absolute hints through unchanged, so
        // the same accept() containment check covers both forms.
        if is_platformer_pack(&root) {
            if let Some(s) = accept(root.join(&normalized)) {
                return Some(s);
            }
        }

        // 1) Audio lookup by basename. Path::join silently returns an absolute
        //    argument unchanged, so we must match on basename — never on the
        //    raw hint — to avoid escaping the world tree.
        let lower = basename.to_lowercase();
        if lower.ends_with(".mp3") || lower.ends_with(".wav") || lower.ends_with(".ogg") {
            for sub in ["music", "sfx"] {
                if let Some(s) = accept(root.join(sub).join(&basename)) {
                    return Some(s);
                }
            }
        }

        // 2) Re-root the hint against the current world's tree.
        if let Some(idx) = normalized.find("data/portraits/") {
            let suffix = &normalized[idx + "data/".len()..];
            if let Some(s) = accept(root.join(suffix)) {
                return Some(s);
            }
            if let Some(s) = accept(world_root.join(&normalized[idx..])) {
                return Some(s);
            }
        }
        if let Some(idx) = normalized.find("portraits/") {
            if let Some(s) = accept(root.join(&normalized[idx..])) {
                return Some(s);
            }
        }

        // 3) Basename lookup in each portrait subfolder.
        for sub in ["npcs", "monsters", "items", "events", "classes", "maps", ""] {
            if let Some(s) = accept(root.join("portraits").join(sub).join(&basename)) {
                return Some(s);
            }
        }

        None
    }

    fn get_entity(&self, path: &Path, type_id: &str, id: &str) -> Result<Value, String> {
        let root = Self::data_root(path);
        if is_platformer_pack(&root) {
            match type_id {
                "levels" => {
                    let lp = find_level_json(&root, id)
                        .ok_or_else(|| format!("level {} not found", id))?;
                    return Self::read_json(&lp);
                }
                "player" => {
                    return Ok(synthesize_player_entity(&root));
                }
                "enemies" => {
                    return Self::read_json(&root.join("enemy").join(format!("{}.json", id)));
                }
                "items" => {
                    return Self::read_json(&root.join("item").join(format!("{}.json", id)));
                }
                "tilesets" => {
                    return Self::read_json(&root.join("tileset").join(id).join("manifest.json"));
                }
                "backdrops" => {
                    return Self::read_json(&root.join("backdrop").join(id).join("manifest.json"));
                }
                "audio" => {
                    return Self::read_json(&root.join("audio").join(id).join("manifest.json"));
                }
                _ => {}
            }
        }
        if is_audio_type(type_id) {
            let dir = root.join(type_id);
            let stems = audio_file_stems(&dir)?;
            if !stems.contains(&id.to_string()) {
                return Err(format!("{} entry {} not found", type_id, id));
            }
            return Ok(synthesize_audio_entity(type_id, id, &format!("{}.mp3", id)));
        }
        let flat = root.join(type_id).join(format!("{}.json", type_id));
        if flat.is_file() {
            let v = Self::read_json(&flat)?;
            match v {
                Value::Array(a) => {
                    for (i, item) in a.iter().enumerate() {
                        let matches_id = item
                            .get("id")
                            .map(|x| x.to_string().trim_matches('"').to_string())
                            == Some(id.to_string());
                        let matches_index = i.to_string() == id;
                        if matches_id || (item.get("id").is_none() && matches_index) {
                            return Ok(item.clone());
                        }
                    }
                    return Err(format!("entity {}/{} not found", type_id, id));
                }
                Value::Object(o) => {
                    if let Some(v) = o.get(id) {
                        return Ok(v.clone());
                    }
                    return Err(format!("entity {}/{} not found", type_id, id));
                }
                other => return Ok(other),
            }
        }
        let direct = root.join(type_id).join(format!("{}.json", id));
        if direct.is_file() {
            return Self::read_json(&direct);
        }
        let nested_dir = root.join(type_id).join(id);
        if nested_dir.is_dir() {
            let mut files: Vec<(String, Value)> = Vec::new();
            for entry in std::fs::read_dir(&nested_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if let Some(stem) = fname.strip_suffix(".json") {
                    files.push((stem.to_string(), Self::read_json(&entry.path())?));
                }
            }
            if files.len() == 1 {
                return Ok(files.into_iter().next().unwrap().1);
            }
            let obj: serde_json::Map<String, Value> = files.into_iter().collect();
            return Ok(Value::Object(obj));
        }
        Err(format!(
            "entity {}/{} not found under {}",
            type_id,
            id,
            root.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    struct WorldFixture {
        _tmp: TempDir,
        root: PathBuf,
    }

    impl WorldFixture {
        fn new() -> Self {
            let tmp = TempDir::new().unwrap();
            let root = tmp.path().to_path_buf();
            Self { _tmp: tmp, root }
        }

        fn write_json(&self, rel: &str, value: &Value) {
            let full = self.root.join(rel);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(&full, serde_json::to_string(value).unwrap()).unwrap();
        }

        fn write_bytes(&self, rel: &str, bytes: &[u8]) {
            let full = self.root.join(rel);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(&full, bytes).unwrap();
        }
    }

    // --- canon_world_root ---

    #[test]
    fn canon_world_root_walks_up_from_data_subdir() {
        let f = WorldFixture::new();
        f.write_json("world_bible.json", &json!({"story": {}}));
        // When the user picks `<root>/data` but world_bible.json lives one up,
        // we treat the parent as the real world root.
        let data_dir = f.root.join("data");
        fs::create_dir_all(&data_dir).unwrap();
        // world_bible needs to be inside the `data` dir we're "stepping up from"
        // to trigger the walk.
        fs::write(data_dir.join("world_bible.json"), "{}").unwrap();

        let out = canon_world_root(&data_dir);
        assert_eq!(out, f.root);
    }

    #[test]
    fn canon_world_root_returns_input_when_not_a_data_dir() {
        let f = WorldFixture::new();
        let out = canon_world_root(&f.root);
        assert_eq!(out, f.root);
    }

    #[test]
    fn canon_world_root_returns_input_when_data_has_no_bible() {
        let f = WorldFixture::new();
        let data_dir = f.root.join("data");
        fs::create_dir_all(&data_dir).unwrap();
        let out = canon_world_root(&data_dir);
        assert_eq!(out, data_dir);
    }

    // --- load_world ---

    #[test]
    fn load_world_errors_on_non_directory() {
        let f = WorldFixture::new();
        let bogus = f.root.join("nope");
        let res = LocalFsDataSource.load_world(&bogus);
        assert!(res.is_err());
    }

    #[test]
    fn load_world_counts_entities_from_flat_collection_and_dir() {
        let f = WorldFixture::new();
        f.write_json(
            "data/npcs/npcs.json",
            &json!([
                {"id": "npc_a", "name": "Alice"},
                {"id": "npc_b", "name": "Bob"},
            ]),
        );
        f.write_json("data/quests/q1.json", &json!({"id": "q1", "title": "One"}));
        f.write_json("data/quests/q2.json", &json!({"id": "q2", "title": "Two"}));

        let summary = LocalFsDataSource.load_world(&f.root).unwrap();
        let npcs = summary
            .entity_counts
            .iter()
            .find(|c| c.type_id == "npcs")
            .unwrap();
        let quests = summary
            .entity_counts
            .iter()
            .find(|c| c.type_id == "quests")
            .unwrap();
        assert_eq!(npcs.count, 2);
        assert_eq!(quests.count, 2);
    }

    #[test]
    fn load_world_counts_audio_files_by_stem() {
        let f = WorldFixture::new();
        f.write_bytes("data/music/theme.mp3", b"id3");
        f.write_bytes("data/music/battle.wav", b"riff");
        f.write_bytes("data/music/notes.txt", b"ignored");
        f.write_bytes("data/sfx/boom.ogg", b"blob");

        let summary = LocalFsDataSource.load_world(&f.root).unwrap();
        let music = summary
            .entity_counts
            .iter()
            .find(|c| c.type_id == "music")
            .unwrap();
        let sfx = summary
            .entity_counts
            .iter()
            .find(|c| c.type_id == "sfx")
            .unwrap();
        assert_eq!(music.count, 2);
        assert_eq!(sfx.count, 1);
    }

    #[test]
    fn load_world_works_without_data_subdir() {
        // If there's no `data/` dir, the world root itself is used.
        let f = WorldFixture::new();
        f.write_json("npcs/npcs.json", &json!([{"id": "npc_a", "name": "Alice"}]));
        let summary = LocalFsDataSource.load_world(&f.root).unwrap();
        let npcs = summary
            .entity_counts
            .iter()
            .find(|c| c.type_id == "npcs")
            .unwrap();
        assert_eq!(npcs.count, 1);
    }

    // --- list_entities / extract_refs ---

    #[test]
    fn list_entities_from_array_uses_id_field_and_display_name() {
        let f = WorldFixture::new();
        f.write_json(
            "data/npcs/npcs.json",
            &json!([
                {"id": "npc_a", "name": "Alice"},
                {"id": "npc_b", "name": "Bob"},
            ]),
        );
        let refs = LocalFsDataSource.list_entities(&f.root, "npcs").unwrap();
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].id, "npc_a");
        assert_eq!(refs[0].name.as_deref(), Some("Alice"));
    }

    #[test]
    fn list_entities_from_object_uses_keys_as_ids() {
        let f = WorldFixture::new();
        f.write_json(
            "data/rooms/rooms.json",
            &json!({
                "room_1": {"name": "Entry"},
                "room_2": {"environment_name": "Crypt"},
            }),
        );
        let mut refs = LocalFsDataSource.list_entities(&f.root, "rooms").unwrap();
        refs.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(refs[0].id, "room_1");
        assert_eq!(refs[0].name.as_deref(), Some("Entry"));
        // environment_name is a fallback display source.
        assert_eq!(refs[1].name.as_deref(), Some("Crypt"));
    }

    #[test]
    fn list_entities_from_per_file_dir() {
        let f = WorldFixture::new();
        f.write_json("data/quests/q1.json", &json!({"id": "q1"}));
        f.write_json("data/quests/q2.json", &json!({"id": "q2"}));
        let refs = LocalFsDataSource.list_entities(&f.root, "quests").unwrap();
        assert_eq!(refs.len(), 2);
        let ids: Vec<_> = refs.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"q1"));
        assert!(ids.contains(&"q2"));
    }

    #[test]
    fn list_entities_uses_name_then_title_then_environment_name() {
        let f = WorldFixture::new();
        f.write_json(
            "data/items/items.json",
            &json!([
                {"id": "a", "name": "N", "title": "T", "environment_name": "E"},
                {"id": "b", "title": "T", "environment_name": "E"},
                {"id": "c", "environment_name": "E"},
                {"id": "d"},
            ]),
        );
        let refs = LocalFsDataSource.list_entities(&f.root, "items").unwrap();
        let by_id: std::collections::HashMap<_, _> = refs
            .iter()
            .map(|r| (r.id.as_str(), r.name.as_deref()))
            .collect();
        assert_eq!(by_id["a"], Some("N"));
        assert_eq!(by_id["b"], Some("T"));
        assert_eq!(by_id["c"], Some("E"));
        assert_eq!(by_id["d"], None);
    }

    #[test]
    fn list_entities_returns_empty_when_type_missing() {
        let f = WorldFixture::new();
        let refs = LocalFsDataSource.list_entities(&f.root, "npcs").unwrap();
        assert!(refs.is_empty());
    }

    // --- get_entity ---

    #[test]
    fn get_entity_from_flat_array_by_id() {
        let f = WorldFixture::new();
        f.write_json(
            "data/npcs/npcs.json",
            &json!([
                {"id": "npc_a", "name": "Alice"},
                {"id": "npc_b", "name": "Bob"},
            ]),
        );
        let v = LocalFsDataSource
            .get_entity(&f.root, "npcs", "npc_b")
            .unwrap();
        assert_eq!(v.get("name").and_then(|n| n.as_str()), Some("Bob"));
    }

    #[test]
    fn get_entity_from_flat_object_by_key() {
        let f = WorldFixture::new();
        f.write_json(
            "data/rooms/rooms.json",
            &json!({"room_1": {"name": "Entry"}}),
        );
        let v = LocalFsDataSource
            .get_entity(&f.root, "rooms", "room_1")
            .unwrap();
        assert_eq!(v.get("name").and_then(|n| n.as_str()), Some("Entry"));
    }

    #[test]
    fn get_entity_from_direct_file() {
        let f = WorldFixture::new();
        f.write_json("data/quests/q1.json", &json!({"id": "q1", "title": "One"}));
        let v = LocalFsDataSource
            .get_entity(&f.root, "quests", "q1")
            .unwrap();
        assert_eq!(v.get("title").and_then(|t| t.as_str()), Some("One"));
    }

    #[test]
    fn get_entity_errors_when_missing() {
        let f = WorldFixture::new();
        f.write_json("data/npcs/npcs.json", &json!([]));
        assert!(LocalFsDataSource
            .get_entity(&f.root, "npcs", "ghost")
            .is_err());
    }

    #[test]
    fn get_entity_synthesizes_audio_rows() {
        let f = WorldFixture::new();
        f.write_bytes("data/music/theme.mp3", b"id3");
        let v = LocalFsDataSource
            .get_entity(&f.root, "music", "theme")
            .unwrap();
        assert_eq!(
            v.get("filename").and_then(|s| s.as_str()),
            Some("theme.mp3")
        );
        assert_eq!(v.get("kind").and_then(|s| s.as_str()), Some("music"));
    }

    // --- read_world_json ---

    #[test]
    fn read_world_json_reads_top_level_file() {
        let f = WorldFixture::new();
        f.write_json("data/manifest.json", &json!({"seed": 7}));
        let v = LocalFsDataSource
            .read_world_json(&f.root, "manifest")
            .unwrap();
        assert_eq!(v.get("seed").and_then(|n| n.as_i64()), Some(7));
    }

    #[test]
    fn read_world_json_rejects_path_traversal() {
        let f = WorldFixture::new();
        assert!(LocalFsDataSource
            .read_world_json(&f.root, "../etc/passwd")
            .is_err());
        assert!(LocalFsDataSource
            .read_world_json(&f.root, "sub/manifest")
            .is_err());
        assert!(LocalFsDataSource
            .read_world_json(&f.root, "foo\\bar")
            .is_err());
    }

    // --- resolve_asset ---

    #[test]
    fn resolve_asset_finds_audio_by_basename() {
        let f = WorldFixture::new();
        f.write_bytes("data/music/theme.mp3", b"id3");
        // Even if the hint is an absolute path from a different machine,
        // we must find the in-world file and ignore the stray prefix.
        let hint = "/some/other/world/music/theme.mp3";
        let out = LocalFsDataSource.resolve_asset(&f.root, hint);
        let resolved = out.expect("audio should resolve by basename");
        assert!(resolved.ends_with("theme.mp3"));
        assert!(resolved.contains(f.root.to_string_lossy().as_ref()));
    }

    #[test]
    fn resolve_asset_rejects_paths_outside_world() {
        let f = WorldFixture::new();
        // No matching file in-world → None, never the raw absolute hint.
        let out = LocalFsDataSource.resolve_asset(&f.root, "/etc/hosts");
        assert!(out.is_none());
    }

    #[test]
    fn resolve_asset_rehomes_portrait_paths() {
        let f = WorldFixture::new();
        f.write_bytes("data/portraits/npcs/alice.png", b"png");
        // Hint with stale absolute prefix pointing at a different world.
        let hint = "/scratch/mazeworld/runs/abc/data/portraits/npcs/alice.png";
        let out = LocalFsDataSource.resolve_asset(&f.root, hint).unwrap();
        assert!(out.ends_with("alice.png"));
        assert!(out.contains("portraits/npcs"));
    }

    #[test]
    fn resolve_asset_falls_back_to_basename_search() {
        let f = WorldFixture::new();
        f.write_bytes("data/portraits/monsters/ogre.png", b"png");
        let out = LocalFsDataSource
            .resolve_asset(&f.root, "ogre.png")
            .unwrap();
        assert!(out.ends_with("ogre.png"));
    }
}
