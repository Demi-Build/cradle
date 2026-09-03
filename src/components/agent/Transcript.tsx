import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Conversation, ToolItem, TranscriptItem } from "../../lib/agentState";
import { fmtCents, foldReads } from "../../lib/agentState";
import { answerInput } from "../../lib/agentActions";
import { useStore } from "../../store";
import { MessageUser } from "./MessageUser";
import { MessageAgent } from "./MessageAgent";
import { ErrorNotice, ServiceFailed, ServiceStarting } from "./ErrorNotice";
import { ReadFold, ReadLine } from "./ToolCall/ReadLine";
import { WriteCard } from "./ToolCall/WriteCard";
import { RunCard } from "./RunCard";
import { PlanCard } from "./PlanCard";
import { FirstRun } from "./FirstRun";
import { usePanelSurface } from "./panelSurface";
import { agentLabel } from "./agentLabel";

/** The transcript (README §3): a log, not a chat app. Autoscrolls while the
 *  reader is pinned to the bottom; a scroll up unpins until they return. */
export function Transcript({ conversation }: { conversation: Conversation }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const service = useStore((s) => s.agent.service);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  const empty = conversation.items.length === 0;
  return (
    <div className="ag-transcript" ref={ref} onScroll={onScroll} data-testid="transcript">
      {service.status === "starting" && <ServiceStarting service={service} />}
      {service.status === "failed" && <ServiceFailed service={service} />}
      {empty ? (
        <FirstRun conversationId={conversation.id} />
      ) : (
        <ItemList items={conversation.items} conversationId={conversation.id} />
      )}
    </div>
  );
}

/** Items in order, with reads past six folded. Used by the transcript and
 *  by run cards for their nested lists. */
export function ItemList({
  items,
  conversationId,
}: {
  items: TranscriptItem[];
  conversationId: string;
}) {
  const title = useStore((s) => s.worldStoryTitle ?? s.world?.name);
  const label = agentLabel(title);
  const folds = foldReads(items);
  const folded = new Map<number, number[]>();
  for (const g of folds) folded.set(g[0], g);
  const skip = new Set<number>();
  for (const g of folds) for (const i of g.slice(1)) skip.add(i);
  return (
    <>
      {items.map((it, i) => {
        if (skip.has(i)) return null;
        const group = folded.get(i);
        if (group) {
          return <ReadFold key={`fold-${i}`} tools={group.map((k) => items[k] as ToolItem)} />;
        }
        return <Item key={keyOf(it, i)} item={it} conversationId={conversationId} label={label} />;
      })}
    </>
  );
}

function keyOf(it: TranscriptItem, i: number): string {
  switch (it.kind) {
    case "user":
    case "assistant":
    case "tool":
    case "request_input":
      return `${it.kind}-${it.id}`;
    case "run":
      return `run-${it.runId}`;
    case "plan":
      return `plan-${it.planId}`;
    default:
      return `${it.kind}-${i}`;
  }
}

function Item({
  item,
  conversationId,
  label,
}: {
  item: TranscriptItem;
  conversationId: string;
  label: string;
}) {
  switch (item.kind) {
    case "rule":
      return <div className="ag-rule">{item.label}</div>;
    case "user":
      return <MessageUser item={item} conversationId={conversationId} />;
    case "assistant":
      return <MessageAgent item={item} conversationId={conversationId} label={label} />;
    case "tool":
      if (item.tier === "read") return <ReadLine tool={item} />;
      if (item.tier === "ui") return <UiToolLine tool={item} />;
      return <WriteCard tool={item} conversationId={conversationId} />;
    case "run":
      return <RunCard run={item} conversationId={conversationId} />;
    case "plan":
      return <PlanCard plan={item} conversationId={conversationId} />;
    case "error":
      return <ErrorNotice item={item} conversationId={conversationId} />;
    case "cancelled":
      return (
        <div className="ag-cancelled" data-testid="cancelled">
          <div>Stopped by you. Nothing new was started.</div>
          {item.landed.length > 0 && <div>Kept: {item.landed.join(", ")}.</div>}
          <div>
            {item.usage.input_tokens + item.usage.output_tokens > 0
              ? `${item.usage.input_tokens + item.usage.output_tokens} tokens so far`
              : "No tokens billed"}
            {item.costCents != null ? ` · ${fmtCents(item.costCents)}` : ""}.
          </div>
        </div>
      );
    case "image":
      return (
        <figure style={{ margin: 0 }}>
          <img
            src={item.src}
            alt={item.alt}
            style={{
              maxWidth: "100%",
              imageRendering: "pixelated",
              border: "1px solid var(--border)",
            }}
          />
          <figcaption className="ag-card-mono">{item.path}</figcaption>
        </figure>
      );
    case "request_input":
      return <InputRequest item={item} conversationId={conversationId} />;
    case "note":
      return <div className="ag-note">{item.text}</div>;
    default:
      return null;
  }
}

/** UI tools (Phase 1 §4.E) execute panel-side; the line just says so. */
function UiToolLine({ tool }: { tool: ToolItem }) {
  if (tool.name === "attach_image" || tool.name === "request_input" || tool.name === "propose_plan")
    return null;
  return (
    <div className="ag-read" data-testid="ui-tool-line">
      <span className="tri">↗</span> {tool.label}
    </div>
  );
}

function InputRequest({
  item,
  conversationId,
}: {
  item: Extract<TranscriptItem, { kind: "request_input" }>;
  conversationId: string;
}) {
  // Row A9: the start page answers its own chips (its turns are local).
  const surface = usePanelSurface();
  const answer = (value: string) =>
    surface.onAnswerInput
      ? surface.onAnswerInput(conversationId, item.id, value)
      : void answerInput(conversationId, item.id, value);
  const [text, setText] = useState("");
  useEffect(() => setText(""), [item.id]);
  return (
    <div className="ag-card" data-testid="request-input">
      <div className="ag-card-head">
        <span className="title">{item.question}</span>
      </div>
      {item.answer ? (
        <div className="ag-card-mono">answered: {item.answer}</div>
      ) : (
        <div className="ag-card-actions">
          {item.options.map((o) => (
            <button key={o} className="ag-chip" onClick={() => answer(o)}>
              {o}
            </button>
          ))}
          {item.options.length === 0 && (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && text && answer(text)}
              placeholder="Answer…"
              style={{ flex: 1 }}
            />
          )}
        </div>
      )}
    </div>
  );
}
