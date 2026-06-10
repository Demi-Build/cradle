import { correctMatch, formatCheck, type PuzzleChoice, type PuzzleEvent } from "./types";

export type ChoiceEdit =
  | { kind: "text"; value: string }
  | { kind: "success_text"; value: string };

export function ChoiceCard({
  choice,
  index,
  event,
  mode,
  editMode = false,
  onEdit,
}: {
  choice: PuzzleChoice;
  index: number;
  event: PuzzleEvent;
  mode: "compact" | "full";
  editMode?: boolean;
  onEdit?: (index: number, change: ChoiceEdit) => void;
}) {
  const correct = correctMatch(choice, event);
  const check = formatCheck(choice);
  const failRange = event.failure_damage_range;
  const failType = event.failure_damage_type;

  const compact = mode === "compact";
  const editable = editMode && !compact && !!onEdit;

  return (
    <div className={`choice-card ${compact ? "compact" : "full"} ${correct ? "correct" : ""}`}>
      <header className="cc-header">
        <span className="cc-idx">#{index + 1}</span>
        <span className="cc-check">{check}</span>
        {correct && <span className="cc-badge cc-badge-correct">correct · {correct}</span>}
      </header>
      <div className="cc-text">
        {editable ? (
          <input
            type="text"
            className="ghost-input"
            value={choice.text ?? ""}
            onChange={(e) => onEdit!(index, { kind: "text", value: e.target.value })}
          />
        ) : (
          choice.text
        )}
      </div>
      {!compact && (
        <div className="cc-outcomes">
          <div className="outcome outcome-success">
            <div className="outcome-label">success</div>
            <div className="outcome-body">
              {editable ? (
                <textarea
                  className="ghost-textarea"
                  value={choice.success_text ?? ""}
                  onChange={(e) =>
                    onEdit!(index, { kind: "success_text", value: e.target.value })
                  }
                  rows={Math.min(6, Math.max(2, Math.ceil(((choice.success_text ?? "").length || 1) / 60)))}
                />
              ) : (
                (choice.success_text ?? "(no text)")
              )}
            </div>
          </div>
          {!choice.auto_success && failRange && (
            <div className="outcome outcome-failure">
              <div className="outcome-label">failure</div>
              <div className="outcome-body">
                {failType ?? "damage"} {failRange[0]}–{failRange[1]}
              </div>
            </div>
          )}
        </div>
      )}
      {compact && (
        <footer className="cc-footer">
          {choice.auto_success ? (
            <span className="cc-foot-muted">no failure path</span>
          ) : (
            <span className="cc-foot-muted">success / failure</span>
          )}
        </footer>
      )}
    </div>
  );
}
