import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (s: string) => s,
}));

import { WorldBibleView } from "./WorldBibleView";
import { useStore } from "../store";

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
  });
  invokeMock.mockReset();
}

type Bible = {
  story?: {
    title?: string;
    synopsis?: string;
    seed?: string;
    faction?: { name?: string; threat_level?: number; leader?: string };
    escalation_arc?: string[];
    beats?: { room_id?: string; summary?: string; escalation?: number }[];
    climax?: string;
    final_boss_name?: string;
    final_boss_lore?: string;
    key_npc_names?: string[];
  };
};

type Manifest = Record<string, unknown>;
type Stats = Record<string, unknown>;

function setupInvoke(opts: {
  bible?: Bible | Promise<Bible>;
  bibleReject?: unknown;
  manifest?: Manifest | null;
  stats?: Stats | null;
  resolveAsset?: string | null;
}) {
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "get_world_bible":
        if (opts.bibleReject !== undefined) return Promise.reject(opts.bibleReject);
        return Promise.resolve(opts.bible);
      case "read_world_json": {
        const name = (args?.name ?? "") as string;
        if (name === "manifest") {
          return opts.manifest === null
            ? Promise.reject(new Error("no manifest"))
            : Promise.resolve(opts.manifest ?? {});
        }
        if (name === "generation_stats") {
          return opts.stats === null
            ? Promise.reject(new Error("no stats"))
            : Promise.resolve(opts.stats ?? null);
        }
        return Promise.resolve(null);
      }
      case "resolve_asset":
        return Promise.resolve(opts.resolveAsset ?? null);
      default:
        return Promise.reject(new Error(`unexpected ${cmd}`));
    }
  });
}

describe("WorldBibleView", () => {
  beforeEach(resetStore);

  it("renders 'Loading World Bible…' before the fetch resolves", () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<WorldBibleView />);
    expect(screen.getByText("Loading World Bible…")).toBeInTheDocument();
  });

  it("renders 'Error: …' when get_world_bible rejects", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({ bibleReject: new Error("boom") });
    render(<WorldBibleView />);
    await waitFor(() => {
      expect(screen.getByText(/Error:.*boom/)).toBeInTheDocument();
    });
  });

  it("renders title and synopsis when bible loads", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: { story: { title: "Saga", synopsis: "A short tale." } },
      manifest: null,
      stats: null,
    });
    render(<WorldBibleView />);
    expect(await screen.findByRole("heading", { name: "Saga" })).toBeInTheDocument();
    expect(screen.getByText("A short tale.")).toBeInTheDocument();
  });

  it("renders '(untitled)' when story.title is missing", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({ bible: { story: {} }, manifest: null, stats: null });
    render(<WorldBibleView />);
    expect(
      await screen.findByRole("heading", { name: "(untitled)" }),
    ).toBeInTheDocument();
  });

  it("renders entity-count chips and clicking one selects that type", async () => {
    useStore.setState({
      worldPath: "/w",
      world: {
        path: "/w",
        name: "w",
        entity_counts: [
          { type_id: "rooms", count: 5 },
          { type_id: "npcs", count: 3 },
        ],
      },
    });
    setupInvoke({ bible: { story: {} }, manifest: null, stats: null });
    const { container } = render(<WorldBibleView />);
    await screen.findByRole("heading", { name: "(untitled)" });

    const chips = container.querySelectorAll(".count-chip");
    expect(chips).toHaveLength(2);

    fireEvent.click(chips[0]);
    expect(useStore.getState().selection).toEqual({
      kind: "type",
      typeId: "rooms",
    });
  });

  it("renders the faction section when story.faction.name is set", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: {
        story: {
          faction: { name: "The Wolves", threat_level: 7, leader: "Ulric" },
        },
      },
      manifest: null,
      stats: null,
    });
    render(<WorldBibleView />);
    expect(await screen.findByText("The Wolves")).toBeInTheDocument();
    expect(screen.getByText("threat 7")).toBeInTheDocument();
    expect(screen.getByText("led by Ulric")).toBeInTheDocument();
  });

  it("omits the faction section when story.faction.name is absent", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({ bible: { story: {} }, manifest: null, stats: null });
    render(<WorldBibleView />);
    await screen.findByRole("heading", { name: "(untitled)" });
    expect(screen.queryByRole("heading", { name: "Faction" })).toBeNull();
  });

  it("renders escalation_arc as an ordered list with each step", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: { story: { escalation_arc: ["one", "two", "three"] } },
      manifest: null,
      stats: null,
    });
    const { container } = render(<WorldBibleView />);
    await screen.findByRole("heading", { name: "Escalation Arc" });
    const items = container.querySelectorAll(".arc-list li");
    expect(Array.from(items).map((i) => i.textContent)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("renders beats; clicking a beat-room button selects that room entity", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: {
        story: {
          beats: [{ room_id: "room_3", summary: "first beat" }],
        },
      },
      manifest: null,
      stats: null,
    });
    render(<WorldBibleView />);
    const btn = await screen.findByRole("button", { name: "room_3" });
    fireEvent.click(btn);
    expect(useStore.getState().selection).toEqual({
      kind: "entity",
      typeId: "rooms",
      id: "room_3",
    });
  });

  it("omits the Beats heading when there are no beats", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: { story: { title: "X" } },
      manifest: null,
      stats: null,
    });
    render(<WorldBibleView />);
    await screen.findByRole("heading", { name: "X" });
    expect(screen.queryByRole("heading", { name: "Beats" })).toBeNull();
  });

  it("renders climax + final-boss-name when present", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: {
        story: {
          climax: "The final battle.",
          final_boss_name: "The Devourer",
        },
      },
      manifest: null,
      stats: null,
    });
    render(<WorldBibleView />);
    expect(await screen.findByText("The final battle.")).toBeInTheDocument();
    expect(screen.getByText("The Devourer")).toBeInTheDocument();
  });

  it("renders Generation stats with USD formatted to 4 decimals", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: { story: {} },
      manifest: null,
      stats: { total_cost_usd: 1.234, llm_calls: 42 },
    });
    render(<WorldBibleView />);
    expect(
      await screen.findByRole("heading", { name: "Generation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$1.2340")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("omits Generation section when generation_stats fetch fails", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({ bible: { story: {} }, manifest: null, stats: null });
    render(<WorldBibleView />);
    await screen.findByRole("heading", { name: "(untitled)" });
    expect(screen.queryByRole("heading", { name: "Generation" })).toBeNull();
  });

  it("hides the hero image when resolve_asset returns null", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: { story: { title: "X" } },
      manifest: { start_portrait: "hero.png" },
      stats: null,
      resolveAsset: null,
    });
    const { container } = render(<WorldBibleView />);
    await screen.findByRole("heading", { name: "X" });
    expect(container.querySelector(".bible-hero-img")).toBeNull();
  });

  it("renders the hero image when resolve_asset returns a path", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: { story: { title: "X" } },
      manifest: { start_portrait: "hero.png" },
      stats: null,
      resolveAsset: "/abs/path/to/hero.png",
    });
    const { container } = render(<WorldBibleView />);
    await screen.findByRole("heading", { name: "X" });
    await waitFor(() => {
      expect(container.querySelector(".bible-hero-img")).not.toBeNull();
    });
  });

  it("clicking the hero image opens the lightbox", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: { story: { title: "X" } },
      manifest: { start_portrait: "hero.png" },
      stats: null,
      resolveAsset: "/abs/hero.png",
    });
    const { container } = render(<WorldBibleView />);
    await waitFor(() => {
      expect(container.querySelector(".bible-hero-img")).not.toBeNull();
    });
    fireEvent.click(container.querySelector(".bible-hero-img")!);
    expect(useStore.getState().lightbox).toMatchObject({
      src: "/abs/hero.png",
      alt: "world start portrait",
    });
  });

  it("renders key NPC chips when present", async () => {
    useStore.setState({
      worldPath: "/w",
      world: { path: "/w", name: "w", entity_counts: [] },
    });
    setupInvoke({
      bible: {
        story: { key_npc_names: ["Alice", "Bob"] },
      },
      manifest: null,
      stats: null,
    });
    render(<WorldBibleView />);
    expect(
      await screen.findByRole("heading", { name: "Key NPCs" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });
});
