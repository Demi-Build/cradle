// The navigator rail — 218px, left edge of the canvas (README Q4 affordance 1:
// *what trees exist?*).
//
// EXTENDS the axis registry (`axes.ts`): grouping, counts and the group order
// all come from `pack info`'s `selector_axes`, so a template that adds an axis
// gets a rail group for free. Nothing here is a hardcoded list of four
// variants — that frame is exactly what the selector model replaced.
//
// Three things the design pins and this file keeps:
//   • an EMPTY tree renders as an italic dim row with a dashed dot and count 0,
//     and opening it offers to author it. It is never collapsed away.
//   • the selector token renders in mono under any non-obvious row, so the rail
//     answers "why does this one play?" without opening it.
//   • when the tester is running, rows group into WOULD PLAY NOW / blocked by
//     state — the answer to "which of my nine trees does this state reach?",
//     which no amount of graph reading gives you. It comes from
//     `canon dialogue select`; the rail never decides it.
//
// Steps 9, 11 and 12 finished the three sections it left open: the would-play /
// blocked GROUPING (which is `canon dialogue select`'s answer, restructured —
// grouping by what the state reaches beats reading nine trees), the scene rows
// (real, deep-linking to the scene's own tab) and the quest deep-links.

import { useMemo, useState } from "react";
import { axesOf, groupTrees, type TreeGroup } from "./axes";
import type { AuthorDoc, AuthorTree } from "./model";
import type { DialogueVocab } from "./grammar";
import type { DialogueSelectResult } from "../../lib/invoke";
import { kbd } from "../../lib/keys";

/** Where the trees are grouped from: their AXIS when nothing is simulated, and
 *  WOULD-PLAY / BLOCKED once the tester is running. The second grouping is the
 *  tester's answer to "which of my nine trees does this state actually reach?",
 *  which no amount of graph reading gives you — so it takes over the rail while
 *  a state exists, and the axis grouping comes back when it does not. */
function selectGroups(doc: AuthorDoc, select: DialogueSelectResult): TreeGroup[] {
  const status = new Map(select.trees.map((row) => [row.tree_id, row.status]));
  const bucket = (tree: AuthorTree) =>
    status.get(tree.tree_id) === "selected" ? "would play now" : "blocked by state";
  const groups: TreeGroup[] = [
    { id: "would-play", label: "would play now", trees: [] },
    { id: "blocked", label: "blocked by state", trees: [] },
  ];
  for (const tree of doc.trees) {
    groups[bucket(tree) === "would play now" ? 0 : 1].trees.push(tree);
  }
  return groups.filter((g) => g.trees.length > 0);
}

export function TreeRail({
  doc,
  vocab,
  activeTreeId,
  onOpenTree,
  onNewTree,
  select,
  selectStaleReason = null,
  quests = [],
  scenes = [],
  storage = null,
}: {
  doc: AuthorDoc;
  vocab: DialogueVocab;
  activeTreeId: string | null;
  onOpenTree: (treeId: string) => void;
  onNewTree?: (axis: string) => void;
  /** `canon dialogue select`'s answer, when the tester is running. */
  select?: DialogueSelectResult | null;
  /** Why the would-play grouping is not being drawn — set when a buffer edit
   *  has outdated canon's answer. Doctrine 4: the grouping goes away WITH ITS
   *  REASON rather than rendering last save's verdicts over the edited order. */
  selectStaleReason?: string | null;
  quests?: { id: string; title: string; onOpen?: () => void }[];
  scenes?: { id: string; title: string; actors: number; onOpen?: () => void }[];
  /** Where the NPC's trees came from — `dialogue_trees` or the legacy four.
   *  Surfaced because it is the difference between an edited pack and a
   *  never-edited one, and the author should never have to guess (step 9). */
  storage?: { source: string; field: string; legacyWritten: string[] } | null;
}) {
  const [filter, setFilter] = useState("");
  const [axisOpen, setAxisOpen] = useState(false);
  const groups: TreeGroup[] = useMemo(
    () => (select ? selectGroups(doc, select) : groupTrees(doc, vocab)),
    [doc, select, vocab],
  );
  const statusOf = useMemo(() => {
    const map = new Map<string, { status: string; why: string | null }>();
    for (const row of select?.trees ?? [])
      map.set(row.tree_id, { status: row.status, why: row.why_not });
    return map;
  }, [select]);

  const q = filter.trim().toLowerCase();
  const matches = (tree: AuthorTree) =>
    !q ||
    tree.label.toLowerCase().includes(q) ||
    tree.tree_id.toLowerCase().includes(q) ||
    (tree.selector?.rows ?? []).some((r) => r.toLowerCase().includes(q));

  return (
    <aside className="dlg-rail" data-testid="dialogue-rail">
      <div className="dlg-rail-head">
        <span className="dlg-mono">trees</span>
        <span className="dlg-rail-count">{doc.trees.length}</span>
        <span className="kbd">{kbd("P")}</span>
      </div>
      {selectStaleReason ? (
        <p className="dlg-rail-stale" data-testid="dialogue-select-stale">
          ⚠ {selectStaleReason}
        </p>
      ) : null}
      <input
        className="dlg-rail-filter"
        placeholder="Filter trees…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter trees"
      />
      {groups.map((group) => {
        const shown = group.trees.filter(matches);
        if (shown.length === 0) return null;
        return (
          <section key={group.id} className="dlg-rail-group">
            <header className="dlg-rail-group-head">
              <span className="dlg-mono">{group.label.toLowerCase()}</span>
              <span className="dlg-rail-count">· {group.trees.length}</span>
            </header>
            {shown.map((tree) => {
              const nodes = Object.keys(tree.nodes).length;
              const status = statusOf.get(tree.tree_id);
              return (
                <button
                  key={tree.tree_id}
                  className={`dlg-rail-row ${tree.tree_id === activeTreeId ? "on" : ""} ${
                    nodes === 0 ? "empty" : ""
                  }`}
                  data-status={status?.status}
                  title={
                    status?.why ??
                    (nodes === 0 ? "empty tree — opening it offers to author it" : undefined)
                  }
                  onClick={() => onOpenTree(tree.tree_id)}
                >
                  <span className="dlg-rail-label">{tree.label || tree.tree_id}</span>
                  <span className="dlg-rail-count">{nodes}</span>
                  {tree.selector?.rows.length ? (
                    <span className="dlg-mono dlg-dim dlg-rail-token">
                      {tree.selector.rows.join(" · ")}
                    </span>
                  ) : null}
                  {status ? (
                    <span className="dlg-rail-status" data-status={status.status}>
                      {status.status === "selected"
                        ? "would play now"
                        : status.status === "blocked"
                          ? "blocked by state"
                          : "shadowed"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </section>
        );
      })}

      <section className="dlg-rail-group">
        <header className="dlg-rail-group-head">
          <span className="dlg-mono">scenes</span>
          <span className="dlg-rail-count">· {scenes.length}</span>
        </header>
        {scenes.length === 0 ? (
          <p className="dlg-rail-empty">
            no scenes — this character is not an actor in any group scene yet.
          </p>
        ) : (
          scenes.map((scene) => (
            <button
              key={scene.id}
              className="dlg-rail-row scene"
              disabled={!scene.onOpen}
              title={
                scene.onOpen
                  ? "open this scene — one scene, many surfaces; editing there edits it everywhere"
                  : "this scene lives on its own Scene tab"
              }
              onClick={scene.onOpen}
            >
              <span className="dlg-rail-label">{scene.title}</span>
              <span className="dlg-rail-count">{scene.actors}◍</span>
            </button>
          ))
        )}
        <p className="dlg-rail-note">scenes are events — this character is one actor</p>
      </section>

      <section className="dlg-rail-group">
        <header className="dlg-rail-group-head">
          <span className="dlg-mono">quests</span>
          <span className="dlg-rail-count">· {quests.length}</span>
        </header>
        {quests.length === 0 ? (
          <p className="dlg-rail-empty">no quest — this character's lines are unconditional.</p>
        ) : (
          quests.map((quest) => (
            <button
              key={quest.id}
              className="dlg-rail-row quest"
              disabled={!quest.onOpen}
              title={
                quest.onOpen
                  ? "author this quest's conversation across every NPC in it"
                  : "this quest's dialogue lives on the quest's own Dialogue tab"
              }
              onClick={quest.onOpen}
            >
              <span className="dlg-rail-label">{quest.title || quest.id}</span>
              <span className="dlg-rail-count">→</span>
            </button>
          ))
        )}
      </section>

      {storage ? (
        <p className="dlg-rail-storage" data-testid="dialogue-rail-storage">
          stored in <span className="dlg-mono">{storage.field}</span>
          {storage.source === "legacy" ? (
            <>
              {" "}
              — not yet: this NPC still carries the legacy{" "}
              <span className="dlg-mono">dialogue_tree*</span> keys, imported as{" "}
              <span className="dlg-mono">quest:</span> selectors. The first save writes both.
            </>
          ) : (
            <>
              {" "}
              · engine copy in{" "}
              <span className="dlg-mono">
                {storage.legacyWritten.length ? storage.legacyWritten.join(", ") : "no legacy key"}
              </span>
            </>
          )}
        </p>
      ) : null}

      <div className="dlg-rail-new">
        <button className="btn" onClick={() => setAxisOpen((v) => !v)}>
          ＋ New tree — pick a selector axis
        </button>
        {axisOpen ? (
          <ul className="dlg-axis-picker">
            {axesOf(vocab).map((axis) => (
              <li key={axis.id}>
                <button
                  className="dlg-axis-row"
                  disabled={!onNewTree}
                  title={onNewTree ? axis.hint : "structural editing lands with Edit mode"}
                  onClick={() => {
                    onNewTree?.(axis.id);
                    setAxisOpen(false);
                  }}
                >
                  <span className="dlg-axis-label">{axis.label}</span>
                  <span className="dlg-dim">{axis.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}
