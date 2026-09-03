import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** The room Dock (rows P0-5 + P0-8): its tabs come from `pack info`'s
 *  placements — kind order, entity labels — and each one is now a PALETTE of
 *  the pack's own rows. Beside them: a Tiles tab carrying the maze cell
 *  palette (two swatches, `wall` and the `empty` eraser — P.9 G1/G2), a
 *  Monsters tab whose drop builds an encounter (P.9 G4), and `Placed`, which
 *  keeps P0-5's view of what is on the room right now. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { Dock } from "./Dock";
import { useStore } from "../../store";
import { placementTabs } from "../../lib/placements";
import { DUNGEON_PACK_INFO, dungeonWorld, roomBundle } from "../../test/fixtures/roomBundle";

/** The rows the level detail fetches once and hands the dock, per type id. */
const ROWS = {
  npcs: {
    "1000": { name: "Mira", kind: "RandomNPC" },
    "1001": { name: "Bram", kind: "StaticNPC" },
  },
  events: { "3000": { name: "Ambush", kind: "combat" } },
  items: { "2000": { name: "ration cube", kind: "food" } },
  monsters: { "5000": { name: "Wolf", kind: null }, "5001": { name: "Rat", kind: null } },
};

function roomDock(props: Partial<Parameters<typeof Dock>[0]> = {}) {
  return render(
    <Dock
      bundle={roomBundle()}
      brush={null}
      onBrush={() => {}}
      room
      placements={placementTabs(DUNGEON_PACK_INFO)}
      rows={ROWS}
      monsterTypeId="monsters"
      selection={null}
      onSelect={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  useStore.setState({ worldPath: "/w", world: dungeonWorld(), entities: {} });
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("Dock tabs from pack info placements", () => {
  it("renders Tiles + NPCs / Events / Items + Monsters + Placed, in registry order", () => {
    const tabs = placementTabs(DUNGEON_PACK_INFO);
    expect(tabs.map((t) => [t.key, t.kind, t.wire, t.label, t.typeId])).toEqual([
      ["npc_positions", "npc", "entities", "NPCs", "npcs"],
      ["event_positions", "event", "triggers", "Events", "events"],
      ["item_placements", "item", "items", "Items", "items"],
    ]);
    roomDock();
    const buttons = screen.getAllByRole("button", {
      name: /Tiles|NPCs|Events|Items|Monsters|Placed/,
    });
    // Counts are the PALETTE's rows (what you can place), and `Placed` counts
    // what the bundle currently holds.
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Tiles1",
      "NPCs2",
      "Events1",
      "Items1",
      "Monsters2",
      "Placed3",
    ]);
    // The dock never asks for the platformer's own types on a room.
    expect(invokeMock.mock.calls.filter((c) => c[0] === "list_entity_rows")).toHaveLength(0);
    expect(screen.queryByText("Read-only")).toBeNull();
  });

  it("the Tiles tab is the maze cell palette: a wall swatch and the empty eraser", async () => {
    const onBrush = vi.fn();
    const user = userEvent.setup();
    roomDock({ onBrush });
    const tiles = screen.getByRole("list", { name: "Tiles" });
    expect(within(tiles).getByText("wall")).toBeInTheDocument();
    expect(within(tiles).getByText("empty")).toBeInTheDocument();
    await user.click(within(tiles).getByText("wall"));
    expect(onBrush).toHaveBeenLastCalledWith({ kind: "tile", tileType: 1 });
    await user.click(within(tiles).getByText("empty"));
    expect(onBrush).toHaveBeenLastCalledWith({ kind: "eraser" });
  });

  it("each placement tab arms the pack's own rows on the right wire", async () => {
    const onBrush = vi.fn();
    const user = userEvent.setup();
    roomDock({ onBrush });
    await user.click(screen.getByRole("button", { name: /NPCs/ }));
    await user.click(within(screen.getByRole("list", { name: "NPCs" })).getByText("Bram"));
    expect(onBrush).toHaveBeenLastCalledWith({ kind: "enemy", enemyId: "1001", variant: null });

    await user.click(screen.getByRole("button", { name: /Events/ }));
    await user.click(within(screen.getByRole("list", { name: "Events" })).getByText("Ambush"));
    expect(onBrush).toHaveBeenLastCalledWith({
      kind: "event",
      eventId: "3000",
      eventType: "combat",
    });

    await user.click(screen.getByRole("button", { name: /Items/ }));
    await user.click(within(screen.getByRole("list", { name: "Items" })).getByText("ration cube"));
    expect(onBrush).toHaveBeenLastCalledWith({ kind: "item", itemId: "2000", source: "" });
  });

  it("the Monsters tab arms a monster — the drop builds the encounter (P.9 G4)", async () => {
    const onBrush = vi.fn();
    const user = userEvent.setup();
    roomDock({ onBrush });
    await user.click(screen.getByRole("button", { name: /Monsters/ }));
    const list = screen.getByRole("list", { name: "Monsters" });
    expect(within(list).getByTitle(/monster 5000 · drop it on a cell/)).toBeInTheDocument();
    await user.click(within(list).getByText("Wolf"));
    expect(onBrush).toHaveBeenLastCalledWith({ kind: "monster", monsterId: "5000" });
  });

  it("no monster kind, no Monsters tab (the tab is registry data, not a literal)", () => {
    roomDock({ monsterTypeId: null });
    expect(screen.queryByRole("button", { name: /Monsters/ })).toBeNull();
  });

  it("the Placed tab lists what is on the room and selecting one reports the placement", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    roomDock({ onSelect });
    await user.click(screen.getByRole("button", { name: /Placed/ }));
    const placed = screen.getByRole("list", { name: "Placed" });
    await user.click(within(placed).getByText("Mira"));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "enemy", index: 0 });
    await user.click(within(placed).getByText("combat · gate"));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "trigger", index: 0 });
    await user.click(within(placed).getByText("ration cube"));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "item", index: 0 });
  });

  it("clicking the selected placed entry deselects it", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    roomDock({ onSelect, selection: { kind: "enemy", index: 0 } });
    await user.click(screen.getByRole("button", { name: /Placed/ }));
    await user.click(within(screen.getByRole("list", { name: "Placed" })).getByText("Mira"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("a room with no placements shows the reason, never the platformer palette", () => {
    render(<Dock bundle={roomBundle()} brush={null} onBrush={() => {}} room placements={[]} />);
    expect(screen.queryByRole("button", { name: /Gameplay/ })).toBeNull();
    expect(screen.getByText(/no pack info — tabs come from/)).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter((c) => c[0] === "list_entity_rows")).toHaveLength(0);
  });

  it("a kind with no rows yet says so instead of showing an empty strip", async () => {
    const user = userEvent.setup();
    roomDock({ rows: { ...ROWS, items: {} } });
    await user.click(screen.getByRole("button", { name: /Items/ }));
    expect(screen.getByText(/no items rows in this pack yet/)).toBeInTheDocument();
  });

  it("keeps the platformer palette when no placements are given", () => {
    useStore.setState({
      world: { path: "/w", name: "w", world_kind: "platformer", entity_counts: [] },
    });
    render(<Dock bundle={roomBundle()} brush={null} onBrush={() => {}} />);
    expect(screen.getByRole("button", { name: /Tiles/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gameplay/ })).toBeInTheDocument();
    expect(screen.getByText("Nothing armed")).toBeInTheDocument();
  });
});
