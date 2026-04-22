import type { Beat } from "./types";

type Mode = "compact" | "full";

export function DialogueCard({
  beat,
  mode,
  onChoiceClick,
  onCardClick,
}: {
  beat: Beat;
  mode: Mode;
  onChoiceClick?: (toBeatId: string) => void;
  onCardClick?: () => void;
}) {
  const compact = mode === "compact";
  const choices = beat.choices ?? [];
  const prompt = beat.prompt ?? "";

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
        {compact && prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt}
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
