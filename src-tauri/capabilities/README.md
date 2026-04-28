# Tauri capabilities

Tauri 2 ships a deny-by-default permission system. Anything the webview or its
JS can ask the Rust side to do has to be explicitly listed in a capability file
under `src-tauri/capabilities/`. This document explains every permission
Cradle grants and why.

If you're auditing for a security review or downstream integration, this is the
file to read alongside [`SECURITY.md`](../../SECURITY.md).

## Active capability files

| File           | Window scope             | Granted to                 |
| -------------- | ------------------------ | -------------------------- |
| `default.json` | `main` (the only window) | the entire frontend bundle |

Cradle has exactly one webview window today (`main`, defined in
`tauri.conf.json:13`), so one capability file covers everything.

## Permission inventory (`default.json`)

```json
"permissions": [
  "core:default",
  "dialog:default"
]
```

### `core:default`

**What it grants.** Tauri's core runtime permissions: app metadata
(`core:app`), event emit/listen (`core:event`), `core:menu`, `core:path`
(resolve app-data directories), `core:resources`, `core:tray`,
`core:webview`, and `core:window` (basic window ops like close / minimize /
focus).

**What it does _not_ grant.** No filesystem access (`fs:`), no shell
spawn (`shell:`), no HTTP client (`http:`), no clipboard, no notifications,
no global shortcuts. None of those plugins are loaded.

**Why Cradle needs it.** Standard Tauri runtime — without it the app cannot
boot, register IPC handlers, or open a window.

### `dialog:default`

**What it grants.** Native file / folder open and save dialogs, plus alert /
confirm message boxes, via `tauri-plugin-dialog`.

**Where Cradle uses it.**

- `src/components/start/StartScreen.tsx:2` — `open({ directory: true })` from
  `@tauri-apps/plugin-dialog`, invoked by the **Open world from disk** button
  on the first-run / start screen.
- `src/components/recents/RecentProjectsPage.tsx:2` — same import, same
  picker, invoked from the recent-projects view.

**Why this scope.** Cradle is read-only; the dialog plugin is the _only_
permitted entrypoint for a user to point Cradle at a world directory on disk.
Without it, the app can only load the bundled demo.

**What's the worst case?** A native folder picker only returns paths the user
explicitly chose. The frontend cannot synthesize a path without user
interaction. The chosen path then flows through `LocalFsDataSource` in
`src-tauri/src/data.rs`, which is read-only and traversal-guarded.

## Things explicitly _not_ permitted

- **`fs:`** — Cradle never accesses the filesystem through Tauri's `fs`
  plugin. All disk reads go through typed Rust commands in
  `src-tauri/src/lib.rs` (`load_world`, `read_world_json`, `list_entities`,
  `list_entity_rows`, `get_entity`, `resolve_asset`,
  `get_bundled_demo_path`). Each command takes a world path that originated
  from the user's folder picker and dispatches to `LocalFsDataSource` in
  `src-tauri/src/data.rs`, which has its own traversal guards.
- **`shell:`** — no subprocess spawn.
- **`http:` / `notification:` / `clipboard:` / `global-shortcut:` /
  `opener:`** — none of these plugins are loaded. The frontend cannot make
  network calls, post system notifications, read or write the clipboard,
  register global hotkeys, or ask the OS to open external URLs and files.
- **Webview navigation outside the bundled frontend** — the asset protocol
  is enabled with `scope: ["**"]`, but every request is routed through
  `LocalFsDataSource::resolve_asset`, which enforces world-tree containment.
  See the **Note on `assetProtocol.scope`** section of
  [`SECURITY.md`](../../SECURITY.md) for the full threat model.

## How to add or change a permission

1. Edit `default.json`, adding or removing an entry from `permissions`.
2. If the new permission belongs to a plugin not yet loaded, register the
   plugin in `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_<name>::init())`)
   and add the matching dependency to `src-tauri/Cargo.toml` and the
   matching `@tauri-apps/plugin-<name>` to `package.json`.
3. Update this README with the rationale, call sites, and worst-case
   analysis.
4. Update `SECURITY.md` if the permission expands the threat model.
5. Add or update tests that exercise the new permission's reachable surface
   in `src-tauri/src/data.rs` `mod tests` or the relevant frontend
   component test file.
