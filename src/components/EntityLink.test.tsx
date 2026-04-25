import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (s: string) => s,
}));

import { EntityLink } from "./EntityLink";
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
  invokeMock.mockReset();
}

describe("EntityLink", () => {
  beforeEach(resetStore);

  it("renders the entity name when a match exists in the store", () => {
    useStore.setState({
      worldPath: "/w",
      entities: { npcs: [{ type_id: "npcs", id: "npc_a", name: "Alice" }] },
    });
    render(<EntityLink typeId="npcs" id="npc_a" />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders the fallbackLabel when no match is found", () => {
    useStore.setState({ entities: { npcs: [] } });
    render(<EntityLink typeId="npcs" id="npc_a" fallbackLabel="Anon" />);
    expect(screen.getByText("Anon")).toBeInTheDocument();
  });

  it("renders the id when no match and no fallback", () => {
    useStore.setState({ entities: { npcs: [] } });
    render(<EntityLink typeId="npcs" id="npc_a" />);
    expect(screen.getByText("npc_a")).toBeInTheDocument();
  });

  it("strips the trailing 's' from typeId for the type chip", () => {
    useStore.setState({ entities: { npcs: [] } });
    render(<EntityLink typeId="npcs" id="npc_a" />);
    expect(screen.getByText("npc")).toBeInTheDocument();
  });

  it("clicking dispatches select({kind:'entity', typeId, id})", () => {
    useStore.setState({ entities: { npcs: [] } });
    render(<EntityLink typeId="npcs" id="npc_a" />);
    fireEvent.click(screen.getByRole("button"));
    expect(useStore.getState().selection).toEqual({
      kind: "entity",
      typeId: "npcs",
      id: "npc_a",
    });
  });

  it("click stops propagation to ancestors", () => {
    useStore.setState({ entities: { npcs: [] } });
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <EntityLink typeId="npcs" id="npc_a" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("fetches the type list when missing and worldPath is set", async () => {
    invokeMock.mockResolvedValue([
      { type_id: "npcs", id: "npc_a", name: "Alice" },
    ]);
    useStore.setState({ worldPath: "/world", entities: {} });
    render(<EntityLink typeId="npcs" id="npc_a" />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_entities", {
        path: "/world",
        typeId: "npcs",
      });
    });
  });

  it("does NOT fetch when worldPath is empty", async () => {
    useStore.setState({ worldPath: "", entities: {} });
    render(<EntityLink typeId="npcs" id="npc_a" />);
    // Wait one microtask for the effect; then assert no call.
    await Promise.resolve();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does NOT fetch when the type list already exists in the store", async () => {
    useStore.setState({
      worldPath: "/world",
      entities: { npcs: [{ type_id: "npcs", id: "npc_a", name: "Alice" }] },
    });
    render(<EntityLink typeId="npcs" id="npc_a" />);
    await Promise.resolve();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
