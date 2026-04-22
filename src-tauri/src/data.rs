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

impl LocalFsDataSource {
    fn data_root(world_path: &Path) -> PathBuf {
        let data = world_path.join("data");
        if data.is_dir() { data } else { world_path.to_path_buf() }
    }

    fn read_json(path: &Path) -> Result<Value, String> {
        let s = std::fs::read_to_string(path).map_err(|e| format!("read {}: {}", path.display(), e))?;
        serde_json::from_str(&s).map_err(|e| format!("parse {}: {}", path.display(), e))
    }

    fn collection_entries(root: &Path, type_id: &str) -> Result<Vec<EntityRef>, String> {
        if is_audio_type(type_id) {
            let stems = audio_file_stems(&root.join(type_id))?;
            return Ok(stems
                .into_iter()
                .map(|id| EntityRef { type_id: type_id.to_string(), name: Some(id.clone()), id })
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
                out.push(EntityRef { type_id: type_id.to_string(), id, name: None });
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
                    EntityRef { type_id: type_id.to_string(), id, name }
                })
                .collect(),
            Value::Object(o) => o
                .iter()
                .map(|(k, item)| {
                    let name = display_name(item);
                    EntityRef { type_id: type_id.to_string(), id: k.clone(), name }
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
            counts.push(EntityTypeCount { type_id: (*t).to_string(), count: refs.len() });
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("world").to_string();
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
        let fname = if name.ends_with(".json") { name.to_string() } else { format!("{}.json", name) };
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
                Value::Object(o) => o.into_iter().map(|(id, data)| EntityRow { id, data }).collect(),
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
        let root = Self::data_root(path);
        for sub in ["music", "sfx"] {
            let candidate = root.join(sub).join(hint);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().into());
            }
        }
        let world_root = path;
        let hint_path = Path::new(hint);
        if hint_path.is_absolute() && hint_path.exists() {
            return Some(hint_path.to_string_lossy().into());
        }
        let normalized = hint.replace('\\', "/");
        if let Some(idx) = normalized.find("data/portraits/") {
            let suffix = &normalized[idx + "data/".len()..];
            let candidate = root.join(suffix);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().into());
            }
            let candidate2 = world_root.join(&normalized[idx..]);
            if candidate2.exists() {
                return Some(candidate2.to_string_lossy().into());
            }
        }
        if let Some(idx) = normalized.find("portraits/") {
            let candidate = root.join(&normalized[idx..]);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().into());
            }
        }
        let basename = hint_path.file_name()?.to_string_lossy().to_string();
        for sub in ["npcs", "monsters", "items", "events", "classes", "maps", ""] {
            let candidate = root.join("portraits").join(sub).join(&basename);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().into());
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
        Err(format!("entity {}/{} not found under {}", type_id, id, root.display()))
    }
}
