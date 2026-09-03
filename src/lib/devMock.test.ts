import { describe, it, expect, beforeEach, vi } from "vitest";

/** devMock parity (I7) for the two commands row P0-5 changed: `load_world`
 *  carries a `pack_info` whose grids build the Dock's placement tabs, and
 *  `export_level` on a `room_*` id answers a bundle in the P.6.3a shape —
 *  the same key set the room fixture (and `canon grid export`) carries,
 *  plus the platformer-only music keys that ride along neutral. */

import { installDevMock, mockRoomBundle } from "./devMock";
import { placementTabs } from "./placements";
import { useStore } from "../store";
import { roomBundle } from "../test/fixtures/roomBundle";
import type { JournalEvent, JournalSummary, PackInfo } from "./invoke";

type Internals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function mockInvoke(): Internals["invoke"] {
  return (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__.invoke;
}

beforeEach(() => {
  // The mock's data file is fetched once; a minimal platformer document is
  // enough for the commands under test.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            name: "mock",
            entity_counts: [{ type_id: "levels", count: 0 }],
            levels: [],
            enemies: [],
            levelJson: {},
            enemyJson: {},
            bundles: {},
          }),
      }),
    ),
  );
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  installDevMock();
});

describe("devMock parity for the P0-5 commands", () => {
  it("mockRoomBundle carries the room fixture's key set (+ the neutral music keys)", () => {
    expect(Object.keys(mockRoomBundle("room_0")).sort()).toEqual(
      [...Object.keys(roomBundle()), "music_path_abs", "stage_music", "stage_music_abs"].sort(),
    );
  });

  it("load_world answers a pack_info whose grids build placement tabs", async () => {
    const res = (await mockInvoke()("load_world", { path: "mock://pack" })) as {
      world_kind: string;
      pack_info: PackInfo;
    };
    expect(res.world_kind).toBe("platformer");
    expect(placementTabs(res.pack_info).map((t) => t.kind)).toEqual(["enemy", "item"]);
  });

  it("the mocked platformer create replays the ORCHESTRATED shape", async () => {
    // I7: the browser must exercise the relay the app actually feeds it. The
    // native create default (`--orchestrate`) emits TWO run_start/run_end
    // segments, the step total under `nodes`, and per-artifact `level:*` /
    // `review:*` ids — a one-pass `phases` mock proved a stream nothing sends.
    vi.useFakeTimers();
    const job = {
      id: "job-mock",
      op: "world",
      label: "Mock",
      target: "Mock",
      targetType: "",
      status: "queued",
      ts: 0,
    };
    useStore.setState({ jobs: [job] } as never);
    await mockInvoke()("new_project", {
      jobId: "job-mock",
      name: "Mock",
      template: "platformer",
      counts: { stages: 1, levels: 2, enemies: 2, items: 2 },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const p = useStore.getState().jobs.find((j) => j.id === "job-mock")?.progress;
    const nodes = (p?.phases ?? []).map((x) => x.node);
    expect(nodes).toContain("level:stage_1/l1/terrain");
    expect(nodes).toContain("review:stage_1/l2");
    // The macro pass is re-reported as skipped, but it RAN this run…
    expect(p?.phases.find((x) => x.node === "phase:plat:world")?.status).toBe("done");
    // …and the total is the graph pass's, not the six-node bootstrap's.
    expect(p?.total).toBe(nodes.length);
    vi.useRealTimers();
  });

  it("export_level on a room id answers the room bundle for that id", async () => {
    const res = (await mockInvoke()("export_level", {
      path: "mock://pack",
      levelId: "room_3",
    })) as {
      level_id: string;
      warnings: unknown;
      room: unknown;
    };
    expect(res.level_id).toBe("room_3");
    expect(res.warnings).toEqual([]);
    expect(res.room).toBeTruthy();
  });
});

/** Row P1-A6 (I7): `journal_list` is a NEW command, so the browser mock must
 *  answer the same shape the native one does — filters, read-time defaults and
 *  the roll-up — or the dashboard is only ever tested against the real app. */
describe("devMock parity for journal_list (row P1-A6)", () => {
  it("answers events, and every event carries an identity", async () => {
    const res = (await mockInvoke()("journal_list", { path: "mock://pack" })) as {
      events: JournalEvent[];
      summary?: JournalSummary;
    };
    expect(res.events.length).toBeGreaterThan(5);
    expect(res.events.every((e) => !!e.identity)).toBe(true);
    expect(res.summary).toBeUndefined();
  });

  it("swaps the events for the roll-up under --summary, and both reconcile", async () => {
    const all = (await mockInvoke()("journal_list", { path: "mock://pack" })) as {
      events: JournalEvent[];
    };
    const res = (await mockInvoke()("journal_list", { path: "mock://pack", summary: true })) as {
      events?: JournalEvent[];
      summary: JournalSummary;
    };
    // Parity with the verb: asking for the roll-up must not ALSO ship every
    // event, or the flag costs more than not passing it.
    expect(res.events).toBeUndefined();
    // The roll-up reconciles with the events it summarised — the same
    // invariant canon asserts server-side.
    expect(res.summary.totalCents).toBe(
      all.events.reduce((n, e) => n + (typeof e.costCents === "number" ? e.costCents : 0), 0),
    );
    expect(res.summary.generationCents + res.summary.tokensCents).toBe(res.summary.totalCents);
    expect(res.summary.byKind.some((r) => r.genKind === "mesh")).toBe(true);
    expect(res.summary.unpricedRuns).toBeGreaterThan(0);
  });

  it("keeps both when the caller bounded the read itself", async () => {
    const res = (await mockInvoke()("journal_list", {
      path: "mock://pack",
      summary: true,
      limit: 3,
    })) as { events: JournalEvent[]; summary: JournalSummary };
    expect(res.events).toHaveLength(3);
    expect(res.summary.totalCents).toBe(
      res.events.reduce((n, e) => n + (typeof e.costCents === "number" ? e.costCents : 0), 0),
    );
  });

  it("applies P.8.7's filter set", async () => {
    const call = (args: Record<string, unknown>) =>
      mockInvoke()("journal_list", { path: "mock://pack", ...args }) as Promise<{
        events: JournalEvent[];
      }>;
    expect((await call({ genKind: "tokens" })).events.every((e) => e.genKind === "tokens")).toBe(
      true,
    );
    expect((await call({ session: "wick" })).events.every((e) => e.session === "wick")).toBe(true);
    expect((await call({ identity: "user" })).events.every((e) => e.identity === "user")).toBe(
      true,
    );
    expect(
      (await call({ artifactPrefix: "conversation:" })).events.every((e) =>
        (e.artifact_id ?? "").startsWith("conversation:"),
      ),
    ).toBe(true);
    expect((await call({ limit: 2 })).events).toHaveLength(2);
    expect((await call({ since: "2999-01-01T00:00:00+00:00" })).events).toHaveLength(0);
  });

  it("jobs_record then jobs_list round-trips the lane fields the ledger gained", async () => {
    await mockInvoke()("jobs_record", {
      path: "mock://pack",
      entry: { job_id: "j1", op: "sprite", status: "cancelled", identity: "agent:wick/artist" },
    });
    const res = (await mockInvoke()("jobs_list", { path: "mock://pack" })) as {
      jobs: { entries: Record<string, unknown>[] };
    };
    const row = res.jobs.entries.find((e) => e.job_id === "j1");
    expect(row?.status).toBe("cancelled");
    expect(row?.identity).toBe("agent:wick/artist");
  });
});

describe("devMock parity for the P0-9 dialogue verbs", () => {
  it("declares the dialogue capability and its vocabulary in pack_info", async () => {
    const world = (await mockInvoke()("load_world", { path: "/w" })) as {
      pack_info: PackInfo & { dialogue?: { condition_namespaces: string[] } };
    };
    expect(world.pack_info.capabilities).toContain("dialogue");
    expect(world.pack_info.dialogue?.condition_namespaces).toContain("has_item");
    // The block is deliberately missing `time` from the engine's tree scope, so
    // the engine-lag layer has something real to warn about in the browser.
    const blocks = (
      world.pack_info as unknown as { engine_evaluable_namespaces: Record<string, object> }
    ).engine_evaluable_namespaces;
    expect(Object.keys(blocks.tree)).not.toContain("time");
  });

  it("dialogue_show answers the rail's data with a fallback and a gated choice", async () => {
    const show = (await mockInvoke()("dialogue_show", { path: "/w", npc: "1023" })) as {
      trees: { tree_id: string; fallback: boolean; gates: unknown[] }[];
      selector_axes: string[];
    };
    // Stored order, exactly as canon's `dialogue_show` reports it — the rail
    // sorts by rank itself.
    expect(show.trees.map((t) => t.tree_id).sort()).toEqual(["1023:default", "1023:night"]);
    expect(show.trees.find((t) => t.tree_id === "1023:default")!.fallback).toBe(true);
    expect(show.trees.find((t) => t.tree_id === "1023:default")!.gates.length).toBeGreaterThan(0);
    expect(show.selector_axes).toContain("custom");
  });

  it("dialogue_validate warns about engine lag and never errors on it", async () => {
    const report = (await mockInvoke()("dialogue_validate", { path: "/w", npc: "1023" })) as {
      errors: string[];
      warnings: string[];
    };
    expect(report.errors).toEqual([]);
    expect(report.warnings.join(" ")).toContain("does not evaluate 'time'");
  });

  it("dialogue_test evaluates the gates and names the failing condition", async () => {
    const walk = (await mockInvoke()("dialogue_test", {
      path: "/w",
      tree: {
        tree_id: "t",
        character_id: "1023",
        entry_node_id: "start",
        nodes: {
          start: {
            node_id: "start",
            prompt: "p",
            choices: [
              { text: "gated", next_node_id: null, conditions: ["has_item:shard"], effects: [] },
            ],
          },
        },
      },
      state: {},
      node: null,
      choose: null,
    })) as { choices: { pass: boolean; failing_reason: string }[] };
    expect(walk.choices[0].pass).toBe(false);
    expect(walk.choices[0].failing_reason).toContain("not in inventory");
  });

  it("dialogue_select picks the fallback and reports the engine's divergence", async () => {
    const pick = (await mockInvoke()("dialogue_select", {
      path: "/w",
      npc: "1023",
      state: { clock: { window: "night" } },
    })) as { selected: string; engine: { diverges: boolean; reason: string | null } };
    // `time:night` matches in the tester…
    expect(pick.selected).toBe("1023:night");
    // …but the mock's engine cannot evaluate `time`, so it falls through — the
    // selector-level engine-lag case, named and non-blocking.
    expect(pick.engine.diverges).toBe(true);
    expect(pick.engine.reason).toContain("the runtime lags");
  });

  it("dialogue_update round-trips: the write is visible to the next read", async () => {
    await mockInvoke()("dialogue_update", {
      path: "/w",
      npc: "1023",
      ops: [{ k: "node.prompt", tree: "1023:default", node_id: "start", value: "rewritten" }],
    });
    const row = (await mockInvoke()("get_entity", { path: "/w", typeId: "npcs", id: "1023" })) as {
      dialogue_trees: { tree_id: string; nodes: Record<string, { prompt: string }> }[];
      dialogue_tree: { nodes: Record<string, { prompt: string }> };
    };
    const fallback = row.dialogue_trees.find((t) => t.tree_id === "1023:default")!;
    expect(fallback.nodes.start.prompt).toBe("rewritten");
    // The legacy engine copy is written back alongside it (the compat shim).
    expect(row.dialogue_tree.nodes.start.prompt).toBe("rewritten");
  });
});

describe("devMock parity for the P0-10 create flow", () => {
  it("pack_templates answers both templates in the P.4.4 shape", async () => {
    const r = (await mockInvoke()("pack_templates")) as {
      templates: {
        id: string;
        defaults: Record<string, number>;
        ranges: Record<string, [number, number]>;
        advanced: string[];
        phase_labels: Record<string, string>;
        beta: boolean;
      }[];
    };
    expect(r.templates.map((t) => t.id)).toEqual(["platformer", "dungeon"]);
    const dungeon = r.templates[1];
    // W2.1.1's split, and the dungeon card ships un-badged (W2.1.4).
    expect(Object.keys(dungeon.defaults)).toContain("rooms");
    expect(dungeon.advanced).toEqual(["event", "quest", "class"]);
    expect(dungeon.ranges.class).toEqual([1, 4]);
    expect(dungeon.beta).toBe(false);
    // §3.0-E: the label map the mock's own pipeline ids resolve through.
    expect(dungeon.phase_labels["db:npc"]).toBe("NPCs");
  });

  it("project_store names where a created project lands (§8.4)", async () => {
    const r = (await mockInvoke()("project_store")) as { root: string };
    expect(r.root).toContain("CradleProjects");
  });

  it("new_project takes a template + counts by name and uniquifies a collision", async () => {
    const first = (await mockInvoke()("new_project", {
      jobId: "j1",
      parentDir: null,
      name: "My World",
      template: "dungeon",
      counts: { rooms: 2 },
    })) as { pack_dir: string; status: string };
    expect(first.status).toBe("queued");
    expect(first.pack_dir).toBe("mock://CradleProjects/my_world");
    const second = (await mockInvoke()("new_project", {
      jobId: "j2",
      parentDir: null,
      name: "My World",
      template: "dungeon",
      counts: { rooms: 2 },
    })) as { pack_dir: string };
    // The W2 papercut: a repeated name auto-uniquifies instead of erroring.
    expect(second.pack_dir).not.toBe(first.pack_dir);
    expect(second.pack_dir).toContain("my_world_");
  });

  it("estimate_world prices by template + counts, and fake/none stays $0", async () => {
    const r = (await mockInvoke()("estimate_world", {
      template: "dungeon",
      counts: { rooms: 3, monster: 2, item: 3 },
      llmBackend: "fake",
      imageBackend: "fake",
      musicBackend: "none",
      sfxBackend: "none",
      vlmBackend: "none",
    })) as { estimate: { total_usd: { best: number; worst: number } } };
    expect(r.estimate.total_usd.best).toBe(0);
    expect(r.estimate.total_usd.worst).toBe(0);
  });
});

/** Row P0-12's commands in the browser mock (I7). The mock stands in for the
 *  native side, so it must answer the SAME shapes — and, because these
 *  commands are about secrets, it must be provably free of anything
 *  key-shaped: a realistic-looking key committed to a repo is a liability even
 *  when it is fake, and someone will eventually paste it somewhere real. */
describe("devMock parity for the P0-12 key commands", () => {
  it("answers provider ROWS with the September set, Meshy and the chat providers", async () => {
    const doc = (await mockInvoke()("provider_rows", {})) as {
      providers: { id: string; env_var: string; aliases: string[]; note: string }[];
      backend_key_vars: Record<string, Record<string, string>>;
    };
    const vars = doc.providers.map((p) => p.env_var);
    expect(vars).toEqual(
      expect.arrayContaining([
        "ANTHROPIC_API_KEY",
        "FAL_KEY",
        "GOOGLE_API_KEY",
        "ELEVENLABS_API_KEY",
        "PIXELLAB_SECRET",
        "RD_API_KEY",
        "MESHY_API_KEY",
        "OPENAI_API_KEY",
        "MOONSHOT_API_KEY",
      ]),
    );
    // The var fix, mirrored: canon's name, the dashboard's name as its alias.
    const pixellab = doc.providers.find((p) => p.env_var === "PIXELLAB_SECRET")!;
    expect(pixellab.aliases).toEqual(["PIXELLAB_API_KEY"]);
    // The corrected Meshy licensing line.
    const meshy = doc.providers.find((p) => p.env_var === "MESHY_API_KEY")!;
    expect(meshy.note).toContain("CC BY 4.0");
    expect(meshy.note).toContain("full ownership / commercial use without attribution");
    // The backend map is DERIVED from the rows, not a second literal.
    expect(doc.backend_key_vars.image.pixellab).toBe("PIXELLAB_SECRET");
    expect(doc.backend_key_vars.chat.kimi).toBe("MOONSHOT_API_KEY");
  });

  it("reports names and sources — and holds no key value at all", async () => {
    const doc = (await mockInvoke()("provider_keys", {
      vars: ["ANTHROPIC_API_KEY", "MESHY_API_KEY"],
    })) as {
      vars: { name: string; set: boolean; source: string | null }[];
      keys: string[];
      backend: string;
    };
    expect(doc.backend).toBe("keychain");
    const anthropic = doc.vars.find((v) => v.name === "ANTHROPIC_API_KEY")!;
    expect(anthropic).toEqual({
      name: "ANTHROPIC_API_KEY",
      set: true,
      source: "keychain",
      also_in: [],
    });
    expect(doc.vars.find((v) => v.name === "MESHY_API_KEY")!.set).toBe(false);
    // Nothing in the whole answer looks like a credential.
    const flat = JSON.stringify(doc);
    expect(flat).not.toMatch(/sk-|sk_live|Bearer\s+\S/);
    expect(flat).not.toHaveProperty("value");
  });

  it("stores write-only: set changes the STATUS and returns no value", async () => {
    const ack = (await mockInvoke()("set_provider_key", {
      var: "MESHY_API_KEY",
      value: "not-a-real-key-0000",
    })) as Record<string, unknown>;
    expect(ack).toEqual({
      var: "MESHY_API_KEY",
      stored: true,
      backend: "keychain",
      warning: null,
    });
    expect(JSON.stringify(ack)).not.toContain("not-a-real-key-0000");

    const after = (await mockInvoke()("provider_keys", { vars: ["MESHY_API_KEY"] })) as {
      vars: { name: string; set: boolean }[];
    };
    expect(after.vars.find((v) => v.name === "MESHY_API_KEY")!.set).toBe(true);

    const gone = (await mockInvoke()("delete_provider_key", { var: "MESHY_API_KEY" })) as {
      removed: boolean;
    };
    expect(gone.removed).toBe(true);
  });

  it("never contacts a provider from the key test (doctrine 3)", async () => {
    const fetchSpy = globalThis.fetch as unknown as { mock: { calls: unknown[] } };
    const before = fetchSpy.mock.calls.length;
    const ok = (await mockInvoke()("test_provider_key", { provider: "anthropic" })) as {
      ran: boolean;
      reason: string;
    };
    expect(ok.ran).toBe(true);
    expect(ok.reason).toContain("nothing was contacted");
    // A row with no free endpoint is disabled-with-a-reason, not a silent no.
    const none = (await mockInvoke()("test_provider_key", { provider: "meshy" })) as {
      ran: boolean;
      reason: string;
    };
    expect(none.ran).toBe(false);
    expect(none.reason).toContain("never does");
    expect(fetchSpy.mock.calls.length).toBe(before);
  });

  it("answers the Environment pane's four reads", async () => {
    const env = (await mockInvoke()("environment_status", {})) as {
      canon: { ok: boolean };
      godot: { tool: string; gate: string };
      blender: { tool: string; env_var: string; gate: string };
      project_store: { root: string; source: string };
    };
    expect(env.canon.ok).toBe(true);
    expect(env.godot.tool).toBe("godot");
    expect(env.blender.env_var).toBe("BLENDER_BIN");
    expect(env.blender.gate).toBe("missing");
    expect(env.project_store.source).toBe("default");

    const moved = (await mockInvoke()("set_project_store", { path: "/elsewhere" })) as {
      root: string;
      source: string;
    };
    expect(moved).toEqual({
      root: "/elsewhere",
      exists: true,
      source: "settings",
      locked_by_env: false,
    });
    await mockInvoke()("set_project_store", { path: null });
  });
});
