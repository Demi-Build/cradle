# Security Policy

## Supported versions

Cradle is pre-1.0. Only the most recent release on `main` receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

**Please do not file public issues, discussions, or pull requests for security problems.** Public reports give attackers a head start.

### Preferred: private vulnerability reporting

Use GitHub's private vulnerability reporting on this repository:

1. Go to the [**Security** tab](https://github.com/Demi-Build/cradle/security) of the repo.
2. Click **Report a vulnerability**.
3. Fill in the form using the checklist below.

GitHub keeps these reports private between you and the maintainers. This is the path to use whenever possible. (Background: [GitHub's docs on private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).)

### Fallback: contact request via issue

If private reporting is unavailable for some reason (e.g. it has not been enabled yet, or you cannot log in to GitHub), open an issue containing **only** a contact request:

- **Title:** `[security] please contact me`
- **Body:** A way to reach you privately (e.g. a public profile, throwaway email).
- **Do not include any details about the vulnerability in the public issue.**

A maintainer will reach out through the channel you provide.

### Alternate contact

The default contact is **@wolfgangjblack**. If your report concerns that account, or you do not get a response within the SLA below, escalate to [GitHub Trust & Safety](https://support.github.com/contact/report-abuse).

## What to include in your report

A useful report contains, at minimum:

- Cradle version (from the app's About info or `package.json` / `Cargo.toml`).
- OS and architecture (e.g. macOS 14 arm64, Windows 11 x64).
- A clear description of the issue and the security impact.
- Step-by-step reproduction instructions.
- Any proof-of-concept world directory, JSON file, or asset path needed to trigger the issue. Strip personal data first.
- Optional: suggested fix, references to similar CVEs, or relevant code lines.

## Response expectations

We are a small project. Expect:

- **First response:** within 7 days.
- **Triage decision** (confirmed / not a security issue / need more info): within 14 days.
- **Fix or mitigation plan** for confirmed issues: within 30 days.
- **Public advisory:** approximately 30 days after a fix ships, coordinated with the reporter. We will credit reporters in the release notes and advisory unless you prefer to remain anonymous.

If a fix will take longer than 30 days, we will say so and agree on a revised timeline with the reporter.

## Safe harbor

We support good-faith security research. We will not pursue legal action against, or ask law enforcement to investigate, researchers who:

- Make a good-faith effort to follow this policy.
- Report any vulnerability promptly.
- Do not access, modify, or destroy data beyond what is necessary to demonstrate the issue.
- Do not exploit the issue for any reason other than verification and reporting.
- Give the project a reasonable opportunity to fix the issue before public disclosure.

If you are unsure whether your research falls within this policy, contact us first via the channels above.

## What's in scope

- The Tauri Rust backend (`src-tauri/`) — anything that touches the filesystem, parses world JSON, or resolves asset paths.
- The frontend's handling of untrusted world data (e.g., XSS via maliciously crafted entity fields rendered through `react-markdown`).
- IPC command surfaces (`load_world`, `read_world_json`, `resolve_asset`, etc.) — particularly path-traversal or scope-escape on `assetProtocol`.
- The signed/notarized release builds — packaging or distribution issues that would let a tampered build masquerade as official.

## Note on `assetProtocol.scope`

`src-tauri/tauri.conf.json` configures the Tauri asset protocol with `scope: ["**"]`. That looks alarming on its own, so this section explains what it actually means and where the real containment lives.

**What the asset protocol is.** Tauri exposes a `tauri://localhost/.../asset` URL scheme that lets the webview load local files directly. Without it, every portrait, map, and audio clip would have to be base64-encoded and shipped through IPC, which is roughly 5-10x slower for large media. The asset protocol is a hard requirement for Cradle to feel responsive.

**Why the scope is so wide.** Worlds emitted by canon embed _absolute_ paths to portraits in their JSON (e.g. `/Users/.../mazeworld/runs/abc/data/portraits/npcs/alice.png`) — paths that point at canon's own scratch directory on whatever machine generated the world. A narrow scope would have to enumerate every possible canon scratch dir on every possible machine. Wide scope plus a strict containment check at resolution time is both simpler and tighter.

**The containment guarantee.** Every asset URL is routed through `LocalFsDataSource::resolve_asset` in [src-tauri/src/data.rs](src-tauri/src/data.rs) (lines 288-346). The resolver:

1. Discards any absolute prefix in the hint and matches on basename only — `Path::join` silently returns an absolute argument unchanged, so naive joining would let a hint escape the world tree.
2. Re-roots any `data/portraits/...` suffix against the _currently loaded world_, not the path the hint claims to come from.
3. Falls back to a basename search inside the loaded world's portrait subfolders.
4. Rejects anything that doesn't resolve under `world_root`, via the `under_world` predicate at line 301. Hints that point at `/etc/hosts`, `~/.ssh/`, or any other path outside the loaded world return `None` and the webview's request fails.

**Tests that prove containment.** `resolve_asset_rejects_paths_outside_world` ([src-tauri/src/data.rs](src-tauri/src/data.rs) lines 737-743) gives `/etc/hosts` as the hint and asserts `None`. `resolve_asset_rehomes_portrait_paths` (lines 746-754) gives a stale `/scratch/mazeworld/runs/abc/...` absolute hint and asserts the result lives under the test fixture's world root, not the bogus prefix. `resolve_asset_finds_audio_by_basename` covers the same property for audio assets.

**Residual risks.**

- **Symlink under the world tree.** If an attacker can plant a symlink physically inside `bibles/<world>/data/portraits/` that points outside the world, `resolve_asset` would return the symlink's path (it does not call `canonicalize`), and the webview would dereference it. To plant the symlink, the attacker already needs write access to the user's filesystem at exactly the right path — see "What's out of scope" below.
- **TOCTOU.** The resolver checks `p.exists()` before returning the path, then the webview opens it. There's a small window where the file could be swapped. Same prerequisite as the symlink case.
- **Worlds shipped from untrusted sources.** Cradle treats world JSON as untrusted input (markdown is sanitized by `react-markdown`'s default config), but loading a world implicitly trusts its file tree to not contain hostile symlinks. Don't load worlds from sources you don't trust.

The signed and notarized release builds are the primary mitigation against tampered Cradle binaries delivering hostile worlds — the binary itself can be verified via Apple's signing/notarization. World content is not signed in v0.1.

## What's out of scope

- Vulnerabilities in upstream dependencies (Tauri, React, serde) — please report those to the upstream project. We'll track and update once they ship a fix.
- Anything that requires a malicious actor to already control the user's filesystem (cradle is a local-first read-only viewer; if you can write to the user's disk, you've already won).
- Reports against world content itself (NPC text, images, audio) — that's a canon-side concern, not cradle's.
