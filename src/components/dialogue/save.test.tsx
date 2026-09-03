// Step 4: `canon dialogue update` + `validate` wired to ⌘S — the first
// genuinely useful release. The dirty chip, the unsaved list with revert, the
// validator panel and the save sheet, over the real IPC surface (the invoke
// bridge is mocked, `api` is not).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { DialogueSurface } from "./DialogueSurface";
import { useStore } from "../../store";
import { WHISPER_TAM, questFor } from "../../test/fixtures/mazeworldNpcs";

type Call = { cmd: string; args: Record<string, unknown> };
const calls: Call[] = [];

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "dialogue_validate") {
      return Promise.resolve({ npc: "1023", source: "legacy", trees: 1, errors: [], warnings: [] });
    }
    if (cmd === "dialogue_update") {
      return Promise.resolve({
        npc: "1023",
        source: "dialogue_trees",
        ops: [],
        trees: [
          {
            tree_id: "1023:default",
            character_id: "1023",
            label: "default",
            axis: null,
            selector: null,
            rank: 999,
            entry_node_id: "start",
            nodes: {
              start: { node_id: "start", speaker: null, prompt: "SAVED", choices: [], tags: [] },
            },
          },
        ],
        legacy_written: ["dialogue_tree"],
        changed: true,
        no_change: false,
        warnings: [],
      });
    }
    return Promise.resolve({});
  });
  useStore.setState({
    dialogue: { mode: "view", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: null },
    commands: {},
  });
});

function mount() {
  return render(<DialogueSurface npc={WHISPER_TAM} npcId="1023" quest={questFor(WHISPER_TAM)} />);
}

const editPrompt = () =>
  act(() => {
    useStore
      .getState()
      .pushDialogueOps("npc:1023", [
        { k: "node.prompt", tree: "1023:default", node_id: "start", value: "a new line" },
      ]);
  });

describe("the save path", () => {
  it("asks canon to validate what is on disk when the surface opens", async () => {
    mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "dialogue_validate")).toBe(true));
    expect(calls.find((c) => c.cmd === "dialogue_validate")!.args).toMatchObject({
      path: "/w",
      npc: "1023",
    });
  });

  it("⌘S opens the save sheet naming the edits and the one update that carries them", async () => {
    mount();
    editPrompt();
    fireEvent.keyDown(window, { key: "s", metaKey: true, ctrlKey: false });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, metaKey: false });
    const sheet = await screen.findByRole("dialog", { name: "Save dialogue" });
    expect(sheet.textContent).toContain("Save 1 change to Whisper-Tam?");
    expect(sheet.textContent).toContain("canon dialogue update");
    expect(sheet.textContent).toContain("each edit is journaled separately");
  });

  it("sends ONE dialogue_update carrying the whole op list, with the user actor stamped canon-side", async () => {
    mount();
    editPrompt();
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Save all 1/ }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "dialogue_update")).toBe(true));
    const update = calls.filter((c) => c.cmd === "dialogue_update");
    expect(update).toHaveLength(1);
    expect(update[0].args.ops).toEqual([
      { k: "node.prompt", tree: "1023:default", node_id: "start", value: "a new line" },
    ]);
  });

  it("empties the buffer and re-validates after a save lands", async () => {
    mount();
    editPrompt();
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Save all 1/ }));
    await waitFor(() => expect(useStore.getState().dialogue.buffers["npc:1023"].cursor).toBe(0));
    expect(calls.filter((c) => c.cmd === "dialogue_validate").length).toBeGreaterThan(1);
  });

  it("surfaces canon's refusal instead of pretending the save worked", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "dialogue_update") {
        return Promise.reject(new Error("dialogue update refused (fail-closed): entry missing"));
      }
      return Promise.resolve({ npc: "1023", source: "legacy", trees: 1, errors: [], warnings: [] });
    });
    mount();
    editPrompt();
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Save all 1/ }));
    expect(await screen.findByText(/fail-closed/)).toBeInTheDocument();
    expect(useStore.getState().dialogue.buffers["npc:1023"].cursor).toBe(1);
  });
});

describe("the unsaved list", () => {
  it("lists each edit with a revert, grouped by target, and states the undo boundary", () => {
    mount();
    editPrompt();
    fireEvent.click(screen.getByRole("button", { name: /1 unsaved/ }));
    const list = screen.getByRole("dialog", { name: "Unsaved edits" });
    expect(list.textContent).toContain("tree:1023:default/node:start");
    expect(list.textContent).toContain("edit prompt of start");
    expect(list.textContent).toContain("After saving you undo from History");
    expect(list.querySelectorAll("button")).toBeTruthy();
  });

  it("revert drops that one edit out of the buffer", () => {
    mount();
    editPrompt();
    fireEvent.click(screen.getByRole("button", { name: /1 unsaved/ }));
    fireEvent.click(screen.getByRole("button", { name: "revert" }));
    expect(useStore.getState().dialogue.buffers["npc:1023"].cursor).toBe(0);
  });
});

describe("the validator panel", () => {
  it("reports the buffer's own pre-flight beside canon's stored answer", async () => {
    mount();
    fireEvent.keyDown(window, { key: "e" });
    const panel = await screen.findByTestId("dialogue-validator");
    expect(panel.textContent).toContain("Validator · Whisper-Tam");
    expect(panel.textContent).toContain("canon dialogue validate — warnings never block a write");
  });

  // An error `canon dialogue validate` found ON DISK describes the saved file,
  // not this edit — and it is often exactly what this edit repairs. Blocking on
  // it deadlocked the only save that could clear it, so the sheet names it in
  // its own labelled block and leaves the primary live.
  it("does NOT block on an error that belongs to the file on disk, and says so", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "dialogue_validate") {
        return Promise.resolve({
          npc: "1023",
          source: "legacy",
          trees: 1,
          errors: ["tree '1023:default' has no entry node 'start'"],
          warnings: ["node 'x' is unreachable"],
        });
      }
      return Promise.resolve({});
    });
    mount();
    editPrompt();
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    const primary = await screen.findByRole("button", { name: /Save all 1/ });
    const block = await screen.findByTestId("save-on-disk-errors");
    expect(block.textContent).toContain("already on disk");
    expect(block.textContent).toContain("no entry node");
    expect(primary).not.toBeDisabled();
    // …and the warning is still shown, loud and non-blocking.
    expect(screen.getByText(/these save fine and are journaled as warnings/)).toBeInTheDocument();
  });
});

describe("prose editing in place", () => {
  it("commits a prompt edit as ONE node.prompt op", () => {
    mount();
    fireEvent.keyDown(window, { key: "e" });
    const prompt = document.querySelector(".dc-prompt");
    expect(prompt).toBeTruthy();
    fireEvent.doubleClick(prompt!);
    const area = document.querySelector(".dc-prompt-input") as HTMLTextAreaElement;
    expect(area).toBeTruthy();
    fireEvent.change(area, { target: { value: "rewritten" } });
    fireEvent.keyDown(area, { key: "Enter" });
    const ops = useStore.getState().dialogue.buffers["npc:1023"].ops;
    expect(ops).toEqual([
      { k: "node.prompt", tree: "1023:default", node_id: "start", value: "rewritten" },
    ]);
  });

  it("Esc cancels the in-place edit before it drops the mode", () => {
    const { container } = mount();
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.doubleClick(document.querySelector(".dc-prompt")!);
    const area = document.querySelector(".dc-prompt-input") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "nope" } });
    fireEvent.keyDown(area, { key: "Escape" });
    expect(document.querySelector(".dc-prompt-input")).toBeNull();
    expect(useStore.getState().dialogue.buffers["npc:1023"]?.ops ?? []).toEqual([]);
    // Still in Edit: the gesture was cancelled, not the mode.
    expect(container.querySelector(".dlg-surface")?.getAttribute("data-mode")).toBe("edit");
  });
});
