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

## What's out of scope

- Vulnerabilities in upstream dependencies (Tauri, React, serde) — please report those to the upstream project. We'll track and update once they ship a fix.
- Anything that requires a malicious actor to already control the user's filesystem (cradle is a local-first read-only viewer; if you can write to the user's disk, you've already won).
- Reports against world content itself (NPC text, images, audio) — that's a canon-side concern, not cradle's.
