// Step 1's proof, and the one test in this row that must never be hand-waved:
// `toAuthorDoc → toBeats` renders today's View mode BYTE-IDENTICALLY.
//
// Two independent locks, on purpose:
//   1. a committed SNAPSHOT of `buildDialogue`'s output for the two named
//      fixtures — the "before" picture, so a later change to the untouched
//      renderer is caught too;
//   2. a deep-equality sweep of `toBeats(toAuthorDoc(row))` against
//      `buildDialogue(row)` for ALL 79 real NPC rows, quests included.
//
// Lock 2 is the adapter's own proof; lock 1 stops the adapter and the renderer
// drifting together into agreement on the wrong picture.

import { describe, expect, it } from "vitest";
import { buildDialogue } from "./types";
import {
  danglingChoices,
  defaultTreeId,
  importLegacy,
  laneProjection,
  orderedTrees,
  toAuthorDoc,
  toBeats,
  unreachableNodes,
} from "./model";
import { DEFAULT_VOCAB } from "./grammar";
import {
  FOUR_VARIANT_NPC,
  MAZEWORLD_NPCS,
  WHISPER_TAM,
  questFor,
} from "../../test/fixtures/mazeworldNpcs";

describe("toAuthorDoc → toBeats renders View mode byte-identically", () => {
  it("matches the committed snapshot of Whisper-Tam's View output", () => {
    const before = buildDialogue(WHISPER_TAM, questFor(WHISPER_TAM));
    expect(before).toMatchSnapshot();
    const after = toBeats(toAuthorDoc(WHISPER_TAM), null, questFor(WHISPER_TAM));
    expect(after).toEqual(before);
  });

  it("matches the committed snapshot of a four-variant quest NPC's View output", () => {
    const quest = questFor(FOUR_VARIANT_NPC);
    const before = buildDialogue(FOUR_VARIANT_NPC, quest);
    expect(before).toMatchSnapshot();
    const after = toBeats(toAuthorDoc(FOUR_VARIANT_NPC), null, quest);
    expect(after).toEqual(before);
  });

  it("round-trips every NPC in the shipped bible, quests included", () => {
    expect(MAZEWORLD_NPCS.length).toBeGreaterThan(70);
    const divergent: string[] = [];
    for (const npc of MAZEWORLD_NPCS) {
      const quest = questFor(npc);
      const before = buildDialogue(npc, quest);
      const after = toBeats(toAuthorDoc(npc), null, quest);
      if (JSON.stringify(after) !== JSON.stringify(before)) divergent.push(String(npc.id));
    }
    expect(divergent).toEqual([]);
  });

  it("keeps the beat and edge counts identical for every row", () => {
    for (const npc of MAZEWORLD_NPCS) {
      const quest = questFor(npc);
      const before = buildDialogue(npc, quest);
      const after = toBeats(toAuthorDoc(npc), null, quest);
      expect([after.beats.length, after.edges.length]).toEqual([
        before.beats.length,
        before.edges.length,
      ]);
    }
  });
});

// The shipped bible only contains two of the legal legacy row shapes (46 rows
// carry `dialogue_tree` alone, 33 carry all four), so the sweep above cannot
// speak for the other two. These pin what the adapter DOES for them, so a
// projection loss is a recorded outcome rather than a surprise.
describe("the legacy row shapes the shipped bible does not contain", () => {
  const nodes = (prompt: string) => ({ nodes: { start: { prompt, choices: [] } } });

  it("a quest-less row carrying a variant tree: the variant becomes the fallback", () => {
    const row = {
      id: 8001,
      quest_id: null,
      dialogue_tree: nodes("base"),
      dialogue_tree_complete: nodes("after"),
    };
    const doc = toAuthorDoc(row);
    // canon's `legacy_projection` rule, mirrored: with no quest id there is no
    // selector to build, so the complete tree lands UNGATED — and two ungated
    // trees mean the first by rank wins.
    expect(orderedTrees(doc).map((t) => [t.tree_id, t.selector])).toEqual([
      ["8001:complete", null],
      ["8001:default", null],
    ]);
    // The projection is lossy against `buildDialogue`, and the lane projection
    // is where that is said out loud rather than rendered silently.
    expect(laneProjection(doc.trees).warnings.join(" ")).not.toBe("");
  });

  it("a row with variants and no base tree keeps the variants and has no fallback", () => {
    const row = { id: 8002, quest_id: 4000, dialogue_tree_incomplete: nodes("mid") };
    const doc = toAuthorDoc(row);
    expect(doc.trees.map((t) => t.tree_id)).toEqual(["8002:incomplete"]);
    expect(doc.trees[0].selector?.rows).toEqual(["quest:4000:active"]);
    expect(doc.trees.some((t) => t.selector === null)).toBe(false);
  });
});

describe("the legacy import mirrors canon's mapping table", () => {
  it("gives a four-variant NPC three quest selectors plus a fallback", () => {
    const doc = toAuthorDoc(FOUR_VARIANT_NPC);
    const trees = orderedTrees(doc);
    expect(trees.map((t) => t.tree_id)).toEqual([
      "1001:incomplete",
      "1001:complete",
      "1001:failed",
      "1001:default",
    ]);
    expect(trees.map((t) => t.rank)).toEqual([0, 1, 2, 999]);
    expect(trees.map((t) => t.selector?.rows ?? null)).toEqual([
      ["quest:4000:active"],
      ["quest:4000:completed"],
      ["quest:4000:failed"],
      null,
    ]);
    expect(trees.map((t) => t.axis)).toEqual(["quest", "quest", "quest", null]);
  });

  it("gives a questless NPC one fallback tree and nothing else", () => {
    const doc = toAuthorDoc(WHISPER_TAM);
    expect(doc.trees).toHaveLength(1);
    expect(doc.trees[0].tree_id).toBe("1023:default");
    expect(doc.trees[0].selector).toBeNull();
    expect(doc.trees[0].label).toBe("default");
    expect(defaultTreeId(doc)).toBe("1023:default");
  });

  it("derives the slot→state mapping from pack data, not a hardcoded pair", () => {
    // Renaming the legacy fields in the vocab moves the tree ids and the
    // selector states with them — nothing here is a literal.
    const vocab = {
      ...DEFAULT_VOCAB,
      storage: {
        ...DEFAULT_VOCAB.storage,
        legacy_fields: ["d", "d_incomplete", "d_complete", "d_failed"],
      },
    };
    const row = {
      id: 7,
      quest_id: 42,
      d: { nodes: { start: { prompt: "base", choices: [] } } },
      d_complete: { nodes: { start: { prompt: "done", choices: [] } } },
    };
    const trees = importLegacy(row, "7", vocab);
    expect(trees.map((t) => [t.tree_id, t.selector?.rows?.[0] ?? null])).toEqual([
      ["7:complete", "quest:42:completed"],
      ["7:default", null],
    ]);
  });

  it("carries the chrome the four fields sit beside", () => {
    const doc = toAuthorDoc(WHISPER_TAM);
    expect(doc.chrome.opening_greeting).toBe(WHISPER_TAM.opening_greeting);
    expect(doc.chrome.exhausted_dialogue).toBe(WHISPER_TAM.exhausted_dialogue);
    expect(doc.chrome.quest_id).toBe(WHISPER_TAM.quest_id ?? null);
  });

  it("prefers the new dialogue_trees storage over the legacy four", () => {
    const row = {
      id: 9,
      dialogue_tree: { nodes: { start: { prompt: "legacy", choices: [] } } },
      dialogue_trees: [
        {
          tree_id: "9:night",
          character_id: "9",
          label: "night vigil",
          axis: "time",
          selector: { rows: ["time:night"] },
          rank: 0,
          entry_node_id: "start",
          nodes: {
            start: { node_id: "start", speaker: null, prompt: "new", choices: [], tags: [] },
          },
        },
      ],
    };
    const doc = toAuthorDoc(row);
    expect(doc.trees).toHaveLength(1);
    expect(doc.trees[0].label).toBe("night vigil");
    expect(doc.trees[0].nodes.start.prompt).toBe("new");
  });
});

describe("what the flattening lost, the model keeps", () => {
  it("preserves per-choice conditions and effects", () => {
    const row = {
      id: 3,
      dialogue_trees: [
        {
          tree_id: "3:t",
          character_id: "3",
          rank: 0,
          entry_node_id: "start",
          nodes: {
            start: {
              node_id: "start",
              prompt: "p",
              choices: [
                {
                  text: "take it",
                  next_node_id: null,
                  conditions: ["has_item:2000"],
                  effects: ["takes_item:2000"],
                },
              ],
            },
          },
        },
      ],
    };
    const choice = toAuthorDoc(row).trees[0].nodes.start.choices[0];
    expect(choice.conditions).toEqual(["has_item:2000"]);
    expect(choice.effects).toEqual(["takes_item:2000"]);
    expect(choice.next_node_id).toBeNull();
  });

  it("preserves a dangling next_node_id instead of dropping the choice", () => {
    const row = {
      id: 4,
      dialogue_tree: {
        nodes: {
          start: { prompt: "p", choices: [{ text: "go", next_node_id: "gone" }] },
        },
      },
    };
    const doc = toAuthorDoc(row);
    const tree = doc.trees[0];
    expect(tree.nodes.start.choices[0].next_node_id).toBe("gone");
    expect(danglingChoices(tree)).toEqual([{ node_id: "start", index: 0, target: "gone" }]);
    // View mode still drops it from the render — unchanged behaviour.
    expect(toBeats(doc, tree.tree_id).beats[0].choices).toEqual([]);
  });

  it("keeps a node with a null-target choice out of the terminal set", () => {
    const row = {
      id: 5,
      dialogue_trees: [
        {
          tree_id: "5:t",
          character_id: "5",
          rank: 0,
          entry_node_id: "start",
          nodes: {
            start: {
              node_id: "start",
              prompt: "p",
              choices: [{ text: "leave", next_node_id: null }],
            },
          },
        },
      ],
    };
    const beats = toBeats(toAuthorDoc(row), "5:t").beats;
    expect(beats[0].isTerminal).toBe(false);
    expect(beats[0].choices).toEqual([]);
  });

  it("reports unreachable nodes without removing them", () => {
    const row = {
      id: 6,
      dialogue_trees: [
        {
          tree_id: "6:t",
          character_id: "6",
          rank: 0,
          entry_node_id: "start",
          nodes: {
            start: { node_id: "start", prompt: "p", choices: [] },
            orphan: { node_id: "orphan", prompt: "q", choices: [] },
          },
        },
      ],
    };
    const tree = toAuthorDoc(row).trees[0];
    expect(unreachableNodes(tree)).toEqual(["orphan"]);
    expect(Object.keys(tree.nodes)).toEqual(["start", "orphan"]);
  });
});

describe("laneProjection mirrors canon's write-back", () => {
  it("claims one legacy slot per tree in rank order", () => {
    const doc = toAuthorDoc(FOUR_VARIANT_NPC);
    const { claims, warnings } = laneProjection(doc.trees);
    expect(claims).toEqual({
      "1001:incomplete": "dialogue_tree_incomplete",
      "1001:complete": "dialogue_tree_complete",
      "1001:failed": "dialogue_tree_failed",
      "1001:default": "dialogue_tree",
    });
    expect(warnings).toEqual([]);
  });

  it("warns — never refuses — when a selector axis the legacy four cannot express", () => {
    const doc = toAuthorDoc({
      id: 8,
      dialogue_trees: [
        {
          tree_id: "8:night",
          character_id: "8",
          rank: 0,
          selector: { rows: ["time:night"] },
          entry_node_id: "start",
          nodes: { start: { node_id: "start", prompt: "p", choices: [] } },
        },
      ],
    });
    const { warnings, slots } = laneProjection(doc.trees);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("selected by time");
    expect(warnings[0]).toContain("engine lag");
    // The data is still there; only the engine copy is not written.
    expect(Object.keys(slots)).toEqual(["dialogue_tree"]);
  });
});
