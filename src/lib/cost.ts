import { isAgentActor, parseActor } from "./actor";
import {
  api,
  type JobEntry,
  type JournalConversationRow,
  type JournalEvent,
  type JournalIdentityRow,
  type JournalKindRow,
  type JournalSummary,
  type SpendEntry,
  type Usd,
} from "./invoke";

/** Money for humans: sub-cent shows 4dp, cents 3dp, dollars 2dp; exact $0 stays "$0". */
export function fmtUsd(n: number | undefined): string {
  if (!n) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** A best–worst forecast as a range ("$0.07–$0.30"), collapsing to one figure
 *  when best == worst and to "$0" when a backend is unpaid. */
export function fmtRange(u: Usd | undefined): string {
  if (!u) return "—";
  if (!u.best && !u.worst) return "$0";
  if (Math.abs(u.best - u.worst) < 1e-9) return fmtUsd(u.best);
  return `${fmtUsd(u.best)}–${fmtUsd(u.worst)}`;
}

/** Record a paid op's actual spend — best-effort: a ledger-write failure must
 *  never surface as if the generation itself failed (the op already ran). */
export async function recordSpend(worldPath: string, entry: SpendEntry): Promise<void> {
  try {
    await api.spendRecord(worldPath, entry);
  } catch (e) {
    console.warn("spend record failed (op still succeeded)", e);
  }
}

/** Record a finished background job to the durable ledger — best-effort, same
 *  as recordSpend: a ledger-write failure never surfaces as a job failure. */
export async function recordJob(worldPath: string, entry: JobEntry): Promise<void> {
  try {
    await api.jobRecord(worldPath, entry);
  } catch (e) {
    console.warn("job record failed (job still ran)", e);
  }
}

// ---------------------------------------------------------------------------
// Row P1-A6 — money in CENTS, because the journal counts in cents
// ---------------------------------------------------------------------------

/** Integer cents for humans. The journal's `costCents` is the ONE field every
 *  dashboard figure sums (P0 paper P.8.2), so it is formatted, never re-derived
 *  from dollars — no float ever re-enters the arithmetic. */
export function fmtCentsUsd(cents: number | undefined | null): string {
  if (!cents) return "$0";
  return `$${(cents / 100).toFixed(2)}`;
}

/** A cell that should read "—" rather than "$0" when the row has no entry in
 *  that column at all — human rows have no token entry (README §12), which is
 *  different from an agent that spent nothing on tokens. */
export function fmtCentsCell(cents: number | undefined | null): string {
  return cents == null ? "—" : fmtCentsUsd(cents);
}

/** An `identity` read back into its parts.
 *
 *  `identity` and `actor` share one grammar — canon derives the first from the
 *  second (`provenance.identity_for`) — so this goes through I6's ONE parser
 *  (`lib/actor.parseActor`) rather than spelling the prefix a second time. */
export function parseIdentity(identity: string | undefined): {
  isAgent: boolean;
  conversation: string | null;
  specialist: string | null;
} {
  const ref = parseActor(identity ?? "");
  return {
    isAgent: ref.kind === "agent",
    conversation: ref.conversation,
    specialist: ref.specialist,
  };
}

/** The identity a journal event carries, deriving it from `actor` for pre-A6
 *  rows exactly as canon's read side does (P.8.7). */
export function identityOf(event: { identity?: string; actor?: string }): string {
  if (event.identity) return event.identity;
  return isAgentActor(event.actor ?? "") ? (event.actor as string) : "user";
}

/** Roll journal events up exactly the way `canon journal list --summary` does.
 *
 *  Canon computes this server-side; this is the SAME arithmetic for the browser
 *  dev-mock (I7 parity) and as the fallback when only events came back. Every
 *  figure sums `costCents` over the same list, which is what makes the tiles,
 *  the split bar and the three tables reconcile by construction — there is only
 *  one number to disagree about. Events without `costCents` are counted
 *  nowhere; events carrying `detail.cost_error` are reported as `unpricedRuns`
 *  so the gap is visible instead of silently $0. */
export function summarizeJournal(events: JournalEvent[], today?: string): JournalSummary {
  const day = today ?? new Date().toISOString().slice(0, 10);
  const kinds = new Map<string, JournalKindRow & { pairs: Map<string, number> }>();
  const identities = new Map<string, JournalIdentityRow>();
  const conversations = new Map<string, JournalConversationRow>();
  const accuracyCents: Record<string, number> = {};
  let totalCents = 0;
  let generationCents = 0;
  let tokensCents = 0;
  let todayCents = 0;
  let youCents = 0;
  let agentCents = 0;
  let costedEvents = 0;
  let unpricedRuns = 0;

  for (const e of events) {
    if (e.detail && typeof e.detail.cost_error === "string") unpricedRuns += 1;
    const cents = typeof e.costCents === "number" ? e.costCents : null;
    if (cents == null) continue;
    costedEvents += 1;
    const identity = identityOf(e);
    const { isAgent, conversation, specialist } = parseIdentity(identity);
    const kind = e.genKind || "";
    const isTokens = kind === "tokens";
    const gen = (e.gen ?? {}) as Record<string, unknown>;

    totalCents += cents;
    if (isTokens) tokensCents += cents;
    else {
      generationCents += cents;
      if (isAgent) agentCents += cents;
      else youCents += cents;
    }
    if ((e.ts ?? "").slice(0, 10) === day) todayCents += cents;
    if (e.accuracy) accuracyCents[e.accuracy] = (accuracyCents[e.accuracy] ?? 0) + cents;

    const kindKey = kind || "unknown";
    let row = kinds.get(kindKey);
    if (!row) {
      row = {
        genKind: kindKey,
        runs: 0,
        youCents: 0,
        agentCents: 0,
        totalCents: 0,
        backend: "",
        model: "",
        variants: 0,
        pairs: new Map(),
      };
      kinds.set(kindKey, row);
    }
    row.runs += 1;
    row.totalCents += cents;
    if (isAgent) row.agentCents += cents;
    else row.youCents += cents;
    const pair = `${String(gen.backend ?? "")}·${String(gen.model ?? "")}`;
    row.pairs.set(pair, (row.pairs.get(pair) ?? 0) + 1);

    let who = identities.get(identity);
    if (!who) {
      who = {
        identity,
        kind: isAgent ? "agent" : "user",
        conversation,
        specialist,
        tokensCents: 0,
        generationCents: 0,
        totalCents: 0,
        runs: 0,
      };
      identities.set(identity, who);
    }
    who.runs += 1;
    who.totalCents += cents;
    if (isTokens) who.tokensCents += cents;
    else who.generationCents += cents;

    const session = e.session || conversation;
    if (session) {
      let conv = conversations.get(session);
      if (!conv) {
        conv = { session, tokensCents: 0, generationCents: 0, totalCents: 0, runs: 0 };
        conversations.set(session, conv);
      }
      conv.runs += 1;
      conv.totalCents += cents;
      if (isTokens) conv.tokensCents += cents;
      else conv.generationCents += cents;
    }
  }

  const byKind: JournalKindRow[] = [...kinds.values()]
    .sort((a, b) => b.totalCents - a.totalCents || a.genKind.localeCompare(b.genKind))
    .map(({ pairs, ...row }) => {
      const sorted = [...pairs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const [backend, model] = (sorted[0]?.[0] ?? "·").split("·");
      return { ...row, backend, model, variants: Math.max(0, sorted.length - 1) };
    });

  return {
    totalCents,
    generationCents,
    tokensCents,
    todayCents,
    youCents,
    agentCents,
    costedEvents,
    eventCount: events.length,
    unpricedRuns,
    accuracyCents,
    byKind,
    byIdentity: [...identities.values()].sort(
      (a, b) => b.totalCents - a.totalCents || a.identity.localeCompare(b.identity),
    ),
    byConversation: [...conversations.values()].sort(
      (a, b) => b.totalCents - a.totalCents || a.session.localeCompare(b.session),
    ),
    today: day,
  };
}
