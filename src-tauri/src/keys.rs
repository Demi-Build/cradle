//! Provider keys — ONE source: a plain `KEY=VALUE` file.
//!
//! # Why one source
//!
//! Cradle used to merge three tiers (OS keychain → cradle's own inherited
//! shell environment → an env file) with setdefault semantics. A shell that
//! exported stale keys then won over a fresh `.env` on every paid run, and
//! Settings → Test reported good keys as bad. The owner's call: users bring
//! their own keys and choose them, so the file is the only place a provider
//! key is read from. The shell is never consulted; the child-environment
//! builder in `lib.rs` strips the inherited copies by name before the file's
//! own pairs go in.
//!
//! # Which file
//!
//! `lib.rs::env_file_path` decides: an explicit `CANON_ENV_FILE`, else the
//! dev checkout's `<canon repo>/.env`, else the packaged app's
//! `<config dir>/provider-keys.env` (see [`app_file`]). Whichever it is, this
//! module reads and rewrites it line by line — other lines and comments are
//! preserved, so a hand-edited file and the Settings pane can share it.
//!
//! # Secrets discipline
//!
//! A key VALUE leaves this module only through [`KeyFile::pairs`], which the
//! child-environment builder is the sole caller of. Every other accessor
//! answers names, presence and the path. Nothing here logs a value, puts one
//! in an error message, or returns one to a command.

use std::path::{Path, PathBuf};

/// The packaged app's key file, inside cradle's config directory.
pub const APP_FILE: &str = "provider-keys.env";

/// The header a freshly created file starts with. Names no other document;
/// it has to make sense to someone who opens the file in an editor.
const HEADER: &[&str] = &[
    "# Provider keys for cradle and canon. One KEY=VALUE per line; # starts a comment.",
    "# Settings \u{2192} API keys reads and writes this file; you can edit it by hand too.",
];

/// Where cradle keeps its own per-machine files. `CRADLE_CONFIG_DIR` overrides
/// it (tests, and a portable install).
///
/// This is machine config, never pack data: a key is per-machine, not
/// per-project — it must not travel with a copied project.
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

/// The packaged app's key file path, or `None` when there is no config
/// directory to put it in.
pub fn app_file() -> Option<PathBuf> {
    config_dir().map(|d| d.join(APP_FILE))
}

/// One key file. Constructed per call (commands stay stateless); the path is
/// a parameter so tests round-trip against their own file, never the user's.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyFile {
    path: PathBuf,
}

impl KeyFile {
    pub fn at(path: impl Into<PathBuf>) -> Self {
        KeyFile { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Whether the file is there. Reads never create it — first use is an
    /// explicit action ([`KeyFile::create`]) or the first [`KeyFile::set`].
    pub fn exists(&self) -> bool {
        self.path.is_file()
    }

    /// The variable NAMES the file sets to something non-empty. Never a value.
    pub fn names(&self) -> Vec<String> {
        self.pairs().into_iter().map(|(k, _)| k).collect()
    }

    /// Every `(name, value)` the file sets — the ONE reader of values, called
    /// only by the child-environment builder. Deliberately not `pub` beyond
    /// the crate. An empty value is not a key: the line is skipped, exactly
    /// as canon treats it.
    pub(crate) fn pairs(&self) -> Vec<(String, String)> {
        let Ok(text) = std::fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        let mut out: Vec<(String, String)> = Vec::new();
        for line in text.lines() {
            if let Some((k, v)) = parse_line(line) {
                if v.is_empty() {
                    continue;
                }
                // The file is read top-down like canon reads it; a later
                // duplicate wins there too, so replace rather than append.
                match out.iter_mut().find(|(name, _)| name == k) {
                    Some(slot) => slot.1 = v.to_string(),
                    None => out.push((k.to_string(), v.to_string())),
                }
            }
        }
        out
    }

    /// Set `var` to `value`, rewriting that ONE line and preserving every
    /// other line and comment verbatim. Appends when the name is new. Creates
    /// the file (owner-only) when it does not exist yet. Write-only: nothing
    /// here hands the value back.
    pub fn set(&self, var: &str, value: &str) -> Result<(), String> {
        let var = var.trim();
        if var.is_empty() {
            return Err("no variable name".into());
        }
        if !var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(format!(
                "{var} is not a variable name (letters, digits, _ only)"
            ));
        }
        let value = value.trim();
        if value.is_empty() {
            return Err("empty value — use Remove to clear a key".into());
        }
        if value.contains(['\n', '\r']) {
            return Err(format!("{var} cannot hold a line break"));
        }
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(format!("cannot read {}: {e}", self.path.display())),
        };
        let mut lines: Vec<String> = Vec::new();
        let mut replaced = false;
        for line in text.lines() {
            if parse_line(line).map(|(k, _)| k) == Some(var) {
                // One line per key: the first occurrence is rewritten in
                // place, any later duplicate is dropped.
                if !replaced {
                    lines.push(format!("{var}={value}"));
                    replaced = true;
                }
                continue;
            }
            lines.push(line.to_string());
        }
        if !replaced {
            if text.is_empty() {
                lines.extend(HEADER.iter().map(|l| l.to_string()));
            }
            lines.push(format!("{var}={value}"));
        }
        self.write(&lines)
    }

    /// Delete `var`'s line(s), preserving everything else. `Ok(false)` when
    /// there was nothing to delete — idempotent, and a missing file is simply
    /// a file with nothing in it.
    pub fn remove(&self, var: &str) -> Result<bool, String> {
        let var = var.trim();
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(format!("cannot read {}: {e}", self.path.display())),
        };
        let kept: Vec<String> = text
            .lines()
            .filter(|line| parse_line(line).map(|(k, _)| k) != Some(var))
            .map(str::to_string)
            .collect();
        let removed = kept.len() != text.lines().count();
        if removed {
            self.write(&kept)?;
        }
        Ok(removed)
    }

    /// First use: create the file with its header, owner-only, holding no
    /// keys. `Ok(false)` when it already exists (nothing is touched).
    pub fn create(&self) -> Result<bool, String> {
        if self.exists() {
            return Ok(false);
        }
        let lines: Vec<String> = HEADER.iter().map(|l| l.to_string()).collect();
        self.write(&lines)?;
        Ok(true)
    }

    fn write(&self, lines: &[String]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }
        let mut body = lines.join("\n");
        body.push('\n');
        write_owner_only(&self.path, &body)?;
        // A file that already existed keeps its own mode through an open, so
        // tighten it after the write too.
        restrict(&self.path);
        Ok(())
    }
}

/// One `KEY=VALUE` line → `(key, value)`, or `None` for a blank line, a
/// comment, or a line with no `=`. The dialect canon's own loader reads:
/// an `export ` prefix is allowed, surrounding quotes on the value are
/// stripped. The one parser for this file — every reader and both writers
/// go through it, so "which line is `FAL_KEY`'s?" has one answer.
fn parse_line(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    let line = line.strip_prefix("export ").map(str::trim).unwrap_or(line);
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (k, v) = line.split_once('=')?;
    let k = k.trim();
    if k.is_empty() {
        return None;
    }
    Some((k, v.trim().trim_matches(['"', '\''])))
}

/// Write `body`, creating the file 0600 FROM THE START on unix.
///
/// `std::fs::write` creates with the process umask (typically 0644) and a
/// chmod afterwards leaves a window in which the one file that holds key
/// VALUES is world-readable. Every `set` and every `remove` rewrites it, so
/// the window is not a first-run-only concern.
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
        f.write_all(body.as_bytes())
            .map_err(|e| format!("cannot write {}: {e}", path.display()))
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, body).map_err(|e| format!("cannot write {}: {e}", path.display()))
    }
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

    fn temp_file(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cradle-keyfile-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("provider-keys.env")
    }

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    /// Save rewrites ONE line and leaves everything else — comments, blank
    /// lines, other keys, an `export` prefix, quoted values — exactly as it
    /// was. That is what lets a hand-edited file and the Settings pane share
    /// the same file without either clobbering the other.
    #[test]
    fn set_rewrites_one_line_and_preserves_the_rest() {
        let path = temp_file("set");
        std::fs::write(
            &path,
            "# my keys\n\
             export FAL_KEY=\"old-fal-value\"\n\
             \n\
             GOOGLE_API_KEY='google-value'   # trailing note\n\
             # PIXELLAB_SECRET=commented-out\n",
        )
        .unwrap();
        let file = KeyFile::at(&path);
        assert_eq!(file.names(), vec!["FAL_KEY", "GOOGLE_API_KEY"]);

        file.set("FAL_KEY", "new-fal-value").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            text,
            "# my keys\n\
             FAL_KEY=new-fal-value\n\
             \n\
             GOOGLE_API_KEY='google-value'   # trailing note\n\
             # PIXELLAB_SECRET=commented-out\n",
            "only FAL_KEY's line changed"
        );
        assert!(!text.contains("old-fal-value"));

        // A NEW name is appended; nothing else moves.
        file.set("ANTHROPIC_API_KEY", "anthropic-value").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.ends_with("ANTHROPIC_API_KEY=anthropic-value\n"));
        assert!(text.starts_with("# my keys\nFAL_KEY=new-fal-value\n"));
        assert_eq!(
            file.pairs(),
            vec![
                ("FAL_KEY".to_string(), "new-fal-value".to_string()),
                (
                    "GOOGLE_API_KEY".to_string(),
                    "google-value'   # trailing note".to_string()
                ),
                (
                    "ANTHROPIC_API_KEY".to_string(),
                    "anthropic-value".to_string()
                ),
            ]
        );
        #[cfg(unix)]
        assert_eq!(mode_of(&path), 0o600, "a rewrite lands owner-only");
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    /// Remove deletes ONLY that key's line. Every other line survives
    /// byte-for-byte, and removing what is not there is a no-op that says so.
    #[test]
    fn remove_deletes_only_that_line() {
        let path = temp_file("remove");
        let before = "# header\nFAL_KEY=fal-value\nGOOGLE_API_KEY=google-value\n\n# tail\n";
        std::fs::write(&path, before).unwrap();
        let file = KeyFile::at(&path);

        assert!(file.remove("FAL_KEY").unwrap());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# header\nGOOGLE_API_KEY=google-value\n\n# tail\n"
        );
        assert_eq!(file.names(), vec!["GOOGLE_API_KEY"]);

        assert!(!file.remove("FAL_KEY").unwrap(), "remove is idempotent");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# header\nGOOGLE_API_KEY=google-value\n\n# tail\n",
            "a no-op remove does not rewrite the file"
        );
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    /// First use. Reads never create the file; `create` makes it once with
    /// the header and owner-only; `set` on a missing file creates it too.
    #[test]
    fn first_use_creates_the_file_once_and_never_on_read() {
        let path = temp_file("create");
        let file = KeyFile::at(&path);
        assert!(!file.exists());
        assert!(file.names().is_empty());
        assert!(file.pairs().is_empty());
        assert!(!file.remove("FAL_KEY").unwrap());
        assert!(!file.exists(), "no read or no-op write creates the file");

        assert!(file.create().unwrap());
        assert!(file.exists());
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# Provider keys"), "{text}");
        assert!(file.names().is_empty(), "a fresh file holds no keys");
        #[cfg(unix)]
        assert_eq!(mode_of(&path), 0o600);
        assert!(!file.create().unwrap(), "create is idempotent");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text, "untouched");

        // And a save straight into a missing file creates it with the header.
        let fresh = temp_file("create-by-set");
        KeyFile::at(&fresh).set("FAL_KEY", "fal-value").unwrap();
        let text = std::fs::read_to_string(&fresh).unwrap();
        assert!(text.starts_with("# Provider keys"), "{text}");
        assert!(text.ends_with("FAL_KEY=fal-value\n"));
        #[cfg(unix)]
        assert_eq!(mode_of(&fresh), 0o600, "created owner-only from the start");
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
        std::fs::remove_dir_all(fresh.parent().unwrap()).ok();
    }

    #[test]
    fn a_bad_value_is_refused_rather_than_written() {
        let path = temp_file("refuse");
        let file = KeyFile::at(&path);
        assert!(file.set("FAL_KEY", "   ").unwrap_err().contains("Remove"));
        assert!(file.set("", "x").is_err());
        assert!(file.set("NOT A NAME", "x").is_err());
        assert!(file.set("FAL_KEY", "one\ntwo").is_err());
        assert!(!file.exists(), "a refused save creates nothing");
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    /// A duplicated name collapses to one line on save, and canon's own
    /// "last line wins" reading is what `pairs` reports until then.
    #[test]
    fn duplicates_collapse_to_one_line() {
        let path = temp_file("dupes");
        std::fs::write(&path, "FAL_KEY=first\nOTHER=x\nFAL_KEY=second\n").unwrap();
        let file = KeyFile::at(&path);
        assert_eq!(
            file.pairs(),
            vec![
                ("FAL_KEY".to_string(), "second".to_string()),
                ("OTHER".to_string(), "x".to_string()),
            ]
        );
        file.set("FAL_KEY", "third").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "FAL_KEY=third\nOTHER=x\n"
        );
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
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
        assert_eq!(
            app_file(),
            Some(PathBuf::from("/tmp/cradle-config-probe/provider-keys.env"))
        );
        match before {
            Some(v) => std::env::set_var("CRADLE_CONFIG_DIR", v),
            None => std::env::remove_var("CRADLE_CONFIG_DIR"),
        }
    }
}
