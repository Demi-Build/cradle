import { describe, it, expect } from "vitest";
import {
  conversationFromTranscript,
  foldReads,
  newConversation,
  priceUsage,
  reduceEvent,
  sortTabs,
  tabDot,
  tierFor,
  titleFrom,
  truncateBelow,
  type Conversation,
  type PlanItem,
  type RunItem,
  type ToolItem,
} from "./agentState";

/** The transcript reducer — the fold every SSE frame goes through. The
 *  panel's states (README §3–§8, §10) are all assertable here without React:
 *  streaming text, tool tiers, chips attaching to the card that wants them,
 *  nested runs, plans checking off, the halted ledger, Stop, and the tab
 *  rules the dots read. */

const conv = () => newConversation("conv_1", { order: 1, model: "claude-sonnet-4-6" });
const ev = (c: Conversation, event: string, data: Record<string, unknown> = {}, now = 1000) =>
  reduceEvent(c, { event, data }, { now });

describe("streaming", () => {
  it("accumulates text deltas into one assistant item and clears the caret on message_stop", () => {
    let c = conv();
    c = ev(c, "message_start", { model: "fake" });
    c = ev(c, "text_delta", { index: 0, text: "Two " });
    c = ev(c, "text_delta", { index: 0, text: "jobs." });
    const a = c.items[0];
    expect(a.kind).toBe("assistant");
    if (a.kind !== "assistant") return;
    expect(a.text).toBe("Two jobs.");
    expect(a.streaming).toBe(true);
    expect(c.status).toBe("streaming");
    c = ev(c, "message_stop", {
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect((c.items[0] as { streaming: boolean }).streaming).toBe(false);
    expect(c.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
    c = ev(c, "done", { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
    expect(c.status).toBe("idle");
  });

  it("keeps follow-up chips to three", () => {
    let c = conv();
    c = ev(c, "text_delta", { text: "judged." });
    c = ev(c, "follow_ups", { chips: ["a", "b", "c", "d"] });
    expect((c.items[0] as { chips: string[] }).chips).toEqual(["a", "b", "c"]);
  });
});

describe("tool tiers", () => {
  it("classifies by name with the engine's tier winning", () => {
    expect(tierFor("describe_level")).toBe("read");
    expect(tierFor("apply_level_edit")).toBe("write");
    expect(tierFor("generate_sprites")).toBe("paid");
    expect(tierFor("show_user")).toBe("ui");
    expect(tierFor("whatever", "paid")).toBe("paid");
    expect(tierFor("whatever", "ask")).toBe("write");
  });

  it("a tool_use block becomes a pending item; tool_call runs it; tool_result lands the diff, journal and Show me", () => {
    let c = conv();
    c = ev(c, "content_block_done", {
      index: 1,
      block: {
        type: "tool_use",
        id: "tu_1",
        name: "apply_level_edit",
        input: { level_id: "l3", sparse_edits: {} },
      },
    });
    c = ev(c, "tool_call", { name: "apply_level_edit", input: { level_id: "l3" } });
    let t = c.items[0] as ToolItem;
    expect(t.status).toBe("running");
    expect(t.tier).toBe("write");
    c = ev(c, "tool_result", {
      name: "apply_level_edit",
      is_error: false,
      result: {
        summary: "placed 6",
        diff: { kind: "spatial", before: {}, after: {}, added: 6 },
        journal: [{ artifact_id: "l3", before_hash: "aaa", after_hash: "bbb" }],
      },
    });
    t = c.items[0] as ToolItem;
    expect(t.status).toBe("ok");
    expect(t.diff?.kind).toBe("spatial");
    expect(t.journal?.[0].before_hash).toBe("aaa");
    expect(t.showMe).toEqual({ kind: "entity", typeId: "levels", id: "l3" });
    expect(c.touched[0]).toMatchObject({ typeId: "levels", id: "l3" });
  });

  it("a failed read is the same item with the reason", () => {
    let c = conv();
    c = ev(c, "tool_call", { name: "describe_level", input: { level_id: "l9" } });
    c = ev(c, "tool_result", { name: "describe_level", is_error: true, error: "not found" });
    const t = c.items[0] as ToolItem;
    expect(t.tier).toBe("read");
    expect(t.status).toBe("error");
    expect(t.error).toBe("not found");
  });

  it("folds runs of more than six reads", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      kind: "tool" as const,
      id: `t${i}`,
      name: "describe_level",
      input: {},
      tier: "read" as const,
      status: "ok" as const,
      label: `read ${i}`,
      ts: 0,
    }));
    expect(foldReads(items)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8]]);
    expect(foldReads(items.slice(0, 6))).toEqual([]);
  });
});

describe("permission chips", () => {
  it("attaches the request to the running card that wants it and marks the tab waiting", () => {
    let c = conv();
    c = ev(c, "tool_call", { name: "import_level_grids", input: { level_id: "l4" } });
    c = ev(c, "permission_request", {
      request_id: "perm_1",
      tool: "import_level_grids",
      specialist: "level_designer",
      target: "import grids into 2-4",
      tier: "ask",
      mode: "ask",
      always_allowed: false,
      always_reason: "grants are made in Allow mode",
      pack: "/p",
    });
    const t = c.items[0] as ToolItem;
    expect(c.items).toHaveLength(1);
    expect(t.permission?.requestId).toBe("perm_1");
    expect(t.label).toBe("import grids into 2-4");
    expect(c.status).toBe("awaiting_approval");
    expect(tabDot(c)).toBe("waiting");
    c = ev(c, "permission_decision", { request_id: "perm_1", decision: "reject", reason: "no" });
    expect((c.items[0] as ToolItem).permission?.decision).toBe("reject");
    expect(c.status).toBe("streaming");
    c = ev(c, "rejected_instead", { request_id: "perm_1", text: "skipped it" });
    expect((c.items[0] as ToolItem).permission?.insteadNote).toBe("skipped it");
  });

  it("a paid request carries the estimate onto the card and upgrades the tier", () => {
    let c = conv();
    c = ev(c, "tool_call", { name: "make_art", input: {} });
    c = ev(c, "permission_request", {
      request_id: "perm_2",
      tool: "make_art",
      specialist: "artist",
      target: "generate 4 sprites",
      tier: "paid",
      mode: "ask",
      always_allowed: false,
      always_reason: "paid",
      paid: {
        state: "estimate",
        lowCents: 48,
        highCents: 64,
        backend: "fal",
        model: "flux",
        unitCount: 4,
      },
    });
    const t = c.items[0] as ToolItem;
    expect(t.tier).toBe("paid");
    expect(t.paid?.state).toBe("estimate");
  });

  it("a write that ran under a standing grant reads as allowed-by-grant", () => {
    let c = conv();
    c = ev(c, "tool_call", { name: "update_row", input: { type: "enemies", id: "e1" } });
    c = reduceEvent(
      c,
      { event: "tool_result", data: { name: "update_row", is_error: false, result: {} } },
      { now: 1, grants: new Set(["update_row"]) },
    );
    expect((c.items[0] as ToolItem).allowedByGrant).toBe(true);
  });
});

describe("runs", () => {
  it("nests run_progress events under the run and collapses it on ok", () => {
    let c = conv();
    c = ev(c, "run_start", { run_id: "run_1", specialist: "artist", task: "re-tint" });
    expect(c.specialist).toBe("artist");
    c = ev(c, "run_progress", {
      run_id: "run_1",
      event: { type: "tool_call", name: "db_row", input: { id: "x" } },
    });
    c = ev(c, "run_progress", {
      run_id: "run_1",
      event: { type: "tool_result", name: "db_row", is_error: false, result: {} },
    });
    c = ev(c, "run_progress", {
      run_id: "run_1",
      event: {
        type: "permission_request",
        request_id: "p",
        tool: "update_row",
        target: "t",
        tier: "ask",
        mode: "ask",
        always_allowed: true,
      },
    });
    const run = c.items[0] as RunItem;
    expect(run.items).toHaveLength(2);
    expect((run.items[1] as ToolItem).permission?.requestId).toBe("p");
    expect((run.items[1] as ToolItem).specialist).toBe("artist");
    c = ev(c, "permission_decision", { request_id: "p", decision: "accept" });
    c = ev(c, "run_end", {
      run_id: "run_1",
      status: "ok",
      usage: { input_tokens: 1, output_tokens: 1 },
      costCents: 31,
      summary: "re-tinted",
    });
    const done = c.items[0] as RunItem;
    expect(done.status).toBe("ok");
    expect(done.collapsed).toBe(true);
    expect(done.costCents).toBe(31);
    expect(c.specialist).toBe("foreman");
  });

  it("a cancelled run keeps its resume offer", () => {
    let c = conv();
    c = ev(c, "run_start", { run_id: "r", specialist: "playtester", task: "sweep" });
    c = ev(c, "run_end", { run_id: "r", status: "cancelled", resume: "Resume from 2-4" });
    expect((c.items[0] as RunItem).status).toBe("cancelled");
    expect((c.items[0] as RunItem).resume).toBe("Resume from 2-4");
  });
});

describe("plans", () => {
  const propose = (c: Conversation) =>
    ev(c, "plan_proposed", {
      plan_id: "plan_1",
      title: "Harder east",
      steps: [
        { text: "read", tier: "read", specialist: "level_designer" },
        { text: "place", tier: "write", specialist: "level_designer" },
        {
          text: "art",
          tier: "paid",
          specialist: "artist",
          estimate: { lowCents: 48, highCents: 64 },
        },
      ],
    });

  it("proposed → approved → steps check off → complete with a feed derived from the batch's writes", () => {
    let c = propose(conv());
    expect(c.status).toBe("awaiting_approval");
    expect((c.items[0] as PlanItem).steps[2].estimate?.highCents).toBe(64);
    c = ev(c, "plan_decided", { plan_id: "plan_1", decision: "approve" });
    expect((c.items[0] as PlanItem).status).toBe("running");
    c = ev(c, "plan_step", { plan_id: "plan_1", index: 0, status: "done", duration_ms: 4000 });
    c = ev(c, "run_start", { run_id: "r1", specialist: "level_designer", task: "place" });
    c = ev(c, "run_progress", {
      run_id: "r1",
      event: { type: "tool_call", name: "apply_level_edit", input: { level_id: "l3" } },
    });
    c = ev(c, "run_progress", {
      run_id: "r1",
      event: {
        type: "tool_result",
        name: "apply_level_edit",
        is_error: false,
        result: {
          summary: "placed 6",
          batchId: "plan_1",
          show_me: { kind: "entity", typeId: "levels", id: "l3" },
        },
      },
    });
    c = ev(c, "run_end", { run_id: "r1", status: "ok" });
    c = ev(c, "plan_step", { plan_id: "plan_1", index: 1, status: "done" });
    c = ev(c, "run_start", { run_id: "r2", specialist: "artist", task: "art" });
    c = ev(c, "run_progress", {
      run_id: "r2",
      event: { type: "tool_call", name: "update_row", input: { type: "tilesets", id: "grove" } },
    });
    c = ev(c, "run_progress", {
      run_id: "r2",
      event: {
        type: "tool_result",
        name: "update_row",
        is_error: false,
        result: { summary: "re-tinted", batchId: "plan_1" },
      },
    });
    c = ev(c, "run_end", { run_id: "r2", status: "ok" });
    c = ev(c, "plan_step", { plan_id: "plan_1", index: 2, status: "done", billedCents: 51 });
    c = ev(c, "done", {});
    const p = c.items[0] as PlanItem;
    expect(p.status).toBe("complete");
    expect(p.feed.map((r) => `${r.typeId}:${r.id}`)).toEqual(["levels:l3", "tilesets:grove"]);
    expect(p.actors.sort()).toEqual(["agent:conv_1/artist", "agent:conv_1/level_designer"]);
    // Both writes carry the batch id — the one History entry undo walks.
    const writes: ToolItem[] = [];
    for (const it of c.items)
      if (it.kind === "run") for (const x of it.items) if (x.kind === "tool") writes.push(x);
    expect(writes.map((w) => w.batchId)).toEqual(["plan_1", "plan_1"]);
    c = ev(c, "plan_undone", { plan_id: "plan_1" });
    expect((c.items[0] as PlanItem).undone).toBe(true);
  });

  it("reject leaves the plan discarded and the tab idle", () => {
    let c = propose(conv());
    c = ev(c, "plan_decided", { plan_id: "plan_1", decision: "reject" });
    expect((c.items[0] as PlanItem).status).toBe("rejected");
    expect(c.awaiting).toEqual([]);
  });

  it("a mid-plan failure halts with the ledger and the options", () => {
    let c = propose(conv());
    c = ev(c, "plan_decided", { plan_id: "plan_1", decision: "approve" });
    c = ev(c, "plan_step", { plan_id: "plan_1", index: 0, status: "done" });
    c = ev(c, "plan_step", { plan_id: "plan_1", index: 1, status: "done" });
    c = ev(c, "plan_halted", {
      plan_id: "plan_1",
      index: 2,
      error: "fal returned 429",
      billedCents: 12,
      options: ["Continue from step 3", "Stop here"],
    });
    const p = c.items[0] as PlanItem;
    expect(p.status).toBe("halted");
    expect(p.haltedAt).toBe(2);
    expect(p.steps[2].status).toBe("failed");
    expect(p.steps[2].error).toBe("fal returned 429");
    expect(p.haltOptions).toEqual(["Continue from step 3", "Stop here"]);
    expect(c.status).toBe("awaiting_approval");
  });
});

describe("errors and stop", () => {
  it("a provider error keeps the partial text above a cut and marks the tab red", () => {
    let c = conv();
    c = ev(c, "text_delta", { text: "The east columns" });
    c = ev(c, "error", {
      message: "Anthropic returned 529 — overloaded",
      retryable: true,
      status: 529,
    });
    const e = c.items[1];
    expect(e.kind).toBe("error");
    if (e.kind !== "error") return;
    expect(e.variant).toBe("provider");
    expect(e.partialKept).toBe(true);
    expect((c.items[0] as { streaming: boolean }).streaming).toBe(false);
    expect(c.status).toBe("error");
    expect(tabDot(c)).toBe("error");
  });

  it("a missing key names the env var and reads as missing_key", () => {
    const c = ev(conv(), "error", {
      message: "anthropic: no credential — set ANTHROPIC_API_KEY",
      retryable: false,
    });
    const e = c.items[0];
    if (e.kind !== "error") throw new Error("expected error");
    expect(e.variant).toBe("missing_key");
    expect(e.keyEnv).toBe("ANTHROPIC_API_KEY");
  });

  it("cancelled says what landed and what it cost, then the tab is idle", () => {
    let c = conv();
    c = ev(c, "text_delta", { text: "…" });
    c = ev(c, "cancelled", {
      landed: ["l3"],
      usage: { input_tokens: 5, output_tokens: 2 },
      costCents: 1,
    });
    const x = c.items[1];
    expect(x.kind).toBe("cancelled");
    if (x.kind !== "cancelled") return;
    expect(x.landed).toEqual(["l3"]);
    expect(c.status).toBe("idle");
    expect((c.items[0] as { streaming: boolean }).streaming).toBe(false);
  });
});

describe("tabs", () => {
  it("waiting sorts ahead of idle; a running tab keeps its pinned slot", () => {
    const a = { ...newConversation("a", { order: 1 }), status: "idle" as const };
    const b = { ...newConversation("b", { order: 2 }), status: "awaiting_approval" as const };
    const c = {
      ...newConversation("c", { order: 3 }),
      status: "streaming" as const,
      pinnedIndex: 2,
    };
    expect(sortTabs([a, b, c]).map((x) => x.id)).toEqual(["b", "a", "c"]);
    // Errored-unread is red; idle is no dot.
    expect(tabDot({ ...a, status: "error", unreadError: true })).toBe("error");
    expect(tabDot(a)).toBeNull();
    expect(tabDot(c)).toBe("streaming");
  });

  it("titles come from the first clause; edit-and-resend truncates below", () => {
    expect(titleFrom("Why does 2-3 feel empty? Compared to 2-2.")).toBe("Why does 2-3 feel empty");
    const items = [
      { kind: "user" as const, id: "u1", text: "a", ts: 0, context: [] },
      {
        kind: "assistant" as const,
        id: "m1",
        text: "b",
        thinking: "",
        streaming: false,
        ts: 0,
        chips: [],
      },
      { kind: "user" as const, id: "u2", text: "c", ts: 0, context: [] },
    ];
    expect(truncateBelow(items, "u2")).toHaveLength(2);
    expect(truncateBelow(items, "u1")).toHaveLength(0);
  });

  it("prices usage at the picker's rate and never invents a figure without one", () => {
    expect(
      priceUsage(
        { input_tokens: 1_000_000, output_tokens: 0 },
        { input_per_1m: 3, output_per_1m: 15 },
      ),
    ).toBe(300);
    expect(priceUsage({ input_tokens: 10, output_tokens: 10 }, null)).toBeNull();
  });
});

describe("transcript hydration", () => {
  it("rebuilds the same log from the stored lines the service writes", () => {
    const lines = [
      { type: "meta", id: "conv_9", model: "fake", created: "2026-09-01T14:02:00Z" },
      { type: "user", content: "Why does 2-3 feel empty?", ts: "2026-09-01T14:02:01Z" },
      {
        type: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "tu_1", name: "describe_level", input: { level_id: "l3" } },
        ],
      },
      {
        type: "tool_result",
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"size":"53×16"}' }],
      },
      { type: "assistant", content: [{ type: "text", text: "It's the spacing." }] },
      { type: "turn_end", stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 20 } },
    ];
    const c = conversationFromTranscript(lines, { order: 1 });
    expect(c.id).toBe("conv_9");
    expect(c.title).toBe("Why does 2-3 feel empty");
    const kinds = c.items.map((i) => i.kind);
    expect(kinds).toEqual(["rule", "user", "assistant", "tool", "assistant"]);
    const t = c.items[3] as ToolItem;
    expect(t.status).toBe("ok");
    expect(t.result).toEqual({ size: "53×16" });
    expect(c.usage.input_tokens).toBe(40);
    expect(c.status).toBe("idle");
  });
});
