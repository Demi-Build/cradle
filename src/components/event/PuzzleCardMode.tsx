import { ChoiceCard } from "./ChoiceCard";
import type { PuzzleEvent } from "./types";

export function PuzzleCardMode({ event }: { event: PuzzleEvent }) {
  const choices = event.choices ?? [];
  const reward = event.reward_chance;
  const money = event.money_drop;

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
