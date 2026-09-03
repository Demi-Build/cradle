# python-build-standalone runtime licenses

The `install_only` archive `scripts/fetch-runtime.sh` downloads is stripped of
the license texts for the third-party C libraries CPython links (OpenSSL,
SQLite, libffi, liblzma, zlib, ncurses, libedit, Tcl/Tk, mpdecimal, expat, …).
Those libraries ARE shipped inside the app, so their licenses have to ship
with it — that is ASSUMPTION-1's "complete transitive notices".

So they are committed here, one directory per pinned release, and
`scripts/gen_notices.py` folds them into `THIRD_PARTY_NOTICES.md`. The
generator FAILS when the directory for the pinned release is missing: a
notices file that silently omits a shipped library is the one outcome this
row exists to prevent.

Verified 2026-09-02 for release `20260901`: the aarch64-apple-darwin,
x86_64-unknown-linux-gnu and x86_64-pc-windows-msvc `-full` archives carry an
identical, byte-for-byte identical set of 19 files, so one directory covers
all three platforms.

## Refreshing after a `release` bump in `runtime-manifest.txt`

```sh
tag=<new release tag>          # e.g. 20261001
py=<new python version>        # e.g. 3.12.15
base=https://github.com/astral-sh/python-build-standalone/releases/download/$tag
curl -sLO "$base/cpython-$py+$tag-aarch64-apple-darwin-pgo+lto-full.tar.zst"
mkdir -p scripts/runtime-licenses/$tag
tar --use-compress-program=unzstd -xf "cpython-$py+$tag-aarch64-apple-darwin-pgo+lto-full.tar.zst" \
    -C /tmp python/licenses
cp /tmp/python/licenses/*.txt scripts/runtime-licenses/$tag/
```

Then re-run the same extraction for the linux and windows `-full` archives and
diff the three sets; if they ever stop matching, keep the union.
