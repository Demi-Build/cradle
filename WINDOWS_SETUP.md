# Running cradle on Windows (dev mode)

cradle is a Tauri desktop app that shells out to **canon** (a Python generator)
for all reads, writes, and generation. So you clone **two** repos and run cradle
in dev mode. No API keys are needed to try it — the "New project" and level
generation use a free offline (`fake`) backend. Keys are only needed later for
real art / LLM-authored content.

Everything below is **PowerShell** on Windows 10/11.

---

## 1. Install the prerequisites (once)

- **Git** — https://git-scm.com/download/win
- **Python 3.11+** — https://www.python.org/downloads/ (check "Add python.exe to PATH")
- **Node.js 20+** — https://nodejs.org/ (LTS)
- **Rust** (via rustup) — https://rustup.rs/ (choose the default **MSVC** toolchain)
- **Visual Studio C++ Build Tools** — https://visualstudio.microsoft.com/visual-cpp-build-tools/
  → in the installer pick **"Desktop development with C++"** (Tauri needs the MSVC linker)
- **WebView2** — already on most Win10/11; if not: https://developer.microsoft.com/microsoft-edge/webview2/
- *(optional)* **Godot 4** — https://godotengine.org/download/windows/ — only needed for the "▶ Play game" (whole-game) button; per-level "▶ Play" uses Python/pygame instead.

Tauri's own checklist (authoritative): https://tauri.app/start/prerequisites/

---

## 2. Clone both repos

```powershell
cd C:\dev                       # or wherever you keep code
git clone <canon-ai repo url>   # the Python generator
git clone <cradle repo url>     # this app
```

Keep both folders side by side (e.g. `C:\dev\canon-ai` and `C:\dev\cradle`).

---

## 3. Set up canon (Python) — the editable install matters

```powershell
cd C:\dev\canon-ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# EDITABLE install with the platformer + play + cli extras.
# Editable (-e) is REQUIRED: cradle's generators load code from examples\, which
# only exists in a source checkout.
pip install -e ".[cli,platformer,play]"
# sanity check:
canon --help
```

*(Only if you later want the PAID path — real art / LLM content — also run
`pip install -e ".[anthropic,images]"` and set your keys in a `.env` file. Not
needed to try the app.)*

---

## 4. Set up cradle (Node)

```powershell
cd C:\dev\cradle
npm install
```

---

## 5. Point cradle at canon and run

In the **same PowerShell window**, set the env vars, then start the app. Adjust
the paths to where you cloned canon-ai.

```powershell
$env:CANON_BIN  = "C:\dev\canon-ai\.venv\Scripts\canon.exe"
$env:CANON_REPO = "C:\dev\canon-ai"
# optional — only for the whole-game "▶ Play game" button:
$env:GODOT_BIN  = "C:\path\to\Godot_v4.x.x-stable_win64.exe"

npm run tauri dev
```

The **first** run compiles the Rust side — it can take several minutes. After
that it's fast.

---

## 6. First things to try

1. On the start screen, click **＋ New platformer project** → give it a name →
   **Choose location & create**. This generates a small, playable starter world
   (placeholder art, $0).
2. Open a level → **▶ Play** to play it (Blocks view looks cleanest before you
   add art). Esc quits, R respawns.
3. **＋** next to LEVELS → **generate** tab → write a brief → **generate draft**
   to make a whole new level. Or **🎲 Enemies / 🎲 Items** on any level to have
   canon populate your own hand-painted terrain.

Everything above runs on the free `fake` backend — no keys, no cost.

---

## Troubleshooting

- **"set CANON_BIN…" or canon not found** — the env vars in step 5 must be set in
  the *same* terminal you run `npm run tauri dev` from. Double-check the paths.
- **▶ Play does nothing** — pygame must be installed in canon's venv (the
  `play` extra in step 3) and `CANON_REPO` must point at the canon-ai folder.
- **▶ Play game fails** — set `GODOT_BIN` to your Godot 4 exe (or skip it; the
  per-level ▶ Play doesn't need Godot).
- **Rust/linker errors on first `tauri dev`** — install the "Desktop development
  with C++" workload (step 1) and reopen the terminal so the toolchain is on PATH.
- **Generation errors mentioning `examples\…`** — the canon install wasn't
  editable; redo step 3 with `pip install -e`.
