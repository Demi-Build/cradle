import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** The platformer-only surfaces (world map, library, ▶ Play game, ＋ new
 *  level) gate on the world's registry kind — canon's `pack_type`, carried as
 *  `world_kind` (P0-3). They used to sniff for a `tilesets` entity count, so a
 *  dungeon that happened to list tilesets grew a Godot play button. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { LeftNav } from "./LeftNav";
import { useStore } from "../store";

function resetStore() {
  useStore.setState({
    worldPath: "/w",
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
  invokeMock.mockResolvedValue([]);
}

describe("LeftNav world_kind gating", () => {
  beforeEach(resetStore);

  it("shows the platformer surfaces for world_kind === 'platformer'", () => {
    useStore.setState({
      world: {
        path: "/w",
        name: "w",
        world_kind: "platformer",
        entity_counts: [
          { type_id: "levels", count: 2 },
          { type_id: "enemies", count: 3 },
        ],
      },
    });
    render(<LeftNav />);
    expect(screen.getByText(/WORLD MAP/)).toBeInTheDocument();
    expect(screen.getByText(/LIBRARY/)).toBeInTheDocument();
    expect(screen.getByText(/Play game/)).toBeInTheDocument();
    expect(screen.getByTitle("New draft level")).toBeInTheDocument();
  });

  it("hides them for a dungeon even when the counts list tilesets (the retired sniff)", () => {
    useStore.setState({
      world: {
        path: "/w",
        name: "w",
        world_kind: "dungeon",
        entity_counts: [
          { type_id: "rooms", count: 5 },
          { type_id: "levels", count: 1 },
          { type_id: "tilesets", count: 1 },
        ],
      },
    });
    render(<LeftNav />);
    expect(screen.queryByText(/WORLD MAP/)).toBeNull();
    expect(screen.queryByText(/LIBRARY/)).toBeNull();
    expect(screen.queryByText(/Play game/)).toBeNull();
    expect(screen.queryByTitle("New draft level")).toBeNull();
    // Every declared type still lists — the kind gates surfaces, not data.
    expect(screen.getByText("(5)")).toBeInTheDocument();
  });
});
