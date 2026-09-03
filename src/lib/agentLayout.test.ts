import { describe, it, expect } from "vitest";
import {
  AGENT_W_DEFAULT,
  AGENT_W_MAX,
  AGENT_W_MIN,
  clampAgentWidth,
  layoutRule,
} from "./agentLayout";

/** The column's geometry (README §1): 412 default / 340 min / 720 max; below
 *  900 remaining the editor reflows; below 720 the panel auto-collapses —
 *  on resize only. */
describe("agent column geometry", () => {
  it("clamps the width to the design's range and defaults on garbage", () => {
    expect(clampAgentWidth(100)).toBe(AGENT_W_MIN);
    expect(clampAgentWidth(9999)).toBe(AGENT_W_MAX);
    expect(clampAgentWidth(500.4)).toBe(500);
    expect(clampAgentWidth(NaN)).toBe(AGENT_W_DEFAULT);
  });

  const base = {
    navCollapsed: false,
    agentOpen: true,
    agentCollapsed: false,
    agentWidth: AGENT_W_DEFAULT,
    focusMode: false,
  };

  it("counts the nav, the handle and the panel against the window", () => {
    const r = layoutRule({ ...base, windowWidth: 1600 });
    expect(r.remaining).toBe(1600 - 208 - 412 - 4);
    expect(r.narrow).toBe(false);
    expect(r.shouldAutoCollapse).toBe(false);
  });

  it("reflows below 900 remaining and auto-collapses below 720", () => {
    expect(layoutRule({ ...base, windowWidth: 1500 }).narrow).toBe(true); // 876 remaining
    expect(layoutRule({ ...base, windowWidth: 1500 }).shouldAutoCollapse).toBe(false);
    const tight = layoutRule({ ...base, windowWidth: 1300 }); // 676 remaining
    expect(tight.narrow).toBe(true);
    expect(tight.shouldAutoCollapse).toBe(true);
  });

  it("never asks to collapse what is already a rail, closed, or hidden by focus mode", () => {
    expect(
      layoutRule({ ...base, windowWidth: 1000, agentCollapsed: true }).shouldAutoCollapse,
    ).toBe(false);
    expect(layoutRule({ ...base, windowWidth: 1000, agentOpen: false }).shouldAutoCollapse).toBe(
      false,
    );
    expect(layoutRule({ ...base, windowWidth: 1000, focusMode: true }).shouldAutoCollapse).toBe(
      false,
    );
    // The rail costs 40px, not the panel's width.
    expect(layoutRule({ ...base, windowWidth: 1000, agentCollapsed: true }).remaining).toBe(
      1000 - 208 - 40,
    );
  });

  it("a collapsed nav gives its 208px back to main", () => {
    expect(layoutRule({ ...base, windowWidth: 1300, navCollapsed: true }).shouldAutoCollapse).toBe(
      false,
    );
  });
});
