// The devMock's stand-in for the six `canon dialogue` verbs (I7: devMock parity
// for every new command).
//
// EXTENDS `lib/devMock.ts`, which is already the browser stand-in for the whole
// Rust bridge; this is its dialogue half, split into its own module only
// because devMock is 2 300 lines already. It is dev-only and never bundled in
// production — `main.tsx` imports devMock behind the env flag.
//
// It EVALUATES gates, and that is deliberate: the mock stands in for canon, and
// canon is the one evaluator. No component may do what this file does — the UI
// asks `canon dialogue test` and renders the answer. The rule is "the UI never
// reimplements gating", not "no TypeScript may ever evaluate a token".
//
// The NPC it serves is Whisper-Tam's shape from the design package: a fallback
// tree, a `time:` tree the mock's engine cannot evaluate (so the engine-lag
// layer has something real to warn about) and one quest-gated choice.

import {
  importLegacy,
  toAuthorDoc,
  laneProjection,
  unreachableNodes,
  danglingChoices,
  type AuthorDoc,
  type AuthorTree,
  type NpcRow,
} from "../components/dialogue/model";
import { applyOps, type EditOp } from "../components/dialogue/ops";
import { sceneReport, toSceneDoc, toSceneRow, type SceneDoc } from "../components/dialogue/scene";
import { DEFAULT_VOCAB, namespaceOf } from "../components/dialogue/grammar";
import { USER_ACTOR } from "./actor";

type Json = Record<string, unknown>;

/** What the mock's "engine" evaluates, mirroring `MOCK_PACK_INFO`. */
const ENGINE_BLOCKS: Record<string, Record<string, unknown>> = {
  tree: { has_item: true, quest: { states: ["completed", "failed", "not_started"] }, flag: true },
  selector: { quest: { states: ["completed", "failed", "not_started"] } },
  effects: { gives_item: true, takes_item: true, gives_quest: true, advance_quest: true },
};

const MOCK_NPC: NpcRow = {
  id: "1023",
  name: "Whisper-Tam",
  quest_id: "q_whisper_signal",
  opening_greeting: "…the metal is singing again.",
  exhausted_dialogue: "Tam turns back to the wall and listens.",
  max_exchanges: 5,
  dialogue_trees: [
    {
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
          prompt:
            "The voices from above sing in frequencies beyond flesh… but their song speaks of unity, not this… this brutality.",
          choices: [
            {
              text: "What do the voices tell you?",
              next_node_id: "voices",
              conditions: [],
              effects: [],
            },
            {
              text: "The Chain says you speak heresy.",
              next_node_id: "heresy",
              conditions: [],
              effects: [],
            },
          ],
          tags: [],
        },
        voices: {
          node_id: "voices",
          speaker: null,
          prompt:
            "Signal-pattern-seven-seven… harmony not hierarchy… The metal whispers truth — they seek convergence, not conquest.",
          choices: [
            { text: "What is the true message?", next_node_id: null, conditions: [], effects: [] },
            {
              text: "I recovered your resonance shard.",
              next_node_id: "reward",
              conditions: ["has_item:item_resonance_shard", "quest:q_whisper_signal:active"],
              effects: ["takes_item:item_resonance_shard", "advance_quest:q_whisper_signal"],
            },
            {
              text: "Wait for the night transmission with me.",
              next_node_id: null,
              conditions: ["time:night"],
              effects: ["set_flag:heard_true_signal"],
            },
          ],
          tags: [],
        },
        heresy: {
          node_id: "heresy",
          speaker: null,
          prompt: "Heresy? The resonance speaks clearly through copper-song and steel-dreams.",
          choices: [
            {
              text: "Tell me more about the signal.",
              next_node_id: null,
              conditions: [],
              effects: [],
            },
          ],
          tags: [],
        },
        reward: {
          node_id: "reward",
          speaker: null,
          prompt: "The shard sings its way home. You have heard what the Prophet buried.",
          choices: [],
          tags: [],
        },
      },
    },
    {
      tree_id: "1023:night",
      character_id: "1023",
      label: "night vigil",
      axis: "time",
      selector: { rows: ["time:night"] },
      rank: 0,
      entry_node_id: "start",
      nodes: {
        start: {
          node_id: "start",
          speaker: null,
          prompt: "Quiet. The transmission comes at the turn of the hour.",
          choices: [{ text: "I'll wait.", next_node_id: null, conditions: [], effects: [] }],
          tags: [],
        },
      },
    },
  ],
};

/** A second character, so the QUEST scope has two lanes to cross and the
 *  multi-NPC batch save has something real to batch (step 11). Rust-Kell's
 *  tree is quest-gated, which is the axis today's engine partially evaluates. */
const MOCK_NPC_2: NpcRow = {
  id: "1041",
  name: "Rust-Kell",
  quest_id: "q_whisper_signal",
  opening_greeting: "Third gantry sings before it gives.",
  dialogue_trees: [
    {
      tree_id: "1041:default",
      character_id: "1041",
      label: "default",
      axis: null,
      selector: null,
      rank: 999,
      entry_node_id: "start",
      nodes: {
        start: {
          node_id: "start",
          speaker: null,
          prompt: "Third gantry sings before it gives. Whatever you're digging for is under it.",
          choices: [
            {
              text: "Show me the gantry.",
              next_node_id: null,
              conditions: ["quest:q_whisper_signal:active"],
              effects: ["gives_item:item_resonance_shard"],
            },
          ],
          tags: [],
        },
      },
    },
  ],
};

/** One `type: "scene"` event row — the Bonefield Confession from board 08.
 *  It is an EVENT, not a tree: three NPC surfaces and one quest read it. */
const MOCK_SCENE: Json = {
  id: "evt_3120",
  type: "scene",
  name: "The Bonefield Confession",
  description: "",
  title: "The Bonefield Confession",
  actors: [
    { character_id: "1023", required: true },
    { character_id: "1041", required: false },
  ],
  settings: ["quest:q_whisper_signal:active", "room:room_2", "time:night"],
  trigger: "enter_room",
  once: true,
  on_finish: ["set_flag:heard_confession"],
  lines: [
    {
      k: "line",
      n: 1,
      speaker: "1023",
      text: "The Prophet's frequency is a translation, not a transmission. Someone chose the words.",
      conditions: [],
    },
    {
      k: "line",
      n: 2,
      speaker: "1041",
      text: "Third gantry sang all night. I stopped calling it wind about a year ago.",
      conditions: ["actor:1041:present"],
    },
  ],
};

/** The mutable store — a save round-trips exactly the way canon's does. */
const npcs: Record<string, NpcRow> = {
  "1023": structuredClone(MOCK_NPC),
  "1041": structuredClone(MOCK_NPC_2),
};
const scenes: Record<string, Json> = { evt_3120: structuredClone(MOCK_SCENE) };

export function mockSceneRow(id: string): Json | null {
  return scenes[id] ? structuredClone(scenes[id]) : null;
}
export function mockSceneRefs(): { type_id: string; id: string; name: string }[] {
  return Object.values(scenes).map((s) => ({
    type_id: "events",
    id: String(s.id),
    name: String(s.title ?? s.id),
  }));
}

export function mockNpcRow(id: string): NpcRow | null {
  return npcs[id] ? structuredClone(npcs[id]) : null;
}
export function mockNpcRefs(): { type_id: string; id: string; name: string }[] {
  return Object.values(npcs).map((n) => ({
    type_id: "npcs",
    id: String(n.id),
    name: String(n.name ?? n.id),
  }));
}

function docOf(npcId: string): AuthorDoc {
  const row = npcs[npcId];
  if (!row) throw new Error(`no NPC ${npcId} in the mock world`);
  return toAuthorDoc(row, { npcId, vocab: DEFAULT_VOCAB });
}

// ---------------------------------------------------------------------------
// Token evaluation — the mock's copy of canon's ONE evaluator
// ---------------------------------------------------------------------------

type State = Json;

function section(state: State, key: string): Json {
  const value = state[key];
  return value && typeof value === "object" ? (value as Json) : {};
}

function engineEvaluable(token: string, scope: string): { ok: boolean; reason: string | null } {
  const ns = namespaceOf(token);
  const scoped = ENGINE_BLOCKS[scope];
  if (!scoped || !(ns in scoped)) {
    return {
      ok: false,
      reason: `the engine does not evaluate '${ns}' at ${scope} scope — the gate is ignored and the choice shows unconditionally in game`,
    };
  }
  const narrowing = scoped[ns];
  if (narrowing && typeof narrowing === "object") {
    const parts = token.split(":");
    const states = (narrowing as { states?: string[] }).states;
    if (Array.isArray(states) && parts.length >= 3 && !states.includes(parts[2])) {
      return {
        ok: false,
        reason: `the engine evaluates '${ns}' at ${scope} scope only for state in ${states.join(", ")} — '${parts[2]}' is outside that, so the gate is ignored`,
      };
    }
  }
  return { ok: true, reason: null };
}

function verdictOf(token: string, state: State): { pass: boolean; reason: string } {
  const [ns, ...rest] = token.split(":");
  switch (ns) {
    case "has_item": {
      const have = Number(section(state, "inventory")[rest[0]] ?? 0);
      return have > 0
        ? { pass: true, reason: "in inventory" }
        : { pass: false, reason: "not in inventory" };
    }
    case "quest": {
      const current = String(section(state, "quests")[rest[0]] ?? "not_started");
      return current === rest[1]
        ? { pass: true, reason: `quest is ${current}` }
        : { pass: false, reason: `quest is ${current}, not ${rest[1]}` };
    }
    case "flag": {
      const value = section(state, "flags")[rest[0]];
      const wanted = rest[1] === undefined ? true : rest[1] === "true";
      return Boolean(value) === wanted
        ? { pass: true, reason: `${wanted}` }
        : { pass: false, reason: `flag is ${String(Boolean(value))}` };
    }
    case "time": {
      const window = String(section(state, "clock")["window"] ?? "");
      return window === rest[0]
        ? { pass: true, reason: `clock is ${window}` }
        : { pass: false, reason: `clock is ${window || "unset"}, not ${rest[0]}` };
    }
    case "segment": {
      const current = state.segment == null ? "" : String(state.segment);
      return current === rest[0]
        ? { pass: true, reason: `segment is ${current}` }
        : { pass: false, reason: `segment is ${current || "unset"}` };
    }
    case "room": {
      const current = state.room == null ? "" : String(state.room);
      return current === rest[0]
        ? { pass: true, reason: "in this room" }
        : { pass: false, reason: `in ${current || "no room"}` };
    }
    case "scene": {
      const seen = Array.isArray(state.scenes_seen) ? (state.scenes_seen as string[]) : [];
      const isSeen = seen.includes(rest[0]);
      return (rest[1] === "seen") === isSeen
        ? { pass: true, reason: rest[1] ?? "seen" }
        : { pass: false, reason: isSeen ? "already seen" : "not seen yet" };
    }
    case "event": {
      const status = String(section(state, "events")[rest[0]] ?? "unsolved");
      return status === rest[1]
        ? { pass: true, reason: status }
        : { pass: false, reason: `event is ${status}` };
    }
    case "player": {
      const actual = Number(section(state, "player")[rest[0]]);
      const wanted = Number(rest[2]);
      const ops: Record<string, (a: number, b: number) => boolean> = {
        "<": (a, b) => a < b,
        "<=": (a, b) => a <= b,
        "==": (a, b) => a === b,
        ">=": (a, b) => a >= b,
        ">": (a, b) => a > b,
      };
      const fn = ops[rest[1]];
      if (!fn || Number.isNaN(actual)) {
        return { pass: false, reason: `player.${rest[0]} is not set in the simulated state` };
      }
      return fn(actual, wanted)
        ? { pass: true, reason: `${actual} ${rest[1]} ${wanted}` }
        : { pass: false, reason: `${actual} is not ${rest[1]} ${wanted}` };
    }
    default:
      return { pass: false, reason: `unknown namespace '${ns}'` };
  }
}

function evaluate(tokens: string[], state: State, scope: string) {
  const conditions = tokens.map((token) => {
    const { pass, reason } = verdictOf(token, state);
    const engine = engineEvaluable(token, scope);
    return {
      token,
      namespace: namespaceOf(token),
      operands: token.split(":").slice(1),
      pass,
      reason,
      verdict: engine.ok ? (pass ? "pass" : "fail") : "unevaluable",
      engine_evaluable: engine.ok,
      engine_reason: engine.reason,
    };
  });
  const failing = conditions.find((c) => !c.pass) ?? null;
  return {
    pass: conditions.every((c) => c.pass),
    conditions,
    failing_condition: failing?.token ?? null,
    failing_reason: failing ? `${failing.token} — ${failing.reason}` : null,
    unevaluable: conditions.filter((c) => !c.engine_evaluable).map((c) => c.token),
  };
}

function describe(token: string, scope: string, kind: "condition" | "effect") {
  const engine = engineEvaluable(token, kind === "effect" ? "effects" : scope);
  return {
    token,
    namespace: namespaceOf(token),
    operands: token.split(":").slice(1),
    kind,
    slots: {},
    legal: true,
    reason: null,
    engine_evaluable: engine.ok,
    engine_reason: engine.reason,
    unresolved: null,
  };
}

function normalizeState(raw: unknown): State {
  const src = (raw && typeof raw === "object" ? raw : {}) as Json;
  return {
    inventory: section(src, "inventory"),
    quests: section(src, "quests"),
    clock: section(src, "clock"),
    room: src.room ?? null,
    player: section(src, "player"),
    flags: section(src, "flags"),
    segment: src.segment ?? null,
    scenes_seen: Array.isArray(src.scenes_seen) ? src.scenes_seen : [],
    events: section(src, "events"),
    actors: section(src, "actors"),
  };
}

// ---------------------------------------------------------------------------
// The five verbs
// ---------------------------------------------------------------------------

export function dialogueShow(npcId: string): Json {
  const doc = docOf(npcId);
  const row = npcs[npcId];
  const { claims, warnings } = laneProjection(doc.trees, DEFAULT_VOCAB);
  return {
    npc: npcId,
    name: row.name ?? null,
    quest_id: row.quest_id ?? null,
    source: Array.isArray(row.dialogue_trees) ? "dialogue_trees" : "legacy",
    storage_field: "dialogue_trees",
    legacy_fields: DEFAULT_VOCAB.storage.legacy_fields,
    legacy_written: Object.values(claims).sort(),
    engine: { id: "godot", evaluable_namespaces: ENGINE_BLOCKS },
    selector_axes: DEFAULT_VOCAB.selector_axes,
    trees: doc.trees.map((tree) => ({
      tree_id: tree.tree_id,
      label: tree.label,
      axis: tree.axis,
      rank: tree.rank,
      selector:
        tree.selector === null
          ? null
          : { rows: tree.selector.rows.map((r) => describe(r, "selector", "condition")) },
      fallback: tree.selector === null,
      entry_node_id: tree.entry_node_id,
      nodes: Object.keys(tree.nodes).length,
      choices: Object.values(tree.nodes).reduce((n, node) => n + node.choices.length, 0),
      terminal_nodes: Object.values(tree.nodes)
        .filter((n) => n.choices.length === 0)
        .map((n) => n.node_id)
        .sort(),
      gates: Object.values(tree.nodes).flatMap((node) =>
        node.choices
          .map((choice, index) => ({ choice, index }))
          .filter((c) => c.choice.conditions.length || c.choice.effects.length)
          .map((c) => ({
            node_id: node.node_id,
            choice: c.index,
            text: c.choice.text,
            conditions: c.choice.conditions.map((t) => describe(t, "tree", "condition")),
            effects: c.choice.effects.map((t) => describe(t, "tree", "effect")),
          })),
      ),
      legacy_slot: claims[tree.tree_id] ?? null,
    })),
    scenes: scenesFor(npcId),
    warnings,
  };
}

export function dialogueValidate(npcId: string): Json {
  const doc = docOf(npcId);
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const tree of doc.trees) {
    if (!(tree.entry_node_id in tree.nodes)) {
      errors.push(`tree '${tree.tree_id}' has no entry node '${tree.entry_node_id}'`);
    }
    for (const orphan of unreachableNodes(tree)) {
      warnings.push(`tree '${tree.tree_id}': node '${orphan}' is unreachable from the entry`);
    }
    for (const dangling of danglingChoices(tree)) {
      warnings.push(
        `tree '${tree.tree_id}': ${dangling.node_id}[${dangling.index}] points at '${dangling.target}', which this tree does not have`,
      );
    }
    for (const row of tree.selector?.rows ?? []) {
      const engine = engineEvaluable(row, "selector");
      if (!engine.ok) warnings.push(`tree '${tree.tree_id}': ${engine.reason}`);
    }
  }
  warnings.push(...laneProjection(doc.trees, DEFAULT_VOCAB).warnings);
  return { npc: npcId, source: "dialogue_trees", trees: doc.trees.length, errors, warnings };
}

export function dialogueUpdate(npcId: string, ops: EditOp[]): Json {
  const doc = docOf(npcId);
  const next = applyOps(doc, ops);
  const validation = dialogueValidate(npcId) as { errors: string[] };
  if (validation.errors.length) {
    throw new Error(`dialogue update refused (fail-closed): ${validation.errors.join("; ")}`);
  }
  const row = npcs[npcId];
  const ordered = [...next.trees].sort(
    (a, b) => a.rank - b.rank || a.tree_id.localeCompare(b.tree_id),
  );
  row.dialogue_trees = ordered;
  const { slots, warnings } = laneProjection(ordered, DEFAULT_VOCAB);
  for (const field of DEFAULT_VOCAB.storage.legacy_fields ?? []) {
    if (field in slots) (row as Json)[field] = slots[field];
    else delete (row as Json)[field];
  }
  return {
    npc: npcId,
    source: "dialogue_trees",
    ops: ops.map((op, i) => ({ i, k: op.k, target: "", changed: {} })),
    trees: ordered,
    legacy_written: Object.keys(slots),
    changed: ops.length > 0,
    no_change: ops.length === 0,
    warnings,
    before_hash: "mock-before",
    after_hash: "mock-after",
  };
}

export function dialogueTest(
  tree: AuthorTree,
  rawState: unknown,
  nodeId: string | null,
  choose: number | null,
): Json {
  const state = normalizeState(rawState);
  const nodes = tree.nodes ?? {};
  const current = nodeId ?? tree.entry_node_id ?? "start";
  if (!(current in nodes)) {
    throw new Error(`tree '${tree.tree_id}' has no node '${current}'`);
  }
  const node = nodes[current];
  const choices = node.choices.map((choice, index) => ({
    index,
    text: choice.text,
    next_node_id: choice.next_node_id,
    dangling: !!choice.next_node_id && !(choice.next_node_id in nodes),
    effects: choice.effects.map((t) => describe(t, "tree", "effect")),
    ...evaluate(choice.conditions, state, "tree"),
  }));
  const gates = { pass: 0, fail: 0, unevaluable: 0, error: 0 } as Record<string, number>;
  for (const c of choices) for (const cond of c.conditions) gates[cond.verdict] += 1;
  const out: Json = {
    tree_id: tree.tree_id,
    entry_node_id: tree.entry_node_id,
    node: {
      node_id: current,
      speaker: node.speaker ?? tree.character_id,
      prompt: node.prompt,
      terminal: node.choices.length === 0,
    },
    choices,
    gates,
    state,
    post_effect_state: state,
    fired: [],
    chose: null,
    next_node_id: null,
  };
  if (choose === null) return out;
  const picked = choices[choose];
  if (!picked) throw new Error(`--choose ${choose} is outside 0..${choices.length - 1}`);
  out.chose = choose;
  if (!picked.pass) {
    out.refused = `choice ${choose} is blocked: ${picked.failing_reason} (blocked by 1 of ${picked.conditions.length} conditions)`;
    return out;
  }
  const post = normalizeState(state);
  const fired: Json[] = [];
  for (const token of node.choices[choose].effects) {
    const [ns, ...rest] = token.split(":");
    const engine = engineEvaluable(token, "effects");
    let detail = "applied";
    if (ns === "gives_item") {
      const inv = post.inventory as Json;
      inv[rest[0]] = Number(inv[rest[0]] ?? 0) + 1;
      detail = `${rest[0]} added`;
    } else if (ns === "takes_item") {
      const inv = post.inventory as Json;
      const have = Number(inv[rest[0]] ?? 0);
      inv[rest[0]] = Math.max(0, have - 1);
      detail = have > 0 ? `${rest[0]} removed` : `${rest[0]} was not in the bag`;
    } else if (ns === "gives_quest") {
      (post.quests as Json)[rest[0]] = "active";
      detail = "quest offered";
    } else if (ns === "advance_quest") {
      (post.quests as Json)[rest[0]] = rest[1] ?? "completed";
      detail = `quest → ${rest[1] ?? "completed"}`;
    } else if (ns === "set_flag") {
      (post.flags as Json)[rest[0]] = rest[1] === undefined ? true : rest[1] === "true";
      detail = `flag ${rest[0]} set`;
    }
    fired.push({
      token,
      namespace: ns,
      applied: true,
      detail,
      engine_evaluable: engine.ok,
      engine_reason: engine.reason,
    });
  }
  out.fired = fired;
  out.post_effect_state = post;
  out.next_node_id = picked.dangling ? null : picked.next_node_id;
  return out;
}

export function dialogueSelect(npcId: string, rawState: unknown): Json {
  const doc = docOf(npcId);
  const state = normalizeState(rawState);
  const ordered = [...doc.trees].sort(
    (a, b) => a.rank - b.rank || a.tree_id.localeCompare(b.tree_id),
  );
  const { claims, warnings } = laneProjection(ordered, DEFAULT_VOCAB);
  let selected: string | null = null;
  let enginePick: string | null = null;
  const rows = ordered.map((tree) => {
    const verdict =
      tree.selector === null
        ? { pass: true, conditions: [], failing_reason: null, unevaluable: [] as string[] }
        : evaluate(tree.selector.rows, state, "selector");
    const blind = verdict.conditions.filter((c) => !c.engine_evaluable);
    let status: string;
    let why: string | null = null;
    if (selected === null && verdict.pass) {
      selected = tree.tree_id;
      status = "selected";
    } else if (!verdict.pass) {
      status = "blocked";
      why = `blocked by ${verdict.failing_reason}`;
    } else {
      status = "shadowed";
      why = `a higher-ranked tree (${selected}) matched first`;
    }
    if (enginePick === null && blind.length === 0 && verdict.pass) enginePick = tree.tree_id;
    return {
      tree_id: tree.tree_id,
      label: tree.label,
      axis: tree.axis,
      rank: tree.rank,
      fallback: tree.selector === null,
      selector: tree.selector,
      status,
      would_play: status === "selected",
      rows: verdict.conditions,
      why_not: why,
      engine_blind_rows: blind.map((c) => c.token),
      legacy_slot: claims[tree.tree_id] ?? null,
    };
  });
  const diverges = enginePick !== selected;
  return {
    npc: npcId,
    source: "dialogue_trees",
    selected,
    selected_label: rows.find((r) => r.tree_id === selected)?.label ?? null,
    trees: rows,
    engine: {
      id: "godot",
      selected: enginePick,
      legacy_slot: enginePick ? (claims[enginePick] ?? null) : null,
      diverges,
      reason: diverges
        ? `the engine cannot evaluate every selector row above '${selected}', so it falls through to '${enginePick}' while the tester picks '${selected}' — author freely, the runtime lags (doctrine 10)`
        : null,
    },
    state,
    warnings,
  };
}

/** Which scenes list *npcId* as an actor — the rail's "scenes" section, and
 *  the quest surface's scene blocks. Scenes are REFERENCED, never embedded. */
function scenesFor(npcId: string) {
  return Object.values(scenes)
    .filter((scene) =>
      (Array.isArray(scene.actors) ? scene.actors : []).some(
        (a) => String((a as Json).character_id) === npcId,
      ),
    )
    .map((scene) => {
      const actors = (Array.isArray(scene.actors) ? scene.actors : []) as Json[];
      return {
        id: String(scene.id),
        title: String(scene.title ?? scene.id),
        actors: actors.map((a) => String(a.character_id)),
        required: actors.filter((a) => a.required).map((a) => String(a.character_id)),
        lines: Array.isArray(scene.lines) ? scene.lines.length : 0,
        trigger: String(scene.trigger ?? ""),
      };
    });
}

// ---------------------------------------------------------------------------
// Improve (step 13) and the three scene verbs (step 12)
// ---------------------------------------------------------------------------

/** canon's deterministic copy pass, mirrored: trailing whitespace, doubled
 *  spaces and a missing sentence-ending mark. `(after, why)` or null. */
function tidy(text: string): [string, string] | null {
  let after = text.replace(/[ \t]{2,}/g, " ").trim();
  const reasons: string[] = [];
  if (after !== text) reasons.push("trimmed stray whitespace");
  if (after && !".!?…\"'”’)".includes(after[after.length - 1])) {
    after += ".";
    reasons.push("added the missing sentence-ending mark");
  }
  if (after === text) return null;
  return [after, reasons.join(" and ")];
}

/** `canon dialogue improve` — a PROPOSAL. The mock NEVER calls a provider:
 *  doctrine 3 says paid legs are the user's to run, so `none`/`fake` answer
 *  with the deterministic rows and any other id answers with an empty proposal
 *  and says why, rather than pretending to have run one. */
export function dialogueImprove(npcId: string, opts: Json): Json {
  const doc = docOf(npcId);
  const scope = String(opts.scope ?? "tree");
  const treeId = opts.treeId ? String(opts.treeId) : (doc.trees[0]?.tree_id ?? "");
  const scopeTrees = scope === "npc" ? doc.trees.map((t) => t.tree_id) : [treeId].filter(Boolean);
  const backend = String(opts.backend ?? "none") || "none";
  const free = backend === "none" || backend === "fake";
  const rows: Json[] = [];
  if (free) {
    for (const tree of doc.trees) {
      if (!scopeTrees.includes(tree.tree_id)) continue;
      for (const nodeId of Object.keys(tree.nodes).sort()) {
        const node = tree.nodes[nodeId];
        const fix = tidy(node.prompt);
        if (fix) {
          rows.push({
            target: `tree:${tree.tree_id}/node:${nodeId}`,
            tree: tree.tree_id,
            node_id: nodeId,
            choice: null,
            field: "prompt",
            before: node.prompt,
            after: fix[0],
            why: fix[1],
          });
        }
        node.choices.forEach((choice, index) => {
          const cfix = tidy(choice.text);
          if (!cfix) return;
          rows.push({
            target: `tree:${tree.tree_id}/node:${nodeId}/choice:${index}`,
            tree: tree.tree_id,
            node_id: nodeId,
            choice: index,
            field: "text",
            before: choice.text,
            after: cfix[0],
            why: cfix[1],
          });
        });
      }
    }
  }
  return {
    npc: npcId,
    requested_by: USER_ACTOR,
    backend_note: free
      ? "no chat backend selected — this is the built-in deterministic copy pass (whitespace and sentence-ending marks only). Pick a backend for an LLM re-author."
      : `the dev mock never calls a provider: '${backend}' is a paid, user-run leg (doctrine 3), so this proposal is empty`,
    source: "dialogue_trees",
    scope,
    trees: scopeTrees,
    instruction: String(opts.instruction ?? ""),
    keep_structure: opts.keepStructure !== false,
    backend,
    proposal: { rows, count: rows.length },
    gen: { backend, model: null },
    cost: free ? { usd: 0, paid: false } : { usd: null, paid: true, note: "not run in the mock" },
    wrote: false,
    apply_with: "canon dialogue update --ops (node.prompt / choice.text)",
  };
}

function sceneDocOf(sceneId: string): SceneDoc {
  const row = scenes[sceneId];
  if (!row) throw new Error(`no scene ${sceneId} in the mock world`);
  return toSceneDoc(row, sceneId, DEFAULT_VOCAB);
}

export function sceneValidate(sceneId: string): Json {
  const doc = sceneDocOf(sceneId);
  const report = sceneReport(doc);
  const warnings = [...report.warnings];
  for (const token of doc.settings) {
    const engine = engineEvaluable(token, "scene");
    if (!engine.ok) warnings.push(`scene setting ${engine.reason}`);
  }
  return { scene: sceneId, lines: doc.lines.length, errors: report.errors, warnings };
}

export function sceneUpdate(
  sceneId: string | null,
  ops: EditOp[],
  create: boolean,
  title: string,
): Json {
  const id = sceneId ?? `evt_${3200 + Object.keys(scenes).length}`;
  if (!scenes[id]) {
    if (!create) throw new Error(`no scene ${id} in the mock world`);
    scenes[id] = {
      id,
      type: "scene",
      name: title || `Scene ${id}`,
      description: "",
      title: title || `Scene ${id}`,
      actors: [],
      settings: [],
      trigger: "enter_room",
      once: true,
      on_finish: [],
      lines: [],
    };
  }
  const next = applyOps(sceneDocOf(id), ops);
  const report = sceneReport(next);
  if (report.errors.length) {
    throw new Error(`scene update refused (fail-closed): ${report.errors.join("; ")}`);
  }
  scenes[id] = toSceneRow(next) as Json;
  return {
    scene: id,
    created: !sceneId,
    ops: ops.map((op, i) => ({ i, k: op.k })),
    row: structuredClone(scenes[id]),
    changed: ops.length > 0,
    no_change: ops.length === 0,
    warnings: (sceneValidate(id) as { warnings: string[] }).warnings,
    before_hash: "mock-before",
    after_hash: "mock-after",
  };
}

/** `canon scene test`, mirrored — the state carries ACTOR PRESENCE, an absent
 *  required actor cancels the scene, and an absent optional actor's lines are
 *  SKIPPED AND NAMED rather than silently dropped. */
export function sceneTest(raw: unknown, rawState: unknown): Json {
  const doc = toSceneDoc(raw, String((raw as Json)?.id ?? ""), DEFAULT_VOCAB);
  const state = normalizeState(rawState);
  const settings = evaluate(doc.settings, state, "scene");
  const absentRequired = doc.actors
    .filter((a) => a.required && section(state, "actors")[a.character_id] !== "present")
    .map((a) => a.character_id);
  const plays = settings.pass && absentRequired.length === 0;
  const gates: Json = { pass: 0, fail: 0, unevaluable: 0, error: 0 };
  const bump = (rows: { verdict: string }[]) => {
    for (const row of rows) gates[row.verdict] = Number(gates[row.verdict] ?? 0) + 1;
  };
  bump(settings.conditions);
  const transcript = doc.lines.map((line) => {
    if (line.k === "choice") {
      return {
        n: line.n,
        k: "choice",
        played: plays,
        options: line.options.map((option) => ({
          text: option.text,
          to: option.to,
          ...evaluate(option.conditions, state, "scene"),
        })),
      };
    }
    const verdict = evaluate(line.conditions, state, "scene");
    bump(verdict.conditions);
    const optional = doc.actors.some((a) => a.character_id === line.speaker && !a.required);
    const absent = line.speaker !== null && section(state, "actors")[line.speaker] !== "present";
    let skipped: string | undefined;
    if (!plays) {
      skipped = absentRequired.length
        ? `the scene does not play — required actor(s) ${absentRequired.join(", ")} absent`
        : `the scene's own gates fail: ${settings.failing_reason}`;
    } else if (absent && optional) {
      skipped = `line ${String(line.n).padStart(2, "0")} will be skipped — ${line.speaker} is absent`;
    } else if (!verdict.pass) {
      skipped = `line ${line.n} is gated: ${verdict.failing_reason}`;
    }
    return {
      n: line.n,
      k: "line",
      speaker: line.speaker,
      text: line.text,
      played: !skipped,
      ...(skipped ? { skipped_because: skipped } : {}),
      ...verdict,
    };
  });
  return {
    scene: doc.id,
    title: doc.title,
    plays,
    settings,
    blocked_by: plays
      ? null
      : absentRequired.length
        ? `required actor(s) ${absentRequired.join(", ")} absent`
        : settings.failing_reason,
    absent_required_actors: absentRequired,
    gates,
    transcript,
    on_finish: plays
      ? doc.on_finish.map((token) => {
          const engine = engineEvaluable(token, "effects");
          return {
            token,
            namespace: namespaceOf(token),
            applied: true,
            detail: "applied",
            engine_evaluable: engine.ok,
            engine_reason: engine.reason,
          };
        })
      : [],
    state,
    post_effect_state: state,
  };
}

/** Reset the mock world between tests. */
export function resetDialogueMock(): void {
  npcs["1023"] = structuredClone(MOCK_NPC);
  npcs["1041"] = structuredClone(MOCK_NPC_2);
  scenes.evt_3120 = structuredClone(MOCK_SCENE);
}

/** The legacy-import path, exercised so the mock can serve a legacy-only NPC
 *  too — the read-both shim must be reachable in the browser (I7). */
export function mockLegacyTrees(row: NpcRow, npcId: string): AuthorTree[] {
  return importLegacy(row, npcId, DEFAULT_VOCAB);
}
