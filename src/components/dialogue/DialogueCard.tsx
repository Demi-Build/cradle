import { useEffect, useRef, useState } from "react";
import type { Beat } from "./types";

type Mode = "compact" | "full";

/** In-place prose editing (README Q1: "prompt text edits in place on the node
 *  … `⏎` commits, `Esc` cancels"). Present only in Edit mode; View mode passes
 *  nothing and renders exactly as it did before row P0-9. */
export type EditableProps = {
  /** The node id this card stands for — `Beat.label` for a tree beat. */
  nodeId: string;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  /** Commit a new prompt. Called only when the text actually changed. */
  onPromptCommit: (nodeId: string, prompt: string) => void;
  /** Register/clear the in-progress gesture so `Esc` cancels the edit before
   *  it drops the mode — the universal step-out, in order. */
  onGesture?: (cancel: (() => void) | null) => void;
  /** This node has unsaved edits in the buffer. */
  dirty?: boolean;
};

export function DialogueCard({
  beat,
  mode,
  onChoiceClick,
  onCardClick,
  editable,
}: {
  beat: Beat;
  mode: Mode;
  onChoiceClick?: (toBeatId: string) => void;
  onCardClick?: () => void;
  editable?: EditableProps;
}) {
  const compact = mode === "compact";
  const choices = beat.choices ?? [];
  const prompt = beat.prompt ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  const stop = (commit: boolean) => {
    const next = draft ?? "";
    setDraft(null);
    editable?.onGesture?.(null);
    if (commit && editable && next !== prompt) editable.onPromptCommit(editable.nodeId, next);
  };

  const start = () => {
    if (!editable) return;
    setDraft(prompt);
    editable.onGesture?.(() => setDraft(null));
  };

  return (
    <div
      className={`dialogue-card ${compact ? "compact" : "full"} kind-${beat.kind} ${
        beat.isEntry ? "entry" : ""
      } ${beat.isTerminal ? "terminal" : ""} ${editable ? "editable" : ""} ${
        editable?.selected ? "selected" : ""
      } ${editable?.dirty ? "dirty" : ""}`}
      onClick={() => {
        editable?.onSelect(editable.nodeId);
        onCardClick?.();
      }}
      data-beat-id={beat.id}
    >
      <header className="dc-header">
        <span className={`dc-kind-badge kind-${beat.kind}`}>{beat.kind}</span>
        <span className="dc-id">{beat.label}</span>
        {editable?.dirty ? <span className="dc-edited">edited</span> : null}
        {beat.isEntry ? <span className="dc-entry-badge">entry</span> : null}
        {beat.isTerminal ? <span className="dc-terminal-badge">terminal</span> : null}
      </header>
      {editing ? (
        <div className="dc-prompt-edit">
          <textarea
            ref={areaRef}
            className="dc-prompt-input"
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => stop(true)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                stop(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
                editable?.onGesture?.(null);
              }
            }}
          />
          <span className="dc-prompt-hint">
            editing in place · ⏎ commit · esc cancel{" "}
            <span className="dc-chars">{(draft ?? "").length} ch</span>
          </span>
        </div>
      ) : (
        <div
          className="dc-prompt"
          onDoubleClick={(e) => {
            e.stopPropagation();
            start();
          }}
          title={editable ? "Double-click to edit this line in place" : undefined}
        >
          {compact && prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt}
        </div>
      )}
      {compact ? (
        choices.length > 0 ? (
          <footer className="dc-footer">
            <span className="dc-choice-count">
              {choices.length} choice{choices.length === 1 ? "" : "s"}
            </span>
          </footer>
        ) : null
      ) : (
        choices.length > 0 && (
          <ul className="dc-choices">
            {choices.map((c, i) => (
              <li key={i}>
                <button
                  className="dc-choice"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChoiceClick?.(c.toBeatId);
                  }}
                >
                  <span className="dc-choice-text">{c.text}</span>
                  <span className="dc-choice-arrow">→ {shortDest(c.toBeatId)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function shortDest(id: string): string {
  if (id.startsWith("tree:")) return id.slice(5);
  return id;
}
