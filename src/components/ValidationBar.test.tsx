import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValidationBar } from "./ValidationBar";
import { useStore } from "../store";

function resetStore() {
  useStore.setState({
    worldPath: "",
    world: null,
    worldStoryTitle: null,
    worldBeats: [],
    entities: {},
    selection: { kind: "none" },
    error: null,
    lightbox: null,
    recents: [],
    route: "start",
    drawerOpen: false,
    loading: false,
  });
}

describe("ValidationBar", () => {
  beforeEach(resetStore);

  it("renders 'No world loaded.' when world is null", () => {
    render(<ValidationBar />);
    expect(screen.getByText("No world loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/Checker/)).toBeNull();
  });

  it("renders Checker / Validator / World Editor placeholders when world is set", () => {
    useStore.setState({
      world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [] },
    });
    render(<ValidationBar />);
    expect(screen.getByText("Checker: —")).toBeInTheDocument();
    expect(screen.getByText("Validator: —")).toBeInTheDocument();
    expect(screen.getByText("World Editor: —")).toBeInTheDocument();
    expect(
      screen.getByText("(validation trail wiring lands when canon emits it)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No world loaded.")).toBeNull();
  });
});
