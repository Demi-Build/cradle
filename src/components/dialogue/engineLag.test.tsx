// Step 10: the engine-lag layer — doctrine 10 made visible.
//
// The three treatments are asserted against TWO packs, because that contrast is
// the whole point:
//
//   EMPTY_ENGINE  — `evaluable_namespaces` present and EMPTY at tree scope,
//                   which is today's dungeon engine. Every gate is amber, and
//                   that is CORRECT: the assertions here are what make it look
//                   deliberate rather than broken.
//   PARTIAL_ENGINE — `has_item` and `quest` evaluated, `time` and `player` not.
//                   The banner names only the two that lag, and the evaluated
//                   ones stay green.
//
// And one pack with NO block at all, where the layer is SKIPPED entirely rather
// than warning falsely (the PLAN's own instruction).
//
// Nothing here may block: the last test walks the save path with every gate
// amber and asserts the primary is still enabled.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { DialogueSurface } from "./DialogueSurface";
import { EngineLagTrayNote } from "./EngineLag";
import { lagWarnings, treeLag, type AuthorTree } from "./model";
import {
  engineCapabilityRows,
  engineSupportsNamespace,
  laggingNamespaces,
  namespaceLagReason,
  DEFAULT_VOCAB,
} from "./grammar";
import { useStore } from "../../store";
import type { NpcRow } from "./model";
import type { PackInfo } from "../../lib/invoke";

/** Today's dungeon engine: the block is PRESENT and empty at tree scope. */
const EMPTY_ENGINE: PackInfo = {
  pack_type: "dungeon",
  capabilities: ["dialogue"],
  engines: [{ id: "pygame", primary: true }],
  engine_evaluable_namespaces: { tree: {}, selector: {}, scene: {}, effects: {} },
};

const PARTIAL_ENGINE: PackInfo = {
  pack_type: "dungeon",
  capabilities: ["dialogue"],
  engines: [{ id: "mazeworld-py", primary: true }],
  engine_evaluable_namespaces: {
    tree: { has_item: true, quest: true },
    selector: { quest: true },
    scene: {},
    effects: { gives_item: true },
  },
};

/** A pack whose manifest does not carry the block at all. */
const NO_BLOCK: PackInfo = { pack_type: "dungeon", capabilities: ["dialogue"] };

const TREE: AuthorTree = {
  tree_id: "1023:default",
  character_id: "1023",
  label: "default",
  axis: null,
  selector: null,
  rank: 999,
  entry_node_id: "start",
  nodes: {
    start: {
      node_id: "start",
      speaker: null,
      prompt: "The voices sing.",
      tags: [],
      choices: [
        {
          text: "I brought the shard.",
          next_node_id: "voices",
          conditions: ["has_item:item_resonance_shard"],
          effects: [],
        },
        {
          text: "Wait for the transmission.",
          next_node_id: null,
          conditions: ["time:night", "player:health:<:10"],
          effects: [],
        },
      ],
    },
    voices: { node_id: "voices", speaker: null, prompt: "Harmony.", choices: [], tags: [] },
  },
};

const NPC: NpcRow = { id: "1023", name: "Whisper-Tam", dialogue_trees: [TREE] };

function seed(packInfo: PackInfo | null, mode: "view" | "edit" | "test" = "edit") {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "dialogue_show") {
      return Promise.resolve({
        npc: "1023",
        source: "dialogue_trees",
        storage_field: "dialogue_trees",
        legacy_fields: [],
        legacy_written: [],
        engine: { id: null, evaluable_namespaces: null },
        selector_axes: [],
        trees: [],
        scenes: [],
        warnings: [],
      });
    }
    return Promise.resolve({
      npc: "1023",
      source: "dialogue_trees",
      trees: 1,
      errors: [],
      warnings: [],
    });
  });
  useStore.setState({
    dialogue: { mode, scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: packInfo },
    entities: {},
    commands: {},
  });
}

beforeEach(() => seed(EMPTY_ENGINE));

describe("engineSupportsNamespace — the one answer every treatment renders", () => {
  it("an EXPLICIT EMPTY block means the engine evaluates nothing, not everything", () => {
    expect(engineSupportsNamespace("has_item", "tree", EMPTY_ENGINE)).toBe(false);
    expect(engineSupportsNamespace("quest", "tree", EMPTY_ENGINE)).toBe(false);
    expect(laggingNamespaces(DEFAULT_VOCAB, EMPTY_ENGINE)).toEqual(
      DEFAULT_VOCAB.condition_namespaces,
    );
  });

  it("a PARTIAL block splits the namespaces the pack declares", () => {
    expect(engineSupportsNamespace("has_item", "tree", PARTIAL_ENGINE)).toBe(true);
    expect(engineSupportsNamespace("time", "tree", PARTIAL_ENGINE)).toBe(false);
    expect(laggingNamespaces(DEFAULT_VOCAB, PARTIAL_ENGINE)).not.toContain("has_item");
    expect(laggingNamespaces(DEFAULT_VOCAB, PARTIAL_ENGINE)).toContain("time");
  });

  it("a MISSING block skips the layer rather than warning falsely", () => {
    expect(engineSupportsNamespace("time", "tree", NO_BLOCK)).toBe(true);
    expect(laggingNamespaces(DEFAULT_VOCAB, NO_BLOCK)).toEqual([]);
    expect(treeLag(TREE, NO_BLOCK).gates).toEqual([]);
  });

  it("names the engine and what it does INSTEAD, per scope", () => {
    expect(namespaceLagReason("time", "tree", PARTIAL_ENGINE)).toContain("mazeworld-py");
    expect(namespaceLagReason("time", "tree", PARTIAL_ENGINE)).toContain(
      "the choice shows unconditionally in game",
    );
    expect(namespaceLagReason("time", "selector", PARTIAL_ENGINE)).toContain(
      "may play a different tree",
    );
    expect(namespaceLagReason("set_flag", "effects", PARTIAL_ENGINE)).toContain(
      "the effect never fires",
    );
  });

  it("the capabilities list is the PACK's namespaces, split by this engine", () => {
    const rows = engineCapabilityRows(DEFAULT_VOCAB, PARTIAL_ENGINE);
    expect(rows.find((r) => r.namespace === "has_item")?.evaluated).toBe(true);
    expect(rows.find((r) => r.namespace === "time")?.evaluated).toBe(false);
    // Scene scope brings the scene-only namespaces into the list.
    expect(
      engineCapabilityRows(DEFAULT_VOCAB, PARTIAL_ENGINE, "scene").some(
        (r) => r.namespace === "actor",
      ),
    ).toBe(true);
  });
});

describe("treatment 1 — the tree banner", () => {
  it("on an EMPTY evaluable set, warns about every gate and says nothing blocks saving", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const banner = await screen.findByTestId("dialogue-lag-banner");
    expect(banner.textContent).toContain("3 gates the pack's engine can't evaluate yet");
    expect(banner.textContent).toContain("pygame ignores them");
    expect(banner.textContent).toContain("Nothing here blocks saving");
  });

  it("on a PARTIAL set, names only the namespaces that lag", async () => {
    seed(PARTIAL_ENGINE);
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const banner = await screen.findByTestId("dialogue-lag-banner");
    expect(banner.textContent).toContain("2 gates");
    expect(banner.textContent).toContain("time:");
    expect(banner.textContent).toContain("player:");
    expect(banner.textContent).not.toContain("has_item:");
  });

  it("is ABSENT when the manifest carries no block — no false warning", async () => {
    seed(NO_BLOCK);
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-surface");
    expect(screen.queryByTestId("dialogue-lag-banner")).toBeNull();
  });

  it("MUTES per tree — and says the fact stays even when the banner goes", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.click(await screen.findByText("Mute for this tree"));
    const banner = await screen.findByTestId("dialogue-lag-banner");
    expect(banner.getAttribute("data-muted")).toBe("1");
    expect(banner.textContent).toContain("muting the banner never mutes the fact");
    fireEvent.click(screen.getByText("Unmute"));
    await waitFor(() =>
      expect(screen.getByTestId("dialogue-lag-banner").getAttribute("data-muted")).toBeNull(),
    );
  });

  it("opens the capabilities list, read from the pack registry", async () => {
    seed(PARTIAL_ENGINE);
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.click(await screen.findByText("Engine capabilities…"));
    const caps = await screen.findByTestId("dialogue-engine-capabilities");
    expect(caps.textContent).toContain("evaluated");
    expect(caps.textContent).toContain("tester only");
    expect(caps.textContent).toContain("Read from the pack registry, not hard-coded");
  });

  it("the header chip counts the namespaces this engine honours", async () => {
    seed(PARTIAL_ENGINE);
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const chip = await screen.findByTestId("dialogue-engine-chip");
    expect(chip.textContent).toContain("mazeworld-py");
    expect(chip.textContent).toContain(`2 of ${DEFAULT_VOCAB.condition_namespaces.length}`);
    expect(chip.getAttribute("data-lag")).toBe("1");
  });
});

describe("treatment 2 — the dashed choice row and the amber ribbon dot", () => {
  it("dashes the lagging rows and leaves the evaluated one alone", async () => {
    seed(PARTIAL_ENGINE);
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await waitFor(() =>
      expect(document.querySelectorAll(".dlg-choicerow").length).toBeGreaterThan(0),
    );
    const rows = [...document.querySelectorAll(".dlg-choicerow")];
    expect(rows[0].getAttribute("data-lag")).toBeNull();
    expect(rows[1].getAttribute("data-lag")).toBe("1");
    // The ribbon dot carries the same verdict.
    expect(rows[0].querySelector('.dlg-ribbon-dot[data-engine="ok"]')).toBeTruthy();
    expect(rows[1].querySelector('.dlg-ribbon-dot[data-engine="lag"]')).toBeTruthy();
  });

  it("on the reference world EVERY dot is amber — deliberate, not broken", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await waitFor(() =>
      expect(document.querySelectorAll(".dlg-ribbon-dot").length).toBeGreaterThan(0),
    );
    const dots = [...document.querySelectorAll(".dlg-ribbon-dot")];
    expect(dots.every((d) => d.getAttribute("data-engine") === "lag")).toBe(true);
    expect(document.querySelectorAll(".dlg-choicerow[data-lag='1']").length).toBe(2);
  });
});

describe("treatment 3 — the tray note and the save-sheet block", () => {
  it("the tray names the namespace, what the engine evaluates, and answers why", async () => {
    seed(PARTIAL_ENGINE);
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll(".dlg-choicerow")];
      expect(found.length).toBe(2);
      return found;
    });
    fireEvent.click(rows[1]);
    const note = await screen.findByTestId("dialogue-lag-tray");
    expect(note.textContent).toContain("2 not enforced");
    expect(note.textContent).toContain("mazeworld-py");
    expect(note.textContent).toContain("has_item, quest");
    expect(note.textContent).toContain("The tester does evaluate it");
    fireEvent.click(screen.getByText("Why is this allowed?"));
    expect(screen.getByText(/Data may outrun the engine/)).toBeInTheDocument();
  });

  it("the save sheet lists each lagging gate and STILL enables the primary", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll(".dlg-choicerow")];
      expect(found.length).toBe(2);
      return found;
    });
    // Make the buffer dirty so the sheet can open at all.
    fireEvent.click(rows[0]);
    fireEvent.change(screen.getByLabelText("choice 1 text"), {
      target: { value: "I brought it." },
    });
    fireEvent.click(screen.getByTitle(/Save the unsaved buffer/));
    const block = await screen.findByTestId("save-engine-lag");
    expect(block.textContent).toContain("engine ignores it (tester enforces)");
    expect(block.textContent?.replace(/\s+/g, " ")).toContain("these save fine");
    const primary = screen.getByRole("button", { name: /Save all/ }) as HTMLButtonElement;
    expect(primary.disabled).toBe(false);
  });

  // The reference world's REAL selector block narrows `quest:` to
  // completed/failed. A namespace-level answer would call `quest:q1:active`
  // evaluated while the ribbon dot painted it amber — the banner and the dot
  // must never disagree, so both ask the token-level verdict.
  it("agrees with the ribbon dots on a NARROWED namespace", () => {
    const narrowed: PackInfo = {
      pack_type: "dungeon",
      capabilities: ["dialogue"],
      engines: [{ id: "pygame", primary: true }],
      engine_evaluable_namespaces: {
        tree: { quest: { states: ["completed", "failed"] } },
        selector: { quest: { states: ["completed", "failed"] } },
        scene: {},
        effects: {},
      },
    };
    const gated: AuthorTree = {
      ...TREE,
      selector: { rows: ["quest:q1:active"] },
      nodes: {
        start: {
          node_id: "start",
          speaker: null,
          prompt: "",
          tags: [],
          choices: [
            { text: "a", next_node_id: null, conditions: ["quest:q1:completed"], effects: [] },
            { text: "b", next_node_id: null, conditions: ["quest:q1:active"], effects: [] },
          ],
        },
      },
    };
    // The namespace IS declared…
    expect(engineSupportsNamespace("quest", "tree", narrowed)).toBe(true);
    // …but only one of the two tokens is actually honoured.
    const lag = treeLag(gated, narrowed);
    expect(lag.gates.map((g) => g.token)).toEqual(["quest:q1:active"]);
    // The reason names the SLOT the block narrows (canon says `state`, from
    // `parsed.slots`, not the `states` key the manifest spells it with).
    expect(lag.gates[0].reason).toContain("only for state in completed, failed");
    expect(lag.selectorRows.map((r) => r.token)).toEqual(["quest:q1:active"]);
  });

  // Treatment 3's tray note asked the NAMESPACE-level question while the row,
  // the ribbon, the banner and the save sheet all ask the TOKEN-level one — so
  // it was the one treatment that went silent on an operand-narrowed gate,
  // which is the reference pack's own case.
  it("the tray note fires on an operand-narrowed token, like every other treatment", () => {
    const narrowed = {
      pack_type: "dungeon",
      engine_evaluable_namespaces: {
        tree: { quest: { states: ["completed", "failed"] } },
        selector: {},
        effects: {},
      },
    } as unknown as PackInfo;
    expect(engineSupportsNamespace("quest", "tree", narrowed)).toBe(true);
    render(
      <EngineLagTrayNote
        tokens={["quest:q1:active"]}
        vocab={DEFAULT_VOCAB}
        packInfo={narrowed}
        scope="tree"
      />,
    );
    const tray = screen.getByTestId("dialogue-lag-tray");
    expect(tray.textContent).toContain("1 not enforced");
    expect(tray.textContent).toContain("quest:");
  });

  it("lagWarnings phrases each line the way the sheet reads it", () => {
    const lines = lagWarnings(treeLag(TREE, PARTIAL_ENGINE));
    expect(lines).toContain("time:night on start[1] — engine ignores it (tester enforces)");
    expect(lines).toHaveLength(2);
  });
});
