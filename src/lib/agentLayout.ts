// The panel column's geometry rules (agent-panel README §1; PLAN
// "Responsive rules"), as pure numbers so the thresholds are testable
// without a window. Constants are the design's; components read them here
// and never restate a number.

export const AGENT_W_DEFAULT = 412;
export const AGENT_W_MIN = 340;
export const AGENT_W_MAX = 720;
export const AGENT_RAIL_W = 40;
export const AGENT_HANDLE_W = 4;
export const NAV_W = 208;

/** Below this much remaining main width the editor's floating panels reflow
 *  inward instead of clipping. */
export const REFLOW_BELOW = 900;
/** Below this the panel auto-collapses to the rail (resize-only rule). */
export const AUTO_COLLAPSE_BELOW = 720;

export const COLLAPSE_TOAST = "Agent collapsed to make room. ⌘⇧A brings it back.";

export function clampAgentWidth(w: number): number {
  if (!Number.isFinite(w)) return AGENT_W_DEFAULT;
  return Math.round(Math.min(AGENT_W_MAX, Math.max(AGENT_W_MIN, w)));
}

export type LayoutInput = {
  windowWidth: number;
  navCollapsed: boolean;
  agentOpen: boolean;
  agentCollapsed: boolean;
  agentWidth: number;
  focusMode: boolean;
};

export type LayoutRule = {
  /** Main column width with the panel as it is now. */
  remaining: number;
  /** What main would be if the panel were expanded. */
  remainingIfExpanded: number;
  narrow: boolean;
  /** The resize rule says: collapse to the rail now. Only meaningful on a
   *  window resize — callers never apply it on an explicit re-expand. */
  shouldAutoCollapse: boolean;
};

export function layoutRule(i: LayoutInput): LayoutRule {
  const nav = i.navCollapsed || i.focusMode ? 0 : NAV_W;
  const panel =
    !i.agentOpen || i.focusMode
      ? 0
      : i.agentCollapsed
        ? AGENT_RAIL_W
        : i.agentWidth + AGENT_HANDLE_W;
  const remaining = i.windowWidth - nav - panel;
  const remainingIfExpanded = i.windowWidth - nav - (i.agentWidth + AGENT_HANDLE_W);
  return {
    remaining,
    remainingIfExpanded,
    narrow: remaining < REFLOW_BELOW,
    shouldAutoCollapse:
      i.agentOpen && !i.agentCollapsed && !i.focusMode && remainingIfExpanded < AUTO_COLLAPSE_BELOW,
  };
}
