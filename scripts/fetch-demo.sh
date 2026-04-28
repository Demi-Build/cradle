#!/usr/bin/env bash
# Fetch the bundled MazeWorld demo world from a GitHub Release.
#
# The demo (~1 GB, mostly portraits) is too large for git, so it lives as a
# tarball asset on a dedicated `demo-v*` GitHub Release. This script downloads
# and extracts it into bibles/mazeworld_5_room_demo/ on demand.
#
# Used by:
#   - Local dev: `npm run fetch-demo` (after `npm install`)
#   - CI:        the "Fetch bundled demo" step in
#                .github/workflows/{ci,release}.yml
#
# Environment:
#   DEMO_TAG       Release tag to fetch (default: demo-v0.1.0).
#   DEMO_SHA256    Optional sha256 hex of the tarball. If set, integrity is
#                  verified after download and the script aborts on mismatch.
#   DEMO_REPO      owner/repo that hosts the demo release
#                  (default: Demi-Build/cradle).
#
# Idempotent: if the demo is already extracted (world_bible.json exists),
# the script exits 0 without doing anything.

set -euo pipefail

DEMO_TAG="${DEMO_TAG:-demo-v0.1.0}"
DEMO_REPO="${DEMO_REPO:-Demi-Build/cradle}"
DEMO_SHA256="${DEMO_SHA256:-}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
bibles_dir="${repo_root}/bibles"
demo_dir="${bibles_dir}/mazeworld_5_room_demo"
sentinel="${demo_dir}/data/world_bible.json"

if [ -f "${sentinel}" ]; then
  echo "fetch-demo: ${sentinel} already present, skipping download."
  exit 0
fi

version="${DEMO_TAG#demo-}"
asset="mazeworld-demo-${version}.tar.gz"
url="https://github.com/${DEMO_REPO}/releases/download/${DEMO_TAG}/${asset}"

mkdir -p "${bibles_dir}"
tmp_tarball="$(mktemp -t cradle-demo.XXXXXX.tar.gz)"
trap 'rm -f "${tmp_tarball}"' EXIT

echo "fetch-demo: downloading ${url}"
curl --fail --location --progress-bar --output "${tmp_tarball}" "${url}"

if [ -n "${DEMO_SHA256}" ]; then
  echo "fetch-demo: verifying sha256"
  actual="$(shasum -a 256 "${tmp_tarball}" | awk '{print $1}')"
  if [ "${actual}" != "${DEMO_SHA256}" ]; then
    echo "fetch-demo: sha256 mismatch" >&2
    echo "  expected: ${DEMO_SHA256}" >&2
    echo "  actual:   ${actual}" >&2
    exit 1
  fi
fi

echo "fetch-demo: extracting into ${bibles_dir}"
tar -xzf "${tmp_tarball}" -C "${bibles_dir}"

if [ ! -f "${sentinel}" ]; then
  echo "fetch-demo: extraction did not produce ${sentinel}" >&2
  exit 1
fi

echo "fetch-demo: ready at ${demo_dir}"
