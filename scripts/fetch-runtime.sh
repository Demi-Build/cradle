#!/usr/bin/env bash
# Fetch the VENDORED PYTHON RUNTIME the bundled app ships (row P0-11, W3.3).
#
# Same shape as `fetch-demo.sh` — the payload-at-build-time pattern this
# repo already uses: idempotent, checksum-verified, one named error per
# failure, cached so a second run needs no network. What differs is only the
# payload: a python-build-standalone CPython with the canon wheel installed
# into it, so a machine with NO PYTHON can still run every canon verb.
#
# Used by:
#   - Local dev: `npm run fetch-runtime`
#   - CI:        "Fetch the vendored runtime" in .github/workflows/{ci,release}.yml
#
# Everything pinned lives in `scripts/runtime-manifest.txt` — release tag,
# CPython version, per-platform sha256, the canon source and its extras.
#
# Environment:
#   RUNTIME_TRIPLE   Target triple to build (default: this host's). One of the
#                    `sha256` rows in the manifest.
#   CANON_SPEC       Overrides the manifest's `canon_source`: a checkout dir,
#                    a built .whl, or a pip requirement source (git+https://…).
#   RUNTIME_CACHE    Where downloaded tarballs live (default <repo>/.cache/runtime).
#   RUNTIME_FORCE    =1 rebuilds even when the stamp already matches.
#   RUNTIME_PIP_ARGS Extra args for the canon install (e.g. --no-index for a
#                    fully offline build against a local wheelhouse).
#
# Idempotent: a second run with the payload already present is a no-op that
# says so, and touches the network not at all. A rebuild with the tarball
# already cached skips the CPython download too — pip still wants an index for
# the wheels, which is what RUNTIME_PIP_ARGS is for (point it at a wheelhouse
# with `--no-index --find-links` for a genuinely air-gapped build).
#
# NEVER A HALF-TREE: the runtime is built in a sibling `.partial-*` directory
# and moved into place only once the install verifies; any failure removes it
# and exits non-zero with a named reason.
#
# Console-script shebangs inside the built tree are baked to the BUILD path
# and are deliberately never used: cradle's resolver runs the bundled canon as
# `<python> -m canon.cli.main` (see `canon_command` in src-tauri/src/lib.rs),
# which survives the move into /Applications/Cradle.app.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
manifest="${repo_root}/scripts/runtime-manifest.txt"
runtime_root="${repo_root}/src-tauri/resources/runtime"

die() {
  echo "fetch-runtime: $1" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------
[ -f "${manifest}" ] || die "missing pin file ${manifest} — it is committed; restore it before building."

manifest_value() {
  awk -v key="$1" '$1 == key { $1 = ""; sub(/^[ \t]+/, ""); print; exit }' "${manifest}"
}
manifest_sha() {
  awk -v triple="$1" '$1 == "sha256" && $2 == triple { print $3; exit }' "${manifest}"
}
manifest_triples() {
  awk '$1 == "sha256" { print "  - " $2 }' "${manifest}"
}

release="$(manifest_value release)"
python_version="$(manifest_value python)"
canon_extras="$(manifest_value canon_extras)"
canon_source="${CANON_SPEC:-$(manifest_value canon_source)}"
[ -n "${release}" ] || die "the manifest has no \`release\` line."
[ -n "${python_version}" ] || die "the manifest has no \`python\` line."
[ -n "${canon_extras}" ] || die "the manifest has no \`canon_extras\` line."
[ -n "${canon_source}" ] || die "no canon source: set CANON_SPEC or a \`canon_source\` line in the manifest."

# ---------------------------------------------------------------------------
# Where the canon wheel comes from. An existing path (checkout or .whl) is
# installed by path with the extras appended; anything else is handed to pip
# as a requirement SOURCE, which is how a git ref or an index URL rides.
#
# Resolved HERE, before anything is downloaded, so a source that cannot
# satisfy the bundle fails in a second rather than after a 60 MB fetch.
# ---------------------------------------------------------------------------
canon_abs="${canon_source}"
case "${canon_source}" in
  /* | [A-Za-z]:[/\\]*) ;;
  *) canon_abs="${repo_root}/${canon_source}" ;;
esac
if [ -d "${canon_abs}" ] || [ -f "${canon_abs}" ]; then
  canon_abs="$(cd "$(dirname "${canon_abs}")" && pwd)/$(basename "${canon_abs}")"
  install_target="${canon_abs}[${canon_extras}]"
  canon_label="${canon_abs}"
else
  case "${canon_source}" in
    git+* | http://* | https://* | file://*)
      install_target="canon-ai[${canon_extras}] @ ${canon_source}"
      ;;
    *)
      die "canon source '${canon_source}' is neither an existing path nor a requirement URL. Set CANON_SPEC to a canon-ai checkout, a built .whl, or a git+https:// source."
      ;;
  esac
  canon_label="${canon_source}"
fi

# EXTRAS PRECHECK. pip only WARNS on an extra a project does not declare, so
# without this a source missing `agent` installs "successfully" and then dies
# 40 lines below at the import verification with a reason that names fastapi
# rather than the ref. When the source is a checkout we can read the truth
# straight out of its pyproject and say exactly which extras are missing —
# the failure a release build hits when `canon_ref` points at a branch that
# has not received the September work yet.
if [ -f "${canon_abs}/pyproject.toml" ]; then
  declared="$(awk '
    /^\[project\.optional-dependencies\]/ { sec = 1; next }
    /^\[/ { sec = 0 }
    sec && /^[A-Za-z0-9_.-]+[ \t]*=/ { sub(/[ \t]*=.*/, ""); print }
  ' "${canon_abs}/pyproject.toml")"
  absent=""
  for extra in $(printf '%s' "${canon_extras}" | tr ',' ' '); do
    printf '%s\n' "${declared}" | grep -qx -- "${extra}" || absent="${absent} ${extra}"
  done
  if [ -n "${absent}" ]; then
    die "the canon source at ${canon_abs} does not declare the extras the bundle promises:${absent}
It declares: $(printf '%s' "${declared}" | tr '\n' ' ')
Nothing was downloaded. Either point \`canon_ref\`/CANON_SPEC at a canon-ai ref
that carries them, or change \`canon_extras\` in scripts/runtime-manifest.txt."
  fi
fi

# ---------------------------------------------------------------------------
# Target platform — the triple is Rust's, python-build-standalone's, and the
# resource directory name. One vocabulary (see the manifest header).
# ---------------------------------------------------------------------------
host_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${arch}" in
    arm64 | aarch64) arch="aarch64" ;;
    x86_64 | amd64) arch="x86_64" ;;
    *) die "unsupported CPU ${arch} — the manifest pins:
$(manifest_triples)" ;;
  esac
  case "${os}" in
    Darwin) echo "${arch}-apple-darwin" ;;
    Linux) echo "${arch}-unknown-linux-gnu" ;;
    MINGW* | MSYS* | CYGWIN* | Windows_NT) echo "x86_64-pc-windows-msvc" ;;
    *) die "unsupported OS ${os} — the manifest pins:
$(manifest_triples)" ;;
  esac
}

triple="${RUNTIME_TRIPLE:-$(host_triple)}"
sha256_expected="$(manifest_sha "${triple}")"
[ -n "${sha256_expected}" ] || die "no checksum pinned for ${triple}. The manifest pins:
$(manifest_triples)"

case "${triple}" in
  *-pc-windows-msvc) is_windows=1 ;;
  *) is_windows=0 ;;
esac

asset="cpython-${python_version}+${release}-${triple}-install_only.tar.gz"
url="https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${asset}"
dest="${runtime_root}/${triple}"
stamp_file="${dest}/.runtime-stamp"
stamp="pbs=${release} python=${python_version} triple=${triple} extras=${canon_extras} canon=${canon_source}"

if [ "${is_windows}" = "1" ]; then
  py_rel="python/python.exe"
else
  py_rel="python/bin/python3"
fi

# ---------------------------------------------------------------------------
# Idempotence: a matching stamp beside a working interpreter is a no-op.
# ---------------------------------------------------------------------------
if [ "${RUNTIME_FORCE:-0}" != "1" ] &&
  [ -f "${stamp_file}" ] &&
  [ -x "${dest}/${py_rel}" ] &&
  [ "$(cat "${stamp_file}")" = "${stamp}" ]; then
  echo "fetch-runtime: ${dest} already holds CPython ${python_version} (${release}) with canon[${canon_extras}] — nothing to do."
  exit 0
fi

# ---------------------------------------------------------------------------
# Download + verify. Cached by asset name; a cached tarball whose checksum
# still matches is reused, so a rebuild never re-downloads CPython.
# ---------------------------------------------------------------------------
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    die "no sha256 tool found (shasum / sha256sum / openssl) — the payload cannot be verified, so it is not installed."
  fi
}

cache_dir="${RUNTIME_CACHE:-${repo_root}/.cache/runtime}"
mkdir -p "${cache_dir}"
tarball="${cache_dir}/${asset}"

if [ -f "${tarball}" ] && [ "$(sha256_of "${tarball}")" = "${sha256_expected}" ]; then
  echo "fetch-runtime: using the verified cached payload ${tarball}"
else
  rm -f "${tarball}"
  echo "fetch-runtime: downloading ${url}"
  if ! curl --fail --location --progress-bar --output "${tarball}.part" "${url}"; then
    rm -f "${tarball}.part"
    die "download failed for ${url} — no runtime was written. Check the network, or the \`release\`/\`python\` pins in scripts/runtime-manifest.txt."
  fi
  actual="$(sha256_of "${tarball}.part")"
  if [ "${actual}" != "${sha256_expected}" ]; then
    rm -f "${tarball}.part"
    echo "fetch-runtime: sha256 MISMATCH for ${asset} — refusing to install it." >&2
    echo "  expected: ${sha256_expected}" >&2
    echo "  actual:   ${actual}" >&2
    exit 1
  fi
  mv "${tarball}.part" "${tarball}"
  echo "fetch-runtime: verified sha256 ${sha256_expected}"
fi

# ---------------------------------------------------------------------------
# Build the tree in a partial directory; move it into place only when whole.
# ---------------------------------------------------------------------------
mkdir -p "${runtime_root}"
work="$(mktemp -d "${runtime_root}/.partial-XXXXXX")"
cleanup() {
  [ -n "${work:-}" ] && [ -d "${work}" ] && rm -rf "${work}"
}
trap cleanup EXIT

echo "fetch-runtime: unpacking CPython ${python_version} into ${dest}"
tar -xzf "${tarball}" -C "${work}" || die "could not unpack ${tarball} — the cached payload is removed on the next run's checksum pass."
py="${work}/${py_rel}"
[ -x "${py}" ] || die "the payload did not contain ${py_rel} — is the \`release\`/\`python\` pin still an install_only build?"

# CROSS-EXECUTION. Everything below RUNS the just-unpacked TARGET interpreter —
# pip, then the import verification — so building a triple this host cannot
# execute is impossible, not merely slow. The macOS release leg builds both
# darwin triples on one (arm64) runner and depends on Rosetta 2 for the
# x86_64 pass; without this the failure surfaces as "pip could not install",
# which names the wrong thing entirely.
if ! "${py}" -E -s -c 'pass' >/dev/null 2>&1; then
  hint="this host cannot execute a ${triple} binary."
  case "${triple}" in
    x86_64-apple-darwin)
      hint="an arm64 Mac runs x86_64 binaries only under Rosetta 2 — install it with \`softwareupdate --install-rosetta --agree-to-license\`, or build this triple on an Intel host."
      ;;
  esac
  die "the ${triple} interpreter would not run: ${hint} Nothing was written to ${dest}."
fi

echo "fetch-runtime: installing canon-ai[${canon_extras}] from ${canon_label}"

# `-E -s` is load-bearing, not hygiene: without it pip resolves against the
# BUILD MACHINE's `~/.local/lib/pythonX.Y/site-packages` (any host with the
# same CPython minor shadows the fresh tree), reports half the dependency
# graph "already satisfied", and ships a runtime that only works on the
# machine that built it. Cradle spawns the bundled interpreter with the same
# isolation (`canon_command` in src-tauri/src/lib.rs).
# shellcheck disable=SC2086  # RUNTIME_PIP_ARGS is a deliberate arg list.
"${py}" -E -s -m pip install --disable-pip-version-check --no-input ${RUNTIME_PIP_ARGS:-} "${install_target}" ||
  die "pip could not install ${install_target} into the fresh runtime — nothing was written to ${dest}."

# Prove the tree before it is allowed to exist: the module must import and the
# CLI must answer, both ISOLATED — anything that only imports because the build
# machine happens to have it is a runtime that breaks on a fresh machine.
"${py}" -E -s -c 'import canon' >/dev/null 2>&1 ||
  die "canon did not import from the freshly built runtime — nothing was written to ${dest}."
"${py}" -E -s -m canon.cli.main --version >/dev/null ||
  die "\`python -m canon.cli.main --version\` failed in the freshly built runtime — nothing was written to ${dest}."
# Every extra the bundle promises, imported from inside the tree. `pygame`
# needs a display-free driver to import cleanly on a build box.
SDL_VIDEODRIVER=dummy "${py}" -E -s -c '
import importlib, sys
missing = []
for mod in ("typer", "numpy", "PIL", "pygame", "anthropic", "openai", "fal_client", "google.genai", "elevenlabs", "fastapi", "uvicorn"):
    try:
        importlib.import_module(mod)
    except Exception as e:  # noqa: BLE001 - report every gap at once
        missing.append(f"{mod}: {e}")
if missing:
    print("\n".join(missing), file=sys.stderr)
    sys.exit(1)
' >/dev/null || die "the runtime is missing an extra the bundle promises (see above) — nothing was written to ${dest}."

printf '%s' "${stamp}" >"${work}/.runtime-stamp"

# `mktemp -d` makes the staging directory 0700 and `mv` preserves that, which
# would ship the one bundled resource directory the app's own user might not
# be able to traverse (every other one — `demo`, `notices` — is 0755). The
# tarball's own contents are already world-readable; this fixes only the root
# we created.
chmod 755 "${work}"

rm -rf "${dest}"
mv "${work}" "${dest}"
work=""
trap - EXIT

version_line="$("${dest}/${py_rel}" -m canon.cli.main --version)"
echo "fetch-runtime: ready at ${dest}"
echo "fetch-runtime:   interpreter ${dest}/${py_rel}"
echo "fetch-runtime:   canon       ${version_line}"
