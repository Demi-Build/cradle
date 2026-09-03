// The selector (router) node — README Q4 affordance 3: *what plays next, and
// why?*
//
// EXTENDS the old quest-gate junction, which `buildDialogue` synthesised from
// the four `dialogue_tree*` fields. That junction is this node with only
// `quest:` rows, so a quest-state NPC gets exactly the picture it had — inside
// a frame that also carries the other seven axes.
//
// Two rules the design pins and this file keeps, both easy to lose:
//
//   • SELECTOR PRECEDENCE IS DATA, NOT LAYOUT. Dragging a row is a `tree.rank`
//     op that changes behaviour — never a view preference. It lands in the
//     unsaved list and `⌘Z` walks it back, and the reorder sheet names which
//     states change tree before it commits (README §8).
//   • The last row is ALWAYS `otherwise → default`. A fallback that scrolled
//     off or sorted elsewhere would make "what happens when nothing matches"
//     invisible, and that is the one question a router node exists to answer.
//
// Which tree a state actually selects is `canon dialogue select`'s answer, never
// this component's: rows render the status canon returned (`selected` /
// `blocked` / `shadowed`) and say why not. The selector-level ENGINE LAG case —
// the engine skipping a row it cannot evaluate and falling through to a
// different tree than the tester picks — gets the same loud, non-blocking
// treatment as a gated choice, because it is the same doctrine 10 divergence.

import { useState } from "react";
import { engineVerdict } from "./grammar";
import {
  orderedTrees,
  rankConsequences,
  type AuthorDoc,
  type AuthorTree,
  type RankConsequence,
} from "./model";
import type { EditOp } from "./ops";
import type { DialogueSelectResult } from "../../lib/invoke";
import type { PackInfo } from "../../lib/invoke";

export function SelectorNode({
  doc,
  activeTreeId,
  select,
  selectStaleReason = null,
  packInfo,
  editable,
  onOpenTree,
  onOps,
}: {
  doc: AuthorDoc;
  activeTreeId: string | null;
  /** `canon dialogue select`'s answer, when the tester is running. */
  select?: DialogueSelectResult | null;
  /** Why no per-row status is being drawn. `canon dialogue select` reads the
   *  SAVED pack (it takes no `--trees` payload, unlike `dialogue test`), so a
   *  buffered `tree.rank` / `tree.selector` / `tree.add` / `tree.remove` makes
   *  its answer describe an order that is no longer on screen. */
  selectStaleReason?: string | null;
  packInfo: PackInfo | null;
  /** Reordering is a structural edit — Edit mode only. */
  editable: boolean;
  onOpenTree: (treeId: string) => void;
  onOps: (ops: EditOp[]) => void;
}) {
  const ordered = orderedTrees(doc);
  const gated = ordered.filter((t) => t.selector !== null);
  const fallback = ordered.find((t) => t.selector === null) ?? null;
  // Precedence is RANK, and this node draws the fallback as the `otherwise`
  // row whatever its rank is. When the fallback is not actually last, every
  // gated row drawn above it is dead — canon's `validate_trees` says so in
  // those words — so the node names it rather than drawing an order canon
  // does not resolve.
  const fallbackLast = fallback === null || ordered[ordered.length - 1] === fallback;
  const shadowedByFallback = fallbackLast
    ? []
    : ordered.slice(ordered.indexOf(fallback) + 1).map((t) => t.tree_id);
  const [pending, setPending] = useState<RankConsequence | null>(null);
  const statusOf = new Map(select?.trees.map((row) => [row.tree_id, row]) ?? []);

  const move = (treeId: string, delta: number) => {
    const ids = ordered.map((t) => t.tree_id);
    const at = ids.indexOf(treeId);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(at, 1)[0]);
    setPending(rankConsequences(doc, next, treeId));
  };

  return (
    <div className="dlg-selector" data-testid="dialogue-selector-node">
      <header className="dlg-selector-head">
        <span className="dlg-mono">selector</span>
        <span className="dlg-dim">first match wins, top to bottom</span>
        <span className="dlg-rail-count">{ordered.length}</span>
      </header>

      {gated.length === 0 ? (
        <p className="dlg-selector-empty">
          This character has one tree and no selector — it always plays. Give a tree a selector to
          route between them.
        </p>
      ) : null}

      <ol className="dlg-selector-rows">
        {gated.map((tree, i) => (
          <SelectorRow
            key={tree.tree_id}
            tree={tree}
            rank={i + 1}
            active={tree.tree_id === activeTreeId}
            status={statusOf.get(tree.tree_id) ?? null}
            packInfo={packInfo}
            editable={editable}
            // Enablement from the index `move` actually uses, not the gated
            // one: with the fallback out of place the two disagree and the
            // mis-ordering could not be repaired from this node.
            first={ordered.indexOf(tree) === 0}
            last={ordered.indexOf(tree) === ordered.length - 1}
            onOpen={() => onOpenTree(tree.tree_id)}
            onMove={(delta) => move(tree.tree_id, delta)}
          />
        ))}
        {/* Always last, always present: what happens when nothing matches. */}
        <li className="dlg-selector-row fallback" data-testid="dialogue-selector-fallback">
          <span className="dlg-selector-rank dlg-mono">⌄</span>
          <span className="dlg-mono dlg-dim">otherwise</span>
          {fallback ? (
            <button className="dlg-selector-open" onClick={() => onOpenTree(fallback.tree_id)}>
              → {fallback.label || fallback.tree_id}
            </button>
          ) : (
            <span className="dlg-selector-why warn">
              → nothing. This character has no fallback tree, so a state matching no row falls
              through to the greeting only.
            </span>
          )}
        </li>
      </ol>

      {selectStaleReason ? (
        <p className="dlg-selector-lag" data-testid="dialogue-selector-stale">
          ⚠ {selectStaleReason}
        </p>
      ) : null}

      {shadowedByFallback.length > 0 ? (
        <p className="dlg-selector-lag" data-testid="dialogue-selector-fallback-order">
          ⚠ The fallback <span className="dlg-mono">{fallback?.tree_id}</span> is ranked ahead of{" "}
          <span className="dlg-mono">{shadowedByFallback.join(", ")}</span>. It matches every state,
          so those trees can never be selected — lift them above it with ↑ to repair the order.
        </p>
      ) : null}

      {select?.engine.diverges ? (
        <p className="dlg-selector-lag" data-testid="dialogue-selector-lag">
          ⚠ {select.engine.reason}
        </p>
      ) : null}

      {pending ? (
        <div className="dlg-sheet-scrim" role="dialog" aria-label="Reorder selector rows">
          <div className="dlg-sheet">
            <h3 className="dlg-sheet-title">Reorder the selector?</h3>
            <p className="dlg-sheet-note">
              Row order <strong>is</strong> the precedence rule — reordering is a semantic edit, not
              a cosmetic one. It lands in the unsaved buffer; ⌘S is still what writes.
            </p>
            <ul className="dlg-delete-consequences">
              {pending.changes.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <div className="dlg-sheet-actions">
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                className="btn pri"
                onClick={() => {
                  onOps([{ k: "tree.rank", order: pending.order }]);
                  setPending(null);
                }}
              >
                Reorder
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SelectorRow({
  tree,
  rank,
  active,
  status,
  packInfo,
  editable,
  first,
  last,
  onOpen,
  onMove,
}: {
  tree: AuthorTree;
  rank: number;
  active: boolean;
  status: DialogueSelectResult["trees"][number] | null;
  packInfo: PackInfo | null;
  editable: boolean;
  first: boolean;
  last: boolean;
  onOpen: () => void;
  onMove: (delta: number) => void;
}) {
  const rows = tree.selector?.rows ?? [];
  // A row the engine cannot evaluate is the SELECTOR-level engine-lag case:
  // the engine falls through to the next matching row while the tester picks
  // this tree. Loud, named, and never blocking. TOKEN-level, because an engine
  // block can declare `quest:` at selector scope and still honour only some of
  // its states — which is exactly what the dungeon pack does.
  const blind = rows
    .map((token) => ({ token, verdict: engineVerdict(token, "condition", packInfo, "selector") }))
    .filter((row) => !row.verdict.ok);
  return (
    <li
      className={`dlg-selector-row ${active ? "on" : ""}`}
      data-status={status?.status}
      data-lag={blind.length ? "1" : undefined}
    >
      <span className="dlg-selector-rank dlg-mono">{rank}</span>
      <span className="dlg-mono dlg-selector-token">{rows.join(" · ") || "(no rows)"}</span>
      <button className="dlg-selector-open" onClick={onOpen}>
        → {tree.label || tree.tree_id}
      </button>
      {status ? (
        <span className="dlg-rail-status" data-status={status.status}>
          {status.status === "selected"
            ? "would play now"
            : status.status === "blocked"
              ? "blocked by state"
              : "shadowed"}
        </span>
      ) : null}
      {status?.why_not ? <span className="dlg-selector-why">{status.why_not}</span> : null}
      {blind.length ? (
        <span className="dlg-selector-lag">
          ⚠ {blind[0].verdict.reason ?? "this row is not evaluated in game"}
        </span>
      ) : null}
      {editable ? (
        <span className="dlg-selector-drag">
          <button
            className="dlg-row-x"
            disabled={first}
            title={first ? "already first" : "try this tree earlier — changes what plays"}
            aria-label={`Move ${tree.label || tree.tree_id} earlier`}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            className="dlg-row-x"
            disabled={last}
            title={last ? "already last" : "try this tree later — changes what plays"}
            aria-label={`Move ${tree.label || tree.tree_id} later`}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
        </span>
      ) : null}
    </li>
  );
}
