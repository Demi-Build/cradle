import { useState } from "react";
import type { ToolItem } from "../../../lib/agentState";

/** A read (README §5 "read"): no card, one collapsed mono line; ▸ expands
 *  the payload the agent saw. Never asks. A failed read is the same line in
 *  red with the reason. */
export function ReadLine({ tool }: { tool: ToolItem }) {
  const meta = readMeta(tool);
  return (
    <details
      className="ag-read"
      data-error={tool.status === "error" ? "1" : "0"}
      data-testid="read-line"
    >
      <summary>
        <span className="tri">▸</span>
        {tool.label}
        {meta && <span className="meta">{meta}</span>}
        {tool.status === "error" && <span className="meta">{tool.error ?? "failed"}</span>}
        {tool.status === "running" && <span className="meta">…</span>}
      </summary>
      <pre>{payload(tool)}</pre>
    </details>
  );
}

/** More than six reads in a run fold into "read N artifacts ▸". */
export function ReadFold({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="ag-read" data-testid="read-fold">
        <button
          className="btn-link"
          style={{ color: "inherit", textDecoration: "none" }}
          onClick={() => setOpen(true)}
        >
          <span className="tri">▸</span> read {tools.length} artifacts
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {tools.map((t) => (
        <ReadLine key={t.id} tool={t} />
      ))}
    </div>
  );
}

function readMeta(tool: ToolItem): string | null {
  const r = tool.result;
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (typeof o.size === "string") return o.size;
  if (typeof o.count === "number") return `${o.count} rows`;
  if (Array.isArray(o.files)) return `${o.files.length} files`;
  if (typeof o.grid === "string") return o.grid;
  return null;
}

function payload(tool: ToolItem): string {
  if (tool.status === "error") return tool.error ?? "failed";
  if (tool.result === undefined) {
    return `input: ${JSON.stringify(tool.input, null, 2)}\n(result not relayed on the stream — it is in the transcript)`;
  }
  const text = typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n… (${text.length - 4000} more chars)` : text;
}
