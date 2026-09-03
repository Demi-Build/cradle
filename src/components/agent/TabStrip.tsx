import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sortTabs, tabDot } from "../../lib/agentState";
import { closeConversation, newConversationTab, setActive, setPanel } from "../../lib/agentActions";
import { useStore } from "../../store";
import { SessionHistoryMenu } from "./SessionHistoryMenu";
import type { Conversation } from "../../lib/agentState";

/** Conversation tabs (README §2): Cursor-style, scrollable, status dots,
 *  waiting sorts ahead of idle, running never re-sorts; middle-click closes
 *  (a live run confirms); `+` new, `⏱` history, `→|` collapse to the rail.
 *
 *  Overflow folds to `+N` (README §2; PLAN "Responsive rules"): the strip
 *  measures itself and the tabs that do not fit move into a menu on the same
 *  `.ag-menu` chassis the ⏱ history uses, each with its status dot; picking
 *  one activates it (and pulls it back into view, because the active tab
 *  sorts into the visible run). Widths are cached per tab so a tab that has
 *  been folded away still has a width to fold BACK with when the strip
 *  widens; an unmeasured strip (jsdom, a hidden panel) folds nothing. */
export function TabStrip() {
  const conversations = useStore((s) => s.agent.conversations);
  const activeId = useStore((s) => s.agent.activeId);
  const [history, setHistory] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const tabs = sortTabs(Object.values(conversations));
  const scrollRef = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [hidden, setHidden] = useState<string[]>([]);
  const key = tabs.map((t) => `${t.id}:${t.title}`).join("|");

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll<HTMLElement>("[data-tab-id]"));
    for (const node of nodes) {
      const w = node.offsetWidth;
      if (w > 0) widths.current.set(node.dataset.tabId ?? "", w);
    }
    const avail = el.clientWidth;
    const ids = nodes.map((n) => n.dataset.tabId ?? "");
    if (!avail) {
      setHidden((prev) => (prev.length ? [] : prev));
      return;
    }
    // Fit tabs in order; once one does not fit, everything after it folds.
    const out: string[] = [];
    let used = 0;
    let folding = false;
    for (const id of ids) {
      const w = widths.current.get(id) ?? 0;
      if (folding || used + w > avail) {
        folding = true;
        out.push(id);
      } else {
        used += w;
      }
    }
    setHidden((prev) => (prev.join("|") === out.join("|") ? prev : out));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [key, measure]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // The active tab is never folded: if it landed past the fold, it trades
  // places with the last tab that fits.
  const foldedSet = new Set(hidden);
  if (activeId && foldedSet.has(activeId)) {
    foldedSet.delete(activeId);
    const lastVisible = [...tabs].reverse().find((t) => !foldedSet.has(t.id) && t.id !== activeId);
    if (lastVisible) foldedSet.add(lastVisible.id);
  }
  const folded = tabs.filter((t) => foldedSet.has(t.id));
  return (
    <div className="ag-tabs" data-testid="tab-strip">
      <div className="ag-tabs-scroll" role="tablist" ref={scrollRef}>
        {tabs.map((c) => {
          const dot = tabDot(c);
          return (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === activeId}
              className="ag-tab"
              data-active={c.id === activeId ? "1" : "0"}
              data-dot={dot ?? "none"}
              data-testid="tab"
              data-tab-id={c.id}
              hidden={foldedSet.has(c.id)}
              onClick={() => setActive(c.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeConversation(c.id, (q) => window.confirm(q));
                }
              }}
              title={c.title}
            >
              {dot && <span className="ag-dot" data-dot={dot} />}
              <span className="lbl">{c.title}</span>
              <span
                className="ag-tab-x"
                role="button"
                aria-label={`Close ${c.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeConversation(c.id, (q) => window.confirm(q));
                }}
              >
                ✕
              </span>
            </button>
          );
        })}
      </div>
      <div className="ag-tabs-actions">
        {folded.length > 0 && (
          <button
            className="icon-btn ag-tabs-more"
            onClick={() => setOverflow((v) => !v)}
            title={`${folded.length} more conversation${folded.length === 1 ? "" : "s"}`}
            aria-label={`${folded.length} more conversations`}
            aria-haspopup="menu"
            data-testid="tab-overflow"
          >
            +{folded.length}
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => newConversationTab()}
          title="New conversation · ⌘⇧N"
          aria-label="New conversation"
        >
          +
        </button>
        <button
          className="icon-btn"
          onClick={() => setHistory((v) => !v)}
          title="History — past conversations in this project"
          aria-label="History"
        >
          ⏱
        </button>
        <button
          className="icon-btn"
          onClick={() => setPanel({ collapsed: true })}
          title="Collapse to the rail"
          aria-label="Collapse the agent panel"
        >
          →|
        </button>
      </div>
      {overflow && folded.length > 0 && (
        <OverflowMenu tabs={folded} onClose={() => setOverflow(false)} />
      )}
      {history && <SessionHistoryMenu onClose={() => setHistory(false)} />}
    </div>
  );
}

/** The folded tabs, on the same menu chassis as ⏱ history. */
function OverflowMenu({ tabs, onClose }: { tabs: Conversation[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return (
    <div className="ag-menu" ref={ref} data-testid="tab-overflow-menu">
      <div className="ag-menu-title">more conversations</div>
      {tabs.map((c) => {
        const dot = tabDot(c);
        return (
          <button
            key={c.id}
            className="ag-menu-row"
            onClick={() => {
              setActive(c.id);
              onClose();
            }}
          >
            <span>
              {dot && <span className="ag-dot" data-dot={dot} />}
              {c.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
