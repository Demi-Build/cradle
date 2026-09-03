import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** History/restore on a dungeon world (row P0-8). Two families, two writers:
 *
 *   `npc:1000`         — a registry ROW; `asset restore` rewinds the file the
 *                        row lives in (P.4.1: the CAS unit is the file, so the
 *                        confirm says "restores <file> (N rows)");
 *   `room:room_0/grid` — a GRID step; it rewinds through `grid restore`, the
 *                        same writer the editor uses (P.9 R1).
 *
 * Both write a NEW version and delete nothing (doctrine 6). */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
vi.mock("../agent/confirmGateState", () => ({
  confirmSpend: () => Promise.resolve(true),
  confirmAction: (opts: { body?: string }) => {
    confirmBodies.push(opts.body ?? "");
    return Promise.resolve(true);
  },
}));
const confirmBodies: string[] = [];

import { LineagePanel, RoomHistory } from "./LineagePanel";
import { useStore } from "../../store";
import { dungeonWorld } from "../../test/fixtures/roomBundle";

function tree(artifactId: string, facet: string, artifacts: string[]) {
  const node = (id: string, op: string, current: string[]) => ({
    id,
    facet,
    op,
    source: "user",
    actor: "user",
    ts: "2026-09-02T10:00:00",
    gen: null,
    artifacts,
    current_of: current,
    usage: {},
    detail: { file: "npcs/npcs.json", rows: 79 },
    depth: current.length ? 1 : 0,
  });
  return {
    artifact_id: artifactId,
    root_id: "sha256:aaa",
    requested_node_id: "sha256:bbb",
    nodes: [
      node("sha256:aaa", "generate", []),
      node("sha256:bbb", "edit", [`${artifactId}#${facet}`]),
    ],
    edges: [
      {
        from: "sha256:aaa",
        to: "sha256:bbb",
        op: "edit",
        kind: "db_update",
        actor: "user",
        ts: "",
      },
    ],
    metadata: { total_nodes: 2, max_depth: 1, pruned: false },
  };
}

beforeEach(() => {
  useStore.setState({ worldPath: "/w", world: dungeonWorld(), entities: {} });
  confirmBodies.length = 0;
  invokeMock.mockReset();
});

describe("LineagePanel on dungeon artifacts", () => {
  it("restores a dungeon ROW through asset restore, and says the file is the unit", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "asset_lineage" ? tree("npc:1000", "row", ["npc:1000"]) : {}),
    );
    render(<LineagePanel artifactId="npc:1000" typeId="npcs" entityId="1000" />);
    await waitFor(() => expect(screen.getByText(/lineage · npc:1000/)).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: /restore/ })[0]);
    await waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === "asset_restore")).toBe(true),
    );
    expect(invokeMock.mock.calls.find((c) => c[0] === "asset_restore")![1]).toMatchObject({
      target: "npc:1000",
      to: "sha256:aaa",
    });
    // The confirm is honest about what a row restore actually covers. The
    // per-file "<file> (N rows)" copy was DEAD — canon's lineage builder
    // journals no `file`/`rows` detail, so the generic sentence is the only
    // one a viewer could ever see, and it is the one that ships.
    expect(confirmBodies[0]).toMatch(/restores the whole row file/);
    expect(confirmBodies[0]).toMatch(/Nothing is deleted/);
  });

  it("restores a ROOM step through the grid writer, not the asset verb", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === "asset_lineage"
          ? tree("room:room_0/grid", "data", ["room:room_0/grid", "room:room_0/placements"])
          : {},
      ),
    );
    render(<LineagePanel artifactId="room:room_0/grid" typeId="rooms" entityId="room_0" />);
    await waitFor(() =>
      expect(screen.getByText(/lineage · room:room_0\/grid/)).toBeInTheDocument(),
    );
    await user.click(screen.getAllByRole("button", { name: /restore/ })[0]);
    await waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === "restore_grid_step")).toBe(true),
    );
    expect(invokeMock.mock.calls.find((c) => c[0] === "restore_grid_step")![1]).toMatchObject({
      levelId: "room_0",
      step: "grid",
      to: "sha256:aaa",
    });
    expect(invokeMock.mock.calls.some((c) => c[0] === "asset_restore")).toBe(false);
    // One maze.json carries both steps, but the restore is scoped to the
    // named step's keys (P0-8 carry-over) — the label names the step and
    // promises the other one's edits survive.
    expect(confirmBodies[0]).toMatch(
      /restores this room's grid step — the other step keeps the edits made since/,
    );
  });
});

describe("RoomHistory", () => {
  it("asks for the PLACEMENTS chain first and can switch to the grid chain", async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd !== "asset_lineage") return Promise.resolve({});
      asked.push(String(args.target ?? args.artifactId ?? ""));
      return Promise.resolve(tree(String(args.target ?? ""), "data", []));
    });
    render(<RoomHistory gridKind="room" roomId="room_0" typeId="rooms" />);
    // Every hand edit, encounter write and 🎲 npcs/events/items roll journals
    // on `/placements`; asking only for `/grid` showed an empty history.
    await waitFor(() => expect(asked[0]).toBe("room:room_0/placements"));
    await user.click(screen.getByRole("button", { name: "grid" }));
    await waitFor(() => expect(asked).toContain("room:room_0/grid"));
  });
});
