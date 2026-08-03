import { Icon } from "../start/Icons";
import { Tooltip } from "../Tooltip";
import { useDraggablePanel } from "../../lib/useDraggablePanel";

/** The world map's tool rail — a floating cluster at the top-right of the
 *  stage, per `05 World map.html`.
 *
 *  Tools were a segmented control in the header before this, which put the
 *  modes furthest from the canvas they act on and left three of the design's
 *  six missing. The rail is movable through the same grip the level editor's
 *  rail uses (`useDraggablePanel`), not a second implementation.
 *
 *  Two tools are DISABLED with the reason on the tooltip rather than hidden.
 *  Both reasons are structural, and a greyed row that explains itself beats a
 *  gap you can't ask about — the same rule the command palette follows.
 */

export type WorldTool = "select" | "place" | "path" | "area" | "stop" | "start";

const TOOLS: {
  id: WorldTool;
  icon: string;
  title: string;
  hint?: string;
  desc: string;
  /** Set when the tool can't act — the string is shown instead of a shortcut. */
  blocked?: string;
  /** Starts the second (post-divider) group in the design's rail. */
  divide?: boolean;
}[] = [
  {
    id: "select",
    icon: "g-select",
    title: "Select",
    hint: "V",
    desc: "Pick levels, paths and areas. Drag a level to reposition it — that counts as a human edit.",
  },
  {
    id: "place",
    icon: "g-place",
    title: "Place level",
    hint: "L",
    desc: "Click the map to drop a flat draft level. Generate it now or leave it blank and design it later.",
  },
  {
    id: "path",
    icon: "g-path",
    title: "Draw path",
    hint: "P",
    desc: "Click two levels to connect them. Set direction and unlock conditions in the inspector.",
  },
  {
    id: "area",
    icon: "g-area",
    title: "Area",
    hint: "A",
    desc: "Areas are the pack's stages, and their shape is the bounding box of the levels inside — so there is nothing freehand to draw. Move a level between areas by publishing it into another stage.",
    blocked: "areas are stages",
  },
  {
    id: "stop",
    icon: "g-stop",
    title: "Path stops",
    hint: "S",
    desc: "Click a path to add a point mid-way where the player can pause, jump and hunt for secret exits. Click a stop again to remove it.",
    divide: true,
  },
  {
    id: "start",
    icon: "g-start",
    title: "Player start",
    desc: "Where a new save begins the world. That's the first level of the first area today and isn't editable yet.",
    blocked: "not editable yet",
  },
];

export function WorldToolRail({
  tool,
  onTool,
}: {
  tool: WorldTool;
  onTool: (t: WorldTool) => void;
}) {
  const { ref, style, gripProps } = useDraggablePanel("worldRailPos");

  return (
    <div ref={ref} className="tool-rail wm-rail" role="toolbar" aria-label="World map tools" style={style}>
      <span className="tool-grip" {...gripProps} />
      {TOOLS.map((t) => (
        <span key={t.id} style={{ display: "contents" }}>
          {t.divide && <span className="tool-rail-div" />}
          <Tooltip title={t.title} hint={t.blocked ?? t.hint} desc={t.desc}>
            <button
              className={tool === t.id ? "tool on" : "tool"}
              aria-label={t.title}
              aria-pressed={tool === t.id}
              disabled={!!t.blocked}
              onClick={() => onTool(t.id)}
            >
              <Icon id={t.icon} size={15} />
            </button>
          </Tooltip>
        </span>
      ))}
    </div>
  );
}

/** Single-key shortcuts for the rail, mirroring the design's V/L/P/S. */
export const TOOL_KEYS: Record<string, WorldTool> = {
  v: "select",
  l: "place",
  p: "path",
  s: "stop",
};
