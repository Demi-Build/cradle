import { useCallback, useRef } from "react";
import { DialogueCard } from "./DialogueCard";
import { bfsOrder, entryNodeId, isTerminal, type DialogueTree } from "./types";

export function DialogueCardMode({ tree }: { tree: DialogueTree }) {
  const entry = entryNodeId(tree);
  const order = bfsOrder(tree, entry);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollTo = useCallback((nodeId: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(nodeId)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("dc-highlight");
    window.setTimeout(() => el.classList.remove("dc-highlight"), 900);
  }, []);

  return (
    <div className="dialogue-card-mode" ref={containerRef}>
      {order.map((id) => {
        const node = tree.nodes[id];
        if (!node) return null;
        return (
          <DialogueCard
            key={id}
            nodeId={id}
            node={node}
            mode="full"
            isEntry={id === entry}
            isTerminal={isTerminal(node)}
            onChoiceClick={scrollTo}
          />
        );
      })}
    </div>
  );
}
