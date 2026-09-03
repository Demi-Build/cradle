import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/** Row P0-12 / W3.5: "a gear entry in the TopBar". Two things matter and are
 *  easy to get wrong — it must be reachable with NO project open (the machine
 *  that cannot start canon or has no key is exactly the machine with nothing
 *  loaded), and the theme toggle must stay where it is ("Theme stays where it
 *  is. Nothing else moves in v1"). */

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

import { TopBar } from "./TopBar";
import { useStore } from "../store";

beforeEach(() => {
  useStore.setState({
    world: null,
    settings: { open: false, pane: "keys", focusVar: null },
  } as never);
});

describe("the TopBar gear", () => {
  it("opens Settings on the keys pane, with no project open", () => {
    render(<TopBar />);
    const gear = screen.getByTestId("topbar-settings");
    expect(gear.getAttribute("title")).toContain("API keys");
    fireEvent.click(gear);
    expect(useStore.getState().settings).toEqual({ open: true, pane: "keys", focusVar: null });
  });

  it("leaves the theme toggle in the TopBar, to its right", () => {
    render(<TopBar />);
    const gear = screen.getByTestId("topbar-settings");
    const theme = screen.getByTitle("Toggle theme");
    expect(gear.parentElement).toBe(theme.parentElement);
    expect(gear.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
