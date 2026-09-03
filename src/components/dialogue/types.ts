export type DialogueChoice = {
  text: string;
  /** `null` ends the conversation. WIDENED from `string` by row P0-9: the
   *  authoring model (`model.ts`) allows a choice that ends the conversation
   *  rather than pointing at a node, and it must survive the View projection.
   *  The lane walker below already treats an unresolvable target as "no edge,
   *  but still a choice", which is exactly the right reading — a node with
   *  one null-target choice is NOT terminal (PLAN watch-out). */
  next_node_id: string | null;
};

export type DialogueNode = {
  prompt?: string;
  choices?: DialogueChoice[];
};

export type DialogueTree = {
  nodes: Record<string, DialogueNode>;
};

export type NpcLike = {
  opening_greeting?: string;
  exhausted_dialogue?: string;
  dialogue_tree?: DialogueTree;
  dialogue_tree_complete?: DialogueTree;
  dialogue_tree_failed?: DialogueTree;
  dialogue_tree_incomplete?: DialogueTree;
  quest_id?: number | string | null;
  max_exchanges?: number;
};

export type QuestLike = {
  id?: number | string;
  title?: string;
  type?: string;
  success_dialogue?: string;
  failure_dialogue?: string;
  reward?: { xp?: number; item_id?: number | string | null };
  failure_penalty?: { hp_damage?: number };
};

export type BeatKind =
  | "greeting"
  | "tree" // default tree — before quest resolution
  | "tree-complete" // tree played when quest has resolved successfully
  | "tree-failed" // tree played after quest failed
  | "tree-incomplete" // tree played while quest is still in progress
  | "gate" // quest-gate marker (single node)
  | "success" // fallback single card when tree-complete is absent
  | "failure" // fallback single card when tree-failed is absent
  | "exhausted";

export type BeatChoice = {
  text: string;
  toBeatId: string;
};

export type Beat = {
  id: string;
  kind: BeatKind;
  label: string;
  prompt: string;
  choices?: BeatChoice[];
  isEntry?: boolean;
  isTerminal?: boolean;
};

export type BeatEdge = {
  from: string;
  to: string;
  label?: string;
  kind?: BeatKind;
};

export type DialogueBuild = { beats: Beat[]; edges: BeatEdge[] };

const LANE_PREFIX: Record<string, string> = {
  tree: "tree:",
  "tree-complete": "complete:",
  "tree-failed": "failed:",
  "tree-incomplete": "incomplete:",
};

type LaneInfo = {
  kind: Extract<BeatKind, "tree" | "tree-complete" | "tree-failed" | "tree-incomplete">;
  entryId: string | null;
  terminals: string[];
};

function ingestTree(
  kind: LaneInfo["kind"],
  tree: DialogueTree | undefined,
  beats: Beat[],
  edges: BeatEdge[],
  isDefault: boolean,
): LaneInfo {
  const nodes = tree?.nodes ?? {};
  const nodeIds = Object.keys(nodes);
  const info: LaneInfo = { kind, entryId: null, terminals: [] };
  if (nodeIds.length === 0) return info;
  const prefix = LANE_PREFIX[kind];
  const entryId = nodeIds.includes("start") ? "start" : nodeIds[0];
  info.entryId = entryId;
  for (const nid of nodeIds) {
    const node = nodes[nid];
    const rawChoices = node.choices ?? [];
    const choices: BeatChoice[] = rawChoices
      .filter((c) => c.next_node_id !== null && !!nodes[c.next_node_id])
      .map((c) => ({ text: c.text, toBeatId: prefix + c.next_node_id }));
    const isTerminal = rawChoices.length === 0;
    if (isTerminal) info.terminals.push(nid);
    beats.push({
      id: prefix + nid,
      kind,
      label: nid,
      prompt: node.prompt ?? "",
      choices,
      isEntry: isDefault && nid === entryId,
      isTerminal,
    });
    for (const c of rawChoices) {
      if (c.next_node_id === null || !nodes[c.next_node_id]) continue;
      edges.push({ from: prefix + nid, to: prefix + c.next_node_id, kind });
    }
  }
  return info;
}

export function buildDialogue(npc: NpcLike, quest?: QuestLike | null): DialogueBuild {
  const beats: Beat[] = [];
  const edges: BeatEdge[] = [];

  const hasGreeting = typeof npc.opening_greeting === "string" && npc.opening_greeting.length > 0;
  const hasExhausted =
    typeof npc.exhausted_dialogue === "string" && npc.exhausted_dialogue.length > 0;

  if (hasGreeting) {
    beats.push({
      id: "greeting",
      kind: "greeting",
      label: "Opening greeting",
      prompt: npc.opening_greeting!,
      isEntry: true,
    });
  }

  const defaultLane = ingestTree("tree", npc.dialogue_tree, beats, edges, true);
  const completeLane = ingestTree("tree-complete", npc.dialogue_tree_complete, beats, edges, false);
  const failedLane = ingestTree("tree-failed", npc.dialogue_tree_failed, beats, edges, false);
  const incompleteLane = ingestTree(
    "tree-incomplete",
    npc.dialogue_tree_incomplete,
    beats,
    edges,
    false,
  );

  // Greeting → default tree entry
  if (hasGreeting && defaultLane.entryId) {
    edges.push({ from: "greeting", to: LANE_PREFIX["tree"] + defaultLane.entryId, kind: "tree" });
  }

  // Fallback single cards only if the corresponding lane tree is missing.
  const hasSuccessTree = !!completeLane.entryId;
  const hasFailureTree = !!failedLane.entryId;
  const hasIncompleteTree = !!incompleteLane.entryId;

  const hasSuccess =
    !hasSuccessTree &&
    !!quest &&
    typeof quest.success_dialogue === "string" &&
    quest.success_dialogue.length > 0;
  const hasFailure =
    !hasFailureTree &&
    !!quest &&
    typeof quest.failure_dialogue === "string" &&
    quest.failure_dialogue.length > 0;

  // Quest gate — the resolution point that branches based on quest outcome
  // (not dialogue choice). Acts as a visual "gate" that separates conversation
  // branching from quest-state branching. Appears whenever there's at least
  // one resolution path (tree or one-liner) for any quest state.
  const hasAnyResolution =
    hasSuccessTree || hasFailureTree || hasIncompleteTree || hasSuccess || hasFailure;
  const hasGate = !!quest && hasAnyResolution;
  if (hasGate) {
    const gateParts: string[] = [];
    if (quest?.type) gateParts.push(`type: ${quest.type}`);
    if (typeof quest?.reward?.xp === "number") gateParts.push(`reward: ${quest.reward.xp} xp`);
    if (typeof quest?.failure_penalty?.hp_damage === "number") {
      gateParts.push(`failure: ${quest.failure_penalty.hp_damage} hp damage`);
    }
    const prompt = gateParts.length
      ? `Outcome decided by quest resolution (${gateParts.join(" · ")}).`
      : "Outcome decided by quest resolution.";
    const gateChoices: BeatChoice[] = [];
    if (hasSuccessTree)
      gateChoices.push({
        text: "on complete → tree",
        toBeatId: LANE_PREFIX["tree-complete"] + completeLane.entryId,
      });
    else if (hasSuccess) gateChoices.push({ text: "on complete", toBeatId: "success" });
    if (hasIncompleteTree)
      gateChoices.push({
        text: "while in progress → tree",
        toBeatId: LANE_PREFIX["tree-incomplete"] + incompleteLane.entryId,
      });
    if (hasFailureTree)
      gateChoices.push({
        text: "on failure → tree",
        toBeatId: LANE_PREFIX["tree-failed"] + failedLane.entryId,
      });
    else if (hasFailure) gateChoices.push({ text: "on failure", toBeatId: "failure" });
    beats.push({
      id: "quest-gate",
      kind: "gate",
      label: quest?.title ? `Quest gate · ${quest.title}` : "Quest gate",
      prompt,
      choices: gateChoices,
    });
  }

  // Outcome beats
  if (hasSuccess) {
    beats.push({
      id: "success",
      kind: "success",
      label: quest?.title ? `Quest complete · ${quest.title}` : "Quest complete",
      prompt: quest!.success_dialogue!,
      isTerminal: true,
    });
  }
  if (hasFailure) {
    beats.push({
      id: "failure",
      kind: "failure",
      label: quest?.title ? `Quest failed · ${quest.title}` : "Quest failed",
      prompt: quest!.failure_dialogue!,
      isTerminal: true,
    });
  }
  if (hasExhausted) {
    beats.push({
      id: "exhausted",
      kind: "exhausted",
      label:
        typeof npc.max_exchanges === "number"
          ? `Exhausted · after ${npc.max_exchanges} exchanges`
          : "Exhausted",
      prompt: npc.exhausted_dialogue!,
      isTerminal: true,
    });
  }

  // Wire edges from the default-tree terminals:
  //   terminal → gate  (quest offered)
  //   terminal → exhausted (dashed — not quest-gated)
  for (const tid of defaultLane.terminals) {
    const fromId = LANE_PREFIX["tree"] + tid;
    if (hasGate)
      edges.push({ from: fromId, to: "quest-gate", kind: "gate", label: "quest offered" });
    if (hasExhausted)
      edges.push({ from: fromId, to: "exhausted", kind: "exhausted", label: "exhausted" });
  }

  // Wire the gate → quest-state lane entries (or fallback single cards).
  if (hasGate) {
    if (hasSuccessTree) {
      edges.push({
        from: "quest-gate",
        to: LANE_PREFIX["tree-complete"] + completeLane.entryId,
        kind: "success",
        label: "on complete",
      });
    } else if (hasSuccess) {
      edges.push({ from: "quest-gate", to: "success", kind: "success", label: "on complete" });
    }
    if (hasIncompleteTree) {
      edges.push({
        from: "quest-gate",
        to: LANE_PREFIX["tree-incomplete"] + incompleteLane.entryId,
        kind: "exhausted",
        label: "in progress",
      });
    }
    if (hasFailureTree) {
      edges.push({
        from: "quest-gate",
        to: LANE_PREFIX["tree-failed"] + failedLane.entryId,
        kind: "failure",
        label: "on failure",
      });
    } else if (hasFailure) {
      edges.push({ from: "quest-gate", to: "failure", kind: "failure", label: "on failure" });
    }
  }

  // From every lane's terminal, wire to exhausted so any conversation can
  // run out of exchanges regardless of quest state.
  if (hasExhausted) {
    for (const tid of completeLane.terminals) {
      edges.push({
        from: LANE_PREFIX["tree-complete"] + tid,
        to: "exhausted",
        kind: "exhausted",
        label: "exhausted",
      });
    }
    for (const tid of failedLane.terminals) {
      edges.push({
        from: LANE_PREFIX["tree-failed"] + tid,
        to: "exhausted",
        kind: "exhausted",
        label: "exhausted",
      });
    }
    for (const tid of incompleteLane.terminals) {
      edges.push({
        from: LANE_PREFIX["tree-incomplete"] + tid,
        to: "exhausted",
        kind: "exhausted",
        label: "exhausted",
      });
    }
  }

  // Inject scroll-to choices on default-tree terminals for card mode navigation.
  for (const beat of beats) {
    if (beat.kind !== "tree" || !beat.isTerminal) continue;
    const extras: BeatChoice[] = [];
    if (hasGate) extras.push({ text: "→ quest gate", toBeatId: "quest-gate" });
    if (hasExhausted) extras.push({ text: "→ exhausted", toBeatId: "exhausted" });
    beat.choices = [...(beat.choices ?? []), ...extras];
  }

  return { beats, edges };
}

export function bfsOrderBeats(beats: Beat[], edges: BeatEdge[]): string[] {
  const byId = new Map(beats.map((b) => [b.id, b]));
  const out: Map<string, string[]> = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e.to);
  }
  const start = beats.find((b) => b.isEntry)?.id ?? beats[0]?.id;
  if (!start) return [];
  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    if (!byId.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const nxt of out.get(id) ?? []) {
      if (!seen.has(nxt)) queue.push(nxt);
    }
  }
  for (const b of beats) if (!seen.has(b.id)) order.push(b.id);
  return order;
}
