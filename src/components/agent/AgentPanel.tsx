import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { newConversationTab, onServiceExited, setPanel } from "../../lib/agentActions";
import { AGENT_W_DEFAULT, clampAgentWidth } from "../../lib/agentLayout";
import { TabStrip } from "./TabStrip";
import { PanelHeader } from "./PanelHeader";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { AgentRail } from "./AgentRail";
import { CreateRunCard } from "./CreateRunCard";
import { usePanelSurface } from "./panelSurface";
import "./agent.css";

/** The column (README §1): third shell column right of main, 412px default
 *  / 340 min / 720 max persisted per user; 4px drag handle (accent while
 *  dragging, mono width readout, double-click resets); collapsed = the 40px
 *  rail. NotesDrawer floats above and dims the panel to 60%, blocking input.
 *
 *  Lifecycle: the sidecar is NOT owned here. App owns it, keyed on the open
 *  pack, because hiding the panel (the TopBar toggle, ⌘⇧A, focus mode)
 *  unmounts this component — and a hide must never stop a turn in flight
 *  (README §1 "Focus mode hides the panel"; §10 makes Stop the one explicit
 *  verb). Only a pack change or app quit stops the service. What stays here
 *  is the supervisor's `agent-exited` listener, which is a panel display
 *  concern. Mounted by App only when `agentUi.open` and not in focus mode. */
export function AgentPanel({ allowDisabledReason }: { allowDisabledReason?: string }) {
  // Row A9: which SURFACE this column is drawn on. The editor supplies no
  // provider, so `surface` is `"editor"` and nothing below changes.
  const panel = usePanelSurface();
  const ui = useStore((s) => s.agentUi);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const conversations = useStore((s) => s.agent.conversations);
  const activeId = useStore((s) => s.agent.activeId);
  const toast = useStore((s) => s.agent.toast);
  const active = activeId ? conversations[activeId] : undefined;

  // The Rust supervisor's exit event (native only; the devMock has no bus).
  useEffect(() => {
    let dead = false;
    let off: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const un = await listen<{ code?: number | null; stderr?: string[] }>("agent-exited", (e) =>
          onServiceExited(e.payload),
        );
        if (dead) un();
        else off = un;
      } catch {
        /* browser mock */
      }
    })();
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  // Always have a tab to type into. The emptiness is re-read from the store
  // at fire time, never from the closure: React 18's StrictMode runs an
  // effect twice on mount, and the second pass saw the pre-first-tab snapshot
  // and opened a SECOND "New conversation" (visible on the start page, where
  // the panel mounts with no tabs at all).
  useEffect(() => {
    if (ui.collapsed) return;
    if (Object.keys(useStore.getState().agent.conversations).length === 0) newConversationTab();
  }, [ui.collapsed, conversations]);

  if (ui.collapsed) {
    return (
      <>
        <AgentRail />
        {toast && (
          <div className="ag-toast" role="status" data-testid="agent-toast">
            {toast}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <ResizeHandle width={ui.width} />
      <aside
        className="agent"
        data-testid="agent-panel"
        data-surface={panel.surface}
        data-dimmed={drawerOpen ? "1" : "0"}
        aria-hidden={drawerOpen}
        aria-label="Agent"
      >
        <TabStrip />
        {active && (
          <>
            <PanelHeader
              conversation={active}
              allowDisabledReason={allowDisabledReason ?? panel.allowDisabledReason}
            />
            <Transcript conversation={active} />
            {/* Row A9: a create started from the conversation outlives the
                turn that proposed it, so its run card sits between the
                transcript and the composer rather than scrolling away with
                the turn. It renders `CreateProgress` — the wizard's own
                component, on the wizard's own job. */}
            {panel.surface === "start" && <CreateRunCard />}
            <Composer conversation={active} />
          </>
        )}
        {toast && (
          <div className="ag-toast" role="status" data-testid="agent-toast">
            {toast}
          </div>
        )}
      </aside>
    </>
  );
}

/** The 4px handle: drag to resize (clamped), double-click resets to 412. */
function ResizeHandle({ width }: { width: number }) {
  const [drag, setDrag] = useState<{ startX: number; startW: number; w: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = clampAgentWidth(d.startW + (d.startX - e.clientX));
      setDrag({ ...d, w });
      setPanel({ width: w });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);
  return (
    <div
      className="agent-handle"
      data-dragging={drag ? "1" : "0"}
      data-testid="agent-handle"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      title="Drag to resize · double-click to reset"
      onMouseDown={(e) => {
        e.preventDefault();
        setDrag({ startX: e.clientX, startW: width, w: width });
      }}
      onDoubleClick={() => setPanel({ width: AGENT_W_DEFAULT })}
    >
      {drag && <span className="agent-handle-readout">{drag.w} px</span>}
    </div>
  );
}
