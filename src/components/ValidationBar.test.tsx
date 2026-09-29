import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValidationBar } from "./ValidationBar";
import { INITIAL_AGENT, useStore } from "../store";
import type { Conversation } from "../lib/agentState";
import { agentActor } from "../lib/actor";

function resetStore() {
  useStore.setState({
    worldPath: "",
    world: null,
    worldStoryTitle: null,
    worldBeats: [],
    entities: {},
    selection: { kind: "none" },
    error: null,
    lightbox: null,
    recents: [],
    route: "start",
    drawerOpen: false,
    loading: false,
    agent: INITIAL_AGENT,
  });
}

/** A conversation for the status segment. `status` defaults to "streaming"
 *  (the busy case the segment renders on its own); pass "idle" for a tab that
 *  is only rendered because ANOTHER conversation is running. */
function conversation(id: string, specialist: string, status = "streaming"): Conversation {
  return {
    id,
    title: id,
    model: null,
    mode: "ask",
    items: [],
    status,
    usage: { input: 0, output: 0 },
    costCents: null,
    createdAt: 0,
    unreadError: false,
    specialist,
    awaiting: [],
    order: 0,
  } as unknown as Conversation;
}

const WORLD = {
  path: "/w",
  name: "The Silent Gospel",
  world_kind: "platformer",
  entity_counts: [],
};

describe("ValidationBar", () => {
  beforeEach(resetStore);

  it("renders 'No world loaded.' when world is null", () => {
    render(<ValidationBar />);
    expect(screen.getByText("No world loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/Checker/)).toBeNull();
  });

  it("renders Checker / Validator / World Editor placeholders when world is set", () => {
    useStore.setState({
      world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [] },
    });
    render(<ValidationBar />);
    expect(screen.getByText("Checker: —")).toBeInTheDocument();
    expect(screen.getByText("Validator: —")).toBeInTheDocument();
    expect(screen.getByText("World Editor: —")).toBeInTheDocument();
    expect(
      screen.getByText("(validation trail wiring lands when canon emits it)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No world loaded.")).toBeNull();
  });

  /** The segment used to render `agent:<name>` and say in a comment that this
   *  was "the same identity the job tray and History use". It was not: actors
   *  are `agent:<conversation>/<specialist>`, so nothing in the journal ever
   *  matched it. The name is now shown AS a name, and the actor it carries is
   *  built by the one constructor in `lib/actor.ts`. */
  it("shows the agent's name, and the real actor rather than a look-alike", () => {
    // A service-side id: a conversation is re-keyed to one on first send.
    useStore.setState({
      world: WORLD,
      worldStoryTitle: "The Silent Gospel",
      agent: {
        ...INITIAL_AGENT,
        activeId: "conv_7",
        conversations: { conv_7: conversation("conv_7", "level_designer") },
      },
    } as never);
    render(<ValidationBar />);
    const seg = screen.getByTestId("status-agent");
    expect(seg.textContent).toContain("WRIGHT");
    expect(seg.textContent).toContain("level designer running");
    // Not the project's title, and not a hand-spelled actor.
    expect(seg.textContent).not.toMatch(/GOSPEL/i);
    expect(seg.textContent).not.toContain("agent:");
    expect(seg.getAttribute("data-actor")).toBe(agentActor("conv_7", "level_designer"));
    expect(seg.getAttribute("title")).toBe(seg.getAttribute("data-actor"));
  });

  /** A tab that has never sent still carries the placeholder id it was minted
   *  with (`local_<n>`), and the service has never heard of it — an actor
   *  built from it would match nothing anywhere. The segment renders (another
   *  conversation is running) but carries no actor at all. */
  it("carries no actor for a conversation the service has not created", () => {
    useStore.setState({
      world: WORLD,
      agent: {
        ...INITIAL_AGENT,
        activeId: "local_1",
        conversations: {
          local_1: conversation("local_1", "foreman", "idle"),
          conv_9: conversation("conv_9", "artist"),
        },
      },
    } as never);
    render(<ValidationBar />);
    const seg = screen.getByTestId("status-agent");
    expect(seg.textContent).toContain("WRIGHT idle");
    expect(seg.textContent).toContain("+1");
    expect(seg.getAttribute("data-actor")).toBeNull();
    expect(seg.getAttribute("title")).toBeNull();
  });

  /** Same rule when the placeholder-id conversation is itself the busy one. */
  it("carries no actor for a busy conversation still on a placeholder id", () => {
    useStore.setState({
      world: WORLD,
      agent: {
        ...INITIAL_AGENT,
        activeId: "local_2",
        conversations: { local_2: conversation("local_2", "foreman") },
      },
    } as never);
    render(<ValidationBar />);
    const seg = screen.getByTestId("status-agent");
    expect(seg.textContent).toContain("foreman running");
    expect(seg.getAttribute("data-actor")).toBeNull();
  });

  /** The idle active conversation is not the one running, so the segment must
   *  not describe it with an actor even when its id IS a service id. */
  it("carries no actor while the active conversation is idle", () => {
    useStore.setState({
      world: WORLD,
      agent: {
        ...INITIAL_AGENT,
        activeId: "conv_1",
        conversations: {
          conv_1: conversation("conv_1", "foreman", "idle"),
          conv_2: conversation("conv_2", "artist"),
        },
      },
    } as never);
    render(<ValidationBar />);
    const seg = screen.getByTestId("status-agent");
    expect(seg.textContent).toContain("WRIGHT idle +1");
    expect(seg.getAttribute("data-actor")).toBeNull();
  });
});
