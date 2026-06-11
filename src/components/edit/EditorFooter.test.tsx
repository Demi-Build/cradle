import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorFooter } from "./EditorFooter";
import { useStore } from "../../store";

function setEntry(opts: { dirty?: boolean; saving?: boolean; saveError?: string | null }) {
  useStore.setState({
    entityCache: {
      "npcs:1": {
        pristine: { name: "Alice" },
        draft: opts.dirty ? { name: "Alicia" } : { name: "Alice" },
        dirty: !!opts.dirty,
      },
    },
    saving: opts.saving ? { "npcs:1": true } : {},
    saveError: opts.saveError ? { "npcs:1": opts.saveError } : {},
  });
}

describe("EditorFooter", () => {
  beforeEach(() => {
    useStore.setState({
      entityCache: {},
      saving: {},
      saveError: {},
    });
  });

  it("renders 'Saved' with Save and Revert disabled when the entity is clean", () => {
    setEntry({ dirty: false });
    render(<EditorFooter typeId="npcs" entityId="1" />);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revert" })).toBeDisabled();
  });

  it("renders 'Unsaved changes' with Save and Revert enabled when dirty", () => {
    setEntry({ dirty: true });
    render(<EditorFooter typeId="npcs" entityId="1" />);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Revert" })).not.toBeDisabled();
  });

  it("shows 'Saving…' and disables both buttons while a save is in flight", () => {
    setEntry({ dirty: true, saving: true });
    render(<EditorFooter typeId="npcs" entityId="1" />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revert" })).toBeDisabled();
  });

  it("renders saveError when present", () => {
    setEntry({ dirty: true, saveError: "disk full" });
    render(<EditorFooter typeId="npcs" entityId="1" />);
    expect(screen.getByText("disk full")).toBeTruthy();
  });

  it("renders saveDisabledReason as the error and disables Save", () => {
    // Dirty so we can verify the reason — not the !dirty state — is what
    // disables Save.
    setEntry({ dirty: true });
    render(
      <EditorFooter typeId="npcs" entityId="1" saveDisabledReason="Invalid JSON: bad token" />,
    );
    expect(screen.getByText("Invalid JSON: bad token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("clicking Save invokes saveEntity and clicking Revert invokes revertEntity", () => {
    setEntry({ dirty: true });
    const saveEntity = vi.fn(() => Promise.resolve());
    const revertEntity = vi.fn();
    useStore.setState({ saveEntity, revertEntity });
    render(<EditorFooter typeId="npcs" entityId="1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveEntity).toHaveBeenCalledWith("npcs", "1");
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(revertEntity).toHaveBeenCalledWith("npcs", "1");
  });
});
