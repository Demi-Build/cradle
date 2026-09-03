import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/** DetailPane routing (rows P0-5 + P0-8): which type ids are GRIDS comes from
 *  `pack info` — a room opens in the level editor (blocks mode, editable
 *  since P0-8), fed by the one `export_level` command, and the room's
 *  story/contents survive one tab over. History routes by the registry too:
 *  a room's artifact family is `room:<id>/grid` (P.9 R1) and a row kind's is
 *  `<kind>:<id>`, so every dungeon type gets a History tab. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

const canvasProps: Record<string, unknown>[] = [];
vi.mock("./level/LevelCanvas", () => ({
  LevelCanvas: (props: Record<string, unknown>) => {
    canvasProps.push(props);
    return <div data-testid="level-canvas" />;
  },
}));

import { DetailPane } from "./DetailPane";
import { useStore } from "../store";
import { dungeonWorld, roomBundle } from "../test/fixtures/roomBundle";

beforeEach(() => {
  useStore.setState({
    worldPath: "/w",
    world: dungeonWorld(),
    entities: {},
    selection: { kind: "entity", typeId: "rooms", id: "room_0" },
    error: null,
    commands: {},
  });
  canvasProps.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    if (cmd === "get_entity") return Promise.resolve({ environment: "forest", grid: [[1]] });
    if (cmd === "export_level")
      return Promise.resolve(roomBundle({ level_id: String(args.levelId) }));
    return Promise.resolve([]);
  });
});

describe("DetailPane routes rooms to the level editor", () => {
  it("renders the room editor for typeId 'rooms' and keeps Details + History", async () => {
    render(<DetailPane />);
    await waitFor(() => expect(screen.getByTestId("level-canvas")).toBeInTheDocument());
    const props = canvasProps[canvasProps.length - 1];
    expect(props.mode).toBe("blocks");
    // Row P0-8: the room is editable now — the canvas gets its callbacks.
    expect(typeof props.onPaint).toBe("function");
    expect((props.bundle as { level_id: string }).level_id).toBe("room_0");
    // The export was asked of the same command the platformer uses.
    expect(invokeMock).toHaveBeenCalledWith("export_level", { path: "/w", levelId: "room_0" });
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("baseline_level");
    // Tabs: Overview (the maze) · Details (the row) · History · Raw JSON.
    expect(tabLabels()).toEqual(["Overview", "Details", "History", "Raw JSON"]);
  });

  it("routes rooms by the pack's GRIDS, not by the world kind", async () => {
    useStore.setState({
      world: { ...dungeonWorld(), world_kind: "platformer" },
      selection: { kind: "entity", typeId: "rooms", id: "room_0" },
    });
    render(<DetailPane />);
    await waitFor(() => expect(screen.getByTestId("level-canvas")).toBeInTheDocument());
    const props = canvasProps[canvasProps.length - 1];
    expect(props.mode).toBe("blocks");
    expect((props.bundle as { level_id: string }).level_id).toBe("room_0");
  });

  it("gives every registry kind a History tab on its own artifact family", async () => {
    for (const [typeId, id] of [
      ["npcs", "1000"],
      ["monsters", "5000"],
      ["quests", "4000"],
    ] as const) {
      useStore.setState({ selection: { kind: "entity", typeId, id } });
      const view = render(<DetailPane />);
      await waitFor(() => expect(tabLabels()).toContain("History"));
      view.unmount();
    }
  });

  it("still routes levels to the editable editor", async () => {
    useStore.setState({
      world: { path: "/w", name: "w", world_kind: "platformer", entity_counts: [] },
      selection: { kind: "entity", typeId: "levels", id: "l1" },
    });
    render(<DetailPane />);
    await waitFor(() => expect(screen.getByTestId("level-canvas")).toBeInTheDocument());
    const props = canvasProps[canvasProps.length - 1];
    expect(props.mode).toBe("art");
    expect(typeof props.onPaint).toBe("function");
    expect(tabLabels()).toEqual(["Overview", "Raw JSON"]);
  });
});

function tabLabels(): (string | null)[] {
  return Array.from(document.querySelectorAll(".tabs-header .tab-btn")).map((b) => b.textContent);
}
