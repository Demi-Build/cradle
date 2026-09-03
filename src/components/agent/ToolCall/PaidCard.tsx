import { useElapsed } from "../useElapsed";
import type { PaidState, ToolItem } from "../../../lib/agentState";
import { fmtCents, fmtCentsRange, fmtDuration, specialistLabel } from "../../../lib/agentState";
import { showMe } from "../../../lib/agentShowMe";

/** The paid card (README §5 "paid") — the only accent-outlined card, four
 *  states. The price is in the Accept button; the backend AND model are
 *  named; today's spend sits beside the estimate; "Always allow" never
 *  appears (doctrine 3 / the engine's `paid is never Always-allowable`).
 *
 *  Presentational: every figure is the service's (or the estimate call's,
 *  when this card gates an editor button — see `ConfirmGate`). Nothing is
 *  inferred client-side; a missing `spentCents` renders as unknown. */
export function PaidCard({
  paid,
  title,
  specialist,
  onAccept,
  onReject,
  onStop,
  onFinishLast,
  onUndoAll,
  tool,
  footnote = true,
}: {
  paid: PaidState;
  title: string;
  specialist?: string;
  onAccept?: () => void;
  onReject?: () => void;
  onStop?: () => void;
  onFinishLast?: () => void;
  onUndoAll?: () => void;
  tool?: ToolItem;
  footnote?: boolean;
}) {
  const cls = `ag-card paid ${paid.state}`;
  if (paid.state === "estimate") {
    const who = specialist ? `${specialistLabel(specialist)} wants to ${title}` : title;
    // No estimate is not $0: the gate still opens (doctrine 3), and the card
    // says the price is unknown rather than printing a confident "$0.00".
    const unknown = paid.lowCents <= 0 && paid.highCents <= 0;
    return (
      <div className={cls} data-testid="paid-card" data-state="estimate">
        <div className="ag-card-head">
          <span className="ag-badge paid">paid</span>
          <span className="title">{who}</span>
        </div>
        <div className="ag-paid-est">
          <span className="k">estimate</span>
          <span className="v price">
            {unknown ? "— not estimated" : fmtCentsRange(paid.lowCents, paid.highCents)}
          </span>
          <span className="k">backend</span>
          <span className="v">
            {paid.backend} · {paid.model}
          </span>
          <span className="k">work</span>
          <span className="v">{paid.unitLabel}</span>
          <span className="k">budget</span>
          <span className="v">{fmtCents(paid.todaySpendCents)} spent today · no cap set</span>
        </div>
        <div className="ag-card-actions">
          <button className="ag-btn primary" onClick={onAccept} disabled={!onAccept}>
            {unknown
              ? `Accept · spend on ${paid.backend}`
              : `Accept · spend up to ${fmtCents(paid.highCents)}`}
          </button>
          <button className="ag-btn" onClick={onReject} disabled={!onReject}>
            Reject
          </button>
        </div>
        {footnote && (
          <div className="ag-foot" style={{ marginTop: 6 }}>
            Paid work is never covered by “always allow”. Every spend asks.
          </div>
        )}
      </div>
    );
  }
  if (paid.state === "running") {
    return <RunningPaid paid={paid} title={title} onStop={onStop} />;
  }
  if (paid.state === "result") {
    return (
      <div className={cls} data-testid="paid-card" data-state="result">
        <div className="ag-card-head">
          <span style={{ color: "var(--ok)" }}>✓</span>
          <span className="title">{paid.label}</span>
          <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontWeight: 600 }}>
            {fmtCents(paid.actualCents)}
          </span>
        </div>
        {paid.thumbnails.length > 0 && (
          <div className="ag-thumbs">
            {paid.thumbnails.map((src, i) => (
              <img key={i} src={src} alt="" />
            ))}
          </div>
        )}
        <div className="ag-card-mono" style={{ display: "flex", gap: 8 }}>
          <span>
            {fmtDuration(paid.durationMs)} · {paid.backend}/{paid.model}
          </span>
          {(paid.showMe ?? tool?.showMe) && (
            <button
              className="btn-link"
              style={{ marginLeft: "auto" }}
              onClick={() => showMe((paid.showMe ?? tool?.showMe)!)}
            >
              Show me{paid.showMe?.kind === "library" ? " in Library" : ""}
            </button>
          )}
        </div>
      </div>
    );
  }
  // stopped
  return (
    <div className={cls} data-testid="paid-card" data-state="stopped">
      <div className="ag-card-head">
        <span>⏹</span>
        <span className="title">Stopped by you at {fmtDuration(paid.stoppedAtMs)}</span>
        <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontWeight: 600 }}>
          {fmtCents(paid.billedCents)}
        </span>
      </div>
      <div className="ag-kept" style={{ marginTop: 6 }}>
        {paid.kept.length > 0 && (
          <div className="ok">
            ✓ kept {paid.kept.length} — {paid.kept.join(", ")}
          </div>
        )}
        {paid.notStarted.length > 0 && (
          <div className="no">— not started: {paid.notStarted.join(", ")}</div>
        )}
      </div>
      <div className="ag-card-mono">
        Billed {fmtCents(paid.billedCents)} of the {fmtCents(paid.estimateCents)} estimate. Nothing
        was rolled back.
      </div>
      <div className="ag-card-actions">
        {paid.notStarted.length > 0 && (
          <button className="ag-btn" onClick={onFinishLast} disabled={!onFinishLast}>
            Finish the last one
            {paid.finishLastCents != null ? ` · ~${fmtCents(paid.finishLastCents)}` : ""}
          </button>
        )}
        {paid.kept.length > 0 && (
          <button className="ag-btn" onClick={onUndoAll} disabled={!onUndoAll}>
            Undo all {paid.kept.length}
          </button>
        )}
      </div>
    </div>
  );
}

function RunningPaid({
  paid,
  title,
  onStop,
}: {
  paid: Extract<PaidState, { state: "running" }>;
  title: string;
  onStop?: () => void;
}) {
  const elapsed = useElapsed(paid.startedAt);
  const pct =
    paid.total && paid.index != null
      ? Math.min(100, Math.round(((paid.index - 1) / paid.total) * 100))
      : null;
  return (
    <div className="ag-card paid running" data-testid="paid-card" data-state="running">
      <div className="ag-card-head">
        <span className="ag-badge paid">paid</span>
        <span className="title">{title}</span>
        <span className="ag-card-mono" style={{ marginTop: 0 }}>
          {fmtDuration(elapsed)} elapsed
        </span>
        {onStop && (
          <button className="ag-stop sm" onClick={onStop} title="Stop — keeps what landed">
            ⏹ Stop
          </button>
        )}
      </div>
      <div className={`ag-paid-bar${pct == null ? " indeterminate" : ""}`}>
        <div style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
      <div className="ag-paid-line">
        <span className="now">
          {paid.phase}
          {paid.item ? ` · ${paid.item}` : ""}
        </span>
        {paid.index != null && paid.total != null && (
          <span className="count">
            {paid.index} / {paid.total}
          </span>
        )}
      </div>
      <div className="ag-paid-line" style={{ marginTop: 4 }}>
        <span>{paid.done.map((d) => `✓ ${d}`).join(" ")}</span>
        <span className="count">
          spent so far {paid.spentCents == null ? "—" : fmtCents(paid.spentCents)} of{" "}
          {fmtCents(paid.budgetCents)}
        </span>
      </div>
    </div>
  );
}
