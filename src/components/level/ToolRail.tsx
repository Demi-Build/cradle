import { Icon } from "../start/Icons";
import { Tooltip } from "../Tooltip";

/** The level editor's tool rail — a floating cluster over the canvas.
 *
 *  Its real job is making MODE VISIBLE. The editor already had these modes,
 *  but only implicitly: "select" meant no brush was armed, "paint" meant one
 *  was, and erase was a right-click you had to know about. The design's
 *  complaint (A2) was exactly that — three implicit states with nothing on
 *  screen saying which one you're in.
 *
 *  Erase stays available on right-click at ALL times regardless of the active
 *  tool: that's a user-locked behaviour matching Godot's TileMap editor, and
 *  the Erase tool is an ADDITION (left-click erases too), not a replacement.
 */

export type Tool = "select" | "paint" | "fill" | "erase";

const TOOLS: {
  id: Tool;
  icon: string;
  title: string;
  hint: string;
  desc: string;
}[] = [
  {
    id: "select",
    icon: "g-cursor",
    title: "Select",
    hint: "V",
    desc: "Click a placement to inspect it, drag to move it. Drag empty space to pan.",
  },
  {
    id: "paint",
    icon: "g-brush",
    title: "Paint",
    hint: "B",
    desc: "Paint the armed palette entry. Pick a tile, enemy or item from the rail first.",
  },
  {
    id: "fill",
    icon: "g-fill",
    title: "Fill",
    hint: "G",
    desc: "Flood-fill every connected cell of the same tile type with the armed tile.",
  },
  {
    id: "erase",
    icon: "g-eraser",
    title: "Erase",
    hint: "E",
    desc: "Left-click removes a placement, else clears the tile. Right-click always erases, whatever tool is active.",
  },
];

export function ToolRail({
  tool,
  onTool,
  showBounds,
  onToggleBounds,
  onOpenMusic,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  showBounds: boolean;
  onToggleBounds: () => void;
  onOpenMusic: () => void;
}) {
  return (
    <div className="tool-rail" role="toolbar" aria-label="Level tools">
      {TOOLS.map((t) => (
        <Tooltip key={t.id} title={t.title} hint={t.hint} desc={t.desc}>
          <button
            className={tool === t.id ? "tool on" : "tool"}
            aria-label={t.title}
            aria-pressed={tool === t.id}
            onClick={() => onTool(t.id)}
          >
            <Icon id={t.icon} size={15} />
          </button>
        </Tooltip>
      ))}
      <span className="tool-rail-div" />
      <Tooltip
        title="Bounds"
        desc="Show the ceiling, floor, kill plane and the gaps a player can fall through."
      >
        <button
          className={showBounds ? "tool on" : "tool"}
          aria-label="Bounds"
          aria-pressed={showBounds}
          onClick={onToggleBounds}
        >
          <Icon id="g-bounds" size={15} />
        </button>
      </Tooltip>
      <Tooltip
        title="Music regions"
        hint="M"
        desc="Assign this level's track, or carve it into regions that change the music as the player advances."
      >
        <button className="tool" aria-label="Music regions" onClick={onOpenMusic}>
          <Icon id="g-music" size={15} />
        </button>
      </Tooltip>
    </div>
  );
}
