// The transcript reducer — the agent panel's store slice, as pure functions
// (row P1-A5; agent-panel PLAN "Store slices"; README §3–§8, §10).
//
// Every SSE frame the service streams (`agent.ts`) is folded into ONE
// conversation value here: assistant text accumulates from deltas, tool_use
// blocks become tool items with a tier (read line / write card / paid card /
// UI tool), permission requests attach to the card that wants them, runs
// nest their own item lists (`run_progress`), plans check their steps off,
// errors become the four named states, Stop becomes a cancelled line. The
// same fold rebuilds a conversation from its stored transcript
// (`conversationFromTranscript`) so reopening a tab from ⏱ history renders
// the same log the live stream did.
//
// Pure so the whole panel is testable without React or a service: the
// store (`store.ts`) holds the values and calls `reduceEvent`; the
// components only read. Ids, tiers, modes, statuses and event names are
// strings (data — master doctrine 8), never Literal unions the service
// would have to know about.

import type { ShowMeTarget } from "./agentShowMe";
import { FOREMAN, agentActor } from "./actor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the tab dot reads (PLAN: `idle | streaming | awaiting_approval | error`). */
export type ConversationStatus = "idle" | "streaming" | "awaiting_approval" | "error";

/** The three tool weights the README draws, plus the panel-side UI tools
 *  (Phase 1 §4.E) which render as neither. A string: the service's tiers
 *  are data and a tool this build has no table entry for still renders. */
export type ToolTier = "read" | "write" | "paid" | "ui";

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};
export const ZERO_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

export type UiContextRef = { kind: string; id: string; label: string };

/** A level in the shape `drawLevel` draws — the spatial diff's before/after.
 *  Kept loose (`Record`) here: the renderer narrows it to a `LevelBundle`
 *  with defaults for whatever the payload omits. */
export type SpatialSnapshot = Record<string, unknown>;

export type DiffPayload =
  | {
      kind: "spatial";
      before: SpatialSnapshot;
      after: SpatialSnapshot;
      summary?: string;
      added?: number;
    }
  | {
      kind: "fields";
      target?: string;
      fields: { name: string; old: unknown; new: unknown }[];
      unchanged: number;
    }
  | { kind: "code"; path: string; unified: string; added: number; removed: number };

export type PermissionState = {
  requestId: string;
  tool: string;
  specialist: string;
  /** "‹verb› ‹target›" — the service's describer text. */
  target: string;
  tier: string;
  mode: string;
  alwaysAllowed: boolean;
  alwaysReason: string | null;
  pack: string | null;
  decision?: string;
  reason?: string;
  /** A grant was written by this decision (`always`). */
  grant?: boolean;
  /** What the agent did instead after a rejection (README §6 "Rejected"). */
  insteadNote?: string;
};

export type PaidState =
  | {
      state: "estimate";
      lowCents: number;
      highCents: number;
      backend: string;
      model: string;
      unitCount: number;
      unitLabel: string;
      todaySpendCents: number;
      requestId?: string;
    }
  | {
      state: "running";
      phase: string;
      item?: string;
      index?: number;
      total?: number;
      spentCents: number | null;
      budgetCents: number;
      startedAt: number;
      done: string[];
      jobId?: string;
    }
  | {
      state: "result";
      label: string;
      actualCents: number;
      thumbnails: string[];
      durationMs: number;
      backend: string;
      model: string;
      showMe?: ShowMeTarget;
    }
  | {
      state: "stopped";
      stoppedAtMs: number;
      billedCents: number;
      estimateCents: number;
      kept: string[];
      notStarted: string[];
      finishLastCents?: number;
    };

export type JournalHandle = {
  artifact_id?: string;
  op?: string;
  actor?: string;
  kind?: string;
  before_hash?: string;
  after_hash?: string;
};

export type ToolItem = {
  kind: "tool";
  id: string;
  name: string;
  input: Record<string, unknown>;
  tier: ToolTier;
  status: "pending" | "running" | "ok" | "error";
  result?: unknown;
  error?: string;
  /** Human line: "read level 2-3" / "Spatial · place 6 enemies in 2-3". */
  label: string;
  permission?: PermissionState;
  paid?: PaidState;
  diff?: DiffPayload;
  showMe?: ShowMeTarget;
  journal?: JournalHandle[];
  batchId?: string;
  allowedByGrant?: boolean;
  ts: number;
  /** A sub-item of a specialist run: the run's id (attribution + per-run ⏹). */
  runId?: string;
  specialist?: string;
  /** The read line's expansion payload / the write card's summary text. */
  summary?: string;
  /** "undo this" was clicked and restored the before hash. */
  undone?: boolean;
};

export type RunItem = {
  kind: "run";
  runId: string;
  specialist: string;
  task: string;
  status: "running" | "ok" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number;
  usage: Usage;
  costCents: number | null;
  items: TranscriptItem[];
  summary?: string;
  /** Stopped runs offer a resume (README §10) — the text of it. */
  resume?: string;
  collapsed: boolean;
  /** The foreman's routing line ("routed to artist: cooler east palette"). */
  routing?: string;
};

export type PlanStep = {
  text: string;
  tier: string;
  specialist?: string;
  estimate?: { lowCents: number; highCents: number };
  status: "pending" | "running" | "done" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
  billedCents?: number;
  showMe?: ShowMeTarget;
  note?: string;
};

export type ChangeFeedRow = {
  typeId: string;
  id: string;
  label: string;
  what: string;
  showMe: Extract<ShowMeTarget, { kind: "entity" }>;
};

export type PlanItem = {
  kind: "plan";
  planId: string;
  title: string;
  steps: PlanStep[];
  status: "proposed" | "running" | "halted" | "complete" | "rejected" | "stopped" | "editing";
  haltedAt?: number;
  haltError?: string;
  haltBilledCents?: number;
  haltOptions: string[];
  startedAt?: number;
  endedAt?: number;
  costCents: number;
  feed: ChangeFeedRow[];
  batchId: string;
  undone?: boolean;
  /** The actors that wrote under this batch, for the feed's footer. */
  actors: string[];
  ts: number;
};

export type ErrorVariant = "provider" | "missing_key" | "service" | "generic";
export type ErrorItem = {
  kind: "error";
  variant: ErrorVariant;
  message: string;
  retryable: boolean;
  provider?: string;
  status?: number;
  keyEnv?: string;
  lookedIn?: string[];
  /** A model the user has a key for — the "Use X instead" / "Retry on X" action. */
  alt?: { backend: string; model: string };
  stderr?: string;
  partialKept: boolean;
  nothingWritten: boolean;
  ts: number;
};

export type UserItem = {
  kind: "user";
  id: string;
  text: string;
  ts: number;
  context: UiContextRef[];
};

export type AssistantItem = {
  kind: "assistant";
  id: string;
  text: string;
  thinking: string;
  streaming: boolean;
  ts: number;
  model?: string;
  /** Follow-up chips (≤3) — suggestions, never a menu. */
  chips: string[];
};

export type RuleItem = { kind: "rule"; ts: number; label: string };
export type CancelledItem = {
  kind: "cancelled";
  ts: number;
  landed: string[];
  usage: Usage;
  costCents: number | null;
  scope: "conversation" | "run";
};
export type ImageItem = { kind: "image"; ts: number; path: string; src: string; alt: string };
export type InputRequestItem = {
  kind: "request_input";
  id: string;
  question: string;
  options: string[];
  answer?: string;
  ts: number;
};
export type NoteItem = { kind: "note"; ts: number; text: string };

export type TranscriptItem =
  | RuleItem
  | UserItem
  | AssistantItem
  | ToolItem
  | RunItem
  | PlanItem
  | ErrorItem
  | CancelledItem
  | ImageItem
  | InputRequestItem
  | NoteItem;

export type TouchedArtifact = {
  typeId: string;
  id: string;
  actor: string;
  ts: number;
  what: string;
};

export type Conversation = {
  id: string;
  title: string;
  model: string | null;
  mode: string;
  items: TranscriptItem[];
  status: ConversationStatus;
  usage: Usage;
  /** Priced from `usage` × the picker's per-1M rates — an ESTIMATE the
   *  header shows; the ledger (A6) is the measured truth. `null` = no rate
   *  known for the model. */
  costCents: number | null;
  createdAt: number;
  /** Errored and not yet looked at — the red tab dot (README §2). */
  unreadError: boolean;
  /** The specialist the status bar names: the foreman, or the running run's. */
  specialist: string;
  /** Pending chips / plan approvals, by id — amber while non-empty. */
  awaiting: string[];
  /** Tab order tiebreak: creation index. Waiting tabs sort ahead of idle
   *  ones; a streaming tab keeps the position it had when it started. */
  order: number;
  /** The position the tab held when its run started (never re-sorts mid-run). */
  pinnedIndex: number | null;
  /** Artifacts written this conversation — the LeftNav dots + editor pill. */
  touched: TouchedArtifact[];
  draft: string;
  /** The user message being edited-and-resent (branching truncates below). */
  editingId: string | null;
  lastPlanId: string | null;
};

// ---------------------------------------------------------------------------
// Tier classification — a table, extended by what the service says
// ---------------------------------------------------------------------------

/** Phase 1 §4.E: the UI tools execute panel-side. */
export const UI_TOOLS = new Set(["show_user", "attach_image", "propose_plan", "request_input"]);

/** Row A4's write tools (`canon.agent.tools_write.WRITE_TOOL_NAMES`) — the
 *  names whose calls draw a bordered card. A `permission_request` carrying
 *  a tier upgrades whatever the table guessed. */
export const WRITE_TOOLS = new Set([
  "apply_level_edit",
  "import_level_grids",
  "create_level",
  "publish_level",
  "edit_world_map",
  "update_row",
  "update_schema",
  "pin",
  "unpin",
  "restore",
  "complete_row",
  "edit_project_code",
  "sandbox_level",
  "delegate",
]);

/** Prefixes that read as paid before A6's registry says so. */
const PAID_PREFIXES = ["generate_", "animate_", "regenerate_", "regen_", "render_"];

export function tierFor(name: string, hint?: string): ToolTier {
  if (hint === "paid") return "paid";
  if (hint === "ask") return WRITE_TOOLS.has(name) || !UI_TOOLS.has(name) ? "write" : "ui";
  if (hint === "auto" && !UI_TOOLS.has(name)) return "read";
  if (UI_TOOLS.has(name)) return "ui";
  if (WRITE_TOOLS.has(name)) return "write";
  if (PAID_PREFIXES.some((p) => name.startsWith(p))) return "paid";
  return "read";
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** The human line for a tool call, from its name + input — the README's
 *  "read level 2-3", "Spatial · place 6 enemies in 2-3". The service's own
 *  describer text (`permission_request.target`) replaces this when it lands. */
export function labelFor(name: string, input: Record<string, unknown>, tier: ToolTier): string {
  const target =
    str(input.level_id) ??
    str(input.target) ??
    str(input.id) ??
    str(input.path) ??
    str(input.type) ??
    null;
  if (tier === "read") {
    const verb = name.replace(/^(describe|export|get|list|read|search|validate)_/, "$1 ");
    return target ? `${verb} ${target}` : verb.replace(/_/g, " ");
  }
  const verb = name.replace(/_/g, " ");
  return target ? `${verb} ${target}` : verb;
}

/** `agent:<conversation>/<specialist>` → "Level designer". Display may
 *  hyphenate or space; the id stays snake_case (Appendix I deviation 3). */
export function specialistLabel(id: string | null | undefined): string {
  if (!id) return "Agent";
  const s = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  const words = s.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function newConversation(
  id: string,
  opts: { title?: string; model?: string | null; mode?: string; order: number; createdAt?: number },
): Conversation {
  return {
    id,
    title: opts.title ?? "New conversation",
    model: opts.model ?? null,
    mode: opts.mode ?? "ask",
    items: [],
    status: "idle",
    usage: { ...ZERO_USAGE },
    costCents: null,
    createdAt: opts.createdAt ?? Date.now(),
    unreadError: false,
    specialist: "foreman",
    awaiting: [],
    order: opts.order,
    pinnedIndex: null,
    touched: [],
    draft: "",
    editingId: null,
    lastPlanId: null,
  };
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}`;
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

export type Event = { event: string; data: Record<string, unknown> };

type Ctx = {
  now: number;
  /** The run this event nests under, when relayed by `run_progress`. */
  runId?: string;
  specialist?: string;
  /** Project grants — a write that ran without a chip and is on this list
   *  renders the quiet "✓ … allowed in this project" line. */
  grants?: Set<string>;
  batchId?: string;
};

function last<T extends TranscriptItem>(
  items: TranscriptItem[],
  pred: (i: TranscriptItem) => i is T,
): T | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (pred(it)) return it;
  }
  return null;
}
const isAssistant = (i: TranscriptItem): i is AssistantItem => i.kind === "assistant";

function replaceLast<T extends TranscriptItem>(
  items: TranscriptItem[],
  pred: (i: TranscriptItem) => i is T,
  patch: (it: T) => T,
): TranscriptItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (pred(it)) {
      const next = items.slice();
      next[i] = patch(it);
      return next;
    }
  }
  return items;
}

function replaceWhere(
  items: TranscriptItem[],
  pred: (i: TranscriptItem) => boolean,
  patch: (it: TranscriptItem) => TranscriptItem,
): TranscriptItem[] {
  let hit = false;
  const next = items.map((it) => {
    if (!hit && pred(it)) {
      hit = true;
      return patch(it);
    }
    return it;
  });
  return hit ? next : items;
}

function findRun(items: TranscriptItem[], runId: string): RunItem | null {
  return items.find((i): i is RunItem => i.kind === "run" && i.runId === runId) ?? null;
}

function patchRun(items: TranscriptItem[], runId: string, patch: (r: RunItem) => RunItem) {
  return replaceWhere(
    items,
    (i) => i.kind === "run" && i.runId === runId,
    (i) => patch(i as RunItem),
  );
}

/** Deep search for a tool item (chips can target a tool nested in a run). */
function findToolDeep(items: TranscriptItem[], pred: (t: ToolItem) => boolean): ToolItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool" && pred(it)) return it;
    if (it.kind === "run") {
      const inner = findToolDeep(it.items, pred);
      if (inner) return inner;
    }
  }
  return null;
}

function patchToolDeep(
  items: TranscriptItem[],
  pred: (t: ToolItem) => boolean,
  patch: (t: ToolItem) => ToolItem,
): TranscriptItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool" && pred(it)) {
      const next = items.slice();
      next[i] = patch(it);
      return next;
    }
    if (it.kind === "run") {
      const inner = patchToolDeep(it.items, pred, patch);
      if (inner !== it.items) {
        const next = items.slice();
        next[i] = { ...it, items: inner };
        return next;
      }
    }
  }
  return items;
}

function usageOf(v: unknown): Usage {
  const u = rec(v);
  return {
    input_tokens: num(u.input_tokens) ?? 0,
    output_tokens: num(u.output_tokens) ?? 0,
    cache_read_input_tokens: num(u.cache_read_input_tokens) ?? 0,
    cache_creation_input_tokens: num(u.cache_creation_input_tokens) ?? 0,
  };
}
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  };
}

/** Cents for measured tokens at per-1M rates. `null` when no rate is known
 *  — the header then shows tokens, never a made-up dollar figure. */
export function priceUsage(
  usage: Usage,
  rate: { input_per_1m: number; output_per_1m: number } | null | undefined,
): number | null {
  if (!rate) return null;
  const usd =
    (usage.input_tokens / 1e6) * rate.input_per_1m +
    (usage.output_tokens / 1e6) * rate.output_per_1m;
  return Math.round(usd * 100 * 100) / 100;
}

function centsOf(v: unknown): number | null {
  const c = num(v);
  return c == null ? null : c;
}
function usdToCents(v: unknown): number | null {
  const u = num(v);
  return u == null ? null : Math.round(u * 100);
}

/** The diff payload a tool result carries, when it carries one. The tool
 *  result shapes are the service's (A4/A6/A7.5 own them); this reads the
 *  `diff` block and the `journal` handles A4's writes return. */
function diffOf(result: unknown): DiffPayload | undefined {
  const r = rec(result);
  const d = rec(r.diff);
  const kind = str(d.kind);
  if (kind === "spatial") {
    return {
      kind: "spatial",
      before: rec(d.before),
      after: rec(d.after),
      summary: str(d.summary) ?? undefined,
      added: num(d.added) ?? undefined,
    };
  }
  if (kind === "fields") {
    return {
      kind: "fields",
      target: str(d.target) ?? undefined,
      fields: arr(d.fields).map((f) => {
        const ff = rec(f);
        return { name: String(ff.name ?? ""), old: ff.old, new: ff.new };
      }),
      unchanged: num(d.unchanged) ?? 0,
    };
  }
  if (kind === "code") {
    return {
      kind: "code",
      path: str(d.path) ?? "",
      unified: str(d.unified) ?? "",
      added: num(d.added) ?? 0,
      removed: num(d.removed) ?? 0,
    };
  }
  return undefined;
}

function showMeOf(v: unknown): ShowMeTarget | undefined {
  const s = rec(v);
  const kind = str(s.kind);
  if (kind === "entity" && str(s.typeId) && str(s.id)) {
    return {
      kind: "entity",
      typeId: String(s.typeId),
      id: String(s.id),
      tab: str(s.tab) ?? undefined,
    };
  }
  if (kind === "worldmap" || kind === "library" || kind === "bible") return { kind };
  return undefined;
}

/** Guess a Show-me target from a tool's input when the result names none. */
function showMeFromInput(name: string, input: Record<string, unknown>): ShowMeTarget | undefined {
  const level = str(input.level_id);
  if (level) return { kind: "entity", typeId: "levels", id: level };
  if (name === "edit_world_map") return { kind: "worldmap" };
  const type = str(input.type);
  const id = str(input.id);
  if (type && id) return { kind: "entity", typeId: type, id };
  const target = str(input.target);
  if (target && target.includes(":")) {
    const [k, i] = target.split(":", 2);
    const typeId = k === "enemy" ? "enemies" : k === "item" ? "items" : `${k}s`;
    return { kind: "entity", typeId, id: i };
  }
  return undefined;
}

function paidOf(v: unknown, now: number): PaidState | undefined {
  const p = rec(v);
  const state = str(p.state);
  if (state === "estimate") {
    return {
      state,
      lowCents: centsOf(p.lowCents) ?? usdToCents(p.low) ?? 0,
      highCents: centsOf(p.highCents) ?? usdToCents(p.high) ?? 0,
      backend: str(p.backend) ?? "?",
      model: str(p.model) ?? "?",
      unitCount: num(p.unitCount) ?? 1,
      unitLabel: str(p.unitLabel) ?? "units",
      todaySpendCents: centsOf(p.todaySpendCents) ?? 0,
      requestId: str(p.requestId) ?? undefined,
    };
  }
  if (state === "running") {
    return {
      state,
      phase: str(p.phase) ?? "working",
      item: str(p.item) ?? undefined,
      index: num(p.index) ?? undefined,
      total: num(p.total) ?? undefined,
      spentCents: centsOf(p.spentCents),
      budgetCents: centsOf(p.budgetCents) ?? 0,
      startedAt: num(p.startedAt) ?? now,
      done: arr(p.done).map(String),
      jobId: str(p.jobId) ?? undefined,
    };
  }
  if (state === "result") {
    return {
      state,
      label: str(p.label) ?? "done",
      actualCents: centsOf(p.actualCents) ?? 0,
      thumbnails: arr(p.thumbnails).map(String),
      durationMs: num(p.durationMs) ?? 0,
      backend: str(p.backend) ?? "?",
      model: str(p.model) ?? "?",
      showMe: showMeOf(p.showMe),
    };
  }
  if (state === "stopped") {
    return {
      state,
      stoppedAtMs: num(p.stoppedAtMs) ?? 0,
      billedCents: centsOf(p.billedCents) ?? 0,
      estimateCents: centsOf(p.estimateCents) ?? 0,
      kept: arr(p.kept).map(String),
      notStarted: arr(p.notStarted).map(String),
      finishLastCents: centsOf(p.finishLastCents) ?? undefined,
    };
  }
  return undefined;
}

/** Fold one event into an item list. Returns the new list plus what the
 *  conversation-level fold needs to know (status changes, awaiting ids). */
function applyToItems(items: TranscriptItem[], ev: Event, ctx: Ctx): TranscriptItem[] {
  const d = ev.data;
  const now = ctx.now;
  switch (ev.event) {
    case "message_start": {
      return [
        ...items,
        {
          kind: "assistant",
          id: nextId("msg"),
          text: "",
          thinking: "",
          streaming: true,
          ts: now,
          model: str(d.model) ?? undefined,
          chips: [],
        },
      ];
    }
    case "text_delta": {
      const text = String(d.text ?? "");
      const cur = last(items, isAssistant);
      if (!cur || !cur.streaming) {
        return [
          ...items,
          {
            kind: "assistant",
            id: nextId("msg"),
            text,
            thinking: "",
            streaming: true,
            ts: now,
            chips: [],
          },
        ];
      }
      return replaceLast(items, isAssistant, (a) => ({ ...a, text: a.text + text }));
    }
    case "thinking_delta": {
      const text = String(d.text ?? "");
      return replaceLast(items, isAssistant, (a) => ({ ...a, thinking: a.thinking + text }));
    }
    case "content_block_done": {
      const block = rec(d.block);
      if (str(block.type) !== "tool_use") return items;
      const name = str(block.name) ?? "tool";
      const input = rec(block.input);
      const tier = tierFor(name, str(d.tier) ?? undefined);
      const id = str(block.id) ?? nextId("tool");
      if (findToolDeep(items, (t) => t.id === id)) return items;
      return [
        ...items,
        {
          kind: "tool",
          id,
          name,
          input,
          tier,
          status: "pending",
          label: labelFor(name, input, tier),
          ts: now,
          runId: ctx.runId,
          specialist: ctx.specialist,
          batchId: ctx.batchId,
        },
      ];
    }
    case "tool_call": {
      const name = str(d.name) ?? "tool";
      const input = rec(d.input);
      const tier = tierFor(name, str(d.tier) ?? undefined);
      const pending = findToolDeep(items, (t) => t.name === name && t.status === "pending");
      if (pending) {
        return patchToolDeep(
          items,
          (t) => t.id === pending.id,
          (t) => ({
            ...t,
            status: "running",
            input: Object.keys(t.input).length ? t.input : input,
            tier,
          }),
        );
      }
      // A call whose tool_use block we never saw (a resumed stream, the
      // scripted mock) still gets its line.
      return [
        ...items,
        {
          kind: "tool",
          id: str(d.id) ?? nextId("tool"),
          name,
          input,
          tier,
          status: "running",
          label: str(d.label) ?? labelFor(name, input, tier),
          ts: now,
          runId: ctx.runId,
          specialist: ctx.specialist,
          batchId: ctx.batchId,
          paid: paidOf(d.paid, now),
        },
      ];
    }
    case "tool_result": {
      const name = str(d.name) ?? "tool";
      const isError = Boolean(d.is_error);
      const target = findToolDeep(
        items,
        (t) => t.name === name && (t.status === "running" || t.status === "pending"),
      );
      if (!target) return items;
      const result = d.result;
      const r = rec(result);
      const journal = arr(r.journal).map((j) => rec(j) as JournalHandle);
      return patchToolDeep(
        items,
        (t) => t.id === target.id,
        (t) => {
          const showMe = showMeOf(r.show_me) ?? t.showMe ?? showMeFromInput(t.name, t.input);
          const granted =
            Boolean(d.granted) ||
            (!t.permission && t.tier === "write" && (ctx.grants?.has(t.name) ?? false));
          return {
            ...t,
            status: isError ? "error" : "ok",
            result: result ?? t.result,
            error: isError ? (str(d.error) ?? str(r.error) ?? "failed") : undefined,
            diff: diffOf(result) ?? t.diff,
            journal: journal.length ? journal : t.journal,
            showMe,
            summary: str(d.summary) ?? str(r.summary) ?? t.summary,
            allowedByGrant: t.allowedByGrant || granted,
            paid: paidOf(d.paid, now) ?? t.paid,
            batchId: str(r.batchId) ?? t.batchId,
          };
        },
      );
    }
    case "paid_progress": {
      // The running paid card's heartbeat — {phase, item, index, total,
      // spentCents} (master §3.0-E), tagged with the tool call it belongs to.
      const name = str(d.name);
      const target = findToolDeep(
        items,
        (t) => (name ? t.name === name : t.tier === "paid") && t.status === "running",
      );
      if (!target) return items;
      return patchToolDeep(
        items,
        (t) => t.id === target.id,
        (t) => {
          const prev = t.paid && t.paid.state === "running" ? t.paid : null;
          const est = t.paid && t.paid.state === "estimate" ? t.paid : null;
          return {
            ...t,
            paid: {
              state: "running",
              phase: str(d.phase) ?? prev?.phase ?? "working",
              item: str(d.item) ?? undefined,
              index: num(d.index) ?? undefined,
              total: num(d.total) ?? prev?.total,
              spentCents: centsOf(d.spentCents),
              budgetCents: centsOf(d.budgetCents) ?? prev?.budgetCents ?? est?.highCents ?? 0,
              startedAt: prev?.startedAt ?? now,
              done: arr(d.done).length ? arr(d.done).map(String) : (prev?.done ?? []),
              jobId: str(d.jobId) ?? prev?.jobId,
            },
          };
        },
      );
    }
    case "permission_request": {
      const tool = str(d.tool) ?? "tool";
      const requestId = str(d.request_id) ?? nextId("perm");
      const tier = str(d.tier) ?? "ask";
      const specialist = str(d.specialist) ?? ctx.specialist ?? "foreman";
      const perm: PermissionState = {
        requestId,
        tool,
        specialist,
        target: str(d.target) ?? tool,
        tier,
        mode: str(d.mode) ?? "ask",
        alwaysAllowed: Boolean(d.always_allowed),
        alwaysReason: str(d.always_reason),
        pack: str(d.pack),
      };
      const paid = paidOf(d.paid, now);
      const target = findToolDeep(
        items,
        (t) => t.name === tool && (t.status === "running" || t.status === "pending"),
      );
      if (target) {
        return patchToolDeep(
          items,
          (t) => t.id === target.id,
          (t) => ({
            ...t,
            tier: tierFor(t.name, tier),
            permission: perm,
            label: perm.target,
            paid: paid ?? t.paid,
            specialist: t.specialist ?? specialist,
          }),
        );
      }
      const input = rec(d.input);
      const t: ToolTier = tierFor(tool, tier);
      return [
        ...items,
        {
          kind: "tool",
          id: nextId("tool"),
          name: tool,
          input,
          tier: t,
          status: "running",
          label: perm.target,
          ts: now,
          runId: ctx.runId,
          specialist,
          permission: perm,
          paid,
          batchId: ctx.batchId,
        },
      ];
    }
    case "permission_decision": {
      const requestId = str(d.request_id);
      if (!requestId) return items;
      return patchToolDeep(
        items,
        (t) => t.permission?.requestId === requestId,
        (t) => ({
          ...t,
          permission: {
            ...t.permission!,
            decision: str(d.decision) ?? undefined,
            reason: str(d.reason) ?? undefined,
            grant: Boolean(d.grant),
          },
        }),
      );
    }
    case "rejected_instead": {
      // What the agent did after a rejection (README §6) — attaches to the
      // rejected card so the chip collapses to "what did not happen".
      const requestId = str(d.request_id);
      if (!requestId) return items;
      return patchToolDeep(
        items,
        (t) => t.permission?.requestId === requestId,
        (t) => ({ ...t, permission: { ...t.permission!, insteadNote: str(d.text) ?? undefined } }),
      );
    }
    case "run_start": {
      const runId = str(d.run_id) ?? nextId("run");
      if (findRun(items, runId)) return items;
      return [
        ...items,
        {
          kind: "run",
          runId,
          specialist: str(d.specialist) ?? "specialist",
          task: str(d.task) ?? "",
          status: "running",
          startedAt: now,
          usage: { ...ZERO_USAGE },
          costCents: null,
          items: [],
          collapsed: false,
          routing: str(d.routing) ?? undefined,
        },
      ];
    }
    case "run_progress": {
      const runId = str(d.run_id);
      if (!runId) return items;
      const run = findRun(items, runId);
      if (!run) return items;
      const inner = rec(d.event);
      const innerEvent = str(inner.type) ?? str(d.type);
      if (!innerEvent) return items;
      const innerData = { ...inner, ...rec(d.data) };
      delete innerData.type;
      return patchRun(items, runId, (r) => ({
        ...r,
        items: applyToItems(
          r.items,
          { event: innerEvent, data: innerData },
          {
            ...ctx,
            runId,
            specialist: r.specialist,
          },
        ),
      }));
    }
    case "run_end": {
      const runId = str(d.run_id);
      if (!runId) return items;
      const status = str(d.status);
      const usage = usageOf(d.usage);
      return patchRun(items, runId, (r) => ({
        ...r,
        status: status === "ok" ? "ok" : status === "cancelled" ? "cancelled" : "failed",
        endedAt: now,
        usage,
        costCents: centsOf(d.costCents) ?? r.costCents,
        summary: str(d.summary) ?? r.summary,
        resume: str(d.resume) ?? r.resume,
        collapsed: status === "ok",
        items: r.items.map((it) =>
          it.kind === "assistant" && it.streaming ? { ...it, streaming: false } : it,
        ),
      }));
    }
    case "plan_proposed": {
      const planId = str(d.plan_id) ?? nextId("plan");
      const steps = arr(d.steps).map((s): PlanStep => {
        const ss = rec(s);
        const est = rec(ss.estimate);
        return {
          text: str(ss.text) ?? "",
          tier: str(ss.tier) ?? "read",
          specialist: str(ss.specialist) ?? undefined,
          estimate:
            num(est.lowCents) != null || num(est.low) != null
              ? {
                  lowCents: centsOf(est.lowCents) ?? usdToCents(est.low) ?? 0,
                  highCents: centsOf(est.highCents) ?? usdToCents(est.high) ?? 0,
                }
              : undefined,
          status: "pending",
        };
      });
      return [
        ...items,
        {
          kind: "plan",
          planId,
          title: str(d.title) ?? "Plan",
          steps,
          status: "proposed",
          haltOptions: [],
          costCents: 0,
          feed: [],
          batchId: str(d.batch_id) ?? planId,
          actors: [],
          ts: now,
        },
      ];
    }
    // Local-only (`beginPlanEdit`): "Edit steps" opens the textarea; the
    // service hears nothing until Re-propose POSTs `edit` WITH the steps.
    case "plan_editing": {
      const planId = str(d.plan_id);
      return replaceWhere(
        items,
        (i) => i.kind === "plan" && i.planId === planId,
        (i) => ({ ...(i as PlanItem), status: "editing" }),
      );
    }
    case "plan_decided": {
      const planId = str(d.plan_id);
      const decision = str(d.decision);
      return replaceWhere(
        items,
        (i) => i.kind === "plan" && i.planId === planId,
        (i) => {
          const p = i as PlanItem;
          if (decision === "reject") return { ...p, status: "rejected" };
          if (decision === "edit") return { ...p, status: "editing" };
          return { ...p, status: "running", startedAt: now };
        },
      );
    }
    case "plan_step": {
      const planId = str(d.plan_id);
      const index = num(d.index);
      if (!planId || index == null) return items;
      const status = str(d.status) ?? "running";
      return replaceWhere(
        items,
        (i) => i.kind === "plan" && i.planId === planId,
        (i) => {
          const p = i as PlanItem;
          const steps = p.steps.map((s, k) =>
            k === index
              ? {
                  ...s,
                  status: status as PlanStep["status"],
                  durationMs: num(d.duration_ms) ?? s.durationMs,
                  error: str(d.error) ?? s.error,
                  billedCents: centsOf(d.billedCents) ?? s.billedCents,
                  showMe: showMeOf(d.show_me) ?? s.showMe,
                  note: str(d.note) ?? s.note,
                }
              : s,
          );
          const allDone = steps.every((s) => s.status === "done" || s.status === "skipped");
          return {
            ...p,
            status: p.status === "proposed" ? "running" : allDone ? "complete" : p.status,
            startedAt: p.startedAt ?? now,
            endedAt: allDone ? now : p.endedAt,
            steps,
            costCents: centsOf(d.costCents) ?? p.costCents,
          };
        },
      );
    }
    case "plan_halted": {
      const planId = str(d.plan_id);
      const index = num(d.index) ?? 0;
      return replaceWhere(
        items,
        (i) => i.kind === "plan" && (planId ? i.planId === planId : true),
        (i) => {
          const p = i as PlanItem;
          return {
            ...p,
            status: "halted",
            haltedAt: index,
            haltError: str(d.error) ?? "failed",
            haltBilledCents: centsOf(d.billedCents) ?? undefined,
            haltOptions: arr(d.options).map(String),
            endedAt: now,
            steps: p.steps.map((s, k) =>
              k === index ? { ...s, status: "failed", error: str(d.error) ?? s.error } : s,
            ),
          };
        },
      );
    }
    // The halted card's way out landed (`POST …/plans/{id}/resume`): the
    // service answers `plan_resumed {action}` (canon `runs.resume_plan`).
    case "plan_resumed": {
      const planId = str(d.plan_id);
      const action = str(d.action) ?? "continue";
      if (action === "undo") return items;
      return replaceWhere(
        items,
        (i) => i.kind === "plan" && i.planId === planId,
        (i) => ({
          ...(i as PlanItem),
          status: action === "stop" ? "stopped" : "running",
          haltOptions: [],
        }),
      );
    }
    case "plan_undone": {
      const planId = str(d.plan_id);
      return replaceWhere(
        items,
        (i) => i.kind === "plan" && i.planId === planId,
        (i) => ({ ...(i as PlanItem), undone: true }),
      );
    }
    case "follow_ups": {
      const chips = arr(d.chips).map(String).slice(0, 3);
      return replaceLast(items, isAssistant, (a) => ({ ...a, chips }));
    }
    case "attach_image": {
      return [
        ...items,
        {
          kind: "image",
          ts: now,
          path: str(d.path) ?? "",
          src: str(d.src) ?? str(d.path) ?? "",
          alt: str(d.alt) ?? str(d.path) ?? "image",
        },
      ];
    }
    case "request_input": {
      return [
        ...items,
        {
          kind: "request_input",
          id: str(d.request_id) ?? nextId("q"),
          question: str(d.question) ?? "",
          options: arr(d.options).map(String),
          ts: now,
        },
      ];
    }
    case "note": {
      return [...items, { kind: "note", ts: now, text: str(d.text) ?? "" }];
    }
    case "cancelled": {
      return [
        ...items.map((it) =>
          it.kind === "assistant" && it.streaming ? { ...it, streaming: false } : it,
        ),
        {
          kind: "cancelled",
          ts: now,
          landed: arr(d.landed).map(String),
          usage: usageOf(d.usage),
          costCents: centsOf(d.costCents),
          scope: ctx.runId ? "run" : "conversation",
        },
      ];
    }
    case "error": {
      const message = str(d.message) ?? "unknown error";
      const partial = last(items, isAssistant);
      const keyEnv = str(d.key_env) ?? message.match(/([A-Z0-9_]+_API_KEY|FAL_KEY)/)?.[1] ?? null;
      const variant: ErrorVariant = str(d.variant)
        ? (String(d.variant) as ErrorVariant)
        : keyEnv || /no key|missing .*key|credential/i.test(message)
          ? "missing_key"
          : num(d.status) != null || /returned \d{3}|overloaded|rate limit|timeout/i.test(message)
            ? "provider"
            : "generic";
      const alt = rec(d.alt);
      return [
        ...items.map((it) =>
          it.kind === "assistant" && it.streaming ? { ...it, streaming: false } : it,
        ),
        {
          kind: "error",
          variant,
          message,
          retryable: Boolean(d.retryable),
          provider: str(d.provider) ?? undefined,
          status: num(d.status) ?? undefined,
          keyEnv: keyEnv ?? undefined,
          lookedIn: arr(d.looked_in).map(String),
          alt: str(alt.model)
            ? { backend: str(alt.backend) ?? "", model: String(alt.model) }
            : undefined,
          stderr: str(d.stderr) ?? undefined,
          partialKept: Boolean(partial && partial.text),
          nothingWritten: d.nothing_written == null ? true : Boolean(d.nothing_written),
          ts: now,
        },
      ];
    }
    case "message_stop": {
      return replaceLast(items, isAssistant, (a) => ({ ...a, streaming: false }));
    }
    default:
      return items;
  }
}

/** A `run_progress` frame carries one nested event: `{run_id, event: {type,
 *  …}}`. Returns that inner event (or `ev` itself when it is not a relay). */
export function unwrapRunProgress(ev: Event): Event {
  if (ev.event !== "run_progress") return ev;
  const inner = rec(ev.data.event);
  const type = str(inner.type) ?? str(ev.data.type);
  if (!type) return ev;
  const data: Record<string, unknown> = { ...inner, ...rec(ev.data.data) };
  delete data.type;
  return { event: type, data };
}

/** Conversation-level fold: items + status + usage + awaiting + touched. */
export function reduceEvent(
  conv: Conversation,
  ev: Event,
  opts: {
    now?: number;
    grants?: Set<string>;
    rate?: { input_per_1m: number; output_per_1m: number } | null;
    /** The conversation an agent write is attributed to. `lib/actor.ts`
     *  builds the string — this is the id it needs (I6). */
    actorConversation?: string;
  } = {},
): Conversation {
  const now = opts.now ?? Date.now();
  const ctx: Ctx = { now, grants: opts.grants };
  let next: Conversation = { ...conv, items: applyToItems(conv.items, ev, ctx) };
  // The status / awaiting / touched bookkeeping reads the INNER event of a
  // `run_progress` frame too: a chip inside a specialist run is still a chip
  // the tab waits on. Turn-level facts (usage, errors, Stop) stay top-level —
  // a run's own usage arrives on `run_end`, its failure on `run_end` too.
  const top = unwrapRunProgress(ev);
  const nested = top !== ev;
  const d = top.data;

  switch (top.event) {
    case "message_start":
    case "text_delta":
      next.status =
        next.status === "error" ? "streaming" : next.status === "idle" ? "streaming" : next.status;
      break;
    case "message_stop": {
      if (nested) break;
      const u = usageOf(d.usage);
      next.usage = addUsage(next.usage, u);
      next.costCents = priceUsage(next.usage, opts.rate);
      break;
    }
    case "permission_request": {
      const id = str(d.request_id);
      if (id) next.awaiting = [...next.awaiting, id];
      next.status = "awaiting_approval";
      break;
    }
    case "permission_decision": {
      const id = str(d.request_id);
      next.awaiting = next.awaiting.filter((x) => x !== id);
      if (!next.awaiting.length && next.status === "awaiting_approval") next.status = "streaming";
      break;
    }
    case "plan_proposed": {
      const id = str(d.plan_id);
      if (id) {
        next.awaiting = [...next.awaiting, id];
        next.lastPlanId = id;
      }
      next.status = "awaiting_approval";
      break;
    }
    case "plan_decided": {
      const id = str(d.plan_id);
      next.awaiting = next.awaiting.filter((x) => x !== id);
      if (!next.awaiting.length && next.status === "awaiting_approval") next.status = "streaming";
      break;
    }
    case "plan_halted": {
      const id = str(d.plan_id);
      if (id) next.awaiting = [...next.awaiting.filter((x) => x !== id), id];
      next.status = "awaiting_approval";
      break;
    }
    // A halted plan stops waiting the moment its way out lands — resume
    // (continue | skip | stop) or undo. Same bookkeeping as a decision.
    case "plan_resumed":
    case "plan_undone": {
      const id = str(d.plan_id);
      next.awaiting = next.awaiting.filter((x) => x !== id);
      if (!next.awaiting.length && next.status === "awaiting_approval") next.status = "streaming";
      break;
    }
    case "run_start":
      next.specialist = str(d.specialist) ?? next.specialist;
      break;
    case "run_end": {
      const u = usageOf(d.usage);
      next.usage = addUsage(next.usage, u);
      next.costCents = priceUsage(next.usage, opts.rate);
      const stillRunning = next.items.find(
        (i): i is RunItem => i.kind === "run" && i.status === "running",
      );
      next.specialist = stillRunning ? stillRunning.specialist : "foreman";
      break;
    }
    case "tool_result": {
      // "Agent changed this": every successful write lands in `touched`.
      const name = str(d.name);
      const t = name ? findToolDeep(next.items, (x) => x.name === name && x.status === "ok") : null;
      const sm = t?.showMe;
      if (t && t.tier !== "read" && t.tier !== "ui" && sm?.kind === "entity") {
        const actor = agentActor(opts.actorConversation ?? conv.id, t.specialist ?? FOREMAN);
        next.touched = [
          ...next.touched.filter((x) => !(x.typeId === sm.typeId && x.id === sm.id)),
          { typeId: sm.typeId, id: sm.id, actor, ts: now, what: t.summary ?? t.label },
        ];
      }
      break;
    }
    case "error":
      if (nested) break;
      next.status = "error";
      next.unreadError = true;
      next.awaiting = [];
      break;
    case "cancelled":
      if (nested) break;
      next.status = "idle";
      next.awaiting = [];
      next.specialist = "foreman";
      break;
    case "done": {
      const u = usageOf(d.usage);
      // `done` carries the turn's rollup; message_stop already added the
      // per-message usage, so only take `done` when nothing was counted.
      if (next.usage.input_tokens === 0 && next.usage.output_tokens === 0) {
        next.usage = addUsage(next.usage, u);
        next.costCents = priceUsage(next.usage, opts.rate);
      }
      next.status = next.awaiting.length ? "awaiting_approval" : "idle";
      next.specialist = "foreman";
      next.items = next.items.map((it) =>
        it.kind === "assistant" && it.streaming ? { ...it, streaming: false } : it,
      );
      next = {
        ...next,
        items: completePlans(next.items, now, opts.actorConversation ?? conv.id),
      };
      break;
    }
    default:
      break;
  }
  return next;
}

/** A finished plan collapses into its change feed (README §8): one row per
 *  artifact its writes touched, derived from the writes under the batch. */
function completePlans(
  items: TranscriptItem[],
  now: number,
  conversation: string,
): TranscriptItem[] {
  return items.map((it) => {
    if (it.kind !== "plan" || it.status !== "complete" || it.feed.length) return it;
    const rows: ChangeFeedRow[] = [];
    const actors = new Set<string>();
    const walk = (list: TranscriptItem[]) => {
      for (const x of list) {
        if (x.kind === "run") walk(x.items);
        if (x.kind !== "tool" || x.tier === "read" || x.tier === "ui" || x.status !== "ok")
          continue;
        if ((x.batchId ?? "") !== it.batchId) continue;
        actors.add(agentActor(conversation, x.specialist ?? FOREMAN));
        const s = x.showMe;
        if (s?.kind !== "entity") continue;
        if (rows.some((r) => r.typeId === s.typeId && r.id === s.id)) continue;
        rows.push({
          typeId: s.typeId,
          id: s.id,
          label: s.id,
          what: x.summary ?? x.label,
          showMe: s,
        });
      }
    };
    walk(items);
    return { ...it, feed: rows, actors: [...actors], endedAt: it.endedAt ?? now };
  });
}

// ---------------------------------------------------------------------------
// Transcript hydration
// ---------------------------------------------------------------------------

/** Rebuild a conversation from its stored transcript lines. The store's
 *  line shapes are `conversations.py`'s: `meta`, `user`, `assistant`,
 *  `tool_result`, `turn_end`, `error`, `permission_request`,
 *  `permission_decision` — plus whatever A4.5 appends (`run_*`, `plan_*`,
 *  `cancelled`), which fold through the same event reducer. */
export function conversationFromTranscript(
  lines: TranscriptLineLike[],
  opts: {
    order: number;
    title?: string;
    rate?: { input_per_1m: number; output_per_1m: number } | null;
  },
): Conversation {
  const meta = rec(lines[0]);
  const id = str(meta.id) ?? "conv";
  const createdAt = str(meta.created) ? Date.parse(String(meta.created)) || Date.now() : Date.now();
  let conv = newConversation(id, {
    order: opts.order,
    model: str(meta.model),
    createdAt,
    title: opts.title,
  });
  conv.items = [{ kind: "rule", ts: createdAt, label: `Session started ${fmtClock(createdAt)}` }];
  const pendingUses = new Map<string, ToolItem>();
  for (const line of lines.slice(1)) {
    const ts = str(line.ts) ? Date.parse(String(line.ts)) || Date.now() : Date.now();
    const type = str(line.type) ?? "";
    if (type === "user") {
      const content = line.content;
      const text = typeof content === "string" ? content : textOf(content);
      conv = {
        ...conv,
        items: [...conv.items, { kind: "user", id: nextId("u"), text, ts, context: [] }],
      };
      if (conv.title === "New conversation" && text) conv.title = titleFrom(text);
      continue;
    }
    if (type === "assistant") {
      const blocks = arr(line.content);
      conv = reduceEvent(conv, { event: "message_start", data: {} }, { now: ts, rate: opts.rate });
      for (const b of blocks) {
        const block = rec(b);
        const bt = str(block.type);
        if (bt === "text") {
          conv = reduceEvent(
            conv,
            { event: "text_delta", data: { text: block.text } },
            { now: ts },
          );
        } else if (bt === "thinking") {
          conv = reduceEvent(
            conv,
            { event: "thinking_delta", data: { text: block.thinking } },
            { now: ts },
          );
        } else if (bt === "tool_use") {
          conv = reduceEvent(conv, { event: "content_block_done", data: { block } }, { now: ts });
          const t = findToolDeep(conv.items, (x) => x.id === str(block.id));
          if (t) pendingUses.set(t.id, t);
          conv = reduceEvent(
            conv,
            { event: "tool_call", data: { name: block.name, input: block.input } },
            { now: ts },
          );
        }
      }
      conv = reduceEvent(conv, { event: "message_stop", data: {} }, { now: ts, rate: opts.rate });
      continue;
    }
    if (type === "tool_result") {
      for (const b of arr(line.content)) {
        const block = rec(b);
        const useId = str(block.tool_use_id);
        const t = useId ? pendingUses.get(useId) : null;
        let result: unknown = block.content;
        if (typeof result === "string") {
          try {
            result = JSON.parse(result);
          } catch {}
        }
        conv = reduceEvent(
          conv,
          {
            event: "tool_result",
            data: {
              name: t?.name ?? str(block.name) ?? "tool",
              is_error: Boolean(block.is_error),
              result,
              error: block.is_error ? textOf(block.content) : undefined,
            },
          },
          { now: ts },
        );
      }
      continue;
    }
    if (type === "turn_end") {
      conv = reduceEvent(
        conv,
        { event: "done", data: { stop_reason: line.stop_reason, usage: line.usage } },
        { now: ts, rate: opts.rate },
      );
      continue;
    }
    if (type === "meta") continue;
    // Everything else is an event by name (`permission_request`,
    // `permission_decision`, `error`, A4.5's run/plan/cancelled lines).
    const data: Record<string, unknown> = { ...line };
    delete data.type;
    delete data.ts;
    conv = reduceEvent(conv, { event: type, data }, { now: ts, rate: opts.rate });
  }
  conv.status = conv.awaiting.length ? "awaiting_approval" : "idle";
  conv.unreadError = false;
  return conv;
}

export type TranscriptLineLike = Record<string, unknown>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((b) => str(rec(b).text) ?? "")
    .join("");
}

/** A tab title from the first user message — the first clause, ≤ 32 chars. */
export function titleFrom(text: string): string {
  const first = text.split(/[.!?\n]/)[0].trim();
  return first.length > 32 ? `${first.slice(0, 31).trimEnd()}…` : first || "New conversation";
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/** README §2: waiting tabs sort ahead of idle ones; running tabs never
 *  re-sort while running (they keep `pinnedIndex`, the slot they held when
 *  the run started — released the moment the tab flips to waiting, because
 *  a tab that needs you sorts ahead); errored tabs stay put. Stable within
 *  a bucket. */
export function sortTabs(convs: Conversation[]): Conversation[] {
  const byOrder = [...convs].sort((a, b) => a.order - b.order);
  const bucket = (c: Conversation) => (c.status === "awaiting_approval" ? 0 : 1);
  const isPinned = (c: Conversation) => c.pinnedIndex != null && c.status === "streaming";
  const sorted = byOrder
    .filter((c) => !isPinned(c))
    .sort((a, b) => bucket(a) - bucket(b) || a.order - b.order);
  const pinned = byOrder.filter(isPinned).sort((a, b) => a.pinnedIndex! - b.pinnedIndex!);
  const out = sorted.slice();
  for (const p of pinned) {
    const at = Math.min(p.pinnedIndex!, out.length);
    out.splice(at, 0, p);
  }
  return out;
}

/** The tab dot (README §2). `null` = idle, no dot. */
export function tabDot(c: Conversation): "streaming" | "waiting" | "error" | null {
  if (c.status === "streaming") return "streaming";
  if (c.status === "awaiting_approval") return "waiting";
  if (c.status === "error" && c.unreadError) return "error";
  return null;
}

/** Everything in flight in a conversation — the header ⏹ shows while true. */
export function inFlight(c: Conversation): boolean {
  return c.status === "streaming" || c.status === "awaiting_approval";
}

/** Reads fold past six (README §5): the indexes of tool items that render
 *  as one "read N artifacts ▸" line instead of N lines. Returns groups of
 *  consecutive read items longer than `limit`. */
export function foldReads(items: TranscriptItem[], limit = 6): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length > limit) groups.push(cur);
    cur = [];
  };
  items.forEach((it, i) => {
    if (it.kind === "tool" && it.tier === "read") cur.push(i);
    else flush();
  });
  flush();
  return groups;
}

/** Edit-and-resend truncates below the edited message (README §3). */
export function truncateBelow(items: TranscriptItem[], userId: string): TranscriptItem[] {
  const at = items.findIndex((i) => i.kind === "user" && i.id === userId);
  return at < 0 ? items : items.slice(0, at);
}

export function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const usd = cents / 100;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function fmtCentsRange(low: number, high: number): string {
  if (low === high) return fmtCents(low);
  return `${fmtCents(low)} – ${fmtCents(high)}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
