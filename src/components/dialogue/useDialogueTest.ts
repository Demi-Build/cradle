// The tester's driver: `canon dialogue test` for the walk, `canon dialogue
// select` for the rail's would-play grouping (PLAN "The UI must not reimplement
// gating or selection").
//
// THE UI NEVER EVALUATES A GATE. Every verdict on screen — pass, fail, the
// failing condition's name, the effect ledger, the post-effect state, which
// tree a state selects — comes back from canon. There is one evaluator and it
// is not in TypeScript. The one thing this file decides is WHEN to ask.
//
// It tests the UNSAVED BUFFER: the tree travels to canon as a payload, never as
// a pack lookup, because testing what you just wrote is the point.
//
// Results are cached per `(tree CONTENT hash, state hash, node)` so a re-render
// or a step back costs nothing; a state edit — or any buffer op — invalidates by
// hashing into a new key, which is the PLAN's own suggestion, never a port of
// the evaluator. The tree's content is part of the key on purpose: keying on
// `tree_id` alone would replay a stale verdict over an edited buffer, which is
// the opposite of "Test tests the unsaved buffer".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DialogueSelectResult, type DialogueTestResult } from "../../lib/invoke";
import type { AuthorTree } from "./model";

/** The simulated state, in canon's P.2.3 sections. Every section is present and
 *  a missing one is EMPTY, never "everything true" — an absent inventory fails
 *  `has_item`, and the reason says the section was empty. */
export type SimState = {
  inventory: Record<string, number>;
  quests: Record<string, string>;
  clock: Record<string, string>;
  room: string | null;
  player: Record<string, string | number>;
  flags: Record<string, boolean>;
  segment: string | null;
  scenes_seen: string[];
  events: Record<string, string>;
  actors: Record<string, string>;
};

export function emptyState(): SimState {
  return {
    inventory: {},
    quests: {},
    clock: {},
    room: null,
    player: {},
    flags: {},
    segment: null,
    scenes_seen: [],
    events: {},
    actors: {},
  };
}

/** A named session-local state. NEVER written to the pack, and the panel says
 *  so in place (README Q5). */
export type Checkpoint = { name: string; state: SimState };

export type TranscriptEntry = {
  nodeId: string;
  speaker: string | null;
  prompt: string;
  /** The choice text the player took to leave this node. */
  took?: string;
  /** The effect ledger under the choice — the green rows. */
  fired?: DialogueTestResult["fired"];
};

function hash(value: unknown): string {
  return JSON.stringify(value);
}

/** canon's post-effect state, back in the `SimState` shape. canon normalises
 *  every section itself, but a section it has no opinion about must still be
 *  PRESENT here — the chips and the panel read `state.clock.window` directly,
 *  and a missing section would crash the dock rather than read as empty. */
function asSimState(raw: unknown): SimState {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<SimState>;
  const base = emptyState();
  return {
    inventory: src.inventory ?? base.inventory,
    quests: src.quests ?? base.quests,
    clock: src.clock ?? base.clock,
    room: src.room ?? base.room,
    player: src.player ?? base.player,
    flags: src.flags ?? base.flags,
    segment: src.segment ?? base.segment,
    scenes_seen: src.scenes_seen ?? base.scenes_seen,
    events: src.events ?? base.events,
    actors: src.actors ?? base.actors,
  };
}

export function useDialogueTest({
  worldPath,
  tree,
  npcId,
  enabled,
}: {
  worldPath: string;
  tree: AuthorTree | null;
  npcId?: string;
  enabled: boolean;
}) {
  const [state, setState] = useState<SimState>(emptyState);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<DialogueTestResult | null>(null);
  const [selection, setSelection] = useState<DialogueSelectResult | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, DialogueTestResult>());
  const [reachable, setReachable] = useState<Set<string>>(new Set());

  const current = nodeId ?? tree?.entry_node_id ?? null;

  // The CONTENT of the buffered tree, not its id: an edit to a prompt or a gate
  // must invalidate every cached verdict, or Test replays canon's answer about
  // text the author has already changed.
  const treeKey = useMemo(() => (tree ? hash(tree) : ""), [tree]);
  const stateKey = useMemo(() => hash(state), [state]);
  // The walk reads the tree through a ref and keys its effect on the CONTENT
  // hash: `tree` is rebuilt from the buffer on every render, so depending on
  // its identity would re-run the sweep forever.
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const walkedState = useRef(state);
  walkedState.current = state;

  // The walk. One round trip per (state, node); the cache makes a step back or
  // a re-render free.
  useEffect(() => {
    if (!enabled || !tree || !worldPath || !current) return;
    const key = `${treeKey}@${current}#${hash(state)}`;
    const hit = cache.current.get(key);
    if (hit) {
      setResult(hit);
      return;
    }
    let alive = true;
    api
      .dialogueTest(worldPath, tree, state, { node: current })
      .then((r) => {
        if (!alive) return;
        cache.current.set(key, r);
        setResult(r);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [current, enabled, state, treeKey, tree, worldPath]);

  // The selector re-runs whenever a selector-relevant axis changes, which is
  // any state change: which axes matter is the pack's business, not ours.
  useEffect(() => {
    if (!enabled || !worldPath || !npcId) return;
    let alive = true;
    api
      .dialogueSelect(worldPath, npcId, state)
      .then((r) => alive && setSelection(r))
      .catch(() => alive && setSelection(null));
    return () => {
      alive = false;
    };
  }, [enabled, npcId, state, worldPath]);

  // Seed the transcript with the current node whenever it is empty — on the
  // first walk, and again after `R` restarts. Keyed on the LENGTH so the
  // re-seed is idempotent: once it is 1 the effect re-runs and does nothing.
  const transcriptLength = transcript.length;
  useEffect(() => {
    if (!result) return;
    setTranscript((t) =>
      t.length === 0
        ? [
            {
              nodeId: result.node.node_id,
              speaker: result.node.speaker,
              prompt: result.node.prompt,
            },
          ]
        : t,
    );
  }, [result, transcriptLength]);

  /** Take a choice: canon fires its effects and names the next node. A blocked
   *  choice comes back REFUSED with the failing condition named — the tester
   *  never silently declines. */
  const choose = useCallback(
    async (index: number) => {
      if (!tree || !worldPath || !current) return;
      try {
        const r = await api.dialogueTest(worldPath, tree, state, { node: current, choose: index });
        if (r.refused) {
          setError(r.refused);
          return;
        }
        setError(null);
        const took = r.choices[index]?.text ?? "";
        setTranscript((t) => [
          ...t.slice(0, -1),
          { ...t[t.length - 1], took, fired: r.fired },
          ...(r.next_node_id && tree.nodes[r.next_node_id]
            ? [
                {
                  nodeId: r.next_node_id,
                  speaker: tree.nodes[r.next_node_id].speaker,
                  prompt: tree.nodes[r.next_node_id].prompt,
                },
              ]
            : []),
        ]);
        setState(asSimState(r.post_effect_state));
        setNodeId(r.next_node_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [current, state, tree, worldPath],
  );

  const restart = useCallback(() => {
    setNodeId(null);
    setTranscript([]);
    setError(null);
  }, []);

  /** Step back one exchange — `⌫` in Test mode. */
  const back = useCallback(() => {
    setTranscript((t) => {
      if (t.length <= 1) return t;
      const next = t.slice(0, -1);
      setNodeId(next[next.length - 1].nodeId);
      return next;
    });
  }, []);

  const snapshot = useCallback(
    (name: string) => setCheckpoints((c) => [...c, { name, state: structuredClone(state) }]),
    [state],
  );
  const restore = useCallback(
    (name: string) => {
      const found = checkpoints.find((c) => c.name === name);
      if (!found) return;
      setState(structuredClone(found.state));
      restart();
    },
    [checkpoints, restart],
  );

  // The reachability WALK. `unreachableHere` is a claim about the whole tree in
  // this state, so it needs the whole tree walked: a breadth-first sweep from
  // the entry that follows canon's own per-choice `pass` verdicts, one round
  // trip per node and every one of them shared with the walk's cache above.
  // Nothing here re-evaluates a gate — the frontier is canon's answers.
  useEffect(() => {
    const walked = treeRef.current;
    if (!enabled || !walked || !worldPath) {
      setReachable((current) => (current.size === 0 ? current : new Set()));
      return;
    }
    let alive = true;
    const entry = walked.entry_node_id;
    void (async () => {
      const seen = new Set<string>([entry]);
      const queue = [entry];
      while (queue.length) {
        const id = queue.shift()!;
        if (!(id in walked.nodes)) continue;
        const key = `${treeKey}@${id}#${stateKey}`;
        let r = cache.current.get(key);
        if (!r) {
          try {
            r = await api.dialogueTest(worldPath, walked, walkedState.current, { node: id });
          } catch {
            return;
          }
          cache.current.set(key, r);
        }
        if (!alive) return;
        for (const choice of r.choices) {
          const next = choice.next_node_id;
          if (choice.pass && next && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      if (!alive) return;
      // Same members, same object: a fresh Set every sweep would re-render for
      // no reason, and `tree` is a new object on every render.
      setReachable((current) =>
        current.size === seen.size && [...seen].every((id) => current.has(id)) ? current : seen,
      );
    })();
    return () => {
      alive = false;
    };
  }, [enabled, stateKey, treeKey, worldPath]);

  /** Every node the walk cannot reach IN THIS STATE, split from the nodes no
   *  state can reach (README's unreachable table row). The split is computed
   *  from canon's own per-choice verdicts, never re-evaluated here — the walk
   *  above is a full traversal from the entry, so a node three hops down a
   *  passing chain is reachable and is not named. */
  const unreachableHere = useMemo(() => {
    if (!tree || !result) return [];
    return Object.keys(tree.nodes).filter((id) => !reachable.has(id) && id !== result.node.node_id);
  }, [reachable, result, tree]);

  return {
    state,
    setState,
    result,
    selection,
    transcript,
    checkpoints,
    error,
    nodeId: current,
    choose,
    restart,
    back,
    snapshot,
    restore,
    unreachableHere,
    /** The tester walks the UNSAVED buffer and says so. */
    testsBuffer: true,
  };
}

export type DialogueTester = ReturnType<typeof useDialogueTest>;
