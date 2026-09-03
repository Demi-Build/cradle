import type { WorldTool } from "./WorldToolRail";

/** Single-key shortcuts for the rail, mirroring the design's V/L/P/S.
 *  Beside `WorldToolRail.tsx` so that file exports only its component. */
export const TOOL_KEYS: Record<string, WorldTool> = {
  v: "select",
  l: "place",
  p: "path",
  s: "stop",
};
