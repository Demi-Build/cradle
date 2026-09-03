// The destructive-edit confirm sheet (README §8: "preview on the canvas,
// behind the sheet").
//
// The consequences are COMPUTED BEFORE the confirm and the canvas behind this
// sheet is already painting them — the target dashed-red, each inbound choice
// dashed-amber and retargeted to `→ ⌀`, each newly-unreachable node badged. The
// sheet's job is to NAME each consequence, offer the repair where one exists,
// and state what is unaffected.
//
// Deletion is a BUFFER edit: `⌘Z` undoes it and `⌘S` writes it. Nothing here
// touches a file (doctrine 1), and unreachable subtrees stay in the tree with
// their gates — a warning, never an error.

export type Consequences = {
  kind: "node" | "tree";
  id: string;
  /** `node[index]` refs that point at the target and become end-of-conversation. */
  inbound: string[];
  /** Nodes that no path reaches once the target is gone. */
  newlyUnreachable: string[];
  /** Conditions deleted along with the target. */
  gatesLost: number;
  /** The target IS the entry node, so the entry has to move. */
  entryMoves: boolean;
  /** For a tree: which state now falls through, and to what. */
  fallsThroughTo?: string | null;
};

export function DeletePreview({
  consequences,
  onCancel,
  onConfirm,
}: {
  consequences: Consequences;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = consequences;
  const what = c.kind === "node" ? "node" : "tree";
  return (
    <div className="dlg-sheet-scrim" role="dialog" aria-label={`Delete ${what}`}>
      <div className="dlg-sheet dlg-delete">
        <h3 className="dlg-sheet-title">
          Delete {what} <span className="dlg-mono">{c.id}</span>?
        </h3>
        <ul className="dlg-delete-consequences">
          {c.inbound.length > 0 ? (
            <li>
              <strong>{c.inbound.length}</strong> inbound choice
              {c.inbound.length === 1 ? "" : "s"} (
              <span className="dlg-mono">{c.inbound.join(", ")}</span>) become{" "}
              <em>end of conversation</em> — the canvas behind this sheet is already drawing them
              that way. Re-point them afterwards from the tray, or delete the choices there.
              <span className="dlg-dim">
                {" "}
                (The per-consequence repair buttons README §8 lists — <em>re-point to …</em>,{" "}
                <em>delete the choice too</em> — are not on this sheet yet; they belong to the same
                row and need a node picker on the sheet.)
              </span>
            </li>
          ) : (
            <li>Nothing points at it — no choice changes.</li>
          )}
          {c.newlyUnreachable.length > 0 ? (
            <li>
              <strong>{c.newlyUnreachable.length}</strong> node
              {c.newlyUnreachable.length === 1 ? "" : "s"} (
              <span className="dlg-mono">{c.newlyUnreachable.join(", ")}</span>) become unreachable.
              They stay in the tree and keep their gates — a warning, never an error.
            </li>
          ) : null}
          {c.gatesLost > 0 ? (
            <li>
              <strong>{c.gatesLost}</strong> condition{c.gatesLost === 1 ? "" : "s"} go with it.
            </li>
          ) : null}
          {c.entryMoves ? (
            <li className="dlg-delete-entry">
              This is the ENTRY node. The tree needs a new entry before it can be walked.
            </li>
          ) : null}
          {c.fallsThroughTo !== undefined ? (
            <li>
              The selector loses a row: that state now falls through to{" "}
              <span className="dlg-mono">{c.fallsThroughTo ?? "default"}</span>.
            </li>
          ) : null}
        </ul>
        <p className="dlg-sheet-doctrine">
          This is a buffer edit — ⌘Z undoes it, ⌘S writes it. Nothing is removed from disk until you
          save.
        </p>
        <div className="dlg-sheet-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn dang" onClick={onConfirm}>
            Delete {what}
          </button>
        </div>
      </div>
    </div>
  );
}
