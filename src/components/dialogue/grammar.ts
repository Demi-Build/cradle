// The dialogue vocabulary + token grammar, READ FROM `pack info`'s `dialogue`
// block (PLAN "Grammar"; canon `src/canon/dialogue/grammar.py`).
//
// EXTENDS: nothing in cradle spelled the dialogue vocabulary before this file.
// It is the TS mirror of canon's `canon.dialogue.grammar`, and every namespace,
// operand vocabulary, scope name, effect name and selector axis comes from the
// pack registry — `DialogueVocab` is what `canon pack info` already ships under
// `dialogue` (P.3.3 `DEFAULT_DIALOGUE_DATA`). Nothing here is a string-literal
// union: a template that adds a namespace adds DATA.
//
// Built across two build-order steps on purpose. Step 1 needs only the vocab
// reader and `formatToken` — the legacy→selector import assembles
// `quest:<id>:<state>` and "no component builds a token by concatenation"
// applies to the adapter too. Step 7 adds parse/shape/scope-legality/engine
// support on top; the module was never split in two.
//
// Deliberately absent, by row ownership: evaluating a token (canon's
// `dialogue.evaluator` — `canon dialogue test` is the ONE evaluator, the UI
// never re-implements gating); the `music` scope's namespace subset (W2.1).

import type { PackInfo } from "../../lib/invoke";

/** A condition/effect token: `<namespace>:<operand>[:<operand>…]`. Validated,
 *  never parsed for display — the raw string is what canon stores. */
export type Token = string;

/** One namespace's operand descriptor, verbatim from `pack info`. The KEYS
 *  present decide the arity (canon's table): `fields`+`ops` → 3 operands,
 *  `windows` → 1, `entity`[+`states`] → 1 or 2, `keys`[+`values`] → 1 or 2,
 *  `values` → 1. */
export type OperandDescriptor = {
  entity?: string;
  field?: string;
  states?: string[];
  windows?: string[];
  fields?: string[];
  ops?: string[];
  keys?: unknown;
  values?: string[];
  filter?: Record<string, unknown>;
  restrict_to?: string;
};

/** The `dialogue` block of `canon pack info` (P.4.6). */
export type DialogueVocab = {
  storage: { on?: string; field?: string; legacy_fields?: string[] };
  condition_namespaces: string[];
  scene_only_namespaces: string[];
  effects: string[];
  scopes: string[];
  operands: Record<string, OperandDescriptor>;
  selector_axes: string[];
  scene: { event_type?: string; triggers?: string[]; once?: boolean; on_finish?: string };
};

/** The core seed, mirroring canon's `DEFAULT_DIALOGUE_DATA` — used only when a
 *  world's `pack info` carries no `dialogue` block (a pre-registry pack, or a
 *  test fixture). NEVER "everything is legal": the seed is the same grammar
 *  every template starts from. */
export const DEFAULT_VOCAB: DialogueVocab = {
  storage: {
    on: "npc",
    field: "dialogue_trees",
    legacy_fields: [
      "dialogue_tree",
      "dialogue_tree_incomplete",
      "dialogue_tree_complete",
      "dialogue_tree_failed",
    ],
  },
  condition_namespaces: [
    "has_item",
    "quest",
    "time",
    "player",
    "flag",
    "segment",
    "room",
    "scene",
    "event",
  ],
  scene_only_namespaces: ["actor"],
  effects: ["gives_item", "takes_item", "gives_quest", "advance_quest", "set_flag"],
  scopes: ["tree", "selector", "scene", "effects", "music"],
  operands: {
    has_item: { entity: "item", field: "id" },
    quest: {
      entity: "quest",
      field: "id",
      states: ["not_started", "active", "completed", "failed"],
    },
    time: { windows: ["dawn", "day", "dusk", "night"] },
    player: {
      fields: [
        "level",
        "health",
        "max_health",
        "stamina",
        "money",
        "archetype",
        "STR",
        "DEX",
        "CON",
        "INT",
        "WIS",
        "CHA",
        "LUCK",
      ],
      ops: ["<", "<=", "==", ">=", ">"],
    },
    flag: { keys: "from set_flag effects", values: ["true", "false"] },
    segment: { values: [] },
    room: { entity: "room", field: "id" },
    scene: { entity: "event", field: "id", filter: { type: "scene" }, states: ["seen", "unseen"] },
    event: { entity: "event", field: "id", states: ["solved", "unsolved"] },
    actor: {
      entity: "npc",
      field: "id",
      restrict_to: "scene.actors",
      states: ["present", "absent"],
    },
  },
  selector_axes: ["quest", "segment", "time", "flag", "room", "scene", "player", "custom"],
  scene: {
    event_type: "scene",
    triggers: ["enter_room", "talk_any_actor", "quest_advance"],
    once: true,
    on_finish: "effects",
  },
};

function list(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : fallback;
}

/** The pack's dialogue vocabulary, or the core seed. `pack info` omits the
 *  block entirely when `dialogue` is not a declared capability (§5.1a), so a
 *  missing block is normal and never an error. */
export function vocabOf(packInfo: PackInfo | null | undefined): DialogueVocab {
  const raw = (packInfo?.dialogue ?? null) as Partial<DialogueVocab> | null;
  if (!raw || typeof raw !== "object") return DEFAULT_VOCAB;
  return {
    storage: { ...DEFAULT_VOCAB.storage, ...(raw.storage ?? {}) },
    condition_namespaces: list(raw.condition_namespaces, DEFAULT_VOCAB.condition_namespaces),
    scene_only_namespaces: list(raw.scene_only_namespaces, DEFAULT_VOCAB.scene_only_namespaces),
    effects: list(raw.effects, DEFAULT_VOCAB.effects),
    scopes: list(raw.scopes, DEFAULT_VOCAB.scopes),
    operands:
      raw.operands && typeof raw.operands === "object" ? raw.operands : DEFAULT_VOCAB.operands,
    selector_axes: list(raw.selector_axes, DEFAULT_VOCAB.selector_axes),
    scene: { ...DEFAULT_VOCAB.scene, ...(raw.scene ?? {}) },
  };
}

/** Does this pack declare a dialogue capability at all? Screens that need the
 *  vocabulary say so with a REASON rather than rendering an empty picker. */
export function hasDialogueCapability(packInfo: PackInfo | null | undefined): boolean {
  return Array.isArray(packInfo?.capabilities) && packInfo.capabilities.includes("dialogue");
}

/** `formatToken("quest", 4000, "active")` → `"quest:4000:active"` — the ONE
 *  place a token is assembled (canon's `format_token`; operands stringified
 *  verbatim). No component concatenates a token by hand. */
export function formatToken(namespace: string, ...operands: (string | number | null)[]): Token {
  return [namespace, ...operands.filter((o) => o !== null).map((o) => String(o))].join(":");
}

/** A token's namespace — the part before the first `:`. Cheap enough to be the
 *  one thing a renderer may do without a full parse. */
export function namespaceOf(token: Token): string {
  const at = token.indexOf(":");
  return at < 0 ? token : token.slice(0, at);
}

// ---------------------------------------------------------------------------
// The legacy four-field mapping (canon `dialogue.storage`, §7.1)
// ---------------------------------------------------------------------------

function slotSuffix(base: string, name: string): string {
  return name.startsWith(`${base}_`) ? name.slice(base.length + 1) : name;
}

/** Which legacy key a `quest:<id>:<state>` selector maps onto — DERIVED from
 *  the field names themselves, exactly as canon's `legacy_slot_for_state`
 *  does: the first variant slot whose suffix prefixes the state (`complete` →
 *  `completed`), else the residual slot the engine shows while the quest is
 *  unresolved. Never a hardcoded pair. */
export function legacySlotForState(state: string, legacyFields: string[]): string {
  if (legacyFields.length === 0) return "";
  const [base, ...variants] = legacyFields;
  for (const name of variants) {
    if (state.startsWith(slotSuffix(base, name))) return name;
  }
  return variants[0] ?? base;
}

/** The inverse — the quest state a legacy slot stands for, taken as the LAST
 *  pack state that maps to it (`not_started`/`active` both map to the
 *  incomplete slot; `active` is the one the engine is in once the quest is
 *  given). Mirrors canon's `state_for_slot`. */
export function stateForSlot(slot: string, vocab: DialogueVocab): string | null {
  const legacy = vocab.storage.legacy_fields ?? [];
  const states = vocab.operands.quest?.states ?? [];
  const matches = states.filter((s) => legacySlotForState(s, legacy) === slot);
  return matches.length ? matches[matches.length - 1] : null;
}

/** `dialogue_tree_complete` → `complete`. The tree's author label and the
 *  `<npc>:<suffix>` tree id both come from here. */
export function legacySuffix(slot: string, vocab: DialogueVocab): string {
  const legacy = vocab.storage.legacy_fields ?? [];
  return legacy.length ? slotSuffix(legacy[0], slot) : slot;
}

// ---------------------------------------------------------------------------
// Parse / shape / scope legality / engine support  (build-order step 7)
// ---------------------------------------------------------------------------
// The TS mirror of canon's `parse_token` / `namespace_shape` / `legal_in` /
// `engine_evaluable`. It exists so a picker can refuse a token BEFORE it is
// authored and a row can render the right controls — not so the UI can decide
// anything canon decides. Canon re-parses everything fail-closed at save.

/** A parsed token: its namespace, positional operands and the named slots the
 *  picker and the row controls read. */
export type ParsedToken = {
  token: Token;
  namespace: string;
  operands: string[];
  kind: "condition" | "effect";
  slots: Record<string, string>;
};

export type ParseError = { token: string; namespace: string; error: string; slot?: string };

export type FieldSpec = {
  name: string;
  required: boolean;
  choices?: string[];
  /** The entity kind to pick from — drives `EntityPicker`'s tab. */
  entity?: string;
  field?: string;
  filter?: Record<string, unknown>;
  restrict_to?: string;
};

/** The effect → condition-descriptor join (canon's `EFFECT_OPERAND_OF`): an
 *  effect names the namespace whose operand vocabulary it writes to, so
 *  `gives_item:2000` validates against the same item table as `has_item:2000`.
 *  A table, not a concatenation. */
export const EFFECT_OPERAND_OF: Record<string, string> = {
  gives_item: "has_item",
  takes_item: "has_item",
  gives_quest: "quest",
  advance_quest: "quest",
  set_flag: "flag",
};

/** The two effects whose trailing operand is OPTIONAL. */
export const OPTIONAL_TAIL_EFFECTS = new Set(["advance_quest", "set_flag"]);

/** `null` when *namespace* is legal at *scope*, else THE REASON. Three named
 *  refusals, never a bare false — an unknown scope, a scene-only namespace
 *  outside a scene, and an unknown namespace (which lists the legal set). */
export function legalIn(namespace: string, scope: string, vocab: DialogueVocab): string | null {
  if (!vocab.scopes.includes(scope)) {
    return `unknown scope '${scope}' — this pack declares ${vocab.scopes.join(", ")}`;
  }
  if (vocab.scene_only_namespaces.includes(namespace)) {
    return scope === "scene"
      ? null
      : `'${namespace}' is legal only in scene scope (a ${scope} has no actor roster) — ` +
          `scene-only namespaces are ${vocab.scene_only_namespaces.join(", ")}`;
  }
  if (vocab.condition_namespaces.includes(namespace)) return null;
  return (
    `unknown condition namespace '${namespace}' — this pack declares ` +
    `${vocab.condition_namespaces.join(", ")} (+ scene-only ${vocab.scene_only_namespaces.join(", ")})`
  );
}

/** The ordered operand slots for *namespace*, DERIVED from its descriptor's own
 *  keys — never a hardcoded arity. A template that adds a namespace adds data. */
export function namespaceShape(namespace: string, vocab: DialogueVocab): FieldSpec[] {
  const d = vocab.operands[namespace];
  if (!d) return [{ name: "operand", required: true }];
  if (d.fields && d.ops) {
    return [
      { name: "field", required: true, choices: [...d.fields] },
      { name: "op", required: true, choices: [...d.ops] },
      { name: "value", required: true },
    ];
  }
  if (d.windows) return [{ name: "window", required: true, choices: [...d.windows] }];
  if (d.entity) {
    const slots: FieldSpec[] = [
      {
        name: "entity_id",
        required: true,
        entity: d.entity,
        field: d.field ?? "id",
        filter: d.filter,
        restrict_to: d.restrict_to,
      },
    ];
    if (d.states?.length) slots.push({ name: "state", required: true, choices: [...d.states] });
    return slots;
  }
  if (d.keys !== undefined) {
    const slots: FieldSpec[] = [{ name: "key", required: true }];
    if (d.values?.length) slots.push({ name: "value", required: false, choices: [...d.values] });
    return slots;
  }
  if (d.values) {
    // `segment` seeds an EMPTY value list: a legal namespace with no operand
    // vocabulary yet, so the slot must not narrow on an empty list.
    const slot: FieldSpec = { name: "value", required: true };
    if (d.values.length) slot.choices = [...d.values];
    return [slot];
  }
  return [{ name: "operand", required: true }];
}

/** The operand slots of an EFFECT token, joined to the condition namespace
 *  whose vocabulary it writes. An effect outside the table takes one free
 *  operand — doctrine 10: an unknown token is a diagnostic, never a crash. */
export function effectShape(effect: string, vocab: DialogueVocab): FieldSpec[] {
  const source = EFFECT_OPERAND_OF[effect];
  if (!source) return [{ name: "operand", required: true }];
  let slots = namespaceShape(source, vocab).map((s) => ({ ...s }));
  if (OPTIONAL_TAIL_EFFECTS.has(effect)) {
    if (slots.length > 1) slots[slots.length - 1].required = false;
    else if (source === "flag") {
      slots.push({
        name: "value",
        required: false,
        choices: vocab.operands.flag?.values ?? ["true", "false"],
      });
    }
  } else if (effect === "gives_quest") {
    slots = slots.slice(0, 1);
  } else {
    slots = slots.filter((s) => s.required);
  }
  return slots;
}

function fill(
  token: string,
  namespace: string,
  operands: string[],
  slots: FieldSpec[],
  kind: "condition" | "effect",
): ParsedToken | ParseError {
  const required = slots.filter((s) => s.required);
  if (operands.length < required.length || operands.length > slots.length) {
    const want = slots.map((s) => (s.required ? `:<${s.name}>` : `[:<${s.name}>]`)).join("");
    const arity =
      slots.length === required.length
        ? `${required.length}`
        : `${required.length}–${slots.length}`;
    return {
      token,
      namespace,
      error: `'${token}': ${namespace} takes ${arity} operand(s) — ${namespace}${want}`,
    };
  }
  const named: Record<string, string> = {};
  slots.forEach((slot, i) => {
    if (i >= operands.length) return;
    named[slot.name] = operands[i];
  });
  for (const slot of slots) {
    const value = named[slot.name];
    if (value === undefined) continue;
    if (slot.choices && slot.choices.length && !slot.choices.includes(value)) {
      return {
        token,
        namespace,
        slot: slot.name,
        error: `'${token}': ${slot.name} '${value}' is not in this pack's vocabulary ${slot.choices.join(", ")}`,
      };
    }
  }
  return { token, namespace, operands, kind, slots: named };
}

export function isParseError(value: ParsedToken | ParseError): value is ParseError {
  return "error" in value;
}

/** Parse ONE condition token at *scope*. Returns the reason rather than
 *  throwing: every refusal in this surface travels with its reason. */
export function parseToken(
  token: Token,
  scope: string,
  vocab: DialogueVocab,
): ParsedToken | ParseError {
  const parts = String(token).split(":");
  const namespace = (parts[0] ?? "").trim();
  if (!namespace) {
    return { token: String(token), namespace: "", error: `token '${token}' has no namespace` };
  }
  const reason = legalIn(namespace, scope, vocab);
  if (reason) return { token: String(token), namespace, error: reason };
  return fill(
    String(token),
    namespace,
    parts.slice(1).map((p) => p.trim()),
    namespaceShape(namespace, vocab),
    "condition",
  );
}

/** Parse ONE effect token. An effect the pack does not declare is a named
 *  error; a declared effect the join table does not know takes one operand. */
export function parseEffect(token: Token, vocab: DialogueVocab): ParsedToken | ParseError {
  const parts = String(token).split(":");
  const namespace = (parts[0] ?? "").trim();
  if (!vocab.effects.includes(namespace)) {
    return {
      token: String(token),
      namespace,
      error: `unknown effect '${namespace}' — this pack declares ${vocab.effects.join(", ")}`,
    };
  }
  return fill(
    String(token),
    namespace,
    parts.slice(1).map((p) => p.trim()),
    effectShape(namespace, vocab),
    "effect",
  );
}

// ---------------------------------------------------------------------------
// Engine support (the engine-lag layer's data — report, never enforce)
// ---------------------------------------------------------------------------

/** The `engine_evaluable_namespaces` block `pack info` carries for the primary
 *  engine, or `null`. A MISSING block means the manifest does not carry the
 *  field yet, and the PLAN's rule is to SKIP the engine-lag layer entirely
 *  rather than warn falsely — so `engineSupportsNamespace` reports "supported"
 *  when this returns `null`, and no warning is drawn. */
export function engineBlocks(
  packInfo: PackInfo | null | undefined,
): Record<string, Record<string, unknown>> | null {
  const raw = packInfo?.engine_evaluable_namespaces;
  return raw && typeof raw === "object" ? (raw as Record<string, Record<string, unknown>>) : null;
}

function scopeFor(kind: "condition" | "effect", scope: string): string {
  return kind === "effect" ? "effects" : scope;
}

/** The PRIMARY engine's id, from `pack info`'s `engines` list — the name every
 *  engine-lag warning says out loud ("mazeworld-py ignores them"). `null` when
 *  the pack declares no engine; callers fall back to "the engine", never to a
 *  hardcoded id. */
export function engineId(packInfo: PackInfo | null | undefined): string | null {
  const engines = packInfo?.engines;
  if (!Array.isArray(engines)) return null;
  const rows = engines as { id?: unknown; primary?: unknown }[];
  const primary = rows.find((e) => e.primary) ?? rows[0];
  const id = primary?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** The engine's name for prose. Never invents a version — `pack info` carries
 *  the id, and a made-up "0.3" would read as fact. */
export function engineLabel(packInfo: PackInfo | null | undefined): string {
  return engineId(packInfo) ?? "this pack's engine";
}

/** THE NAMESPACE-LEVEL question the PLAN names `engineSupports(ns, scope)`:
 *  does the target engine evaluate this namespace at this scope AT ALL?
 *
 *  It is the membership half of `engineVerdict` — which narrows further, per
 *  operand, once a whole token exists. Board 03's capabilities list, the tree
 *  banner and the `＋ condition` picker all ask this one, because they are
 *  reasoning about a namespace before any operand has been chosen.
 *
 *  Doctrine 10: this NEVER blocks and never hides a namespace. An engine that
 *  evaluates nothing at this scope makes every row amber — which is exactly
 *  what today's dungeon engine does, and it is correct rather than broken. */
export function engineSupportsNamespace(
  namespace: string,
  scope: string,
  packInfo: PackInfo | null | undefined,
): boolean {
  const blocks = engineBlocks(packInfo);
  // No block at all: the manifest does not carry the field yet, so the whole
  // engine-lag layer is skipped rather than warning falsely (PLAN "Grammar").
  if (!blocks) return true;
  return namespace in (blocks[scope] ?? {});
}

/** Why the engine ignores *namespace* at *scope*, in the design's own words —
 *  "authored, validated, not enforced in game". `null` when it is evaluated. */
export function namespaceLagReason(
  namespace: string,
  scope: string,
  packInfo: PackInfo | null | undefined,
): string | null {
  if (engineSupportsNamespace(namespace, scope, packInfo)) return null;
  const consequence =
    scope === "effects"
      ? "the effect never fires in game"
      : scope === "selector"
        ? "the engine skips this row and may play a different tree"
        : scope === "scene"
          ? "the scene triggers regardless in game"
          : "the gate is ignored and the choice shows unconditionally in game";
  return `${engineLabel(packInfo)} does not evaluate '${namespace}' at ${scope} scope — ${consequence}`;
}

/** Every namespace the pack DECLARES that this engine does NOT evaluate at
 *  *scope*, in the pack's own order. The tree banner names these. */
export function laggingNamespaces(
  vocab: DialogueVocab,
  packInfo: PackInfo | null | undefined,
  scope = "tree",
): string[] {
  const names =
    scope === "scene"
      ? [...vocab.condition_namespaces, ...vocab.scene_only_namespaces]
      : vocab.condition_namespaces;
  return names.filter((ns) => !engineSupportsNamespace(ns, scope, packInfo));
}

/** Does the target engine evaluate this token? `(evaluable, reason)` in two
 *  functions so a component can ask for either without building the other.
 *
 *  Doctrine 10: this NEVER blocks. It is the engine-lag layer's data — the
 *  editor warns loudly and never refuses a legal token. */
export function engineSupports(
  token: Token,
  kind: "condition" | "effect",
  packInfo: PackInfo | null | undefined,
  scope = "tree",
): boolean {
  return engineVerdict(token, kind, packInfo, scope).ok;
}

export function engineReasonFor(
  token: Token,
  kind: "condition" | "effect",
  packInfo: PackInfo | null | undefined,
  scope = "tree",
): string | null {
  return engineVerdict(token, kind, packInfo, scope).reason;
}

export function engineVerdict(
  token: Token,
  kind: "condition" | "effect",
  packInfo: PackInfo | null | undefined,
  scope = "tree",
): { ok: boolean; reason: string | null } {
  const blocks = engineBlocks(packInfo);
  const ns = namespaceOf(token);
  const at = scopeFor(kind, scope);
  const consequence =
    kind === "effect"
      ? "the effect never fires in game"
      : "the gate is ignored and the choice shows unconditionally in game";
  if (!blocks) {
    // The manifest does not carry the block yet. The PLAN's instruction is to
    // treat everything as supported and SKIP the engine-lag layer rather than
    // warn falsely — so this reports "supported" with no reason to show.
    return { ok: true, reason: null };
  }
  // The membership half is `engineSupportsNamespace` — ONE answer to "does the
  // engine know this namespace", shared with the banner and the capabilities
  // list so a dot and a banner can never disagree.
  if (!engineSupportsNamespace(ns, at, packInfo)) {
    return { ok: false, reason: namespaceLagReason(ns, at, packInfo) };
  }
  const scoped = blocks[at] ?? {};
  const narrowing = scoped[ns];
  if (narrowing && typeof narrowing === "object") {
    // PER NAMED SLOT, exactly as canon's `engine_evaluable` does: `states`
    // narrows the `state` slot, `windows` the `window` slot, `fields` the
    // `field` slot. Testing the LAST operand against every list agreed with
    // canon only while every narrowed slot happened to be final — a block
    // narrowing `player: {fields: [...]}` would have painted a false amber.
    // The slot names come from the pack's own descriptor (`namespaceShape`),
    // never a hardcoded arity.
    const operands = String(token).split(":").slice(1);
    const named: Record<string, string> = {};
    namespaceShape(ns, vocabOf(packInfo)).forEach((slot, i) => {
      if (i < operands.length) named[slot.name] = operands[i];
    });
    const rows = narrowing as Record<string, unknown>;
    for (const [slot, value] of Object.entries(named)) {
      const honoured = rows[`${slot}s`] ?? rows[slot];
      if (!Array.isArray(honoured) || honoured.length === 0) continue;
      if (!honoured.includes(value)) {
        return {
          ok: false,
          reason:
            `the engine evaluates '${ns}' at ${scopeFor(kind, scope)} scope only for ` +
            `${slot} in ${honoured.join(", ")} — '${value}' is outside that, so ${consequence}`,
        };
      }
    }
  }
  return { ok: true, reason: null };
}

/** Board 03's capabilities list: every namespace the pack declares, and whether
 *  the engine evaluates it. "Read from the pack registry, not hard-coded." */
export function engineCapabilityRows(
  vocab: DialogueVocab,
  packInfo: PackInfo | null | undefined,
  scope = "tree",
): { namespace: string; evaluated: boolean }[] {
  const names =
    scope === "scene"
      ? [...vocab.condition_namespaces, ...vocab.scene_only_namespaces]
      : vocab.condition_namespaces;
  return names.map((namespace) => ({
    namespace,
    evaluated: engineSupportsNamespace(namespace, scope, packInfo),
  }));
}

/** The entity type id a picker slot maps to. `pack info`'s `entities` keys are
 *  singular kinds (`item`, `quest`, `room`, `event`, `npc`) while the store
 *  caches by the plural type id the left nav uses, so this is the join —
 *  derived from `pack info` where it can be, and pluralised as the fallback. */
export function typeIdForEntity(kind: string, packInfo: PackInfo | null | undefined): string {
  const entities = packInfo?.entities ?? {};
  if (kind in entities) {
    const layout = (entities[kind] as { layout?: { type_id?: string } }).layout;
    if (layout?.type_id) return layout.type_id;
  }
  return kind.endsWith("s") ? kind : `${kind}s`;
}
