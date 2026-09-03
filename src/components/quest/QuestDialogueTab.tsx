// The quest scope — the PRIMARY authoring surface for a quest's conversation
// (README screen 07; PLAN step 11).
//
// EXTENDS everything the NPC scope already built and adds exactly two things:
// the lane canvas and the coverage list. The rail, the tray's condition rows,
// the buffer, the dirty chip, the save sheet and the tester are the same parts —
// which is the whole reason `useDialogueEditor`'s buffer is a KEYED MAP rather
// than a single object. A quest session opens one buffer per participating NPC.
//
// THE SAVE IS THE POINT OF THIS FILE. One `⌘S` here can touch several
// characters, and the pack stores dialogue per character, so it goes out as ONE
// `canon dialogue update` PER NPC — carrying ONE SHARED SESSION ID. That is
// what makes it one undo entry: atomic from the user's point of view, per
// character in the journal, one session to revert from History. Doctrine 1
// holds per call (resolve → wall → fail-closed validate → warnings →
// user_edited → journal → CAS); nothing here writes a file.
//
// Participation is read from the DATA, never from a stored membership list: an
// NPC is in this quest if the row names it (`quest_id`) or if any of its trees
// gates on `quest:<id>:…`. There is no quest-lane coordinate in the pack, and
// inventing one would be a second source of truth.

import { useCallback, useEffect, useMemo, useState } from "react";
import { QuestCoverage, type CoverageRow } from "./QuestCoverage";
import { QuestLanes } from "./QuestLanes";
import { beatsFor, impliedQuestToken, type QuestBeat, type QuestSceneBlock } from "./questBeats";
import { Inspector } from "../dialogue/Inspector";
import { SaveSheet } from "../dialogue/SaveSheet";
import { ModeBar } from "../dialogue/ModeBar";
import { EngineChip } from "../dialogue/EngineLag";
import { TesterDock } from "../dialogue/TesterDock";
import { useDialogueTest } from "../dialogue/useDialogueTest";
import {
  bufferDoc,
  crossBufferChipText,
  dirtyChipText,
  useDialogueBuffers,
} from "../dialogue/useDialogueEditor";
import { npcKey, type EditOp } from "../dialogue/ops";
import {
  defaultTreeId,
  lagWarnings,
  localReport,
  toAuthorDoc,
  treeLag,
  type LocalReport,
} from "../dialogue/model";
import type { AuthorDoc, NpcRow } from "../dialogue/model";
import { vocabOf } from "../dialogue/grammar";
import { api, type EntityRow } from "../../lib/invoke";
import { useStore, type DialogueMode } from "../../store";
import { isShortcut } from "../../lib/keys";

type Quest = { id?: number | string; title?: string; type?: string };

/** A session id for ONE quest-scope batch. Grouping the per-NPC writes under it
 *  is what makes the journal read as one undo entry (README §7). */
function batchSession(questId: string): string {
  return `cradle-quest-${questId}-${Date.now().toString(36)}`;
}

export function QuestDialogueTab({
  quest,
  questId,
  onOpenNpc,
  onOpenScene,
}: {
  quest: Quest;
  questId: string;
  onOpenNpc?: (npcId: string) => void;
  onOpenScene?: (sceneId: string) => void;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const packInfo = useStore((s) => s.world?.pack_info ?? null);
  const mode = useStore((s) => s.dialogue.mode);
  const setMode = useStore((s) => s.setDialogueMode);
  const setScope = useStore((s) => s.setDialogueScope);
  const setActiveKey = useStore((s) => s.setActiveDialogueKey);
  const openBuffer = useStore((s) => s.openDialogueBuffer);
  const pushOps = useStore((s) => s.pushDialogueOps);
  const commit = useStore((s) => s.commitDialogueSave);

  const vocab = useMemo(() => vocabOf(packInfo), [packInfo]);
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [scenes, setScenes] = useState<QuestSceneBlock[]>([]);
  const [selected, setSelected] = useState<{
    npcId: string;
    nodeId: string;
    treeId: string;
  } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setScope("quest");
    return () => setScope("npc");
  }, [setScope]);

  // Every NPC row once — the lane grid needs whole rows, not refs, and one
  // list call beats N fetches.
  useEffect(() => {
    if (!worldPath) return;
    let alive = true;
    api
      .listEntityRows(worldPath, "npcs")
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [worldPath]);

  /** The pack's own quest states, in the pack's order. Never a hardcoded five. */
  const states = useMemo(() => vocab.operands.quest?.states ?? [], [vocab]);

  /** Participation, read from the data. */
  const participants = useMemo(() => {
    const out: { npcId: string; npcName: string; doc: AuthorDoc }[] = [];
    for (const row of rows) {
      const npc = row.data as NpcRow;
      const doc = toAuthorDoc(npc, { npcId: row.id, vocab });
      const named = String(npc.quest_id ?? "") === questId;
      const gated = doc.trees.some(
        (tree) =>
          (tree.selector?.rows ?? []).some((t) => t.startsWith(`quest:${questId}:`)) ||
          Object.values(tree.nodes).some((node) =>
            node.choices.some((c) =>
              [...c.conditions, ...c.effects].some(
                (t) => t.includes(`:${questId}:`) || t.endsWith(`:${questId}`),
              ),
            ),
          ),
      );
      if (named || gated) out.push({ npcId: row.id, npcName: String(npc.name ?? row.id), doc });
    }
    return out;
  }, [questId, rows, vocab]);

  const keys = useMemo(() => participants.map((p) => npcKey(p.npcId)), [participants]);
  const buffers = useDialogueBuffers(keys);

  // Open one buffer per participant. Idempotent — a buffer that already holds
  // unsaved work is never reseeded.
  useEffect(() => {
    for (const p of participants) openBuffer(npcKey(p.npcId), p.doc);
  }, [openBuffer, participants]);

  useEffect(() => {
    if (!selected) {
      setActiveKey(null);
      return;
    }
    setActiveKey(npcKey(selected.npcId));
    return () => setActiveKey(null);
  }, [selected, setActiveKey]);

  /** The buffer's document for one participant — the EDITED one when a buffer
   *  exists, so the lanes show unsaved work the way the graph does. Every key
   *  on this surface is `npc:<id>`, so the document can only be an `AuthorDoc`. */
  const docOf = useCallback(
    (npcId: string): AuthorDoc => {
      const row = buffers.rows.find((r) => r.key === npcKey(npcId));
      if (row) return bufferDoc(row.buffer) as AuthorDoc;
      return (
        participants.find((p) => p.npcId === npcId)?.doc ?? {
          character_id: npcId,
          trees: [],
          chrome: {},
        }
      );
    },
    [buffers.rows, participants],
  );

  const lanes = useMemo(
    () =>
      participants.map((p) => ({
        npcId: p.npcId,
        npcName: p.npcName,
        beats: beatsFor(docOf(p.npcId), p.npcId, p.npcName, questId),
      })),
    [docOf, participants, questId],
  );

  const coverage: CoverageRow[] = useMemo(
    () =>
      states.map((state) => ({
        state,
        beats: lanes.reduce(
          (n, lane) => n + lane.beats.filter((b: QuestBeat) => b.state === state).length,
          0,
        ),
      })),
    [lanes, states],
  );

  // Scenes whose settings reference this quest — referenced, never embedded.
  useEffect(() => {
    if (!worldPath || participants.length === 0) return;
    let alive = true;
    Promise.all(participants.map((p) => api.dialogueShow(worldPath, p.npcId).catch(() => null)))
      .then((shows) => {
        if (!alive) return;
        const seen = new Map<string, QuestSceneBlock>();
        for (const show of shows) {
          for (const scene of show?.scenes ?? []) {
            seen.set(String(scene.id), {
              id: String(scene.id),
              title: scene.title || String(scene.id),
              actors: scene.actors.map(String),
              state: null,
            });
          }
        }
        setScenes([...seen.values()]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [participants, worldPath]);

  const selectedDoc = selected ? docOf(selected.npcId) : null;

  /** The save sheet's pre-flight over EVERY buffer the batch writes, not just
   *  the selected beat's NPC: `doSave` writes NPC by NPC, so an error in the
   *  second one would land after the first was already committed. Each line is
   *  prefixed with the NPC it belongs to. */
  const batchReport = useMemo((): LocalReport => {
    const merged: LocalReport = { errors: [], warnings: [], passed: [] };
    for (const row of buffers.dirty) {
      const npcId = row.key.slice("npc:".length);
      const one = localReport(docOf(npcId));
      merged.errors.push(...one.errors.map((e) => `${npcId}: ${e}`));
      merged.warnings.push(...one.warnings.map((w) => `${npcId}: ${w}`));
    }
    merged.passed.push(
      buffers.dirty.length === 0
        ? "nothing dirty"
        : `${buffers.dirty.length} buffer${buffers.dirty.length === 1 ? "" : "s"} pre-flighted`,
    );
    return merged;
  }, [buffers.dirty, docOf]);
  const selectedTree =
    selectedDoc?.trees.find((t) => t.tree_id === selected?.treeId) ?? selectedDoc?.trees[0] ?? null;
  const tester = useDialogueTest({
    worldPath,
    tree: selectedTree,
    npcId: selected?.npcId,
    enabled: mode === "test",
  });

  const push = useCallback(
    (npcId: string, ops: EditOp[]) => pushOps(npcKey(npcId), ops),
    [pushOps],
  );

  /** `＋ beat for <NPC>` — a node in that NPC's tree, gated on THIS quest in
   *  THIS state, and a lane cell here. One thing, two views. The quest id is
   *  implied, which is what makes quest scope faster for quest work. */
  const addBeat = useCallback(
    (npcId: string, state: string) => {
      const doc = docOf(npcId);
      const treeId = defaultTreeId(doc);
      if (!treeId) return;
      const tree = doc.trees.find((t) => t.tree_id === treeId)!;
      let n = Object.keys(tree.nodes).length + 1;
      while (`beat_${n}` in tree.nodes) n += 1;
      const nodeId = `beat_${n}`;
      push(npcId, [
        { k: "node.add", tree: treeId, node_id: nodeId, node: { prompt: "" } },
        {
          k: "choice.add",
          tree: treeId,
          node_id: nodeId,
          index: 0,
          choice: { text: "", conditions: [impliedQuestToken(questId, state)] },
        },
      ]);
      setSelected({ npcId, nodeId, treeId });
    },
    [docOf, push, questId],
  );

  /** ONE batch: one `canon dialogue update` per touched NPC, all under one
   *  session id, so the journal reads as one undo entry. Fail-closed per call —
   *  canon refuses a whole NPC's batch on one error, and the sheet says which. */
  const doSave = useCallback(async () => {
    if (!worldPath || buffers.dirty.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const session = batchSession(questId);
    try {
      for (const row of buffers.dirty) {
        const npcId = row.key.slice("npc:".length);
        const result = await api.dialogueUpdate(worldPath, npcId, row.ops, session);
        const base = row.buffer.base as AuthorDoc;
        commit(row.key, {
          character_id: base.character_id,
          trees: toAuthorDoc(
            { ...(rows.find((r) => r.id === npcId)?.data as NpcRow), dialogue_trees: result.trees },
            { npcId, vocab },
          ).trees,
          chrome: base.chrome,
        });
      }
      setSheetOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [buffers.dirty, commit, questId, rows, vocab, worldPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, "s")) {
        e.preventDefault();
        if (buffers.dirty.length) setSheetOpen(true);
      } else if (e.key === "Escape" && mode !== "view") {
        e.preventDefault();
        setMode("view");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [buffers.dirty.length, mode, setMode]);

  const lag = useMemo(() => treeLag(selectedTree, packInfo), [packInfo, selectedTree]);
  const beatCount = lanes.reduce((n, lane) => n + lane.beats.length, 0);
  const gatedCount = lanes.reduce(
    (n, lane) => n + lane.beats.filter((b: QuestBeat) => b.gates > 0).length,
    0,
  );

  if (participants.length === 0) {
    return (
      <div className="dialogue-empty" data-testid="quest-dialogue-empty">
        No character speaks for this quest yet. An NPC joins by naming it (
        <span className="dlg-mono">quest_id</span>) or by gating a line on{" "}
        <span className="dlg-mono">quest:{questId}:…</span> — this tab lists them the moment one
        does.
      </div>
    );
  }

  return (
    <div
      className="dialogue-tab dlg-surface dlg-quest-scope"
      data-mode={mode}
      data-testid="quest-dialogue"
    >
      <ModeBar
        mode={mode}
        onMode={(m: DialogueMode) => setMode(m)}
        treeLabel={quest.title || questId}
        selectorText={`${participants.length} NPCs · ${scenes.length} scene${scenes.length === 1 ? "" : "s"}`}
        counts={`${beatCount} beats · ${gatedCount} gated`}
        dirtyText={
          buffers.dirty.length > 1
            ? crossBufferChipText(buffers.dirty)
            : buffers.dirty.length === 1
              ? dirtyChipText(buffers.dirty[0].summary)
              : ""
        }
        onOpenUnsaved={() => setSheetOpen(true)}
        onSave={() => buffers.dirty.length && setSheetOpen(true)}
        saving={saving}
        saveDisabledReason={buffers.dirty.length ? "" : "nothing to save — every buffer is clean"}
        improveDisabledReason="Improve runs per character — open an NPC's tree to re-author it"
        testDisabledReason={selectedTree ? "" : "select a beat to walk from"}
      >
        <EngineChip vocab={vocab} packInfo={packInfo} />
      </ModeBar>

      <div className="dlg-columns">
        <aside className="dlg-rail" data-testid="quest-rail">
          <div className="dlg-rail-head">
            {/* No ⌘P hint: the tree switcher is a character-scope affordance
                and is not mounted on this scope. */}
            <span className="dlg-mono">quest beats</span>
            <span className="dlg-rail-count">{beatCount}</span>
          </div>
          {states.map((state) => {
            const beats = lanes.flatMap((lane) =>
              lane.beats.filter((b: QuestBeat) => b.state === state),
            );
            return (
              <section key={state} className="dlg-rail-group">
                <header className="dlg-rail-group-head">
                  <span className="dlg-mono">{state}</span>
                  <span className="dlg-rail-count">· {beats.length}</span>
                </header>
                {beats.length === 0 ? (
                  <p className="dlg-rail-empty">
                    no beats — falls back to the quest&apos;s failure line
                  </p>
                ) : (
                  beats.map((beat) => (
                    <button
                      key={`${beat.npcId}/${beat.nodeId}`}
                      className={`dlg-rail-row ${
                        selected?.npcId === beat.npcId && selected.nodeId === beat.nodeId
                          ? "on"
                          : ""
                      }`}
                      onClick={() =>
                        setSelected({
                          npcId: beat.npcId,
                          nodeId: beat.nodeId,
                          treeId: beat.treeId,
                        })
                      }
                    >
                      <span className="dlg-rail-label">{beat.npcName}</span>
                      <span className="dlg-rail-count">
                        {beat.gates ? `⊳${beat.gates}` : ""} {beat.nodeId}
                      </span>
                    </button>
                  ))
                )}
              </section>
            );
          })}
        </aside>

        <div className="dlg-canvas" data-mode={mode}>
          <span className="dlg-mode-pill" data-mode={mode}>
            {mode === "edit" ? "edit mode · quest scope" : `${mode} mode · quest scope`}
          </span>
          <QuestLanes
            states={states}
            lanes={lanes}
            scenes={scenes}
            selected={selected}
            editable={mode === "edit"}
            onSelectBeat={(beat: QuestBeat) =>
              setSelected({ npcId: beat.npcId, nodeId: beat.nodeId, treeId: beat.treeId })
            }
            onAddBeat={addBeat}
            onOpenScene={onOpenScene}
          />
        </div>

        {mode !== "view" ? (
          <div className="dlg-tray">
            {selected && selectedTree ? (
              <>
                <p className="dlg-quest-deeplink">
                  You are editing <strong>{selected.npcId}</strong>&apos;s{" "}
                  <span className="dlg-mono">{selectedTree.label || selectedTree.tree_id}</span>{" "}
                  tree from the quest. Same data, same buffer.
                  <button
                    className="btn"
                    disabled={!onOpenNpc}
                    onClick={() => onOpenNpc?.(selected.npcId)}
                  >
                    Open their tree →
                  </button>
                </p>
                <Inspector
                  doc={selectedDoc ?? { character_id: selected.npcId, trees: [], chrome: {} }}
                  tree={selectedTree}
                  nodeId={selected.nodeId}
                  choice={null}
                  packInfo={packInfo}
                  vocab={vocab}
                  worldPath={worldPath}
                  onOps={(ops) => push(selected.npcId, ops)}
                  onDeleteTree={() => undefined}
                  onSelectNode={(nodeId) =>
                    setSelected((current) => (current && nodeId ? { ...current, nodeId } : null))
                  }
                />
              </>
            ) : (
              <p className="dlg-inspector-empty">
                Select a beat to edit it. Empty cells are drop targets — a gap in the grid is a gap
                in the quest.
              </p>
            )}
            <QuestCoverage rows={coverage} />
          </div>
        ) : null}
      </div>

      {mode === "test" && selectedTree ? (
        <TesterDock
          tester={tester}
          treeLabel={`${selected?.npcId ?? ""} · ${selectedTree.label || selectedTree.tree_id}`}
          unsaved={buffers.dirty.length > 0}
          onJumpToNode={(nodeId) => selected && setSelected({ ...selected, nodeId })}
        />
      ) : null}

      {sheetOpen ? (
        <SaveSheet
          npcLabel={`${buffers.dirty.length} NPC${buffers.dirty.length === 1 ? "" : "s"} in ${quest.title || questId}`}
          groups={buffers.dirty.flatMap((row) => row.groups)}
          report={batchReport}
          stored={null}
          saving={saving}
          error={saveError}
          engineLag={lagWarnings(lag)}
          batch={{ npcs: buffers.dirty.map((row) => row.key.slice("npc:".length)) }}
          onCancel={() => setSheetOpen(false)}
          onSave={doSave}
        />
      ) : null}
    </div>
  );
}
