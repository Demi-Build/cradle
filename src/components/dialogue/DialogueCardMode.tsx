import { useCallback, useMemo, useRef } from "react";
import type { Beat, BeatEdge, BeatKind } from "./types";
import { bfsOrderBeats } from "./types";
import { DialogueCard, type BeatEdit } from "./DialogueCard";

const SECTION_ORDER: BeatKind[] = [
  "greeting",
  "tree",
  "gate",
  "tree-complete",
  "success",
  "tree-incomplete",
  "tree-failed",
  "failure",
  "exhausted",
];
const SECTION_LABEL: Record<BeatKind, string> = {
  greeting: "Opening greeting",
  tree: "Dialogue tree",
  gate: "Quest gate · resolution",
  "tree-complete": "Quest complete · tree",
  "tree-failed": "Quest failed · tree",
  "tree-incomplete": "Quest in progress · tree",
  success: "Quest outcome · success",
  failure: "Quest outcome · failure",
  exhausted: "Exhausted",
};

export function DialogueCardMode({
  beats,
  edges,
  editMode = false,
  onEdit,
}: {
  beats: Beat[];
  edges: BeatEdge[];
  editMode?: boolean;
  onEdit?: (beatId: string, change: BeatEdit) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollTo = useCallback((beatId: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-beat-id="${CSS.escape(beatId)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("dc-highlight");
    window.setTimeout(() => el.classList.remove("dc-highlight"), 900);
  }, []);

  // BFS the tree subset so cards appear in navigation order (start → choices → end),
  // not whatever order they happen to sit in JSON.
  const grouped = useMemo(() => {
    const byKind = new Map<BeatKind, Beat[]>();
    for (const b of beats) {
      if (!byKind.has(b.kind)) byKind.set(b.kind, []);
      byKind.get(b.kind)!.push(b);
    }
    // BFS-order each tree lane so cards appear in navigation order.
    const treeKinds: BeatKind[] = ["tree", "tree-complete", "tree-failed", "tree-incomplete"];
    for (const kind of treeKinds) {
      const laneBeats = byKind.get(kind) ?? [];
      if (laneBeats.length <= 1) continue;
      const laneEdges = edges.filter((e) => {
        const from = beats.find((b) => b.id === e.from);
        const to = beats.find((b) => b.id === e.to);
        return from?.kind === kind && to?.kind === kind;
      });
      const order = bfsOrderBeats(laneBeats, laneEdges);
      const byId = new Map(laneBeats.map((b) => [b.id, b]));
      const sorted: Beat[] = [];
      for (const id of order) {
        const b = byId.get(id);
        if (b) sorted.push(b);
      }
      byKind.set(kind, sorted);
    }
    return byKind;
  }, [beats, edges]);

  return (
    <div className="dialogue-card-mode" ref={containerRef}>
      {SECTION_ORDER.map((kind) => {
        const section = grouped.get(kind);
        if (!section || section.length === 0) return null;
        return (
          <section key={kind} className={`dialogue-section kind-${kind}`}>
            <div className="dialogue-section-head">
              <span className={`dialogue-section-swatch kind-${kind}`} />
              <span className="dialogue-section-label">{SECTION_LABEL[kind]}</span>
              <span className="dialogue-section-count">{section.length}</span>
            </div>
            <div className="dialogue-section-body">
              {section.map((b) => (
                <DialogueCard
                  key={b.id}
                  beat={b}
                  mode="full"
                  onChoiceClick={scrollTo}
                  editMode={editMode}
                  onEdit={onEdit}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
