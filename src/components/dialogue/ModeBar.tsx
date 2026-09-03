// The surface toolbar: mode segmented control, tree chip, counts, dirty chip,
// Improve and Save (README Q2, Q7; board 01's header row).
//
// EXTENDS `DialogueTab`'s Card/Graph segmented control — the same `.seg-btn`
// class and the same place on screen. The Card/Graph pair does not disappear;
// it moves inside View mode, where it belongs, because Card and Graph are two
// readers of one mode, not two modes.
//
// Mode is stated FOUR times and this file owns two of them: the segmented
// control's underline (`data-mode` on the group) and the `MODE` colour the
// canvas border and the pill read from the same token. The level editor's
// failure was three IMPLICIT states; one indicator would repeat it.

import { kbd } from "../../lib/keys";
import type { DialogueMode } from "../../store";

/** The three explicit positions, with the copy each carries. Data, so the bar
 *  and the keyboard map render the same words. Module-local: the palette gets
 *  its dialogue commands from `DialogueSurface`'s own registration, which is
 *  where the enabled/disabled reasons live. */
const MODES: { id: DialogueMode; label: string; hint: string; desc: string }[] = [
  {
    id: "view",
    label: "View",
    hint: "",
    desc: "Read the conversation. No tray, gates as summary ribbons.",
  },
  {
    id: "edit",
    label: "Edit",
    hint: "E",
    desc: "Choice rows, tool rail, tray on selection, ⌘S live.",
  },
  {
    id: "test",
    label: "Test",
    hint: "T",
    desc: "Walk the tree against a simulated state in the dock below.",
  },
];

export function ModeBar({
  mode,
  onMode,
  treeLabel,
  selectorText,
  counts,
  dirtyText,
  onOpenUnsaved,
  onSave,
  saving,
  saveDisabledReason,
  improveDisabledReason,
  onImprove,
  testDisabledReason,
  children,
}: {
  mode: DialogueMode;
  onMode: (m: DialogueMode) => void;
  /** The open tree's author label — "default", "night vigil". */
  treeLabel: string;
  /** Its selector in mono, or "no selector" for the fallback. */
  selectorText: string;
  /** `5 nodes · 7 choices · 3 gated`. */
  counts: string;
  /** `3 unsaved · 2 nodes 1 choice`, or "" when the buffer is clean. */
  dirtyText: string;
  onOpenUnsaved: () => void;
  onSave: () => void;
  saving?: boolean;
  /** Non-empty disables Save WITH the reason showing (doctrine 4). */
  saveDisabledReason?: string;
  improveDisabledReason?: string;
  onImprove?: () => void;
  /** Non-empty disables Test WITH the reason — a treeless NPC (screen 06). */
  testDisabledReason?: string;
  /** View mode's own Card/Graph control, rendered inside the bar. */
  children?: React.ReactNode;
}) {
  return (
    <div className="dlg-modebar" data-mode={mode}>
      <div className="segmented dlg-modes" role="tablist" aria-label="Dialogue mode">
        {MODES.map((m) => {
          // `||`, not `??`: the disabled reasons arrive as EMPTY STRINGS when
          // the control is enabled, and `??` would leave the button with no
          // title at all — the helpful hint silently lost (step 13's
          // keyboard-hint audit found this).
          const why = m.id === "test" ? testDisabledReason || undefined : undefined;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={`seg-btn dlg-mode-btn ${mode === m.id ? "active" : ""}`}
              data-mode={m.id}
              disabled={!!why}
              title={why ?? `${m.desc}${m.hint ? ` (${m.hint})` : ""}`}
              onClick={() => onMode(m.id)}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {children}
      <span className="chip chip-muted dlg-tree-chip" title="The tree on the canvas">
        <span className="dlg-mono">tree</span> {treeLabel}
        <span className="dlg-dim"> · </span>
        <span className="dlg-mono dlg-dim">{selectorText}</span>
      </span>
      <span className="dialogue-meta dlg-counts">{counts}</span>
      <span className="dlg-modebar-spacer" />
      {dirtyText ? (
        <button
          className="chip dlg-dirty"
          onClick={onOpenUnsaved}
          title="What is unsaved, per edit"
        >
          {dirtyText}
        </button>
      ) : null}
      <button
        className="btn dlg-improve"
        disabled={!!improveDisabledReason}
        title={
          improveDisabledReason ||
          "Ask a model to re-author these lines — a proposal, never a write"
        }
        onClick={onImprove}
      >
        ✨ Improve…
      </button>
      <button
        className="btn pri dlg-save"
        disabled={!!saveDisabledReason || !!saving}
        title={saveDisabledReason || `Save the unsaved buffer (${kbd("S")})`}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save"} <span className="kbd">{kbd("S")}</span>
      </button>
    </div>
  );
}
