import { useEffect, useMemo, useRef, useState } from "react";
import { openFromHistory, refreshHistory } from "../../lib/agentActions";
import { useStore } from "../../store";
import { fmtCents } from "../../lib/agentState";
import { digestConversations, type ConversationDigest } from "../../lib/cost";
import { api } from "../../lib/invoke";

/** ⏱ per-project history: past conversations, and what each one
 *  actually did.
 *
 *  A turn count answered the wrong question. What a person reopening a
 *  conversation wants to know is what it COST, what it made, on what, and who
 *  set it going — every one of which the journal already records per event
 *  (`costCents`, `genKind`, `gen.backend` / `gen.model`, `identity`, `ts`). So
 *  the row is now the journal's answer, not the transcript's length.
 *
 *  **One read, one roll-up.** The menu reads the pack journal through the same
 *  `api.journalList` the cost dashboard uses and rolls it up through
 *  `digestConversations`, which is `summarizeJournal`'s by-conversation table
 *  DECORATED — the money on a row here is the identical sum the dashboard
 *  prints, because it is literally the same one. (The decoration is why the
 *  read is unbounded rather than `--summary`: the server roll-up carries the
 *  cents but not the per-call facts — kind, model, last timestamp. When it
 *  carries them, this becomes `{summary: true}` and the local roll-up goes.)
 *
 *  **What earns a place on the row.** The menu is a menu: two lines, no
 *  paragraphs. Line one is the title and the money, because those are what a
 *  reader scans a cost history FOR. Line two is when · what · who — the three
 *  facts that tell two rows apart at a glance. The model is NOT on the row: ids
 *  like `claude-sonnet-4-6` are long enough to force a truncation, and they are
 *  usually the same on every row, so they discriminate nothing while costing
 *  the most width. They live one keystroke away, in the row's disclosure,
 *  beside the full timestamp and the per-kind breakdown.
 *
 *  **Nothing spent is not $0.** Four different facts hide behind an empty
 *  money column, and this row says which: `free` (runs recorded, all of them
 *  zero — a fake or unpaid backend), `unpriced` (a paid backend billed and
 *  canon has no price row — the one case where $0 would be a lie), `~$x est.`
 *  (an open conversation whose spend the panel has counted but the ledger has
 *  not yet recorded), and `—` (nothing recorded at all). None of them is
 *  rendered as a dollar figure.
 *
 *  Those are not exclusive: a conversation can hold free runs AND unpriced
 *  ones. The unpriced count is therefore a `+N?` suffix in warn colour on
 *  whatever the money column says — `$6.25 +1?` and `free +1?` alike — so the
 *  one fact that must never be swallowed is told the same way whether or not
 *  the priced runs summed to something. */
export function SessionHistoryMenu({ onClose }: { onClose: () => void }) {
  const history = useStore((s) => s.agent.history);
  const open = useStore((s) => s.agent.conversations);
  const worldPath = useStore((s) => s.worldPath);
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [digests, setDigests] = useState<Map<string, ConversationDigest>>(() => new Map());
  /** Tri-state, exactly as canon states it: `false` means canon looked and
   *  found no journal file; `null` means nothing said so, which is not the
   *  same claim and must not be rendered as one. */
  const [journalPresent, setJournalPresent] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    void refreshHistory();
    if (!worldPath) return;
    api
      .journalList(worldPath, {})
      .then((r) => {
        if (!live) return;
        setDigests(digestConversations(r.events ?? []));
        setJournalPresent(r.journal?.present ?? r.summary?.journalPresent ?? null);
      })
      // A history menu that cannot read the ledger still lists conversations;
      // it just has no money to show, which the rows already say honestly.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [worldPath]);

  const rows = useMemo(() => [...history].reverse(), [history]);
  const shown = all ? rows : rows.slice(0, 6);

  return (
    <div className="ag-menu" ref={ref} style={{ minWidth: 320 }} data-testid="history-menu">
      <div className="ag-menu-title">history · this project</div>
      {rows.length === 0 && <div className="ag-menu-foot">No conversations yet.</div>}
      {journalPresent === false && rows.length > 0 && (
        <div
          className="ag-menu-foot"
          style={{ color: "var(--warn)" }}
          data-testid="history-nojournal"
        >
          No journal in this project yet — what these cost is unknown, not zero.
        </div>
      )}
      {shown.map((h) => {
        const d = digests.get(h.id);
        const title = open[h.id]?.title ?? h.title ?? h.id;
        const cell = moneyCell(d, open[h.id]?.costCents ?? null);
        const isOpen = expanded === h.id;
        return (
          <div key={h.id} data-testid={`history-row-${h.id}`}>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              <button
                className="ag-menu-row"
                style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }}
                onClick={() => {
                  void openFromHistory(h.id, h.title);
                  onClose();
                }}
              >
                <span style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%" }}>
                  <span style={ellipsis}>{title}</span>
                  <span
                    className="meta"
                    style={{ marginLeft: "auto", color: cell.warn ? "var(--warn)" : undefined }}
                    title={cell.title}
                    data-testid={`history-cost-${h.id}`}
                  >
                    {cell.text}
                  </span>
                </span>
                <span
                  className="meta"
                  style={{ marginLeft: 0, ...ellipsis }}
                  title={d?.lastTs ? exact(d.lastTs) : undefined}
                  data-testid={`history-sub-${h.id}`}
                >
                  {subLine(d, h.created)}
                </span>
              </button>
              <button
                className="ag-menu-row"
                style={toggle}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Hide" : "Show"} details for ${title}`}
                onClick={() => setExpanded(isOpen ? null : h.id)}
              >
                {isOpen ? "▾" : "▸"}
              </button>
            </div>
            {isOpen && <Detail id={h.id} digest={d} created={h.created} />}
          </div>
        );
      })}
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

/** The row's disclosure: everything the two lines could not carry without
 *  turning a menu into a report — the model(s), the exact time, every kind
 *  with its run count, and how the money splits. */
function Detail({
  id,
  digest,
  created,
}: {
  id: string;
  digest: ConversationDigest | undefined;
  created?: string;
}) {
  return (
    <div style={detail} data-testid={`history-detail-${id}`}>
      <Line label="id" value={<span className="mono">{id}</span>} />
      {digest?.lastTs ? (
        <Line label="last activity" value={exact(digest.lastTs)} />
      ) : (
        created && <Line label="started" value={exact(created)} />
      )}
      {digest && digest.kinds.length > 0 && (
        <Line
          label="calls"
          value={digest.kinds.map((k) => `${k.genKind} ×${k.runs}`).join(" · ")}
        />
      )}
      {digest && digest.models.length > 0 && (
        <Line
          label="model"
          value={
            // One pair per line: `backend · model` already contains a
            // separator, so run together on one line they read as one name.
            <span className="mono" style={{ display: "flex", flexDirection: "column" }}>
              {digest.models.map((m) => (
                <span key={`${m.backend}/${m.model}`}>
                  {m.backend || "—"} · {m.model || "—"} ×{m.runs}
                </span>
              ))}
            </span>
          }
        />
      )}
      {digest && digest.runs > 0 && (
        <>
          <Line
            label="who"
            value={`you ${fmtCents(digest.youCents)} · agent ${fmtCents(digest.agentCents)}`}
          />
          <Line
            label="split"
            value={`conversation ${fmtCents(digest.tokensCents)} · generation ${fmtCents(
              digest.generationCents,
            )}`}
          />
        </>
      )}
      {digest && digest.unpriced > 0 && (
        <Line
          label="unpriced"
          value={
            <span style={{ color: "var(--warn)" }}>
              {digest.unpriced} run{digest.unpriced === 1 ? "" : "s"} a backend billed that canon
              has no price row for
            </span>
          }
        />
      )}
      {!digest && (
        <Line label="ledger" value="nothing recorded for this conversation in the journal" />
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "1px 0" }}>
      <span style={{ color: "var(--fg-dim)", minWidth: 78, flex: "none" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** when · what · who — the second line, in that order because that is the
 *  order a reader narrows by. Each part is dropped rather than faked when the
 *  journal has nothing to say about it. */
function subLine(digest: ConversationDigest | undefined, created?: string): string {
  const parts: string[] = [];
  const stamp = when(digest?.lastTs ?? created);
  if (stamp) parts.push(stamp);
  if (digest && digest.kinds.length > 0) {
    const [top, ...rest] = digest.kinds;
    // `genKind` is an open vocabulary — printed verbatim, never mapped through
    // a list of the kinds that happen to exist today.
    parts.push(rest.length ? `${top.genKind} +${rest.length}` : top.genKind);
  }
  const who =
    digest?.byYou && digest?.byAgent
      ? "you + agent"
      : digest?.byAgent
        ? "agent"
        : digest?.byYou
          ? "you"
          : "";
  if (who) parts.push(who);
  return parts.join(" · ");
}

/** What goes in the money column, and why it is not always money.
 *
 *  `live` is the panel's own running estimate for a conversation that is open
 *  right now (`Conversation.costCents` — priced from the picker's rates, which
 *  the ledger later supersedes). It is used ONLY when the ledger has recorded
 *  nothing yet, and is marked `est.` when it is, so the two sources are never
 *  added together or mistaken for each other. */
function moneyCell(
  digest: ConversationDigest | undefined,
  live: number | null,
): { text: string; title: string; warn?: boolean } {
  if (digest && digest.runs > 0) {
    // Whether the priced runs happened to sum to zero changes only the WORD
    // for the money — never whether the unpriced ones are admitted. Those two
    // used to be decided in separate branches, and the zero branch forgot: a
    // conversation holding one free run (fake backend, `costCents: 0`) and one
    // a paid backend billed that canon has no price row for (`cost_error`, so
    // no `costCents` at all) read as a flat "free". Same fact, one place.
    const money = digest.totalCents === 0 ? "free" : fmtCents(digest.totalCents);
    const counted =
      digest.totalCents === 0
        ? `${digest.runs} run${digest.runs === 1 ? "" : "s"} recorded, none of which cost anything`
        : `${digest.runs} costed run${digest.runs === 1 ? "" : "s"} in the journal`;
    if (digest.unpriced === 0) return { text: money, title: counted };
    return {
      text: `${money} +${digest.unpriced}?`,
      title: `${counted}, plus ${digest.unpriced} a backend billed that canon could not price`,
      warn: true,
    };
  }
  if (digest && digest.unpriced > 0) {
    return {
      text: "unpriced",
      title: `${digest.unpriced} run${digest.unpriced === 1 ? "" : "s"} a paid backend billed that canon has no price row for — not $0`,
      warn: true,
    };
  }
  if (live != null && live > 0) {
    return {
      text: `~${fmtCents(live)} est.`,
      title: "the panel's live estimate for an open conversation — not yet in the ledger",
    };
  }
  return { text: "—", title: "nothing recorded for this conversation in the journal" };
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

/** The full local timestamp — the relative day is for scanning, this is for
 *  the one moment you need to know exactly when something ran. */
function exact(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const toggle: React.CSSProperties = {
  width: "auto",
  flex: "none",
  padding: "6px 6px",
  color: "var(--fg-dim)",
  fontSize: 10,
};
const detail: React.CSSProperties = {
  padding: "2px 10px 8px 16px",
  fontSize: 11,
  lineHeight: 1.5,
};
