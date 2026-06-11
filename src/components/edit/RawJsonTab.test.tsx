import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RawJsonTab } from "./RawJsonTab";
import { useStore } from "../../store";

// Pre-populate the store's entity cache so setEntityDraft has somewhere to
// write — the store's setEntityDraft is intentionally a no-op when the entry
// doesn't exist (so the textarea can't fabricate a draft out of thin air).
function setupCachedEntity(initial: unknown) {
  useStore.setState({
    worldPath: "/w",
    entityCache: {
      "npcs:1": { pristine: initial, draft: initial, dirty: false },
    },
  });
}

describe("RawJsonTab", () => {
  beforeEach(() => {
    useStore.setState({ entityCache: {}, worldPath: "" });
  });

  it("renders a read-only <pre> when editMode is false", () => {
    setupCachedEntity({ name: "Alice" });
    const onParseError = vi.fn();
    const { container } = render(
      <RawJsonTab
        typeId="npcs"
        entityId="1"
        data={{ name: "Alice" }}
        editMode={false}
        onParseError={onParseError}
      />,
    );
    const pre = container.querySelector("pre.detail-json");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('"name": "Alice"');
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("renders an editable <textarea> when editMode is true", () => {
    setupCachedEntity({ name: "Alice" });
    const { container } = render(
      <RawJsonTab
        typeId="npcs"
        entityId="1"
        data={{ name: "Alice" }}
        editMode={true}
        onParseError={vi.fn()}
      />,
    );
    expect(container.querySelector("pre.detail-json")).toBeNull();
    expect(container.querySelector("textarea.editor-json-textarea")).not.toBeNull();
  });

  it("valid JSON typing updates the entity draft and clears the parse error", () => {
    setupCachedEntity({ name: "Alice" });
    const onParseError = vi.fn();
    render(
      <RawJsonTab
        typeId="npcs"
        entityId="1"
        data={{ name: "Alice" }}
        editMode={true}
        onParseError={onParseError}
      />,
    );
    const textarea = screen.getByRole("textbox");
    onParseError.mockClear(); // initial mount calls — ignore those
    fireEvent.change(textarea, { target: { value: '{"name":"Alicia"}' } });
    expect(useStore.getState().entityCache["npcs:1"].draft).toEqual({ name: "Alicia" });
    expect(useStore.getState().entityCache["npcs:1"].dirty).toBe(true);
    expect(onParseError).toHaveBeenLastCalledWith(null);
  });

  it("invalid JSON typing surfaces a parse error and does NOT update the draft", () => {
    setupCachedEntity({ name: "Alice" });
    const onParseError = vi.fn();
    render(
      <RawJsonTab
        typeId="npcs"
        entityId="1"
        data={{ name: "Alice" }}
        editMode={true}
        onParseError={onParseError}
      />,
    );
    const textarea = screen.getByRole("textbox");
    onParseError.mockClear();
    fireEvent.change(textarea, { target: { value: "{ not json" } });
    // Draft stays at the pristine value — the cache only updates on valid parse.
    expect(useStore.getState().entityCache["npcs:1"].draft).toEqual({ name: "Alice" });
    expect(useStore.getState().entityCache["npcs:1"].dirty).toBe(false);
    expect(onParseError).toHaveBeenCalledWith(expect.any(String));
    const calls = onParseError.mock.calls;
    const lastCallArg = calls[calls.length - 1]?.[0];
    expect(typeof lastCallArg).toBe("string");
    expect(lastCallArg).not.toBeNull();
  });

  it("toggling editMode true → false clears any outstanding parse error", () => {
    setupCachedEntity({ name: "Alice" });
    const onParseError = vi.fn();
    const { rerender } = render(
      <RawJsonTab
        typeId="npcs"
        entityId="1"
        data={{ name: "Alice" }}
        editMode={true}
        onParseError={onParseError}
      />,
    );
    // Drive a parse error first.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "{ bad" } });
    expect(onParseError).toHaveBeenLastCalledWith(expect.any(String));
    onParseError.mockClear();
    // Exit edit mode — the cleanup effect should fire onParseError(null) so
    // the pane-level Save button isn't stranded in the disabled state.
    rerender(
      <RawJsonTab
        typeId="npcs"
        entityId="1"
        data={{ name: "Alice" }}
        editMode={false}
        onParseError={onParseError}
      />,
    );
    expect(onParseError).toHaveBeenCalledWith(null);
  });
});
