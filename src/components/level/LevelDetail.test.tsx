import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** `LevelDetail room` (rows P0-5 + P0-8): the same editor screen rendering —
 *  and now EDITING — a dungeon room from the one `grid export`. Blocks mode
 *  is forced (no tilesheet) and the gravity chrome stays off, but the canvas
 *  gets every edit callback, Save writes through `grid apply-edit` /
 *  `import-grids`, the per-step 🎲 rolls run at $0, and a monster drop builds
 *  an ENCOUNTER (P.9 G4). What a room still cannot do keeps its reason. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

// Capture what reaches the canvas instead of drawing (jsdom has no 2D context).
const canvasProps: Record<string, unknown>[] = [];
vi.mock("./LevelCanvas", () => ({
  LevelCanvas: (props: Record<string, unknown>) => {
    canvasProps.push(props);
    return <div data-testid="level-canvas" />;
  },
}));

import { LevelDetail } from "./LevelDetail";
import { ROLL_COST_NOTE, ROOM_REASONS } from "./readOnlyReasons";
import { useStore } from "../../store";
import { dungeonWorld, roomBundle } from "../../test/fixtures/roomBundle";

/** The pack's own rows, per cradle type id — what the room palettes list. */
const ROOM_ROWS: Record<string, { id: string; data: Record<string, unknown> }[]> = {
  npcs: [{ id: "1000", data: { name: "Mira", type: "RandomNPC" } }],
  events: [{ id: "3000", data: { name: "Ambush", type: "combat" } }],
  items: [{ id: "2000", data: { name: "ration cube", category: "food" } }],
  monsters: [{ id: "5001", data: { name: "Rat" } }],
};

function answer(cmd: string, args?: Record<string, unknown>): unknown {
  if (cmd === "export_level") return roomBundle();
  if (cmd === "list_entities") return [];
  if (cmd === "list_entity_rows") return ROOM_ROWS[String(args?.typeId)] ?? [];
  if (cmd === "save_level_edit") return { level_id: "room_0", updated: [] };
  if (cmd === "save_level_grids") return { level_id: "room_0", updated: ["grid"] };
  if (cmd === "roll_grid_step")
    return { room_id: "room_0", step: "items", seed: "s", changed: true, cost_usd: 0 };
  return null;
}

beforeEach(() => {
  useStore.setState({ worldPath: "/w", world: dungeonWorld(), entities: {}, commands: {} });
  canvasProps.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve(answer(cmd, args)),
  );
});

async function renderRoom() {
  render(<LevelDetail levelId="room_0" room />);
  await waitFor(() => expect(screen.getByTestId("level-canvas")).toBeInTheDocument());
  return canvasProps[canvasProps.length - 1];
}

const calls = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd);

describe("LevelDetail room", () => {
  it("forces blocks mode and hands the canvas every edit callback", async () => {
    const props = await renderRoom();
    expect(props.mode).toBe("blocks");
    expect(props.showGrid).toBe(true);
    // Gravity chrome is platformer-only and stays off.
    expect(props.showBounds).toBe(false);
    expect(props.showRulers).toBe(false);
    for (const cb of [
      "onPaint",
      "onFill",
      "onErase",
      "onPlace",
      "onMove",
      "onCommit",
      "onSelect",
    ]) {
      expect(typeof props[cb], cb).toBe("function");
    }
    expect((props.bundle as { level_id: string }).level_id).toBe("room_0");
  });

  it("never baselines the room and asks only for the pack's own kinds", async () => {
    await renderRoom();
    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("export_level");
    expect(cmds).not.toContain("baseline_level");
    // The room palettes fetch npcs / events / items / monsters — never the
    // platformer's `enemies` type, which a dungeon pack does not declare.
    const asked = calls("list_entity_rows").map((c) => (c[1] as { typeId: string }).typeId);
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked).not.toContain("enemies");
  });

  it("keeps the still-unavailable controls visible, disabled with their reasons", async () => {
    await renderRoom();
    expect(screen.getByRole("button", { name: "Blocks" })).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Art", "Overlay"]) {
      const b = screen.getByRole("button", { name });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("title", ROOM_REASONS.mode);
    }
    const rail = screen.getByRole("toolbar", { name: "Level tools" });
    const byLabel = (label: string) => rail.querySelector(`button[aria-label="${label}"]`)!;
    // Paint / fill / erase are LIVE on a room now; bounds and music are not.
    expect(byLabel("Paint")).toBeEnabled();
    expect(byLabel("Fill")).toBeEnabled();
    expect(byLabel("Erase")).toBeEnabled();
    expect(byLabel("Bounds")).toBeDisabled();
    expect(byLabel("Bounds")).toHaveAttribute("title", ROOM_REASONS.bounds);
    expect(byLabel("Music regions")).toBeDisabled();
    const expectOff = (name: RegExp | string, reason: string) => {
      const b = screen.getByRole("button", { name });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("title", reason);
    };
    expectOff(/Validate/, ROOM_REASONS.validate);
    expectOff(/Play blocks/, ROOM_REASONS.play);
    expectOff(/Improve/, ROOM_REASONS.improve);
    expectOff(/Music$/, ROOM_REASONS.music);
    expectOff("Resize", ROOM_REASONS.resize);
    // Count chips take their nouns from the pack's placements.
    expect(screen.getByText("1 npcs")).toBeInTheDocument();
    expect(screen.getByText("1 events")).toBeInTheDocument();
    expect(screen.getByText("1 items")).toBeInTheDocument();
    expect(screen.queryByText("read-only")).toBeNull();
  });

  it("shows the per-step roll buttons, each promising $0 and never a spend card", async () => {
    await renderRoom();
    for (const name of [/🪄 Layout/, /🎲 NPCs/, /🎲 Events/, /🎲 Items/, /⟳ Whole room/]) {
      const b = screen.getByRole("button", { name });
      expect(b).toBeEnabled();
      expect(b.getAttribute("title")).toContain(ROLL_COST_NOTE);
    }
    // 🎲 Monsters is per-encounter: with nothing selected it says so.
    const monsters = screen.getByRole("button", { name: /🎲 Monsters/ });
    expect(monsters).toBeDisabled();
    expect(monsters.getAttribute("title")).toMatch(/select an encounter/);
    // The $0 promise is on screen, not just in a tooltip.
    expect(screen.getByText(ROLL_COST_NOTE)).toBeInTheDocument();
    // No paid-backend select on a room — the rolls are code.
    expect(screen.queryByRole("option", { name: "paid" })).toBeNull();
  });

  it("a roll reaches `grid roll` with the step and re-exports afterwards", async () => {
    const user = userEvent.setup();
    await renderRoom();
    await user.click(screen.getByRole("button", { name: /🎲 Items/ }));
    await waitFor(() => expect(calls("roll_grid_step")).toHaveLength(1));
    expect(calls("roll_grid_step")[0][1]).toMatchObject({ levelId: "room_0", step: "items" });
    // Optimistic UI never diverges from disk: the bundle is re-exported.
    expect(calls("export_level").length).toBeGreaterThan(1);
  });

  it("a monsters roll names the selected encounter", async () => {
    const user = userEvent.setup();
    const props = await renderRoom();
    (props.onSelect as (s: unknown) => void)({ kind: "trigger", index: 0 });
    await waitFor(() => expect(screen.getByRole("button", { name: /🎲 Monsters/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /🎲 Monsters/ }));
    await waitFor(() => expect(calls("roll_grid_step")).toHaveLength(1));
    expect(calls("roll_grid_step")[0][1]).toMatchObject({ step: "monsters", encounter: "3000" });
  });

  it("Save sends the room's sparse payload: placements by row id, markers as points", async () => {
    const user = userEvent.setup();
    const props = await renderRoom();
    (props.onMove as (s: unknown, x: number, y: number) => void)({ kind: "enemy", index: 0 }, 2, 1);
    (props.onCommit as (s: unknown) => void)({ kind: "enemy", index: 0 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("save_level_edit")).toHaveLength(1));
    const edit = (calls("save_level_edit")[0][1] as { edit: Record<string, unknown> }).edit;
    expect(edit.entities).toEqual([{ enemy_id: "1000", x: 2, y: 1, variant: null }]);
  });

  it("painting a cell saves through import-grids with 0/1 cells only", async () => {
    const user = userEvent.setup();
    const props = await renderRoom();
    (props.onPaint as (x: number, y: number) => void)(1, 1);
    // Nothing is armed, so onPaint is a no-op until a tile brush is chosen —
    // paint through the canvas the way the brush path does instead.
    const canvas = canvasProps[canvasProps.length - 1];
    expect(typeof canvas.onPaint).toBe("function");
    await user.click(screen.getByRole("button", { name: /Tiles/ }));
    await user.click(screen.getByText("wall"));
    (canvasProps[canvasProps.length - 1].onPaint as (x: number, y: number) => void)(1, 1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("save_level_grids")).toHaveLength(1));
    const grid = (calls("save_level_grids")[0][1] as { collision: number[][] }).collision;
    expect(new Set(grid.flat())).toEqual(new Set([0, 1]));
    expect(grid[1][1]).toBe(1);
  });

  it("dropping a monster writes an ENCOUNTER, not a placement (P.9 G4)", async () => {
    const user = userEvent.setup();
    await renderRoom();
    // The dock's Monsters TAB (the header's 🎲 Monsters is the roll button).
    const tab = screen
      .getAllByRole("button", { name: /Monsters/ })
      .find((b) => b.className.includes("dtab"))!;
    await user.click(tab);
    await waitFor(() => expect(screen.getByText("Rat")).toBeInTheDocument());
    await user.click(screen.getByText("Rat"));
    // A monster is not a placement: dropping it goes straight to canon as an
    // encounter write on that cell.
    const props = canvasProps[canvasProps.length - 1];
    // An empty cell: canon allocates the combat event (`event_id: null`).
    (props.onPlace as (x: number, y: number) => void)(3, 1);
    await waitFor(() => expect(calls("save_level_edit")).toHaveLength(1));
    expect((calls("save_level_edit")[0][1] as { edit: Record<string, unknown> }).edit).toEqual({
      encounters: [{ x: 3, y: 1, event_id: null, monster_ids: ["5001"] }],
    });
    // The cell that already holds an encounter JOINS it, keeping its roster.
    (canvasProps[canvasProps.length - 1].onPlace as (x: number, y: number) => void)(2, 1);
    await waitFor(() => expect(calls("save_level_edit")).toHaveLength(2));
    expect((calls("save_level_edit")[1][1] as { edit: Record<string, unknown> }).edit).toEqual({
      encounters: [{ x: 2, y: 1, event_id: 3000, monster_ids: ["5000", "5001"] }],
    });
  });

  it("shows the room facts in the tray, and a placement's row when one is selected", async () => {
    const props = await renderRoom();
    expect(screen.getByText("room · forest")).toBeInTheDocument();
    expect(screen.getByText("hidden")).toBeInTheDocument(); // door
    (props.onSelect as (s: unknown) => void)({ kind: "enemy", index: 0 });
    await waitFor(() => expect(screen.getByText("npc placement")).toBeInTheDocument());
    expect(screen.getByText("RandomNPC")).toBeInTheDocument();
    expect(screen.getByTitle("npcs/1000")).toBeInTheDocument(); // EntityLink to the row
    // Delete is live now; the platformer's sprite/switch verbs are not offered.
    expect(screen.getByText("delete")).toBeInTheDocument();
    expect(screen.queryByText("switch to")).toBeNull();
    (props.onSelect as (s: unknown) => void)({ kind: "trigger", index: 0 });
    await waitFor(() => expect(screen.getByText("event placement")).toBeInTheDocument());
    expect(screen.getByTitle("events/3000")).toBeInTheDocument();
    expect(screen.getByTitle("monsters/5000")).toBeInTheDocument();
    expect(screen.getByText("yes — guards the door")).toBeInTheDocument();
  });

  it("lists every warning the export named in the tray", async () => {
    const warning = "item_placements: item 2000 at (4, 2) but the grid cell reads 0";
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
      Promise.resolve(
        cmd === "export_level" ? roomBundle({ warnings: [warning] }) : answer(cmd, args),
      ),
    );
    await renderRoom();
    expect(screen.getByText("Warnings")).toBeInTheDocument();
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it("⌘K carries the room's commands: save + layout live, the rest greyed with reasons", async () => {
    await renderRoom();
    const cmds = useStore.getState().commands.level;
    expect(cmds.map((c) => [c.id, c.enabled])).toEqual([
      ["level.save", false], // nothing edited yet
      ["level.validate", false],
      ["level.improve", false],
      ["level.layout", true],
      ["level.music", false],
    ]);
    expect(cmds.find((c) => c.id === "level.layout")!.label).toMatch(/maze/);
    expect(cmds.find((c) => c.id === "level.validate")!.disabledReason).toBe(ROOM_REASONS.validate);
  });

  it("the platformer path is unchanged: art mode, callbacks present, baseline called", async () => {
    useStore.setState({
      world: { path: "/w", name: "w", world_kind: "platformer", entity_counts: [] },
    });
    render(<LevelDetail levelId="l1" />);
    await waitFor(() => expect(screen.getByTestId("level-canvas")).toBeInTheDocument());
    const props = canvasProps[canvasProps.length - 1];
    expect(props.mode).toBe("art");
    expect(typeof props.onPaint).toBe("function");
    expect(typeof props.onMove).toBe("function");
    expect(invokeMock.mock.calls.map((c) => c[0])).toContain("baseline_level");
    expect(screen.getByRole("button", { name: "Art" })).toBeEnabled();
    // The platformer keeps its paid-placement select and its LLM 🎲 buttons.
    expect(screen.getByRole("button", { name: "🎲 Enemies" })).toBeInTheDocument();
    expect(screen.queryByText(ROLL_COST_NOTE)).toBeNull();
  });
});
