// The dialogue canvas's floating tool rail (README keyboard map: `V` `N` `C`
// `⌫` — Select · Add node · Connect · Delete, plus `⇧1` fit).
//
// EXTENDS `level/ToolRail`'s geometry and its doctrine rather than its code:
// same `.tool-rail` / `.tool` classes, same drag grip via `useDraggablePanel`,
// same "disabled carries its reason" rule. It is a separate component because
// the level rail's tools are tile-painting tools with a `Tool` union of their
// own; sharing the component would mean widening that union with four verbs it
// will never use.
//
// Its real job is the same as the level rail's: making MODE VISIBLE. Connect
// mode with a choice armed looks different from Select mode, and the rail says
// which one you are in.

import { Tooltip } from "../Tooltip";
import { useDraggablePanel } from "../../lib/useDraggablePanel";

export type DialogueTool = "select" | "connect" | "delete";

const TOOLS: { id: DialogueTool; glyph: string; title: string; hint: string; desc: string }[] = [
  {
    id: "select",
    glyph: "▹",
    title: "Select",
    hint: "V",
    desc: "Click a node to open it in the tray. Double-click its line to edit in place.",
  },
  {
    id: "connect",
    glyph: "⇢",
    title: "Connect",
    hint: "C",
    desc: "Click a choice row, then the node it should lead to. Esc cancels the rewire.",
  },
  {
    id: "delete",
    glyph: "⌫",
    title: "Delete",
    hint: "⌫",
    desc: "Click a node to see every consequence before anything is removed.",
  },
];

export function ToolRail({
  tool,
  onTool,
  onAddNode,
  onDelete,
  deleteDisabledReason,
  onFit,
}: {
  tool: DialogueTool;
  onTool: (t: DialogueTool) => void;
  onAddNode: () => void;
  onDelete: () => void;
  deleteDisabledReason?: string;
  onFit: () => void;
}) {
  const { ref, style, gripProps } = useDraggablePanel("dialogueToolRailPos");
  return (
    <div
      ref={ref}
      className="tool-rail dlg-tool-rail"
      role="toolbar"
      aria-label="Dialogue tools"
      style={style}
    >
      <span className="tool-grip" {...gripProps} />
      {TOOLS.map((t) => (
        <Tooltip key={t.id} title={t.title} hint={t.hint} desc={t.desc}>
          <button
            className={tool === t.id ? "tool on" : "tool"}
            aria-label={t.title}
            aria-pressed={tool === t.id}
            onClick={() => onTool(t.id)}
          >
            {t.glyph}
          </button>
        </Tooltip>
      ))}
      <span className="tool-rail-div" />
      <Tooltip title="Add node" hint="N" desc="Add an empty node to this tree and select it.">
        <button className="tool" aria-label="Add node" onClick={onAddNode}>
          ＋
        </button>
      </Tooltip>
      <Tooltip
        title="Delete the selected node"
        hint="⌫"
        desc={deleteDisabledReason || "Preview every consequence, then confirm."}
      >
        <button
          className="tool"
          aria-label="Delete the selected node"
          disabled={!!deleteDisabledReason}
          title={deleteDisabledReason}
          onClick={onDelete}
        >
          ✕
        </button>
      </Tooltip>
      <span className="tool-rail-div" />
      <Tooltip title="Fit to view" hint="⇧1" desc="Fit the whole tree in the canvas.">
        <button className="tool" aria-label="Fit to view" onClick={onFit}>
          ⤢
        </button>
      </Tooltip>
    </div>
  );
}
