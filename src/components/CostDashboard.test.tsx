import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

/** Row P1-A6 — the cost dashboard (agent-panel README §12, board 06).
 *
 *  The load-bearing claim is "every row is one journal entry, so the two tables
 *  always reconcile". That is not a style note: it is the reason the screen can
 *  be trusted, and it holds only if every figure sums the SAME field. So the
 *  first test adds the rendered tables up and compares them to each other and
 *  to the tiles — the same assertion canon's own property test makes, but on
 *  the pixels. Beside it: an unknown genKind renders (a new kind is a value,
 *  not a schema change), accuracy is shown distinctly, and specialists nest
 *  under their conversation. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { CostDashboard } from "./CostDashboard";
import { digestConversations, summarizeJournal } from "../lib/cost";
import type { JournalEvent } from "../lib/invoke";
import type { Conversation } from "../lib/agentState";
import { INITIAL_AGENT, useStore } from "../store";
import { USER_ACTOR, agentActor, isAgentActor, parseActor } from "../lib/actor";

const TODAY = "2026-09-13";
const AGENT_ARTIST = agentActor("wick", "artist");
const AGENT_DESIGNER = agentActor("wick", "level_designer");
const AGENT_SMITH = agentActor("ember", "mesh_smith");

/** A ledger with every awkward case in it: both doors, two conversations,
 *  tokens beside generation, a kind outside the launch vocabulary, an uncosted
 *  row, and a run a paid backend billed that canon could not price. */
const EVENTS: JournalEvent[] = [
  ev(1, USER_ACTOR, "image", 510, "fal", "flux-pixel-v2", "estimated"),
  ev(2, USER_ACTOR, "animation", 162, "fal", "anim-lcm", "estimated"),
  ev(3, USER_ACTOR, "code", 31, "anthropic", "sonnet-4-6", "measured"),
  ev(4, AGENT_ARTIST, "image", 341, "pixellab", "pixflux", "measured"),
  ev(5, AGENT_ARTIST, "tokens", 22, "anthropic", "sonnet-4-6", "measured"),
  ev(6, AGENT_DESIGNER, "animation", 16, "fal", "anim-lcm", "estimated"),
  ev(7, AGENT_DESIGNER, "tokens", 48, "anthropic", "sonnet-4-6", "measured"),
  // W2.2's kind, arriving as a VALUE with nothing edited here:
  ev(8, AGENT_SMITH, "mesh", 84, "meshy", "preview", "estimated"),
  ev(13, USER_ACTOR, "image", 700, "fal", "flux-pixel-v2", "estimated", {
    ts: `${TODAY}T09:00:00+00:00`,
  }),
  // An uncosted row (History yes, dashboard no) and an unpriced one:
  {
    schema: 1,
    ts: "2026-09-09T12:00:00+00:00",
    artifact_id: "enemy:x",
    op: "edit",
    source: "user",
    actor: USER_ACTOR,
    identity: "user",
    detail: { kind: "db_update" },
  },
  {
    schema: 1,
    ts: "2026-09-10T12:00:00+00:00",
    artifact_id: "enemy:y",
    op: "regenerate",
    source: "llm",
    actor: USER_ACTOR,
    identity: "user",
    genKind: "image",
    gen: { backend: "fal", model: "fal-ai/new-thing" },
    detail: { kind: "asset_generate", cost_error: "fal: no price row for 'fal-ai/new-thing'" },
  },
];

function ev(
  i: number,
  actor: string,
  genKind: string,
  costCents: number,
  backend: string,
  model: string,
  accuracy: string,
  extra: Partial<JournalEvent> = {},
): JournalEvent {
  const identity = isAgentActor(actor) ? actor : "user";
  const session = parseActor(identity).conversation ?? undefined;
  return {
    schema: 1,
    ts: `2026-09-0${i % 10}T12:00:00+00:00`,
    artifact_id: genKind === "tokens" ? `conversation:${session}` : `enemy:e${i}`,
    op: "generate",
    source: "llm",
    actor,
    identity,
    ...(session ? { session } : {}),
    detail: { kind: genKind === "tokens" ? "turn" : "asset_generate" },
    gen: { backend, model, cost_usd: costCents / 100 },
    genKind,
    costCents,
    accuracy,
    ...extra,
  };
}

/** Read a "$12.34" cell back into integer cents so a test can add rows up the
 *  way a reader does — off the rendered text, not the fixture. */
function cents(text: string | null | undefined): number {
  if (!text || text === "—") return 0;
  return Math.round(Number(text.replace(/[$,]/g, "")) * 100);
}

function cellCents(row: HTMLElement, index: number): number {
  return cents(row.querySelectorAll("td")[index]?.textContent);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "journal_list") {
      return Promise.resolve({
        result: "journal_list",
        events: EVENTS,
        summary: summarizeJournal(EVENTS, TODAY),
      });
    }
    if (cmd === "spend_list") {
      return Promise.resolve({
        result: "spend_list",
        spend: {
          count: 1,
          total_actual_usd: 0.5,
          total_estimate_usd: 0,
          by_op: {},
          // A pre-A6 row: no journal_ref, so it is NOT in the journal total.
          entries: [{ op: "world", actual_usd: 0.5 }],
        },
      });
    }
    if (cmd === "read_world_json") return Promise.resolve({ generation_stats: {} });
    return Promise.resolve(null);
  });
  useStore.setState({
    worldPath: "/w",
    world: { path: "/w", name: "The Wandering Wick", world_kind: "platformer", entity_counts: [] },
    dashboardOpen: true,
    agent: {
      ...INITIAL_AGENT,
      conversations: {
        wick: { ...conversationStub("wick"), status: "streaming" },
        ember: { ...conversationStub("ember"), status: "idle" },
      },
    },
  });
});

function conversationStub(id: string): Conversation {
  return {
    id,
    title: id,
    model: null,
    mode: "ask",
    items: [],
    status: "idle",
    usage: { input: 0, output: 0 },
    costCents: null,
    createdAt: 0,
    unreadError: false,
    specialist: "foreman",
    awaiting: [],
    order: 0,
  } as unknown as Conversation;
}

describe("CostDashboard", () => {
  it("the tables reconcile: every figure is a sum of the same costCents", async () => {
    render(<CostDashboard />);
    await screen.findByTestId("by-kind");

    const total = cents(screen.getByTestId("tile-total").textContent?.replace("total", ""));
    const generation = cents(
      screen.getByTestId("tile-generation").textContent?.replace("generation", ""),
    );
    const conversation = cents(
      screen.getByTestId("tile-conversation").textContent?.replace("conversation", ""),
    );
    expect(generation + conversation).toBe(total);

    // by-kind's totals row is the generation tile, and its you/agent columns
    // are the split bar.
    const kindTotals = screen.getByTestId("kind-total");
    expect(cellCents(kindTotals, 4)).toBe(generation);
    const kindRows = within(screen.getByTestId("by-kind"))
      .getAllByRole("row")
      .filter((r) => r.getAttribute("data-testid")?.startsWith("kind-"))
      .filter((r) => r.getAttribute("data-testid") !== "kind-total");
    expect(kindRows.reduce((n, r) => n + cellCents(r, 5), 0)).toBe(generation);
    expect(kindRows.reduce((n, r) => n + cellCents(r, 3) + cellCents(r, 4), 0)).toBe(generation);

    // by-identity's total column is the TOTAL tile (it carries tokens too).
    const identityParents = within(screen.getByTestId("by-identity"))
      .getAllByRole("row")
      .filter((r) => {
        const id = r.getAttribute("data-testid") ?? "";
        return id === "identity-you" || id.startsWith("identity-agent-");
      });
    expect(identityParents.reduce((n, r) => n + cellCents(r, 3), 0)).toBe(total);

    // by-conversation covers exactly the agent lanes.
    const agentTotal = identityParents
      .filter((r) => (r.getAttribute("data-testid") ?? "").startsWith("identity-agent-"))
      .reduce((n, r) => n + cellCents(r, 3), 0);
    const conversationRows = within(screen.getByTestId("by-conversation"))
      .getAllByRole("row")
      .filter((r) => (r.getAttribute("data-testid") ?? "").startsWith("conversation-"));
    expect(conversationRows.reduce((n, r) => n + cellCents(r, 2), 0)).toBe(agentTotal);
  });

  it("an unknown generation kind renders as its own row — a value, not a schema change", async () => {
    render(<CostDashboard />);
    const mesh = await screen.findByTestId("kind-mesh");
    expect(mesh.textContent).toContain("mesh");
    expect(mesh.textContent).toContain("meshy");
    expect(mesh.textContent).toContain("$0.84");
  });

  it("shows measured and estimated distinctly, and names unpriced runs", async () => {
    render(<CostDashboard />);
    await screen.findByTestId("accuracy");
    expect(screen.getByTestId("accuracy-measured").textContent).toContain("measured");
    expect(screen.getByTestId("accuracy-estimated").textContent).toContain("estimated");
    // The fal gap is visible; the run that could not be priced is named, not $0.
    expect(screen.getByTestId("accuracy-unpriced").textContent).toMatch(/1 unpriced run/);
    expect(screen.getByTestId("accuracy").textContent).toContain("Never a silent $0");
  });

  it("nests specialists under their conversation, and a human row has no token entry", async () => {
    render(<CostDashboard />);
    await screen.findByTestId("by-identity");
    const parent = screen.getByTestId("identity-agent-wick");
    expect(parent.textContent).toContain("agent:wick");
    const artist = screen.getByTestId(`identity-specialist-${AGENT_ARTIST}`);
    const designer = screen.getByTestId(`identity-specialist-${AGENT_DESIGNER}`);
    // the parent is the sum of its children — nesting cannot drift
    expect(cellCents(parent, 3)).toBe(cellCents(artist, 3) + cellCents(designer, 3));
    // README §12: human rows have no token column entry at all
    expect(screen.getByTestId("identity-you").querySelectorAll("td")[1].textContent).toBe("—");
  });

  it("marks a running conversation and leaves an idle one alone", async () => {
    render(<CostDashboard />);
    await screen.findByTestId("by-conversation");
    expect(screen.getByTestId("conversation-wick").textContent).toContain("running");
    expect(screen.getByTestId("conversation-ember").textContent).not.toContain("running");
  });

  it("keeps pre-A6 spend rows out of the tiles and says where they went", async () => {
    render(<CostDashboard />);
    await screen.findByTestId("cost-dashboard");
    await waitFor(() =>
      expect(screen.getByTestId("cost-dashboard").textContent).toContain("predates the journal"),
    );
    // …and it is not silently folded into the total
    const total = cents(screen.getByTestId("tile-total").textContent?.replace("total", ""));
    expect(total).toBe(summarizeJournal(EVENTS, TODAY).totalCents);
  });

  it("reads the last full run's total from the standalone generation_stats.json", async () => {
    // A platformer pack embeds no stats block in its manifest — the file at
    // the root is the only record. Reading the embedded block alone left this
    // line blank for a $2.60 run.
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "journal_list") {
        return Promise.resolve({ result: "journal_list", summary: summarizeJournal(EVENTS, TODAY) });
      }
      if (cmd === "read_world_json") {
        return args?.name === "generation_stats"
          ? Promise.resolve({ total_cost_usd: 2.6 })
          : Promise.resolve({ seed: "x" });
      }
      return Promise.resolve(null);
    });
    render(<CostDashboard />);
    const dash = await screen.findByTestId("cost-dashboard");
    await waitFor(() => expect(dash.textContent).toContain("Last full generation run"));
    expect(dash.textContent).toContain("$2.60");
    expect(invokeMock).toHaveBeenCalledWith("read_world_json", { path: "/w", name: "generation_stats" });
  });

  it("falls back to a manifest's embedded stats block only when there is no standalone file", async () => {
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "journal_list") {
        return Promise.resolve({ result: "journal_list", summary: summarizeJournal(EVENTS, TODAY) });
      }
      if (cmd === "read_world_json") {
        return args?.name === "generation_stats"
          ? Promise.reject(new Error("no such file"))
          : Promise.resolve({ generation_stats: { total_cost_usd: 3 } });
      }
      return Promise.resolve(null);
    });
    render(<CostDashboard />);
    const dash = await screen.findByTestId("cost-dashboard");
    await waitFor(() => expect(dash.textContent).toContain("Last full generation run"));
    expect(dash.textContent).toContain("$3.00");
  });

  it("renders from the roll-up alone, with no events in the reply", async () => {
    // `journal list --summary` returns the roll-up INSTEAD of every event —
    // the dashboard must never need the raw list to draw a table.
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "journal_list"
        ? Promise.resolve({ result: "journal_list", summary: summarizeJournal(EVENTS, TODAY) })
        : Promise.resolve(null),
    );
    render(<CostDashboard />);
    await screen.findByTestId("cost-dashboard");
    expect(cents(screen.getByTestId("tile-total").textContent?.replace("total", ""))).toBe(
      summarizeJournal(EVENTS, TODAY).totalCents,
    );
    expect(screen.getByTestId("kind-image")).toBeTruthy();
  });

  it("falls back to the client roll-up when canon returned only events", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "journal_list"
        ? Promise.resolve({ result: "journal_list", events: EVENTS })
        : Promise.resolve(null),
    );
    render(<CostDashboard />);
    const kind = await screen.findByTestId("kind-image");
    expect(kind).toBeTruthy();
    // the same arithmetic, so the same answer
    expect(cellCents(screen.getByTestId("kind-total"), 4)).toBe(
      summarizeJournal(EVENTS).generationCents,
    );
  });
});

/** The money guard. An all-zero roll-up means two different things and the
 *  dashboard used to print the same "$0.00" for both — so a mistyped project
 *  folder, or a paid run whose journal write never landed, read as a free run.
 *  These are the two documents side by side. */
describe("a project with no journal is not a project that spent nothing", () => {
  const NONE: JournalEvent[] = [];

  function answer(journalReply: Record<string, unknown>) {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "journal_list"
        ? Promise.resolve(journalReply)
        : cmd === "read_world_json"
          ? Promise.resolve({ generation_stats: {} })
          : Promise.resolve(null),
    );
  }

  it("says so in words and refuses to print a figure it does not have", async () => {
    answer({
      result: "journal_list",
      journal: { present: false, path: "/w/.canon/journal.jsonl" },
      warnings: ["No journal file at /w/.canon/journal.jsonl — …"],
      summary: {
        ...summarizeJournal(NONE, TODAY),
        journalPresent: false,
        journalPath: "/w/.canon/journal.jsonl",
      },
    });
    render(<CostDashboard />);
    const banner = await screen.findByTestId("journal-missing");
    expect(banner.textContent).toContain("no journal");
    expect(banner.textContent).toContain("absence of records");
    expect(banner.textContent).toContain("/w/.canon/journal.jsonl");
    // No tile may read as money — an unknown is "—", never "$0.00".
    for (const id of ["tile-total", "tile-generation", "tile-conversation", "tile-today"]) {
      expect(screen.getByTestId(id).textContent).not.toContain("$");
      expect(screen.getByTestId(id).textContent).toContain("—");
    }
    // …and neither may the empty table's copy claim nothing was spent.
    expect(screen.getByTestId("by-conversation").textContent).toContain("nothing is known");
    expect(screen.queryByTestId("split-bar")).toBeNull();
  });

  it("reads the marker off the roll-up when that is all canon sent", async () => {
    // `--summary` hands the client the roll-up ALONE, so the fact has to
    // travel inside it — that copy is the one the dashboard actually sees.
    answer({
      result: "journal_list",
      summary: { ...summarizeJournal(NONE, TODAY), journalPresent: false, journalPath: "/w/j" },
    });
    render(<CostDashboard />);
    expect((await screen.findByTestId("journal-missing")).textContent).toContain("/w/j");
  });

  it("leaves a real journal that recorded nothing costed reading exactly as $0", async () => {
    // The legitimate free run: the file EXISTS, it just has nothing priced in
    // it. Nothing about this screen may change.
    answer({
      result: "journal_list",
      journal: { present: true, path: "/w/.canon/journal.jsonl" },
      summary: { ...summarizeJournal(NONE, TODAY), journalPresent: true, journalPath: "/w/j" },
    });
    render(<CostDashboard />);
    await screen.findByTestId("cost-dashboard");
    await waitFor(() => expect(screen.getByTestId("tile-total").textContent).toContain("$0"));
    expect(screen.queryByTestId("journal-missing")).toBeNull();
    expect(screen.getByTestId("by-conversation").textContent).toContain("has spent anything");
  });

  it("treats a canon that reports nothing as unknown, not as missing", async () => {
    // Three states, not two: no marker at all is an older canon, and the
    // screen must keep behaving exactly as it did before the marker existed.
    answer({ result: "journal_list", summary: summarizeJournal(EVENTS, TODAY) });
    render(<CostDashboard />);
    await screen.findByTestId("cost-dashboard");
    await waitFor(() =>
      expect(screen.getByTestId("tile-total").textContent).toContain(
        `$${(summarizeJournal(EVENTS, TODAY).totalCents / 100).toFixed(2)}`,
      ),
    );
    expect(screen.queryByTestId("journal-missing")).toBeNull();
  });

  it("passes a warning canon sent about a journal that IS there straight through", async () => {
    answer({
      result: "journal_list",
      journal: { present: true, path: "/w/j" },
      warnings: ["two rows share a batch id"],
      summary: { ...summarizeJournal(EVENTS, TODAY), journalPresent: true },
    });
    render(<CostDashboard />);
    expect((await screen.findByTestId("journal-warning")).textContent).toContain(
      "two rows share a batch id",
    );
  });
});

describe("summarizeJournal", () => {
  it("counts uncosted rows nowhere and reports unpriced runs", () => {
    const s = summarizeJournal(EVENTS, TODAY);
    expect(s.eventCount).toBe(EVENTS.length);
    expect(s.costedEvents).toBe(EVENTS.filter((e) => e.costCents != null).length);
    expect(s.unpricedRuns).toBe(1);
    expect(s.totalCents).toBe(
      EVENTS.reduce((n, e) => n + (typeof e.costCents === "number" ? e.costCents : 0), 0),
    );
  });

  it("today is a date match on the event's own ts, never a client guess", () => {
    expect(summarizeJournal(EVENTS, TODAY).todayCents).toBe(700);
    expect(summarizeJournal(EVENTS, "1999-01-01").todayCents).toBe(0);
  });

  it("derives identity for a pre-A6 event that carries none", () => {
    const legacy: JournalEvent[] = [
      { ts: "2026-08-01T00:00:00+00:00", actor: USER_ACTOR, genKind: "image", costCents: 5 },
      {
        ts: "2026-08-01T00:00:00+00:00",
        actor: agentActor("mason", "artist"),
        genKind: "image",
        costCents: 7,
      },
    ];
    const s = summarizeJournal(legacy);
    expect(s.youCents).toBe(5);
    expect(s.agentCents).toBe(7);
    expect(s.byIdentity.map((r) => r.identity).sort()).toEqual([
      agentActor("mason", "artist"),
      "user",
    ]);
  });
});

/** The history menu's rows come from here. The one thing that must never be
 *  true is that the menu and this dashboard disagree about what a conversation
 *  cost — so the digest takes its money from the by-conversation roll-up
 *  itself rather than adding the same events up a second time. */
describe("digestConversations", () => {
  it("carries the by-conversation roll-up's own cents, not a second sum", () => {
    const rolled = summarizeJournal(EVENTS, TODAY);
    const digests = digestConversations(EVENTS);
    for (const row of rolled.byConversation) {
      const d = digests.get(row.session)!;
      expect(d.totalCents).toBe(row.totalCents);
      expect(d.tokensCents).toBe(row.tokensCents);
      expect(d.generationCents).toBe(row.generationCents);
      expect(d.runs).toBe(row.runs);
      // The who-split is a partition of that same total.
      expect(d.youCents + d.agentCents).toBe(row.totalCents);
    }
  });

  it("names what the calls were, newest-first timestamp and all, tokens aside", () => {
    const d = digestConversations(EVENTS).get("wick")!;
    // `tokens` is the conversation itself, not a call it made — it is the one
    // kind held out of the list, and its money stays visible as tokensCents.
    expect(d.kinds.map((k) => k.genKind)).not.toContain("tokens");
    expect(d.kinds.map((k) => k.genKind).sort()).toEqual(["animation", "image"]);
    expect(d.tokensCents).toBeGreaterThan(0);
    const wick = EVENTS.filter((e) => e.session === "wick");
    expect(d.lastTs).toBe(wick[wick.length - 1].ts);
    expect(d.models.map((m) => m.model)).toContain("sonnet-4-6");
    expect(d.byAgent).toBe(true);
    expect(d.byYou).toBe(false);
  });

  it("renders a genKind nobody has seen, because it never switches on a list", () => {
    const d = digestConversations(EVENTS).get("ember")!;
    expect(d.kinds.map((k) => k.genKind)).toEqual(["mesh"]);
    const invented = digestConversations([
      { ts: "2026-09-01T00:00:00+00:00", session: "s", actor: USER_ACTOR, genKind: "hologram" },
    ]).get("s")!;
    expect(invented.kinds).toEqual([{ genKind: "hologram", runs: 1 }]);
  });

  it("keeps a conversation whose every run went unpriced — an absent row reads like $0", () => {
    const d = digestConversations([
      {
        ts: "2026-09-01T00:00:00+00:00",
        session: "broke",
        actor: agentActor("broke", "artist"),
        genKind: "image",
        gen: { backend: "fal", model: "fal-ai/new-thing" },
        detail: { cost_error: "no price row" },
      },
    ]).get("broke")!;
    expect(summarizeJournal([]).byConversation).toEqual([]);
    expect(d.runs).toBe(0);
    expect(d.events).toBe(1);
    expect(d.unpriced).toBe(1);
  });
});
