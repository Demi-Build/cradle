import { useEffect, useState } from "react";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";
import { PaidCard } from "./ToolCall/PaidCard";
import {
  paidFromEstimate,
  peekGate,
  settleGate,
  subscribeGate,
  type SpendGateOpts,
} from "./confirmGateState";
import "./agent.css";

/** The confirm gate's rendering half (README §5 "paid"; row P1-A5). The
 *  state, the queue and the `confirmSpend` / `confirmAction` calls the 13
 *  editor sites make live in `confirmGate.ts` beside it.
 *
 *  Mount once (App). Renders whichever gate is pending. */
export function ConfirmGateHost() {
  const [, force] = useState(0);
  useEffect(() => subscribeGate(() => force((n) => n + 1)), []);
  const cur = peekGate();
  if (!cur) return null;
  const settle = (ok: boolean) => settleGate(cur, ok);
  return (
    <div className="ag-gate-scrim" onClick={() => settle(false)} data-testid="confirm-gate">
      <div
        className="ag-gate"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={cur.opts.title}
      >
        {cur.kind === "spend" ? (
          <SpendGate opts={cur.opts} onAccept={() => settle(true)} onReject={() => settle(false)} />
        ) : (
          <div className="ag-card">
            <div className="ag-card-head">
              <span className="title">{cur.opts.title}</span>
            </div>
            {cur.opts.body && <div className="body">{cur.opts.body}</div>}
            <div className="ag-card-actions">
              <button className="ag-btn primary" onClick={() => settle(true)} autoFocus>
                {cur.opts.confirmLabel ?? "Proceed"}
              </button>
              <button className="ag-btn" onClick={() => settle(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SpendGate({
  opts,
  onAccept,
  onReject,
}: {
  opts: SpendGateOpts;
  onAccept: () => void;
  onReject: () => void;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    if (!worldPath) {
      setToday(0);
      return;
    }
    api
      .spendList(worldPath)
      .then((r) => {
        if (!live) return;
        const day = new Date().toISOString().slice(0, 10);
        const cents = r.spend.entries
          .filter((e) => (e.ts ?? "").startsWith(day))
          .reduce((n, e) => n + Math.round((e.actual_usd ?? 0) * 100), 0);
        setToday(cents);
      })
      .catch(() => live && setToday(0));
    return () => {
      live = false;
    };
  }, [worldPath]);
  const p = paidFromEstimate(opts);
  return (
    <div>
      <PaidCard
        paid={{ state: "estimate", ...p, todaySpendCents: today ?? 0 }}
        title={opts.title}
        onAccept={onAccept}
        onReject={onReject}
        footnote={false}
      />
      {opts.body && (
        <div className="ag-card" style={{ marginTop: 6 }}>
          <div className="body">{opts.body}</div>
        </div>
      )}
    </div>
  );
}
