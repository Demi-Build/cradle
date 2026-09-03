import { useEffect, useRef, useState } from "react";
import type { RunItem } from "../../lib/agentState";
import { fmtCents, fmtDuration, specialistLabel } from "../../lib/agentState";
import { stopRun } from "../../lib/agentActions";
import { useElapsed } from "./useElapsed";
import { ItemList } from "./Transcript";

/** A delegated task (README §4): a nested card — caret, mono specialist,
 *  one-line task, live status (`running 0:38`), per-card ⏹. Tool calls,
 *  chips and results live inside, indented. The user never chooses a
 *  specialist; the card is how routing becomes visible. A finished card
 *  collapses to `✓ Artist · re-tinted east columns · $0.31`. */
export function RunCard({ run, conversationId }: { run: RunItem; conversationId: string }) {
  const [open, setOpen] = useState(!run.collapsed);
  // A finished run collapses to its one-line summary (README §4) the moment
  // it finishes — a card the reader had expanded mid-run included.
  const prevStatus = useRef(run.status);
  useEffect(() => {
    if (prevStatus.current !== run.status && run.status === "ok") setOpen(false);
    prevStatus.current = run.status;
  }, [run.status]);
  const elapsedLive = useElapsed(run.startedAt, run.status === "running");
  const elapsed =
    run.status === "running" ? elapsedLive : (run.endedAt ?? run.startedAt) - run.startedAt;
  const who = specialistLabel(run.specialist);
  const status =
    run.status === "running"
      ? `running ${fmtDuration(elapsed)}`
      : run.status === "cancelled"
        ? `stopped ${fmtDuration(elapsed)}`
        : run.status === "failed"
          ? `failed ${fmtDuration(elapsed)}`
          : fmtDuration(elapsed);
  return (
    <div className="ag-run" data-testid="run-card" data-status={run.status} data-run={run.runId}>
      <div
        className="ag-run-head"
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        <span className="caret">{open ? "▼" : "▶"}</span>
        {run.status === "ok" && !open ? (
          <>
            <span className="who">✓ {who}</span>
            <span className="task">{run.summary ?? run.task}</span>
            {run.costCents != null && <span className="status">{fmtCents(run.costCents)}</span>}
          </>
        ) : (
          <>
            <span className="who">{who}</span>
            <span className="task">{run.task}</span>
            <span className={`status ${run.status}`}>{status}</span>
          </>
        )}
        {run.status === "running" && (
          <button
            className="ag-stop sm"
            onClick={(e) => {
              e.stopPropagation();
              void stopRun(run.runId);
            }}
            title="Stop this run only — the rest of the conversation continues"
            aria-label={`Stop ${who}`}
          >
            ⏹
          </button>
        )}
      </div>
      {open && (
        <div className="ag-run-body">
          {run.routing && <div className="ag-run-routing">{run.routing}</div>}
          <ItemList items={run.items} conversationId={conversationId} />
          {run.status === "cancelled" && (
            <div className="ag-cancelled">
              {run.summary && <div>{run.summary}</div>}
              <div>
                No new work started.
                {run.costCents != null ? ` ${fmtCents(run.costCents)} in tokens.` : ""}
              </div>
              {run.resume && (
                <div style={{ marginTop: 4 }}>
                  <button className="ag-btn" onClick={() => void resumeRun(conversationId, run)}>
                    {run.resume}
                  </button>
                </div>
              )}
            </div>
          )}
          {run.status === "failed" && (
            <div className="ag-card-mono" style={{ color: "var(--err)" }}>
              {run.summary ?? "failed"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function resumeRun(conversationId: string, run: RunItem) {
  const { sendMessage } = await import("../../lib/agentActions");
  await sendMessage(
    conversationId,
    `Resume the ${specialistLabel(run.specialist)} run: ${run.task}.`,
  );
}
