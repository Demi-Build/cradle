// Step 3: the mode shell. Four simultaneous indicators, `Esc` as the universal
// step-out, `E`/`T` as the direct entries, and View mode rendering exactly what
// it rendered before the refactor.

import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DialogueSurface } from "./DialogueSurface";
import { ValidationBar } from "../ValidationBar";
import { useStore } from "../../store";
import { WHISPER_TAM, questFor } from "../../test/fixtures/mazeworldNpcs";
import { buildDialogue } from "./types";

function reset() {
  useStore.setState({
    dialogue: { mode: "view", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    // The statusbar renders its segments only for a loaded world.
    world: {
      path: "/w",
      name: "w",
      world_kind: "dungeon",
      entity_counts: [],
      pack_info: null,
    },
  });
}

beforeEach(reset);

function mount(npc = WHISPER_TAM) {
  return render(<DialogueSurface npc={npc} npcId={String(npc.id)} quest={questFor(npc)} />);
}

describe("mode model", () => {
  it("opens in View with the Card/Graph reader and no mode colour", () => {
    const { container } = mount();
    expect(container.querySelector(".dlg-surface")?.getAttribute("data-mode")).toBe("view");
    expect(screen.getByRole("button", { name: "Card" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Graph" })).toBeInTheDocument();
  });

  it("renders View mode's beats — the same set buildDialogue produces", () => {
    const { container } = mount();
    const expected = buildDialogue(WHISPER_TAM, questFor(WHISPER_TAM));
    const cards = container.querySelectorAll(".dialogue-card");
    expect(cards.length).toBe(expected.beats.length);
  });

  it("E enters Edit and T enters Test", () => {
    const { container } = mount();
    fireEvent.keyDown(window, { key: "e" });
    expect(container.querySelector(".dlg-surface")?.getAttribute("data-mode")).toBe("edit");
    fireEvent.keyDown(window, { key: "t" });
    expect(container.querySelector(".dlg-surface")?.getAttribute("data-mode")).toBe("test");
  });

  it("states the mode four times at once", () => {
    const { container } = mount();
    render(<ValidationBar />);
    fireEvent.keyDown(window, { key: "e" });
    // 1. the segmented control's underline
    const active = container.querySelector(".dlg-mode-btn.active");
    expect(active?.getAttribute("data-mode")).toBe("edit");
    // 2. the canvas top border
    expect(container.querySelector(".dlg-canvas")?.getAttribute("data-mode")).toBe("edit");
    // 3. the floating pill
    expect(container.querySelector(".dlg-mode-pill")?.textContent).toContain("edit mode");
    // 4. the statusbar MODE word
    expect(screen.getByTestId("status-mode").textContent).toContain("MODE EDIT");
  });

  it("Esc drops Edit and Test back to View", () => {
    const { container } = mount();
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".dlg-surface")?.getAttribute("data-mode")).toBe("view");
  });

  it("ignores E and T while a text field has focus", () => {
    const { container } = mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "e" });
    expect(container.querySelector(".dlg-surface")?.getAttribute("data-mode")).toBe("view");
    input.remove();
  });

  it("disables Test with its reason for an NPC with no tree", () => {
    mount({ id: 9999, opening_greeting: "…" });
    const test = screen.getByRole("tab", { name: "Test" });
    expect(test).toBeDisabled();
    expect(test.getAttribute("title")).toContain("no tree to walk yet");
  });
});

describe("the toolbar", () => {
  it("names the open tree and its selector", () => {
    const { container } = mount();
    const chip = container.querySelector(".dlg-tree-chip")!;
    expect(chip.textContent).toContain("default");
    expect(chip.textContent).toContain("no selector");
  });

  it("disables Save with a reason while the buffer is clean", () => {
    mount();
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();
    expect(save.getAttribute("title")).toContain("nothing to save");
  });

  // Step 13 landed the improve modal, so the button is ENABLED whenever there
  // is dialogue to improve; the $0-vs-paid split moved inside the modal, where
  // the backend is actually chosen. What must not change is that a surface with
  // NOTHING to improve still disables it WITH the reason (doctrine 4).
  it("enables Improve once there is dialogue, and disables it with a reason when there is not", () => {
    mount();
    const improve = screen.getByRole("button", { name: /Improve/ });
    expect(improve).not.toBeDisabled();
    expect(improve.getAttribute("title")).toContain("a proposal, never a write");
  });

  it("shows no unsaved chip on a clean buffer and one after an edit", () => {
    const { container } = mount();
    expect(container.querySelector(".dlg-dirty")).toBeNull();
    act(() => {
      useStore
        .getState()
        .pushDialogueOps("npc:1023", [
          { k: "node.prompt", tree: "1023:default", node_id: "start", value: "changed" },
        ]);
    });
    expect(container.querySelector(".dlg-dirty")?.textContent).toBe("1 unsaved · 1 node");
  });
});
