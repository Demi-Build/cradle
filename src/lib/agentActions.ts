// The agent panel's actions — everything the components call (row P1-A5).
//
// Thin functions over `useStore.getState()` and `agentApi`: the service
// lifecycle (start / stop / crash → the named error states of README §3),
// conversations (create, send, edit-and-resend, retry, close, reopen from
// ⏱ history), the round-trips (permission chips, plan approvals, halted-plan
// options, batch undo), Stop in its three places (conversation, run, job),
// and the editor sightings (Show me, the pill). Components stay dumb; the
// reducer (`agentState.ts`) stays pure; this is the glue between them.

import { useStore, type AgentUiPrefs } from "../store";
import { api } from "./invoke";
import {
  agentApi,
  startAgentService,
  stopAgentService,
  type AgentEvent,
  type ModelInfo,
} from "./agent";
import {
  conversationFromTranscript,
  newConversation,
  nextId,
  titleFrom,
  truncateBelow,
  unwrapRunProgress,
  type Conversation,
  type PlanItem,
  type ToolItem,
  type UiContextRef,
} from "./agentState";
import { COLLAPSE_TOAST } from "./agentLayout";
import { showMe, showMeFromToolInput } from "./agentShowMe";
import { FOREMAN, agentActor } from "./actor";

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

let startingFor: string | null = null;

/** Start the sidecar for the open pack (idempotent per pack) and load what
 *  the panel needs from it. Never throws: failures land in `agent.service`
 *  as the "Service failed" state with the command and the reason. */
export async function ensureService(pack: string, opts: { backend?: string; model?: string } = {}) {
  const st = useStore.getState();
  if (!pack) return;
  // A failed service is retried only by the user's Retry (README §3) — no
  // auto-restart after a crash (master §2 anti-goals).
  if (st.agent.service.status === "ready" || st.agent.service.status === "failed") return;
  if (startingFor === pack) return;
  startingFor = pack;
  const command =
    `canon agent serve --pack ${pack} --port 0 --parent-pid <cradle>` +
    `${opts.backend ? ` --backend ${opts.backend}` : ""}${opts.model ? ` --model ${opts.model}` : ""}`;
  st.setAgent((a) => ({
    service: {
      ...a.service,
      status: "starting",
      startedAt: Date.now(),
      error: null,
      stderr: [],
      command,
    },
  }));
  try {
    const r = await startAgentService(pack, opts);
    useStore.getState().setAgent((a) => ({
      service: {
        ...a.service,
        status: "ready",
        port: r.port,
        pid: r.pid,
        error: null,
        command: r.command || command,
        backend: opts.backend ?? null,
        model: opts.model ?? null,
      },
    }));
    await Promise.all([refreshModels(), refreshGrants(), refreshHistory()]);
  } catch (e) {
    let stderr: string[] = [];
    try {
      stderr = (await api.agentStatus()).stderr ?? [];
    } catch {}
    useStore.getState().setAgent((a) => ({
      service: { ...a.service, status: "failed", error: String(e), stderr, command },
    }));
  } finally {
    if (startingFor === pack) startingFor = null;
  }
}

/** Retry after "The agent service didn't start". */
export async function retryService() {
  const st = useStore.getState();
  st.setAgent((a) => ({ service: { ...a.service, status: "stopped" } }));
  startingFor = null;
  await ensureService(st.worldPath);
}

export async function stopService() {
  startingFor = null;
  await stopAgentService();
  useStore.getState().setAgent((a) => ({
    service: { ...a.service, status: "stopped", port: null, pid: null, backend: null, model: null },
  }));
}

/** The Rust supervisor saw the sidecar exit (`agent-exited`). A clean stop
 *  we asked for is not a crash; anything else is the named failure state. */
export function onServiceExited(payload: { code?: number | null; stderr?: string[] }) {
  const st = useStore.getState();
  if (st.agent.service.status === "stopped") return;
  st.setAgent((a) => ({
    service: {
      ...a.service,
      status: "failed",
      port: null,
      pid: null,
      error: `The agent service exited${payload.code != null ? ` with code ${payload.code}` : ""}.`,
      stderr: payload.stderr ?? a.service.stderr,
    },
  }));
  // Every conversation mid-turn is now cut off.
  for (const c of Object.values(st.agent.conversations)) {
    if (c.status === "streaming" || c.status === "awaiting_approval") {
      st.agentDispatch(c.id, {
        event: "error",
        data: {
          variant: "service",
          message: "The agent service exited mid-turn.",
          retryable: true,
        },
      });
    }
  }
}

export async function refreshModels() {
  try {
    const models = await agentApi.models();
    useStore.getState().setAgent({ models });
  } catch {
    /* the picker renders the current model alone */
  }
}
export async function refreshGrants() {
  const st = useStore.getState();
  try {
    const doc = await agentApi.listGrants(st.worldPath || undefined);
    useStore.getState().setAgent({ grants: doc.grants });
  } catch {}
}
export async function refreshHistory() {
  try {
    const history = await agentApi.listConversations();
    useStore.getState().setAgent({ history });
  } catch {}
}
/** The grants list's client half. DEVIATION, declared: the Settings →
 *  Permissions PANE the chip footnote points at ("Revoke in Settings →
 *  Permissions", README §1 "Revoking grants", board 07) belongs to the
 *  Settings screen, row P0-12 — this row builds the calls and the chip
 *  footnote, P0-12 mounts the surface that calls them. */
export async function revokeGrant(index: number) {
  const st = useStore.getState();
  const doc = await agentApi.revokeGrant(index, st.worldPath || undefined);
  useStore.getState().setAgent({ grants: doc.grants });
}
export async function revokeAllGrants() {
  const st = useStore.getState();
  const doc = await agentApi.revokeAllGrants(st.worldPath || undefined);
  useStore.getState().setAgent({ grants: doc.grants });
}

// ---------------------------------------------------------------------------
// Panel open / collapse
// ---------------------------------------------------------------------------

export function setPanel(patch: Partial<AgentUiPrefs>) {
  useStore.getState().setAgentUi(patch);
}
/** The TopBar icon and ⌘⇧A cycle expanded ⇄ the 40px rail (README §1:
 *  "Collapsed is a 40px rail, not a hidden panel … Toggle from the top bar
 *  icon or ⌘⇧A"; screen 01 cycles expanded → resizing → collapsed rail).
 *  Focus mode is the one state that hides the column entirely. */
export function togglePanel() {
  const ui = useStore.getState().agentUi;
  if (!ui.open) setPanel({ open: true, collapsed: false });
  else setPanel({ collapsed: !ui.collapsed });
}
/** The resize-only rule (README §1): collapse + toast once per window session. */
export function autoCollapse() {
  const st = useStore.getState();
  if (!st.agentUi.open || st.agentUi.collapsed) return;
  st.setAgentUi({ collapsed: true });
  if (!st.agent.collapseToastShown) {
    st.setAgent({ collapseToastShown: true, toast: COLLAPSE_TOAST });
    setTimeout(() => useStore.getState().setAgent({ toast: null }), 6000);
  }
}
export function showToast(text: string) {
  useStore.getState().setAgent({ toast: text });
  setTimeout(() => useStore.getState().setAgent({ toast: null }), 5000);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

function rateFor(conv: Conversation): ModelInfo | null {
  const models = useStore.getState().agent.models;
  return models.find((m) => m.id === conv.model) ?? null;
}

function defaultModel(): string | null {
  const st = useStore.getState();
  // What the sidecar is actually running on wins — the picker must not
  // claim a model the service was never started with.
  if (st.agent.service.model) return st.agent.service.model;
  const available = st.agent.models.find((m) => m.available);
  return available?.id ?? st.agent.models[0]?.id ?? null;
}

/** Open a new tab. The conversation is created locally at once (the
 *  composer stays usable while the service starts — README §3 "Service
 *  starting… non-blocking; queues") and gets its service id on first send. */
export function newConversationTab(opts: { mode?: string; model?: string | null } = {}): string {
  const st = useStore.getState();
  const order = Object.keys(st.agent.conversations).length + 1;
  const id = nextId("local");
  const conv = newConversation(id, {
    order,
    mode: opts.mode ?? st.agent.conversations[st.agent.activeId ?? ""]?.mode ?? "ask",
    model: opts.model === undefined ? defaultModel() : opts.model,
  });
  st.setAgentConversation(conv);
  st.setAgent({ activeId: id });
  return id;
}

export function setActive(id: string) {
  const st = useStore.getState();
  st.setAgent({ activeId: id });
  const c = st.agent.conversations[id];
  if (c?.unreadError) st.patchAgentConversation(id, { unreadError: false });
}

export function setMode(id: string, mode: string) {
  useStore.getState().patchAgentConversation(id, { mode });
}
/** The picked model (README §9) — and the one seam that carries it to the
 *  service. `POST /conversations` has no `model` field and neither does a
 *  user message: the sidecar's `--backend` / `--model` is what a
 *  conversation runs on. So a pick is HELD and applied by the next send,
 *  which restarts the sidecar on that model's provider (transcripts live on
 *  disk, so the open conversations survive). Holding it to the send is what
 *  keeps a pick from cutting off a turn already in flight.
 *
 *  DEVIATION, declared: the sidecar is per PACK, so the model is per pack
 *  for as long as that is the only seam — the picker's per-conversation
 *  promise narrows to "the next message, in this pack" until A4.5 carries a
 *  model on `CreateConversation` / `UserMessage`. The label stays per
 *  conversation, and the price the header quotes is that model's. */
export async function setModel(id: string, model: string) {
  useStore.getState().patchAgentConversation(id, { model });
  const st = useStore.getState();
  const backend = st.agent.models.find((m) => m.id === model)?.provider;
  if (!model || !backend) return;
  const svc = st.agent.service;
  pendingModel = svc.backend === backend && svc.model === model ? null : model;
}

/** Held by `setModel`; applied by the next `sendMessage`. */
let pendingModel: string | null = null;

/** Restart the sidecar on `model`'s provider. Only `sendMessage` calls it,
 *  so the restart never lands in the middle of a turn. */
async function applyModel(model: string): Promise<void> {
  const st = useStore.getState();
  const backend = st.agent.models.find((m) => m.id === model)?.provider;
  pendingModel = null;
  if (!backend || !st.worldPath) return;
  const svc = st.agent.service;
  if (svc.backend === backend && svc.model === model) return;
  showToast(`Restarting the agent service on ${model}.`);
  await stopService();
  await ensureService(st.worldPath, { backend, model });
}

export function setDraft(id: string, draft: string) {
  useStore.getState().patchAgentConversation(id, { draft });
}

/** Middle-click / ✕: closing a tab with a live run asks first (README §2). */
export function closeConversation(
  id: string,
  confirmFn: (q: string) => boolean = () => true,
): boolean {
  const st = useStore.getState();
  const c = st.agent.conversations[id];
  if (!c) return true;
  if (
    (c.status === "streaming" || c.status === "awaiting_approval") &&
    !confirmFn("This conversation has a run in flight. Close it and stop the run?")
  ) {
    return false;
  }
  if (c.status === "streaming" || c.status === "awaiting_approval") void stopConversation(id);
  st.removeAgentConversation(id);
  return true;
}

/** ⏱ history: reopen a stored conversation as a tab. */
export async function openFromHistory(remoteId: string, title?: string): Promise<string | null> {
  const st = useStore.getState();
  const existing = st.agent.conversations[remoteId];
  if (existing) {
    setActive(remoteId);
    return remoteId;
  }
  try {
    const lines = await agentApi.getConversation(remoteId);
    const order = Object.keys(useStore.getState().agent.conversations).length + 1;
    const conv = conversationFromTranscript(lines, { order, title });
    const rate = useStore.getState().agent.models.find((m) => m.id === conv.model) ?? null;
    conv.costCents = rate
      ? Math.round(
          ((conv.usage.input_tokens / 1e6) * rate.input_per_1m +
            (conv.usage.output_tokens / 1e6) * rate.output_per_1m) *
            100 *
            100,
        ) / 100
      : null;
    useStore.getState().setAgentConversation(conv);
    useStore.getState().setAgent({ activeId: conv.id });
    return conv.id;
  } catch (e) {
    showToast(`Could not open that conversation: ${String(e).slice(0, 120)}`);
    return null;
  }
}

/** A local tab gets its service-side conversation on first send; the store
 *  re-keys it so the id the tab shows is the transcript's id. */
async function ensureRemote(localId: string): Promise<string> {
  const st = useStore.getState();
  const conv = st.agent.conversations[localId];
  if (!conv) throw new Error("no such conversation");
  if (!localId.startsWith("local_")) return localId;
  const created = await agentApi.createConversation();
  const remote: Conversation = { ...conv, id: created.id };
  const s2 = useStore.getState();
  const conversations = { ...s2.agent.conversations };
  delete conversations[localId];
  conversations[created.id] = remote;
  s2.setAgent({
    conversations,
    activeId: s2.agent.activeId === localId ? created.id : s2.agent.activeId,
  });
  return created.id;
}

/** Wait for the service to be ready (the queued composer) — up to the
 *  start timeout, then fail into the conversation as the service error. */
async function awaitService(): Promise<boolean> {
  const st = useStore.getState();
  if (st.agent.service.status === "ready") return true;
  if (st.agent.service.status === "stopped") void ensureService(st.worldPath);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const s = useStore.getState().agent.service.status;
    if (s === "ready") return true;
    if (s === "failed") return false;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

/** Send a user message and stream the turn into the conversation. */
export async function sendMessage(
  conversationId: string,
  text: string,
  context: UiContextRef[] = [],
): Promise<void> {
  // A fresh send clears an earlier Stop on this tab.
  abandoned.delete(conversationId);
  // A model picked while the last turn was still running applies here — the
  // sidecar's `--model` is the only seam that carries it.
  if (pendingModel) await applyModel(pendingModel);
  const st = useStore.getState();
  const conv0 = st.agent.conversations[conversationId];
  if (!conv0 || !text.trim()) return;
  const userItem = { kind: "user" as const, id: nextId("u"), text, ts: Date.now(), context };
  const seeded = conv0.items.length === 0;
  st.patchAgentConversation(conversationId, {
    items: [
      ...conv0.items,
      ...(seeded
        ? [{ kind: "rule" as const, ts: Date.now(), label: `Session started ${clock()}` }]
        : []),
      userItem,
    ],
    draft: "",
    title: conv0.title === "New conversation" ? titleFrom(text) : conv0.title,
    status: "streaming",
    unreadError: false,
    pinnedIndex: tabIndexOf(conversationId),
  });
  const ready = await awaitService();
  if (abandoned.has(conversationId)) {
    abandoned.delete(conversationId);
    useStore.getState().patchAgentConversation(conversationId, { status: "idle" });
    return;
  }
  if (!ready) {
    const svc = useStore.getState().agent.service;
    useStore.getState().agentDispatch(conversationId, {
      event: "error",
      data: {
        variant: "service",
        message: svc.error ?? "The agent service didn't start",
        retryable: true,
        stderr: svc.stderr.join("\n"),
      },
    });
    return;
  }
  let id: string;
  try {
    id = await ensureRemote(conversationId);
    if (abandoned.has(conversationId)) {
      abandoned.delete(conversationId);
      useStore.getState().patchAgentConversation(id, { status: "idle" });
      await stopConversation(id);
      return;
    }
  } catch (e) {
    useStore.getState().agentDispatch(conversationId, {
      event: "error",
      data: { variant: "service", message: String(e), retryable: true },
    });
    return;
  }
  const conv = useStore.getState().agent.conversations[id];
  const rate = rateFor(conv);

  const uiState = uiStateFor(context);
  const onEvent = (ev: AgentEvent) => handleEvent(id, ev, rate, id);
  try {
    await agentApi.sendMessage(id, { text, mode: conv.mode, ui_state: uiState }, onEvent);
  } catch (e) {
    const msg = String(e);
    useStore.getState().agentDispatch(id, {
      event: "error",
      data: {
        variant: /Failed to fetch|NetworkError|ECONN/i.test(msg) ? "service" : "generic",
        message: msg,
        retryable: true,
      },
    });
  } finally {
    const after = useStore.getState().agent.conversations[id];
    if (after && after.status === "streaming") {
      // The stream closed without a `done` — never leave a tab pulsing.
      useStore
        .getState()
        .agentDispatch(id, { event: "done", data: { stop_reason: "stream_closed" } });
    }
    useStore.getState().patchAgentConversation(id, { pinnedIndex: null });
    void refreshHistory();
    void hydrateResults(id);
  }
}

function tabIndexOf(id: string): number | null {
  const st = useStore.getState();
  const ids = Object.values(st.agent.conversations)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.id);
  const i = ids.indexOf(id);
  return i < 0 ? null : i;
}

function clock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The `ui_state` body the service folds into the prompt: what the
 *  composer attached, plus what's on screen now. Latest only. */
function uiStateFor(context: UiContextRef[]): Record<string, unknown> {
  const st = useStore.getState();
  return {
    selection: st.selection,
    attached: context.map((c) => ({ kind: c.kind, id: c.id })),
    world: st.world?.name ?? null,
  };
}

/** One place every event goes: the reducer, then the panel-side effects
 *  the UI tools ask for (Phase 1 §4.E: `show_user`, `attach_image`,
 *  `request_input` execute here; `propose_plan` renders via the reducer). */
function handleEvent(
  id: string,
  ev: AgentEvent,
  rate: ModelInfo | null,
  /** The conversation the agent's writes are attributed to; `lib/actor.ts`
   *  is what turns it into an `agent:<conversation>/<specialist>` string. */
  actorConversation: string,
): void {
  const st = useStore.getState();
  if (ev.event === "service_state") {
    // The scripted mock's way of driving the service states headless.
    st.setAgent((a) => ({ service: { ...a.service, ...(ev.data as object) } }));
    return;
  }
  if (ev.event === "job") {
    // An agent-launched JobQueue job (the paid tools enqueue on the same
    // worker): it lands in the one tray with its attribution.
    const j = ev.data as {
      id: string;
      op: string;
      label: string;
      target: string;
      targetType: string;
      actor: string;
      estimate?: { best: number; worst: number };
      backends?: Record<string, string>;
    };
    if (!st.jobs.some((x) => x.id === j.id)) {
      st.addJob({
        id: j.id,
        op: j.op,
        label: j.label,
        target: j.target,
        targetType: j.targetType,
        actor: j.actor,
        estimate: j.estimate,
        backends: j.backends,
        status: "queued",
        ts: Date.now(),
      });
    }
    return;
  }
  st.agentDispatch(id, ev, { rate });
  // UI-tool effects and the editor sightings read nested events too.
  ev = unwrapRunProgress(ev);
  if (ev.event === "tool_call") {
    const name = String(ev.data.name ?? "");
    const input = (ev.data.input ?? {}) as Record<string, unknown>;
    if (name === "show_user") {
      const target = showMeFromToolInput(input);
      if (target) showMe(target);
    }
  }
  if (ev.event === "tool_result") {
    // "Agent changed this" — the editor pill, from the write that just landed.
    const conv = useStore.getState().agent.conversations[id];
    const t = conv ? lastOkWrite(conv, String(ev.data.name ?? "")) : null;
    if (t && t.showMe?.kind === "entity") {
      useStore.getState().setAgent({
        pill: {
          typeId: t.showMe.typeId,
          id: t.showMe.id,
          actor: agentActor(actorConversation, t.specialist ?? FOREMAN),
          what: t.summary ?? t.label,
          ts: Date.now(),
        },
      });
    }
  }
  if (ev.event === "permission_decision" && ev.data.grant) void refreshGrants();
}

function lastOkWrite(conv: Conversation, name: string): ToolItem | null {
  const walk = (items: Conversation["items"]): ToolItem | null => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "tool" && it.name === name && it.status === "ok" && it.tier === "write")
        return it;
      if (it.kind === "run") {
        const inner = walk(it.items);
        if (inner) return inner;
      }
    }
    return null;
  };
  return walk(conv.items);
}

/** After a turn, backfill tool results the stream did not carry from the
 *  stored transcript (`tool_result` lines hold the payload by tool_use id)
 *  — so read lines expand to what the agent saw with the real service too. */
async function hydrateResults(id: string): Promise<void> {
  const st = useStore.getState();
  const conv = st.agent.conversations[id];
  if (!conv || id.startsWith("local_")) return;
  const needs = collectTools(conv.items).some(
    (t) => t.result === undefined && t.status !== "pending",
  );
  if (!needs) return;
  try {
    const lines = await agentApi.getConversation(id);
    const results = new Map<string, unknown>();
    for (const line of lines) {
      if (line.type !== "tool_result") continue;
      for (const b of (line.content as Record<string, unknown>[]) ?? []) {
        if (typeof b?.tool_use_id === "string") {
          let content: unknown = b.content;
          if (typeof content === "string") {
            try {
              content = JSON.parse(content);
            } catch {}
          }
          results.set(b.tool_use_id, content);
        }
      }
    }
    if (!results.size) return;
    const patch = (items: Conversation["items"]): Conversation["items"] =>
      items.map((it) => {
        if (it.kind === "run") return { ...it, items: patch(it.items) };
        if (it.kind === "tool" && it.result === undefined && results.has(it.id)) {
          return { ...it, result: results.get(it.id) };
        }
        return it;
      });
    const cur = useStore.getState().agent.conversations[id];
    if (cur) useStore.getState().patchAgentConversation(id, { items: patch(cur.items) });
  } catch {}
}

function collectTools(items: Conversation["items"]): ToolItem[] {
  const out: ToolItem[] = [];
  for (const it of items) {
    if (it.kind === "tool") out.push(it);
    if (it.kind === "run") out.push(...collectTools(it.items));
  }
  return out;
}

/** ✎ edit-and-resend: truncates below the message (a branch), then sends. */
export async function editAndResend(conversationId: string, userId: string, text: string) {
  const st = useStore.getState();
  const conv = st.agent.conversations[conversationId];
  if (!conv) return;
  const original = conv.items.find((i) => i.kind === "user" && i.id === userId);
  const context = original && original.kind === "user" ? original.context : [];
  st.patchAgentConversation(conversationId, {
    items: truncateBelow(conv.items, userId),
    editingId: null,
  });
  await sendMessage(conversationId, text, context);
}

/** ↻ retry from a user message: same text, branch below it. */
export async function retryFrom(conversationId: string, userId: string) {
  const conv = useStore.getState().agent.conversations[conversationId];
  const item = conv?.items.find((i) => i.kind === "user" && i.id === userId);
  if (!item || item.kind !== "user") return;
  await editAndResend(conversationId, userId, item.text);
}

/** Retry the last user turn (the provider-error card's Retry), optionally
 *  on another model ("Retry on haiku-4.5"). */
export async function retryLast(conversationId: string, model?: string) {
  const conv = useStore.getState().agent.conversations[conversationId];
  if (!conv) return;
  const lastUser = [...conv.items].reverse().find((i) => i.kind === "user");
  if (!lastUser || lastUser.kind !== "user") return;
  if (model) await setModel(conversationId, model);
  await editAndResend(conversationId, lastUser.id, lastUser.text);
}

// ---------------------------------------------------------------------------
// Round-trips
// ---------------------------------------------------------------------------

export async function decidePermission(
  conversationId: string,
  requestId: string,
  decision: string,
  reason?: string,
) {
  try {
    await agentApi.decidePermission(conversationId, { request_id: requestId, decision, reason });
  } catch (e) {
    showToast(String(e).slice(0, 160));
  }
}

/** `POST …/plans/{id}` — the PROPOSED card's decision: `approve` |
 *  `reject` | `edit` (with the edited steps; the service refuses `edit`
 *  without them). The halted card's ways out are `resumePlan` / `undoPlan`,
 *  a different endpoint. */
export async function decidePlan(
  conversationId: string,
  planId: string,
  decision: string,
  steps?: unknown[],
) {
  const st = useStore.getState();
  try {
    await agentApi.decidePlan(conversationId, planId, { decision, steps });
    st.agentDispatch(conversationId, {
      event: "plan_decided",
      data: { plan_id: planId, decision },
    });
  } catch (e) {
    showToast(String(e).slice(0, 160));
  }
}

/** "Edit steps" opens the textarea and nothing more — the edited steps are
 *  what the service's `edit` decision needs, so the POST waits for
 *  `PlanEdit`'s Re-propose. Local state only. */
export function beginPlanEdit(conversationId: string, planId: string) {
  useStore.getState().agentDispatch(conversationId, {
    event: "plan_editing",
    data: { plan_id: planId },
  });
}

/** `POST …/plans/{id}/resume {action}` — the HALTED card's way out
 *  (`continue` | `skip` | `stop`; `undo` is `undoPlan`). */
export async function resumePlan(conversationId: string, planId: string, action: string) {
  try {
    await agentApi.resumePlan(conversationId, planId, { action });
  } catch (e) {
    showToast(String(e).slice(0, 160));
  }
}

/** "Undo the batch" / "Undo steps 1–3": reverse-order restore as one
 *  History entry via the service (`POST …/plans/{id}/undo`). */
export async function undoPlan(conversationId: string, planId: string) {
  const st = useStore.getState();
  try {
    await agentApi.undoPlan(conversationId, planId);
    st.agentDispatch(conversationId, { event: "plan_undone", data: { plan_id: planId } });
    st.agentDispatch(conversationId, {
      event: "note",
      data: {
        text: "Batch undone — one History entry, writes restored in reverse order. Spend is not refunded.",
      },
    });
  } catch (e) {
    showToast(String(e).slice(0, 160));
  }
}

/** "undo this" on a write card: restore the write's before hash via the
 *  editor's own restore path (`canon asset restore`, journaled). */
export async function undoWrite(conversationId: string, toolId: string) {
  const st = useStore.getState();
  const conv = st.agent.conversations[conversationId];
  const tool = conv ? collectTools(conv.items).find((t) => t.id === toolId) : null;
  const handles = (tool?.journal ?? []).filter((j) => j.artifact_id && j.before_hash);
  if (!tool || !handles.length) {
    showToast("Nothing to undo — this write carried no before hash.");
    return;
  }
  try {
    for (const h of [...handles].reverse()) {
      await api.assetRestore(st.worldPath, h.artifact_id!, h.before_hash!);
    }
    const patchItems = (items: Conversation["items"]): Conversation["items"] =>
      items.map((it) =>
        it.kind === "run"
          ? { ...it, items: patchItems(it.items) }
          : it.kind === "tool" && it.id === toolId
            ? { ...it, undone: true }
            : it,
      );
    const cur = useStore.getState().agent.conversations[conversationId];
    if (cur)
      useStore.getState().patchAgentConversation(conversationId, { items: patchItems(cur.items) });
  } catch (e) {
    showToast(String(e).slice(0, 160));
  }
}

export function planOf(conversationId: string, planId: string): PlanItem | null {
  const conv = useStore.getState().agent.conversations[conversationId];
  const p = conv?.items.find((i) => i.kind === "plan" && i.planId === planId);
  return p && p.kind === "plan" ? p : null;
}

export async function answerInput(conversationId: string, itemId: string, answer: string) {
  const st = useStore.getState();
  const conv = st.agent.conversations[conversationId];
  if (!conv) return;
  st.patchAgentConversation(conversationId, {
    items: conv.items.map((i) =>
      i.kind === "request_input" && i.id === itemId ? { ...i, answer } : i,
    ),
  });
  await sendMessage(conversationId, answer);
}

// ---------------------------------------------------------------------------
// Stop — one contract, three places (README §10)
// ---------------------------------------------------------------------------

/** Local tabs whose queued send the user stopped before the service had
 *  created the conversation. `sendMessage` checks this after the wait, so
 *  Stop means the same thing before and after the conversation exists
 *  (README §10: one verb, three places, same contract). */
const abandoned = new Set<string>();

/** Header ⏹ / Esc: stops the reply and every run beneath it. */
export async function stopConversation(conversationId: string) {
  const st = useStore.getState();
  if (conversationId.startsWith("local_")) {
    // The turn is queued on a conversation the service has not created yet:
    // nothing to POST to, but the send must still not start. Mark it and
    // say what happened — never a silently inert button.
    abandoned.add(conversationId);
    st.agentDispatch(conversationId, { event: "cancelled", data: { reason: "stopped by you" } });
    st.patchAgentConversation(conversationId, { status: "idle" });
    return;
  }
  st.setAgent({ stopping: conversationId });
  try {
    await agentApi.stopConversation(conversationId);
  } catch (e) {
    showToast(String(e).slice(0, 160));
  } finally {
    useStore.getState().setAgent({ stopping: null });
  }
}

/** Per-run ⏹: that run only; the conversation continues. */
export async function stopRun(runId: string) {
  try {
    await agentApi.stopRun(runId);
  } catch (e) {
    showToast(String(e).slice(0, 160));
  }
}

/** Job-tray ⏹ (and CreateProgress's): row A4.5's `cancel_job`. */
export async function cancelJob(jobId: string) {
  const st = useStore.getState();
  const job = st.jobs.find((j) => j.id === jobId);
  if (!job) return;
  try {
    await api.cancelJob(jobId);
    // Queued jobs are dropped outright; the Rust side confirms with
    // `job-updated {status: "cancelled"}` either way — this is just the
    // immediate feedback so the row never reads "running" after Stop.
    if (job.status === "queued") st.updateJob(jobId, { status: "cancelled", endedAt: Date.now() });
  } catch (e) {
    showToast(String(e).slice(0, 160));
  }
}

// ---------------------------------------------------------------------------
// Editor sightings
// ---------------------------------------------------------------------------

export function dismissPill() {
  useStore.getState().setAgent({ pill: null });
}

/** Every artifact any open conversation wrote this session — the LeftNav
 *  dots (README §8). */
export function touchedThisSession(): Set<string> {
  const out = new Set<string>();
  for (const c of Object.values(useStore.getState().agent.conversations)) {
    for (const t of c.touched) out.add(`${t.typeId}:${t.id}`);
  }
  return out;
}

/** Seeded first-run prompts, drawn from the open project (README §2). */
export function seedPrompts(): string[] {
  const st = useStore.getState();
  const levels = st.entities.levels ?? [];
  const enemies = st.entities.enemies ?? [];
  const npcs = st.entities.npcs ?? [];
  const l = levels[1] ?? levels[0];
  const name = (r?: { name: string | null; id: string }) => (r ? (r.name ?? r.id) : null);
  const out: string[] = [];
  if (l) out.push(`Why does ${name(l)} feel empty?`);
  if (npcs[0]) out.push(`Give ${name(npcs[0])} a refusal line`);
  else if (enemies[0]) out.push(`Is ${name(enemies[0])} placed too early?`);
  out.push(levels.length ? "Check every level for unreachable exits" : "What is in this project?");
  return out.slice(0, 3);
}
