import { useStore } from "../store";
import { api, type Job, type OpCost } from "./invoke";
import { recordJob, recordSpend } from "./cost";

/** Metadata for a new job — everything except the fields enqueueJob fills in. */
export type JobMeta = Omit<Job, "id" | "status" | "ts">;

/** The env vars each paid backend needs, by the backend id the ops take.
 *
 *  A backend lists ALTERNATIVE key sets: it is satisfied when every var in ANY
 *  one set is present. canon's `_build_backend` / `build_*_producer` accept
 *  exactly these alternatives, and it raises at CONSTRUCTION time — before any
 *  generation — so the pre-flight below can be an exact mirror rather than a
 *  guess. (Flattening fal and pixellab to one var each used to reject a
 *  perfectly good `FAL_KEY_ID`/`PIXELLAB_SECRET` setup.) */
export const BACKEND_KEYS: Record<string, string[][]> = {
  fal: [["FAL_KEY"], ["FAL_KEY_ID", "FAL_KEY_SECRET"]],
  anthropic: [["ANTHROPIC_API_KEY"]],
  lyria: [["GOOGLE_API_KEY"]],
  elevenlabs: [["ELEVENLABS_API_KEY"]],
  pixellab: [["PIXELLAB_SECRET"], ["PIXELLAB_API_KEY"]],
  retro: [["RD_API_KEY"]],
};

/** A human explanation when a job's backends need keys cradle can't supply,
 *  or null when it's good to go. Free backends (fake/none) never need one.
 *
 *  Lives beside enqueueJob because every paid gate wants it BEFORE it spends a
 *  confirm: without the pre-flight the job queues, the user approves a price,
 *  and it then dies deep in the backend with "needs FAL_KEY" — which says
 *  nothing about WHERE cradle looked for it. */
export async function missingKeysFor(
  backends: Record<string, string>,
): Promise<string | null> {
  const needed = [...new Set(Object.values(backends))]
    .map((b) => BACKEND_KEYS[b])
    .filter((sets): sets is string[][] => Boolean(sets));
  if (!needed.length) return null;
  try {
    const { env_file, keys } = await api.providerKeys();
    // Unsatisfied backends only: every alternative set is missing a var.
    // Report the FIRST set of each — the canonical spelling — so the message
    // names one concrete thing to set instead of every accepted permutation.
    const absent = needed
      .filter((sets) => !sets.some((set) => set.every((k) => keys.includes(k))))
      .map((sets) => sets[0].join(" + "));
    if (!absent.length) return null;
    return (
      `missing ${absent.join(", ")} — ` +
      (env_file
        ? `not found in ${env_file}`
        : "cradle found no env file; set CANON_ENV_FILE, or put a .env beside the canon repo")
    );
  } catch {
    return null; // can't tell (browser mock) — let the job try.
  }
}

/** Payload of a Rust `job-updated` event: only {id, status, result?/error?} —
 *  the frontend holds the rest of the job metadata (keyed by id). */
export type JobEventPayload = {
  id: string;
  status: string; // queued | running | done | failed
  result?: Record<string, unknown>;
  error?: string;
};

/** The single place that processes a background-job lifecycle event. Wired to
 *  the Rust `job-updated` listener in App (native) AND driven directly by the
 *  browser dev-mock (which has no event bus). Folds the event into the store,
 *  then on completion records the durable ledgers, broadcasts a completion
 *  signal (open detail views refresh), refreshes the affected nav list, and
 *  opens a freshly generated level. Uses getState() so it never goes stale. */
export async function handleJobEvent(payload: JobEventPayload): Promise<void> {
  const store = useStore.getState();
  const { id, status, result, error } = payload;
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return; // an event for a job this session didn't enqueue — ignore

  if (status === "running") {
    store.updateJob(id, { status: "running" });
    return;
  }
  if (status !== "done" && status !== "failed") return; // queued echo, etc.

  const now = Date.now();
  if (status === "failed") {
    store.updateJob(id, { status: "failed", error: error ?? "failed", endedAt: now });
  } else {
    const changed = !!result?.changed;
    const resolvedTarget =
      (result?.level_id as string) || (result?.id as string) || job.target;
    store.updateJob(id, {
      status: changed ? "ok" : "no_change",
      changed,
      cost: result?.cost as OpCost | undefined,
      result,
      endedAt: now,
      target: resolvedTarget,
    });
  }

  const j = useStore.getState().jobs.find((x) => x.id === id);
  if (!j) return;
  const worldPath = store.worldPath;

  // Durable ledgers (best-effort — a write failure never surfaces as a job fail).
  if (j.status !== "failed") {
    const levelId = j.targetType === "levels" ? j.target : undefined;
    await recordSpend(worldPath, {
      op: j.op, scope: j.scope, level_id: levelId, backends: j.backends,
      estimate: j.estimate, actual_usd: j.cost?.usd ?? 0,
      tokens: j.cost
        ? { input: j.cost.input_tokens, output: j.cost.output_tokens, calls: j.cost.calls }
        : undefined,
    });
  }
  await recordJob(worldPath, {
    job_id: j.id, op: j.op, scope: j.scope, target: j.target,
    target_type: j.targetType, status: j.status, backends: j.backends,
    estimate: j.estimate, actual_usd: j.cost?.usd ?? 0,
    duration_ms: j.endedAt && j.ts ? j.endedAt - j.ts : undefined,
    changed: j.changed,
    changed_artifacts: (result?.changed_artifacts as string[]) ?? undefined,
    error: j.error,
  });

  // Broadcast completion so an open LevelDetail / EntityOverview can refresh.
  store.setLastCompletedJob({
    id: j.id, op: j.op, target: j.target, targetType: j.targetType,
    status: j.status as "ok" | "no_change" | "failed", changed: !!j.changed, ts: now,
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
 *  detail views refresh). A failure to even enqueue marks the job failed. */
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
    store.updateJob(id, { status: "failed", error: String(e), endedAt: Date.now() });
  }
  return id;
}
