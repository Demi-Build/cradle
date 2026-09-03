// The 300px inspector tray (README Q1: "everything structural edits in a 300px
// inspector tray").
//
// The split is by COST OF BEING WRONG. Re-typing a line is cheap and constant,
// so the prompt edits in place on the node; adding a condition is precise and
// vocabulary-driven, so it lives here where the level editor already trained
// users to look.
//
// Every gesture in this file emits one or more `EditOp`s and nothing else — the
// tray never mutates a document, never calls a verb and never writes a file.
// `⌘S` remains the only write.

import { useState } from "react";
import { ConditionRow, EffectRow, TokenPaste } from "./ConditionRow";
import { EngineLagTrayNote } from "./EngineLag";
import { EntityPicker } from "./EntityPicker";
import { engineReasonFor, engineSupports, formatToken, type DialogueVocab } from "./grammar";
import { axesOf } from "./axes";
import type { AuthorDoc, AuthorTree } from "./model";
import { liftAboveFallbackOps, type EditOp } from "./ops";
import type { PackInfo } from "../../lib/invoke";

export function Inspector({
  doc,
  tree,
  nodeId,
  choice,
  packInfo,
  vocab,
  worldPath,
  onOps,
  onDeleteTree,
  onSelectNode,
}: {
  /** The whole character's document — the selector picker needs the sibling
   *  trees' ranks to keep a newly-gated tree ahead of the fallback. */
  doc: AuthorDoc;
  tree: AuthorTree;
  nodeId: string | null;
  choice: { nodeId: string; index: number } | null;
  packInfo: PackInfo | null;
  vocab: DialogueVocab;
  worldPath: string;
  onOps: (ops: EditOp[]) => void;
  onDeleteTree: () => void;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const [pasting, setPasting] = useState<"conditions" | "effects" | null>(null);
  const [selectorPickerOpen, setSelectorPickerOpen] = useState(false);
  const node = nodeId ? tree.nodes[nodeId] : null;
  const picked = choice && node && choice.nodeId === nodeId ? node.choices[choice.index] : null;
  const evaluable = (token: string, kind: "condition" | "effect") =>
    engineSupports(token, kind, packInfo);
  const reason = (token: string, kind: "condition" | "effect") =>
    engineReasonFor(token, kind, packInfo);

  if (!node) {
    return (
      <div className="dlg-inspector" data-testid="dialogue-inspector">
        <p className="dlg-inspector-empty">
          Select a node to edit it. Double-click its line on the canvas to edit the prose in place.
        </p>
        <TreeSection
          tree={tree}
          vocab={vocab}
          onOps={onOps}
          onDeleteTree={onDeleteTree}
          onOpenSelectorPicker={() => setSelectorPickerOpen(true)}
        />
        {selectorPickerOpen ? (
          <SelectorPicker
            doc={doc}
            tree={tree}
            vocab={vocab}
            packInfo={packInfo}
            onOps={onOps}
            onClose={() => setSelectorPickerOpen(false)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="dlg-inspector" data-testid="dialogue-inspector">
      <header className="dlg-inspector-head">
        <span className="dlg-mono">node</span>
        <span className="dlg-inspector-id">{node.node_id}</span>
        <button
          className="btn dang"
          onClick={() => onSelectNode(node.node_id)}
          title="Delete this node — every consequence is previewed first"
        >
          Delete…
        </button>
      </header>

      <label className="dlg-field">
        <span>speaker</span>
        <input
          value={node.speaker ?? ""}
          placeholder="— the tree's character —"
          onChange={(e) =>
            onOps([
              {
                k: "node.speaker",
                tree: tree.tree_id,
                node_id: node.node_id,
                value: e.target.value || null,
              },
            ])
          }
        />
      </label>

      <section className="dlg-inspector-sect">
        <header>
          <span>choices</span>
          <span className="dlg-rail-count">{node.choices.length}</span>
          <button
            className="btn"
            onClick={() =>
              onOps([
                {
                  k: "choice.add",
                  tree: tree.tree_id,
                  node_id: node.node_id,
                  index: node.choices.length,
                  choice: { text: "" },
                },
              ])
            }
          >
            ＋ choice
          </button>
        </header>
        {node.choices.map((c, i) => (
          <div key={i} className={`dlg-choice-edit ${choice?.index === i ? "on" : ""}`}>
            <span className="dlg-choice-n">{i + 1}</span>
            <input
              value={c.text}
              placeholder="choice text"
              aria-label={`choice ${i + 1} text`}
              onChange={(e) =>
                onOps([
                  {
                    k: "choice.text",
                    tree: tree.tree_id,
                    node_id: node.node_id,
                    index: i,
                    value: e.target.value,
                  },
                ])
              }
            />
            <select
              value={c.next_node_id ?? ""}
              aria-label={`choice ${i + 1} target`}
              onChange={(e) =>
                onOps([
                  {
                    k: "choice.target",
                    tree: tree.tree_id,
                    node_id: node.node_id,
                    index: i,
                    value: e.target.value || null,
                  },
                ])
              }
            >
              <option value="">— ends the conversation —</option>
              {Object.keys(tree.nodes).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
              {c.next_node_id && !(c.next_node_id in tree.nodes) ? (
                <option value={c.next_node_id}>{c.next_node_id} (missing)</option>
              ) : null}
            </select>
            <button
              className="dlg-row-x"
              aria-label={`Remove choice ${i + 1}`}
              onClick={() =>
                onOps([{ k: "choice.remove", tree: tree.tree_id, node_id: node.node_id, index: i }])
              }
            >
              ×
            </button>
          </div>
        ))}
        {node.choices.length === 0 ? (
          <p className="dlg-inspector-note">terminal — adding a choice clears the badge.</p>
        ) : null}
      </section>

      {picked ? (
        <>
          <section className="dlg-inspector-sect">
            <header>
              <span>conditions</span>
              <span className="dlg-rail-count">{picked.conditions.length}</span>
              <button className="btn" onClick={() => setPasting("conditions")}>
                paste tokens
              </button>
            </header>
            {pasting === "conditions" ? (
              <TokenPaste
                tokens={picked.conditions}
                scope="tree"
                vocab={vocab}
                kind="condition"
                onCancel={() => setPasting(null)}
                onCommit={(tokens) => {
                  onOps([
                    {
                      k: "choice.conditions",
                      tree: tree.tree_id,
                      node_id: choice!.nodeId,
                      index: choice!.index,
                      tokens,
                    },
                  ]);
                  setPasting(null);
                }}
              />
            ) : (
              <>
                {picked.conditions.map((token, i) => (
                  <ConditionRow
                    key={`${token}#${i}`}
                    token={token}
                    scope="tree"
                    vocab={vocab}
                    packInfo={packInfo}
                    engineEvaluable={evaluable(token, "condition")}
                    engineReason={reason(token, "condition")}
                    onChange={(next) => {
                      const tokens = [...picked.conditions];
                      tokens[i] = next;
                      onOps([
                        {
                          k: "choice.conditions",
                          tree: tree.tree_id,
                          node_id: choice!.nodeId,
                          index: choice!.index,
                          tokens,
                        },
                      ]);
                    }}
                    onRemove={() =>
                      onOps([
                        {
                          k: "choice.conditions",
                          tree: tree.tree_id,
                          node_id: choice!.nodeId,
                          index: choice!.index,
                          tokens: picked.conditions.filter((_, j) => j !== i),
                        },
                      ])
                    }
                  />
                ))}
                <button
                  className="btn"
                  onClick={() =>
                    onOps([
                      {
                        k: "choice.conditions",
                        tree: tree.tree_id,
                        node_id: choice!.nodeId,
                        index: choice!.index,
                        tokens: [...picked.conditions, formatToken(vocab.condition_namespaces[0])],
                      },
                    ])
                  }
                >
                  ＋ condition
                </button>
                {/* TREATMENT 3 of the engine-lag layer, the tray half: the
                    namespace named, what the engine does instead, and the
                    "why is this allowed?" answer (README screen 03). */}
                <EngineLagTrayNote
                  tokens={picked.conditions}
                  vocab={vocab}
                  packInfo={packInfo}
                  scope="tree"
                />
              </>
            )}
          </section>

          <section className="dlg-inspector-sect">
            <header>
              <span>effects</span>
              <span className="dlg-rail-count">{picked.effects.length}</span>
              <button className="btn" onClick={() => setPasting("effects")}>
                paste tokens
              </button>
            </header>
            {pasting === "effects" ? (
              <TokenPaste
                tokens={picked.effects}
                scope="effects"
                vocab={vocab}
                kind="effect"
                onCancel={() => setPasting(null)}
                onCommit={(tokens) => {
                  onOps([
                    {
                      k: "choice.effects",
                      tree: tree.tree_id,
                      node_id: choice!.nodeId,
                      index: choice!.index,
                      tokens,
                    },
                  ]);
                  setPasting(null);
                }}
              />
            ) : (
              <>
                {picked.effects.map((token, i) => (
                  <EffectRow
                    key={`${token}#${i}`}
                    token={token}
                    vocab={vocab}
                    packInfo={packInfo}
                    engineEvaluable={evaluable(token, "effect")}
                    engineReason={reason(token, "effect")}
                    onChange={(next) => {
                      const tokens = [...picked.effects];
                      tokens[i] = next;
                      onOps([
                        {
                          k: "choice.effects",
                          tree: tree.tree_id,
                          node_id: choice!.nodeId,
                          index: choice!.index,
                          tokens,
                        },
                      ]);
                    }}
                    onRemove={() =>
                      onOps([
                        {
                          k: "choice.effects",
                          tree: tree.tree_id,
                          node_id: choice!.nodeId,
                          index: choice!.index,
                          tokens: picked.effects.filter((_, j) => j !== i),
                        },
                      ])
                    }
                  />
                ))}
                <button
                  className="btn"
                  onClick={() =>
                    onOps([
                      {
                        k: "choice.effects",
                        tree: tree.tree_id,
                        node_id: choice!.nodeId,
                        index: choice!.index,
                        tokens: [...picked.effects, formatToken(vocab.effects[0])],
                      },
                    ])
                  }
                >
                  ＋ effect
                </button>
                <EngineLagTrayNote
                  tokens={picked.effects}
                  vocab={vocab}
                  packInfo={packInfo}
                  scope="effects"
                />
              </>
            )}
          </section>
        </>
      ) : (
        <p className="dlg-inspector-note">
          Select a choice row on the node to gate it or give it effects.
        </p>
      )}

      <TreeSection
        tree={tree}
        vocab={vocab}
        onOps={onOps}
        onDeleteTree={onDeleteTree}
        onOpenSelectorPicker={() => setSelectorPickerOpen(true)}
      />
      {selectorPickerOpen ? (
        <SelectorPicker
          doc={doc}
          tree={tree}
          vocab={vocab}
          packInfo={packInfo}
          onOps={onOps}
          onClose={() => setSelectorPickerOpen(false)}
        />
      ) : null}
      {worldPath ? null : (
        <p className="dlg-inspector-note">
          No world path — pickers list the cached rows only, and Save is unavailable.
        </p>
      )}
    </div>
  );
}

/** "this tree" — entry node, selector, duplicate, delete. */
function TreeSection({
  tree,
  vocab,
  onOps,
  onDeleteTree,
  onOpenSelectorPicker,
}: {
  tree: AuthorTree;
  vocab: DialogueVocab;
  onOps: (ops: EditOp[]) => void;
  onDeleteTree: () => void;
  onOpenSelectorPicker: () => void;
}) {
  return (
    <section className="dlg-inspector-sect dlg-tree-sect">
      <header>
        <span>this tree</span>
        <span className="dlg-mono dlg-dim">{tree.tree_id}</span>
      </header>
      <label className="dlg-field">
        <span>entry node</span>
        <select
          value={tree.entry_node_id}
          aria-label="entry node"
          onChange={(e) =>
            onOps([{ k: "tree.entry", tree: tree.tree_id, node_id: e.target.value }])
          }
        >
          {Object.keys(tree.nodes).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <label className="dlg-field">
        <span>axis</span>
        <select
          value={tree.axis ?? ""}
          aria-label="selector axis"
          onChange={(e) =>
            onOps([
              {
                k: "tree.selector",
                tree: tree.tree_id,
                selector: tree.selector,
                axis: e.target.value || null,
              },
            ])
          }
        >
          <option value="">— none (fallback) —</option>
          {axesOf(vocab).map((axis) => (
            <option key={axis.id} value={axis.id}>
              {axis.label}
            </option>
          ))}
        </select>
      </label>
      <div className="dlg-field">
        <span>selector</span>
        <span className="dlg-mono dlg-dim">
          {tree.selector === null ? "none — the fallback tree" : tree.selector.rows.join(" · ")}
        </span>
      </div>
      <div className="dlg-inspector-actions">
        <button className="btn" onClick={onOpenSelectorPicker}>
          {tree.selector === null ? "Add selector…" : "Edit selector…"}
        </button>
        <button
          className="btn"
          onClick={() =>
            onOps([{ k: "tree.duplicate", tree: `${tree.tree_id}-copy`, from: tree.tree_id }])
          }
          title="The copy is UNGATED until you give it a selector — two trees with the same selector would make the copy unreachable"
        >
          Duplicate
        </button>
        <button className="btn dang" onClick={onDeleteTree}>
          Delete tree…
        </button>
      </div>
    </section>
  );
}

/** Selector rows, edited with the same condition vocabulary as everything else
 *  — at `selector` scope, so a scene-only namespace is refused with its
 *  reason rather than silently accepted. */
function SelectorPicker({
  doc,
  tree,
  vocab,
  packInfo,
  onOps,
  onClose,
}: {
  doc: AuthorDoc;
  tree: AuthorTree;
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  onOps: (ops: EditOp[]) => void;
  onClose: () => void;
}) {
  const rows = tree.selector?.rows ?? [];
  // Gating a tree that sits behind the fallback would leave it dead: a
  // `tree.selector` op never moves a rank, in cradle or in canon. The lift
  // travels in the SAME push, so one gesture stays one edit to read.
  const set = (next: string[]) =>
    onOps([
      {
        k: "tree.selector",
        tree: tree.tree_id,
        selector: next.length ? { rows: next } : null,
      },
      ...(next.length ? liftAboveFallbackOps(doc, tree.tree_id) : []),
    ]);
  return (
    <div className="dlg-sheet-scrim" role="dialog" aria-label="Selector rows">
      <div className="dlg-sheet">
        <h3 className="dlg-sheet-title">
          Selector for <span className="dlg-mono">{tree.label || tree.tree_id}</span>
        </h3>
        <p className="dlg-sheet-note">
          ALL rows must match for this tree to be selected, and the first tree by rank whose
          selector matches wins. No rows at all makes it the fallback.
        </p>
        {rows.map((token, i) => (
          <ConditionRow
            key={`${token}#${i}`}
            token={token}
            scope="selector"
            vocab={vocab}
            packInfo={packInfo}
            engineEvaluable={engineSupports(token, "condition", packInfo, "selector")}
            engineReason={engineReasonFor(token, "condition", packInfo, "selector")}
            onChange={(next) => set(rows.map((r, j) => (j === i ? next : r)))}
            onRemove={() => set(rows.filter((_, j) => j !== i))}
          />
        ))}
        <EngineLagTrayNote tokens={rows} vocab={vocab} packInfo={packInfo} scope="selector" />
        <div className="dlg-sheet-actions">
          <button
            className="btn"
            onClick={() => set([...rows, formatToken(vocab.condition_namespaces[0])])}
          >
            ＋ row
          </button>
          <button className="btn" onClick={() => set([])}>
            Make it the fallback
          </button>
          <button className="btn pri" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Re-exported so a surface that only needs the picker does not import the
 *  whole tray. */
export { EntityPicker };
