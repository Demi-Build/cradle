// The save sheet (board 05 / board 03's "save moment") and the validator panel.
//
// Two rules the design pins and this file encodes:
//   • ONE `canon dialogue update` carries the whole buffer, and canon journals
//     each edit separately with its own provenance. The sheet says so, because
//     after saving you undo from History — `⌘Z` only reaches unsaved edits.
//   • WARNINGS ARE LOUD, NEVER BLOCKING (doctrine 10). Only an ERROR disables
//     the primary, and it disables it WITH THE ERROR NAMED (doctrine 4). Engine
//     lag, unreachable nodes and orphaned targets all save fine.
//
// Step 10 added the ENGINE-LAG block, above the ordinary warnings and separate
// from them, because it answers a different question: those warnings are about
// the data, this one is about the runtime that will read it. Step 11 added the
// multi-NPC batch line — the sheet already took a list, so it landed as data.

import type { LocalReport } from "./model";
import type { DirtyGroup } from "./useDialogueEditor";
import type { DialogueValidation } from "../../lib/invoke";

export function SaveSheet({
  npcLabel,
  groups,
  report,
  stored,
  saving,
  error,
  engineLag = [],
  batch = null,
  onCancel,
  onSave,
}: {
  npcLabel: string;
  groups: DirtyGroup[];
  /** The pre-flight over the UNSAVED buffer. */
  report: LocalReport;
  /** `canon dialogue validate` over what is on disk, when it has answered. */
  stored: DialogueValidation | null;
  saving: boolean;
  error: string | null;
  /** TREATMENT 3 of the engine-lag layer: one line per gate the engine will
   *  not enforce, named at the save moment. These SAVE FINE — the block is
   *  loud and never blocking (doctrine 10). */
  engineLag?: string[];
  /** Quest scope: one save, several NPCs, one `canon dialogue update` each. */
  batch?: { npcs: string[] } | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  const warnings = [...report.warnings, ...(stored?.warnings ?? [])];
  // The BUFFER is what gets written, so the buffer's pre-flight is what blocks.
  // `canon dialogue validate`'s answer describes the file as it is TODAY, and
  // an error there is often exactly what this save repairs — blocking on it
  // would deadlock the only edit that clears it. canon is still fail-closed on
  // its own side, so a genuinely bad write is refused there.
  const errors = report.errors;
  const onDisk = stored?.errors ?? [];
  const blocked = errors.length > 0;
  return (
    <div className="dlg-sheet-scrim" role="dialog" aria-label="Save dialogue">
      <div className="dlg-sheet">
        <h3 className="dlg-sheet-title">
          Save {count} change{count === 1 ? "" : "s"} to {npcLabel}?
        </h3>
        <p className="dlg-sheet-note">
          {batch && batch.npcs.length > 1 ? (
            <>
              One <span className="dlg-mono">canon dialogue update</span> per NPC (
              {batch.npcs.join(", ")}), sent as one batch under one session — atomic from here,
              per-character in the journal, because that is how the pack stores it.
            </>
          ) : (
            <>
              One <span className="dlg-mono">canon dialogue update</span> — each edit is journaled
              separately, with provenance.
            </>
          )}
        </p>
        <ul className="dlg-sheet-edits">
          {groups.flatMap((group) =>
            group.rows.map((row) => (
              <li key={`${group.target}#${row.index}`}>
                <span className="dlg-mono dlg-dim">{group.target}</span> {row.label}
              </li>
            )),
          )}
        </ul>
        {engineLag.length > 0 && (
          <div className="dlg-sheet-warnings dlg-sheet-lag" data-testid="save-engine-lag">
            <strong>
              ⚠ {engineLag.length} engine-lag warning{engineLag.length === 1 ? "" : "s"} — these
              save fine and are journaled as warnings.
            </strong>
            <ul>
              {engineLag.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="dlg-sheet-warnings">
            <strong>
              ⚠ {warnings.length} warning{warnings.length === 1 ? "" : "s"} — these save fine and
              are journaled as warnings.
            </strong>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {errors.length > 0 && (
          <div className="dlg-sheet-errors">
            <strong>
              ✗ {errors.length} error{errors.length === 1 ? "" : "s"} — the save is refused until
              these are fixed.
            </strong>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {onDisk.length > 0 && (
          <div className="dlg-sheet-warnings" data-testid="save-on-disk-errors">
            <strong>
              ✗ {onDisk.length} error{onDisk.length === 1 ? "" : "s"} already on disk — reported by{" "}
              <span className="dlg-mono">canon dialogue validate</span> against the saved file, not
              against this edit. They do not block the save; this edit may be the fix.
            </strong>
            <ul>
              {onDisk.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {report.passed.length > 0 && (
          <p className="dlg-sheet-passed">✓ {report.passed.join(" · ")}.</p>
        )}
        <p className="dlg-sheet-doctrine">warnings are loud, never blocking</p>
        {error ? <p className="dlg-sheet-failed">{error}</p> : null}
        <div className="dlg-sheet-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn pri"
            onClick={onSave}
            disabled={blocked || saving}
            title={blocked ? errors[0] : "Send the buffer as one canon dialogue update"}
          >
            {saving ? "Saving…" : `Save all ${count}`} <span className="kbd">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** The validator panel — board 05's right column. Reads
 *  `canon dialogue validate` (what is on disk) beside the buffer's pre-flight,
 *  and says which is which. `reveal` hands the node id back so the canvas can
 *  select it. */
export function ValidatorPanel({
  npcLabel,
  report,
  stored,
  onReveal,
}: {
  npcLabel: string;
  report: LocalReport;
  stored: DialogueValidation | null;
  onReveal?: (nodeId: string) => void;
}) {
  // Which is which, as the docstring promises: the buffer's own pre-flight and
  // canon's answer about the file on disk are two different claims.
  const warnings = [
    ...report.warnings.map((w) => ({ text: w, where: "buffer" })),
    ...(stored?.warnings ?? []).map((w) => ({ text: w, where: "on disk" })),
  ];
  const errors = [
    ...report.errors.map((e) => ({ text: e, where: "buffer" })),
    ...(stored?.errors ?? []).map((e) => ({ text: e, where: "on disk" })),
  ];
  return (
    <div className="dlg-validator" data-testid="dialogue-validator">
      <header className="dlg-validator-head">
        <span>Validator · {npcLabel}</span>
        <span className="dlg-mono dlg-dim">
          {warnings.length} warning{warnings.length === 1 ? "" : "s"} · {errors.length} error
          {errors.length === 1 ? "" : "s"}
        </span>
      </header>
      {errors.map((e, i) => (
        <div key={`e${i}`} className="dlg-validator-row err">
          ✗ {e.text} <span className="dlg-dim">({e.where})</span>
        </div>
      ))}
      {warnings.map((w, i) => {
        const node = w.text.match(/[Nn]ode '([^']+)'/)?.[1];
        return (
          <div key={`w${i}`} className="dlg-validator-row warn">
            ⚠ {w.text} <span className="dlg-dim">({w.where})</span>
            {node && onReveal ? (
              <button className="btn dlg-reveal" onClick={() => onReveal(node)}>
                reveal
              </button>
            ) : null}
          </div>
        );
      })}
      {report.passed.length > 0 && (
        <div className="dlg-validator-row ok">✓ {report.passed.join(" · ")}.</div>
      )}
      <footer className="dlg-validator-foot dlg-dim">
        (canon dialogue validate — warnings never block a write)
      </footer>
    </div>
  );
}
