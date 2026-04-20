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

pub trait DataSource: Send + Sync {
    fn load_world(&self, path: &Path) -> Result<WorldSummary, String>;
    fn get_world_bible(&self, path: &Path) -> Result<Value, String>;
    fn list_entities(&self, path: &Path, type_id: &str) -> Result<Vec<EntityRef>, String>;
    fn get_entity(&self, path: &Path, type_id: &str, id: &str) -> Result<Value, String>;
}

pub struct LocalFsDataSource;

const ENTITY_TYPES: &[&str] = &[
    "npcs", "items", "monsters", "quests", "rooms", "events", "classes",
];

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
        let arr = match v {
            Value::Array(a) => a.clone(),
            Value::Object(o) => o.values().cloned().collect(),
            _ => return Vec::new(),
        };
        arr.into_iter()
            .filter_map(|item| {
                let id = item.get("id").map(|x| x.to_string().trim_matches('"').to_string())?;
                let name = item.get("name").and_then(|n| n.as_str()).map(String::from);
                Some(EntityRef { type_id: type_id.to_string(), id, name })
            })
            .collect()
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

    fn list_entities(&self, path: &Path, type_id: &str) -> Result<Vec<EntityRef>, String> {
        Self::collection_entries(&Self::data_root(path), type_id)
    }

    fn get_entity(&self, path: &Path, type_id: &str, id: &str) -> Result<Value, String> {
        let root = Self::data_root(path);
        let flat = root.join(type_id).join(format!("{}.json", type_id));
        if flat.is_file() {
            let v = Self::read_json(&flat)?;
            let arr: Vec<Value> = match v {
                Value::Array(a) => a,
                Value::Object(o) => o.into_iter().map(|(_, v)| v).collect(),
                other => vec![other],
            };
            for item in arr {
                if item.get("id").map(|i| i.to_string().trim_matches('"').to_string()) == Some(id.to_string()) {
                    return Ok(item);
                }
            }
            return Err(format!("entity {}/{} not found", type_id, id));
        }
        let direct = root.join(type_id).join(format!("{}.json", id));
        if direct.is_file() {
            return Self::read_json(&direct);
        }
        let nested_dir = root.join(type_id).join(id);
        if nested_dir.is_dir() {
            let mut obj = serde_json::Map::new();
            for entry in std::fs::read_dir(&nested_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if let Some(stem) = fname.strip_suffix(".json") {
                    obj.insert(stem.to_string(), Self::read_json(&entry.path())?);
                }
            }
            return Ok(Value::Object(obj));
        }
        Err(format!("entity {}/{} not found under {}", type_id, id, root.display()))
    }
}
