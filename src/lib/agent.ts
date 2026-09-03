// The agent service client — HTTP + SSE over 127.0.0.1:<port> (row P1-A5,
// master §3.1; Phase 1 §2; agent-panel README).
//
// This is the October-M1 transport seam: it lives BESIDE `invoke.ts` as its
// own module (I1 — every Tauri IPC still goes through `api`), because the
// webview talks to the sidecar directly (tauri.conf.json has `csp: null`;
// user decision 2026-09-01) rather than through a Rust proxy. Cradle spawns
// the sidecar with the one-line port handoff (`api.agentStart`, the Rust
// `agent_start` command in src-tauri/src/lib.rs's sidecar block) and the
// service dies with cradle (`--parent-pid`).
//
// `agentApi` mirrors the `api` pattern: one object the panel calls, behind
// which the transport can be swapped — `HttpAgentTransport` for the real
// service, `installDevMock`'s scripted agent (`agentMock.ts`) headless (I7).
// Every event the service streams is relayed as `{event, data}` with the
// event NAME as data (`string`, never a union): the vocabulary is A2/A4's
// (`message_start`, `text_delta`, `thinking_delta`, `tool_use_start`,
// `tool_input_delta`, `content_block_done`, `message_stop`, `tool_call`,
// `tool_result`, `permission_request`, `permission_decision`, `done`,
// `error`) plus A4.5's (`run_start`, `run_progress`, `run_end`,
// `plan_proposed`, `plan_step`, `plan_halted`, `cancelled`). The reducer in
// `agentState.ts` is what gives each a meaning; an event neither knows is
// carried and ignored, never fatal.

import { api } from "./invoke";

/** One SSE frame: `event:` name + parsed `data:` JSON. */
export type AgentEvent = { event: string; data: Record<string, unknown> };

/** `GET /models` row (A4.5; devMock meanwhile) — ids and providers are data. */
export type ModelInfo = {
  id: string;
  provider: string;
  label: string;
  input_per_1m: number;
  output_per_1m: number;
  available: boolean;
  reasoning: boolean;
  /** Why it is unavailable — names the key env var + where cradle looked
   *  (Appendix I deviation 2: the real key sources, never a toml path). */
  reason?: string;
  key_env?: string;
};

export type ConversationSummary = { id: string; created?: string; turns?: number; title?: string };

/** A line of the pack's transcript (`<pack>/.canon/agent/<id>.jsonl`). */
export type TranscriptLine = Record<string, unknown> & { type: string; ts?: string };

export type GrantRow = {
  index: number;
  tool: string;
  granted_by?: string;
  when?: string;
  scope?: string;
};
export type GrantsDoc = { pack: string; path: string; grants: GrantRow[] };

export type Health = {
  ok: boolean;
  pack: string;
  backend: string;
  model: string | null;
  tools: string[];
};

export type SendBody = {
  text: string;
  mode?: string;
  /** What the composer attached (README §3 "Composer context") — the
   *  latest UI state only; the service folds it into the system prompt. */
  ui_state?: Record<string, unknown>;
};

export type PermissionDecisionBody = { request_id: string; decision: string; reason?: string };
/** `POST …/plans/{id}` — `approve | reject | edit` only; `edit` carries the
 *  edited steps (the service refuses `edit` without them). */
export type PlanDecisionBody = { decision: string; steps?: unknown[] };
/** `POST …/plans/{id}/resume` — the HALTED card's way out: `continue |
 *  skip | stop` (undo is `POST …/plans/{id}/undo`). A different endpoint
 *  from `decidePlan`, because a halted plan is not `proposed`. */
export type PlanResumeBody = { action: string };

/** What the panel needs from the service. One interface, two transports. */
export interface AgentTransport {
  health(): Promise<Health>;
  models(): Promise<ModelInfo[]>;
  /** `POST /conversations {system?, ui_state?}` — the service's body has no
   *  `model`: the sidecar's `--model` is what a conversation runs on. */
  createConversation(body?: { system?: string }): Promise<{ id: string }>;
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<TranscriptLine[]>;
  /** POST a user message and relay every SSE frame to `onEvent` until the
   *  stream ends. Resolves when the stream closes; rejects on transport
   *  failure (a dead sidecar, a 409, a network error). */
  sendMessage(id: string, body: SendBody, onEvent: (ev: AgentEvent) => void): Promise<void>;
  decidePermission(id: string, body: PermissionDecisionBody): Promise<Record<string, unknown>>;
  decidePlan(id: string, planId: string, body: PlanDecisionBody): Promise<Record<string, unknown>>;
  resumePlan(id: string, planId: string, body: PlanResumeBody): Promise<Record<string, unknown>>;
  undoPlan(id: string, planId: string): Promise<Record<string, unknown>>;
  stopConversation(id: string): Promise<Record<string, unknown>>;
  stopRun(runId: string): Promise<Record<string, unknown>>;
  listGrants(pack?: string): Promise<GrantsDoc>;
  revokeGrant(index: number, pack?: string): Promise<GrantsDoc>;
  revokeAllGrants(pack?: string): Promise<GrantsDoc>;
  prompt(id: string): Promise<{ prompt: string }>;
  shutdown(): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

/** Parse `text/event-stream` bytes incrementally. Feed it every chunk; it
 *  returns the complete frames and the unterminated remainder to carry into
 *  the next call. A frame is `event:` + one or more `data:` lines ending in a
 *  blank line; `data:` lines concatenate with `\n` per the spec. A frame
 *  whose data is not JSON is still delivered (`{raw}`) so nothing the service
 *  says is silently dropped. */
export function parseSse(chunk: string, carry = ""): { events: AgentEvent[]; carry: string } {
  const text = carry + chunk;
  const events: AgentEvent[] = [];
  // Frames end with a blank line; normalise CRLF first.
  const parts = text.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  for (const frame of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (!data.length && event === "message") continue;
    const joined = data.join("\n");
    let parsed: Record<string, unknown>;
    try {
      const v = JSON.parse(joined);
      parsed = v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v };
    } catch {
      parsed = { raw: joined };
    }
    events.push({ event, data: parsed });
  }
  return { events, carry: rest };
}

// ---------------------------------------------------------------------------
// The HTTP transport
// ---------------------------------------------------------------------------

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (j && typeof j.detail === "string") detail = j.detail;
    } catch {}
    throw new Error(`${res.status} ${detail || res.statusText}`.trim());
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export class HttpAgentTransport implements AgentTransport {
  constructor(public baseUrl: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return readJson<T>(res);
  }

  health() {
    return this.req<Health>("GET", "/health");
  }
  models() {
    return this.req<ModelInfo[]>("GET", "/models");
  }
  createConversation(body?: { system?: string }) {
    return this.req<{ id: string }>("POST", "/conversations", body ?? {});
  }
  listConversations() {
    return this.req<ConversationSummary[]>("GET", "/conversations");
  }
  getConversation(id: string) {
    return this.req<TranscriptLine[]>("GET", `/conversations/${encodeURIComponent(id)}`);
  }
  async sendMessage(id: string, body: SendBody, onEvent: (ev: AgentEvent) => void) {
    const res = await fetch(`${this.baseUrl}/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!res.ok) await readJson(res); // throws with the service's detail
    if (!res.body) throw new Error("the service answered without a stream body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parsed = parseSse(decoder.decode(value, { stream: true }), carry);
      carry = parsed.carry;
      for (const ev of parsed.events) onEvent(ev);
    }
    const tail = parseSse("\n\n", carry);
    for (const ev of tail.events) onEvent(ev);
  }
  decidePermission(id: string, body: PermissionDecisionBody) {
    return this.req<Record<string, unknown>>(
      "POST",
      `/conversations/${encodeURIComponent(id)}/permissions`,
      body,
    );
  }
  decidePlan(id: string, planId: string, body: PlanDecisionBody) {
    return this.req<Record<string, unknown>>(
      "POST",
      `/conversations/${encodeURIComponent(id)}/plans/${encodeURIComponent(planId)}`,
      body,
    );
  }
  resumePlan(id: string, planId: string, body: PlanResumeBody) {
    return this.req<Record<string, unknown>>(
      "POST",
      `/conversations/${encodeURIComponent(id)}/plans/${encodeURIComponent(planId)}/resume`,
      body,
    );
  }
  undoPlan(id: string, planId: string) {
    return this.req<Record<string, unknown>>(
      "POST",
      `/conversations/${encodeURIComponent(id)}/plans/${encodeURIComponent(planId)}/undo`,
      {},
    );
  }
  stopConversation(id: string) {
    return this.req<Record<string, unknown>>(
      "POST",
      `/conversations/${encodeURIComponent(id)}/stop`,
      {},
    );
  }
  stopRun(runId: string) {
    return this.req<Record<string, unknown>>("POST", `/runs/${encodeURIComponent(runId)}/stop`, {});
  }
  listGrants(pack?: string) {
    return this.req<GrantsDoc>("GET", `/packs/permissions${packQuery(pack)}`);
  }
  revokeGrant(index: number, pack?: string) {
    return this.req<GrantsDoc>("DELETE", `/packs/permissions/${index}${packQuery(pack)}`);
  }
  revokeAllGrants(pack?: string) {
    return this.req<GrantsDoc>("DELETE", `/packs/permissions${packQuery(pack)}`);
  }
  prompt(id: string) {
    return this.req<{ prompt: string }>("GET", `/conversations/${encodeURIComponent(id)}/prompt`);
  }
  shutdown() {
    return this.req<Record<string, unknown>>("POST", "/shutdown", {});
  }
}

function packQuery(pack?: string): string {
  return pack ? `?pack=${encodeURIComponent(pack)}` : "";
}

// ---------------------------------------------------------------------------
// The facade — `agentApi` delegates to whichever transport is installed
// ---------------------------------------------------------------------------

let transport: AgentTransport | null = null;

/** Install the transport the panel talks through: an `HttpAgentTransport`
 *  once the sidecar has reported its port, or the devMock's scripted agent. */
export function setAgentTransport(t: AgentTransport | null): void {
  transport = t;
}
export function getAgentTransport(): AgentTransport | null {
  return transport;
}

function must(): AgentTransport {
  if (!transport) throw new Error("the agent service is not running");
  return transport;
}

/** The one object the panel calls — mirrors `api`. */
export const agentApi: AgentTransport = {
  health: () => must().health(),
  models: () => must().models(),
  createConversation: (b) => must().createConversation(b),
  listConversations: () => must().listConversations(),
  getConversation: (id) => must().getConversation(id),
  sendMessage: (id, body, onEvent) => must().sendMessage(id, body, onEvent),
  decidePermission: (id, body) => must().decidePermission(id, body),
  decidePlan: (id, planId, body) => must().decidePlan(id, planId, body),
  resumePlan: (id, planId, body) => must().resumePlan(id, planId, body),
  undoPlan: (id, planId) => must().undoPlan(id, planId),
  stopConversation: (id) => must().stopConversation(id),
  stopRun: (runId) => must().stopRun(runId),
  listGrants: (pack) => must().listGrants(pack),
  revokeGrant: (index, pack) => must().revokeGrant(index, pack),
  revokeAllGrants: (pack) => must().revokeAllGrants(pack),
  prompt: (id) => must().prompt(id),
  shutdown: () => must().shutdown(),
};

// ---------------------------------------------------------------------------
// Sidecar lifecycle (the frontend half; the Rust half is `agent_start` /
// `agent_stop` / `agent_status`)
// ---------------------------------------------------------------------------

/** The panel's view of the service. `port` is per-process state, never
 *  persisted (I5/I8). */
export type ServiceState = {
  status: "stopped" | "starting" | "ready" | "failed";
  port: number | null;
  pid: number | null;
  startedAt: number | null;
  /** The command line cradle ran, for the failed-state copy. */
  command: string | null;
  /** What `--backend` / `--model` the running sidecar was spawned on (data
   *  strings, never a union). The model picker compares against these to
   *  know whether the pick needs a restart — the sidecar is the only seam
   *  that carries a model to the service (`CreateConversation` has no
   *  `model` field; a per-message model is A4.5's to add). */
  backend: string | null;
  model: string | null;
  error: string | null;
  stderr: string[];
};

export const INITIAL_SERVICE: ServiceState = {
  status: "stopped",
  port: null,
  pid: null,
  startedAt: null,
  command: null,
  backend: null,
  model: null,
  error: null,
  stderr: [],
};

/** How long the health probe waits for the service to answer after the
 *  port line (README §3 "Service failed": nothing answered after 10 s). */
export const SERVICE_START_TIMEOUT_MS = 10_000;

/** Spawn (or reuse) the sidecar for `pack` and point `agentApi` at it.
 *  Resolves with the ready state; rejects with the named failure. The
 *  scripted devMock short-circuits the whole thing by answering
 *  `agent_start` with `{mock: true}` and installing its own transport. */
export async function startAgentService(
  pack: string,
  opts: { backend?: string; model?: string } = {},
): Promise<{ port: number; pid: number; command: string }> {
  const started = await api.agentStart(pack, opts.backend ?? null, opts.model ?? null);
  if (started.mock) {
    return { port: 0, pid: 0, command: started.command ?? "scripted agent (devMock)" };
  }
  const http = new HttpAgentTransport(`http://127.0.0.1:${started.port}`);
  const deadline = Date.now() + SERVICE_START_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const h = await http.health();
      if (h.ok) {
        setAgentTransport(http);
        return { port: started.port, pid: started.pid, command: started.command ?? "" };
      }
    } catch (e) {
      lastError = String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Nothing answered on port ${started.port} after ${SERVICE_START_TIMEOUT_MS / 1000} seconds` +
      (lastError ? ` (${lastError})` : ""),
  );
}

/** Ask the service to exit, then let Rust reap it. Best-effort on both. */
export async function stopAgentService(): Promise<void> {
  try {
    await transport?.shutdown();
  } catch {}
  try {
    await api.agentStop();
  } catch {}
  setAgentTransport(null);
}
