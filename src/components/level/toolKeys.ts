import type { Tool } from "./ToolRail";

/** Single-key shortcuts, matching the hints the tooltips show. Beside
 *  `ToolRail.tsx` so that file exports only its component (react-refresh). */
export const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  b: "paint",
  g: "fill",
  e: "erase",
};
