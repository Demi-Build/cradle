import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { api, type Job, type JobEntry } from "../lib/invoke";
import { fmtUsd } from "../lib/cost";

/** The background-job tray: Active (queued + running) and Completed (this
 *  session's terminal jobs merged with the durable ledger). Watch generation
 *  run without the UI freezing; click a completed job to jump to its result.
 *  Mirrors CostDashboard's overlay+card+table idiom. */
export function JobTray() {
  const jobs = useStore((s) => s.jobs);
  const worldPath = useStore((s) => s.worldPath);
  const setJobsOpen = useStore((s) => s.setJobsOpen);
  const select = useStore((s) => s.select);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [history, setHistory] = useState<JobEntry[]>([]);

  // Durable history (past sessions) — refetched whenever this session's jobs
  // change (a new completion appended to the ledger). Best-effort.
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
      .filter((j) => j.status === "ok" || j.status === "no_change" || j.status === "failed")
      .map(jobToRow);
    const seen = new Set(rows.map((r) => r.id));
    for (const e of history) {
      if (!seen.has(e.job_id)) rows.push(entryToRow(e));
    }
    return rows.sort((a, b) => b.ts - a.ts);
  }, [jobs, history]);

  const jump = (row: Row) => {
    if (!row.target || !row.targetType) return;
    select({ kind: "entity", typeId: row.targetType, id: row.target });
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
                <div key={j.id} style={rowStyle}>
                  <span style={{ fontSize: 15 }}>{opIcon(j.op)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{opLabel(j.op)}</strong>{" "}
                    <span style={{ opacity: 0.7 }}>{j.label || j.target}</span>
                  </span>
                  <StatusBadge status={j.status} changed={j.changed} />
                </div>
              ))}
            </div>
          )
        ) : completed.length === 0 ? (
          <Empty>No completed jobs yet.</Empty>
        ) : (
          <div>
            {completed.map((r) => (
              <div key={r.id} style={rowStyle}>
                <span style={{ fontSize: 15 }}>{opIcon(r.op)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{opLabel(r.op)}</strong>{" "}
                  <span style={{ opacity: 0.7 }}>{r.target}</span>
                  {r.error && (
                    <div style={{ color: "#e0453a", fontSize: 11, marginTop: 2 }}>
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
                    View
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
};

function jobToRow(j: Job): Row {
  return {
    id: j.id,
    op: j.op,
    target: j.target,
    targetType: j.targetType,
    status: j.status,
    changed: j.changed,
    usd: j.cost?.usd,
    ts: j.ts,
    durationMs: j.endedAt && j.ts ? j.endedAt - j.ts : undefined,
    error: j.error,
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
    }[op] ?? op
  );
}

function opIcon(op: string): string {
  return (
    {
      improve: "✨", layout: "🪄", generate: "🎲", enemies: "🎲", items: "🎲",
      sprite: "🎨", animate: "🎬", music: "🎵", audio: "🎵",
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
      ? ["queued", "#8a7fa0"]
      : status === "running"
        ? ["running…", "#e0a15a"]
        : status === "failed"
          ? ["failed", "#e0453a"]
          : status === "no_change" || (status === "ok" && !changed)
            ? ["no change", "#8a7fa0"]
            : ["changed", "#3ddc84"];
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
        color: "#120e18", background: color, whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function TabButton({
  on, onClick, children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer", fontSize: 12, padding: "4px 12px", borderRadius: 7,
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
