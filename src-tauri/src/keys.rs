//! Provider-key storage — the OS keychain, and what cradle hands a child
//! process (row P0-12, Phase 0 W3.4).
//!
//! # The whole delivery mechanism, in one paragraph
//!
//! canon's `_load_env_file` uses `os.environ.setdefault`, so **the process
//! environment always wins**. That single fact is what lets cradle store keys
//! in the OS keychain and inject them as environment variables on the canon
//! child, with **zero canon changes** and **no plaintext file at rest**. The
//! `--env-file` plumbing stays for dev (harmless under `setdefault`); the
//! effective precedence a child sees is: injected keychain → cradle's own
//! environment → the resolved env file.
//!
//! # Secrets discipline (load-bearing for this row)
//!
//! A key VALUE never leaves this module except into a child process's
//! environment. It is never logged, never returned by a command, never put in
//! an error message or a URL, and never written to a file cradle owns — with
//! the one named exception below. Status is **names and sources only**: not a
//! masked value, not a length.
//!
//! # The Linux exception (W3.4's named risk)
//!
//! On a headless or minimal desktop the Secret Service may be absent. Failing
//! there would leave the user with no way to add a key at all, so this falls
//! back to an app-config env file (`0600`) and reports a LOUD "stored
//! unencrypted" warning that the Keys pane renders beside every row. Falling
//! back silently would be the actual bug.
//!
//! # macOS
//!
//! The first keychain access prompts per app signature. A signed build makes
//! that one well-labelled prompt; the Keys pane says so, so nobody reads the
//! prompt as a failure.
//!
//! # Why a names index exists
//!
//! Keychains cannot be enumerated portably, and something has to know WHICH
//! variables to fetch when building a child's environment. So a names-only
//! index (`provider-keys.json`) sits beside the store. It holds no values, and
//! it is also what keeps a fresh machine from touching the keychain at all —
//! an empty index means no lookup, which means no macOS prompt before the user
//! has stored anything.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// The keychain service name every entry is stored under (W3.4: "Service name
/// `cradle`, one entry per provider var").
pub const SERVICE: &str = "cradle";

/// Names-only index of the variables held in the keychain.
const INDEX_FILE: &str = "provider-keys.json";
/// The Linux fallback's unencrypted store.
const FALLBACK_FILE: &str = "provider-keys.env";
/// The warning the fallback carries everywhere it is used.
pub const FALLBACK_WARNING: &str =
    "stored UNENCRYPTED: this machine has no OS keychain (Secret Service) that cradle could reach, \
     so keys are written to a 0600 file in cradle's config directory. Anyone who can read your \
     home directory can read them.";

/// Where cradle keeps its own per-machine files. `CRADLE_CONFIG_DIR` overrides
/// it (tests, and a portable install).
///
/// This is machine config, never pack data: I5's "durable truth lives in
/// `<pack>/.canon/`" is about the world, and a key is per-machine, not
/// per-pack — it must not travel with a copied project.
pub fn config_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CRADLE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").ok()?;
        return Some(
            Path::new(&home)
                .join("Library")
                .join("Application Support")
                .join("cradle"),
        );
    }
    if cfg!(windows) {
        let appdata = std::env::var("APPDATA").ok()?;
        return Some(Path::new(&appdata).join("cradle"));
    }
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.trim().is_empty() {
            return Some(Path::new(&xdg).join("cradle"));
        }
    }
    let home = std::env::var("HOME").ok()?;
    Some(Path::new(&home).join(".config").join("cradle"))
}

/// Which store answered. `File` carries [`FALLBACK_WARNING`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Backend {
    Keychain,
    File(PathBuf),
    /// Nothing usable: no keychain AND no config directory to fall back into.
    None(String),
}

impl Backend {
    /// A stable id the UI renders a chip from. `fallback_file` is deliberately
    /// distinct from the `env_file` source `provider_keys` reports: one is
    /// cradle's own unencrypted store, the other is the dev checkout's `.env`,
    /// and conflating them would mislabel exactly the case that needs a
    /// warning.
    pub fn id(&self) -> &'static str {
        match self {
            Backend::Keychain => "keychain",
            Backend::File(_) => "fallback_file",
            Backend::None(_) => "none",
        }
    }
    /// The loud warning, or `None` when the secure store answered.
    pub fn warning(&self) -> Option<String> {
        match self {
            Backend::Keychain => None,
            Backend::File(path) => Some(format!("{FALLBACK_WARNING} File: {}", path.display())),
            Backend::None(why) => Some(why.clone()),
        }
    }
}

/// One provider-key store. Constructed per call (commands stay stateless, I3);
/// `service` and `config` are parameters so tests can round-trip against their
/// own service name and their own directory instead of the user's.
#[derive(Clone, Debug)]
pub struct KeyStore {
    service: String,
    config: Option<PathBuf>,
    /// Force the unencrypted file store — the Linux fallback path, exercised
    /// on any platform by `CRADLE_KEYSTORE=file` (and by its own test).
    force_file: bool,
}

impl KeyStore {
    /// The app's real store.
    pub fn app() -> Self {
        KeyStore {
            service: SERVICE.to_string(),
            config: config_dir(),
            force_file: std::env::var("CRADLE_KEYSTORE")
                .map(|v| v.eq_ignore_ascii_case("file"))
                .unwrap_or(false),
        }
    }

    /// A store for tests: its own service name, its own directory. Test-only
    /// so the app can never accidentally point at another service name.
    #[cfg(test)]
    pub fn with(service: &str, config: Option<PathBuf>, force_file: bool) -> Self {
        KeyStore {
            service: service.to_string(),
            config,
            force_file,
        }
    }

    /// Which store this machine actually gets. Asking the keychain for its
    /// status is what turns "secret-service is missing" into a named fallback
    /// instead of an error at the first write.
    pub fn backend(&self) -> Backend {
        if !self.force_file && keychain_available() {
            return Backend::Keychain;
        }
        match self.config.as_ref() {
            Some(dir) => Backend::File(dir.join(FALLBACK_FILE)),
            None => Backend::None(
                "no OS keychain answered and cradle has no config directory to fall back to — \
                 set CRADLE_CONFIG_DIR, or use an env file (CANON_ENV_FILE)."
                    .to_string(),
            ),
        }
    }

    fn index_path(&self) -> Option<PathBuf> {
        self.config.as_ref().map(|d| d.join(INDEX_FILE))
    }

    /// The variable NAMES this store holds. Never a value.
    pub fn names(&self) -> Vec<String> {
        match self.backend() {
            Backend::Keychain => self.index_names(),
            Backend::File(path) => read_env_file(&path).into_keys().collect(),
            Backend::None(_) => Vec::new(),
        }
    }

    fn index_names(&self) -> Vec<String> {
        let Some(path) = self.index_path() else {
            return Vec::new();
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            return Vec::new();
        };
        serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("vars").cloned())
            .and_then(|v| v.as_array().cloned())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn write_index(&self, names: &[String]) -> Result<(), String> {
        let Some(path) = self.index_path() else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }
        let mut sorted: Vec<&String> = names.iter().collect();
        sorted.sort();
        sorted.dedup();
        let body = serde_json::json!({
            "note": "NAMES ONLY. Values live in the OS keychain under the service name in this file.",
            "service": self.service,
            "vars": sorted,
        });
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&body).unwrap_or_default(),
        )
        .map_err(|e| format!("cannot write {}: {e}", path.display()))
    }

    /// Store `var`'s value. Write-only: nothing here ever hands it back.
    pub fn set(&self, var: &str, value: &str) -> Result<Backend, String> {
        let var = var.trim();
        if var.is_empty() {
            return Err("no variable name".into());
        }
        if value.trim().is_empty() {
            return Err("empty value — use Remove to clear a key".into());
        }
        let backend = self.backend();
        match &backend {
            Backend::Keychain => {
                entry(&self.service, var)?
                    .set_password(value.trim())
                    .map_err(|e| format!("the keychain refused to store {var}: {e}"))?;
                let mut names = self.index_names();
                names.push(var.to_string());
                self.write_index(&names)?;
            }
            Backend::File(path) => {
                let mut pairs = read_env_file(path);
                pairs.insert(var.to_string(), value.trim().to_string());
                write_env_file(path, &pairs)?;
            }
            Backend::None(why) => return Err(why.clone()),
        }
        Ok(backend)
    }

    /// Forget `var`. `Ok(false)` when there was nothing to forget.
    pub fn delete(&self, var: &str) -> Result<(bool, Backend), String> {
        let backend = self.backend();
        let removed = match &backend {
            Backend::Keychain => {
                let had = self.index_names().iter().any(|n| n == var);
                // Delete before touching the index, so a keychain that refuses
                // never leaves the index lying about what is stored.
                match entry(&self.service, var)?.delete_credential() {
                    Ok(()) => {}
                    // Already gone is a success: delete is idempotent, and a
                    // stale index entry must still be clearable. Matched by
                    // TYPE, not by message: keyring renders this variant as
                    // "No matching credential found", so the older string
                    // match never fired and a stale name could never be
                    // cleared.
                    Err(keyring::Error::NoEntry) => {}
                    Err(e) => return Err(format!("the keychain refused to remove {var}: {e}")),
                }
                let names: Vec<String> = self
                    .index_names()
                    .into_iter()
                    .filter(|n| n != var)
                    .collect();
                self.write_index(&names)?;
                had
            }
            Backend::File(path) => {
                let mut pairs = read_env_file(path);
                let had = pairs.remove(var).is_some();
                if had {
                    write_env_file(path, &pairs)?;
                }
                had
            }
            Backend::None(why) => return Err(why.clone()),
        };
        Ok((removed, backend))
    }

    /// Every stored `(name, value)` — the ONE reader of values, called only by
    /// the child-environment builder. Deliberately not `pub` beyond the crate.
    pub(crate) fn all(&self) -> Vec<(String, String)> {
        self.read_indexed()
            .into_iter()
            .filter_map(|(name, got)| got.ok().map(|v| (name, v)))
            .collect()
    }

    /// The stored names split by whether this machine will actually RELEASE
    /// them: `(readable, unreadable)`.
    ///
    /// Extends `names()` — which answers from the names index alone — with the
    /// question the status read actually needs. The index says a name was
    /// stored; only a read proves the child will receive it. The two diverge on
    /// mundane paths: the keychain item was removed outside cradle (a stale
    /// index), or the OS refuses this binary access to it (a rebuilt or
    /// differently-signed dev build, or a denied prompt). Reporting those as
    /// "set" is how a job gets past the missing-key gate, spends the confirm,
    /// and then dies inside canon with "needs FAL_KEY" — the exact confusion
    /// row P0-12 exists to remove.
    ///
    /// No new prompt class: a non-empty index means a key was already stored
    /// from this build, so the read is the same access the injector makes.
    pub fn readable_names(&self) -> (Vec<String>, Vec<String>) {
        let mut readable = Vec::new();
        let mut unreadable = Vec::new();
        for (name, got) in self.read_indexed() {
            match got {
                Ok(_) => readable.push(name),
                // The reason is deliberately dropped: an OS error message can
                // quote the item, and status is names and sources only.
                Err(_) => unreadable.push(name),
            }
        }
        (readable, unreadable)
    }

    /// The one place a stored value is read. Values never leave this module
    /// except into a child's environment, and the `Err` side carries a reason
    /// that is never rendered — only its existence is.
    fn read_indexed(&self) -> Vec<(String, Result<String, String>)> {
        match self.backend() {
            Backend::Keychain => {
                // An empty index means the keychain is never touched, so a
                // fresh machine gets no macOS prompt before it stores a key.
                let mut out = Vec::new();
                for name in self.names() {
                    let got = entry(&self.service, &name)
                        .and_then(|e| e.get_password().map_err(|e| e.to_string()))
                        .and_then(|v| {
                            if v.is_empty() {
                                Err("the keychain holds an empty value".into())
                            } else {
                                Ok(v)
                            }
                        });
                    out.push((name, got));
                }
                out
            }
            Backend::File(path) => read_env_file(&path)
                .into_iter()
                .map(|(k, v)| (k, Ok(v)))
                .collect(),
            Backend::None(_) => Vec::new(),
        }
    }
}

/// Is a platform credential store usable here? `store_status()` initialises the
/// store once and reports the result — the Linux "no Secret Service" case
/// arrives here as an `Err`, which is what selects the fallback.
fn keychain_available() -> bool {
    keyring::Entry::store_status().is_ok()
}

fn entry(service: &str, var: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, var)
        .map_err(|e| format!("the OS keychain is not usable for {var}: {e}"))
}

/// Read `KEY=VALUE` lines. Shares the env-file dialect `lib.rs::env_file_pairs`
/// parses (`export ` prefix, `#` comments, quotes stripped).
fn read_env_file(path: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return out;
    };
    for line in text.lines() {
        let line = line.trim().trim_start_matches("export ").trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let k = k.trim();
            let v = v.trim().trim_matches(['"', '\'']);
            if !k.is_empty() && !v.is_empty() {
                out.insert(k.to_string(), v.to_string());
            }
        }
    }
    out
}

fn write_env_file(path: &Path, pairs: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let mut body =
        String::from("# cradle provider keys — UNENCRYPTED fallback (no OS keychain).\n");
    body.push_str("# Delete this file to forget every key stored here.\n");
    for (k, v) in pairs {
        body.push_str(&format!("{k}={v}\n"));
    }
    write_owner_only(path, &body)?;
    // Belt and braces: a file that already existed keeps its own mode through
    // an open, so tighten it after the write too.
    restrict(path);
    Ok(())
}

/// Write `body`, creating the file 0600 FROM THE START on unix.
///
/// `std::fs::write` creates with the process umask (typically 0644) and the
/// chmod lands afterwards, so a plain write leaves a window in which the one
/// file that legitimately holds key VALUES (W3.4's named Linux risk) is
/// world-readable. Every `set` and every `delete` rewrites it, so the window is
/// not a first-run-only concern.
fn write_owner_only(path: &Path, body: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
        return f
            .write_all(body.as_bytes())
            .map_err(|e| format!("cannot write {}: {e}", path.display()));
    }
    #[cfg(not(unix))]
    std::fs::write(path, body).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// `0600` on unix — the file holds secrets, so nothing but the owner reads it.
fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cradle-keys-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The Linux fallback path: no keychain, an unencrypted file, a LOUD
    /// warning, and `0600` — W3.4's named risk, handled rather than fatal.
    #[test]
    fn the_file_fallback_round_trips_and_warns_loudly() {
        let dir = temp_config();
        let store = KeyStore::with("cradle-test-file", Some(dir.clone()), true);
        let backend = store.backend();
        assert_eq!(backend.id(), "fallback_file");
        let warning = backend.warning().expect("the fallback must warn");
        assert!(warning.contains("UNENCRYPTED"), "{warning}");

        store.set("FAL_KEY", "value-under-test").unwrap();
        assert_eq!(store.names(), vec!["FAL_KEY".to_string()]);
        assert_eq!(
            store.all(),
            vec![("FAL_KEY".to_string(), "value-under-test".to_string())]
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(FALLBACK_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "the fallback file must be owner-only");
        }

        // A REWRITE must land owner-only too: the mode is created with the
        // file, not chmodded on after a umask-wide window.
        store.set("ANTHROPIC_API_KEY", "second-value").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(FALLBACK_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "a rewrite must stay owner-only");
        }
        store.delete("ANTHROPIC_API_KEY").unwrap();

        let (removed, _) = store.delete("FAL_KEY").unwrap();
        assert!(removed);
        assert!(store.names().is_empty());
        assert!(store.all().is_empty());
        let (again, _) = store.delete("FAL_KEY").unwrap();
        assert!(!again, "delete is idempotent");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_value_is_refused_rather_than_stored() {
        let dir = temp_config();
        let store = KeyStore::with("cradle-test-empty", Some(dir.clone()), true);
        let err = store.set("FAL_KEY", "   ").unwrap_err();
        assert!(err.contains("Remove"), "{err}");
        assert!(store.names().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The KEYCHAIN round-trip: set → read status → delete, against a service
    /// name unique to this run so no earlier build's items are ever read (a
    /// cross-build read is what raises the macOS prompt). Skipped, loudly, on
    /// a machine with no usable credential store — which is exactly the
    /// machine the fallback test above covers.
    #[test]
    fn the_keychain_round_trips_under_a_test_service_name() {
        if !keychain_available() {
            eprintln!("no OS keychain here — the fallback test covers this machine");
            return;
        }
        let dir = temp_config();
        let service = format!(
            "cradle-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let store = KeyStore::with(&service, Some(dir.clone()), false);
        assert_eq!(store.backend().id(), "keychain");
        assert!(store.backend().warning().is_none());

        // A fresh store touches nothing: no index, no lookup, no prompt.
        assert!(store.names().is_empty());
        assert!(store.all().is_empty());

        store.set("ANTHROPIC_API_KEY", "value-under-test").unwrap();
        assert_eq!(store.names(), vec!["ANTHROPIC_API_KEY".to_string()]);
        assert_eq!(
            store.all(),
            vec![(
                "ANTHROPIC_API_KEY".to_string(),
                "value-under-test".to_string()
            )]
        );
        // The names index is names ONLY — the value is not in the file.
        let index = std::fs::read_to_string(dir.join(INDEX_FILE)).unwrap();
        assert!(index.contains("ANTHROPIC_API_KEY"));
        assert!(!index.contains("value-under-test"));

        let (removed, _) = store.delete("ANTHROPIC_API_KEY").unwrap();
        assert!(removed);
        assert!(store.names().is_empty());
        assert!(store.all().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A name the INDEX lists but the keychain does not hold — the state a
    /// removal outside cradle leaves behind. Two things must hold: `delete`
    /// clears it (the "already gone is a success" branch is reached, which the
    /// older message match never was), and until it is cleared the status read
    /// calls it UNREADABLE rather than set, so the missing-key gate refuses
    /// instead of letting a paid job die inside canon.
    #[test]
    fn a_stale_index_entry_is_unreadable_and_still_clearable() {
        if !keychain_available() {
            eprintln!("no OS keychain here — the fallback test covers this machine");
            return;
        }
        let dir = temp_config();
        let service = format!("cradle-test-stale-{}", std::process::id());
        let store = KeyStore::with(&service, Some(dir.clone()), false);
        // Index the name without ever storing a value for it.
        store.write_index(&["FAL_KEY".to_string()]).unwrap();

        assert_eq!(store.names(), vec!["FAL_KEY".to_string()]);
        let (readable, unreadable) = store.readable_names();
        assert!(readable.is_empty(), "nothing is actually retrievable");
        assert_eq!(unreadable, vec!["FAL_KEY".to_string()]);
        assert!(store.all().is_empty(), "the child would get nothing");

        let (removed, _) = store.delete("FAL_KEY").unwrap();
        assert!(removed, "the stale index entry was cleared");
        assert!(store.names().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn config_dir_honours_the_override() {
        // Read through the same accessor the app uses; the override exists so
        // a test never writes into the user's real config directory.
        let before = std::env::var("CRADLE_CONFIG_DIR").ok();
        std::env::set_var("CRADLE_CONFIG_DIR", "/tmp/cradle-config-probe");
        assert_eq!(
            config_dir(),
            Some(PathBuf::from("/tmp/cradle-config-probe"))
        );
        match before {
            Some(v) => std::env::set_var("CRADLE_CONFIG_DIR", v),
            None => std::env::remove_var("CRADLE_CONFIG_DIR"),
        }
    }
}
