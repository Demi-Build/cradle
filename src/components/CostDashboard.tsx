import { useEffect, useState } from "react";
import { api, type SpendSummary } from "../lib/invoke";
import { fmtUsd } from "../lib/cost";
import { useStore } from "../store";

/** What has this project actually cost? Reads the per-project spend ledger
 *  (`canon spend list` — every paid op cradle fired, with its MEASURED cost)
 *  plus the pack's current `generation_stats.total_cost_usd` (the last full
 *  New-Project run's real spend). Actuals are measured; estimates are the
 *  pre-run forecasts kept alongside for comparison. */
export function CostDashboard() {
  const worldPath = useStore((s) => s.worldPath);
  const setDashboardOpen = useStore((s) => s.setDashboardOpen);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [genActual, setGenActual] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .spendList(worldPath)
      .then((r) => live && setSpend(r.spend))
      .catch((e) => live && setErr(String(e).slice(0, 200)));
    api
      .readWorldJson(worldPath, "manifest.json")
      .then((mf) => {
        const c = (mf as { generation_stats?: { total_cost_usd?: number } })
          .generation_stats?.total_cost_usd;
        if (live && typeof c === "number") setGenActual(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [worldPath]);

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
    width: 580,
    maxWidth: "92vw",
    maxHeight: "86vh",
    overflowY: "auto",
    background: "var(--surface-1, #1a1522)",
    border: "1px solid var(--border, #3a2f4a)",
    borderRadius: 12,
    padding: 22,
    color: "var(--text-1, #ece7f5)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
  };
  const tile: React.CSSProperties = {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--surface-2, #221a2e)",
    border: "1px solid var(--border, #3a2f4a)",
  };
  const th: React.CSSProperties = {
    textAlign: "left",
    fontWeight: 600,
    opacity: 0.7,
    padding: "4px 8px",
    borderBottom: "1px solid var(--border, #3a2f4a)",
  };
  const td: React.CSSProperties = { padding: "4px 8px", fontSize: 12 };
  const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const byOp = spend ? Object.entries(spend.by_op) : [];
  const entries = spend ? [...spend.entries].reverse().slice(0, 14) : [];

  return (
    <div style={overlay} onClick={() => setDashboardOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>💰 Project cost</h3>
          <button onClick={() => setDashboardOpen(false)} style={{ cursor: "pointer" }}>
            Close
          </button>
        </div>
        <p style={{ margin: "6px 0 14px", fontSize: 12, opacity: 0.65, lineHeight: 1.4 }}>
          What this project has actually cost — every paid op cradle fired, measured from real
          token/asset usage. Fake/$0 ops are listed too.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={tile}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Tracked spend (all ops)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {spend ? fmtUsd(spend.total_actual_usd) : "…"}
            </div>
            <div style={{ fontSize: 11, opacity: 0.55 }}>{spend?.count ?? 0} op(s) recorded</div>
          </div>
          <div style={tile}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Last full run (stats)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {genActual != null ? fmtUsd(genActual) : "—"}
            </div>
            <div style={{ fontSize: 11, opacity: 0.55 }}>manifest generation_stats</div>
          </div>
        </div>

        {err && <div style={{ color: "#e0453a", fontSize: 12, marginBottom: 10 }}>{err}</div>}

        {byOp.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={th}>Op</th>
                <th style={{ ...th, textAlign: "right" }}>Count</th>
                <th style={{ ...th, textAlign: "right" }}>Actual</th>
                <th style={{ ...th, textAlign: "right" }}>Est.</th>
              </tr>
            </thead>
            <tbody>
              {byOp.map(([op, a]) => (
                <tr key={op}>
                  <td style={td}>{op}</td>
                  <td style={tdNum}>{a.count}</td>
                  <td style={tdNum}>{fmtUsd(a.actual_usd)}</td>
                  <td style={{ ...tdNum, opacity: 0.6 }}>{fmtUsd(a.estimate_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {entries.length > 0 ? (
          <>
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Recent ops</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td style={{ ...td, opacity: 0.6, whiteSpace: "nowrap" }}>
                      {(e.ts ?? "").slice(0, 10)}
                    </td>
                    <td style={td}>
                      {e.op}
                      {e.level_id ? ` · ${e.level_id}` : ""}
                    </td>
                    <td style={{ ...td, opacity: 0.6 }}>
                      {Object.values(e.backends ?? {})
                        .filter((b) => b && b !== "none" && b !== "fake")
                        .join(", ") || "fake"}
                    </td>
                    <td style={tdNum}>{fmtUsd(e.actual_usd ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          spend && (
            <div style={{ fontSize: 12, opacity: 0.6, padding: "12px 0" }}>
              No ops recorded yet — generate a level or a new project to start tracking spend.
            </div>
          )
        )}

        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 14, lineHeight: 1.5 }}>
          Actual = measured (real returned tokens × price; provider-reported asset cost). Estimate =
          the pre-run forecast shown at each gate. fal image spend isn't provider-reported, so it
          shows $0 in actuals.
        </div>
      </div>
    </div>
  );
}
