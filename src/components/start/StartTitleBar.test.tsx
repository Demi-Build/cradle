import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/** Row P0-12 / W3.5: the gear must be reachable with NO project open. The
 *  editor's `TopBar` carries one, but that bar is not mounted on the start or
 *  recents routes — `StartTitleBar` is the only chrome they have, so the same
 *  button has to live here or the requirement holds only for the state that
 *  never needed it. Theme stays rightmost, as it does in the editor. */

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

import { StartTitleBar } from "./StartTitleBar";
import { useStore } from "../../store";

beforeEach(() => {
  useStore.setState({
    world: null,
    settings: { open: false, pane: "keys", focusVar: null },
  } as never);
});

describe("the start screen's gear", () => {
  it("opens Settings on the keys pane, with no project open", () => {
    render(<StartTitleBar here="start" />);
    const gear = screen.getByTestId("start-settings");
    expect(gear.getAttribute("title")).toContain("API keys");
    fireEvent.click(gear);
    expect(useStore.getState().settings).toEqual({ open: true, pane: "keys", focusVar: null });
  });

  it("leaves the theme toggle to its right", () => {
    render(<StartTitleBar here="start" />);
    const gear = screen.getByTestId("start-settings");
    const theme = screen.getByTitle("Toggle theme");
    expect(gear.parentElement).toBe(theme.parentElement);
    expect(gear.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
