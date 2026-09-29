import { useStore } from "../store";
import {
  api,
  type Job,
  type JobProgress,
  type JobProgressEvent,
  type JobStatus,
  type OpCost,
  type PhaseProgress,
} from "./invoke";
import { recordJob, recordSpend } from "./cost";
import { currentCreate, noteCreateProgress, settleCreate } from "../components/agent/startCreate";
import {
  CREATE_STEP,
  creatingConversation,
  markPlanStep,
  settleTurn,
} from "../components/agent/startConversation";

/** `identity` from an actor string — canon's `provenance.identity_for` on the
 *  cradle side (row P1-A6): an `agent:…` actor passes through, everything else
 *  (absent, `cradle:user`, `user`) is a person. */
function identityOf(actor: string | undefined): string {
  return actor?.startsWith("agent:") ? actor : "user";
}

/** The conversation id inside an agent actor, or `undefined` for the editor
 *  door — an editor-button run has no conversation, and inventing one would
 *  put button spend in an agent lane. */
function conversationOf(actor: string | undefined): string | undefined {
  if (!actor?.startsWith("agent:")) return undefined;
  return actor.slice("agent:".length).split("/")[0] || undefined;
}

/** Metadata for a new job — everything except the fields enqueueJob fills in. */
export type JobMeta = Omit<Job, "id" | "status" | "ts">;

/** Payload of a Rust `job-updated` event: only {id, status, result?/error?} —
 *  the frontend holds the rest of the job metadata (keyed by id). */
export type JobEventPayload = {
  id: string;
  status: string; // queued | running | done | failed
  result?: Record<string, unknown>;
  error?: string;
};

/** The raw `job-updated` status, in the vocabulary everything downstream reads.
 *
 *  The worker says `done`; the store, the ledgers and `settleCreate` all speak
 *  ok / no_change / cancelled / failed. One mapping, so the two readers below
 *  can never disagree about whether a run ended or how. `null` = not terminal
 *  (a queued echo, a `running` heartbeat).
 *
 *  Returns a `JobStatus`, which is deliberately a plain string here (see
 *  `JOB_STATUSES`, the DATA behind labels and ordering): an unknown status
 *  renders as itself rather than being narrowed away by a union. */
function terminalStatus(status: string, result?: Record<string, unknown>): JobStatus | null {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "done") return result?.changed ? "ok" : "no_change";
  return null;
}

/** The start-page create's own fold: its terminal settle, and the plan step
 *  that approved it.
 *
 *  **Why it lives inside `handleJobEvent`, above the tray guard.** This is the
 *  one job whose lifecycle outlives the surface that launched it. Its card
 *  mounts only on the start page, so opening the finished project unmounts it
 *  — and the "cradle" breadcrumb calls `closeWorld`, which empties the job
 *  tray (jobs are PER PACK, and a create is not about the pack that was open).
 *  While the settle was driven by that card's effect, a create the user
 *  navigated away from ran to completion on the Rust JobQueue and wrote no
 *  spend and no job ledger at all: real money, unrecorded. Anchored any later
 *  in this function it would still be dead, because the `!job` guard below
 *  returns first once the tray has been emptied.
 *
 *  It is deliberately NOT a second listener and NOT a tray row: parking a
 *  foreign job in whichever pack happens to be open would file the create's
 *  run under someone else's project. The create's own module holds it, and
 *  both ledgers land in the pack the run created.
 *
 *  Being event-driven, it can only settle a create that events reach. Two
 *  places make sure they do: `beginCreate` assigns `jobId` inside the enqueue
 *  callback (so the create is addressable before anything can report), and
 *  `enqueueJob` folds an enqueue failure through `handleJobEvent` (so the one
 *  ending that produces no worker event still arrives here). */
async function foldStartCreate(
  payload: JobEventPayload,
  terminal: JobStatus | null,
): Promise<void> {
  if (!terminal) return;
  const create = currentCreate();
  // The job's enqueue time while the tray still holds the row, and the
  // create's own `startedAt` (set in the same breath as the enqueue) once it
  // does not — so the ledger keeps a duration across the detach too.
  const enqueued = useStore.getState().jobs.find((j) => j.id === payload.id)?.ts;
  await settleCreate({
    id: payload.id,
    status: terminal,
    error: payload.error,
    result: payload.result,
    ts: enqueued ?? create.startedAt,
    endedAt: Date.now(),
    label: create.name,
  });

  // …and the plan card that approved it hears the same outcome, so its step
  // ticks off (or fails) instead of sitting at "0 of 2" forever. This used to
  // be a second effect on the run card and moved here for the same reason the
  // settle did: it has to happen whether or not the panel is mounted.
  //
  // When the conversation itself is gone — `closeWorld` resets the whole agent
  // slice — `agentDispatch` finds no conversation and returns without changing
  // anything. That silent no-op is the right answer and not an oversight:
  // there is no plan card left to tick, and the create's own status (which the
  // card below renders) is the surviving record of the outcome.
  const conv = creatingConversation();
  if (!conv) return;
  const settledCreate = currentCreate();
  if (settledCreate.status === "done") markPlanStep(conv, CREATE_STEP, "done");
  else if (settledCreate.status === "failed")
    markPlanStep(conv, CREATE_STEP, "failed", { error: settledCreate.error ?? undefined });
  else if (settledCreate.status === "stopped")
    markPlanStep(conv, CREATE_STEP, "failed", {
      error: "stopped by you — the folder and everything already written are kept",
    });
  else return;
  // Whatever the outcome, the turn is over: nothing is running any more.
  settleTurn(conv);
}

/** The single place that processes a background-job lifecycle event. Wired to
 *  the Rust `job-updated` listener in App (native) AND driven directly by the
 *  browser dev-mock (which has no event bus). Settles the start-page create
 *  (see `foldStartCreate` — that one runs with or without a tray row), folds
 *  the event into the store, then on completion records the durable ledgers,
 *  broadcasts a completion signal (open detail views refresh), refreshes the
 *  affected nav list, and opens a freshly generated level. Uses getState() so
 *  it never goes stale. */
export async function handleJobEvent(payload: JobEventPayload): Promise<void> {
  const { id, status, result, error } = payload;
  const terminal = terminalStatus(status, result);

  // ABOVE the `!job` guard, on purpose — see `foldStartCreate`.
  if (currentCreate().jobId === id) await foldStartCreate(payload, terminal);

  const store = useStore.getState();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return; // an event for a job this session didn't enqueue — ignore

  if (status === "running") {
    store.updateJob(id, { status: "running" });
    return;
  }
  if (!terminal) return; // queued echo, etc.

  const now = Date.now();
  if (terminal === "failed") {
    store.updateJob(id, { status: "failed", error: error ?? "failed", endedAt: now });
  } else if (terminal === "cancelled") {
    // ⏹ (row A4.5's contract, rendered by A5): nothing new started, what
    // landed is kept (`result.kept`), and what it billed is reported by the
    // worker — never inferred here.
    store.updateJob(id, {
      status: "cancelled",
      changed: Array.isArray(result?.kept) ? (result!.kept as unknown[]).length > 0 : false,
      cost: result?.cost as OpCost | undefined,
      result,
      endedAt: now,
    });
  } else {
    const changed = terminal === "ok";
    const resolvedTarget = (result?.level_id as string) || (result?.id as string) || job.target;
    store.updateJob(id, {
      status: terminal,
      changed,
      cost: result?.cost as OpCost | undefined,
      result,
      endedAt: now,
      target: resolvedTarget,
    });
  }

  const j = useStore.getState().jobs.find((x) => x.id === id);
  if (!j) return;
  // Everything below is about the OPEN world: its ledgers, its nav lists, its
  // detail views. A job with no `targetType` isn't about an entity in it — the
  // only one today is "create a new project", whose ledgers belong to the pack
  // it just made and whose caller is the one holding that path. Writing them
  // here would file the new project's spend under whatever was open.
  if (!j.targetType) return;
  const worldPath = store.worldPath;

  // Durable ledgers (best-effort — a write failure never surfaces as a job fail).
  //
  // Row P1-A6: the spend ledger is now a DERIVED compat index — the canon verb
  // journals the money, and the cost dashboard sums the journal. These rows
  // carry the lane fields and NO `journal_ref`, which is exactly right for the
  // one op that still journals no cost (project creation): a row without a
  // `journal_ref` is the only kind a reconciler adds to the journal total, so
  // nothing is double-counted and nothing is lost. A cancelled job writes one
  // too (it billed something); a failed one does not.
  if (j.status !== "failed") {
    const levelId = j.targetType === "levels" ? j.target : undefined;
    await recordSpend(worldPath, {
      op: j.op,
      scope: j.scope,
      level_id: levelId,
      backends: j.backends,
      estimate: j.estimate,
      actual_usd: j.cost?.usd ?? (typeof result?.billed_usd === "number" ? result.billed_usd : 0),
      tokens: j.cost
        ? { input: j.cost.input_tokens, output: j.cost.output_tokens, calls: j.cost.calls }
        : undefined,
      actor: j.actor,
      identity: identityOf(j.actor),
      session: conversationOf(j.actor),
      category: "generation",
      // P.8.7's do-not-double-count mark. The canon verb now journals the
      // money itself and hands back the ts of that event; a row carrying it
      // is ALREADY in the journal total, and only rows WITHOUT one (the
      // create run, pre-A6 history) are added to it. Never inferred here —
      // absent means canon journalled no cost for this op.
      journal_ref: typeof result?.journal_ref === "string" ? result.journal_ref : undefined,
    });
  }
  await recordJob(worldPath, {
    job_id: j.id,
    op: j.op,
    scope: j.scope,
    target: j.target,
    target_type: j.targetType,
    status: j.status,
    backends: j.backends,
    estimate: j.estimate,
    actual_usd: j.cost?.usd ?? 0,
    duration_ms: j.endedAt && j.ts ? j.endedAt - j.ts : undefined,
    changed: j.changed,
    changed_artifacts: (result?.changed_artifacts as string[]) ?? undefined,
    error: j.error,
    // Row P1-A6 (ASSUMPTION-8): the lane fields, so a run from a past session
    // keeps its attribution in the tray. `identity` is the read-time form of
    // the launching actor — `agent:<conversation>/<specialist>` for an agent
    // run, `user` for an editor button (canon's `provenance.identity_for`).
    identity: identityOf(j.actor),
    session: conversationOf(j.actor),
  });

  // Broadcast completion so an open LevelDetail / EntityOverview can refresh.
  store.setLastCompletedJob({
    id: j.id,
    op: j.op,
    target: j.target,
    targetType: j.targetType,
    status: j.status as "ok" | "no_change" | "failed" | "cancelled",
    changed: !!j.changed,
    ts: now,
  });

  // Refresh the affected nav list so new/updated entities appear.
  if (worldPath && j.targetType) {
    try {
      store.setEntities(j.targetType, await api.listEntities(worldPath, j.targetType));
    } catch {
      /* nav refresh is best-effort */
    }
  }
  // A freshly generated level opens (matches the old synchronous UX).
  if (j.status !== "failed" && j.op === "generate" && result?.level_id) {
    store.select({ kind: "entity", typeId: "levels", id: String(result.level_id) });
  }
}

/** Fold one raw canon step-log event into its job's live progress.
 *
 *  The counterpart to `handleJobEvent`: that one owns the job's LIFECYCLE
 *  (queued → running → done), this one owns its POSITION inside the run. Same
 *  wiring on both surfaces — a Rust listener in App, the dev-mock directly.
 *
 *  Deliberately additive and order-tolerant: canon may add events, and a
 *  `node_item` can arrive for a phase whose `node_start` we somehow missed
 *  (a truncated read, a resumed run), so an unknown node opens a row rather
 *  than being dropped.
 *
 *  Anchored the same way as `foldStartCreate`: the start-page create's
 *  POSITION has to survive its tray row going away too, or a user who comes
 *  back to a run still in flight is shown "Starting canon…" for a run that is
 *  half done. So the fold runs for the create with or without a row, and its
 *  result is mirrored into the create's own module. Every other job still
 *  needs a row — the tray is per pack, and nothing parks a foreign job in it. */
export function handleJobProgress(payload: JobProgressEvent): void {
  const store = useStore.getState();
  const job = store.jobs.find((j) => j.id === payload.id);
  const isCreate = currentCreate().jobId === payload.id;
  if (!job && !isCreate) return;

  const prev: JobProgress = job?.progress ?? currentCreate().progress ?? { phases: [] };
  const phases = [...prev.phases];
  const ts = payload.ts ? Date.parse(payload.ts) || undefined : undefined;
  const next: JobProgress = { ...prev, phases, startedAt: prev.startedAt ?? ts };

  const at = (node: string): number => {
    const i = phases.findIndex((p) => p.node === node);
    if (i >= 0) return i;
    phases.push({ node, status: "running" });
    return phases.length - 1;
  };
  const patch = (node: string, p: Partial<PhaseProgress>) => {
    const i = at(node);
    phases[i] = { ...phases[i], ...p };
  };

  switch (payload.event) {
    case "run_start": {
      // Two schedulers, two names for the same number (`phases` sequential,
      // `nodes` orchestrated) — reading only one left every orchestrated
      // create with no denominator, so the bar sat idle at "counting steps…"
      // for the whole run.
      const reported = payload.phases ?? payload.nodes;
      // A fresh platformer create is TWO passes (bootstrap, then the full
      // graph): the bigger segment is the run's real size, and the smaller
      // one must not shrink a total already reported.
      if (reported != null) next.total = Math.max(reported, next.total ?? 0);
      // …and the earlier segment's `run_end` was NOT the end of the run.
      // `endedAt` drives "Finishing up…", the frozen clock and the removal of
      // ⏹ Stop, so a new segment un-ends the run; the job's own terminal
      // `job-updated` is the only real end.
      next.endedAt = undefined;
      next.ok = undefined;
      break;
    }
    case "node_start":
      if (payload.node) patch(payload.node, { status: "running" });
      break;
    case "node_item":
      // The sub-phase heartbeat. Clearing nothing else: a phase that reports
      // items is still "running" — this only renames what it is waiting on.
      if (payload.node) {
        patch(payload.node, {
          status: "running",
          item: payload.item,
          index: payload.index,
          itemTotal: payload.total,
        });
      }
      break;
    case "node_done":
      // Drop the item: a finished phase should read as the phase, not as
      // whichever sprite happened to be last.
      if (payload.node) patch(payload.node, { status: "done", item: undefined });
      break;
    case "node_failed":
      if (payload.node) patch(payload.node, { status: "failed" });
      break;
    case "node_skipped":
      // A node THIS run already finished is not "unchanged": the orchestrator
      // re-reports pass 1's macro nodes as skipped when pass 2 starts, and
      // downgrading them made a fresh create claim six phases were reused.
      if (payload.node && phases[at(payload.node)].status !== "done") {
        patch(payload.node, { status: "skipped", item: payload.reason });
      }
      break;
    case "run_end":
      next.endedAt = ts;
      next.ok = payload.ok;
      break;
    default:
      return; // an event this version doesn't model — no state change
  }
  // Both readers get the same folded object: the tray row while it exists, and
  // the create's module, which is what is left after `closeWorld`.
  if (isCreate) noteCreateProgress(payload.id, next);
  if (job) store.updateJob(payload.id, { progress: next });
}

function newJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Enqueue a background generation job: create the in-memory "queued" job, fire
 *  the (jobId-aware) invoke thunk, and return the id immediately — the UI never
 *  blocks. The Rust worker drives it running → done/failed via `job-updated`
 *  events, which App.tsx's global listener folds back into the store (updating
 *  the tray, recording the durable ledgers, and broadcasting completion so open
 *  detail views refresh). A failure to even enqueue marks the job failed and is
 *  then folded through that same listener path, because no worker event is ever
 *  coming for a job the queue never accepted. */
export async function enqueueJob(
  meta: JobMeta,
  fire: (jobId: string) => Promise<unknown>,
): Promise<string> {
  const id = newJobId();
  const store = useStore.getState();
  store.addJob({ ...meta, id, status: "queued", ts: Date.now() });
  try {
    await fire(id);
  } catch (e) {
    // The tray row goes red at once…
    store.updateJob(id, { status: "failed", error: String(e), endedAt: Date.now() });
    // …and the failure then takes the SAME lifecycle path every worker event
    // takes, because it is the only one anything downstream listens to. The
    // queue never accepted this job, so no `job-updated` is ever coming for
    // it: a fold that only ran on inbound events would leave the start-page
    // create (settled at the top of `handleJobEvent`) reading "creating"
    // forever, under a ⏹ for a run that does not exist. `void`, matching the
    // app's own listener — a lifecycle fold never blocks the enqueuing caller.
    void handleJobEvent({ id, status: "failed", error: String(e) });
  }
  return id;
}
