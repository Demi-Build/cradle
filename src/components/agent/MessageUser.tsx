import { useState } from "react";
import type { UserItem } from "../../lib/agentState";
import { editAndResend, retryFrom } from "../../lib/agentActions";

/** A user message (README §3): right-aligned, bordered bubble with one
 *  square corner; hover reveals ✎ edit-and-resend (branches — truncates
 *  below), ↻ retry-from-here and ⧉ copy. Attached context renders as
 *  chips under it. */
export function MessageUser({ item, conversationId }: { item: UserItem; conversationId: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(item.text);
    } catch {}
  };
  return (
    <div className="ag-user" data-testid="msg-user">
      <div className="ag-user-tools">
        <button
          title="Edit and resend (branches the conversation below this message)"
          onClick={() => setEditing(true)}
          aria-label="Edit and resend"
        >
          ✎
        </button>
        <button
          title="Retry from here"
          onClick={() => void retryFrom(conversationId, item.id)}
          aria-label="Retry from here"
        >
          ↻
        </button>
        <button title="Copy" onClick={copy} aria-label="Copy">
          ⧉
        </button>
      </div>
      {editing ? (
        <div className="ag-user-edit">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                setEditing(false);
                void editAndResend(conversationId, item.id, text);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <div className="ag-card-actions" style={{ justifyContent: "flex-end" }}>
            <button className="ag-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="ag-btn primary"
              onClick={() => {
                setEditing(false);
                void editAndResend(conversationId, item.id, text);
              }}
            >
              Resend
            </button>
          </div>
        </div>
      ) : (
        <div className="ag-user-bubble">{item.text}</div>
      )}
      {item.context.length > 0 && (
        <div className="ag-user-ctx">
          {item.context.map((c) => (
            <span key={`${c.kind}:${c.id}`} className="ag-ctx-chip">
              @ {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
