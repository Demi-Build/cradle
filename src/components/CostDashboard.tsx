import { Fragment, useEffect, useMemo, useState } from "react";
import {
  api,
  type JournalIdentityRow,
  type JournalSummary,
  type SpendSummary,
} from "../lib/invoke";
import { fmtCentsCell, fmtCentsUsd, fmtUsd, summarizeJournal } from "../lib/cost";
import { specialistLabel } from "../lib/agentState";
import { useStore } from "../store";

/** 💰 The cost dashboard (row P1-A6 — agent-panel README §12, board 06).
 *
 *  **Counts every generation in the project, whatever launched it** — the
 *  editor's own buttons as much as the agent. Four tiles (total / generation /
 *  conversation / today), the you-vs-agent split bar, then three tables: by
 *  kind, by identity (specialists nested under their conversation), and by
 *  conversation.
 *
 *  One source, one number. Every figure on this screen is a sum of the journal
 *  event's `costCents` (P0 paper P.8.7) — "every row is one journal entry, so
 *  the two tables always reconcile". They reconcile *by construction*, not by
 *  care: there is only one field to disagree about. Canon computes the roll-up
 *  server-side (`canon journal list --summary`), which returns the roll-up
 *  INSTEAD of the events, so a long project never ships its whole journal here;
 *  `summarizeJournal` is the same arithmetic and takes over when only events
 *  came back (an older canon, or a bounded read).
 *
 *  What the design binds and this honours:
 *  - **unconfirmed estimates are never counted** — an estimate lives on the
 *    permission chip and never in the journal, so nothing here can see one;
 *  - **stopped runs count what they billed** — a cancelled item journals its
 *    partial with no `after_hash`, and it sums like any other row;
 *  - **a new generation kind is a field value, not a schema change** — the
 *    by-kind table is built from the values present, so `mesh` (W2.2) or
 *    anything later renders as its own row with no edit here;
 *  - **accuracy is shown distinctly** — `measured` (the provider reported the
 *    figure) vs `estimated` (priced from the table). The fal gap is visible;
 *    it is never a silent $0. A run a paid backend billed but canon could not
 *    price shows as an unpriced run, with its reason.
 *
 *  `spend.jsonl` survives as a derived compat index: only rows WITHOUT a
 *  `journal_ref` (pre-A6 history, and the create run until it journals) are
 *  added to the journal total — no row is ever in both sets. */
export function CostDashboard() {
  const worldPath = useStore((s) => s.worldPath);
  const setDashboardOpen = useStore((s) => s.setDashboardOpen);
  const [summary, setSummary] = useState<JournalSummary | null>(null);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [genActual, setGenActual] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .journalList(worldPath, { summary: true })
      .then((r) => {
        if (!live) return;
        setSummary(r.summary ?? summarizeJournal(r.events ?? []));
      })
      .catch((e) => live && setErr(String(e).slice(0, 200)));
    // The compat index: pre-A6 rows the journal cannot know about.
    api
      .spendList(worldPath)
      .then((r) => live && setSpend(r.spend))
      .catch(() => {});
    api
      .readWorldJson(worldPath, "manifest.json")
      .then((mf) => {
        const c = (mf as { generation_stats?: { total_cost_usd?: number } }).generation_stats
          ?.total_cost_usd;
        if (live && typeof c === "number") setGenActual(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [worldPath]);

  /** Pre-A6 dollars: spend rows that name no journal event. Kept separate and
   *  labelled — never folded into a tile, because they are a different
   *  measurement from a different era. */
  const legacyUsd = useMemo(
    () =>
      (spend?.entries ?? [])
        .filter((e) => !e.journal_ref)
        .reduce((n, e) => n + (e.actual_usd ?? 0), 0),
    [spend],
  );

  /** README §12's by-identity table: `you · editor buttons` first, then each
   *  agent CONVERSATION as a parent row with its specialists nested. The parent
   *  is a sum of its children, so the nesting cannot drift from the totals. */
  const identityGroups = useMemo(() => {
    const rows = summary?.byIdentity ?? [];
    const human = rows.filter((r) => r.kind !== "agent");
    const byConversation = new Map<string, JournalIdentityRow[]>();
    for (const r of rows.filter((r) => r.kind === "agent")) {
      const key = r.conversation ?? r.identity;
      byConversation.set(key, [...(byConversation.get(key) ?? []), r]);
    }
    const agents = [...byConversation.entries()]
      .map(([conversation, children]) => ({
        conversation,
        children: children.sort((a, b) => b.totalCents - a.totalCents),
        tokensCents: children.reduce((n, r) => n + r.tokensCents, 0),
        generationCents: children.reduce((n, r) => n + r.generationCents, 0),
        totalCents: children.reduce((n, r) => n + r.totalCents, 0),
        runs: children.reduce((n, r) => n + r.runs, 0),
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
    return { human, agents };
  }, [summary]);

  /** Which conversations are live RIGHT NOW — board 06 marks them. The panel's
   *  own state answers; the journal records what was spent, never what is
   *  running. Read once per render (a hook cannot live inside a row map). */
  const runningIds = useStore((s) =>
    Object.entries(s.agent.conversations)
      .filter(([, c]) => c.status === "streaming" || c.status === "awaiting_approval")
      .map(([id]) => id)
      .sort()
      // A joined STRING, not a Set: the selector's result is compared by
      // identity, and a fresh Set every read would re-render forever.
      .join("\u0000"),
  );
  const running = useMemo(
    () => new Set(runningIds ? runningIds.split("\u0000") : []),
    [runningIds],
  );

  const split = summary
    ? {
        you: summary.youCents,
        agent: summary.agentCents,
        total: Math.max(1, summary.youCents + summary.agentCents),
      }
    : null;

  return (
    <div style={overlay} onClick={() => setDashboardOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()} data-testid="cost-dashboard">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>💰 Cost</h3>
          <button onClick={() => setDashboardOpen(false)} style={{ cursor: "pointer" }}>
            Close
          </button>
        </div>
        <p style={{ margin: "6px 0 14px", fontSize: 12, opacity: 0.65, lineHeight: 1.45 }}>
          Every generation in this project is counted here, whatever launched it. Two questions in
          three tables: what kind of work cost the money, and who asked for it — you, or one of the
          agent’s specialists. Conversation tokens stay a separate column from generation spend,
          because they fail differently.
        </p>

        {err && <div style={{ color: "var(--err)", fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }} data-testid="cost-tiles">
          <Tile label="total" cents={summary?.totalCents} testId="tile-total" />
          <Tile label="generation" cents={summary?.generationCents} testId="tile-generation" />
          <Tile label="conversation" cents={summary?.tokensCents} testId="tile-conversation" />
          <Tile label="today" cents={summary?.todayCents} testId="tile-today" />
        </div>

        {split && (
          <div style={{ marginBottom: 16 }} data-testid="split-bar">
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
              generation · who launched it
            </div>
            <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  width: `${(split.you / split.total) * 100}%`,
                  background: "var(--fg-muted)",
                }}
                title={`you ${fmtCentsUsd(split.you)}`}
              />
              <div
                style={{
                  width: `${(split.agent / split.total) * 100}%`,
                  background: "var(--accent)",
                }}
                title={`agent ${fmtCentsUsd(split.agent)}`}
              />
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11, marginTop: 5, opacity: 0.8 }}>
              <span>you {fmtCentsUsd(split.you)}</span>
              <span style={{ color: "var(--accent)" }}>agent {fmtCentsUsd(split.agent)}</span>
            </div>
          </div>
        )}

        <SectionTitle>generation · by kind</SectionTitle>
        <table style={table} data-testid="by-kind">
          <thead>
            <tr>
              <th style={th}>kind</th>
              <th style={th}>backend · model</th>
              <th style={thNum}>runs</th>
              <th style={thNum}>you</th>
              <th style={thNum}>agent</th>
              <th style={thNum}>total</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.byKind ?? [])
              .filter((r) => r.genKind !== "tokens")
              .map((r) => (
                <tr key={r.genKind} data-testid={`kind-${r.genKind}`}>
                  <td style={td}>{r.genKind}</td>
                  <td style={{ ...td, opacity: 0.7 }}>
                    <span className="mono">
                      {r.backend || "—"} · {r.model || "—"}
                    </span>
                    {r.variants > 0 && <span style={{ opacity: 0.6 }}> +{r.variants} more</span>}
                  </td>
                  <td style={tdNum}>{r.runs}</td>
                  <td style={tdNum}>{fmtCentsCell(r.youCents)}</td>
                  <td style={tdNum}>{fmtCentsCell(r.agentCents)}</td>
                  <td style={{ ...tdNum, fontWeight: 600 }}>{fmtCentsUsd(r.totalCents)}</td>
                </tr>
              ))}
            {summary && (
              <tr data-testid="kind-total" style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 600 }} colSpan={2}>
                  all generation
                </td>
                <td style={tdNum}>
                  {summary.byKind
                    .filter((r) => r.genKind !== "tokens")
                    .reduce((n, r) => n + r.runs, 0)}
                </td>
                <td style={tdNum}>{fmtCentsUsd(summary.youCents)}</td>
                <td style={tdNum}>{fmtCentsUsd(summary.agentCents)}</td>
                <td style={{ ...tdNum, fontWeight: 700 }}>
                  {fmtCentsUsd(summary.generationCents)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <SectionTitle>by identity</SectionTitle>
        <table style={table} data-testid="by-identity">
          <thead>
            <tr>
              <th style={th}>identity</th>
              <th style={thNum}>tokens</th>
              <th style={thNum}>generation</th>
              <th style={thNum}>total</th>
              <th style={thNum}>runs</th>
            </tr>
          </thead>
          <tbody>
            {identityGroups.human.map((r) => (
              <tr key={r.identity} data-testid="identity-you">
                <td style={td}>
                  you <span style={{ opacity: 0.6 }}>· editor buttons</span>
                </td>
                {/* A person has no token column entry at all — README §12. */}
                <td style={tdNum}>—</td>
                <td style={tdNum}>{fmtCentsUsd(r.generationCents)}</td>
                <td style={{ ...tdNum, fontWeight: 600 }}>{fmtCentsUsd(r.totalCents)}</td>
                <td style={tdNum}>{r.runs}</td>
              </tr>
            ))}
            {identityGroups.agents.map((group) => (
              <Fragment key={group.conversation}>
                <tr data-testid={`identity-agent-${group.conversation}`}>
                  <td style={td}>
                    <span className="mono">agent:{group.conversation}</span>
                    <span style={{ opacity: 0.6 }}> · all specialists</span>
                  </td>
                  <td style={tdNum}>{fmtCentsUsd(group.tokensCents)}</td>
                  <td style={tdNum}>{fmtCentsUsd(group.generationCents)}</td>
                  <td style={{ ...tdNum, fontWeight: 600 }}>{fmtCentsUsd(group.totalCents)}</td>
                  <td style={tdNum}>{group.runs}</td>
                </tr>
                {group.children.map((child) => (
                  <tr key={child.identity} data-testid={`identity-specialist-${child.identity}`}>
                    <td style={{ ...td, paddingLeft: 22, opacity: 0.85 }}>
                      <span className="mono">/{child.specialist ?? "?"}</span>
                      <span style={{ opacity: 0.6 }}>
                        {" "}
                        {specialistLabel(child.specialist ?? "")}
                      </span>
                    </td>
                    <td style={tdNum}>{fmtCentsUsd(child.tokensCents)}</td>
                    <td style={tdNum}>{fmtCentsUsd(child.generationCents)}</td>
                    <td style={tdNum}>{fmtCentsUsd(child.totalCents)}</td>
                    <td style={tdNum}>{child.runs}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>

        <SectionTitle>agent · by conversation</SectionTitle>
        <table style={table} data-testid="by-conversation">
          <tbody>
            {(summary?.byConversation ?? []).map((r) => (
              <tr key={r.session} data-testid={`conversation-${r.session}`}>
                <td style={td}>
                  <span className="mono">{r.session}</span>
                  {running.has(r.session) && (
                    <span style={{ color: "var(--accent)", marginLeft: 8, fontSize: 11 }}>
                      · running
                    </span>
                  )}
                </td>
                <td style={tdNum}>{r.runs}</td>
                <td style={{ ...tdNum, fontWeight: 600 }}>{fmtCentsUsd(r.totalCents)}</td>
              </tr>
            ))}
            {summary?.byConversation.length === 0 && (
              <tr>
                <td style={{ ...td, opacity: 0.6 }}>
                  No agent conversation has spent anything in this project yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {summary && (
          <div style={{ marginTop: 14 }} data-testid="accuracy">
            <SectionTitle>accuracy</SectionTitle>
            <div style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap" }}>
              {Object.entries(summary.accuracyCents).map(([flag, cents]) => (
                <span key={flag} data-testid={`accuracy-${flag}`}>
                  <span className="mono">{flag}</span> <strong>{fmtCentsUsd(cents)}</strong>
                </span>
              ))}
              {summary.unpricedRuns > 0 && (
                <span style={{ color: "var(--warn)" }} data-testid="accuracy-unpriced">
                  {summary.unpricedRuns} unpriced run{summary.unpricedRuns === 1 ? "" : "s"} — a
                  backend billed but canon has no price row
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6, lineHeight: 1.5 }}>
              <strong>measured</strong> = the provider reported the figure (token counts, PixelLab,
              Retro). <strong>estimated</strong> = priced from canon’s table because the provider
              reports none (fal, and the flat list-price backends). Never a silent $0.
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 14, lineHeight: 1.55 }}>
          Every row above is one journal entry, so the tables always reconcile. Estimates that were
          never confirmed are not counted; stopped runs are counted at what they billed.
          {legacyUsd > 0 && (
            <>
              {" "}
              <strong>{fmtUsd(legacyUsd)}</strong> of older spend predates the journal and is
              carried in <span className="mono">spend.jsonl</span> only — not included above.
            </>
          )}
          {genActual != null && (
            <> Last full generation run (manifest stats): {fmtUsd(genActual)}.</>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  cents,
  testId,
}: {
  label: string;
  cents: number | undefined;
  testId: string;
}) {
  return (
    <div style={tile} data-testid={testId}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>
        {cents == null ? "…" : fmtCentsUsd(cents)}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, opacity: 0.7, margin: "14px 0 4px", letterSpacing: 0.2 }}>
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
  width: 680,
  maxWidth: "94vw",
  maxHeight: "88vh",
  overflowY: "auto",
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 22,
  color: "var(--fg)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
const tile: React.CSSProperties = {
  flex: 1,
  padding: "9px 11px",
  borderRadius: 8,
  background: "var(--bg-sunken)",
  border: "1px solid var(--border)",
};
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse" };
const th: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 600,
  opacity: 0.7,
  padding: "4px 8px",
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
};
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "4px 8px", fontSize: 12 };
const tdNum: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
