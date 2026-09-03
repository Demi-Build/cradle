import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, UiContextRef } from "../../lib/agentState";
import { inFlight } from "../../lib/agentState";
import { sendMessage, setDraft, stopConversation } from "../../lib/agentActions";
import { useStore } from "../../store";
import { usePanelSurface } from "./panelSurface";

/** The composer (README §3 "Composer context"): `@` opens a typed picker —
 *  levels, actors, docs, and what's on screen now. The current level is
 *  attached by default in the editor. Enter sends, Shift+Enter breaks a
 *  line, Esc stops the agent (README §10). The mode readout says what the
 *  header's mode means for this message. */
export function Composer({ conversation }: { conversation: Conversation }) {
  // Row A9: on the start page the send goes to the surface (there is no
  // sidecar with no pack open); the editor supplies none and nothing changes.
  const surface = usePanelSurface();
  const selection = useStore((s) => s.selection);
  const entities = useStore((s) => s.entities);
  const service = useStore((s) => s.agent.service);
  const [picker, setPicker] = useState<string | null>(null);
  const [context, setContext] = useState<UiContextRef[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Default context: the level on screen (editor only; the start page
  // attaches nothing — that page is row A9's).
  const current: UiContextRef | null = useMemo(() => {
    if (selection.kind !== "entity") return null;
    const name =
      entities[selection.typeId]?.find((r) => r.id === selection.id)?.name ?? selection.id;
    return {
      kind: selection.typeId === "levels" ? "level" : selection.typeId,
      id: selection.id,
      label: name,
    };
  }, [selection, entities]);
  useEffect(() => {
    setContext((c) => {
      const others = c.filter(
        (x) => x.kind !== "screen" && !(current && x.kind === current.kind && x.id === current.id),
      );
      return current ? [current, ...others] : others;
    });
  }, [current]);

  const options = useMemo<UiContextRef[]>(() => {
    const out: UiContextRef[] = [];
    for (const l of entities.levels ?? [])
      out.push({ kind: "level", id: l.id, label: l.name ?? l.id });
    for (const e of entities.enemies ?? [])
      out.push({ kind: "actor", id: e.id, label: e.name ?? e.id });
    for (const n of entities.npcs ?? [])
      out.push({ kind: "actor", id: n.id, label: n.name ?? n.id });
    out.push({ kind: "doc", id: "bible", label: "world bible" });
    out.push({ kind: "screen", id: "screen", label: "what's on screen now" });
    return out;
  }, [entities]);
  const filtered =
    picker == null
      ? []
      : options
          .filter(
            (o) => o.label.toLowerCase().includes(picker.toLowerCase()) || o.id.includes(picker),
          )
          .slice(0, 12);

  const busy = inFlight(conversation);
  const send = () => {
    const text = conversation.draft.trim();
    if (!text || busy) return;
    if (surface.onSend) surface.onSend(conversation.id, text);
    else void sendMessage(conversation.id, text, context);
    setPicker(null);
  };
  const modeLine =
    surface.composerModeLine?.(conversation.mode) ??
    (conversation.mode === "allow"
      ? "Allow mode · standing grants apply; paid still asks"
      : conversation.mode === "plan"
        ? "Plan mode · one approval runs the batch"
        : "Ask mode · nothing changes without you");
  // The start page has no service to queue against — its turns are local.
  const queued =
    surface.surface !== "start" && (service.status === "starting" || service.status === "stopped");
  return (
    <div className="ag-composer" data-testid="composer">
      {picker != null && (
        <div className="ag-ctx-picker" data-testid="ctx-picker">
          <div className="ag-menu-title">attach context</div>
          {filtered.map((o) => (
            <button
              key={`${o.kind}:${o.id}`}
              className="ag-menu-row"
              onClick={() => {
                setContext((c) =>
                  c.some((x) => x.kind === o.kind && x.id === o.id) ? c : [...c, o],
                );
                setPicker(null);
                setDraft(
                  conversation.id,
                  conversation.draft.replace(/@[^\s@]*$/, "").trimEnd() + " ",
                );
                ref.current?.focus();
              }}
            >
              <span className="kind">{o.kind}</span>
              <span>{o.label}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="ag-menu-foot">nothing matches</div>}
        </div>
      )}
      <textarea
        ref={ref}
        value={conversation.draft}
        placeholder={
          surface.composerPlaceholder ??
          (current
            ? "Ask about this level, or describe a change…"
            : "Ask about the project, or describe a change…")
        }
        onChange={(e) => {
          const v = e.target.value;
          setDraft(conversation.id, v);
          const m = v.match(/(?:^|\s)@([^\s@]*)$/);
          setPicker(m ? m[1] : null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (picker != null) return setPicker(null);
            // Esc is the third place Stop lives (README §10) — same contract,
            // so same override the header's ⏹ takes (row A9).
            if (busy) {
              if (surface.onStop) surface.onStop(conversation.id);
              else void stopConversation(conversation.id);
            }
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        aria-label="Message the agent"
      />
      <div className="ag-composer-row">
        {context.map((c) => (
          <span key={`${c.kind}:${c.id}`} className="ag-ctx-chip" title={`${c.kind} ${c.id}`}>
            @ {c.label}
            <button
              onClick={() => setContext((cs) => cs.filter((x) => x !== c))}
              style={{
                border: 0,
                background: "none",
                color: "inherit",
                cursor: "pointer",
                marginLeft: 4,
                padding: 0,
              }}
              aria-label={`Remove ${c.label}`}
            >
              ×
            </button>
          </span>
        ))}
        <span className="mode">
          {queued ? "queued until the service is up · " : ""}
          {modeLine}
        </span>
        <button className="ag-send" onClick={send} disabled={!conversation.draft.trim() || busy}>
          ↵ Send
        </button>
      </div>
    </div>
  );
}
