// The scripted agent — the devMock's stand-in for the whole sidecar (row
// P1-A5; I7 devMock parity; V1 criterion 5: the panel runs headless with no
// Tauri, no keys, no network).
//
// `ScriptedAgentTransport` implements `AgentTransport` with in-memory
// conversations and canned SSE sequences for EVERY panel state the README
// draws: a plain conversation with a read line and follow-up chips (board
// 07), specialist run cards with a permission chip and a paid card (01/02),
// the four permission-chip states and the three diff shapes (02), the paid
// card's four states (02), plan mode proposed → running → complete and the
// halted mid-plan ledger (03), the four error states and Stop in three
// places (04). The script is chosen by what the message says (see
// `pickScript`) and by the header's mode; a `mock:` prefix drives states
// that are not conversation events (service starting / failed).
//
// Timing is real (deltas a few ms apart) so the streaming caret and the
// ticking clocks are watchable; tests set `speed = 0` for instant runs.
// Nothing here prices anything real: every dollar figure is scripted data.

import { USER_ACTOR, agentActor } from "./actor";
import type {
  AgentEvent,
  AgentTransport,
  ConversationSummary,
  GrantsDoc,
  Health,
  ModelInfo,
  PermissionDecisionBody,
  PlanDecisionBody,
  PlanResumeBody,
  SendBody,
  TranscriptLine,
} from "./agent";
import { handleJobEvent, handleJobProgress } from "./jobs";

type Emit = (event: string, data?: Record<string, unknown>) => void;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

class Cancelled extends Error {}

/** The service's plan vocabulary, mirrored so the mock refuses what the
 *  service refuses (canon `runs.PLAN_DECISIONS` / `HALT_OPTIONS`). */
const PLAN_DECISIONS = ["approve", "reject", "edit"];
const PLAN_RESUME_ACTIONS = ["continue", "skip", "stop"];

/** The models the picker lists headless. Prices are the design's numbers
 *  (data); availability names the real key sources (Appendix I dev. 2). */
export const MOCK_MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    label: "claude-sonnet-4.6",
    input_per_1m: 3,
    output_per_1m: 15,
    available: true,
    reasoning: true,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "claude-haiku-4.5",
    input_per_1m: 1,
    output_per_1m: 5,
    available: true,
    reasoning: false,
  },
  {
    id: "gpt-5.1",
    provider: "openai",
    label: "gpt-5.1",
    input_per_1m: 1.25,
    output_per_1m: 10,
    available: true,
    reasoning: true,
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    label: "gpt-5.4-mini",
    input_per_1m: 0.75,
    output_per_1m: 4.5,
    available: true,
    reasoning: false,
  },
  {
    id: "kimi-k2.6",
    provider: "kimi",
    label: "kimi-k2.6",
    input_per_1m: 0.95,
    output_per_1m: 4,
    available: false,
    reasoning: true,
    key_env: "MOONSHOT_API_KEY",
    reason: "No MOONSHOT_API_KEY in the env file (CANON_ENV_FILE) or the environment",
  },
];

/** A tiny level in the shape `drawLevel` draws — the spatial diff's data. */
function spatialLevel(id: string, entities: { x: number; y: number }[]) {
  const W = 24;
  const H = 8;
  const collision: number[][] = [];
  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      const floor = y === H - 1;
      const platform = (y === 4 && x >= 6 && x <= 11) || (y === 3 && x >= 15 && x <= 19);
      row.push(floor ? 1 : platform ? 2 : 0);
    }
    collision.push(row);
  }
  return {
    level_id: id,
    grid_width: W,
    grid_height: H,
    spawn: [1, 6],
    exit: [22, 6],
    grids: { collision },
    entities: entities.map((e, i) => ({
      enemy_id: "ember_hopper",
      x: e.x,
      y: e.y,
      name: `ember hopper ${i + 1}`,
      placeholder_color: "#e0453a",
    })),
    items: [{ item_id: "lantern", x: 9, y: 3, name: "lantern", placeholder_color: "#f2c14e" }],
  };
}

const BEFORE = spatialLevel("l3", [
  { x: 4, y: 6 },
  { x: 8, y: 3 },
  { x: 12, y: 6 },
]);
const AFTER = spatialLevel("l3", [
  { x: 4, y: 6 },
  { x: 8, y: 3 },
  { x: 12, y: 6 },
  { x: 13, y: 6 },
  { x: 15, y: 6 },
  { x: 17, y: 2 },
  { x: 19, y: 2 },
  { x: 21, y: 6 },
  { x: 23, y: 6 },
]);

const CODE_DIFF = `@@ -41,7 +41,9 @@ class Hopper
     def step(self, dt):
-        self.vy += GRAVITY * dt
+        g = GRAVITY * (0.6 if self.in_ember else 1.0)
+        self.vy += g * dt
         if self.grounded:
             self.vy = 0
@@ -58,3 +60,4 @@ class Hopper
     def land(self):
         self.grounded = True
+        self.in_ember = self.tile().name == "ember"`;

const SPRITE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJklEQVQYV2NkYGD4z0AEYBxVSFAhI1SB4v8MDAwMjKMKiXcJANpqB/0fu2nqAAAAAElFTkSuQmCC";

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

type Conv = {
  id: string;
  created: string;
  model: string | null;
  lines: TranscriptLine[];
  turns: number;
  cancelled: boolean;
  runsCancelled: Set<string>;
  pending: Map<string, Deferred<{ decision: string; reason?: string }>>;
  plans: Map<string, Deferred<{ decision: string; steps?: unknown[] }>>;
  /** A HALTED plan waits here, not in `plans` — the service's way out is
   *  `POST …/plans/{id}/resume {action}`, a different endpoint (I7 parity). */
  resumes: Map<string, Deferred<{ action: string }>>;
  streaming: boolean;
};

export class ScriptedAgentTransport implements AgentTransport {
  /** Delay multiplier: 1 = watchable, 0 = instant (tests). */
  speed = 1;
  pack = "mock://plat_pack";
  private convs = new Map<string, Conv>();
  private grants: { tool: string; granted_by: string; when: string; scope: string }[] = [];
  private runSeq = 0;
  private jobSeq = 0;
  /** Scripts keyed by the text a message starts with (`mock:` commands). */
  private serviceHook: ((state: Record<string, unknown>) => void) | null = null;

  /** What the sidecar was spawned on (`--backend` / `--model`). The real
   *  service takes these from its command line and nothing else — a model
   *  reaches it only by (re)starting it — so the mock does the same (I7). */
  backend = "fake";
  model: string | null = "claude-sonnet-4-6";
  startedOn(backend?: string | null, model?: string | null) {
    this.backend = backend || "fake";
    this.model = model || null;
  }

  async health(): Promise<Health> {
    return { ok: true, pack: this.pack, backend: this.backend, model: this.model, tools: [] };
  }
  async models(): Promise<ModelInfo[]> {
    return MOCK_MODELS.map((m) => ({ ...m }));
  }
  async createConversation(): Promise<{ id: string }> {
    const id = `conv_${(this.convs.size + 1).toString(16).padStart(8, "0")}`;
    this.convs.set(id, {
      id,
      created: new Date().toISOString(),
      // The service's `CreateConversation` body is `{system, ui_state}` —
      // it has no `model`, so a `model` sent here is ignored on both sides
      // and the conversation runs on whatever the sidecar was started with.
      model: this.model,
      lines: [{ type: "meta", id, pack: this.pack, backend: this.backend, model: this.model }],
      turns: 0,
      cancelled: false,
      runsCancelled: new Set(),
      pending: new Map(),
      plans: new Map(),
      resumes: new Map(),
      streaming: false,
    });
    return { id };
  }
  async listConversations(): Promise<ConversationSummary[]> {
    return [...this.convs.values()].map((c) => ({ id: c.id, created: c.created, turns: c.turns }));
  }
  async getConversation(id: string): Promise<TranscriptLine[]> {
    const c = this.convs.get(id);
    if (!c) throw new Error(`404 no conversation ${id}`);
    return c.lines.slice();
  }
  async decidePermission(id: string, body: PermissionDecisionBody) {
    const c = this.convs.get(id);
    const d = c?.pending.get(body.request_id);
    if (!c || !d) throw new Error(`404 no pending permission request '${body.request_id}'`);
    if (body.decision === "always") {
      // The engine refuses "always" where the chip is disabled (409).
      const p = this.pendingMeta.get(body.request_id);
      if (p && !p.always_allowed) throw new Error(`409 ${p.always_reason}`);
      if (p) {
        this.grants.push({
          tool: p.tool,
          granted_by: agentActor(id, p.specialist),
          when: new Date().toISOString(),
          scope: "project",
        });
      }
    }
    c.pending.delete(body.request_id);
    d.resolve({ decision: body.decision, reason: body.reason });
    return { ok: true, request_id: body.request_id, decision: body.decision };
  }
  private pendingMeta = new Map<
    string,
    { tool: string; specialist: string; always_allowed: boolean; always_reason: string | null }
  >();
  async decidePlan(id: string, planId: string, body: PlanDecisionBody) {
    const c = this.convs.get(id);
    const d = c?.plans.get(planId);
    if (!c || !d) throw new Error(`404 no plan ${planId}`);
    // The service's vocabulary, refused the same way (runs.decide_plan →
    // 422): a mock that accepts anything certifies a contract the real
    // service rejects (I7).
    if (!PLAN_DECISIONS.includes(body.decision)) {
      throw new Error(
        `422 decision must be one of ${JSON.stringify(PLAN_DECISIONS)} (got '${body.decision}')`,
      );
    }
    if (body.decision === "edit" && body.steps == null) {
      throw new Error("422 edit needs the edited steps");
    }
    c.plans.delete(planId);
    d.resolve({ decision: body.decision, steps: body.steps });
    return { ok: true, plan_id: planId, decision: body.decision };
  }
  /** `POST …/plans/{id}/resume` — a HALTED plan's way out. */
  async resumePlan(id: string, planId: string, body: PlanResumeBody) {
    const c = this.convs.get(id);
    const d = c?.resumes.get(planId);
    if (!c || !d) throw new Error(`409 plan ${planId} is not halted`);
    if (!PLAN_RESUME_ACTIONS.includes(body.action)) {
      throw new Error("422 action must be continue | skip | stop (undo is POST …/undo)");
    }
    c.resumes.delete(planId);
    d.resolve({ action: body.action });
    return { ok: true, plan_id: planId, action: body.action };
  }
  async undoPlan(id: string, planId: string) {
    const c = this.convs.get(id);
    if (!c) throw new Error(`404 no conversation ${id}`);
    // A halted plan resumes with `undo` (runs.undo_plan sets plan.resume).
    const d = c.resumes.get(planId);
    if (d) {
      c.resumes.delete(planId);
      d.resolve({ action: "undo" });
    }
    return { ok: true, plan_id: planId, restored: ["l3", "l4", "tileset:ember_grove"] };
  }
  async stopConversation(id: string) {
    const c = this.convs.get(id);
    if (!c) throw new Error(`404 no conversation ${id}`);
    c.cancelled = true;
    for (const [rid, d] of c.pending) {
      c.pending.delete(rid);
      d.resolve({ decision: "reject", reason: "stopped" });
    }
    for (const [pid, d] of c.plans) {
      c.plans.delete(pid);
      d.resolve({ decision: "reject" });
    }
    return { ok: true, stopped: c.streaming };
  }
  async stopRun(runId: string) {
    for (const c of this.convs.values()) c.runsCancelled.add(runId);
    return { ok: true, run_id: runId };
  }
  async listGrants(): Promise<GrantsDoc> {
    return {
      pack: this.pack,
      path: `${this.pack}/.canon/agent/permissions.json`,
      grants: this.grants.map((g, index) => ({ index, ...g })),
    };
  }
  async revokeGrant(index: number): Promise<GrantsDoc> {
    this.grants.splice(index, 1);
    return this.listGrants();
  }
  async revokeAllGrants(): Promise<GrantsDoc> {
    this.grants = [];
    return this.listGrants();
  }
  async prompt(id: string) {
    if (!this.convs.has(id)) throw new Error(`404 no conversation ${id}`);
    return {
      prompt:
        "# core\nVerbs are the only hands. Code computes, the LLM designs. Paid is visible first.\n\n# pack\nplatformer · 13 levels · 21 enemies · 15 items\n\n# ui state\n(the latest message's attachments)\n\n# role · foreman\nRoute; never write yourself.",
    };
  }
  async shutdown() {
    return { ok: true, shutting_down: true };
  }

  /** Where `mock:` service commands land (the actions layer installs it). */
  onServiceState(hook: (state: Record<string, unknown>) => void) {
    this.serviceHook = hook;
  }

  // -------------------------------------------------------------------------

  async sendMessage(id: string, body: SendBody, onEvent: (ev: AgentEvent) => void): Promise<void> {
    const c = this.convs.get(id);
    if (!c) throw new Error(`404 no conversation ${id}`);
    if (c.streaming) throw new Error(`409 conversation ${id} already has a turn in flight`);
    c.streaming = true;
    c.cancelled = false;
    c.lines.push({ type: "user", content: body.text, ts: new Date().toISOString() });
    const emit: Emit = (event, data = {}) => {
      onEvent({ event, data });
      if (event !== "text_delta" && event !== "thinking_delta" && event !== "message_start") {
        c.lines.push({ type: event, ...data, ts: new Date().toISOString() });
      }
    };
    const s = new ScriptCtx(this, c, emit);
    currentMode = body.mode ?? "ask";
    try {
      const script = pickScript(body.text, body.mode ?? "ask");
      await script(s, body.text);
      c.turns += 1;
      emit("done", { stop_reason: "end_turn", usage: s.usage, conversation: id });
    } catch (e) {
      if (e instanceof Cancelled) {
        emit("cancelled", { landed: s.landed, usage: s.usage, costCents: null });
        emit("done", { stop_reason: "cancelled", usage: s.usage, conversation: id });
      } else {
        emit("error", {
          message: e instanceof Error ? e.message : String(e),
          retryable: e instanceof ProviderFailure,
          status: e instanceof ProviderFailure ? 529 : undefined,
          provider: e instanceof ProviderFailure ? "anthropic" : undefined,
          conversation: id,
        });
      }
    } finally {
      c.streaming = false;
    }
  }

  // Internals used by ScriptCtx.
  _nextRun() {
    this.runSeq += 1;
    return `run_${this.runSeq.toString(16).padStart(4, "0")}`;
  }
  _nextJob() {
    this.jobSeq += 1;
    return `agentjob-${this.jobSeq}`;
  }
  _pending(
    c: Conv,
    meta: {
      tool: string;
      specialist: string;
      always_allowed: boolean;
      always_reason: string | null;
    },
  ) {
    const requestId = `perm_${Math.random().toString(16).slice(2, 10)}`;
    const d = deferred<{ decision: string; reason?: string }>();
    c.pending.set(requestId, d);
    this.pendingMeta.set(requestId, meta);
    return { requestId, promise: d.promise };
  }
  _plan(c: Conv) {
    const planId = `plan_${Math.random().toString(16).slice(2, 10)}`;
    const d = deferred<{ decision: string; steps?: unknown[] }>();
    c.plans.set(planId, d);
    return { planId, promise: d.promise };
  }
  _granted(tool: string) {
    return this.grants.some((g) => g.tool === tool);
  }
  _service(state: Record<string, unknown>) {
    this.serviceHook?.(state);
  }
}

// ---------------------------------------------------------------------------
// Script helpers
// ---------------------------------------------------------------------------

class ScriptCtx {
  usage = { input_tokens: 0, output_tokens: 0 };
  landed: string[] = [];
  constructor(
    public t: ScriptedAgentTransport,
    public c: Conv,
    public emit: Emit,
  ) {}
  async sleep(ms: number) {
    if (this.c.cancelled) throw new Cancelled();
    if (this.t.speed > 0) await new Promise((r) => setTimeout(r, ms * this.t.speed));
    if (this.c.cancelled) throw new Cancelled();
  }
  /** Stream a reply word by word. */
  async say(text: string, opts: { chips?: string[]; relay?: (ev: AgentEvent) => void } = {}) {
    const e: Emit = opts.relay ? (event, data = {}) => opts.relay!({ event, data }) : this.emit;
    e("message_start", { model: this.c.model ?? "fake" });
    const words = text.split(/(\s+)/);
    let i = 0;
    for (const w of words) {
      if (!w) continue;
      e("text_delta", { index: 0, text: w });
      i += 1;
      if (i % 3 === 0) await this.sleep(28);
    }
    const out = Math.max(1, Math.round(text.length / 4));
    this.usage.output_tokens += out;
    this.usage.input_tokens += 40;
    e("message_stop", {
      stop_reason: "end_turn",
      usage: { input_tokens: 40, output_tokens: out },
      content: [{ type: "text", text }],
    });
    if (!opts.relay) this.c.lines.push({ type: "assistant", content: [{ type: "text", text }] });
    if (opts.chips) e("follow_ups", { chips: opts.chips });
  }
  async read(
    name: string,
    input: Record<string, unknown>,
    result: unknown,
    label: string,
    relay?: (ev: AgentEvent) => void,
  ) {
    const e: Emit = relay ? (event, data = {}) => relay({ event, data }) : this.emit;
    e("tool_call", { name, input, tier: "auto", label });
    await this.sleep(120);
    e("tool_result", { name, is_error: false, result });
  }
  /** Ask-tier write: chip unless granted; then the write lands. */
  async write(opts: {
    name: string;
    input: Record<string, unknown>;
    specialist: string;
    target: string;
    mode: string;
    result: Record<string, unknown>;
    insteadNote?: string;
    relay?: (ev: AgentEvent) => void;
    batchId?: string;
    /** A step of an approved plan: the approval covered it (README §7). */
    approved?: boolean;
  }): Promise<boolean> {
    const e: Emit = opts.relay ? (event, data = {}) => opts.relay!({ event, data }) : this.emit;
    e("tool_call", { name: opts.name, input: opts.input, tier: "ask", label: opts.target });
    await this.sleep(80);
    if (opts.approved || (this.t._granted(opts.name) && opts.mode === "allow")) {
      await this.sleep(300);
      e("tool_result", {
        name: opts.name,
        is_error: false,
        granted: true,
        result: { ...opts.result, batchId: opts.batchId },
      });
      this.landed.push(opts.target);
      return true;
    }
    const alwaysAllowed = opts.mode === "allow";
    const alwaysReason =
      opts.mode === "allow"
        ? null
        : opts.mode === "plan"
          ? "plan mode asks like Ask mode — grants are made in Allow mode"
          : "grants are made in Allow mode — switch the header to Allow to enable “Always allow in this project”";
    const { requestId, promise } = this.t._pending(this.c, {
      tool: opts.name,
      specialist: opts.specialist,
      always_allowed: alwaysAllowed,
      always_reason: alwaysReason,
    });
    e("permission_request", {
      request_id: requestId,
      conversation: this.c.id,
      tool: opts.name,
      input: opts.input,
      tier: "ask",
      actor: agentActor(this.c.id, opts.specialist),
      specialist: opts.specialist,
      target: opts.target,
      touches: "writes level/*.json",
      mode: opts.mode,
      always_allowed: alwaysAllowed,
      always_reason: alwaysReason,
      pack: this.t.pack,
    });
    const answer = await promise;
    if (this.c.cancelled) throw new Cancelled();
    e("permission_decision", {
      request_id: requestId,
      tool: opts.name,
      decision: answer.decision,
      reason: answer.reason ?? null,
      grant: answer.decision === "always",
      by: USER_ACTOR,
      when: new Date().toISOString(),
    });
    if (answer.decision === "reject") {
      await this.sleep(60);
      e("tool_result", {
        name: opts.name,
        is_error: true,
        error: `rejected by the user${answer.reason ? `: ${answer.reason}` : ""}`,
      });
      e("rejected_instead", {
        request_id: requestId,
        text:
          opts.insteadNote ??
          "Continued with the rest of the task and skipped the checkpoint pass that depended on it.",
      });
      return false;
    }
    await this.sleep(320);
    e("tool_result", {
      name: opts.name,
      is_error: false,
      result: { ...opts.result, batchId: opts.batchId },
    });
    this.landed.push(opts.target);
    return true;
  }
  /** Paid tool: estimate chip → decision → running heartbeat → result / stopped. */
  async paid(opts: {
    name: string;
    specialist: string;
    target: string;
    units: string[];
    lowCents: number;
    highCents: number;
    relay?: (ev: AgentEvent) => void;
    runId?: string;
    label: string;
    showMe?: Record<string, unknown>;
  }): Promise<"ok" | "stopped" | "rejected"> {
    const e: Emit = opts.relay ? (event, data = {}) => opts.relay!({ event, data }) : this.emit;
    const estimate = {
      state: "estimate",
      lowCents: opts.lowCents,
      highCents: opts.highCents,
      backend: "fal",
      model: "flux-pixel-v2",
      unitCount: opts.units.length,
      unitLabel: `${opts.units.length} sprites × 2 passes`,
      todaySpendCents: 186,
    };
    e("tool_call", {
      name: opts.name,
      input: { target: opts.target, count: opts.units.length },
      tier: "paid",
      label: opts.label,
      paid: estimate,
    });
    const { requestId, promise } = this.t._pending(this.c, {
      tool: opts.name,
      specialist: opts.specialist,
      always_allowed: false,
      always_reason:
        "paid is never Always-allowable — a paid action confirms every time, in every mode",
    });
    e("permission_request", {
      request_id: requestId,
      conversation: this.c.id,
      tool: opts.name,
      input: { target: opts.target },
      tier: "paid",
      actor: agentActor(this.c.id, opts.specialist),
      specialist: opts.specialist,
      target: opts.label,
      touches: "writes sprites/*.png; spends",
      mode: "ask",
      always_allowed: false,
      always_reason:
        "paid is never Always-allowable — a paid action confirms every time, in every mode",
      pack: this.t.pack,
      paid: estimate,
    });
    const answer = await promise;
    if (this.c.cancelled) throw new Cancelled();
    e("permission_decision", {
      request_id: requestId,
      tool: opts.name,
      decision: answer.decision,
      reason: answer.reason ?? null,
      grant: false,
      by: USER_ACTOR,
      when: new Date().toISOString(),
    });
    if (answer.decision !== "accept") {
      e("tool_result", { name: opts.name, is_error: true, error: "rejected by the user" });
      e("rejected_instead", {
        request_id: requestId,
        text: "Nothing was generated. The rest of the task went ahead without the new art.",
      });
      return "rejected";
    }
    // The generation runs on the JobQueue like any editor button — one tray.
    const jobId = this.t._nextJob();
    this.emit("job", {
      id: jobId,
      op: "sprite",
      label: `Generate sprites ×${opts.units.length} · ${opts.target}`,
      target: opts.target.replace(/^enemy:/, ""),
      targetType: "enemies",
      actor: agentActor(this.c.id, opts.specialist),
      estimate: { best: opts.lowCents / 100, worst: opts.highCents / 100 },
      backends: { image: "fal" },
    });
    await this.sleep(60);
    void handleJobEvent({ id: jobId, status: "running" });
    handleJobProgress({ id: jobId, event: "run_start", phases: 1 });
    handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:sprite_art" });
    const started = Date.now();
    const done: string[] = [];
    const per = Math.round(opts.highCents / opts.units.length);
    for (let i = 0; i < opts.units.length; i++) {
      const unit = opts.units[i];
      e("paid_progress", {
        name: opts.name,
        phase: "upscaling",
        item: `${opts.target.replace(/^enemy:/, "")}_${unit}`,
        index: i + 1,
        total: opts.units.length,
        spentCents: Math.round(per * i * 0.75),
        budgetCents: opts.highCents,
        done: done.slice(),
        jobId,
      });
      handleJobProgress({
        id: jobId,
        event: "node_item",
        node: "phase:plat:sprite_art",
        item: unit,
        index: i + 1,
        total: opts.units.length,
      });
      const stopped = await this.waitOrStopped(700, opts.runId, jobId);
      if (stopped) {
        const billed = Math.round(per * done.length * 0.75) + Math.round(per * 0.4);
        void handleJobEvent({
          id: jobId,
          status: "cancelled",
          result: {
            kept: done.slice(),
            not_started: opts.units.slice(i),
            billed_usd: billed / 100,
          },
        });
        e("tool_result", {
          name: opts.name,
          is_error: false,
          summary: `stopped after ${done.length} of ${opts.units.length}`,
          result: { kept: done, not_started: opts.units.slice(i) },
          paid: {
            state: "stopped",
            stoppedAtMs: Date.now() - started,
            billedCents: billed,
            estimateCents: opts.highCents,
            kept: done.slice(),
            notStarted: opts.units.slice(i),
            finishLastCents: per,
          },
        });
        this.landed.push(...done.map((d) => `${opts.target}:${d}`));
        return "stopped";
      }
      done.push(unit);
      this.landed.push(`${opts.target}:${unit}`);
    }
    handleJobProgress({ id: jobId, event: "node_done", node: "phase:plat:sprite_art" });
    handleJobProgress({ id: jobId, event: "run_end", ok: true });
    const actual = Math.round(opts.highCents * 0.8);
    void handleJobEvent({
      id: jobId,
      status: "done",
      result: {
        changed: true,
        id: opts.target.replace(/^enemy:/, ""),
        cost: {
          usd: actual / 100,
          input_tokens: 0,
          output_tokens: 0,
          calls: opts.units.length,
          backend: "fal",
        },
      },
    });
    e("tool_result", {
      name: opts.name,
      is_error: false,
      summary: `${opts.units.length} sprites generated`,
      result: { generated: opts.units, show_me: opts.showMe },
      paid: {
        state: "result",
        label: `${opts.units.length} sprites generated`,
        actualCents: actual,
        thumbnails: opts.units.map(() => SPRITE_PNG),
        durationMs: Date.now() - started,
        backend: "fal",
        model: "flux-pixel-v2",
        showMe: opts.showMe,
      },
    });
    return "ok";
  }
  /** Sleep, but wake early when the run / job / conversation was stopped. */
  async waitOrStopped(ms: number, runId: string | undefined, jobId: string): Promise<boolean> {
    const step = 40;
    let waited = 0;
    const total = this.t.speed > 0 ? ms * this.t.speed : 0;
    do {
      if (this.c.cancelled) return true;
      if (runId && this.c.runsCancelled.has(runId)) return true;
      if (cancelledJobs.has(jobId)) return true;
      if (total > 0) await new Promise((r) => setTimeout(r, Math.min(step, total - waited)));
      waited += step;
    } while (waited < total);
    return (
      this.c.cancelled || (!!runId && this.c.runsCancelled.has(runId)) || cancelledJobs.has(jobId)
    );
  }
  /** A specialist run: nested events relayed through `run_progress`. */
  async run(
    specialist: string,
    task: string,
    body: (
      relay: (ev: AgentEvent) => void,
      runId: string,
    ) => Promise<{ summary: string; costCents: number }>,
    routing?: string,
  ): Promise<{ runId: string; status: string }> {
    const runId = this.t._nextRun();
    this.emit("run_start", { run_id: runId, conversation: this.c.id, specialist, task, routing });
    const relay = (ev: AgentEvent) =>
      this.emit("run_progress", { run_id: runId, event: { type: ev.event, ...ev.data } });
    try {
      const out = await body(relay, runId);
      if (this.c.runsCancelled.has(runId)) {
        this.emit("run_end", {
          run_id: runId,
          status: "cancelled",
          usage: { input_tokens: 60, output_tokens: 20 },
          costCents: 1,
          summary: out.summary,
          resume: "Resume from where it stopped",
        });
        return { runId, status: "cancelled" };
      }
      this.emit("run_end", {
        run_id: runId,
        status: "ok",
        usage: { input_tokens: 120, output_tokens: 60 },
        costCents: out.costCents,
        summary: out.summary,
      });
      return { runId, status: "ok" };
    } catch (e) {
      if (e instanceof Cancelled) {
        this.emit("run_end", {
          run_id: runId,
          status: "cancelled",
          usage: { input_tokens: 60, output_tokens: 20 },
          costCents: 1,
          summary: "stopped",
        });
        throw e;
      }
      this.emit("run_end", {
        run_id: runId,
        status: "failed",
        usage: {},
        costCents: 1,
        summary: String(e),
      });
      return { runId, status: "failed" };
    }
  }
  /** Was this run stopped by its own ⏹? (throws Cancelled for the whole
   *  conversation's Stop). */
  runStopped(runId: string): boolean {
    if (this.c.cancelled) throw new Cancelled();
    return this.c.runsCancelled.has(runId);
  }
}

/** Jobs the tray's ⏹ cancelled — the mock `cancel_job` marks them here. */
export const cancelledJobs = new Set<string>();

// ---------------------------------------------------------------------------
// The scripts
// ---------------------------------------------------------------------------

type Script = (s: ScriptCtx, text: string) => Promise<void>;

export function pickScript(text: string, mode: string): Script {
  const t = text.trim().toLowerCase();
  if (t.startsWith("mock:")) return mockCommand;
  if (/error:?\s*529|overloaded/.test(t)) return providerError;
  if (/error:?\s*nokey|no key|missing key/.test(t)) return missingKey;
  if (mode === "plan" && /halt|fail/.test(t)) return planHalted;
  if (mode === "plan") return planScript;
  if (/rewrite|dialogue|refusal line/.test(t)) return askDisabledChip;
  if (/rarity|row|field/.test(t)) return fieldsWrite;
  if (/gravity|code|\.py|hopper\.py/.test(t)) return codeWrite;
  if (/sprite|generate|variant/.test(t)) return paidOnly;
  if (/tier|place|hopper|second enemy|fix the back half|colder/.test(t)) return runsScript;
  if (/show me|show/.test(t)) return showUser;
  if (/image|render|screenshot/.test(t)) return attachImage;
  if (/ask me|question|which/.test(t)) return requestInput;
  if (/unreachable|exits|validate|check every/.test(t)) return playtest;
  return conversation;
}

const conversation: Script = async (s) => {
  await s.read(
    "describe_level",
    { level_id: "l2" },
    { level_id: "l2", size: "53×16", enemies: 11, items: 5 },
    "read level 2-2",
  );
  await s.read(
    "describe_level",
    { level_id: "l3" },
    { level_id: "l3", size: "53×16", enemies: 11, items: 4 },
    "read level 2-3",
  );
  await s.say(
    "It isn't the enemy count — both levels have eleven. It's the spacing. 2-2 puts something in your way every 4 to 6 tiles; 2-3 front-loads eight of its eleven into the first third, then runs 19 tiles of empty platform to the exit.\n\nThe back half also has no vertical work. Every platform east of x=30 sits at y=6, so there's nothing to climb and nothing to fall off.\n\nIs that a problem, or is it a rest beat before the boss?",
  );
  await s.sleep(200);
  await s.say(
    'A rest beat, if the run before it earned one. It doesn\'t here — 2-2 ends on a checkpoint and a wide platform, so the player is already rested when they arrive.\n\nYour own pacing note says the same thing:\n\n> bible/pacing.md · line 34\n> "no two consecutive rests. the grove should tighten as the lantern dims."\n\nIf you want the rest, move it to 2-4 where the lantern is at its lowest and the quiet reads as dread rather than absence.',
    { chips: ["Show me the spacing in both", "Fix the back half", "Leave it"] },
  );
};

const runsScript: Script = async (s, text) => {
  const mode = modeOf(text);
  await s.say(
    "Two jobs, then. I'll bring the hopper tier into both levels and ask the artist for a cooler east palette on `tileset:ember_grove`.",
  );
  const artist = s.run(
    "artist",
    "Cooler east palette on ember_grove",
    async (relay) => {
      await s.read(
        "db_row",
        { type: "tilesets", id: "ember_grove" },
        { tiles: 8, palette: "warm-autumn" },
        "read tileset:ember_grove",
        relay,
      );
      await s.sleep(400);
      await s.write({
        name: "update_row",
        input: { type: "tilesets", id: "ember_grove", fields: ["palette"] },
        specialist: "artist",
        target: "re-tint east columns on tileset:ember_grove",
        mode,
        relay,
        result: {
          summary: "re-tinted east columns",
          show_me: { kind: "entity", typeId: "tilesets", id: "ember_grove" },
          diff: {
            kind: "fields",
            target: "tileset:ember_grove",
            fields: [
              { name: "palette", old: "warm-autumn", new: "warm-autumn → cold-east" },
              { name: "east_tint", old: "#b8804a", new: "#6a8fb5" },
            ],
            unchanged: 6,
          },
          journal: [
            {
              artifact_id: "tileset:ember_grove",
              op: "edit",
              before_hash: "a1b2c3d4e5f6",
              after_hash: "0f1e2d3c4b5a",
            },
          ],
        },
      });
      return { summary: "re-tinted east columns", costCents: 31 };
    },
    "routed to the artist — palette work",
  );
  await s.run(
    "level_designer",
    "Second enemy tier in 2-3 and 2-4",
    async (relay, runId) => {
      await s.read(
        "export_level",
        { level_id: "l3" },
        { level_id: "l3", grid: "53×16" },
        "read level 2-3, level 2-4, enemy:ember_hopper",
        relay,
      );
      await s.sleep(300);
      if (s.runStopped(runId)) return { summary: "stopped before writing", costCents: 1 };
      const ok = await s.write({
        name: "apply_level_edit",
        input: { level_id: "l3", sparse_edits: { entities: [] } },
        specialist: "level_designer",
        target: "place 6 enemies in 2-3",
        mode,
        relay,
        result: {
          summary: "placed 6 enemies in 2-3",
          show_me: { kind: "entity", typeId: "levels", id: "l3" },
          diff: {
            kind: "spatial",
            before: BEFORE,
            after: AFTER,
            added: 6,
            summary: "ember_hopper ×6 · x 13–26, y 5–6 · no overlap with checkpoints",
          },
          journal: [
            {
              artifact_id: "l3",
              op: "edit",
              before_hash: "deadbeef0001",
              after_hash: "deadbeef0002",
            },
          ],
        },
      });
      if (s.runStopped(runId))
        return {
          summary: ok ? "placed 6 enemies in 2-3; 2-4 not started" : "stopped",
          costCents: 4,
        };
      await s.sleep(200);
      await s.write({
        name: "import_level_grids",
        input: { level_id: "l4", layers: { collision: [] } },
        specialist: "level_designer",
        target: "import grids into 2-4",
        mode,
        relay,
        result: {
          summary: "imported 1 grid into 2-4",
          show_me: { kind: "entity", typeId: "levels", id: "l4" },
          diff: {
            kind: "spatial",
            before: BEFORE,
            after: AFTER,
            added: 4,
            summary: "ember_hopper ×4 · x 20–31, y 4–6",
          },
          journal: [
            {
              artifact_id: "l4",
              op: "edit",
              before_hash: "cafe00000001",
              after_hash: "cafe00000002",
            },
          ],
        },
      });
      return { summary: "second tier placed in 2-3 and 2-4", costCents: 9 };
    },
    "routed to the level designer — placements",
  );
  await artist;
  await s.say(
    "Cooler palette is in. Both levels carry the hopper tier now — run the playtester over both before you judge the pacing?",
    {
      chips: ["Run the playtester", "Show me 2-3", "Undo the 2-4 import"],
    },
  );
};

const askDisabledChip: Script = async (s, text) => {
  await s.say("Three nodes on whisper-tam need a refusal beat. I'll have the writer draft them.");
  await s.run("writer", "Refusal line on whisper-tam", async (relay) => {
    await s.read(
      "db_row",
      { type: "npcs", id: "whisper_tam" },
      { name: "Whisper Tam", nodes: 7 },
      "read npc:whisper-tam",
      relay,
    );
    await s.write({
      name: "update_row",
      input: { type: "npcs", id: "whisper_tam", fields: ["dialogue"] },
      specialist: "writer",
      target: "rewrite 3 dialogue nodes on whisper-tam",
      mode: modeOf(text),
      relay,
      insteadNote: "Left the nodes as they were and noted the refusal beat in the brief instead.",
      result: {
        summary: "rewrote 3 dialogue nodes",
        show_me: { kind: "entity", typeId: "npcs", id: "whisper_tam" },
        diff: {
          kind: "fields",
          target: "npc:whisper_tam",
          fields: [
            {
              name: "node_3",
              old: "I have nothing for you.",
              new: "Not while the lantern is lit. Come back in the dark.",
            },
            {
              name: "node_4",
              old: "(empty)",
              new: "You carry it too close. It burns the ones who listen.",
            },
            { name: "node_5", old: "Go.", new: "Go — before it decides you are worth keeping." },
          ],
          unchanged: 4,
        },
        journal: [
          {
            artifact_id: "npc:whisper_tam",
            op: "edit",
            before_hash: "beef00000001",
            after_hash: "beef00000002",
          },
        ],
      },
    });
    return { summary: "refusal line drafted", costCents: 12 };
  });
  await s.say("Drafted. The third node lands the refusal; the other two set it up.");
};

const fieldsWrite: Script = async (s, text) => {
  await s.read(
    "db_row",
    { type: "enemies", id: "ember_hopper" },
    { rarity: "rare", size: 1, habitats: ["forest"] },
    "read enemy:ember_hopper",
  );
  await s.say("Rare is why you never see it. Uncommon, one size up, and let it into the ridge:");
  await s.write({
    name: "update_row",
    input: { type: "enemies", id: "ember_hopper", fields: ["rarity", "size", "habitats"] },
    specialist: "foreman",
    target: "update enemies ember_hopper (rarity, size, habitats)",
    mode: modeOf(text),
    result: {
      summary: "updated 3 fields on enemy:ember_hopper",
      show_me: { kind: "entity", typeId: "enemies", id: "ember_hopper" },
      diff: {
        kind: "fields",
        target: "enemy:ember_hopper",
        fields: [
          { name: "rarity", old: "rare", new: "uncommon" },
          { name: "size", old: 1, new: 2 },
          { name: "habitats", old: "forest", new: "forest, ridge" },
        ],
        unchanged: 11,
      },
      journal: [
        {
          artifact_id: "enemy:ember_hopper",
          op: "edit",
          before_hash: "f00d00000001",
          after_hash: "f00d00000002",
        },
      ],
    },
  });
  await s.say("Done. Validate 2-3 before you play it — the size change moves its hitbox.");
};

const codeWrite: Script = async (s, text) => {
  await s.read(
    "read_pack_file",
    { path: "godot/systems/hopper.py" },
    { lines: 88 },
    "read systems/hopper.py",
  );
  await s.say("Ember tiles should soften gravity for the hopper. One branch in `step`:");
  await s.write({
    name: "edit_project_code",
    input: { path: "systems/hopper.py" },
    specialist: "game_coder",
    target: "edit systems/hopper.py",
    mode: modeOf(text),
    result: {
      summary: "1 file · +3 −1",
      show_me: { kind: "entity", typeId: "enemies", id: "ember_hopper" },
      diff: { kind: "code", path: "systems/hopper.py", unified: CODE_DIFF, added: 3, removed: 1 },
      journal: [
        {
          artifact_id: "code:systems/hopper.py",
          op: "edit",
          before_hash: "c0de00000001",
          after_hash: "c0de00000002",
        },
      ],
    },
  });
  await s.say(
    "Boots clean and passes the scripted smoke. The pack is stamped modified; restore is one click on the card.",
  );
};

const paidOnly: Script = async (s) => {
  await s.say("A cold variant means four new frames. That's paid work, so here's the price first:");
  await s.run("artist", "Cold variant of the hopper sprite", async (relay, runId) => {
    const out = await s.paid({
      name: "generate_sprites",
      specialist: "artist",
      target: "enemy:ember_hopper",
      units: ["base", "hurt", "jump", "fall"],
      lowCents: 48,
      highCents: 64,
      relay,
      runId,
      label: "generate 4 sprites for enemy:ember_hopper",
      showMe: { kind: "entity", typeId: "enemies", id: "ember_hopper" },
    });
    return {
      summary:
        out === "ok"
          ? "4 sprites generated"
          : out === "stopped"
            ? "stopped mid-generation"
            : "nothing generated",
      costCents: out === "ok" ? 51 : out === "stopped" ? 36 : 0,
    };
  });
  await s.say(
    "Sprites are in the library. Assign them from the actor's Animation tab when you're ready.",
  );
};

const planScript: Script = async (s) => {
  await s.say(
    "Here's the batch. One approval runs it; the paid step still asks when it gets there.",
  );
  const { planId, promise } = s.t._plan(s.c);
  const steps = [
    { text: "Read 2-3, 2-4 and the hopper row", tier: "read", specialist: "level_designer" },
    { text: "Place 6 hoppers in 2-3, 4 in 2-4", tier: "write", specialist: "level_designer" },
    { text: "Re-tint the east tile columns cooler", tier: "write", specialist: "artist" },
    {
      text: "Generate a cold variant of the hopper sprite",
      tier: "paid",
      specialist: "artist",
      estimate: { lowCents: 48, highCents: 64 },
    },
    { text: "Simulate both levels for reachability", tier: "read", specialist: "playtester" },
  ];
  s.emit("plan_proposed", {
    plan_id: planId,
    title: "Make the ember grove harder east of the stair",
    steps,
  });
  const decision = await promise;
  if (s.c.cancelled) throw new Cancelled();
  if (decision.decision === "reject") {
    await s.say("Discarded. Tell me what to change and I'll re-propose.");
    return;
  }
  if (decision.decision === "edit") {
    await s.say("Edited plan received — say the word and I'll run it.");
    return;
  }
  const step = (index: number, status: string, extra: Record<string, unknown> = {}) =>
    s.emit("plan_step", { plan_id: planId, index, status, ...extra });
  step(0, "running");
  await s.read(
    "describe_level",
    { level_id: "l3" },
    { size: "53×16" },
    "read level 2-3, level 2-4, enemy:ember_hopper",
  );
  step(0, "done", { duration_ms: 4000 });
  step(1, "running");
  await s.run("level_designer", "Place 6 hoppers in 2-3, 4 in 2-4", async (relay) => {
    await s.write({
      name: "apply_level_edit",
      input: { level_id: "l3", sparse_edits: { entities: [] } },
      specialist: "level_designer",
      target: "place 6 enemies in 2-3",
      mode: "allow",
      relay,
      batchId: planId,
      approved: true,
      result: {
        summary: "placed 6 enemies in 2-3",
        show_me: { kind: "entity", typeId: "levels", id: "l3" },
        diff: {
          kind: "spatial",
          before: BEFORE,
          after: AFTER,
          added: 6,
          summary: "ember_hopper ×6",
        },
        journal: [
          {
            artifact_id: "l3",
            op: "edit",
            before_hash: "deadbeef0001",
            after_hash: "deadbeef0002",
          },
        ],
      },
    });
    await s.write({
      name: "apply_level_edit",
      input: { level_id: "l4", sparse_edits: { entities: [] } },
      specialist: "level_designer",
      target: "place 4 enemies in 2-4",
      mode: "allow",
      relay,
      batchId: planId,
      approved: true,
      result: {
        summary: "placed 4 enemies in 2-4",
        show_me: { kind: "entity", typeId: "levels", id: "l4" },
        diff: {
          kind: "spatial",
          before: BEFORE,
          after: AFTER,
          added: 4,
          summary: "ember_hopper ×4",
        },
        journal: [
          {
            artifact_id: "l4",
            op: "edit",
            before_hash: "cafe00000001",
            after_hash: "cafe00000002",
          },
        ],
      },
    });
    return { summary: "placed 10 hoppers", costCents: 9 };
  });
  step(1, "done", { duration_ms: 31000, show_me: { kind: "entity", typeId: "levels", id: "l3" } });
  step(2, "running");
  await s.run("artist", "Re-tint east tile columns", async (relay) => {
    await s.write({
      name: "update_row",
      input: { type: "tilesets", id: "ember_grove", fields: ["palette"] },
      specialist: "artist",
      target: "re-tint 14 columns on tileset:ember_grove",
      mode: "allow",
      relay,
      batchId: planId,
      approved: true,
      result: {
        summary: "re-tinted 14 columns",
        show_me: { kind: "entity", typeId: "tilesets", id: "ember_grove" },
        diff: {
          kind: "fields",
          target: "tileset:ember_grove",
          fields: [{ name: "east_tint", old: "#b8804a", new: "#6a8fb5" }],
          unchanged: 7,
        },
        journal: [
          {
            artifact_id: "tileset:ember_grove",
            op: "edit",
            before_hash: "a1b2c3d4e5f6",
            after_hash: "0f1e2d3c4b5a",
          },
        ],
      },
    });
    return { summary: "re-tinted 14 columns", costCents: 11 };
  });
  step(2, "done", {
    duration_ms: 44000,
    show_me: { kind: "entity", typeId: "tilesets", id: "ember_grove" },
  });
  step(3, "running");
  const paid = await s.run("artist", "Cold hopper variant", async (relay, runId) => {
    const out = await s.paid({
      name: "generate_sprites",
      specialist: "artist",
      target: "enemy:ember_hopper",
      units: ["base", "hurt", "jump", "fall"],
      lowCents: 48,
      highCents: 64,
      relay,
      runId,
      label: "generate 4 sprites for enemy:ember_hopper",
      showMe: { kind: "entity", typeId: "enemies", id: "ember_hopper" },
    });
    return {
      summary: out === "ok" ? "4 frames generated" : "no frames",
      costCents: out === "ok" ? 51 : 0,
    };
  });
  step(3, paid.status === "ok" ? "done" : "skipped", {
    duration_ms: 72000,
    billedCents: paid.status === "ok" ? 51 : 0,
    show_me: { kind: "entity", typeId: "enemies", id: "ember_hopper" },
  });
  step(4, "running");
  await s.run("playtester", "Simulate both levels", async (relay) => {
    await s.read("validate_level", { level_id: "l3" }, { ok: true }, "validate level 2-3", relay);
    await s.read("validate_level", { level_id: "l4" }, { ok: true }, "validate level 2-4", relay);
    return { summary: "both reachable", costCents: 2 };
  });
  step(4, "done", { duration_ms: 20000, costCents: 63 });
  await s.say(
    "Plan complete — 2-3 and 2-4 carry the tier, the east reads colder, and both simulate reachable.",
  );
};

const planHalted: Script = async (s) => {
  await s.say("Here's the batch. Step 4 is paid and will ask when reached.");
  const { planId, promise } = s.t._plan(s.c);
  s.emit("plan_proposed", {
    plan_id: planId,
    title: "Make the ember grove harder east of the stair",
    steps: [
      { text: "Read 2-3, 2-4 and the hopper row", tier: "read", specialist: "level_designer" },
      { text: "Place 6 hoppers in 2-3, 4 in 2-4", tier: "write", specialist: "level_designer" },
      { text: "Re-tint the east tile columns cooler", tier: "write", specialist: "artist" },
      {
        text: "Generate a cold variant of the hopper sprite",
        tier: "paid",
        specialist: "artist",
        estimate: { lowCents: 48, highCents: 64 },
      },
      { text: "Simulate both levels for reachability", tier: "read", specialist: "playtester" },
    ],
  });
  const decision = await promise;
  if (s.c.cancelled) throw new Cancelled();
  if (decision.decision !== "approve") {
    await s.say("Discarded.");
    return;
  }
  const step = (index: number, status: string, extra: Record<string, unknown> = {}) =>
    s.emit("plan_step", { plan_id: planId, index, status, ...extra });
  step(0, "running");
  await s.sleep(300);
  step(0, "done", { duration_ms: 4000 });
  step(1, "running");
  await s.write({
    name: "apply_level_edit",
    input: { level_id: "l3", sparse_edits: {} },
    specialist: "level_designer",
    target: "place 10 hoppers",
    mode: "allow",
    batchId: planId,
    approved: true,
    result: {
      summary: "placed 10 hoppers",
      show_me: { kind: "entity", typeId: "levels", id: "l3" },
      journal: [
        { artifact_id: "l3", op: "edit", before_hash: "deadbeef0001", after_hash: "deadbeef0002" },
      ],
    },
  });
  step(1, "done", { duration_ms: 31000, show_me: { kind: "entity", typeId: "levels", id: "l3" } });
  step(2, "running");
  await s.write({
    name: "update_row",
    input: { type: "tilesets", id: "ember_grove", fields: ["palette"] },
    specialist: "artist",
    target: "re-tint 14 columns",
    mode: "allow",
    batchId: planId,
    approved: true,
    result: {
      summary: "re-tinted 14 columns",
      show_me: { kind: "entity", typeId: "tilesets", id: "ember_grove" },
      journal: [
        {
          artifact_id: "tileset:ember_grove",
          op: "edit",
          before_hash: "a1b2c3d4e5f6",
          after_hash: "0f1e2d3c4b5a",
        },
      ],
    },
  });
  step(2, "done", {
    duration_ms: 44000,
    show_me: { kind: "entity", typeId: "tilesets", id: "ember_grove" },
  });
  step(3, "running");
  await s.sleep(500);
  s.emit("plan_halted", {
    plan_id: planId,
    index: 3,
    error:
      "Sprite generation failed — fal returned 429 after 2 retries · billed $0.12 of $0.64. Rate limited, not rejected; retrying in a few minutes usually clears it.",
    billedCents: 12,
    // The service sends ACTION TOKENS here (canon `runs.HALT_OPTIONS`), not
    // button copy; the card owns the README's wording.
    options: ["continue", "skip", "undo", "stop"],
  });
  // The halted card's ways out POST to `…/plans/{id}/resume` (continue |
  // skip | stop) or `…/plans/{id}/undo`, never to the decision endpoint.
  const dd = deferred<{ action: string }>();
  s.c.resumes.set(planId, dd);
  const choice = await dd.promise;
  if (s.c.cancelled) throw new Cancelled();
  // The service answers the resume with `plan_resumed` (undo answers with
  // `plan_undone`, which `undoPlan`'s caller already dispatched).
  if (choice.action !== "undo") s.emit("plan_resumed", { plan_id: planId, action: choice.action });
  if (choice.action === "continue") {
    step(3, "running");
    await s.sleep(400);
    step(3, "done", { duration_ms: 65000, billedCents: 51 });
    step(4, "running");
    await s.sleep(300);
    step(4, "done", { duration_ms: 20000 });
    await s.say("Cleared on the retry. Plan complete.");
  } else if (choice.action === "skip") {
    step(3, "skipped");
    step(4, "running");
    await s.sleep(300);
    step(4, "done", { duration_ms: 20000 });
    await s.say("Skipped the sprite. Both levels simulate reachable.");
  } else if (choice.action === "undo") {
    // `undoPlan` already answered the caller (which dispatches `plan_undone`);
    // the script only says what the transcript should carry.
    await s.say("Steps 1–3 reverted as one History entry. The $0.12 stays on the ledger.");
  } else {
    await s.say("Stopped here. What landed stays; nothing else starts.");
  }
};

const providerError: Script = async (s) => {
  s.emit("message_start", { model: s.c.model ?? "fake" });
  const partial = "The east columns should read colder as the player climbs, so I'll shift the";
  for (const w of partial.split(/(\s+)/)) {
    if (!w) continue;
    s.emit("text_delta", { index: 0, text: w });
    await s.sleep(30);
  }
  await s.sleep(200);
  throw Object.assign(new ProviderFailure(), {});
};
class ProviderFailure extends Error {
  constructor() {
    super("Anthropic returned 529 — overloaded");
  }
}

const missingKey: Script = async (s) => {
  s.emit("error", {
    variant: "missing_key",
    message: "No key for Anthropic",
    key_env: "ANTHROPIC_API_KEY",
    looked_in: ["the env file (CANON_ENV_FILE)", "the environment"],
    provider: "anthropic",
    retryable: false,
    alt: { backend: "openai", model: "gpt-5.1" },
  });
  await s.sleep(10);
};

const mockCommand: Script = async (s, text) => {
  const cmd = text.trim().slice(5).trim().toLowerCase();
  if (cmd === "service-failed" || cmd === "failed") {
    s.t._service({
      status: "failed",
      error: "Nothing answered after 10 seconds.",
      command: "canon agent serve --pack mock://plat_pack --port 0 --parent-pid 4242",
      port: 8787,
      stderr: [
        "INFO canon.agent.service: binding 127.0.0.1:0",
        "Traceback (most recent call last):",
        '  File "canon/agent/service.py", line 712, in main',
        "ModuleNotFoundError: No module named 'uvicorn'",
      ],
    });
    return;
  }
  if (cmd === "starting") {
    s.t._service({ status: "starting", startedAt: Date.now(), error: null });
    return;
  }
  if (cmd === "ready") {
    s.t._service({ status: "ready", error: null });
    return;
  }
  await s.say(`Unknown mock command "${cmd}". Try mock:service-failed, mock:starting, mock:ready.`);
};

const showUser: Script = async (s) => {
  await s.say("Opening 2-3 with the placements selected.");
  s.emit("tool_call", {
    name: "show_user",
    input: { selection: "level", level_id: "l3" },
    tier: "auto",
    label: "show 2-3",
  });
  await s.sleep(80);
  s.emit("tool_result", { name: "show_user", is_error: false, result: { ack: true } });
  await s.say("That's the back half — the empty run starts at x=30.");
};

const attachImage: Script = async (s) => {
  await s.say("Here's the current hopper sprite at 8×:");
  s.emit("tool_call", {
    name: "attach_image",
    input: { path: "sprites/ember_hopper.png" },
    tier: "auto",
    label: "attach sprites/ember_hopper.png",
  });
  s.emit("attach_image", {
    path: "sprites/ember_hopper.png",
    src: SPRITE_PNG,
    alt: "ember hopper sprite",
  });
  s.emit("tool_result", { name: "attach_image", is_error: false, result: { ack: true } });
  await s.say("The palette is what reads warm — the outline is fine.");
};

const requestInput: Script = async (s) => {
  await s.say("One thing before I build it:");
  s.emit("tool_call", {
    name: "request_input",
    input: { question: "Continuous climb, or separate areas?" },
    tier: "auto",
    label: "ask",
  });
  s.emit("request_input", {
    request_id: "q_1",
    question: "Should the harbour be one continuous climb, or separate areas you unlock?",
    options: ["Continuous climb", "Separate areas"],
  });
  s.emit("tool_result", { name: "request_input", is_error: false, result: { ack: true } });
};

const playtest: Script = async (s) => {
  await s.say("Sweeping every level for an unreachable exit.");
  await s.run("playtester", "Reachability sweep", async (relay, runId) => {
    const levels = ["l1", "l2", "l3", "l4", "l5"];
    const done: string[] = [];
    for (const l of levels) {
      if (s.runStopped(runId)) break;
      await s.read(
        "validate_level",
        { level_id: l },
        { ok: true, level_id: l },
        `validate level ${l}`,
        relay,
      );
      done.push(l);
      await s.sleep(350);
    }
    if (s.runStopped(runId)) {
      relay({
        event: "note",
        data: {
          text: `✓ ${done.join(", ")} simulated — all reachable · — ${levels.filter((l) => !done.includes(l)).join(", ")} not simulated · No writes.`,
        },
      });
      return { summary: `${done.length} of ${levels.length} simulated`, costCents: 1 };
    }
    return { summary: "all reachable", costCents: 2 };
  });
  await s.say("Every exit is reachable under the levels' own physics.");
};

function modeOf(text: string): string {
  const m = text.match(/\bmode:(ask|plan|allow)\b/i);
  return m ? m[1].toLowerCase() : currentMode;
}

/** The header's mode at send time — set by `installAgentMock`'s wrapper. */
let currentMode = "ask";
export function setMockMode(mode: string) {
  currentMode = mode;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/** One shared instance so the devMock's `cancel_job` and the actions layer
 *  see the same conversations. */
export const scriptedAgent = new ScriptedAgentTransport();

/** Wrap `sendMessage` so the header's mode reaches the scripts, then hand
 *  the transport to `agentApi`. Called by `installDevMock`. */
export function installAgentMock(
  setTransport: (t: AgentTransport) => void,
): ScriptedAgentTransport {
  const inner = scriptedAgent.sendMessage.bind(scriptedAgent);
  scriptedAgent.sendMessage = (id, body, onEvent) => {
    currentMode = body.mode ?? "ask";
    return inner(id, body, onEvent);
  };
  scriptedAgent.onServiceState((state) => {
    // Delivered as a pseudo-event so the actions layer owns the store write.
    pendingServiceState = state;
    serviceListeners.forEach((fn) => fn(state));
  });
  setTransport(scriptedAgent);
  return scriptedAgent;
}

let pendingServiceState: Record<string, unknown> | null = null;
const serviceListeners = new Set<(s: Record<string, unknown>) => void>();
export function onMockServiceState(fn: (s: Record<string, unknown>) => void): () => void {
  serviceListeners.add(fn);
  if (pendingServiceState) fn(pendingServiceState);
  return () => serviceListeners.delete(fn);
}
