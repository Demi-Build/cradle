import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/** ⏱ history (D5). The menu used to label each row with its turn count, which
 *  is the one fact about a past conversation nobody needs. Every fact that IS
 *  wanted — what it cost, what it made, on what model, who set it going, when —
 *  is already in the journal, so these tests are about what reaches the pixels
 *  and, just as much, about what must NOT: a conversation that never spent
 *  cannot be allowed to print a dollar figure. */

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
// The menu's OTHER job — reopening a conversation — goes through the service,
// which these tests neither have nor need.
const { openMock, refreshMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("../../lib/agentActions", () => ({
  openFromHistory: (...a: unknown[]) => openMock(...a),
  refreshHistory: (...a: unknown[]) => refreshMock(...a),
}));

import { SessionHistoryMenu } from "./SessionHistoryMenu";
import { INITIAL_AGENT, useStore } from "../../store";
import type { Conversation } from "../../lib/agentState";
import type { JournalEvent } from "../../lib/invoke";
import { USER_ACTOR, agentActor } from "../../lib/actor";

const DAY = "2026-09-04T11:00:00+00:00";
const LATER = "2026-09-05T18:30:00+00:00";

/** One project's ledger, with a conversation for each way "nothing spent" can
 *  happen — they must not render alike. */
const EVENTS: JournalEvent[] = [
  gen("wick", agentActor("wick", "artist"), "image", 300, "pixellab", "pixflux", DAY),
  gen("wick", agentActor("wick", "artist"), "image", 200, "pixellab", "pixflux", DAY),
  gen("wick", agentActor("wick", "artist"), "tokens", 25, "anthropic", "sonnet-4-6", DAY),
  // A call a PERSON fired while this conversation was open.
  gen("wick", USER_ACTOR, "animation", 100, "fal", "anim-lcm", LATER),
  // A real run on an unpaid backend: recorded, and it cost nothing.
  gen("ember", agentActor("ember", "smith"), "mesh", 0, "fake", "none", DAY),
  // A paid backend billed and canon has no price row — the one case where $0
  // would be a lie.
  unpricedEvent("broke"),
  // BOTH at once, in ONE conversation: a free run on a fake backend and a paid
  // one canon could not price. The free run is the only thing carrying a
  // `costCents`, so the roll-up reads runs=1 / totalCents=0 — which is how the
  // row once managed to say a flat "free" about a conversation fal had billed.
  gen("mixed", agentActor("mixed", "smith"), "mesh", 0, "fake", "none", DAY),
  unpricedEvent("mixed"),
];

/** A run a paid backend billed that canon has no price row for: canon writes
 *  `detail.cost_error` and, deliberately, NO `costCents` at all. */
function unpricedEvent(session: string): JournalEvent {
  return {
    ts: DAY,
    session,
    actor: agentActor(session, "artist"),
    identity: agentActor(session, "artist"),
    genKind: "image",
    gen: { backend: "fal", model: "fal-ai/new-thing" },
    detail: { cost_error: "fal: no price row for 'fal-ai/new-thing'" },
  };
}

function gen(
  session: string,
  actor: string,
  genKind: string,
  costCents: number,
  backend: string,
  model: string,
  ts: string,
): JournalEvent {
  return {
    schema: 1,
    ts,
    session,
    artifact_id: `enemy:${session}_${genKind}`,
    op: "generate",
    source: "llm",
    actor,
    identity: actor === USER_ACTOR ? "user" : actor,
    gen: { backend, model },
    genKind,
    costCents,
    accuracy: "measured",
  };
}

function conversationStub(id: string, costCents: number | null): Conversation {
  return {
    id,
    title: id,
    model: null,
    mode: "ask",
    items: [],
    status: "idle",
    usage: { input: 0, output: 0 },
    costCents,
    createdAt: 0,
    unreadError: false,
    specialist: "foreman",
    awaiting: [],
    order: 0,
  } as unknown as Conversation;
}

function seed(journalReply?: Record<string, unknown>) {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) =>
    Promise.resolve(
      cmd === "journal_list"
        ? (journalReply ?? {
            result: "journal_list",
            journal: { present: true, path: "/w/.canon/journal.jsonl" },
            events: EVENTS,
          })
        : {},
    ),
  );
  openMock.mockReset();
  refreshMock.mockReset();
  useStore.setState({
    worldPath: "/w",
    agent: {
      ...INITIAL_AGENT,
      // "live" is open with an estimate the ledger has not caught up with.
      conversations: { live: conversationStub("live", 7) },
      history: [
        { id: "quiet", created: DAY, turns: 9, title: "Quiet one" },
        { id: "broke", created: DAY, turns: 2, title: "Unpriced one" },
        { id: "ember", created: DAY, turns: 4, title: "Free one" },
        { id: "mixed", created: DAY, turns: 3, title: "Free and unpriced" },
        { id: "wick", created: DAY, turns: 6, title: "The lantern pass" },
        { id: "live", created: LATER, turns: 1, title: "Still going" },
      ],
    },
  });
}

const noop = () => {};

describe("the ⏱ history menu shows what happened, not how many turns it took", () => {
  beforeEach(() => seed());

  it("puts the cost, what the calls were, and who fired them on the row", async () => {
    render(<SessionHistoryMenu onClose={noop} />);
    const row = await screen.findByTestId("history-row-wick");
    // The money is the journal's, formatted once: 300 + 200 + 25 + 100.
    await waitFor(() =>
      expect(within(row).getByTestId("history-cost-wick").textContent).toBe("$6.25"),
    );
    const sub = within(row).getByTestId("history-sub-wick").textContent ?? "";
    // WHAT: the most-run kind, verbatim, with the rest counted rather than
    // spelled out — a menu row, not a paragraph.
    expect(sub).toContain("image +1");
    // WHO: a person fired one of these calls and the agent fired the rest.
    expect(sub).toContain("you + agent");
    // WHEN: the last thing it did, not the transcript's length.
    expect(row.textContent).not.toMatch(/\bturns?\b/);
  });

  it("keeps the model off the row and one keystroke away, with the exact time", async () => {
    render(<SessionHistoryMenu onClose={noop} />);
    const row = await screen.findByTestId("history-row-wick");
    await waitFor(() =>
      expect(within(row).getByTestId("history-cost-wick").textContent).toBe("$6.25"),
    );
    // Long ids do not belong on a scannable row…
    expect(within(row).getByTestId("history-sub-wick").textContent).not.toContain("pixflux");
    expect(screen.queryByTestId("history-detail-wick")).toBeNull();

    const toggle = within(row).getByRole("button", { name: /details for/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const detail = within(row).getByTestId("history-detail-wick");
    // …but they are reachable, beside every kind's run count and the split.
    expect(detail.textContent).toContain("pixflux");
    expect(detail.textContent).toContain("sonnet-4-6");
    expect(detail.textContent).toContain("image ×2");
    expect(detail.textContent).toContain("animation ×1");
    expect(detail.textContent).toContain("you $1.00");
    expect(detail.textContent).toContain("agent $5.25");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders a genKind it has never seen rather than a kind it knows", async () => {
    seed({
      result: "journal_list",
      journal: { present: true, path: "/w/j" },
      events: [gen("wick", agentActor("wick", "artist"), "hologram", 5, "someco", "v9", DAY)],
    });
    render(<SessionHistoryMenu onClose={noop} />);
    await waitFor(() =>
      expect(screen.getByTestId("history-sub-wick").textContent).toContain("hologram"),
    );
  });

  it("never prints a dollar figure for a conversation that did not spend", async () => {
    render(<SessionHistoryMenu onClose={noop} />);
    await screen.findByTestId("history-row-wick");

    // Recorded runs that cost nothing — a real free run, said as one.
    await waitFor(() => expect(screen.getByTestId("history-cost-ember").textContent).toBe("free"));
    // A paid backend billed and canon could not price it: not $0, not "free".
    const unpriced = screen.getByTestId("history-cost-broke");
    expect(unpriced.textContent).toBe("unpriced");
    expect(unpriced.getAttribute("title")).toContain("not $0");
    // Nothing recorded at all.
    expect(screen.getByTestId("history-cost-quiet").textContent).toBe("—");
    // An open conversation the ledger has not caught up with shows the panel's
    // own estimate, marked as one — the two sources never add together.
    const live = screen.getByTestId("history-cost-live");
    expect(live.textContent).toBe("~$0.07 est.");
    expect(live.getAttribute("title")).toContain("not yet in the ledger");

    for (const id of ["ember", "broke", "quiet"]) {
      expect(screen.getByTestId(`history-cost-${id}`).textContent).not.toContain("$0.00");
    }
  });

  it("does not call a conversation free when a backend billed a run it could not price", async () => {
    render(<SessionHistoryMenu onClose={noop} />);
    await screen.findByTestId("history-row-wick");
    // "mixed" holds one free run AND one fal billed that canon has no price
    // row for. Reporting only the free half is the exact lie this surface
    // exists to prevent, so the unpriced run rides along on the row itself…
    const cell = await screen.findByTestId("history-cost-mixed");
    await waitFor(() => expect(cell.textContent).not.toBe("free"));
    expect(cell.textContent).toBe("free +1?");
    // …in the same warn colour a priced row uses for the same fact…
    expect(cell.getAttribute("style")).toContain("var(--warn)");
    // …and the title names BOTH halves, not whichever one is convenient.
    const title = cell.getAttribute("title") ?? "";
    expect(title).toContain("1 run recorded, none of which cost anything");
    expect(title).toContain("1 a backend billed that canon could not price");
    expect(cell.textContent).not.toContain("$0.00");
  });

  it("tells a priced row and a free row the same thing about unpriced runs", async () => {
    // The regression was two branches deciding this independently. Whether the
    // priced runs sum to $6.25 or to nothing, the suffix and the colour match.
    seed({
      result: "journal_list",
      journal: { present: true, path: "/w/j" },
      events: [
        gen("wick", agentActor("wick", "artist"), "image", 300, "pixellab", "pixflux", DAY),
        unpricedEvent("wick"),
        gen("mixed", agentActor("mixed", "smith"), "mesh", 0, "fake", "none", DAY),
        unpricedEvent("mixed"),
      ],
    });
    render(<SessionHistoryMenu onClose={noop} />);
    const paid = await screen.findByTestId("history-cost-wick");
    await waitFor(() => expect(paid.textContent).toBe("$3.00 +1?"));
    const free = screen.getByTestId("history-cost-mixed");
    expect(free.textContent).toBe("free +1?");
    expect(free.getAttribute("style")).toBe(paid.getAttribute("style"));
  });

  it("says a missing journal is an unknown, not a zero", async () => {
    seed({
      result: "journal_list",
      journal: { present: false, path: "/w/.canon/journal.jsonl" },
      warnings: ["No journal file at /w/.canon/journal.jsonl — …"],
      events: [],
    });
    render(<SessionHistoryMenu onClose={noop} />);
    const note = await screen.findByTestId("history-nojournal");
    expect(note.textContent).toContain("unknown, not zero");
    expect(screen.getByTestId("history-cost-wick").textContent).toBe("—");
  });

  it("stays quiet about the journal when canon never mentioned it", async () => {
    // Three states: a canon that reports nothing is not a canon reporting a
    // missing file, and the menu must not accuse it of one.
    seed({ result: "journal_list", events: EVENTS });
    render(<SessionHistoryMenu onClose={noop} />);
    await waitFor(() => expect(screen.getByTestId("history-cost-wick").textContent).toBe("$6.25"));
    expect(screen.queryByTestId("history-nojournal")).toBeNull();
  });

  it("still opens the conversation when the row is clicked", async () => {
    render(<SessionHistoryMenu onClose={noop} />);
    const row = await screen.findByTestId("history-row-wick");
    fireEvent.click(within(row).getByText("The lantern pass"));
    expect(openMock).toHaveBeenCalledWith("wick", "The lantern pass");
  });

  it("survives a journal read that fails, and lists the conversations anyway", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "journal_list" ? Promise.reject(new Error("canon exploded")) : Promise.resolve({}),
    );
    render(<SessionHistoryMenu onClose={noop} />);
    const row = await screen.findByTestId("history-row-wick");
    expect(within(row).getByTestId("history-cost-wick").textContent).toBe("—");
  });
});
