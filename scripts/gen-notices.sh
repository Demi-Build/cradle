#!/usr/bin/env bash
# Generate the bundle's THIRD_PARTY_NOTICES.md (row P0-11, ASSUMPTION-1).
#
# Thin driver: locate the vendored runtime for this platform, then hand it to
# `scripts/gen_notices.py`, which walks the runtime's own metadata, the wheels
# installed into it, `cargo metadata` for the Rust side, and package-lock.json
# for the npm dependencies compiled into `dist/` (fonts included — the two
# variable families are SIL OFL, whose text must accompany them). The notices
# are generated from the ARTIFACTS, so they cannot drift from what ships.
#
# Used by:
#   - Local:  `npm run gen-notices` (add `--dry-run` to see what it found)
#   - CI:     the "Generate third-party notices" step in release.yml, between
#             fetching the runtime and `tauri build`.
#
# Environment:
#   RUNTIME_TRIPLE  which runtime to read (default: this host's, same rule as
#                   fetch-runtime.sh).
#   RUST_TARGETS    space-separated target triples the build produces; the
#                   crate lists are unioned across them. Defaults to both
#                   darwin triples on macOS (the bundle is universal) and to
#                   RUNTIME_TRIPLE elsewhere.
#
# Exits non-zero when a shipped component declares no license at all — that is
# a notice gap, and a gap is the one thing this file exists to prevent.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

host_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${arch}" in
    arm64 | aarch64) arch="aarch64" ;;
    x86_64 | amd64) arch="x86_64" ;;
  esac
  case "${os}" in
    Darwin) echo "${arch}-apple-darwin" ;;
    Linux) echo "${arch}-unknown-linux-gnu" ;;
    MINGW* | MSYS* | CYGWIN* | Windows_NT) echo "x86_64-pc-windows-msvc" ;;
    *) echo "" ;;
  esac
}

triple="${RUNTIME_TRIPLE:-$(host_triple)}"
runtime="${repo_root}/src-tauri/resources/runtime/${triple}"

if [ ! -d "${runtime}" ]; then
  echo "gen-notices: no runtime at ${runtime} — run \`npm run fetch-runtime\` first." >&2
  exit 1
fi

# The generator is plain-stdlib python; the vendored interpreter is always
# there by the time notices are generated, so use it rather than requiring a
# system python on the build box.
py="${runtime}/python/bin/python3"
[ -x "${py}" ] || py="${runtime}/python/python.exe"
[ -x "${py}" ] || {
  echo "gen-notices: no interpreter inside ${runtime}" >&2
  exit 1
}

# The C libraries CPython links are licensed per python-build-standalone
# RELEASE, and the release is pinned in one place — the manifest.
release="$(awk '$1 == "release" { print $2; exit }' "${repo_root}/scripts/runtime-manifest.txt")"
[ -n "${release}" ] || {
  echo "gen-notices: scripts/runtime-manifest.txt has no \`release\` line" >&2
  exit 1
}

# Which Rust target triples the build produces. `--filter-platform` answers
# for ONE triple, and the macOS bundle is UNIVERSAL — two slices in one .app —
# so a crate pulled in only for the other slice would otherwise be missing
# from notices for a binary that contains it. Overridable for a cross build.
if [ -n "${RUST_TARGETS:-}" ]; then
  targets="${RUST_TARGETS}"
elif [ "$(uname -s)" = "Darwin" ]; then
  targets="aarch64-apple-darwin x86_64-apple-darwin"
else
  targets="${triple}"
fi
target_args=()
for t in ${targets}; do
  target_args+=(--rust-target "$t")
done

exec "${py}" -E -s "${repo_root}/scripts/gen_notices.py" \
  --runtime "${runtime}" \
  --src-tauri "${repo_root}/src-tauri" \
  --repo-root "${repo_root}" \
  "${target_args[@]}" \
  --release-licenses "${repo_root}/scripts/runtime-licenses/${release}" \
  --out "${repo_root}/src-tauri/resources/notices/THIRD_PARTY_NOTICES.md" \
  "$@"
