# Privacy

Cradle is a local-first desktop application. This document describes exactly what it does and does not do with your data.

## What we collect

**Nothing.** Cradle has no analytics, no telemetry, no crash reporting, no user accounts, and no servers. We have no way to learn that you have installed or used the app.

## What we transmit

**Nothing at runtime.** The app makes no network requests during normal use:

- No analytics or telemetry pings.
- No crash reports.
- No auto-update check (updates are distributed manually via GitHub Releases).
- No font CDN — Inter and JetBrains Mono ship inside the app bundle via [@fontsource-variable](https://fontsource.org/) (SIL OFL-1.1).
- No remote asset loading — all images, audio, and JSON come from the world directory you select.

The only outbound network activity is whatever the operating system or webview does on its own (e.g. OCSP certificate revocation checks the OS performs against signed binaries). Cradle itself initiates no connections.

## What we read from your disk

Cradle reads files only from a world directory that you explicitly select via the native folder picker on the start screen. Within that directory, it expects the canon-emitted layout described in the [README](./README.md#data-layer):

- JSON manifests under `data/`
- Portraits under `data/portraits/`
- Music and SFX under `data/music/` and `data/sfx/`

It does not scan, read, modify, or delete anything outside the world directory you pick. The Tauri asset protocol scope is configured to refuse paths outside the loaded world.

Cradle is **read-only** in v0.1. It does not write back to the world directory. (Editing lands in v0.2 — see the [roadmap](./README.md#roadmap).)

## What we store locally

A single key in your browser's local storage, scoped to the app:

- `cradle.recents.v1` — a list of world directories you have opened, so the start screen can show recent projects.

This data never leaves your machine. To clear it, delete the app's local storage (Tauri WebView data lives in the OS-standard app data directory) or click any "remove" affordance on the recent projects page if available.

## Third-party services

There are no third-party services. Cradle does not embed Google Analytics, Sentry, PostHog, Mixpanel, Segment, or any similar SDK.

## Future changes

If a future version introduces any kind of network call, telemetry, or remote service:

- It will be **opt-in**, not opt-out.
- It will be disclosed in the [CHANGELOG](./CHANGELOG.md) and in this document.
- A new version of this document will be committed before the feature ships.

## Reporting concerns

- **Security or privacy vulnerability:** see [SECURITY.md](./SECURITY.md).
- **General questions:** open a [GitHub Discussion](https://github.com/Demi-Build/cradle/discussions).
