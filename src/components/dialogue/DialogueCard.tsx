import type { DialogueNode } from "./types";

type Mode = "compact" | "full";

export function DialogueCard({
  nodeId,
  node,
  mode,
  isEntry,
  isTerminal,
  onChoiceClick,
  onCardClick,
}: {
  nodeId: string;
  node: DialogueNode;
  mode: Mode;
  isEntry?: boolean;
  isTerminal?: boolean;
  onChoiceClick?: (nextNodeId: string) => void;
  onCardClick?: () => void;
}) {
  const choices = node.choices ?? [];
  const prompt = node.prompt ?? "";
  const compact = mode === "compact";

  return (
    <div
      className={`dialogue-card ${compact ? "compact" : "full"} ${
        isEntry ? "entry" : ""
      } ${isTerminal ? "terminal" : ""}`}
      onClick={onCardClick}
      data-node-id={nodeId}
    >
      <header className="dc-header">
        <span className="dc-id">{nodeId}</span>
        {isEntry && <span className="dc-badge dc-badge-entry">entry</span>}
        {isTerminal && <span className="dc-badge dc-badge-terminal">end</span>}
      </header>
      <div className="dc-prompt">
        {compact && prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt}
      </div>
      {compact ? (
        <footer className="dc-footer">
          {choices.length > 0 ? (
            <span className="dc-choice-count">
              {choices.length} choice{choices.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="dc-choice-count dc-choice-none">no choices</span>
          )}
        </footer>
      ) : (
        choices.length > 0 && (
          <ul className="dc-choices">
            {choices.map((c, i) => (
              <li key={i}>
                <button
                  className="dc-choice"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChoiceClick?.(c.next_node_id);
                  }}
                >
                  <span className="dc-choice-text">{c.text}</span>
                  <span className="dc-choice-arrow">→ {c.next_node_id}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
