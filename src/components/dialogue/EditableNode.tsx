// The Edit-mode React Flow node (README Q1: "in Edit mode every node renders
// its CHOICE ROWS instead of a `3 choices` footer — that is the biggest change
// to the graph").
//
// EXTENDS `DialogueCard`, which it wraps rather than replaces: the header, the
// prompt and the in-place prose editing are the card's, and this file adds the
// choice rows, the gate ribbons and the rewire targets around them. A row reads
// its own destination (`→ reward`), so rewiring is direct instead of hunting an
// edge, and a `null` target reads `→ ⌀ ends the conversation` rather than
// vanishing.
//
// The node is built from the AUTHOR tree, not from the beat: a beat's choices
// are the ones `buildDialogue` could resolve, and the orphan case — a choice
// pointing at a node that is not there — is exactly what the editor must show.
//
// Deliberately absent, by row ownership: the condition/effect ROWS themselves
// (`ConditionRow` / `EffectRow` live in the tray, step 7); drag-to-rewire from
// a row's right edge, which needs React Flow connect handles per row.

import { GateRibbon } from "./GateRibbon";
import { DialogueCard, type EditableProps } from "./DialogueCard";
import type { AuthorTree } from "./model";
import type { Beat } from "./types";

/** What the graph hands a node so it can render the author's data. */
export type EditGraph = {
  tree: AuthorTree;
  /** Which condition/effect tokens the target engine evaluates. Absent means
   *  "nothing known", which paints every dot amber rather than falsely green
   *  — never "all supported" (P.2.4). */
  engineEvaluable?: (token: string, kind: "condition" | "effect") => boolean;
  engineReason?: (token: string, kind: "condition" | "effect") => string | null;
  /** Selecting a choice opens it in the tray. */
  onSelectChoice?: (nodeId: string, index: number) => void;
  selectedChoice?: { nodeId: string; index: number } | null;
  /** README §8's consequence preview, PAINTED ON THE CANVAS behind the confirm
   *  sheet: the target dashed-red with its prompt struck through, each inbound
   *  choice dashed-amber and retargeted to `→ ⌀`, each newly-unreachable node
   *  dashed-amber and badged. The set is computed BEFORE the confirm (it is the
   *  same `Consequences` the sheet names), so the sheet and the canvas can never
   *  describe different edits. */
  preview?: DeletePreviewSet | null;
};

/** The three treatments the preview paints, as data. `inbound` holds
 *  `node[index]` refs — the same spelling the sheet lists. */
export type DeletePreviewSet = {
  doomed: string;
  inbound: Set<string>;
  newlyUnreachable: Set<string>;
};

export function EditableNode({ beat, edit }: { beat: Beat; edit: EditGraphProps }) {
  const nodeId = beat.label;
  const node = edit.tree.nodes[nodeId];
  const editable: EditableProps = {
    nodeId,
    selected: edit.selected === nodeId,
    onSelect: edit.onSelect,
    onPromptCommit: edit.onPromptCommit,
    onGesture: edit.onGesture,
    dirty: edit.dirtyNodes?.has(nodeId),
  };
  const evaluable = edit.engineEvaluable ?? (() => false);
  const reason = edit.engineReason ?? (() => null);
  const preview = edit.preview ?? null;
  const doomed = preview?.doomed === nodeId;
  const goingUnreachable = !!preview?.newlyUnreachable.has(nodeId);

  return (
    <div
      className="dlg-editnode"
      data-preview={doomed ? "delete" : goingUnreachable ? "unreachable" : undefined}
    >
      {doomed ? <span className="dlg-preview-badge dang">deleting</span> : null}
      {goingUnreachable ? (
        <span className="dlg-preview-badge">
          no path reaches this once {preview?.doomed} is gone
        </span>
      ) : null}
      <DialogueCard beat={{ ...beat, choices: [] }} mode="compact" editable={editable} />
      {node ? (
        <ul className="dlg-choicerows">
          {node.choices.map((choice, index) => {
            const missing =
              choice.next_node_id !== null && !(choice.next_node_id in edit.tree.nodes);
            const picked =
              edit.selectedChoice?.nodeId === nodeId && edit.selectedChoice.index === index;
            // Retargeted by the pending delete: `node.remove` re-points every
            // inbound choice to `null`, so the row reads `→ ⌀` before the
            // confirm, not after it.
            const retargeted = !!preview?.inbound.has(`${nodeId}[${index}]`);
            // TREATMENT 2 of the engine-lag layer (README screen 03): a choice
            // gating on a namespace this engine ignores gets a DASHED border
            // beside its amber ribbon dot — "authored, validated, not enforced
            // in game". Never disabled, never hidden: doctrine 10.
            const lagging = choice.conditions.filter((token) => !evaluable(token, "condition"));
            return (
              <li key={index}>
                <button
                  className={`dlg-choicerow ${picked ? "on" : ""} ${missing ? "orphan" : ""}`}
                  data-lag={lagging.length ? "1" : undefined}
                  data-preview={retargeted ? "retarget" : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    edit.onSelectChoice?.(nodeId, index);
                  }}
                  title={
                    missing
                      ? `points at '${choice.next_node_id}', which this tree does not have`
                      : lagging.length
                        ? (reason(lagging[0], "condition") ??
                          "this engine does not evaluate this gate")
                        : undefined
                  }
                >
                  <span className="dlg-choicerow-n">{index + 1}</span>
                  <GateRibbon
                    dots={choice.conditions.map((token) => ({
                      token,
                      engineEvaluable: evaluable(token, "condition"),
                      reason: reason(token, "condition"),
                    }))}
                    effects={choice.effects.length}
                  />
                  <span className="dlg-choicerow-text">{choice.text || "(no text)"}</span>
                  <span className="dlg-choicerow-to">
                    {retargeted
                      ? "→ ⌀ ends the conversation"
                      : choice.next_node_id === null
                        ? "→ ⌀"
                        : `→ ${choice.next_node_id}`}
                  </span>
                </button>
              </li>
            );
          })}
          {node.choices.length === 0 ? (
            <li className="dlg-choicerow-empty">terminal — no choices. Adding one clears it.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** The full prop bag a node receives — `EditGraph` plus the selection and
 *  commit callbacks the graph owns. Declared here so `DialogueGraphMode` and
 *  this file agree on one shape. */
export type EditGraphProps = EditGraph & {
  selected: string | null;
  onSelect: (nodeId: string) => void;
  onPromptCommit: (nodeId: string, prompt: string) => void;
  onGesture?: (cancel: (() => void) | null) => void;
  dirtyNodes?: Set<string>;
  unreachable?: Set<string>;
  structural?: boolean;
};
