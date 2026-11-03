import { useEffect, useState } from "react";
import { api, type RunLogRow } from "../lib/invoke";
import { fmtUsd } from "../lib/cost";
import { runStatusStyle } from "../lib/runlog";

/** The job tray's "Run log" tab: the runs canon recorded in the pack's
 *  `.canon/runlog.jsonl` (every provider call, retry, cost, warning and crash),
 *  newest first. Click a run for its debug report; "Copy report" puts the
 *  Markdown on the clipboard for a bug. Read-only — canon owns the file and
 *  builds the report (`canon debug runs` / `canon debug report`). */
export function RunLogPanel({ worldPath }: { worldPath: string }) {
  const [runs, setRuns] = useState<RunLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .debugRuns(worldPath)
      .then((r) => live && (setRuns(r.runs), setError(null)))
      .catch((e) => live && (setRuns([]), setError(String(e))));
    return () => {
      live = false;
    };
  }, [worldPath]);

  const show = (run: string) => {
    if (open === run) {
      setOpen(null);
      return;
    }
    setOpen(run);
    setMarkdown("");
    setCopied(false);
    setLoading(true);
    api
      .debugReport(worldPath, run)
      .then((r) => setMarkdown(r.markdown))
      .catch((e) => setMarkdown(`Could not build the report: ${String(e)}`))
      .finally(() => setLoading(false));
  };

  const copy = () => {
    navigator.clipboard
      ?.writeText(markdown)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  if (runs === null) return <Note>Loading the run log…</Note>;
  if (error && runs.length === 0) {
    return <Note>No run log yet. Runs that call a provider, warn or fail are recorded here.</Note>;
  }
  if (runs.length === 0) {
    return (
      <Note>No runs recorded yet. Runs that call a provider, warn or fail are recorded here.</Note>
    );
  }

  return (
    <div>
      {runs.map((r) => (
        <div key={r.run} style={{ borderBottom: "1px solid var(--border)" }}>
          <div
            style={{ ...row, cursor: "pointer" }}
            onClick={() => show(r.run)}
            title={`${r.run}\n${r.command}`}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={ellipsis}>
                <strong>{r.command || r.run}</strong>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                {fmtWhen(r.started)} · {r.calls} call{r.calls === 1 ? "" : "s"}
                {r.failed_calls ? ` · ${r.failed_calls} failed` : ""}
                {r.duration_ms != null ? ` · ${fmtDur(r.duration_ms)}` : ""}
              </div>
            </span>
            {r.cost_usd > 0 && (
              <span style={{ fontSize: 11, opacity: 0.75 }}>{fmtUsd(r.cost_usd)}</span>
            )}
            <RunBadge status={r.status} />
          </div>
          {open === r.run && (
            <div style={{ padding: "0 4px 10px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <button
                  onClick={copy}
                  disabled={loading || !markdown}
                  style={{ cursor: "pointer", fontSize: 11 }}
                >
                  {copied ? "Copied" : "Copy report"}
                </button>
              </div>
              <pre style={report}>{loading ? "Building the report…" : markdown}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RunBadge({ status }: { status: string }) {
  const [label, color] = runStatusStyle(status);
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

function fmtWhen(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "24px 8px", textAlign: "center", opacity: 0.6, fontSize: 13 }}>
      {children}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 4px",
  fontSize: 13,
};
const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const report: React.CSSProperties = {
  margin: 0,
  maxHeight: 360,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  fontSize: 11,
  lineHeight: 1.45,
  background: "var(--bg-sunken)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
};
