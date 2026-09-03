// The scene document and its adapters (PLAN "Scenes"; README screen 08).
//
// EXTENDS `model.ts`, which is the NPC scope's half of the same idea: one
// normalised authoring document per scope, read from the pack row, edited only
// through `EditOp`s, written only by canon. `AuthorDoc` is the character's; this
// is the scene's, and both live in the SAME keyed buffer (`npc:1023`,
// `scene:evt_3120`) so `⌘S`, `⌘Z` and the dirty chip are one implementation.
//
// A scene is NOT a tree with several speakers and NOT a lane: it is an EVENT of
// type `scene`, alongside `puzzle` and `choice` in `event/types.ts`, with its
// own actors, its own trigger gates and a life independent of any one
// participant's dialogue. Scenes are REFERENCED, never embedded — an NPC's rail
// lists the scenes they act in, a quest's rail lists the scenes its states
// reference. One store of truth, three readers.
//
// The shape mirrors canon's `canon.dialogue.scenes.normalize_scene` key for
// key, because canon is the only writer. Two keys ride along that are not part
// of the scene sub-shape — `name` and `description` — because the engine loads
// EVERY row of `events/events.json` through its Event model and that model
// requires them; a scene row without them fails the whole pack's registry load
// rather than being harmlessly ignored. canon's `blank_scene` explains it; this
// file keeps them so a round trip never drops them.
//
// `actor:<id>:present|absent` is the scene-only namespace. The grammar already
// refuses it outside a scene WITH THE REASON (`legalIn`), which is why nothing
// here re-checks scope: the one grammar answers for all three.

import { DEFAULT_VOCAB, type DialogueVocab, type Token } from "./grammar";

export type SceneActor = { character_id: string; required: boolean };

export type SceneLine =
  | { k: "line"; n: number; speaker: string | null; text: string; conditions: Token[] }
  | {
      k: "choice";
      n: number;
      options: { text: string; to: number | null; conditions: Token[] }[];
    };

/** One `type: "scene"` event row, normalised. `kind` is the buffer's
 *  discriminator — it is what lets one `applyOps` serve both documents without
 *  a second buffer implementation. It is NOT written to the pack. */
export type SceneDoc = {
  kind: "scene";
  id: string;
  type: string;
  name: string;
  description: string;
  title: string;
  actors: SceneActor[];
  settings: Token[];
  trigger: string;
  once: boolean;
  on_finish: Token[];
  lines: SceneLine[];
};

export function isSceneDoc(doc: unknown): doc is SceneDoc {
  return !!doc && typeof doc === "object" && (doc as { kind?: unknown }).kind === "scene";
}

/** Is this event row a scene? The event TYPE comes from the pack's own
 *  `dialogue.scene.event_type`, never the literal `"scene"` — a template may
 *  name it something else and the tab must still mount. */
export function isSceneRow(row: unknown, vocab: DialogueVocab = DEFAULT_VOCAB): boolean {
  if (!row || typeof row !== "object") return false;
  const wanted = vocab.scene.event_type ?? "scene";
  return String((row as { type?: unknown }).type ?? "") === wanted;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function tokens(value: unknown): Token[] {
  return Array.isArray(value) ? value.map((t) => String(t)) : [];
}

/** One event row as a `SceneDoc` — canon's `normalize_scene`, mirrored.
 *  Every key is present and typed; nothing the row already carries is
 *  rewritten. */
export function toSceneDoc(
  row: unknown,
  sceneId: string | number,
  vocab: DialogueVocab = DEFAULT_VOCAB,
): SceneDoc {
  const r = (row ?? {}) as Record<string, unknown>;
  const triggers = vocab.scene.triggers ?? [];
  const title = str(r.title) || str(r.name) || `Scene ${sceneId}`;
  const lines: SceneLine[] = [];
  const raw = Array.isArray(r.lines) ? r.lines : [];
  raw.forEach((line, position) => {
    if (!line || typeof line !== "object") return;
    const l = line as Record<string, unknown>;
    const n = Number(l.n ?? position + 1) || position + 1;
    if (String(l.k) === "choice") {
      lines.push({
        k: "choice",
        n,
        options: (Array.isArray(l.options) ? l.options : [])
          .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
          .map((o) => ({
            text: str(o.text),
            to: o.to === null || o.to === undefined ? null : Number(o.to),
            conditions: tokens(o.conditions),
          })),
      });
      return;
    }
    lines.push({
      k: "line",
      n,
      speaker: l.speaker === null || l.speaker === undefined ? null : String(l.speaker),
      text: str(l.text),
      conditions: tokens(l.conditions),
    });
  });
  return {
    kind: "scene",
    id: String(r.id ?? sceneId),
    type: str(r.type, vocab.scene.event_type ?? "scene"),
    name: str(r.name) || title,
    description: str(r.description),
    title,
    actors: (Array.isArray(r.actors) ? r.actors : [])
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        character_id: String(a.character_id ?? ""),
        required: a.required === undefined ? true : !!a.required,
      })),
    settings: tokens(r.settings),
    trigger: str(r.trigger) || triggers[0] || "enter_room",
    once: r.once === undefined ? (vocab.scene.once ?? true) : !!r.once,
    on_finish: tokens(r.on_finish),
    lines,
  };
}

/** The payload `canon scene test` walks — the UNSAVED buffer, so the tester
 *  tests what you just wrote. `kind` is dropped: it is cradle's buffer
 *  discriminator, not part of the row. */
export function toSceneRow(doc: SceneDoc): Record<string, unknown> {
  const { kind: _kind, ...row } = doc;
  void _kind;
  return row;
}

/** The insert POSITION that appends at the end. Lines are numbered 1..N and
 *  branch targets are line NUMBERS (`→ 07`), so canon renumbers after every
 *  structural line op and remaps every option's `to` with them
 *  (`canon.dialogue.ops._renumber`, mirrored in `ops.applySceneOne`). An append
 *  is the position past the last line, which is what this returns. */
export function nextLineNumber(doc: SceneDoc): number {
  return doc.lines.length + 1;
}

/** How many lines each actor speaks — the Actors list's `speaks 5`. */
export function lineCounts(doc: SceneDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of doc.lines) {
    if (line.k !== "line" || line.speaker === null) continue;
    out[line.speaker] = (out[line.speaker] ?? 0) + 1;
  }
  return out;
}

/** The local pre-flight, the sibling of `model.localReport`.
 *
 *  Same doctrine: `canon scene validate` reads what is on disk and is the
 *  authority; this answers "would this save?" for the unsaved buffer, and only
 *  checks what needs no pack lookup. An empty scene, a line with no speaker and
 *  an absent optional actor are all LEGAL — the two errors are a branch target
 *  that names no line and a required actor with no id. */
export function sceneReport(doc: SceneDoc): {
  errors: string[];
  warnings: string[];
  passed: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const passed: string[] = [];
  const numbers = new Set(doc.lines.map((l) => l.n));
  const actors = new Set(doc.actors.map((a) => a.character_id));
  let dangling = 0;

  for (const line of doc.lines) {
    if (line.k === "choice") {
      line.options.forEach((option, i) => {
        if (option.to !== null && !numbers.has(option.to)) {
          dangling += 1;
          errors.push(
            `line ${line.n} option ${i + 1} branches to line ${option.to}, which this scene does not have.`,
          );
        }
      });
      continue;
    }
    if (line.speaker !== null && !actors.has(line.speaker)) {
      warnings.push(
        `line ${line.n} is spoken by '${line.speaker}', who is not an actor — add them or the line never plays.`,
      );
    }
  }
  for (const actor of doc.actors) {
    if (!actor.character_id) errors.push("an actor row has no character id.");
  }
  if (doc.actors.length === 0) {
    warnings.push("no actors yet — a scene with no actors plays as narration only.");
  }
  if (doc.lines.length === 0) {
    warnings.push("no lines yet — the scene is legal and plays as an empty beat.");
  }
  if (dangling === 0) passed.push("every branch target names a line");
  if (errors.length === 0) passed.push("every actor has an id");
  passed.push(`${doc.settings.length} setting${doc.settings.length === 1 ? "" : "s"} carried`);
  return { errors, warnings, passed };
}
