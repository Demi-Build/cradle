# Release runbook

This is the operator's guide for cutting a Cradle release. It covers the
one-time secrets/setup, the demo-tarball upload workflow, and the actual
tag-and-ship sequence.

If you're reading this and you're not the maintainer doing a release, you
probably don't need any of it.

## One-time setup

These are the things that must exist before the first `v*` tag push will
produce a working release. Do them once; don't repeat unless something
expires (Apple cert) or rotates (the .p12 password).

### 1. Demo tarball as a GitHub Release asset

The bundled MazeWorld 5-room demo is ~1 GB (mostly portraits). Too big for
git, too bandwidth-hungry for Git LFS. We host it as a release asset on a
dedicated `demo-v*` tag on this repo, and `scripts/fetch-demo.sh` pulls it
on demand for both local dev and CI.

Package + upload steps (run from the repo root):

```bash
cd bibles
tar --exclude='.DS_Store' -czf mazeworld-demo-v0.1.0.tar.gz mazeworld_5_room_demo
shasum -a 256 mazeworld-demo-v0.1.0.tar.gz
```

Save the printed hash — it goes into the optional `DEMO_SHA256` env var if
you want CI to verify integrity.

> **zsh users:** `#` is not a comment character in interactive zsh by
> default. `setopt INTERACTIVE_COMMENTS` in your `~/.zshrc` once and you can
> stop pasting trailing `# foo` lines that get treated as filename arguments.

Upload as a pre-release that is **not** the latest:

```bash
gh release create demo-v0.1.0 mazeworld-demo-v0.1.0.tar.gz \
  --title "MazeWorld 5-room demo (v0.1.0)" \
  --notes "Bundled demo world for cradle v0.1.x. Not a cradle release." \
  --prerelease \
  --latest=false
```

If the upload errors mid-flight, the tag was probably created on the first
attempt. Re-upload just the asset:

```bash
gh release upload demo-v0.1.0 mazeworld-demo-v0.1.0.tar.gz --clobber
```

Verify the download path that CI will use:

```bash
curl -fL -o /tmp/demo.tar.gz \
  https://github.com/Demi-Build/cradle/releases/download/demo-v0.1.0/mazeworld-demo-v0.1.0.tar.gz
shasum -a 256 /tmp/demo.tar.gz
# should match the hash you saved above
```

### Bumping the demo

When the demo content changes (e.g. v0.2 ships new entity types):

1. `tar` + `gh release create demo-v0.2.0 ...` (same flags as above).
2. Bump `DEMO_TAG` in `.github/workflows/release.yml`, `.github/workflows/ci.yml`, and the default in `scripts/fetch-demo.sh`.
3. New PRs and releases pick up the new demo automatically.

### 2. macOS signing + notarization GitHub Secrets

The release workflow expects seven secrets to be set under
**Settings → Secrets and variables → Actions → New repository secret**.
`tauri-action` reads them, decodes the .p12, imports it into a temporary
keychain, signs the `.app` and `.dmg`, then submits to Apple notarization.

Step-by-step:

```bash
# 1. Export your "Developer ID Application" cert from Keychain Access as a
#    .p12 with a STRONG password. Generate one:
openssl rand -base64 32 | pbcopy
#    Paste it as the .p12 export password. Save the password somewhere
#    durable (1Password, your password manager) — you may need it again.

# 2. Base64-encode the .p12 for storage as a GitHub Secret.
base64 -i ~/Downloads/cradle-developer-id.p12 | pbcopy

# 3. Generate an Apple app-specific password at
#    https://appleid.apple.com → Sign-In and Security → App-Specific Passwords.
#    Label it "cradle-ci-notarization."

# 4. Find your Team ID at https://developer.apple.com/account → Membership.
#    For Wolfgang's account this is VRM57L6S3D.
```

Set these secrets:

| Secret                       | Value                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64 string from step 2                                                                                                                                              |
| `APPLE_CERTIFICATE_PASSWORD` | The .p12 password from step 1                                                                                                                                          |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: WOLFGANG JUSTICE BLACK (VRM57L6S3D)` (must match `signingIdentity` in `src-tauri/tauri.conf.json` exactly — no quotes, no trailing newline) |
| `APPLE_ID`                   | Your Apple ID email                                                                                                                                                    |
| `APPLE_PASSWORD`             | The app-specific password from step 3 (NOT your Apple ID login)                                                                                                        |
| `APPLE_TEAM_ID`              | `VRM57L6S3D`                                                                                                                                                           |
| `KEYCHAIN_PASSWORD`          | Any random string. `openssl rand -base64 32` is fine. tauri-action uses it to lock/unlock the temporary keychain it creates in CI.                                     |

After the .p12 is uploaded as `APPLE_CERTIFICATE`, delete the local `.p12`
file from `~/Downloads/`. The cert in your keychain is untouched.

### 3. Optional but recommended: scope the signing secrets to a GitHub Environment

By default the secrets above are repository-wide, which means every workflow
run on every branch can read them. For code-signing material that's the
most important secret in the repo; an attacker who exfiltrates
`APPLE_CERTIFICATE` can sign malware as you.

To gate access behind a tag-only environment:

1. Settings → Environments → New environment → name it `release-signing`.
2. Move the seven secrets from "Repository secrets" to "Environment secrets"
   on that environment.
3. In the environment's **Deployment branches and tags** rule, select
   **Selected branches and tags** and add a tag pattern: `v*`.
4. Optionally enable **Required reviewers** and add yourself, so every
   release pauses for an "Approve and deploy" click before signing runs.
5. Edit `.github/workflows/release.yml`'s `build-tauri` job and add:
   ```yaml
   environment: release-signing
   ```
   Right under the existing `permissions:` block. Without that line, the
   workflow won't see the environment-scoped secrets.

This is recommended but not required for v0.1. Can be done after the first
release ships.

## Cutting a release

After all of the above is in place:

1. Make sure `main` is up to date and CI is green.
2. Bump versions in lockstep:
   - `package.json` → `"version"`
   - `src-tauri/Cargo.toml` → `[package] version`
   - `src-tauri/tauri.conf.json` → `"version"`
3. Update `CHANGELOG.md`:
   - Move everything from `[Unreleased]` into a new `[X.Y.Z] - YYYY-MM-DD`
     section.
   - Update the comparison links at the bottom of the file.
4. Commit + push the version bump + changelog edit on `main`.
5. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push --tags
   ```
   Or use the GitHub web UI: Releases → Draft a new release → "Choose a
   tag" → type `vX.Y.Z` → "Create new tag on publish" → Publish release.
6. Watch the Actions tab. The release workflow:
   - Creates a draft GitHub Release.
   - Builds on macOS / Ubuntu / Windows in parallel (~25-45 min for the
     first run; faster after Rust caches warm up).
   - macOS step does Developer ID signing + Apple notarization (the
     notarization submission alone can take 5-15 min; tauri-action waits).
   - Uploads `.dmg`, `.msi`, `.AppImage` (and `.deb`) as release assets.
   - Flips the draft release to published once all platforms succeed.
7. Smoke-test each downloaded installer on its native OS before
   announcing the release. At minimum: install, launch, click
   **Try the bundled demo**, click around the world for a minute.

If the macOS notarization fails, the workflow logs include the Apple
submission ID. Get details with:

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID"
```

The most common failure is using your Apple ID login password instead of an
app-specific password, or a missing `--options runtime` (hardened runtime
entitlement) — but tauri-action handles the latter for you.
