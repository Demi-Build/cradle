import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** Platformer items share the "items" type id with MazeWorld's. The table
 *  picks the platformer column/sort set by the world's registry kind —
 *  canon's `pack_type`, carried as `world_kind` (P0-3) — never by sniffing a
 *  row's fields.
 *
 *  The "＋ new row" affordance is REGISTRY-driven since row P0-8: a kind is
 *  creatable when `pack info` declares it and no grid owns it, so all nine
 *  dungeon types get it too. Without pack info (an older source) the table
 *  falls back to the platformer gate rather than offering a create it cannot
 *  serve. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { EntityTable } from "./EntityTable";
import { useStore } from "../store";
import { DUNGEON_PACK_INFO } from "../test/fixtures/roomBundle";

function resetStore() {
  useStore.setState({
    worldPath: "/w",
    world: null,
    entities: {},
    selection: { kind: "none" },
    error: null,
    lightbox: null,
    recents: [],
    route: "start",
    loading: false,
  });
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
}

function setWorld(world_kind: string, pack_info: typeof DUNGEON_PACK_INFO | null = null) {
  useStore.setState({
    world: {
      path: "/w",
      name: "w",
      world_kind,
      entity_counts: [{ type_id: "items", count: 2 }],
      pack_info,
    },
  });
}

// The same two rows under both kinds: a platformer-shaped row in a dungeon
// world must NOT flip the table into platformer mode.
const rows = [
  { id: "coin", data: { name: "Coin", kind: "coin", rarity: "common", params: { coin_value: 1 } } },
  {
    id: "potion",
    data: { name: "Potion", kind: "heal", rarity: "rare", params: { heal_amount: 5 } },
  },
];

describe("EntityTable items by world_kind", () => {
  beforeEach(resetStore);

  it("uses the platformer item sorts + anchored new-row for world_kind === 'platformer'", () => {
    setWorld("platformer");
    render(<EntityTable typeId="items" rows={rows} />);
    expect(screen.getByRole("option", { name: "Rarity → Name" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Kind → Name" })).toBeInTheDocument();
    expect(screen.getByTitle("New row (anchored generation)")).toBeInTheDocument();
  });

  it("keeps the MazeWorld item table for a dungeon even when rows look platformer-shaped", () => {
    setWorld("dungeon");
    render(<EntityTable typeId="items" rows={rows} />);
    expect(screen.queryByRole("option", { name: "Rarity → Name" })).toBeNull();
    // No pack info: the create affordance falls back rather than promising
    // something the table cannot serve.
    expect(screen.queryByTitle("New row (anchored generation)")).toBeNull();
  });

  it("offers ＋ new row for a dungeon kind the registry declares (row P0-8)", () => {
    setWorld("dungeon", DUNGEON_PACK_INFO);
    render(<EntityTable typeId="items" rows={rows} />);
    expect(screen.getByTitle("New row (anchored generation)")).toBeInTheDocument();
    // …and still not the platformer's item sorts: the kind is data, the
    // COLUMN set is the world's.
    expect(screen.queryByRole("option", { name: "Rarity → Name" })).toBeNull();
  });

  it("never offers ＋ new row for a kind a GRID owns — a room is made by its verb", () => {
    setWorld("dungeon", DUNGEON_PACK_INFO);
    render(<EntityTable typeId="rooms" rows={[]} />);
    expect(screen.queryByTitle("New row (anchored generation)")).toBeNull();
  });

  it("treats an unknown kind as data, not as a platformer", () => {
    setWorld("shooter");
    render(<EntityTable typeId="items" rows={rows} />);
    expect(screen.queryByRole("option", { name: "Rarity → Name" })).toBeNull();
  });
});
