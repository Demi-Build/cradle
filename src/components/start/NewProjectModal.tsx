import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../../store";
import { api, type CostEstimate } from "../../lib/invoke";
import { fmtRange, fmtUsd, recordSpend } from "../../lib/cost";

/** "New platformer project": collect a name + a few counts, pick a parent
 *  folder, then scaffold a populated STARTER via `canon world new` (the fake
 *  pipeline — $0, no API keys) and open it. */
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const loadWorldByPath = useStore((s) => s.loadWorldByPath);
  const [name, setName] = useState("My Platformer");
  const [stages, setStages] = useState(1);
  const [levels, setLevels] = useState(2);
  const [enemies, setEnemies] = useState(4);
  const [items, setItems] = useState(4);
  // Each generator is its own backend — leave all at the $0 defaults for a
  // free preview, or turn any up for a real (paid) run.
  const [llm, setLlm] = useState("fake");
  const [image, setImage] = useState("fake");
  const [music, setMusic] = useState("none");
  const [sfx, setSfx] = useState("none");
  const [vlm, setVlm] = useState("none");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [est, setEst] = useState<CostEstimate | null>(null);

  const anyPaid =
    llm === "anthropic" ||
    ["fal", "retro", "pixellab", "local"].includes(image) ||
    music === "lyria" ||
    sfx === "elevenlabs" ||
    vlm === "anthropic";

  // Live estimate — recompute (debounced) as counts / backends change. The
  // number reflects the CHOSEN backends: $0 while everything is fake/none, real
  // dollars as you turn generators on.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .estimateWorld({
          stages,
          levels,
          enemies,
          items,
          llmBackend: llm,
          imageBackend: image,
          musicBackend: music,
          sfxBackend: sfx,
          vlmBackend: vlm,
        })
        .then((r) => live && setEst(r.estimate))
        .catch(() => live && setEst(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [stages, levels, enemies, items, llm, image, music, sfx, vlm]);

  const create = async () => {
    setErr(null);
    let parent: string;
    try {
      const sel = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose where to create the project",
      });
      if (typeof sel !== "string") return; // cancelled the folder picker
      parent = sel;
    } catch (e) {
      setErr(String(e));
      return;
    }
    // Paid runs are the real bill — confirm the projected cost before spending.
    if (
      anyPaid &&
      !window.confirm(
        `This run uses PAID backends.\n\nProjected cost: ${fmtRange(est?.total_usd)} ` +
          `(${stages} stage(s) · ${levels} level(s) each · ${enemies} enemies · ${items} items).\n\n` +
          "Actual cost depends on real token/asset usage. Proceed?",
      )
    )
      return;
    setBusy(
      anyPaid
        ? "Generating (paid backends selected — this can take a while)…"
        : "Generating your starter world… (a few seconds)",
    );
    try {
      const r = await api.newProject(parent, name.trim() || "My Platformer", {
        stages,
        levels,
        enemies,
        items,
        llmBackend: llm,
        imageBackend: image,
        musicBackend: music,
        sfxBackend: sfx,
        vlmBackend: vlm,
      });
      // Record the run's ACTUAL cost from the generated tree's stats (real LLM +
      // audio/pixellab/retro image spend). Best-effort — a missing stat records 0.
      let actual = 0;
      try {
        const mf = (await api.readWorldJson(r.pack_dir, "manifest.json")) as {
          generation_stats?: { total_cost_usd?: number };
        };
        actual = mf.generation_stats?.total_cost_usd ?? 0;
      } catch {
        /* stats optional */
      }
      await recordSpend(r.pack_dir, {
        op: "world",
        scope: "world",
        backends: { llm, image, music, sfx, vlm },
        estimate: est?.total_usd,
        actual_usd: actual,
      });
      await loadWorldByPath(r.pack_dir);
      onClose();
    } catch (e) {
      setErr(String(e).slice(0, 400));
      setBusy(null);
    }
  };

  const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(8,6,12,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  };
  const card: React.CSSProperties = {
    width: 380,
    maxWidth: "90vw",
    background: "var(--bg-raised)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
    color: "var(--fg)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
  };
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
    fontSize: 13,
    margin: "7px 0",
  };
  const num = (v: number, set: (n: number) => void, min = 0) => (
    <input
      type="number"
      min={min}
      value={v}
      onChange={(e) => set(+e.target.value)}
      disabled={!!busy}
      style={{ width: 60 }}
    />
  );
  const sel = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: [string, string][],
  ) => (
    <label style={row}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        disabled={!!busy}
        style={{ fontSize: 12 }}
      >
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div style={overlay} onClick={() => !busy && onClose()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 4px" }}>New platformer project</h3>
        <p style={{ margin: "0 0 14px", fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
          Generates a small, playable starter world with placeholder art — $0, no API keys.
          You'll pick where to save it next, then edit and generate levels from there.
        </p>
        <label style={row}>
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!busy}
            style={{ flex: 1, marginLeft: 12 }}
          />
        </label>
        <label style={row}><span>Stages</span> {num(stages, setStages, 1)}</label>
        <label style={row}><span>Levels per stage</span> {num(levels, setLevels, 1)}</label>
        <label style={row}><span>Enemies</span> {num(enemies, setEnemies, 1)}</label>
        <label style={row}><span>Items</span> {num(items, setItems, 0)}</label>

        <div style={{ margin: "12px 0 2px", fontSize: 12, opacity: 0.7 }}>
          Generators — leave at the defaults for a free preview, or turn any up for a real (paid) run:
        </div>
        {sel("Design (text)", llm, setLlm, [
          ["fake", "$0 canned"],
          ["anthropic", "Claude (paid)"],
        ])}
        {sel("Art (sprites)", image, setImage, [
          ["fake", "placeholder ($0)"],
          ["none", "none"],
          ["fal", "fal (paid)"],
          ["retro", "Retro Diffusion (paid)"],
          ["pixellab", "PixelLab (paid)"],
          ["local", "local"],
        ])}
        {sel("Music", music, setMusic, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["lyria", "Lyria (paid)"],
        ])}
        {sel("SFX", sfx, setSfx, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["elevenlabs", "ElevenLabs (paid)"],
        ])}
        {sel("Animation", vlm, setVlm, [
          ["none", "none"],
          ["fake", "placeholder ($0)"],
          ["anthropic", "Claude (paid)"],
        ])}
        {anyPaid && (
          <div style={{ fontSize: 11, marginTop: 6, color: "#e0a15a" }}>
            Paid backends selected — needs API keys via <code>CANON_ENV_FILE</code> when you launch cradle.
          </div>
        )}
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ opacity: 0.8 }}>Estimated cost</span>
            <strong style={{ fontSize: 15 }}>{est ? fmtRange(est.total_usd) : "…"}</strong>
          </div>
          {est && anyPaid && (
            <div style={{ marginTop: 4, opacity: 0.65, lineHeight: 1.5 }}>
              LLM {fmtUsd(est.llm.usd.best)} · images {est.assets.images.count}×→
              {fmtUsd(est.assets.images.usd)} · music {fmtUsd(est.assets.music.usd)} · sfx{" "}
              {fmtUsd(est.assets.sfx.usd)} · anim {fmtUsd((est.assets.vlm?.usd?.best ?? 0) as number)}
            </div>
          )}
          {est && !anyPaid && (
            <div style={{ marginTop: 4, opacity: 0.6 }}>
              $0 — all generators are free ({est.assets.images.count} placeholder images).
            </div>
          )}
        </div>
        {err && (
          <div style={{ color: "#e0453a", fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{err}</div>
        )}
        {busy && <div style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>{busy}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} disabled={!!busy} style={{ cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={!!busy}
            style={{ cursor: "pointer", fontWeight: 600 }}
          >
            {busy ? "Creating…" : "Choose location & create"}
          </button>
        </div>
      </div>
    </div>
  );
}
