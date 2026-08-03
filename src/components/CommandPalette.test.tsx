import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import { useStore, type Command } from "../store";

function cmd(id: string, label: string, group: string, extra: Partial<Command> = {}) {
  return { id, label, group, run: vi.fn(), ...extra } as Command;
}

beforeEach(() => {
  useStore.setState({ paletteOpen: true, commands: {} });
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    useStore.setState({ paletteOpen: false });
    const { container } = render(<CommandPalette />);
    expect(container).toBeEmptyDOMElement();
  });

  it("merges every registered scope", () => {
    useStore.setState({
      commands: {
        app: [cmd("a", "Open a project", "Project")],
        level: [cmd("b", "Validate this level", "Level · l1")],
      },
    });
    render(<CommandPalette />);
    expect(screen.getByText("Open a project")).toBeInTheDocument();
    expect(screen.getByText("Validate this level")).toBeInTheDocument();
  });

  it("ranks a label match above a group-only match", async () => {
    // "level" appears in one command's LABEL and another's GROUP. The label
    // hit must win, or typing a visible word surfaces unrelated rows first.
    useStore.setState({
      commands: {
        app: [
          cmd("group-only", "Show cost dashboard", "Level · l1"),
          cmd("label", "Validate this level", "Project"),
        ],
      },
    });
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole("textbox"), "level");
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rows[0]).toContain("Validate this level");
  });

  it("ranks an earlier subsequence first", async () => {
    // Regression: "vll" scored these IDENTICALLY, so stable sort put whichever
    // was registered first on top — which was the wrong one.
    useStore.setState({
      commands: {
        level: [
          cmd("save", "Save this level", "Level · l1"),
          cmd("validate", "Validate this level", "Level · l1"),
        ],
      },
    });
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole("textbox"), "vll");
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rows[0]).toContain("Validate this level");
  });

  it("matches hidden keywords", async () => {
    useStore.setState({
      commands: {
        app: [cmd("cost", "Show cost dashboard", "View", { keywords: "spend usd" })],
      },
    });
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole("textbox"), "spend");
    expect(screen.getByText("Show cost dashboard")).toBeInTheDocument();
  });

  it("runs the active command on Enter and closes", async () => {
    const run = vi.fn();
    useStore.setState({ commands: { app: [cmd("a", "Validate this level", "Level", { run })] } });
    render(<CommandPalette />);
    await userEvent.keyboard("{Enter}");
    expect(run).toHaveBeenCalledOnce();
    expect(useStore.getState().paletteOpen).toBe(false);
  });

  it("shows disabled commands but refuses to run them", async () => {
    // Hiding an unavailable command makes it undiscoverable; showing it with
    // a reason answers "why can't I do this?".
    const run = vi.fn();
    useStore.setState({
      commands: {
        level: [
          cmd("save", "Save this level", "Level", {
            run,
            enabled: false,
            disabledReason: "no unsaved edits",
          }),
        ],
      },
    });
    render(<CommandPalette />);
    expect(screen.getByText("no unsaved edits")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(run).not.toHaveBeenCalled();
    expect(useStore.getState().paletteOpen).toBe(true);
  });

  it("reports when nothing matches", async () => {
    useStore.setState({ commands: { app: [cmd("a", "Open a project", "Project")] } });
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole("textbox"), "zzzz");
    expect(screen.getByText(/No commands match/)).toBeInTheDocument();
  });

  it("closes on Escape without running anything", async () => {
    const run = vi.fn();
    useStore.setState({ commands: { app: [cmd("a", "Open a project", "Project", { run })] } });
    render(<CommandPalette />);
    await userEvent.keyboard("{Escape}");
    expect(useStore.getState().paletteOpen).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("command registry", () => {
  it("registers and withdraws by scope", () => {
    const { registerCommands, unregisterCommands } = useStore.getState();
    registerCommands("level", [cmd("a", "Validate", "Level")]);
    expect(Object.keys(useStore.getState().commands)).toEqual(["level"]);
    unregisterCommands("level");
    expect(useStore.getState().commands).toEqual({});
    // Withdrawing an absent scope is a no-op, not a crash.
    expect(() => unregisterCommands("nope")).not.toThrow();
  });
});
