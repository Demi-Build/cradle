import { useEffect, useMemo, useState } from "react";
import { api, type CostEstimate, type ValidationReport } from "../../lib/invoke";
import { fmtRange } from "../../lib/cost";
import { enqueueJob } from "../../lib/jobs";
import { PromptOverride } from "../PromptOverride";
import type { LevelBundle } from "./drawLevel";

/** Context-aware IMPROVE — the v2 of 🪄 Regenerate. Unlike regenerate (which is
 *  blind and wipes placements), the LLM SEES the current level (its terrain
 *  serialized to text) + your instruction and re-authors it IN PLACE, keeping
 *  the size/axis. Placements are KEPT by default (Validate surfaces any that no
 *  longer fit) or re-adapted to the new terrain on request. */
export function ImproveLayoutModal({
  worldPath,
  levelId,
  bundle,
  valReport,
  onClose,
  onDone,
}: {
  worldPath: string;
  levelId: string;
  bundle: LevelBundle;
  valReport: ValidationReport | null;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [fixProblems, setFixProblems] = useState(false);
  const [reroll, setReroll] = useState(false);
  const [backend, setBackend] = useState<"fake" | "anthropic">("fake");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [est, setEst] = useState<CostEstimate | null>(null);
  const [systemOverride, setSystemOverride] = useState<string | null>(null);

  // Only TERRAIN problems are fed to the improve (it re-authors terrain); count
  // them so the checkbox honestly says what "also fix problems" will address.
  const problemCount = useMemo(
    () =>
      (valReport?.checks ?? [])
        .filter((c) => c.name === "terrain")
        .reduce((n, c) => n + c.problems.length, 0),
    [valReport],
  );
  useEffect(() => {
    if (problemCount === 0) setFixProblems(false);
  }, [problemCount]);

  // Live estimate — improve is a whole-level re-author, priced like a layout op.
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
    if (!instruction.trim()) {
      setErr("Enter an instruction (what to change).");
      return;
    }
    const paid = backend === "anthropic";
    if (
      !window.confirm(
        `${paid ? `PAID (anthropic — est. ${fmtRange(est?.total_usd)})` : "FAKE — $0, no API calls"}: ` +
          `improve ${levelId} — the LLM sees the current level and applies your change.\n\n` +
          (reroll
            ? "Placements will be RE-ROLLED onto the improved terrain."
            : "Placements are KEPT (Validate flags any that no longer fit).") +
          (fixProblems ? `\nAlso fixing ${problemCount} validation problem(s).` : "") +
          "\n\nProceed?",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    // Fire-and-forget: the improve runs as a background job so the UI never
    // freezes. The tray tracks it; on completion the open level reloads and a
    // note reports whether the terrain actually changed.
    await enqueueJob(
      {
        op: "improve",
        label: `Improve ${levelId}`,
        target: levelId,
        targetType: "levels",
        scope: "level",
        backends: { llm: backend },
        estimate: est?.total_usd,
      },
      (jobId) =>
        api.improveLevel(worldPath, levelId, {
          instruction,
          fixProblems,
          rerollPlacements: reroll,
          llmBackend: backend,
          systemOverride,
          jobId,
        }),
    );
    onDone("improve queued — watch ⚙ Jobs");
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
    width: 420,
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
        <h3 style={{ margin: "0 0 4px" }}>
          ✨ Improve level — {bundle.display_name ?? bundle.level_id}
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
          The LLM sees the current level and applies your change, keeping its size and everything
          else the same. Refines rather than starting over (that's 🪄 Layout).
        </p>
        <textarea
          placeholder="what to change (e.g. 'add a bridge over the big gap', 'make the middle section harder', 'add a shortcut near the exit')"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          disabled={busy}
          autoFocus
          style={{ width: "100%", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
        />
        <label
          style={{
            ...row,
            justifyContent: "flex-start",
            opacity: problemCount === 0 ? 0.45 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={fixProblems}
            disabled={busy || problemCount === 0}
            onChange={(e) => setFixProblems(e.target.checked)}
          />
          <span>
            Also fix current validation problems
            {problemCount > 0 ? ` (${problemCount})` : " (none)"}
          </span>
        </label>
        <div style={{ ...row, justifyContent: "flex-start", gap: 16 }}>
          <span style={{ opacity: 0.85 }}>Placements</span>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input
              type="radio"
              name="improve-placements"
              checked={!reroll}
              disabled={busy}
              onChange={() => setReroll(false)}
            />
            keep
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input
              type="radio"
              name="improve-placements"
              checked={reroll}
              disabled={busy}
              onChange={() => setReroll(true)}
            />
            re-roll
          </label>
        </div>
        <label style={row}>
          <span>Backend</span>
          <select value={backend} onChange={(e) => setBackend(e.target.value as typeof backend)} disabled={busy}>
            <option value="fake">fake ($0)</option>
            <option value="anthropic">Claude (paid)</option>
          </select>
        </label>
        <PromptOverride
          worldPath={worldPath}
          kind="improve"
          ctx={{ levelId, instruction }}
          value={systemOverride}
          onChange={setSystemOverride}
          disabled={busy}
        />
        <div style={{ ...row, opacity: 0.85 }}>
          <span>Estimated cost</span>
          <strong>{est ? fmtRange(est.total_usd) : "…"}</strong>
        </div>
        {err && (
          <div style={{ color: "var(--err)", fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{err}</div>
        )}
        {busy && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>Improving…</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} disabled={busy} style={{ cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => void run()} disabled={busy} style={{ cursor: "pointer", fontWeight: 600 }}>
            {busy ? "Improving…" : "✨ Improve"}
          </button>
        </div>
      </div>
    </div>
  );
}
