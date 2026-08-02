import { useEffect, useState } from "react";
import { api, type CostEstimate } from "../../lib/invoke";
import { fmtRange } from "../../lib/cost";
import { enqueueJob } from "../../lib/jobs";
import { PromptOverride } from "../PromptOverride";

/** Regenerate an EXISTING level's terrain from a brief — turns a flat draft
 *  into a designed level, or redesigns an existing one. Replaces the terrain
 *  and clears placements (re-run 🎲 Enemies/Items after). */
export function RegenerateLayoutModal({
  worldPath,
  levelId,
  currentBrief,
  onClose,
  onDone,
}: {
  worldPath: string;
  levelId: string;
  currentBrief?: string;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const [brief, setBrief] = useState(currentBrief ?? "");
  const [difficulty, setDifficulty] = useState(2);
  const [axis, setAxis] = useState<"" | "horizontal" | "vertical">("");
  const [backend, setBackend] = useState<"fake" | "anthropic">("fake");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [est, setEst] = useState<CostEstimate | null>(null);
  const [systemOverride, setSystemOverride] = useState<string | null>(null);

  // Live estimate — the layout op's price depends only on this level + backend.
  useEffect(() => {
    let live = true;
    setEst(null);
    api
      .estimateLevel(worldPath, levelId, "layout", backend)
      .then((r) => live && setEst(r.estimate))
      .catch(() => live && setEst(null));
    return () => {
      live = false;
    };
  }, [worldPath, levelId, backend]);

  const run = async () => {
    const paid = backend === "anthropic";
    if (
      !window.confirm(
        `${paid ? `PAID (anthropic — est. ${fmtRange(est?.total_usd)})` : "FAKE — $0, no API calls"}: ` +
          `regenerate ${levelId}'s layout from your brief.\n\n` +
          "This REPLACES the terrain and CLEARS placements (re-run 🎲 Enemies/Items after). Proceed?",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    // Fire-and-forget background job — the UI stays responsive; the tray tracks
    // it and the level reloads on completion.
    await enqueueJob(
      {
        op: "layout",
        label: `Regenerate ${levelId}`,
        target: levelId,
        targetType: "levels",
        scope: "level",
        backends: { llm: backend },
        estimate: est?.total_usd,
      },
      (jobId) =>
        api.regenerateLayout(worldPath, levelId, {
          brief,
          difficulty,
          axis: axis || null,
          llmBackend: backend,
          systemOverride,
          jobId,
        }),
    );
    onDone("layout regenerate queued — watch ⚙ Jobs (re-run 🎲 after)");
    onClose();
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
    width: 400,
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
    margin: "8px 0",
  };

  return (
    <div style={overlay} onClick={() => !busy && onClose()}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 4px" }}>Regenerate layout — {levelId}</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
          The LLM rebuilds this level's terrain from your brief (keeps its size). Replaces the
          layout and clears placements — re-run 🎲 Enemies / 🎲 Items after.
        </p>
        <textarea
          placeholder="brief — what this level should be like (e.g. 'a tense climb with narrow ledges and lava gaps')"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          disabled={busy}
          style={{ width: "100%", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
        />
        <label style={row}>
          <span>Difficulty</span>
          <select value={difficulty} onChange={(e) => setDifficulty(+e.target.value)} disabled={busy}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label style={row}>
          <span>Axis</span>
          <select value={axis} onChange={(e) => setAxis(e.target.value as typeof axis)} disabled={busy}>
            <option value="">auto</option>
            <option value="horizontal">horizontal</option>
            <option value="vertical">vertical</option>
          </select>
        </label>
        <label style={row}>
          <span>Backend</span>
          <select value={backend} onChange={(e) => setBackend(e.target.value as typeof backend)} disabled={busy}>
            <option value="fake">fake ($0)</option>
            <option value="anthropic">Claude (paid)</option>
          </select>
        </label>
        <PromptOverride
          worldPath={worldPath}
          kind="layout"
          ctx={{ levelId, brief }}
          value={systemOverride}
          onChange={setSystemOverride}
          disabled={busy}
        />
        <div style={{ ...row, opacity: 0.85 }}>
          <span>Estimated cost</span>
          <strong>{est ? fmtRange(est.total_usd) : "…"}</strong>
        </div>
        {err && (
          <div style={{ color: "#e0453a", fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{err}</div>
        )}
        {busy && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>Regenerating…</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} disabled={busy} style={{ cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => void run()} disabled={busy} style={{ cursor: "pointer", fontWeight: 600 }}>
            {busy ? "Regenerating…" : "🪄 Regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}
