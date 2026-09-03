#!/usr/bin/env python3
"""Generate COMPLETE transitive third-party notices for what cradle ships.

Row P0-11 / ASSUMPTION-1. Four sources, one document:

1. **The vendored CPython** — its own license plus the third-party code
   python-build-standalone links into it (OpenSSL, SQLite, libffi, …), read
   from the distribution's own license metadata.
2. **Every wheel installed into that runtime** — walked with
   ``importlib.metadata`` *inside the vendored interpreter*, so the list is
   exactly what is on disk, not what a requirements file hoped for. Full
   license text is emitted wherever the wheel carries one (PEP 639
   ``.dist-info/licenses/``, or ``LICENSE*`` at the dist-info root).
3. **Every Rust crate** linked into the binary — from ``cargo metadata``,
   with full text pulled out of the crate's registry source when it is
   unpacked locally.
4. **Every npm production dependency** compiled into the frontend bundle —
   from ``package-lock.json``'s resolved tree (the lockfile is the exact
   answer, offline, and already committed), with full text read out of
   ``node_modules``. Tauri's ``frontendDist`` ships ``dist/`` inside the same
   application, and that bundle carries React, zustand, dagre, xyflow … and
   the two SIL-OFL variable font families ``src/main.tsx`` imports. OFL
   requires its text accompany the fonts, so this section is an obligation,
   not a courtesy.

pygame gets its own section: ASSUMPTION-1's posture is that it stays a
SEPARABLE, USER-REPLACEABLE wheel, and the notice has to say how a user
actually replaces it — that is the LGPL obligation the posture rests on.

Run it through ``scripts/gen-notices.sh``, which finds the runtime for you.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# Wheels whose license terms require more than a name — the notice spells out
# the user's rights and how to exercise them. Keyed by canonical dist name.
COPYLEFT_NOTES = {
    "pygame-ce": "pygame",
    "pygame": "pygame",
}

PYGAME_NOTICE = """\
### pygame — how to replace it

pygame is licensed under the **GNU Lesser General Public License v2.1 or
later**. Cradle ships it as a SEPARABLE, USER-REPLACEABLE component: it is an
ordinary Python wheel installed into the bundled runtime, not statically
linked into anything, and nothing in cradle or canon subclasses or modifies
it. It is used by one throwaway review harness
(`canon.packs.platformer.play`); no generated game depends on it.

You may replace the bundled pygame with your own build — modified or not — in
either of two ways:

1. **Replace it in place.** Install over it with the bundled interpreter:

       "<app resources>/runtime/<triple>/python/bin/python3" -m pip install \\
           --force-reinstall --no-deps pygame==<your version>

   (`python.exe` instead of `bin/python3` on Windows.) On macOS this modifies
   files inside a signed application bundle, so the app's code signature no
   longer matches; macOS may ask you to approve it again, or you can re-sign
   the bundle yourself.

2. **Point cradle at your own environment.** Set `CANON_BIN` to the `canon`
   executable of a Python environment you control. That environment's pygame
   is then the one used, and the bundled runtime is ignored entirely — this is
   the same override developers use, and it needs no changes to the app.

The pygame sources corresponding to the shipped version are available from
<https://github.com/pygame/pygame> and from PyPI
(`pip download pygame==<version> --no-binary :all:`).
"""

HEADER = """\
# Third-party notices

Cradle bundles third-party software so it can run on a machine with no Python
installed. This document lists everything shipped inside the application —
the vendored CPython runtime, every Python distribution installed into it,
every Rust crate linked into the executable, and every npm production
dependency compiled into the frontend bundle (fonts included) — with each
component's license.

It is GENERATED from the artifacts themselves (`scripts/gen-notices.sh`), not
maintained by hand, so it cannot drift from what actually ships.

"""

# --- the inventory the vendored interpreter reports about itself -----------
# Runs INSIDE the runtime: `importlib.metadata` there sees exactly the wheels
# on disk. `-E -s` keeps a build machine's own site-packages out of the answer
# (the same isolation `fetch-runtime.sh` installs under).
INVENTORY_SNIPPET = r"""
import json, sys
from importlib.metadata import distributions

def license_files(dist):
    out = {}
    base = getattr(dist, "_path", None)
    if base is None:
        return out
    base = __import__("pathlib").Path(base)
    for pattern in ("LICENSE*", "COPYING*", "NOTICE*", "licenses/*", "license_files/*"):
        for f in sorted(base.glob(pattern)):
            if f.is_file():
                try:
                    out[f.name] = f.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    pass
    return out

rows = []
for dist in distributions():
    md = dist.metadata
    classifiers = [c for c in md.get_all("Classifier") or [] if c.startswith("License")]
    rows.append({
        "name": md.get("Name") or "",
        "version": md.get("Version") or "",
        "license": md.get("License-Expression") or md.get("License") or "",
        "classifiers": classifiers,
        "url": md.get("Home-page") or "",
        "texts": license_files(dist),
    })
rows.sort(key=lambda r: r["name"].lower())
json.dump({"python": sys.version, "dists": rows}, sys.stdout)
"""


def run(cmd: list[str], **kw) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip()[-800:]
        raise SystemExit(f"gen-notices: `{' '.join(cmd[:3])}…` failed: {tail}")
    return proc.stdout


def short_license(row: dict) -> str:
    """One line for the summary table."""
    lic = (row.get("license") or "").strip()
    if lic and "\n" not in lic and len(lic) <= 60:
        return lic
    for c in row.get("classifiers") or []:
        # "License :: OSI Approved :: MIT License" -> "MIT License"
        return c.split("::")[-1].strip()
    if lic:
        return lic.splitlines()[0][:60] + "…"
    return "see full text below"


def python_runtime_section(runtime_dir: Path, release_licenses: Path) -> tuple[str, list[str]]:
    """CPython's own license plus the C libraries the build links.

    `install_only` archives are stripped of `python/licenses/`, so the texts
    for OpenSSL, SQLite, libffi, liblzma, ncurses, Tcl/Tk … are committed
    under `scripts/runtime-licenses/<release>/` instead. Their ABSENCE is a
    reported gap, never a silent omission: those libraries ship inside the app.
    """
    out = ["## The bundled CPython runtime\n"]
    gaps: list[str] = []
    python_root = runtime_dir / "python"

    # CPython's own license, as it sits in the shipped tree.
    own = sorted(python_root.glob("lib/python*/LICENSE.txt"))
    if own:
        for f in own:
            out.append(f"### CPython — {f.relative_to(python_root)}\n")
            out.append("```\n" + f.read_text(errors="replace").strip() + "\n```\n")
    else:
        gaps.append("CPython's own LICENSE.txt is not in the shipped runtime")

    # The linked C libraries, from the committed per-release set.
    texts = sorted(release_licenses.glob("*.txt")) if release_licenses.is_dir() else []
    if texts:
        out.append(
            f"### Libraries linked into this CPython build ({len(texts)})\n\n"
            f"From python-build-standalone release `{release_licenses.name}`; see "
            "`scripts/runtime-licenses/README.md` for provenance.\n"
        )
        for f in texts:
            out.append(f"<details><summary>{f.stem.replace('LICENSE.', '')}</summary>\n")
            out.append("```\n" + f.read_text(errors="replace").strip() + "\n```\n")
            out.append("</details>\n")
    else:
        gaps.append(
            f"no committed license set at {release_licenses} for the pinned "
            "python-build-standalone release (OpenSSL, SQLite, libffi, liblzma, "
            "zlib, ncurses, Tcl/Tk and friends all ship inside the app)"
        )
        out.append(
            "> **INCOMPLETE — DO NOT DISTRIBUTE.** The license texts for the C "
            "libraries linked into this CPython build are missing. See "
            "`scripts/runtime-licenses/README.md` for how to add them.\n"
        )
    return "\n".join(out), gaps


def python_wheels_section(inventory: dict) -> tuple[str, list[str]]:
    dists = inventory["dists"]
    lines = [f"## Python distributions in the runtime ({len(dists)})\n"]
    lines.append("| Distribution | Version | License |")
    lines.append("|---|---|---|")
    missing = []
    for row in dists:
        lines.append(f"| {row['name']} | {row['version']} | {short_license(row)} |")
        if not row["texts"] and not row["license"] and not row["classifiers"]:
            missing.append(row["name"])
    lines.append("")
    lines.append("### Full license texts\n")
    for row in dists:
        lines.append(f"#### {row['name']} {row['version']}")
        if row["url"]:
            lines.append(f"<{row['url']}>\n")
        if COPYLEFT_NOTES.get(row["name"].lower()) == "pygame":
            lines.append(PYGAME_NOTICE)
        if row["texts"]:
            for name, text in row["texts"].items():
                lines.append(f"<details><summary>{name}</summary>\n")
                lines.append("```\n" + text.strip() + "\n```\n")
                lines.append("</details>\n")
        elif row["license"]:
            lines.append("```\n" + row["license"].strip() + "\n```\n")
        else:
            lines.append(
                f"> No license file shipped in the wheel. Declared: "
                f"{short_license(row)}.\n"
            )
    return "\n".join(lines), missing


def npm_section(repo_root: Path) -> tuple[str, list[str]]:
    """Every npm PRODUCTION dependency compiled into `dist/`.

    Read from `package-lock.json` rather than shelled out to `npm ls`: the
    lockfile is the exact resolved tree, is already committed, needs no
    network, and its `dev` flag is npm's own answer to what a production
    install carries. Full text comes from the package's own directory under
    `node_modules`, which `npm ci` has already materialised by the time
    notices are generated in CI.

    Same fail-on-gap rule as the other three sections: a package with neither
    a declared license nor a license file is a returned gap, not a shrug.
    """
    lock_path = repo_root / "package-lock.json"
    if not lock_path.is_file():
        return (
            "## npm production dependencies\n\n"
            "> **INCOMPLETE — DO NOT DISTRIBUTE.** No `package-lock.json`.\n",
            ["package-lock.json is missing — the frontend inventory cannot be built"],
        )
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    node_modules = repo_root / "node_modules"

    rows = []
    for key, entry in sorted(lock.get("packages", {}).items()):
        # "" is the root project itself; dev-only packages never reach `dist/`.
        if not key or entry.get("dev") or entry.get("devOptional"):
            continue
        name = entry.get("name") or key.split("node_modules/", 1)[-1]
        pkg_dir = repo_root / key
        lic = entry.get("license") or ""
        texts: dict[str, str] = {}
        if pkg_dir.is_dir():
            for pattern in ("LICENSE*", "LICENCE*", "COPYING*", "NOTICE*"):
                for f in sorted(pkg_dir.glob(pattern)):
                    if f.is_file() and f.stat().st_size < 200_000:
                        texts[f.name] = f.read_text(encoding="utf-8", errors="replace")
            if not lic:
                try:
                    lic = json.loads(
                        (pkg_dir / "package.json").read_text(encoding="utf-8")
                    ).get("license", "")
                except (OSError, ValueError):
                    pass
        if isinstance(lic, dict):  # the legacy {"type": …, "url": …} form
            lic = lic.get("type", "")
        rows.append(
            {
                "name": name,
                "version": entry.get("version", ""),
                "license": lic,
                "texts": texts,
            }
        )

    lines = [f"## npm production dependencies ({len(rows)})\n"]
    lines.append(
        "Compiled into the frontend bundle Tauri ships as `frontendDist`. "
        "Dev-only packages (the build toolchain) are excluded — they are not "
        "in the shipped application.\n"
    )
    lines.append("| Package | Version | License |")
    lines.append("|---|---|---|")
    missing = []
    for row in rows:
        lines.append(
            f"| {row['name']} | {row['version']} | {row['license'] or 'UNDECLARED'} |"
        )
        if not row["license"] and not row["texts"]:
            missing.append(row["name"])
    lines.append("")
    if not node_modules.is_dir():
        lines.append(
            "> **INCOMPLETE — DO NOT DISTRIBUTE.** `node_modules/` is not "
            "present, so no full license texts could be read. Run `npm ci` "
            "before generating notices.\n"
        )
        missing.append("node_modules/ is absent — no full texts were read")
    lines.append("### Full license texts\n")
    for row in rows:
        if not row["texts"] and not row["license"]:
            continue
        lines.append(f"#### {row['name']} {row['version']}")
        if row["texts"]:
            for name, text in row["texts"].items():
                lines.append(f"<details><summary>{name}</summary>\n")
                lines.append("```\n" + text.strip() + "\n```\n")
                lines.append("</details>\n")
        else:
            lines.append(
                f"> No license file in the package. Declared: {row['license']}.\n"
            )
    return "\n".join(lines), missing


def crate_license_text(pkg: dict) -> dict[str, str]:
    """LICENSE files out of the crate's unpacked registry source, when present."""
    manifest = pkg.get("manifest_path")
    if not manifest:
        return {}
    root = Path(manifest).parent
    texts: dict[str, str] = {}
    for pattern in ("LICENSE*", "COPYING*", "NOTICE*"):
        for f in sorted(root.glob(pattern)):
            if f.is_file() and f.stat().st_size < 200_000:
                texts[f.name] = f.read_text(errors="replace")
    return texts


def rust_section(src_tauri: Path, targets: list[str]) -> tuple[str, list[str]]:
    """The crates linked into the binary, UNIONED over every target built.

    `--filter-platform` answers for ONE triple. The macOS release builds
    `universal-apple-darwin` — an .app carrying both an aarch64 and an x86_64
    slice — so filtering by the runner's host alone would omit any crate
    pulled in solely for the other slice from notices for a binary that
    contains it. Callers pass every triple in the build; the crate sets are
    unioned before the table is written.
    """
    by_id: dict[str, dict] = {}
    for target in targets:
        meta = json.loads(
            run(
                [
                    "cargo",
                    "metadata",
                    "--format-version",
                    "1",
                    "--filter-platform",
                    target,
                    "--manifest-path",
                    str(src_tauri / "Cargo.toml"),
                ]
            )
        )
        workspace = set(meta.get("workspace_members") or [])
        for p in meta["packages"]:
            if p["id"] not in workspace:
                by_id.setdefault(p["id"], p)
    pkgs = sorted(by_id.values(), key=lambda p: p["name"].lower())
    lines = [f"## Rust crates linked into the application ({len(pkgs)})\n"]
    lines.append(f"Resolved for: {', '.join(targets)}.\n")
    lines.append("| Crate | Version | License |")
    lines.append("|---|---|---|")
    missing = []
    texts_by_crate = {}
    for p in pkgs:
        lic = p.get("license") or (
            f"file: {p['license_file']}" if p.get("license_file") else ""
        )
        lines.append(f"| {p['name']} | {p['version']} | {lic or 'UNDECLARED'} |")
        if not lic:
            missing.append(p["name"])
        t = crate_license_text(p)
        if t:
            texts_by_crate[f"{p['name']} {p['version']}"] = t
    lines.append("")
    lines.append(
        "SPDX expressions above are each crate's own declaration. Full texts "
        "follow for every crate whose source carries one.\n"
    )
    lines.append("### Full license texts\n")
    for crate, texts in texts_by_crate.items():
        lines.append(f"#### {crate}")
        for name, text in texts.items():
            lines.append(f"<details><summary>{name}</summary>\n")
            lines.append("```\n" + text.strip() + "\n```\n")
            lines.append("</details>\n")
    return "\n".join(lines), missing


def host_target() -> str:
    out = run(["rustc", "-vV"])
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit("gen-notices: could not read rustc's host triple")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runtime", required=True, type=Path, help="resources/runtime/<triple>")
    ap.add_argument("--src-tauri", required=True, type=Path)
    ap.add_argument(
        "--repo-root",
        required=True,
        type=Path,
        help="the cradle checkout — package-lock.json and node_modules live here",
    )
    ap.add_argument(
        "--rust-target",
        action="append",
        default=[],
        metavar="TRIPLE",
        help=(
            "a target triple the build produces; repeatable. The crate lists "
            "are unioned (a universal macOS .app carries two slices). "
            "Defaults to rustc's host triple."
        ),
    )
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument(
        "--release-licenses",
        required=True,
        type=Path,
        help="scripts/runtime-licenses/<pinned release tag>",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be written (counts + gaps), write nothing.",
    )
    args = ap.parse_args()

    python = args.runtime / "python" / ("python.exe" if sys.platform == "win32" else "bin/python3")
    if not python.is_file():
        raise SystemExit(
            f"gen-notices: no interpreter at {python} — run `npm run fetch-runtime` first. "
            "Notices are generated from what SHIPS, so there is nothing to report without it."
        )

    inventory = json.loads(run([str(python), "-E", "-s", "-c", INVENTORY_SNIPPET]))
    wheels_md, wheel_gaps = python_wheels_section(inventory)
    rust_targets = args.rust_target or [host_target()]
    rust_md, crate_gaps = rust_section(args.src_tauri, rust_targets)
    runtime_md, runtime_gaps = python_runtime_section(args.runtime, args.release_licenses)
    npm_md, npm_gaps = npm_section(args.repo_root)

    doc = (
        HEADER
        + f"Runtime: `{args.runtime.name}`, CPython {inventory['python'].split()[0]}.\n\n"
        + runtime_md
        + "\n"
        + wheels_md
        + "\n"
        + rust_md
        + "\n"
        + npm_md
    )

    print(f"gen-notices: {len(inventory['dists'])} python distributions")
    print(f"gen-notices: {rust_md.splitlines()[0].split('(')[-1].rstrip(')')} rust crates")
    npm_count = npm_md.splitlines()[0].split("(")[-1].rstrip(")")
    print(f"gen-notices: {npm_count} npm production packages")
    for gap in runtime_gaps:
        print(f"gen-notices: RUNTIME NOTICE GAP: {gap}")
    if wheel_gaps:
        print(f"gen-notices: WHEELS WITH NO LICENSE METADATA: {', '.join(wheel_gaps)}")
    if crate_gaps:
        print(f"gen-notices: CRATES WITH NO DECLARED LICENSE: {', '.join(crate_gaps)}")
    if npm_gaps:
        print(f"gen-notices: NPM PACKAGES WITH NO LICENSE: {', '.join(npm_gaps)}")
    pygame_rows = [d["name"] for d in inventory["dists"] if d["name"].lower() in COPYLEFT_NOTES]
    print(
        "gen-notices: pygame replacement notice: "
        + (f"included for {', '.join(pygame_rows)}" if pygame_rows else "NOT NEEDED (no pygame installed)")
    )
    if args.dry_run:
        print(f"gen-notices: dry run — {len(doc)} characters would be written to {args.out}")
        return 1 if (wheel_gaps or crate_gaps or runtime_gaps or npm_gaps) else 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(doc, encoding="utf-8")
    print(f"gen-notices: wrote {args.out} ({len(doc)} characters)")
    # A gap is a build failure, not a warning: shipping a notices file that
    # omits something the app carries is worse than shipping none.
    return 1 if (wheel_gaps or crate_gaps or runtime_gaps or npm_gaps) else 0


if __name__ == "__main__":
    raise SystemExit(main())
