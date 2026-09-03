import type { PlanItem } from "../../lib/agentState";
import { fmtCents, fmtDuration } from "../../lib/agentState";
import { undoPlan } from "../../lib/agentActions";
import { showMe } from "../../lib/agentShowMe";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";

/** The change feed (README §8): a finished batch as one feed — one row per
 *  artifact, typed prefix, what changed, a deep-link that opens, selects and
 *  pulses the target. Footer: ▶ Play · Undo the batch · Open in History. */
export function ChangeFeed({ plan, conversationId }: { plan: PlanItem; conversationId: string }) {
  const worldPath = useStore((s) => s.worldPath);
  const elapsed = (plan.endedAt ?? plan.ts) - (plan.startedAt ?? plan.ts);
  const firstLevel = plan.feed.find((r) => r.typeId === "levels");
  const kind = (typeId: string) => (typeId.endsWith("s") ? typeId.slice(0, -1) : typeId);
  return (
    <div className={`ag-card${plan.undone ? " undone" : ""}`} data-testid="change-feed">
      <div className="ag-card-head">
        <span style={{ color: "var(--ok)" }}>✓</span>
        <span className="title">Plan complete</span>
        <span className="ag-card-mono" style={{ marginTop: 0 }}>
          {fmtDuration(elapsed)}
          {plan.costCents > 0 ? ` · ${fmtCents(plan.costCents)}` : ""}
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        {plan.feed.length === 0 && <div className="ag-card-mono">No artifacts were written.</div>}
        {plan.feed.map((r) => (
          <div key={`${r.typeId}:${r.id}`} className="ag-feed-row" data-testid="feed-row">
            <span className="kind">{kind(r.typeId)}</span>
            <span>
              {r.label} · {r.what}
            </span>
            <button
              className="btn-link"
              onClick={() => showMe(r.showMe)}
              aria-label={`Show ${r.label}`}
            >
              ↗
            </button>
          </div>
        ))}
      </div>
      <div className="ag-feed-foot">
        {firstLevel && (
          <button className="ag-btn" onClick={() => void api.playLevel(worldPath, firstLevel.id)}>
            ▶ Play {firstLevel.label}
          </button>
        )}
        <button
          className="ag-btn"
          disabled={plan.undone}
          onClick={() => void undoPlan(conversationId, plan.planId)}
        >
          {plan.undone ? "Batch undone" : "Undo the batch"}
        </button>
        {plan.feed[0] && (
          <button
            className="ag-btn"
            onClick={() => showMe({ ...plan.feed[0].showMe, tab: "history" })}
          >
            Open in History
          </button>
        )}
      </div>
      {plan.actors.length > 0 && (
        <div className="ag-foot" style={{ marginTop: 6 }}>
          Journaled as {plan.actors.join(" · ")}
        </div>
      )}
    </div>
  );
}
