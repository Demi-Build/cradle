import { useEffect, useRef, useState } from "react";
import { openFromHistory, refreshHistory } from "../../lib/agentActions";
import { useStore } from "../../store";
import { fmtCents } from "../../lib/agentState";

/** ⏱ per-project history (README §2): past conversations with their date
 *  and cost, "Show all N" at the bottom.
 *
 *  DEVIATION, declared: `GET /conversations` answers `{id, created, turns,
 *  title}` — the per-conversation COST lane is row A6's ledger, not this
 *  row's, and no endpoint carries it yet. A row that is also an open tab
 *  shows the live cost this panel has counted; every other row shows its turn
 *  count until A6 lands, when `costCents` replaces `turns` here. */
export function SessionHistoryMenu({ onClose }: { onClose: () => void }) {
  const history = useStore((s) => s.agent.history);
  const open = useStore((s) => s.agent.conversations);
  const [all, setAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void refreshHistory();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const rows = [...history].reverse();
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <div className="ag-menu" ref={ref} data-testid="history-menu">
      <div className="ag-menu-title">history · this project</div>
      {rows.length === 0 && <div className="ag-menu-foot">No conversations yet.</div>}
      {shown.map((h) => (
        <button
          key={h.id}
          className="ag-menu-row"
          onClick={() => {
            void openFromHistory(h.id, h.title);
            onClose();
          }}
        >
          <span>{open[h.id]?.title ?? h.title ?? h.id}</span>
          <span className="meta">
            {when(h.created)}
            {open[h.id]
              ? ` · ${fmtCents(open[h.id].costCents)}`
              : h.turns != null
                ? ` · ${h.turns} turn${h.turns === 1 ? "" : "s"}`
                : ""}
          </span>
        </button>
      ))}
      {rows.length > shown.length && (
        <div className="ag-menu-foot">
          Sessions are kept per project.{" "}
          <button className="btn-link" onClick={() => setAll(true)}>
            Show all {rows.length}
          </button>
        </div>
      )}
    </div>
  );
}

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const days = Math.floor(
    (today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
