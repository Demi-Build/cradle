import { ChoiceCard } from "./ChoiceCard";
import type { PuzzleEvent } from "./types";

export function PuzzleCardMode({ event }: { event: PuzzleEvent }) {
  const choices = event.choices ?? [];
  const reward = event.reward_chance;
  const money = event.money_drop;
  const failType = event.failure_damage_type;
  const failRange = event.failure_damage_range;
  const hasFail =
    (typeof failType === "string" && failType.length > 0) ||
    (Array.isArray(failRange) && failRange.length >= 2);

  return (
    <div className="puzzle-card-mode">
      <section className="puzzle-prompt">
        <div className="puzzle-prompt-label">prompt</div>
        <p>{event.description}</p>
        <div className="puzzle-prompt-meta">
          {typeof event.difficulty === "number" && (
            <span className="chip chip-muted">difficulty {event.difficulty}</span>
          )}
          {typeof reward === "number" && (
            <span className="chip chip-muted">reward chance {(reward * 100).toFixed(0)}%</span>
          )}
          {money && (
            <span className="chip chip-muted">money {money[0]}–{money[1]}</span>
          )}
          {hasFail && (
            <span className="chip puzzle-prompt-failure">
              failure:{" "}
              {typeof failType === "string" ? failType : "damage"}
              {Array.isArray(failRange) && failRange.length >= 2 && ` ${failRange[0]}–${failRange[1]}`}
            </span>
          )}
        </div>
      </section>
      <div className="choices-list">
        {choices.map((c, i) => (
          <ChoiceCard key={i} choice={c} index={i} event={event} mode="full" />
        ))}
      </div>
    </div>
  );
}
