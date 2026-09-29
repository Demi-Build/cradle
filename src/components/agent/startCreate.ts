import { useSyncExternalStore } from "react";
import { useStore } from "../../store";
import { api, type JobProgress } from "../../lib/invoke";
import { enqueueJob } from "../../lib/jobs";
import { cancelJob } from "../../lib/agentActions";
import { isFreeSelection } from "./confirmGateState";
import { recordJob, recordSpend } from "../../lib/cost";
import type { PackTemplate } from "../../lib/packTemplates";

/** The one create a start-page conversation has in flight (row P1-A9;
 *  agent-panel README §11 "While creating, the recents rail shows a live
 *  project card and the status bar mirrors it").
 *
 *  **One create pipeline, not a second.** `begin` does exactly what
 *  `NewProjectModal.create` does — `enqueueJob` → the Rust `new_project`
 *  command → `canon world new` on the JobQueue worker, with the StepLog
 *  relayed back as `job-progress` and folded by `handleJobProgress` into the
 *  job's `progress`, which `CreateProgress` renders. The panel, the recents
 *  rail and the status bar all read THIS module, and the progress they show is
 *  the job's own. Nothing here creates anything itself.
 *
 *  It lives beside the panel rather than in the store because it is a
 *  start-page-only, single-slot fact with three readers, and an external store
 *  keeps the Zustand slices (owned by other rows) untouched. `useStartCreate`
 *  is the subscription; `packDirOf` is what the recents rail keys on.
 */
export type StartCreateStatus = "idle" | "creating" | "done" | "stopped" | "failed";

export type StartCreate = {
  status: StartCreateStatus;
  /** The JobQueue job — the id every ⏹ and every progress event uses. */
  jobId: string | null;
  /** The project's display name, and where it is being written. */
  name: string;
  template: string;
  packDir: string;
  startedAt: number;
  backends: Record<string, string>;
  /** The confirmed estimate in USD, or null for a $0 selection. */
  estimateUsd: { best: number; worst: number } | null;
  error: string | null;
  /** A stopped run's honest ledger (A4.5's cancel contract, as the worker
   *  reported it): what landed. The worker's cancel payload is
   *  `{cancelled, kept, exit_code, clean, error}` (`src-tauri/src/lib.rs`), so
   *  what never STARTED is not in it — `CreateRunCard` counts that from the
   *  job's own progress rather than from a key nothing sends. */
  kept: string[];
  /** What the settle could not do honestly — today, one line: the run's
   *  money was unmeasured (no `generation_stats.json`), so its ledger rows
   *  carry no `actual_usd`. Never folded into `error`: a finished create
   *  whose cost is unknown is not a failed create. */
  warnings: string[];
  /** The run's last folded position, mirrored here by `handleJobProgress`.
   *
   *  The job tray is PER PACK: `closeWorld` empties it, and a create started
   *  on the start page is not about the pack that was open. So the job row
   *  the progress used to live on can vanish mid-run while the run itself
   *  carries on — the Rust JobQueue does not care which surface is mounted.
   *  Keeping the fold here as well is what lets the card show the real phase
   *  and a real clock after the user has been away, instead of reverting to
   *  "Starting canon…" with a clock that ticks forever. */
  progress: JobProgress | null;
};

const IDLE: StartCreate = {
  status: "idle",
  jobId: null,
  name: "",
  template: "",
  packDir: "",
  startedAt: 0,
  backends: {},
  estimateUsd: null,
  error: null,
  kept: [],
  warnings: [],
  progress: null,
};

let state: StartCreate = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<StartCreate>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(): StartCreate {
  return state;
}

/** The live create, or the idle record. Re-renders on every change. */
export function useStartCreate(): StartCreate {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Read it outside React (the conversation driver). */
export function currentCreate(): StartCreate {
  return state;
}

/** Mirror the run's folded position here, from the ONE fold that already owns
 *  it (`handleJobProgress`). Ignored unless it is this create's job, so a
 *  concurrent editor job can never repaint the create card.
 *
 *  This is a copy of the tray row's `progress`, not a second fold: while the
 *  row exists both hold the same object, and the point of the copy is that it
 *  outlives the row. */
export function noteCreateProgress(jobId: string, progress: JobProgress): void {
  if (state.jobId !== jobId) return;
  set({ progress });
}

/** Tests and "start over" — never called by the UI mid-run. */
export function resetStartCreate(): void {
  state = IDLE;
  settled = null;
  for (const fn of listeners) fn();
}

export type CreateParams = {
  name: string;
  template: PackTemplate;
  counts: Record<string, number>;
  backends: { llm: string; image: string; music: string; sfx: string; vlm: string };
  seed?: string;
  model?: string;
  estimateUsd?: { best: number; worst: number } | null;
};

/** Is this selection paid at all? Asked of the editor's OWN $0 vocabulary
 *  (`confirmGateState.isFreeSelection` — the set every paid button already
 *  shares), which is why the start page's $0 path never raises the spend card
 *  and a paid one always does (doctrine 3 / master §8 A-5). */
export function isPaidSelection(b: Record<string, string>): boolean {
  return !isFreeSelection(b);
}

/** Start the create on the JobQueue and return its job id.
 *
 *  The folder is written to disk before anything is spent — that is canon's
 *  doing, not ours: `canon world new` resolves and creates the output
 *  directory before the runner starts, which is what makes the start page's
 *  footnote ("you can stop at any step and keep what exists") true.
 */
export async function beginCreate(params: CreateParams): Promise<string> {
  const { name, template, counts, backends } = params;
  set({
    ...IDLE,
    status: "creating",
    name,
    template: template.id,
    startedAt: Date.now(),
    backends,
    estimateUsd: params.estimateUsd ?? null,
  });
  let dir = "";
  const jobId = await enqueueJob(
    {
      op: "world",
      label: name,
      target: name,
      // No `targetType`: this job is not about an entity in the OPEN world, so
      // `handleJobEvent` deliberately sits out its ledgers — they belong to
      // the pack this run creates, and `settle` below writes them there.
      targetType: "",
      scope: "world",
      backends,
      estimate: params.estimateUsd ?? undefined,
    },
    async (id) => {
      // Addressable from its FIRST breath. `handleJobEvent` recognises the
      // create by `jobId` and nothing else, so anything terminal that happens
      // before this callback returns — a rejected enqueue, or a worker that
      // reports the run finished before the invoke's reply reaches the webview
      // — would never find the create if the id were only assigned after
      // `enqueueJob` resolved. Assigned here rather than there because this is
      // the first moment the id exists.
      set({ jobId: id });
      const ack = await api.newProject(null, name, {
        template: template.id,
        counts,
        seed: params.seed?.trim() || undefined,
        model: params.model?.trim() || undefined,
        llmBackend: backends.llm,
        imageBackend: backends.image,
        musicBackend: backends.music,
        sfxBackend: backends.sfx,
        vlmBackend: backends.vlm,
        jobId: id,
      });
      // Auto-uniquify happens Rust-side, so the ack is the only place that
      // knows where the run is actually writing.
      dir = ack.pack_dir;
      return ack;
    },
  );
  // Only the folder is news by now: the id was assigned inside the callback,
  // and a create that failed to enqueue has already settled — this patch must
  // not resurrect it, which is why it no longer re-sets `status` or `jobId`.
  set({ packDir: dir });
  return jobId;
}

/** ⏹ — A4.5's cancel contract, unchanged: start nothing new, keep what
 *  landed, say what it cost. The worker answers with `job-updated
 *  {status:"cancelled", result:{kept}}` (read from the run's own step log),
 *  which `settle` folds in; nothing about what was kept is inferred here.
 *
 *  The cancel goes to the JobQueue by id, which is why it still works after
 *  the create has lost its tray row (`closeWorld` empties the per-pack tray
 *  while the run continues): `cancelJob` no longer requires a row. */
export async function stopCreate(): Promise<void> {
  if (!state.jobId) return;
  await cancelJob(state.jobId);
}

/** Fold the job's terminal status in, write the created pack's own ledgers,
 *  and — on success — OPEN the world (the day-1-editing rule: P0-6/8/9 landed,
 *  so a fresh project opens editable).
 *
 *  Driven by the job's status rather than an await, because the run outlives
 *  the call that started it. Idempotent: the ledgers are appends, so a second
 *  invocation for the same job is refused rather than billed twice.
 *
 *  Called from ONE place: the top of `handleJobEvent`, the single path that
 *  already owns job lifecycle. It used to be driven by `CreateRunCard`'s
 *  effect, and that card mounts only on the start page — so a create the user
 *  navigated away from (opening the project, or the "cradle" breadcrumb, which
 *  empties the job tray) reached its end with nobody left to write these
 *  ledgers. Nothing may settle a create from a component again.
 */
let settled: string | null = null;

/** What a create's run really cost, or an honest "unmeasured".
 *
 *  `actual_usd` is absent — not 0 — when nothing measured it. The two are
 *  different facts: a fake run measures a real $0, a run that never reached
 *  its manifest phase (stopped, crashed) measured nothing, and a ledger row
 *  that says `0` for the second reads as the first. */
export type CreateMoney = { actual_usd?: number; warning?: string };

/** The ONE reader every create settle (the wizard, the start-page
 *  conversation) takes its actual from, in order:
 *
 *  1. the create verb's own figure — `world new` reports `actual_usd` on its
 *     result, read from the tree's `generation_stats.json` through canon's
 *     one stats reader, so a landed run needs no second read of the tree;
 *  2. that same standalone `generation_stats.json`, off disk — the path canon
 *     declares canonical, and the ONLY stats record a platformer writes. This
 *     is the leg a stopped or failed run takes: the worker builds those
 *     payloads from the step log, not from canon's document;
 *  3. the dungeon manifest's embedded copy of the same block, as a fallback
 *     only. It used to be the sole source, which is how a $2.60 platformer
 *     create recorded as $0: the platformer embeds nothing.
 *
 *  Reads through the existing `read_world_json` command (`data.rs` resolves
 *  both pack layouts); a name that is not on disk rejects and falls through. */
export async function measuredCreateCost(
  dir: string,
  result?: Record<string, unknown>,
): Promise<CreateMoney> {
  if (typeof result?.actual_usd === "number") return { actual_usd: result.actual_usd };
  try {
    const stats = (await api.readWorldJson(dir, "generation_stats")) as {
      total_cost_usd?: unknown;
    } | null;
    if (typeof stats?.total_cost_usd === "number") return { actual_usd: stats.total_cost_usd };
  } catch {
    /* no standalone file — the embedded block may still exist */
  }
  try {
    const mf = (await api.readWorldJson(dir, "manifest")) as {
      generation_stats?: { total_cost_usd?: unknown };
    } | null;
    const embedded = mf?.generation_stats?.total_cost_usd;
    if (typeof embedded === "number") return { actual_usd: embedded };
  } catch {
    /* no manifest either */
  }
  return {
    warning: `no generation_stats.json under ${dir}: the run's cost is unmeasured (not $0), so its ledger rows carry no actual_usd`,
  };
}

export async function settleCreate(job: {
  id: string;
  status: string;
  error?: string;
  result?: Record<string, unknown>;
  ts?: number;
  endedAt?: number;
  label?: string;
}): Promise<void> {
  if (state.jobId !== job.id) return;
  const failed = job.status === "failed";
  const stopped = job.status === "cancelled";
  if (!failed && !stopped && job.status !== "ok" && job.status !== "no_change") return;
  const kept = Array.isArray(job.result?.kept) ? (job.result!.kept as string[]).map(String) : [];
  // The outcome first — the ledgers below are best-effort appends and must
  // never hold up what the card says.
  if (failed) set({ status: "failed", error: job.error ?? "the create failed" });
  else if (stopped) set({ status: "stopped", kept });
  const dir = state.packDir || String(job.result?.pack_dir ?? "");
  if (!dir) {
    if (!failed && !stopped) {
      set({ status: "failed", error: "the create finished but reported no project folder" });
    }
    // A run that never got a folder has nowhere to record anything.
    return;
  }
  if (settled === job.id) return;
  settled = job.id;

  // Every terminal outcome records both ledgers, in the pack the run CREATED.
  // A failed or stopped run is the one that most needs recording — it billed
  // what it billed before it ended — and a failed create used to record
  // nothing at all. The actual comes from `measuredCreateCost`; when it is
  // unmeasured the rows carry no `actual_usd` and the card says why.
  const money = await measuredCreateCost(dir, job.result);
  if (money.warning) set({ warnings: [...state.warnings, money.warning] });
  const actual = money.actual_usd != null ? { actual_usd: money.actual_usd } : {};
  await recordSpend(dir, {
    op: "world",
    scope: "world",
    backends: state.backends,
    estimate: state.estimateUsd ?? undefined,
    ...actual,
  });
  await recordJob(dir, {
    job_id: job.id,
    op: "world",
    scope: "world",
    target: job.label ?? state.name,
    status: job.status,
    backends: state.backends,
    estimate: state.estimateUsd ?? undefined,
    ...actual,
    duration_ms: job.endedAt && job.ts ? job.endedAt - job.ts : undefined,
    changed: failed ? false : stopped ? kept.length > 0 : true,
    error: failed ? (job.error ?? "the create failed") : undefined,
  });
  if (!failed && !stopped) set({ status: "done", packDir: dir });
}

/** Open the finished project. Separate from `settleCreate` so the card can
 *  offer "Open it now" (board 05) rather than yanking the window away. */
export async function openCreated(): Promise<void> {
  const dir = state.packDir;
  if (!dir) return;
  try {
    await useStore.getState().loadWorldByPath(dir);
  } catch (e) {
    set({ status: "failed", error: `created at ${dir}, but opening it failed: ${String(e)}` });
  }
}
