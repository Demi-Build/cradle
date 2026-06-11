import { describe, it, expect } from "vitest";
import { applyEdit, parseBeatId } from "./applyEdit";
import type { NpcLike } from "./types";

// Two-node tree shared across positive cases — node "start" with one choice
// pointing to "end". Lets us exercise both prompt edits and choice-text edits
// while keeping the fixtures small.
function tree() {
  return {
    nodes: {
      start: {
        prompt: "Hello.",
        choices: [
          { text: "yes", next_node_id: "end" },
          { text: "no", next_node_id: "end" },
        ],
      },
      end: { prompt: "Goodbye." },
    },
  };
}

describe("parseBeatId", () => {
  it("maps the four lane prefixes to their NPC tree fields", () => {
    expect(parseBeatId("tree:start")).toEqual({
      kind: "tree",
      tree: "dialogue_tree",
      nodeId: "start",
    });
    expect(parseBeatId("complete:start")).toEqual({
      kind: "tree",
      tree: "dialogue_tree_complete",
      nodeId: "start",
    });
    expect(parseBeatId("failed:start")).toEqual({
      kind: "tree",
      tree: "dialogue_tree_failed",
      nodeId: "start",
    });
    expect(parseBeatId("incomplete:start")).toEqual({
      kind: "tree",
      tree: "dialogue_tree_incomplete",
      nodeId: "start",
    });
  });

  it("returns null for unknown lanes and tokens", () => {
    expect(parseBeatId("weird-beat")).toBeNull();
    expect(parseBeatId("unknown:start")).toBeNull();
  });
});

describe("applyEdit — scalar beats", () => {
  it("greeting prompt change updates opening_greeting", () => {
    const npc: NpcLike = { opening_greeting: "hi" };
    const next = applyEdit(npc, "greeting", { kind: "prompt", value: "hello" });
    expect(next.opening_greeting).toBe("hello");
  });

  it("exhausted prompt change updates exhausted_dialogue", () => {
    const npc: NpcLike = { exhausted_dialogue: "bye" };
    const next = applyEdit(npc, "exhausted", { kind: "prompt", value: "farewell" });
    expect(next.exhausted_dialogue).toBe("farewell");
  });

  it("returns the same npc reference for a mismatched change kind", () => {
    // Scalar beat (greeting) with a choice-text change is a no-op — the
    // store's dirty flag relies on referential inequality, so this MUST
    // return the same reference, not a fresh-but-equal object.
    const npc: NpcLike = { opening_greeting: "hi" };
    const next = applyEdit(npc, "greeting", { kind: "choice", choiceIdx: 0, value: "x" });
    expect(next).toBe(npc);
  });
});

describe("applyEdit — tree beats", () => {
  it("updates dialogue_tree.nodes[N].prompt for the default lane", () => {
    const npc: NpcLike = { dialogue_tree: tree() };
    const next = applyEdit(npc, "tree:start", { kind: "prompt", value: "Greetings." });
    expect(next.dialogue_tree?.nodes.start.prompt).toBe("Greetings.");
    expect(next.dialogue_tree?.nodes.end.prompt).toBe("Goodbye.");
  });

  it("updates dialogue_tree_complete for the complete lane", () => {
    const npc: NpcLike = { dialogue_tree_complete: tree() };
    const next = applyEdit(npc, "complete:start", { kind: "prompt", value: "Done." });
    expect(next.dialogue_tree_complete?.nodes.start.prompt).toBe("Done.");
  });

  it("updates dialogue_tree_failed for the failed lane", () => {
    const npc: NpcLike = { dialogue_tree_failed: tree() };
    const next = applyEdit(npc, "failed:start", { kind: "prompt", value: "Sorry." });
    expect(next.dialogue_tree_failed?.nodes.start.prompt).toBe("Sorry.");
  });

  it("updates dialogue_tree_incomplete for the incomplete lane", () => {
    const npc: NpcLike = { dialogue_tree_incomplete: tree() };
    const next = applyEdit(npc, "incomplete:start", { kind: "prompt", value: "In progress." });
    expect(next.dialogue_tree_incomplete?.nodes.start.prompt).toBe("In progress.");
  });

  it("choice text update changes only the targeted choice", () => {
    const npc: NpcLike = { dialogue_tree: tree() };
    const next = applyEdit(npc, "tree:start", { kind: "choice", choiceIdx: 0, value: "YES" });
    expect(next.dialogue_tree?.nodes.start.choices?.[0].text).toBe("YES");
    expect(next.dialogue_tree?.nodes.start.choices?.[1].text).toBe("no");
  });
});

describe("applyEdit — negative + edge cases", () => {
  it("returns the same npc reference for an unknown beat id", () => {
    const npc: NpcLike = { dialogue_tree: tree() };
    const next = applyEdit(npc, "weird-beat", { kind: "prompt", value: "x" });
    expect(next).toBe(npc);
  });

  it("returns the same npc reference when the tree node does not exist", () => {
    const npc: NpcLike = { dialogue_tree: tree() };
    const next = applyEdit(npc, "tree:does-not-exist", { kind: "prompt", value: "x" });
    expect(next).toBe(npc);
  });

  it("returns the same npc reference when the lane's tree is missing entirely", () => {
    // No dialogue_tree_complete set on the npc — editing a complete:* beat
    // should be inert (no crash, no fabricated tree).
    const npc: NpcLike = { dialogue_tree: tree() };
    const next = applyEdit(npc, "complete:start", { kind: "prompt", value: "x" });
    expect(next).toBe(npc);
  });

  it("returns the same npc reference for an out-of-bounds choice index", () => {
    const npc: NpcLike = { dialogue_tree: tree() };
    const next = applyEdit(npc, "tree:start", { kind: "choice", choiceIdx: 5, value: "x" });
    expect(next).toBe(npc);
  });
});
