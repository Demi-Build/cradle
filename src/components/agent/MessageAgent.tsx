import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssistantItem } from "../../lib/agentState";
import { sendMessage } from "../../lib/agentActions";

/** Agent text (README §3): flush left, unbubbled, under a mono agent label —
 *  the transcript reads as a log. Markdown renders; a streaming reply ends
 *  in a blinking accent caret; up to three follow-up chips after a judged
 *  reply (suggestions, never a menu). */
export function MessageAgent({
  item,
  conversationId,
  label,
}: {
  item: AssistantItem;
  conversationId: string;
  label: string;
}) {
  if (!item.text && !item.streaming && !item.thinking) return null;
  return (
    <div className="ag-agent" data-testid="msg-agent" data-streaming={item.streaming ? "1" : "0"}>
      <div className="ag-agent-label">{label}</div>
      {item.thinking && (
        <details className="ag-thinking">
          <summary>thinking</summary>
          <div>{item.thinking}</div>
        </details>
      )}
      <div className="ag-agent-body">
        {item.text ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown> : null}
        {item.streaming && <span className="ag-caret" data-testid="caret" aria-hidden="true" />}
      </div>
      {!item.streaming && item.chips.length > 0 && (
        <div className="ag-chips" data-testid="follow-ups">
          {item.chips.slice(0, 3).map((c) => (
            <button key={c} className="ag-chip" onClick={() => void sendMessage(conversationId, c)}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
