#!/usr/bin/env bash
# Code-sign the vendored runtime's Mach-O binaries (macOS only, row P0-11).
#
# WHY THIS EXISTS. Tauri's macOS bundler signs the app bundle and the binaries
# it knows about; it does not walk arbitrary files under `Contents/Resources`.
# A vendored CPython is hundreds of Mach-O files — the interpreter, the
# dylibs, every compiled extension module — and Apple's notary service rejects
# a hardened-runtime app that contains an unsigned Mach-O. Signatures are
# embedded IN the files, so signing the tree at its source path before
# `tauri build` copies it is enough: the copies carry the signatures.
#
# Signing the runtime tree in place is idempotent (`--force` re-signs) and a
# no-op on any platform that is not macOS.
#
# Usage:
#   APPLE_SIGNING_IDENTITY="Developer ID Application: …" bash scripts/sign-runtime.sh
#   RUNTIME_SIGN_ADHOC=1 bash scripts/sign-runtime.sh   # local smoke only
#
# Environment:
#   APPLE_SIGNING_IDENTITY  the identity to sign with. Must already be in a
#                           keychain this process can read.
#   RUNTIME_SIGN_ADHOC      =1 signs ad-hoc (`-s -`). Fine for a local Gatekeeper
#                           run; NOT accepted by notarization.
#   RUNTIME_TRIPLE          which runtime to sign (default: this host's).
#   RUNTIME_SIGN_REQUIRED   =1 turns every skip below into a NAMED FAILURE.
#                           release.yml sets it: on a release tag an unsigned
#                           runtime inside a hardened-runtime bundle is what
#                           the notary service rejects, so a silent skip there
#                           hides the very bug this script exists to catch.
#                           Unset locally, where an unsigned build is normal.
#
# With neither identity set it prints exactly what is unsigned and exits 0 — an
# unsigned local build is normal and must not fail `npm run tauri build`.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "sign-runtime: not macOS — nothing to sign."
  exit 0
fi

arch="$(uname -m)"
case "${arch}" in
  arm64 | aarch64) arch="aarch64" ;;
  x86_64 | amd64) arch="x86_64" ;;
esac
triple="${RUNTIME_TRIPLE:-${arch}-apple-darwin}"
runtime="${repo_root}/src-tauri/resources/runtime/${triple}"

if [ ! -d "${runtime}" ]; then
  echo "sign-runtime: no runtime at ${runtime} — run \`npm run fetch-runtime\` first." >&2
  exit 1
fi

# Every Mach-O under the tree: the interpreter, .dylib/.so extension modules,
# and the console-script wrappers pip built. `file` is the only honest test —
# extensions lie in both directions.
# (macOS ships bash 3.2 — no `mapfile`; a read loop is the portable form.)
targets=()
while IFS= read -r found; do
  [ -n "${found}" ] && targets+=("${found}")
done < <(
  find "${runtime}" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' \) -print0 |
    xargs -0 file --mime-type 2>/dev/null |
    awk -F': ' '$2 ~ /mach-binary|x-mach-binary/ { print $1 }'
)

if [ "${#targets[@]}" -eq 0 ]; then
  echo "sign-runtime: found no Mach-O files under ${runtime} — refusing to claim success." >&2
  exit 1
fi

identity="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "${identity}" ] && [ "${RUNTIME_SIGN_ADHOC:-0}" = "1" ]; then
  identity="-"
  echo "sign-runtime: AD-HOC signing (\`-s -\`). Valid for a local run; notarization will REJECT it."
fi

# An identity that is not actually in a readable keychain would make every
# `codesign` call fail. Check first and say so by name. Locally that is a skip
# (an unsigned runtime is a notarization problem, a broken dev build is a worse
# one); under RUNTIME_SIGN_REQUIRED it is a failure, because on a release tag
# "skipped" means the bundle ships hundreds of unsigned Mach-O files and the
# notary rejects it later with a far less legible message.
if [ -n "${identity}" ] && [ "${identity}" != "-" ]; then
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -qF "${identity}"; then
    echo "sign-runtime: '${identity}' is not in any readable keychain." >&2
    echo "sign-runtime: import the Developer ID cert BEFORE this step to sign the runtime." >&2
    if [ "${RUNTIME_SIGN_REQUIRED:-0}" = "1" ]; then
      echo "sign-runtime: RUNTIME_SIGN_REQUIRED=1 — refusing to ship ${#targets[@]} unsigned Mach-O files." >&2
      exit 1
    fi
    echo "sign-runtime: skipping." >&2
    exit 0
  fi
fi

if [ -z "${identity}" ]; then
  echo "sign-runtime: ${#targets[@]} Mach-O files under ${runtime} are unsigned."
  echo "sign-runtime: no APPLE_SIGNING_IDENTITY set."
  if [ "${RUNTIME_SIGN_REQUIRED:-0}" = "1" ]; then
    echo "sign-runtime: RUNTIME_SIGN_REQUIRED=1 — a notarized build must set APPLE_SIGNING_IDENTITY." >&2
    exit 1
  fi
  echo "sign-runtime: skipping (a local unsigned build is fine)."
  echo "sign-runtime: a NOTARIZED build must set it, or Apple rejects the bundle."
  exit 0
fi

echo "sign-runtime: signing ${#targets[@]} Mach-O files with '${identity}'"
for f in "${targets[@]}"; do
  codesign --force --timestamp --options runtime --sign "${identity}" "${f}" >/dev/null 2>&1 ||
    {
      echo "sign-runtime: codesign failed on ${f}" >&2
      exit 1
    }
done

# Verify a representative one rather than claiming success blind.
probe="${runtime}/python/bin/python3"
[ -f "${probe}" ] || probe="${targets[0]}"
codesign --verify --verbose=1 "${probe}" 2>&1 | sed 's/^/sign-runtime:   /'
echo "sign-runtime: signed ${#targets[@]} files under ${runtime}"
