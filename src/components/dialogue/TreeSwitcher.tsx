// `⌘P` — the tree & scene quick-switcher (README Q4 affordance 2: *take me to a
// tree I can name*). For a 79-NPC world this, not the rail, is how you move.
//
// EXTENDS `CommandPalette`'s matcher rather than inventing a second one: the
// same subsequence scorer, so "nv" finds "night vigil" here exactly as it finds
// "New level" there. `⌘P` is trees and scenes; `⌘K` stays commands — two
// palettes, one ranking.
//
// Cross-surface results are `--info` blue, the design's "this belongs to
// another surface too" colour: this NPC's own trees first, then scenes, then
// elsewhere in the world.
//
// Deliberately absent, by row ownership: the cross-NPC and quest-dialogue
// sections' DATA (steps 11–12 supply the rows); the section renders its empty
// line rather than vanishing, so the shape is visible from today.

import { useEffect, useMemo, useRef, useState } from "react";
import { scoreCommand } from "../paletteScore";
import { orderedTrees, type AuthorDoc } from "./model";
import { axisMeta } from "./axes";
import type { DialogueVocab } from "./grammar";

type Row = {
  id: string;
  label: string;
  group: string;
  detail: string;
  /** Cross-surface rows paint `--info`. */
  elsewhere?: boolean;
  pick: () => void;
};

export function TreeSwitcher({
  doc,
  vocab,
  onPick,
  onClose,
  elsewhere = [],
}: {
  doc: AuthorDoc;
  vocab: DialogueVocab;
  onPick: (treeId: string) => void;
  onClose: () => void;
  /** Other NPCs' trees, scenes and quest dialogues (steps 11–12). */
  elsewhere?: { id: string; label: string; detail: string; pick: () => void }[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo<Row[]>(() => {
    const mine: Row[] = orderedTrees(doc).map((tree) => ({
      id: tree.tree_id,
      label: tree.label || tree.tree_id,
      group: axisMeta(tree.axis).label,
      detail: tree.selector?.rows.join(" · ") ?? `${Object.keys(tree.nodes).length} nodes`,
      pick: () => onPick(tree.tree_id),
    }));
    return [
      ...mine,
      ...elsewhere.map((row) => ({
        id: row.id,
        label: row.label,
        group: "Elsewhere in the world",
        detail: row.detail,
        elsewhere: true,
        pick: row.pick,
      })),
    ];
  }, [doc, elsewhere, onPick]);

  const matches = useMemo(() => {
    const scored = rows
      .map((row) => ({
        row,
        s: scoreCommand({ label: row.label, group: row.group, keywords: row.detail }, query),
      }))
      .filter((x): x is { row: Row; s: number } => x.s !== null);
    scored.sort((a, b) => a.s - b.s);
    return scored.map((x) => x.row);
  }, [query, rows]);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  useEffect(() => {
    setActive((a) => (a >= matches.length ? Math.max(0, matches.length - 1) : a));
  }, [matches.length]);

  // The vocabulary the switcher searches is the pack's, so an axis a template
  // adds is findable by its own name without a code change.
  const axisNames = vocab.selector_axes.join(" · ");

  return (
    <div className="dlg-switcher-scrim" onClick={onClose} role="presentation">
      <div
        className="dlg-switcher"
        role="dialog"
        aria-label="Tree and scene switcher"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="dlg-switcher-input"
          placeholder="Go to a tree or scene…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              matches[active]?.pick();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="dlg-switcher-list">
          {matches.length === 0 ? (
            <p className="dlg-switcher-empty">
              nothing matches. This character's axes are{" "}
              <span className="dlg-mono">{axisNames}</span>.
            </p>
          ) : (
            matches.map((row, i) => (
              <button
                key={row.id}
                className={`dlg-switcher-row ${i === active ? "on" : ""}`}
                data-elsewhere={row.elsewhere ? "1" : undefined}
                data-active={i === active ? "1" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={row.pick}
              >
                <span className="dlg-switcher-label">{row.label}</span>
                <span className="dlg-mono dlg-dim">{row.detail}</span>
                <span className="dlg-switcher-group">{row.group}</span>
              </button>
            ))
          )}
        </div>
        <footer className="dlg-switcher-foot dlg-dim">
          ↑↓ navigate · ↵ open · esc close · ⌘P trees · ⌘K commands
        </footer>
      </div>
    </div>
  );
}
