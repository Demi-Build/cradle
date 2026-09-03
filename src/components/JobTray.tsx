import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { api, type Job, type JobEntry } from "../lib/invoke";
import { fmtUsd } from "../lib/cost";
import { USER_ACTOR, parseActor } from "../lib/actor";
import { cancelJob } from "../lib/agentActions";
import { specialistLabel } from "../lib/agentState";
import { showMe } from "../lib/agentShowMe";
import { phaseLabel, usePackTemplates } from "../lib/packTemplates";

/** The background-job tray: Active (queued + running) and Completed (this
 *  session's terminal jobs merged with the durable ledger). Watch generation
 *  run without the UI freezing; click a completed job to jump to its result.
 *  Mirrors CostDashboard's overlay+card+table idiom.
 *
 *  Row P1-A5 (README §10 "Job tray"): editor-launched and agent-launched
 *  jobs share this ONE tray; the attribution column (`you · editor buttons`
 *  vs `agent:<name>/<specialist>`, read via `parseActor`) is what tells them
 *  apart. Every active row has its own ⏹ (row A4.5's `cancel_job`: a queued
 *  job is dropped, a running one stops at its next item boundary and keeps
 *  what landed); finished rows get `Show me`. */
export function JobTray() {
  const jobs = useStore((s) => s.jobs);
  const worldPath = useStore((s) => s.worldPath);
  const setJobsOpen = useStore((s) => s.setJobsOpen);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [history, setHistory] = useState<JobEntry[]>([]);
  // §3.0-E: phase labels are template data. The tray doesn't know which
  // template a job belongs to, so it reads every installed map (ids are
  // template-prefixed) and falls back to the humanized id.
  const { templates } = usePackTemplates();

  // Durable history (past sessions) — refetched whenever this session's jobs
  // change (a new completion appended to the ledger). Best-effort.
  //
  // Row P1-A6 closed the C11 gap that made this list a lie: `jobs_list` /
  // `jobs_record` existed only in the browser dev-mock, so on the real app
  // every completed run vanished at quit and agent-launched runs never joined
  // the button-launched ones. Both commands are native now, and this is the
  // ONE durable history both doors write to. The ledger is RUN STATUS only —
  // its `actual_usd` is informational; money reconciles on the cost dashboard,
  // off the journal (P.8.7).
  useEffect(() => {
    let live = true;
    api
      .jobList(worldPath)
      .then((r) => live && setHistory(r.jobs.entries))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [worldPath, jobs]);

  const active = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running"),
    [jobs],
  );
  // Completed = this session's terminal jobs + durable entries not seen this
  // session, newest first.
  const completed = useMemo<Row[]>(() => {
    const rows: Row[] = jobs
      .filter(
        (j) =>
          j.status === "ok" ||
          j.status === "no_change" ||
          j.status === "failed" ||
          j.status === "cancelled",
      )
      .map(jobToRow);
    const seen = new Set(rows.map((r) => r.id));
    for (const e of history) {
      if (!seen.has(e.job_id)) rows.push(entryToRow(e));
    }
    return rows.sort((a, b) => b.ts - a.ts);
  }, [jobs, history]);

  const jump = (row: Row) => {
    if (!row.target || !row.targetType) return;
    showMe({ kind: "entity", typeId: row.targetType, id: row.target });
    setJobsOpen(false);
  };

  return (
    <div style={overlay} onClick={() => setJobsOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>⚙ Jobs</h3>
          <button onClick={() => setJobsOpen(false)} style={{ cursor: "pointer" }}>
            Close
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <TabButton on={tab === "active"} onClick={() => setTab("active")}>
            Active{active.length ? ` (${active.length})` : ""}
          </TabButton>
          <TabButton on={tab === "completed"} onClick={() => setTab("completed")}>
            Completed{completed.length ? ` (${completed.length})` : ""}
          </TabButton>
        </div>

        {tab === "active" ? (
          active.length === 0 ? (
            <Empty>No jobs running. Generation you start shows up here.</Empty>
          ) : (
            <div>
              {active.map((j) => (
                <div key={j.id} style={rowStyle} data-testid="job-row" data-status={j.status}>
                  <span style={{ fontSize: 15 }}>{opIcon(j.op)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{opLabel(j.op)}</strong>{" "}
                    <span style={{ opacity: 0.7 }}>{j.label || j.target}</span>
                    <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                      <Attribution actor={j.actor} />
                      {/* Row P0-10 (§3.0-E): the running PHASE is named from
                          the same template label map CreateProgress and the
                          agent's run cards render — the tray used to show only
                          the raw sub-item, which says nothing on a run whose
                          items are ids. */}
                      {(() => {
                        const p = j.progress?.phases.find((x) => x.status === "running");
                        if (!p) return null;
                        const count =
                          p.index != null && p.itemTotal ? ` ${p.index} / ${p.itemTotal}` : "";
                        return (
                          <span className="ag-attr" data-testid="job-phase">
                            {phaseLabel(p.node, templates)}
                            {p.item ? ` · ${p.item}` : ""}
                            {count}
                          </span>
                        );
                      })()}
                      {j.estimate && (j.estimate.worst > 0 || j.estimate.best > 0) && (
                        <span className="ag-attr">up to {fmtUsd(j.estimate.worst)}</span>
                      )}
                    </div>
                  </span>
                  <StatusBadge status={j.status} changed={j.changed} />
                  <button
                    className="ag-stop sm"
                    onClick={() => void cancelJob(j.id)}
                    title={
                      j.status === "queued"
                        ? "Stop — the queued job is dropped before it starts"
                        : "Stop — finishes nothing new, keeps what landed"
                    }
                    aria-label={`Stop ${j.label || j.target}`}
                    data-testid="job-stop"
                  >
                    ⏹
                  </button>
                </div>
              ))}
            </div>
          )
        ) : completed.length === 0 ? (
          <Empty>No completed jobs yet.</Empty>
        ) : (
          <div>
            {completed.map((r) => (
              <div key={r.id} style={rowStyle} data-testid="job-row" data-status={r.status}>
                <span style={{ fontSize: 15 }}>{opIcon(r.op)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{opLabel(r.op)}</strong> <span style={{ opacity: 0.7 }}>{r.target}</span>
                  <div style={{ marginTop: 2 }}>
                    <Attribution actor={r.actor} />
                    {r.status === "cancelled" && r.kept != null && (
                      <span className="ag-attr" style={{ marginLeft: 8 }}>
                        kept {r.kept.length}
                        {r.notStarted?.length ? ` · not started ${r.notStarted.length}` : ""}
                      </span>
                    )}
                  </div>
                  {r.error && (
                    <div style={{ color: "var(--err)", fontSize: 11, marginTop: 2 }}>
                      {r.error.slice(0, 120)}
                    </div>
                  )}
                </span>
                {r.usd != null && r.usd > 0 && (
                  <span style={{ fontSize: 11, opacity: 0.75 }}>{fmtUsd(r.usd)}</span>
                )}
                {r.durationMs != null && (
                  <span style={{ fontSize: 11, opacity: 0.55 }}>{fmtDur(r.durationMs)}</span>
                )}
                <StatusBadge status={r.status} changed={r.changed} />
                {r.target && r.targetType && (
                  <button onClick={() => jump(r)} style={{ cursor: "pointer", fontSize: 11 }}>
                    Show me
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** "you · editor buttons" or "agent:<conversation>/<specialist>" — the one
 *  fact that tells the two launchers apart. Absent actors are the editor's. */
function Attribution({ actor }: { actor?: string }) {
  const ref = parseActor(actor ?? USER_ACTOR);
  if (ref.kind === "agent") {
    return (
      <span className="ag-attr agent" data-testid="job-attr" title={ref.actor}>
        {ref.actor}
        {ref.specialist ? ` · ${specialistLabel(ref.specialist)}` : ""}
      </span>
    );
  }
  return (
    <span className="ag-attr" data-testid="job-attr">
      you · editor buttons
    </span>
  );
}

type Row = {
  id: string;
  op: string;
  target: string;
  targetType: string;
  status: string;
  changed?: boolean;
  usd?: number;
  ts: number;
  durationMs?: number;
  error?: string;
  actor?: string;
  kept?: string[];
  notStarted?: string[];
};

function jobToRow(j: Job): Row {
  const r = j.result ?? {};
  return {
    id: j.id,
    op: j.op,
    target: j.target,
    targetType: j.targetType,
    status: j.status,
    changed: j.changed,
    usd: j.cost?.usd ?? (typeof r.billed_usd === "number" ? r.billed_usd : undefined),
    ts: j.ts,
    durationMs: j.endedAt && j.ts ? j.endedAt - j.ts : undefined,
    error: j.error,
    actor: j.actor,
    kept: Array.isArray(r.kept) ? (r.kept as string[]) : undefined,
    notStarted: Array.isArray(r.not_started) ? (r.not_started as string[]) : undefined,
  };
}

function entryToRow(e: JobEntry): Row {
  return {
    id: e.job_id,
    op: e.op,
    target: e.target ?? "",
    targetType: e.target_type ?? navTypeFor(e.op, e.target ?? ""),
    status: e.status,
    changed: e.changed,
    usd: e.actual_usd,
    ts: e.ts ? Date.parse(e.ts) || 0 : 0,
    durationMs: e.duration_ms,
    error: e.error,
    // Row P1-A6: the durable entry now carries `identity` (the lane fields the
    // ledger gained), so a run from a PAST session keeps its attribution
    // column instead of falling back to "you". The in-memory job's `actor` is
    // the same string; `identity` is its read-time form.
    actor: e.identity ?? (e as { actor?: string }).actor,
  };
}

/** Best-effort nav type for a durable entry lacking target_type (old ledgers). */
function navTypeFor(op: string, target: string): string {
  if (op === "sprite" || op === "animate") {
    return target.startsWith("item") ? "items" : "enemies";
  }
  if (op === "audio") return "audio";
  return "levels";
}

function opLabel(op: string): string {
  return (
    {
      improve: "Improve",
      layout: "Regenerate layout",
      generate: "Generate level",
      enemies: "Place enemies",
      items: "Place items",
      sprite: "Generate sprite",
      animate: "Animate",
      music: "Generate music",
      audio: "Stage audio",
      world: "New project",
    }[op] ?? op
  );
}

function opIcon(op: string): string {
  return (
    {
      improve: "✨",
      layout: "🪄",
      generate: "🎲",
      enemies: "🎲",
      items: "🎲",
      sprite: "🎨",
      animate: "🎬",
      music: "🎵",
      audio: "🎵",
      world: "🌍",
    }[op] ?? "⚙"
  );
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function StatusBadge({ status, changed }: { status: string; changed?: boolean }) {
  const [label, color] =
    status === "queued"
      ? ["queued", "var(--fg-dim)"]
      : status === "running"
        ? ["running…", "var(--accent)"]
        : status === "failed"
          ? ["failed", "var(--err)"]
          : status === "cancelled"
            ? ["stopped", "var(--warn)"]
            : status === "no_change" || (status === "ok" && !changed)
              ? ["no change", "var(--fg-dim)"]
              : ["changed", "var(--ok)"];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        color: "var(--bg-sunken)",
        background: color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer",
        fontSize: 12,
        padding: "4px 12px",
        borderRadius: 7,
        border: "1px solid var(--border)",
        background: on ? "var(--accent)" : "transparent",
        color: on ? "var(--accent-ink)" : "var(--fg-muted)",
        fontWeight: on ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "24px 8px", textAlign: "center", opacity: 0.6, fontSize: 13 }}>
      {children}
    </div>
  );
}

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
  width: 560,
  maxWidth: "92vw",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
  color: "var(--fg)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 4px",
  borderBottom: "1px solid var(--border)",
  fontSize: 13,
};
