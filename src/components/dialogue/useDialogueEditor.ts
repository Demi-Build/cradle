// The keyed edit buffers: undo/redo, dirty grouping, serialisation to the
// `EditOp` wire format (PLAN "Edit buffer and ops"; README §7 "Save model").
//
// EXTENDS: the app store, which already holds cross-surface editor state
// (level validation reports, agent conversations, the command registry). The
// buffers live there as a `dialogue` slice rather than in component state,
// because THE BUFFER IS SHARED: a quest-scope session opens a buffer for every
// participating NPC and `⌘S` flushes them all as one batch of per-NPC
// `canon dialogue update` calls, and a scene edit fans out across three
// surfaces. That is the only reason the buffer is a keyed map rather than a
// single object — do not simplify it away.
//
// A buffer is `{ base, ops, cursor }`. The rendered doc is
// `ops.slice(0, cursor).reduce(apply, base)`; undo/redo is CURSOR MOVEMENT, not
// inverse ops, so there is nothing to keep in sync. `⌘S` posts
// `ops.slice(0, cursor)` and, on success, replaces `base` and empties `ops`.
//
// Undo means two things and the UI says which (README §7): before save `⌘Z`
// walks this stack; after save it no longer reaches those edits and reverting
// is explicit, in History, driven by canon's journal. `undoReachesSave` is the
// flag the unsaved popover states that with.
//
// Step 12 widened `base` from `AuthorDoc` to `EditDoc` so a `scene:<id>` buffer
// holds a `SceneDoc` through the SAME undo stack, dirty list and save path. The
// buffer is generic in its document so a caller keeps the type it handed in;
// the store holds the union, because it holds every scope's buffers at once.

import { useCallback, useMemo } from "react";
import { useStore } from "../../store";
import {
  applyOps,
  opBucket,
  opLabel,
  opTarget,
  type BufferKey,
  type EditDoc,
  type EditOp,
  type OpBucket,
} from "./ops";

/** One character's (or scene's) unsaved work. `base` is whichever document the
 *  key names — an `AuthorDoc` for `npc:<id>`, a `SceneDoc` for `scene:<id>`.
 *  `applyOps` refuses a mismatched op by name, so one buffer serves both. */
export type DialogueBuffer<T extends EditDoc = EditDoc> = {
  /** The document as canon last returned it. */
  base: T;
  /** Every op authored this session, including redoable ones past `cursor`. */
  ops: EditOp[];
  /** How many of `ops` are currently applied. Undo/redo moves this. */
  cursor: number;
};

export function emptyBuffer<T extends EditDoc>(base: T): DialogueBuffer<T> {
  return { base, ops: [], cursor: 0 };
}

/** The ops that are actually applied — what `⌘S` ships. */
export function dirtyOps(buffer: DialogueBuffer): EditOp[] {
  return buffer.ops.slice(0, buffer.cursor);
}

/** The document as edited. Throws `OpError` only if a buffer was built by
 *  hand with an illegal op — every path that appends one applies it first. */
export function bufferDoc<T extends EditDoc>(buffer: DialogueBuffer<T>): T {
  return applyOps(buffer.base, dirtyOps(buffer));
}

export function canUndo(buffer: DialogueBuffer): boolean {
  return buffer.cursor > 0;
}
export function canRedo(buffer: DialogueBuffer): boolean {
  return buffer.cursor < buffer.ops.length;
}
export function isDirty(buffer: DialogueBuffer): boolean {
  return buffer.cursor > 0;
}

/** Append ops at the cursor. Anything past the cursor (the redo tail) is
 *  DROPPED — a new edit after an undo forks the history, which is what every
 *  editor does and what the design assumes. */
export function pushOps<T extends EditDoc>(
  buffer: DialogueBuffer<T>,
  ops: EditOp[],
): DialogueBuffer<T> {
  if (ops.length === 0) return buffer;
  const kept = buffer.ops.slice(0, buffer.cursor);
  // Applied eagerly so an illegal op is refused HERE, at the gesture, rather
  // than surfacing later as a broken render.
  applyOps(buffer.base, [...kept, ...ops]);
  return { base: buffer.base, ops: [...kept, ...ops], cursor: buffer.cursor + ops.length };
}

export function undo<T extends EditDoc>(buffer: DialogueBuffer<T>): DialogueBuffer<T> {
  return canUndo(buffer) ? { ...buffer, cursor: buffer.cursor - 1 } : buffer;
}
export function redo<T extends EditDoc>(buffer: DialogueBuffer<T>): DialogueBuffer<T> {
  return canRedo(buffer) ? { ...buffer, cursor: buffer.cursor + 1 } : buffer;
}

/** Drop ONE op out of the middle of the applied list — the unsaved list's
 *  per-row `revert`.
 *
 *  Ops are positional (`choice.add` at an index shifts the ones after it), so
 *  removing a middle op can leave a later one illegal. The replay is attempted
 *  first and the reason is returned rather than thrown: doctrine 4 — the
 *  refusal travels with its reason and the buffer is left untouched. */
export function revertAt<T extends EditDoc>(
  buffer: DialogueBuffer<T>,
  index: number,
): { buffer: DialogueBuffer<T>; error: null } | { buffer: DialogueBuffer<T>; error: string } {
  const applied = dirtyOps(buffer);
  if (index < 0 || index >= applied.length) {
    return { buffer, error: `no unsaved edit at position ${index}` };
  }
  const next = [...applied.slice(0, index), ...applied.slice(index + 1)];
  try {
    applyOps(buffer.base, next);
  } catch (e) {
    return {
      buffer,
      error:
        `reverting "${opLabel(applied[index])}" would break a later edit — ` +
        `${e instanceof Error ? e.message : String(e)}. Undo back to it instead.`,
    };
  }
  // Reverting collapses the redo tail: the tail was authored on top of an op
  // that no longer exists, so keeping it would offer an illegal redo.
  return { buffer: { base: buffer.base, ops: next, cursor: next.length }, error: null };
}

/** `⌘S` landed: canon's returned trees become the new base and the stack is
 *  empty. After this, `⌘Z` no longer reaches those edits (README §7). */
export function commitSave<T extends EditDoc>(
  _buffer: DialogueBuffer<T>,
  base: T,
): DialogueBuffer<T> {
  return { base, ops: [], cursor: 0 };
}

// ---------------------------------------------------------------------------
// The dirty list and the chip
// ---------------------------------------------------------------------------

export type DirtyRow = { index: number; op: EditOp; label: string };
export type DirtyGroup = { target: string; rows: DirtyRow[] };

/** The unsaved popover's rows, grouped by target — the same `tree:…/node:…`
 *  string canon stamps on each journal entry, so the unsaved row and the
 *  journal entry that replaces it read the same. */
export function dirtyGroups(buffer: DialogueBuffer): DirtyGroup[] {
  const groups = new Map<string, DirtyRow[]>();
  dirtyOps(buffer).forEach((op, index) => {
    const target = opTarget(op);
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target)!.push({ index, op, label: opLabel(op) });
  });
  return [...groups.entries()].map(([target, rows]) => ({ target, rows }));
}

export type DirtySummary = { count: number } & Record<OpBucket, number>;

const EMPTY_SUMMARY: DirtySummary = {
  count: 0,
  nodes: 0,
  choices: 0,
  trees: 0,
  selectors: 0,
  lines: 0,
  actors: 0,
  scene: 0,
};

/** `4 unsaved · 2 nodes 2 choices` — the toolbar chip's counts. */
export function dirtySummary(buffer: DialogueBuffer): DirtySummary {
  const out: DirtySummary = { ...EMPTY_SUMMARY };
  for (const op of dirtyOps(buffer)) {
    out.count += 1;
    out[opBucket(op)] += 1;
  }
  return out;
}

/** The chip's words. Empty string when nothing is dirty — the caller hides the
 *  chip, which is the ONE thing that may be hidden: there is no reason to show. */
export function dirtyChipText(summary: DirtySummary): string {
  if (summary.count === 0) return "";
  const parts: string[] = [];
  if (summary.nodes) parts.push(`${summary.nodes} node${summary.nodes === 1 ? "" : "s"}`);
  if (summary.choices) parts.push(`${summary.choices} choice${summary.choices === 1 ? "" : "s"}`);
  if (summary.trees) parts.push(`${summary.trees} tree${summary.trees === 1 ? "" : "s"}`);
  if (summary.selectors) parts.push(`${summary.selectors} selector`);
  if (summary.lines) parts.push(`${summary.lines} line${summary.lines === 1 ? "" : "s"}`);
  if (summary.actors) parts.push(`${summary.actors} actor${summary.actors === 1 ? "" : "s"}`);
  if (summary.scene) parts.push(`${summary.scene} scene setting${summary.scene === 1 ? "" : "s"}`);
  return `${summary.count} unsaved · ${parts.join(" ")}`;
}

/** Across several buffers — quest scope's `2 unsaved across 2 NPCs`. */
export function crossBufferChipText(
  dirty: { key: BufferKey; summary: DirtySummary }[],
  noun = "NPCs",
): string {
  const live = dirty.filter((d) => d.summary.count > 0);
  if (live.length === 0) return "";
  if (live.length === 1) return dirtyChipText(live[0].summary);
  const total = live.reduce((n, d) => n + d.summary.count, 0);
  return `${total} unsaved across ${live.length} ${noun}`;
}

/** Every buffer a multi-NPC scope has open, dirty ones first.
 *
 *  QUEST SCOPE IS THE REASON THE BUFFER MAP EXISTS (PLAN: "do not simplify it
 *  away"). A quest session opens one buffer per participating NPC and `⌘S`
 *  flushes all the dirty ones as ONE batch of per-NPC `canon dialogue update`
 *  calls — atomic from the user's point of view, per-character in the journal,
 *  since that is how the pack stores it. */
export function useDialogueBuffers(keys: BufferKey[]) {
  const buffers = useStore((s) => s.dialogue.buffers);
  return useMemo(() => {
    const rows = keys
      .map((key) => ({ key, buffer: buffers[key] }))
      .filter((row): row is { key: BufferKey; buffer: DialogueBuffer } => !!row.buffer)
      .map((row) => ({
        key: row.key,
        buffer: row.buffer,
        summary: dirtySummary(row.buffer),
        groups: dirtyGroups(row.buffer),
        ops: dirtyOps(row.buffer),
      }));
    const dirty = rows.filter((row) => row.summary.count > 0);
    return { rows, dirty, chip: crossBufferChipText(dirty) };
  }, [buffers, keys]);
}

// ---------------------------------------------------------------------------
// The React binding
// ---------------------------------------------------------------------------

/** Bind one buffer to a component. `base` seeds the buffer the first time this
 *  key is opened; a buffer that already exists is NOT reseeded, because the
 *  unsaved work in it outranks a re-read of the row. */
export function useDialogueEditor<T extends EditDoc>(key: BufferKey, base: T | null) {
  const buffer = useStore((s) => s.dialogue.buffers[key]);
  const open = useStore((s) => s.openDialogueBuffer);
  const push = useStore((s) => s.pushDialogueOps);
  const undoAction = useStore((s) => s.undoDialogue);
  const redoAction = useStore((s) => s.redoDialogue);
  const revertAction = useStore((s) => s.revertDialogueOp);
  const commit = useStore((s) => s.commitDialogueSave);

  // Seeding during render would set state mid-render; the surface calls this
  // from an effect. `ensure` is idempotent and cheap.
  const ensure = useCallback(() => {
    if (base) open(key, base);
  }, [base, key, open]);

  // The store holds the union (it holds every scope's buffers at once); the
  // CALLER knows which document its key names — `npc:` surfaces hand in an
  // `AuthorDoc`, the scene surface a `SceneDoc` — so the generic narrows it
  // back rather than making every reader re-check.
  const live = (buffer as DialogueBuffer<T> | undefined) ?? (base ? emptyBuffer(base) : null);
  const doc = useMemo(() => (live ? bufferDoc(live) : null), [live]);
  const summary = useMemo(() => (live ? dirtySummary(live) : null), [live]);
  const groups = useMemo(() => (live ? dirtyGroups(live) : []), [live]);

  return {
    key,
    buffer: live,
    doc,
    ensure,
    dirty: !!live && isDirty(live),
    summary,
    groups,
    ops: live ? dirtyOps(live) : [],
    canUndo: !!live && canUndo(live),
    canRedo: !!live && canRedo(live),
    push: useCallback((ops: EditOp[]) => push(key, ops), [key, push]),
    undo: useCallback(() => undoAction(key), [key, undoAction]),
    redo: useCallback(() => redoAction(key), [key, redoAction]),
    revert: useCallback((index: number) => revertAction(key, index), [key, revertAction]),
    commit: useCallback((next: T) => commit(key, next), [commit, key]),
  };
}
