// The mode host: View | Edit | Test over one three-column layout plus the
// tester dock (README Q2; PLAN steps 3–8).
//
// EXTENDS `DialogueTab`, which was a Card/Graph switch over `buildDialogue`.
// The switch survives INSIDE View mode — Card and Graph are two readers of one
// mode, not two modes — and everything else grows around it. View mode's
// output is unchanged: board 00 is the current-state baseline, a reference and
// not a build target.
//
// Mode is stated FOUR times, because the level editor's failure was three
// IMPLICIT states and one indicator would repeat it:
//   1. the segmented control's underline           (ModeBar)
//   2. a 2px top border on the canvas              (`.dlg-canvas[data-mode]`)
//   3. a mode pill floating on the canvas          (here)
//   4. the statusbar's coloured MODE word          (ValidationBar)
// All four read the same `data-mode`, so they cannot disagree.
//
// `Esc` is the universal step-out: it cancels an in-progress gesture if one is
// running, otherwise it drops to View.
//
// The one write is `⌘S` → ONE `canon dialogue update` carrying the op list.
// cradle never writes pack files (doctrine 1); the tester's state is simulated
// and says so; Improve produces a proposal.
//
// Steps 9, 10 and 13 added three things on top of the same chassis: the
// SELECTOR node (the router — precedence is data, so the thing that decides is
// the thing you edit), the ENGINE-LAG banner (doctrine 10: the editor warns
// loudly and never refuses a legal token), and IMPROVE (a proposal that lands
// in the unsaved buffer — `⌘S` is still the only write).
//
// The quest scope (`quest/QuestDialogueTab`, step 11) and the scene scope
// (`event/SceneTab`, step 12) are their own hosts over the same parts — the
// rail, the tray, the dock and the buffer — which is why the columns are
// composed here rather than baked into the canvas.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogueCardMode } from "./DialogueCardMode";
import { DialogueGraphMode, type GraphEdit } from "./DialogueGraphMode";
import { ModeBar } from "./ModeBar";
import { SaveSheet, ValidatorPanel } from "./SaveSheet";
import { TreeRail } from "./TreeRail";
import { TreeSwitcher } from "./TreeSwitcher";
import { Inspector } from "./Inspector";
import { DeletePreview, type Consequences } from "./DeletePreview";
import { TesterDock } from "./TesterDock";
import { SelectorNode } from "./SelectorNode";
import { EngineChip, EngineLagBanner } from "./EngineLag";
import { ImproveDialogue } from "./ImproveDialogue";
import { ToolRail, type DialogueTool } from "./DialogueToolRail";
import { useDialogueTest } from "./useDialogueTest";
import {
  defaultTreeId,
  lagWarnings,
  localReport,
  treeLag,
  toAuthorDoc,
  toBeats,
  unreachableNodes,
  type AuthorDoc,
  type NpcRow,
} from "./model";
import { engineSupports, engineReasonFor, vocabOf } from "./grammar";
import { npcKey, rankBeforeFallback, type EditOp } from "./ops";
import { useDialogueEditor, dirtyChipText } from "./useDialogueEditor";
import { api, type DialogueShow, type DialogueValidation } from "../../lib/invoke";
import { useStore, type Command, type DialogueMode } from "../../store";
import { inTextField, isMod, isShortcut, kbd } from "../../lib/keys";
import type { QuestLike } from "./types";

/** The selector of the open tree, as the chip renders it. */
/** The ops that change WHICH tree a state selects — the ones that outdate
 *  `canon dialogue select`'s answer while they sit unsaved. */
const SELECTOR_SHAPING_OPS = [
  "tree.rank",
  "tree.selector",
  "tree.add",
  "tree.remove",
  "tree.duplicate",
] as const;

function selectorText(rows: string[] | null): string {
  if (rows === null) return "no selector";
  if (rows.length === 0) return "no rows — always matches";
  return rows.join(" · ");
}

/** Which node ids the buffer has touched — the `edited` badge on the card. */
function dirtyNodeIds(ops: EditOp[]): Set<string> {
  const out = new Set<string>();
  for (const op of ops) {
    const withNode = op as { node_id?: string };
    if (withNode.node_id) out.add(withNode.node_id);
  }
  return out;
}

export function DialogueSurface({
  npc,
  npcId,
  quest,
  onOpenScene,
  onOpenQuest,
}: {
  npc: NpcRow;
  npcId: string;
  quest?: QuestLike | null;
  /** Cross-surface entry: a beat is reachable from its NPC, its quest and its
   *  scene, and every rail deep-links to the others (README Q9). */
  onOpenScene?: (sceneId: string) => void;
  onOpenQuest?: (questId: string) => void;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const packInfo = useStore((s) => s.world?.pack_info ?? null);
  const mode = useStore((s) => s.dialogue.mode);
  const setMode = useStore((s) => s.setDialogueMode);
  const setActiveKey = useStore((s) => s.setActiveDialogueKey);
  const setScope = useStore((s) => s.setDialogueScope);
  const activeTreeByKey = useStore((s) => s.dialogue.activeTree);
  const setActiveTree = useStore((s) => s.setActiveDialogueTree);
  const registerCommands = useStore((s) => s.registerCommands);
  const unregisterCommands = useStore((s) => s.unregisterCommands);

  const key = npcKey(npcId);
  const vocab = useMemo(() => vocabOf(packInfo), [packInfo]);
  const base = useMemo(() => toAuthorDoc(npc, { npcId, vocab }), [npc, npcId, vocab]);
  const editor = useDialogueEditor(key, base);
  const doc = editor.doc ?? base;
  const npcLabel = String(npc.name ?? npcId);

  const [reader, setReader] = useState<"card" | "graph">("card");
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stored, setStored] = useState<DialogueValidation | null>(null);
  const [show, setShow] = useState<DialogueShow | null>(null);
  const [improveOpen, setImproveOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(true);
  /** Muted per tree, per session — the BANNER only (`EngineLag`). */
  const [mutedLag, setMutedLag] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<{ nodeId: string; index: number } | null>(
    null,
  );
  const [tool, setTool] = useState<DialogueTool>("select");
  const [connectFrom, setConnectFrom] = useState<{ nodeId: string; index: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Consequences | null>(null);
  const [validatorOpen, setValidatorOpen] = useState(false);
  const [trayHidden, setTrayHidden] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [fitTick, setFitTick] = useState(0);
  /** The expanded dock takes the FULL height, so the columns above fold away;
   *  `G` brings the graph back as a strip without collapsing the dock. */
  const [graphFolded, setGraphFolded] = useState(false);
  /** A gesture `Esc` must cancel before it drops the mode (README Q2). */
  const gestureRef = useRef<null | (() => void)>(null);

  const treeId = activeTreeByKey[key] ?? defaultTreeId(doc);
  const tree = useMemo(
    () => doc.trees.find((t) => t.tree_id === treeId) ?? null,
    [doc.trees, treeId],
  );
  const report = useMemo(() => localReport(doc), [doc]);
  const tester = useDialogueTest({ worldPath, tree, npcId, enabled: mode === "test" });

  useEffect(() => {
    editor.ensure();
  }, [editor]);

  useEffect(() => {
    setActiveKey(key);
    setScope("npc");
    return () => setActiveKey(null);
  }, [key, setActiveKey, setScope]);

  // `canon dialogue validate` reads what is ON DISK, so it is refreshed when
  // the surface opens and after every save — never on a keystroke.
  const refreshStored = useCallback(() => {
    if (!worldPath) return;
    api
      .dialogueValidate(worldPath, npcId)
      .then(setStored)
      .catch(() => setStored(null));
  }, [npcId, worldPath]);
  useEffect(refreshStored, [refreshStored]);

  // `canon dialogue show` answers WHERE the trees came from (`dialogue_trees`
  // or the legacy four), which legacy keys the engine copy is written to, and
  // which scenes list this character as an actor. A pure read, refreshed with
  // the validator — never on a keystroke.
  useEffect(() => {
    if (!worldPath) return;
    let alive = true;
    api
      .dialogueShow(worldPath, npcId)
      .then((r) => alive && setShow(r))
      .catch(() => alive && setShow(null));
    return () => {
      alive = false;
    };
  }, [npcId, worldPath, stored]);

  const testDisabledReason = doc.trees.length === 0 ? "no tree to walk yet — author one first" : "";

  // The engine-lag layer's ONE computation — the banner, the statusbar count
  // and the save sheet all render from it (doctrine 10: loud, never blocking).
  const lag = useMemo(() => treeLag(tree, packInfo), [packInfo, tree]);
  const lagLines = useMemo(() => lagWarnings(lag), [lag]);

  const improveDisabledReason = doc.trees.length === 0 ? "no dialogue to improve yet" : "";

  const enter = useCallback(
    (next: DialogueMode) => {
      if (next === "test" && testDisabledReason) return;
      setMode(next);
    },
    [setMode, testDisabledReason],
  );

  const doSave = useCallback(async () => {
    if (!editor.dirty || !worldPath) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.dialogueUpdate(worldPath, npcId, editor.ops);
      // canon returns the trees as they now sit on disk — that IS the new base,
      // so the buffer never re-derives it from a stale row.
      const saved: AuthorDoc = {
        character_id: doc.character_id,
        trees: toAuthorDoc({ ...npc, dialogue_trees: result.trees }, { npcId, vocab }).trees,
        chrome: doc.chrome,
      };
      editor.commit(saved);
      setSheetOpen(false);
      setUnsavedOpen(false);
      refreshStored();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [doc.character_id, doc.chrome, editor, npc, npcId, refreshStored, vocab, worldPath]);

  const openSave = useCallback(() => {
    if (!editor.dirty) return;
    setSaveError(null);
    setSheetOpen(true);
  }, [editor.dirty]);

  // ── edit gestures (step 6) ────────────────────────────────────────────────
  const push = editor.push;
  const commitPrompt = useCallback(
    (nodeId: string, prompt: string) => {
      if (!tree) return;
      push([{ k: "node.prompt", tree: tree.tree_id, node_id: nodeId, value: prompt }]);
    },
    [push, tree],
  );

  /** Board 06's first route in: seed a tree from the greeting the NPC already
   *  has, so the empty state is a starting point rather than a dead end. The
   *  greeting STAYS in `chrome` — it is what plays before a tree is selected —
   *  and this copies its text into the entry node's prompt. */
  const newTreeFromGreeting = useCallback(() => {
    const greeting = String(base.chrome.opening_greeting ?? "");
    const id = `${npcId}:default`;
    if (doc.trees.some((t) => t.tree_id === id)) return;
    push([
      {
        k: "tree.add",
        tree: id,
        label: "default",
        axis: null,
        rank: rankBeforeFallback(doc),
        nodes: { start: { node_id: "start", prompt: greeting } },
      },
    ]);
    setActiveTree(key, id);
  }, [base.chrome.opening_greeting, doc, key, npcId, push, setActiveTree]);

  /** `＋ New tree` — the axis is picked FIRST (README Q4), and the tree lands
   *  UNGATED: the selector is the author's next decision, and guessing one
   *  would make the new tree shadow an existing one.
   *
   *  The RANK is explicit. canon's default (`nextRank` = max + 1) is only
   *  correct for a doc with no fallback: a legacy row's fallback sits at 999,
   *  so the default would land every tree authored here at 1000, behind a
   *  selector row that matches everything — `validate_trees`' own "it can never
   *  be selected". `rankBeforeFallback` keeps the fallback last. */
  const newTree = useCallback(
    (axis: string) => {
      let n = doc.trees.length + 1;
      while (doc.trees.some((t) => t.tree_id === `${npcId}:tree_${n}`)) n += 1;
      const id = `${npcId}:tree_${n}`;
      push([
        {
          k: "tree.add",
          tree: id,
          label: `new ${axis} tree`,
          axis,
          rank: rankBeforeFallback(doc),
          nodes: { start: { node_id: "start", prompt: "" } },
        },
      ]);
      setActiveTree(key, id);
    },
    [doc, key, npcId, push, setActiveTree],
  );

  const addNode = useCallback(() => {
    if (!tree) return;
    let n = Object.keys(tree.nodes).length + 1;
    while (`node_${n}` in tree.nodes) n += 1;
    const nodeId = `node_${n}`;
    push([{ k: "node.add", tree: tree.tree_id, node_id: nodeId, node: { prompt: "" } }]);
    setSelectedNode(nodeId);
  }, [push, tree]);

  /** Every consequence of removing `nodeId`, computed BEFORE the confirm and
   *  drawn on the canvas behind the sheet (README §8). */
  const previewDelete = useCallback(
    (nodeId: string) => {
      if (!tree) return;
      const inbound: string[] = [];
      for (const node of Object.values(tree.nodes)) {
        node.choices.forEach((choice, index) => {
          if (choice.next_node_id === nodeId) inbound.push(`${node.node_id}[${index}]`);
        });
      }
      const after = { ...tree, nodes: { ...tree.nodes } };
      delete after.nodes[nodeId];
      const gates = Object.values(tree.nodes[nodeId]?.choices ?? []).reduce(
        (n, c) => n + c.conditions.length,
        0,
      );
      setPendingDelete({
        kind: "node",
        id: nodeId,
        inbound,
        newlyUnreachable: unreachableNodes(after).filter(
          (id) => !unreachableNodes(tree).includes(id),
        ),
        gatesLost: gates,
        entryMoves: tree.entry_node_id === nodeId,
      });
    },
    [tree],
  );

  const confirmDelete = useCallback(() => {
    if (!tree || !pendingDelete) return;
    if (pendingDelete.kind === "node") {
      push([{ k: "node.remove", tree: tree.tree_id, node_id: pendingDelete.id }]);
      setSelectedNode(null);
    } else {
      push([{ k: "tree.remove", tree: pendingDelete.id }]);
      setActiveTree(key, defaultTreeId(doc));
    }
    setPendingDelete(null);
  }, [doc, key, pendingDelete, push, setActiveTree, tree]);

  const onNodeClick = useCallback(
    (nodeId: string) => {
      if (mode !== "edit") return;
      if (tool === "delete") {
        previewDelete(nodeId);
        return;
      }
      if (tool === "connect" && connectFrom) {
        push([
          {
            k: "choice.target",
            tree: tree!.tree_id,
            node_id: connectFrom.nodeId,
            index: connectFrom.index,
            value: nodeId,
          },
        ]);
        setConnectFrom(null);
        gestureRef.current = null;
        return;
      }
      setSelectedNode(nodeId);
      setSelectedChoice(null);
    },
    [connectFrom, mode, previewDelete, push, tool, tree],
  );

  const onChoiceClick = useCallback(
    (nodeId: string, index: number) => {
      if (mode !== "edit") return;
      if (tool === "connect") {
        setConnectFrom({ nodeId, index });
        gestureRef.current = () => setConnectFrom(null);
        return;
      }
      setSelectedNode(nodeId);
      setSelectedChoice({ nodeId, index });
    },
    [mode, tool],
  );

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (switcherOpen) {
          e.preventDefault();
          setSwitcherOpen(false);
          return;
        }
        if (pendingDelete) {
          e.preventDefault();
          setPendingDelete(null);
          return;
        }
        if (sheetOpen) {
          e.preventDefault();
          setSheetOpen(false);
          return;
        }
        if (gestureRef.current) {
          e.preventDefault();
          const cancel = gestureRef.current;
          gestureRef.current = null;
          cancel();
          return;
        }
        if (search !== null) {
          e.preventDefault();
          setSearch(null);
          return;
        }
        if (mode !== "view") {
          e.preventDefault();
          setMode("view");
        }
        return;
      }
      if (isShortcut(e, "s")) {
        e.preventDefault();
        openSave();
        return;
      }
      if (isShortcut(e, "p")) {
        e.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if (isShortcut(e, "z")) {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (isShortcut(e, "i")) {
        e.preventDefault();
        setTrayHidden((v) => !v);
        return;
      }
      if (inTextField(e) || isMod(e) || e.altKey) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        enter("edit");
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        enter("test");
      } else if (e.key === "!" || (e.shiftKey && e.key === "1")) {
        e.preventDefault();
        setFitTick((n) => n + 1);
      } else if (e.key === "/") {
        e.preventDefault();
        setSearch("");
      } else if (mode === "edit") {
        if (e.key === "v" || e.key === "V") setTool("select");
        else if (e.key === "n" || e.key === "N") {
          e.preventDefault();
          addNode();
        } else if (e.key === "c" || e.key === "C") setTool("connect");
        else if (e.key === "Backspace" || e.key === "Delete") {
          if (selectedNode) {
            e.preventDefault();
            previewDelete(selectedNode);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    addNode,
    editor,
    enter,
    mode,
    openSave,
    pendingDelete,
    previewDelete,
    search,
    selectedNode,
    setMode,
    sheetOpen,
    switcherOpen,
  ]);

  // ── ⌘K commands, disabled WITH their reasons (doctrine 4) ─────────────────
  useEffect(() => {
    const unreachable = tree ? unreachableNodes(tree) : [];
    const cmds: Command[] = [
      {
        id: "dlg.edit",
        label: "Edit this dialogue tree",
        group: "Dialogue",
        hint: "E",
        run: () => enter("edit"),
      },
      {
        id: "dlg.test",
        label: "Test this dialogue against a simulated state",
        group: "Dialogue",
        hint: "T",
        enabled: !testDisabledReason,
        disabledReason: testDisabledReason,
        run: () => enter("test"),
      },
      {
        id: "dlg.addnode",
        label: "Add a dialogue node",
        group: "Dialogue",
        hint: "N",
        enabled: mode === "edit" && !!tree,
        disabledReason: mode === "edit" ? "no tree open" : "enter Edit mode first",
        run: addNode,
      },
      {
        id: "dlg.save",
        label: "Save this dialogue tree",
        group: "Dialogue",
        hint: kbd("S"),
        enabled: editor.dirty,
        disabledReason: "nothing to save — the buffer is clean",
        run: openSave,
      },
      {
        id: "dlg.improve",
        label: "✨ Improve this dialogue tree…",
        group: "Dialogue",
        keywords: "llm re-author proposal paid",
        // Doctrine 4: disabled WITH the reason, never hidden. The modal itself
        // carries the $0 / paid split; the command only asks whether there is
        // anything to improve.
        enabled: !improveDisabledReason,
        disabledReason: improveDisabledReason,
        run: () => setImproveOpen(true),
      },
      {
        id: "dlg.selector",
        label: selectorOpen ? "Hide the selector node" : "Show the selector node",
        group: "Dialogue",
        keywords: "router precedence rank",
        enabled: doc.trees.length > 1,
        disabledReason: "this character has one tree — there is nothing to route between",
        run: () => setSelectorOpen((v) => !v),
      },
      {
        id: "dlg.enginelag",
        label: "Show what this engine cannot evaluate",
        group: "Dialogue",
        keywords: `${lag.gates.length + lag.selectorRows.length} engine-lag`,
        enabled: lag.gates.length + lag.selectorRows.length > 0,
        disabledReason: "this engine evaluates every gate in this tree",
        run: () => {
          const gate = lag.gates[0];
          if (!gate) return;
          setMutedLag((m) => {
            if (!tree) return m;
            const next = new Set(m);
            next.delete(tree.tree_id);
            return next;
          });
          setSelectedNode(gate.node_id);
          setSelectedChoice({ nodeId: gate.node_id, index: gate.choice });
        },
      },
      {
        id: "dlg.reveal",
        label: "Reveal unreachable nodes",
        group: "Dialogue",
        keywords: `${unreachable.length} found`,
        enabled: unreachable.length > 0,
        disabledReason: "no unreachable nodes in this tree",
        run: () => {
          setValidatorOpen(true);
          setSelectedNode(unreachable[0] ?? null);
        },
      },
      {
        id: "dlg.fit",
        label: "Fit the dialogue graph to view",
        group: "View",
        hint: "⇧1",
        run: () => setFitTick((n) => n + 1),
      },
      {
        id: "dlg.tray",
        label: trayHidden ? "Show the inspector" : "Hide the inspector",
        group: "View",
        hint: kbd("I"),
        run: () => setTrayHidden((v) => !v),
      },
    ];
    registerCommands("dialogue", cmds);
    return () => unregisterCommands("dialogue");
  }, [
    addNode,
    doc.trees.length,
    editor.dirty,
    enter,
    improveDisabledReason,
    lag,
    mode,
    openSave,
    registerCommands,
    selectorOpen,
    testDisabledReason,
    trayHidden,
    tree,
    unregisterCommands,
  ]);

  const build = useMemo(
    () => (mode === "view" ? toBeats(doc, null, quest) : toBeats(doc, treeId)),
    [doc, mode, quest, treeId],
  );

  const counts = useMemo(() => {
    if (!tree) return `${doc.trees.length} trees`;
    const nodes = Object.keys(tree.nodes).length;
    const choices = Object.values(tree.nodes).reduce((n, node) => n + node.choices.length, 0);
    const gated = Object.values(tree.nodes).reduce(
      (n, node) => n + node.choices.filter((c) => c.conditions.length > 0).length,
      0,
    );
    return `${nodes} nodes · ${choices} choices${gated ? ` · ${gated} gated` : ""}`;
  }, [doc.trees.length, tree]);

  /** `canon dialogue select` reads the SAVED pack — the Rust command passes no
   *  tree payload because the verb takes none, unlike `dialogue test --tree`.
   *  So the moment a buffer op changes WHICH tree a state picks, its answer
   *  describes an order that is no longer on screen, and the rail's would-play
   *  grouping and the router's per-row pills would be last-save's verdicts drawn
   *  over the edited list. Doctrine 4: they go away with the reason.
   *
   *  What is absent, by row ownership: a `--trees <payload>` option on
   *  `canon dialogue select` (canon's half), which is what would let the
   *  selector answer follow the buffer the way the tester already does. */
  const selectStaleReason = useMemo(() => {
    const kinds = new Set<string>(editor.ops.map((op) => op.k));
    const moved = SELECTOR_SHAPING_OPS.find((k) => kinds.has(k));
    return moved
      ? `selector answer is from the saved pack — an unsaved ${moved} changes it. ⌘S re-runs canon dialogue select.`
      : null;
  }, [editor.ops]);

  const edit: GraphEdit | undefined = useMemo(() => {
    if (mode !== "edit" || !tree) return undefined;
    return {
      tree,
      structural: true,
      selected: selectedNode,
      selectedChoice,
      onSelect: onNodeClick,
      onSelectChoice: onChoiceClick,
      onPromptCommit: commitPrompt,
      onGesture: (cancel) => {
        gestureRef.current = cancel;
      },
      dirtyNodes: dirtyNodeIds(editor.ops),
      unreachable: new Set(unreachableNodes(tree)),
      // README §8's headline: the consequences are drawn ON THE CANVAS while
      // the confirm sheet names them, from the very same `Consequences` object.
      preview: pendingDelete
        ? {
            doomed: pendingDelete.kind === "node" ? pendingDelete.id : "",
            inbound: new Set(pendingDelete.inbound),
            newlyUnreachable: new Set(pendingDelete.newlyUnreachable),
          }
        : null,
      engineEvaluable: (token, kind) => engineSupports(token, kind, packInfo),
      engineReason: (token, kind) => engineReasonFor(token, kind, packInfo),
    };
  }, [
    commitPrompt,
    editor.ops,
    mode,
    onChoiceClick,
    onNodeClick,
    packInfo,
    pendingDelete,
    selectedChoice,
    selectedNode,
    tree,
  ]);

  return (
    <div className="dialogue-tab dlg-surface" data-mode={mode} data-testid="dialogue-surface">
      <ModeBar
        mode={mode}
        onMode={enter}
        treeLabel={tree?.label || tree?.tree_id || "—"}
        selectorText={selectorText(tree?.selector?.rows ?? null)}
        counts={counts}
        dirtyText={editor.summary ? dirtyChipText(editor.summary) : ""}
        onOpenUnsaved={() => setUnsavedOpen((v) => !v)}
        onSave={openSave}
        saving={saving}
        saveDisabledReason={editor.dirty ? "" : "nothing to save — the buffer is clean"}
        improveDisabledReason={improveDisabledReason}
        onImprove={() => setImproveOpen(true)}
        testDisabledReason={testDisabledReason}
      >
        <EngineChip vocab={vocab} packInfo={packInfo} />
        {mode === "view" ? (
          <div className="segmented dlg-reader">
            <button
              className={`seg-btn ${reader === "card" ? "active" : ""}`}
              onClick={() => setReader("card")}
            >
              Card
            </button>
            <button
              className={`seg-btn ${reader === "graph" ? "active" : ""}`}
              onClick={() => setReader("graph")}
            >
              Graph
            </button>
          </div>
        ) : null}
      </ModeBar>

      {unsavedOpen && editor.dirty ? (
        <div className="dlg-unsaved" role="dialog" aria-label="Unsaved edits">
          <p className="dlg-unsaved-note">
            <span className="kbd">{kbd("Z")}</span> steps back through these edits until you save.
            After saving you undo from History — {kbd("Z")} only reaches unsaved edits.
          </p>
          {editor.groups.map((group) => (
            <div key={group.target} className="dlg-unsaved-group">
              <span className="dlg-mono dlg-dim">{group.target}</span>
              {group.rows.map((row) => (
                <div key={row.index} className="dlg-unsaved-row">
                  <span>{row.label}</span>
                  <button
                    className="btn"
                    onClick={() => {
                      const why = editor.revert(row.index);
                      if (why) setSaveError(why);
                    }}
                  >
                    revert
                  </button>
                </div>
              ))}
            </div>
          ))}
          {saveError ? <p className="dlg-sheet-failed">{saveError}</p> : null}
          <div className="dlg-unsaved-actions">
            <button className="btn pri" onClick={openSave}>
              Save all
            </button>
          </div>
        </div>
      ) : null}

      <div className="dlg-columns" data-folded={graphFolded ? "1" : undefined}>
        <TreeRail
          doc={doc}
          vocab={vocab}
          activeTreeId={treeId}
          onOpenTree={(id) => {
            setActiveTree(key, id);
            setSelectedNode(null);
            setSelectedChoice(null);
          }}
          onNewTree={mode === "edit" ? newTree : undefined}
          select={selectStaleReason ? null : tester.selection}
          selectStaleReason={selectStaleReason}
          quests={
            quest
              ? [
                  {
                    id: String(quest.id ?? ""),
                    title: quest.title ?? "",
                    onOpen: onOpenQuest ? () => onOpenQuest(String(quest.id ?? "")) : undefined,
                  },
                ]
              : []
          }
          scenes={(show?.scenes ?? []).map((scene) => ({
            id: String(scene.id),
            title: scene.title || String(scene.id),
            actors: scene.actors.length,
            onOpen: onOpenScene ? () => onOpenScene(String(scene.id)) : undefined,
          }))}
          storage={
            show
              ? {
                  source: show.source,
                  field: show.storage_field,
                  legacyWritten: show.legacy_written ?? [],
                }
              : null
          }
        />
        <div className="dlg-canvas" data-mode={mode}>
          <span className="dlg-mode-pill" data-mode={mode}>
            {mode === "edit"
              ? "edit mode · esc to view"
              : mode === "test"
                ? "test mode · esc to view"
                : "view mode"}
          </span>
          {mode === "edit" ? (
            <ToolRail
              tool={tool}
              onTool={setTool}
              onAddNode={addNode}
              onDelete={() => selectedNode && previewDelete(selectedNode)}
              deleteDisabledReason={selectedNode ? "" : "select a node first"}
              onFit={() => setFitTick((n) => n + 1)}
            />
          ) : null}
          {/* TREATMENT 1: the tree banner. Mutable per tree (the mute is the
              banner only) and NEVER blocking — on today's dungeon engine every
              gate is amber, and that is correct rather than broken. */}
          <EngineLagBanner
            lag={lag}
            vocab={vocab}
            packInfo={packInfo}
            muted={!!tree && mutedLag.has(tree.tree_id)}
            onMute={() =>
              setMutedLag((s) => {
                if (!tree) return s;
                const next = new Set(s);
                if (next.has(tree.tree_id)) next.delete(tree.tree_id);
                else next.add(tree.tree_id);
                return next;
              })
            }
            onShowChoices={(gate) => {
              setSelectedNode(gate.node_id);
              setSelectedChoice({ nodeId: gate.node_id, index: gate.choice });
            }}
          />
          {search !== null ? (
            <div className="dlg-search">
              <input
                autoFocus
                className="dlg-search-input"
                placeholder="Search ids, prose and condition tokens…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          ) : null}
          {/* Board 06. An NPC with no tree used to return a bare sentence with
              no ModeBar and no rail, so there was no ＋ New tree, no Improve
              and no disabled-Test-with-a-reason — a dead end. The surface stays
              mounted and the routes in live here instead; Test and Improve are
              already disabled WITH their reasons above. */}
          {doc.trees.length === 0 ? (
            <div className="dialogue-empty dlg-empty" data-testid="dialogue-empty">
              <p>
                No dialogue tree yet. The greeting-only fallback is legal — this NPC will still
                talk.
              </p>
              <div className="dlg-empty-routes">
                <button
                  className="btn pri"
                  disabled={mode !== "edit" || !base.chrome.opening_greeting}
                  title={
                    mode !== "edit"
                      ? "enter Edit mode to author a tree"
                      : base.chrome.opening_greeting
                        ? "seeds the entry node with the greeting text"
                        : "this character has no opening greeting to seed from"
                  }
                  onClick={newTreeFromGreeting}
                >
                  Start a tree from the greeting
                </button>
                <button
                  className="btn"
                  disabled
                  title="canon dialogue improve re-authors EXISTING prose — there is none yet"
                >
                  ✨ Draft one with Improve
                </button>
                <button
                  className="btn"
                  disabled
                  title="tree.duplicate copies within one character; copying across characters needs a cross-NPC read this row does not own"
                >
                  Copy a tree from another NPC
                </button>
              </div>
              <p className="dlg-dim">
                Or use <span className="dlg-mono">＋ New tree</span> in the rail to start from an
                axis.
              </p>
            </div>
          ) : mode === "view" && reader === "card" ? (
            <DialogueCardMode beats={build.beats} edges={build.edges} />
          ) : (
            <DialogueGraphMode
              beats={build.beats}
              beatEdges={build.edges}
              edit={edit}
              minimap={mode === "edit"}
              fitTick={fitTick}
              dim={search ? searchMisses(build.beats, doc, treeId, search) : undefined}
            />
          )}
          {/* The router node — where the trees are seen TOGETHER. It sits under
              the canvas rather than inside the graph because one tree is on the
              canvas at a time (README Q9, "tree focus"), and this is the one
              place precedence is visible and editable. It stays in TEST mode
              too: that is where `canon dialogue select` runs, and the
              selector-level engine-lag divergence is its answer. */}
          {doc.trees.length > 1 ? (
            <div className="dlg-selector-slot" data-open={selectorOpen ? "1" : "0"}>
              <button className="dlg-selector-toggle" onClick={() => setSelectorOpen((v) => !v)}>
                {selectorOpen ? "▾" : "▸"} selector · {doc.trees.length} trees, first match wins
              </button>
              {selectorOpen ? (
                <SelectorNode
                  doc={doc}
                  activeTreeId={treeId}
                  select={selectStaleReason ? null : tester.selection}
                  selectStaleReason={selectStaleReason}
                  packInfo={packInfo}
                  editable={mode === "edit"}
                  onOpenTree={(id) => {
                    setActiveTree(key, id);
                    setSelectedNode(null);
                    setSelectedChoice(null);
                  }}
                  onOps={push}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {mode !== "view" && !trayHidden ? (
          <div className="dlg-tray">
            {validatorOpen || mode === "edit" ? (
              <ValidatorPanel
                npcLabel={npcLabel}
                report={report}
                stored={stored}
                onReveal={(nodeId) => setSelectedNode(nodeId)}
              />
            ) : null}
            {mode === "edit" && tree ? (
              <Inspector
                doc={doc}
                tree={tree}
                nodeId={selectedNode}
                choice={selectedChoice}
                packInfo={packInfo}
                vocab={vocab}
                worldPath={worldPath}
                onOps={push}
                onDeleteTree={() =>
                  setPendingDelete({
                    kind: "tree",
                    id: tree.tree_id,
                    inbound: [],
                    newlyUnreachable: [],
                    gatesLost: (tree.selector?.rows ?? []).length,
                    entryMoves: false,
                  })
                }
                onSelectNode={setSelectedNode}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "test" ? (
        <TesterDock
          tester={tester}
          treeLabel={tree?.label || tree?.tree_id || "—"}
          unsaved={editor.dirty}
          // The two repairs README §6 offers on a failing gate. Both edit the
          // SIMULATED state or the view — never the pack.
          onRepairQuest={(token) => {
            const [, questId, state] = token.split(":");
            if (!questId) return;
            tester.setState({
              ...tester.state,
              quests: { ...tester.state.quests, [questId]: state ?? "active" },
            });
          }}
          onJumpToNode={(nodeId) => setSelectedNode(nodeId)}
          onExpanded={setGraphFolded}
          onToggleGraph={() => setGraphFolded((v) => !v)}
        />
      ) : null}

      {switcherOpen ? (
        <TreeSwitcher
          doc={doc}
          vocab={vocab}
          onPick={(id) => {
            setActiveTree(key, id);
            setSwitcherOpen(false);
          }}
          // Steps 11–12's data, now that it exists: `⌘P` is trees AND scenes,
          // then the quests this character speaks for. Cross-surface rows paint
          // `--info` — "this belongs to another surface too".
          elsewhere={[
            ...(show?.scenes ?? []).map((scene) => ({
              id: `scene:${scene.id}`,
              label: scene.title || String(scene.id),
              detail: `scene · ${scene.actors.length} actors · ${scene.lines} lines`,
              pick: () => {
                setSwitcherOpen(false);
                onOpenScene?.(String(scene.id));
              },
            })),
            ...(quest
              ? [
                  {
                    id: `quest:${quest.id}`,
                    label: `${quest.title ?? quest.id} · quest dialogue`,
                    detail: "author this quest's conversation across every NPC in it",
                    pick: () => {
                      setSwitcherOpen(false);
                      onOpenQuest?.(String(quest.id ?? ""));
                    },
                  },
                ]
              : []),
          ]}
          onClose={() => setSwitcherOpen(false)}
        />
      ) : null}

      {pendingDelete ? (
        <DeletePreview
          consequences={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {sheetOpen ? (
        <SaveSheet
          npcLabel={npcLabel}
          groups={editor.groups}
          report={report}
          stored={stored}
          saving={saving}
          error={saveError}
          engineLag={lagLines}
          onCancel={() => setSheetOpen(false)}
          onSave={doSave}
        />
      ) : null}

      {improveOpen ? (
        <ImproveDialogue
          worldPath={worldPath}
          npcId={npcId}
          npcLabel={npcLabel}
          doc={doc}
          treeId={treeId}
          onOps={push}
          onNote={setNote}
          onClose={() => setImproveOpen(false)}
        />
      ) : null}

      {note ? (
        <p className="dlg-surface-note" data-testid="dialogue-note">
          {note}{" "}
          <button className="btn" onClick={() => setNote(null)}>
            dismiss
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** `/` search: which beats do NOT match, so the canvas can dim them. Matches
 *  node ids, prose and condition tokens — `resonance_shard` finds every gate
 *  referencing the item (README Q9). */
function searchMisses(
  beats: { id: string; label: string; prompt: string }[],
  doc: AuthorDoc,
  treeId: string | null,
  query: string,
): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set();
  const tree = doc.trees.find((t) => t.tree_id === treeId);
  const misses = new Set<string>();
  for (const beat of beats) {
    const node = tree?.nodes[beat.label];
    const hay = [
      beat.label,
      beat.prompt,
      ...(node?.choices ?? []).flatMap((c) => [c.text, ...c.conditions, ...c.effects]),
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) misses.add(beat.id);
  }
  return misses;
}
