// The selector-axis registry (PLAN "Selector axes"; README Q4).
//
// EXTENDS: the four hard-coded `dialogue_tree*` fields, which encoded quest
// state as the ONLY selection axis. One registry now drives four things — the
// rail's grouping, the `＋ New tree` axis picker, the condition-row shape and
// `engineSupports` — so adding an axis appears in all four.
//
// `AxisId` is a plain `string`, not a union: the axis list is DATA, read from
// `pack info`'s `dialogue.selector_axes`. `AXIS_META` supplies the human copy
// and the colour role for the axes the seed declares; an axis the pack adds
// that the table does not name still renders, with its own id as the label and
// the neutral colour — doctrine 4, a named fallback, never a hidden row.
//
// Deliberately absent, by row ownership: `engineSupports` (step 7, once the
// grammar can parse a token into a namespace + slots).

import type { DialogueVocab } from "./grammar";
import { orderedTrees, type AuthorDoc, type AuthorTree } from "./model";

/** A registered selector axis id — open data (`quest`, `time`, `custom`, or
 *  whatever a template adds). */
export type AxisId = string;

/** The colour role an axis paints with, in `tokens.css` terms. `--special` is
 *  the design's own choice for `segment`; the rest sit on the neutral rail
 *  colour so amber stays "this is yours to edit". */
export type AxisTone = "neutral" | "special" | "info";

export type AxisMeta = {
  id: AxisId;
  /** Rail group heading and picker row. */
  label: string;
  /** One line under the picker row — what this axis selects on. */
  hint: string;
  /** The condition namespace an axis row is authored in. `null` for `custom`,
   *  which takes an arbitrary token validated only by the grammar. */
  namespace: string | null;
  tone: AxisTone;
};

/** Copy + namespace for the seed's eight axes. Data, not a switch: an axis the
 *  pack declares that is missing here falls through to `axisMeta`'s default. */
export const AXIS_META: Record<AxisId, AxisMeta> = {
  quest: {
    id: "quest",
    label: "Quest state",
    hint: "plays while a quest sits in one state",
    namespace: "quest",
    tone: "neutral",
  },
  segment: {
    id: "segment",
    label: "Segment",
    hint: "plays during an act or chapter of the game",
    namespace: "segment",
    tone: "special",
  },
  time: {
    id: "time",
    label: "Time of day",
    hint: "plays inside a clock window",
    namespace: "time",
    tone: "neutral",
  },
  flag: {
    id: "flag",
    label: "World flag",
    hint: "plays once a flag is set",
    namespace: "flag",
    tone: "special",
  },
  room: {
    id: "room",
    label: "Room",
    hint: "plays where the conversation happens",
    namespace: "room",
    tone: "neutral",
  },
  scene: {
    id: "scene",
    label: "Scene seen",
    hint: "plays after a group scene has played",
    namespace: "scene",
    tone: "info",
  },
  player: {
    id: "player",
    label: "Player",
    hint: "plays for a class, level or stat range",
    namespace: "player",
    tone: "neutral",
  },
  custom: {
    id: "custom",
    label: "Custom",
    hint: "an author-named axis with any legal token",
    namespace: null,
    tone: "neutral",
  },
};

/** The group a tree with no selector sorts under. Not an axis — the fallback
 *  is the absence of one, and the rail says so in words. */
export const FALLBACK_GROUP = "default";

/** Meta for one axis, with a named fallback for an axis this build has no copy
 *  for (doctrine 4: it renders, labelled by its own id). */
export function axisMeta(axis: AxisId | null): AxisMeta {
  if (axis === null) {
    return {
      id: FALLBACK_GROUP,
      label: "Default",
      hint: "no selector — plays when no other tree matches",
      namespace: null,
      tone: "neutral",
    };
  }
  return (
    AXIS_META[axis] ?? {
      id: axis,
      label: axis,
      hint: `an axis this pack declares (${axis})`,
      namespace: axis,
      tone: "neutral",
    }
  );
}

/** Every axis this pack registers, in the pack's own order — the `＋ New tree`
 *  picker and the rail's group order. */
export function axesOf(vocab: DialogueVocab): AxisMeta[] {
  return vocab.selector_axes.map((id) => axisMeta(id));
}

/** Which axis a selector token belongs to. The axis whose `namespace` matches
 *  wins; anything else is `custom`, which is what `custom` is FOR. */
export function axisForNamespace(namespace: string, vocab: DialogueVocab): AxisId {
  for (const axis of vocab.selector_axes) {
    if (axisMeta(axis).namespace === namespace) return axis;
  }
  return vocab.selector_axes.includes("custom") ? "custom" : namespace;
}

export type TreeGroup = { id: string; label: string; trees: AuthorTree[] };

/** Trees grouped by their axis, in the pack's own axis order, with the
 *  fallback last. A tree whose axis the pack does not declare still gets a
 *  group — named by its own id (doctrine 4: it renders, labelled). */
export function groupTrees(doc: AuthorDoc, vocab: DialogueVocab): TreeGroup[] {
  const trees = orderedTrees(doc);
  const groups = new Map<string, AuthorTree[]>();
  for (const tree of trees) {
    const id = tree.axis ?? FALLBACK_GROUP;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(tree);
  }
  const order = [...axesOf(vocab).map((a) => a.id), FALLBACK_GROUP];
  const seen = new Set<string>();
  const out: TreeGroup[] = [];
  for (const id of order) {
    if (!groups.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: axisMeta(id === FALLBACK_GROUP ? null : id).label,
      trees: groups.get(id)!,
    });
  }
  for (const [id, list] of groups) {
    if (seen.has(id)) continue;
    out.push({ id, label: axisMeta(id).label, trees: list });
  }
  return out;
}
