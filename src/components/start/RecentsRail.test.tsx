import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentsRail } from "./RecentsRail";
import type { RecentProject } from "../../lib/recents";

/** Row P0-10's recents papercut (W2): the rail's dashed first card is the
 *  design's **New project** card ("First cell is the dashed New project card"
 *  — `design_handoff_editor_worldmap_start` README, Recents). It used to be
 *  wired to the folder picker, so the one tile a brand-new user reaches for
 *  demanded a project they did not have yet. The folder picker keeps its own
 *  tile; nothing was removed. */

vi.mock("./useAssetUrl", () => ({ useAssetUrl: () => null }));

const recents: RecentProject[] = [{ path: "/w", name: "World", lastOpenedAt: Date.now() }];

function draw() {
  const onAddNew = vi.fn();
  const onOpenFromDisk = vi.fn();
  render(
    <RecentsRail
      recents={recents}
      onOpenRecent={() => {}}
      onAddNew={onAddNew}
      onOpenFromDisk={onOpenFromDisk}
    />,
  );
  return { onAddNew, onOpenFromDisk };
}

describe("RecentsRail add tile", () => {
  it("opens the create modal, not the folder picker", () => {
    const { onAddNew, onOpenFromDisk } = draw();
    const tile = screen.getByTestId("recents-add");
    expect(tile.textContent).toContain("New project");
    fireEvent.click(tile);
    expect(onAddNew).toHaveBeenCalledTimes(1);
    expect(onOpenFromDisk).not.toHaveBeenCalled();
  });

  it("keeps 'Open world from disk' reachable as its own tile", () => {
    const { onAddNew, onOpenFromDisk } = draw();
    fireEvent.click(screen.getByTestId("recents-open-disk"));
    expect(onOpenFromDisk).toHaveBeenCalledTimes(1);
    expect(onAddNew).not.toHaveBeenCalled();
  });
});
