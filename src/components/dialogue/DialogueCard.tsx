import type { Beat, BeatKind } from "./types";

type Mode = "compact" | "full";

export type BeatEdit =
  | { kind: "prompt"; value: string }
  | { kind: "choice"; choiceIdx: number; value: string };

const EDITABLE_KINDS: BeatKind[] = [
  "greeting",
  "tree",
  "tree-complete",
  "tree-failed",
  "tree-incomplete",
  "exhausted",
];

function isEditableKind(k: BeatKind): boolean {
  return EDITABLE_KINDS.includes(k);
}

export function DialogueCard({
  beat,
  mode,
  onChoiceClick,
  onCardClick,
  editMode = false,
  onEdit,
}: {
  beat: Beat;
  mode: Mode;
  onChoiceClick?: (toBeatId: string) => void;
  onCardClick?: () => void;
  editMode?: boolean;
  onEdit?: (beatId: string, change: BeatEdit) => void;
}) {
  const compact = mode === "compact";
  const choices = beat.choices ?? [];
  const prompt = beat.prompt ?? "";
  const beatEditable = editMode && !compact && isEditableKind(beat.kind) && !!onEdit;

  return (
    <div
      className={`dialogue-card ${compact ? "compact" : "full"} kind-${beat.kind} ${
        beat.isEntry ? "entry" : ""
      } ${beat.isTerminal ? "terminal" : ""}`}
      onClick={onCardClick}
      data-beat-id={beat.id}
    >
      <header className="dc-header">
        <span className={`dc-kind-badge kind-${beat.kind}`}>{beat.kind}</span>
        <span className="dc-id">{beat.label}</span>
      </header>
      <div className="dc-prompt">
        {beatEditable ? (
          <textarea
            className="ghost-textarea"
            value={prompt}
            onChange={(e) => onEdit!(beat.id, { kind: "prompt", value: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            rows={Math.min(8, Math.max(2, Math.ceil((prompt.length || 1) / 80)))}
          />
        ) : compact && prompt.length > 140 ? (
          `${prompt.slice(0, 140)}…`
        ) : (
          prompt
        )}
      </div>
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
            {choices.map((c, i) => {
              if (beatEditable && c.synthesized) return null;
              const editing = beatEditable && !c.synthesized;
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`dc-choice ${editing ? "is-editable" : ""}`}
                    onClick={(e) => {
                      if (editing) return;
                      e.stopPropagation();
                      onChoiceClick?.(c.toBeatId);
                    }}
                    tabIndex={editing ? -1 : 0}
                  >
                    <span className="dc-choice-text">
                      {editing ? (
                        <input
                          type="text"
                          className="ghost-input"
                          value={c.text}
                          onChange={(e) =>
                            onEdit!(beat.id, {
                              kind: "choice",
                              choiceIdx: i,
                              value: e.target.value,
                            })
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        c.text
                      )}
                    </span>
                    <span className="dc-choice-arrow">→ {shortDest(c.toBeatId)}</span>
                  </button>
                </li>
              );
            })}
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
