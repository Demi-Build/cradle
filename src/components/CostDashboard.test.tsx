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
import { summarizeJournal } from "../lib/cost";
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
