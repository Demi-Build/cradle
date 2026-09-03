import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentTile } from "./RecentTile";
import type { RecentProject } from "../../lib/recents";

/** The card's meta line has to say something true about BOTH kinds of project.
 *  It previously only knew MazeWorld's `seed`/`rooms`, so every platformer card
 *  rendered an empty strip under its name. */

vi.mock("./useAssetUrl", () => ({ useAssetUrl: () => null }));

const base: RecentProject = { path: "/w", name: "World", lastOpenedAt: Date.now() };

const sub = () => document.querySelector(".recent-tile .sub")?.textContent ?? "";

function draw(extra: Partial<RecentProject>) {
  render(<RecentTile recent={{ ...base, ...extra }} onClick={() => {}} />);
}

describe("RecentTile meta line", () => {
  it("describes a PLATFORMER pack by levels and enemies", () => {
    draw({ levels: 13, enemies: 7 });
    expect(sub()).toBe("13 levels · 7 enemies");
  });

  it("describes a MAZEWORLD pack by rooms and NPCs", () => {
    // MazeWorld counts `monsters`, not `enemies`, so the two vocabularies
    // never collide and the fallback chain lands on rooms → NPCs.
    draw({ rooms: 24, npcs: 9, quests: 4, events: 6 });
    expect(sub()).toBe("24 rooms · 9 NPCs");
  });

  it("labels by world_kind when the entry carries one (P0-3), never by which fields exist", () => {
    // A dungeon that happens to carry level/enemy counts still reads as rooms/NPCs…
    draw({ world_kind: "dungeon", levels: 13, enemies: 7, rooms: 24, npcs: 9 });
    expect(sub()).toBe("24 rooms · 9 NPCs");
    document.body.innerHTML = "";
    // …and a platformer with room/NPC counts still reads as levels/enemies.
    draw({ world_kind: "platformer", levels: 13, enemies: 7, rooms: 24, npcs: 9 });
    expect(sub()).toBe("13 levels · 7 enemies");
    document.body.innerHTML = "";
    // Ids are data: an unknown kind is not an error, it just isn't a platformer.
    draw({ world_kind: "shooter", rooms: 3, npcs: 2, levels: 9 });
    expect(sub()).toBe("3 rooms · 2 NPCs");
  });

  it("singularises — a real world can genuinely have one of something", () => {
    draw({ rooms: 3, npcs: 1 });
    expect(sub()).toBe("3 rooms · 1 NPC");
    document.body.innerHTML = "";
    draw({ levels: 1, enemies: 1 });
    expect(sub()).toBe("1 level · 1 enemy");
  });

  it("falls back to the seed when a pack has no counts yet", () => {
    draw({ seed: 4210 });
    expect(sub()).toBe("seed 4210");
  });

  it("renders NO empty strip when there is nothing to say", () => {
    draw({});
    expect(document.querySelector(".recent-tile .sub")).toBeNull();
  });

  it("colours the status dot only for warn/failed", () => {
    draw({ levels: 2, validation: "validated" });
    expect(document.querySelector(".fo .st")?.classList.contains("w")).toBe(false);
    expect(screen.getByText(/ready/)).toBeInTheDocument();
    document.body.innerHTML = "";
    draw({ levels: 2, validation: "failed" });
    expect(document.querySelector(".fo .st")?.classList.contains("w")).toBe(true);
    expect(screen.getByText(/validation failed/)).toBeInTheDocument();
  });
});
