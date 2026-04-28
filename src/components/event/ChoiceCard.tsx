import { correctMatch, formatCheck, type PuzzleChoice, type PuzzleEvent } from "./types";

export function ChoiceCard({
  choice,
  index,
  event,
  mode,
}: {
  choice: PuzzleChoice;
  index: number;
  event: PuzzleEvent;
  mode: "compact" | "full";
}) {
  const correct = correctMatch(choice, event);
  const check = formatCheck(choice);
  const failRange = event.failure_damage_range;
  const failType = event.failure_damage_type;

  const compact = mode === "compact";

  return (
    <div className={`choice-card ${compact ? "compact" : "full"} ${correct ? "correct" : ""}`}>
      <header className="cc-header">
        <span className="cc-idx">#{index + 1}</span>
        <span className="cc-check">{check}</span>
        {correct && <span className="cc-badge cc-badge-correct">correct · {correct}</span>}
      </header>
      <div className="cc-text">{choice.text}</div>
      {!compact && (
        <div className="cc-outcomes">
          <div className="outcome outcome-success">
            <div className="outcome-label">success</div>
            <div className="outcome-body">{choice.success_text ?? "(no text)"}</div>
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
