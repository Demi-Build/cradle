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
    fn update_entity(
        &self,
        path: &Path,
        type_id: &str,
        id: &str,
        data: &Value,
    ) -> Result<(), String>;
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

    // Tmpfile in the target's parent dir + rename. Same-FS rename is atomic
    // on Unix/Windows, so a flat-collection write can't be torn into
    // half-written corruption.
    fn atomic_write(target: &Path, contents: &[u8]) -> Result<(), String> {
        let dir = target
            .parent()
            .ok_or_else(|| format!("target has no parent directory: {}", target.display()))?;
        std::fs::create_dir_all(dir).map_err(|e| format!("create dir {}: {}", dir.display(), e))?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir)
            .map_err(|e| format!("tempfile in {}: {}", dir.display(), e))?;
        use std::io::Write;
        tmp.write_all(contents)
            .map_err(|e| format!("write tmp for {}: {}", target.display(), e))?;
        tmp.flush()
            .map_err(|e| format!("flush tmp for {}: {}", target.display(), e))?;
        tmp.persist(target)
            .map_err(|e| format!("persist {}: {}", target.display(), e.error))?;
        Ok(())
    }

    fn write_json(target: &Path, value: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec_pretty(value)
            .map_err(|e| format!("serialize {}: {}", target.display(), e))?;
        bytes.push(b'\n');
        Self::atomic_write(target, &bytes)
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
        for t in ENTITY_TYPES {
            let refs = Self::collection_entries(&root, t)?;
            counts.push(EntityTypeCount {
                type_id: (*t).to_string(),
                count: refs.len(),
            });
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
        Self::collection_entries(&Self::data_root(path), type_id)
    }

    fn list_entity_rows(&self, path: &Path, type_id: &str) -> Result<Vec<EntityRow>, String> {
        let root = Self::data_root(path);
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

    fn update_entity(
        &self,
        path: &Path,
        type_id: &str,
        id: &str,
        data: &Value,
    ) -> Result<(), String> {
        let root = Self::data_root(path);
        if is_audio_type(type_id) {
            return Err("audio entities are not editable".to_string());
        }
        let flat = root.join(type_id).join(format!("{}.json", type_id));
        if flat.is_file() {
            let v = Self::read_json(&flat)?;
            let next = match v {
                Value::Array(mut a) => {
                    let mut replaced = false;
                    for (i, item) in a.iter_mut().enumerate() {
                        let matches_id = item
                            .get("id")
                            .map(|x| x.to_string().trim_matches('"').to_string())
                            == Some(id.to_string());
                        let matches_index = i.to_string() == id;
                        if matches_id || (item.get("id").is_none() && matches_index) {
                            *item = data.clone();
                            replaced = true;
                            break;
                        }
                    }
                    if !replaced {
                        return Err(format!("entity {}/{} not found", type_id, id));
                    }
                    Value::Array(a)
                }
                Value::Object(mut o) => {
                    if !o.contains_key(id) {
                        return Err(format!("entity {}/{} not found", type_id, id));
                    }
                    o.insert(id.to_string(), data.clone());
                    Value::Object(o)
                }
                _ => {
                    return Err(format!(
                        "cannot update entity in non-collection file {}",
                        flat.display()
                    ));
                }
            };
            return Self::write_json(&flat, &next);
        }
        let direct = root.join(type_id).join(format!("{}.json", id));
        if direct.is_file() {
            return Self::write_json(&direct, data);
        }
        let nested_dir = root.join(type_id).join(id);
        if nested_dir.is_dir() {
            let mut json_files: Vec<PathBuf> = Vec::new();
            for entry in std::fs::read_dir(&nested_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.ends_with(".json") {
                    json_files.push(entry.path());
                }
            }
            if json_files.len() == 1 {
                return Self::write_json(&json_files.into_iter().next().unwrap(), data);
            }
            return Err("multi-file nested entities are not editable in v0.2".to_string());
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

    // --- update_entity ---

    #[test]
    fn update_entity_overwrites_direct_per_file() {
        let f = WorldFixture::new();
        f.write_json("data/quests/q1.json", &json!({"id": "q1", "title": "Old"}));
        LocalFsDataSource
            .update_entity(
                &f.root,
                "quests",
                "q1",
                &json!({"id": "q1", "title": "New"}),
            )
            .unwrap();
        let v = LocalFsDataSource
            .get_entity(&f.root, "quests", "q1")
            .unwrap();
        assert_eq!(v.get("title").and_then(|t| t.as_str()), Some("New"));
    }

    #[test]
    fn update_entity_splices_into_flat_array_and_leaves_siblings() {
        let f = WorldFixture::new();
        f.write_json(
            "data/npcs/npcs.json",
            &json!([
                {"id": "npc_a", "name": "Alice"},
                {"id": "npc_b", "name": "Bob"},
            ]),
        );
        LocalFsDataSource
            .update_entity(
                &f.root,
                "npcs",
                "npc_b",
                &json!({"id": "npc_b", "name": "Bobby", "level": 3}),
            )
            .unwrap();
        let updated = LocalFsDataSource
            .get_entity(&f.root, "npcs", "npc_b")
            .unwrap();
        assert_eq!(updated.get("name").and_then(|n| n.as_str()), Some("Bobby"));
        assert_eq!(updated.get("level").and_then(|n| n.as_i64()), Some(3));
        let sibling = LocalFsDataSource
            .get_entity(&f.root, "npcs", "npc_a")
            .unwrap();
        assert_eq!(sibling.get("name").and_then(|n| n.as_str()), Some("Alice"));
    }

    #[test]
    fn update_entity_splices_flat_array_by_index_when_no_id_field() {
        let f = WorldFixture::new();
        f.write_json(
            "data/items/items.json",
            &json!([
                {"name": "Stick"},
                {"name": "Stone"},
            ]),
        );
        LocalFsDataSource
            .update_entity(&f.root, "items", "1", &json!({"name": "Boulder"}))
            .unwrap();
        let v = LocalFsDataSource.get_entity(&f.root, "items", "1").unwrap();
        assert_eq!(v.get("name").and_then(|n| n.as_str()), Some("Boulder"));
        let other = LocalFsDataSource.get_entity(&f.root, "items", "0").unwrap();
        assert_eq!(other.get("name").and_then(|n| n.as_str()), Some("Stick"));
    }

    #[test]
    fn update_entity_splices_into_flat_object_and_leaves_siblings() {
        let f = WorldFixture::new();
        f.write_json(
            "data/rooms/rooms.json",
            &json!({
                "room_1": {"name": "Entry"},
                "room_2": {"name": "Hall"},
            }),
        );
        LocalFsDataSource
            .update_entity(&f.root, "rooms", "room_2", &json!({"name": "Grand Hall"}))
            .unwrap();
        let updated = LocalFsDataSource
            .get_entity(&f.root, "rooms", "room_2")
            .unwrap();
        assert_eq!(
            updated.get("name").and_then(|n| n.as_str()),
            Some("Grand Hall")
        );
        let sibling = LocalFsDataSource
            .get_entity(&f.root, "rooms", "room_1")
            .unwrap();
        assert_eq!(sibling.get("name").and_then(|n| n.as_str()), Some("Entry"));
    }

    #[test]
    fn update_entity_overwrites_single_file_nested_dir() {
        let f = WorldFixture::new();
        f.write_json(
            "data/rooms/room_1/maze.json",
            &json!({"environment_name": "Crypt", "grid": []}),
        );
        LocalFsDataSource
            .update_entity(
                &f.root,
                "rooms",
                "room_1",
                &json!({"environment_name": "Vault", "grid": [[0]]}),
            )
            .unwrap();
        let v = LocalFsDataSource
            .get_entity(&f.root, "rooms", "room_1")
            .unwrap();
        assert_eq!(
            v.get("environment_name").and_then(|s| s.as_str()),
            Some("Vault")
        );
    }

    #[test]
    fn update_entity_rejects_audio_types() {
        let f = WorldFixture::new();
        f.write_bytes("data/music/theme.mp3", b"id3");
        let res =
            LocalFsDataSource.update_entity(&f.root, "music", "theme", &json!({"name": "Theme"}));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("audio"));
    }

    #[test]
    fn update_entity_rejects_multi_file_nested_dir() {
        let f = WorldFixture::new();
        f.write_json(
            "data/rooms/room_1/maze.json",
            &json!({"environment_name": "Crypt"}),
        );
        f.write_json("data/rooms/room_1/story.json", &json!({"beat": "x"}));
        let res = LocalFsDataSource.update_entity(
            &f.root,
            "rooms",
            "room_1",
            &json!({"environment_name": "Vault"}),
        );
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("multi-file"));
    }

    #[test]
    fn update_entity_errors_when_missing_in_flat_array() {
        let f = WorldFixture::new();
        f.write_json("data/npcs/npcs.json", &json!([{"id": "npc_a"}]));
        let res =
            LocalFsDataSource.update_entity(&f.root, "npcs", "ghost", &json!({"id": "ghost"}));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("not found"));
    }

    #[test]
    fn update_entity_errors_when_missing_in_flat_object() {
        let f = WorldFixture::new();
        f.write_json(
            "data/rooms/rooms.json",
            &json!({"room_1": {"name": "Entry"}}),
        );
        let res =
            LocalFsDataSource.update_entity(&f.root, "rooms", "ghost", &json!({"name": "Ghost"}));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("not found"));
    }

    #[test]
    fn update_entity_errors_when_type_dir_absent() {
        let f = WorldFixture::new();
        let res =
            LocalFsDataSource.update_entity(&f.root, "npcs", "npc_a", &json!({"name": "Alice"}));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("not found"));
    }
}
