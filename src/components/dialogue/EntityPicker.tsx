// The one "pick from the world" popover (README §3a). Adding an NPC to a scene
// and choosing an item for a condition are the same gesture, learned once.
//
// EXTENDS the store's already-cached `entities.*` — no fetch, so the popover
// opens instantly. That cache is what the entity tables and `EntityLink`
// already read; this is a third reader, not a second cache.
//
// Two rules the prototypes encode and this implementation keeps, both pinned by
// tests because both are easy to "simplify" away:
//
//   1. `exclude` DISABLES, never filters. Filtering out an already-added NPC
//      makes a search for them look like they don't exist in the world.
//   2. `consequence` is computed BEFORE the pick and applied as part of the
//      SAME op, so one `⌘Z` reverses both. Picking an NPC outside the quest's
//      rooms appends a `room:` condition — the row says so first.
//
// The footer previews `formatToken()` of the pick-in-progress plus its
// engine-evaluability dot, so the picker never hides what it produced.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store";
import { formatToken, type Token } from "./grammar";
import type { EntityRef } from "../../lib/invoke";

export type PickerSlot = {
  /** Entity type ids to offer — one type hides the tab row. */
  types: string[];
  /** Drives result GROUPING: current room, then current quest, then the rest. */
  scope?: { room?: string; quest?: string; npc?: string };
  /** Ids already used — rendered DISABLED, never filtered. */
  exclude?: string[];
  excludeReason?: (id: string) => string;
  /** What the pick will do, computed before it is made. */
  consequence?: (id: string) => string | null;
  /** The state select's options for this slot (`seen`/`solved`/`present`). */
  states?: string[];
  onPick: (id: string, state?: string) => void;
};

/** The header line: what is being picked and where it will land. */
export function EntityPicker({
  title,
  slot,
  namespace,
  engineEvaluable,
  onClose,
}: {
  title: string;
  slot: PickerSlot;
  /** The namespace the pick becomes a token in, for the footer preview. */
  namespace?: string;
  engineEvaluable?: (token: Token) => boolean;
  onClose: () => void;
}) {
  const entities = useStore((s) => s.entities);
  const [type, setType] = useState(slot.types[0] ?? "");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<{ id: string; state?: string } | null>(null);
  const [state, setState] = useState(slot.states?.[0]);
  /** The roving index `↑↓` moves and `↵` commits — the footer advertises both
   *  keys, so both have to exist (the same class of defect `lib/keys.ts` records
   *  for `⌘O`: a hint renders the key the reader actually presses). */
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const excluded = useMemo(() => new Set(slot.exclude ?? []), [slot.exclude]);

  const rows = useMemo(() => {
    const list: EntityRef[] = entities[type] ?? [];
    const q = query.trim().toLowerCase();
    const hit = (r: EntityRef) =>
      !q || r.id.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q);
    // Grouping is by PROXIMITY to the current scope, not alphabetical: an exact
    // id match first, then everything else. The scope's room/quest grouping
    // needs each row's own room and quest, which the ref does not carry — the
    // surfaces that have it pass it as `scope` and the group header says so.
    const matched = list.filter(hit);
    const exact = matched.filter((r) => r.id.toLowerCase() === q);
    const rest = matched.filter((r) => r.id.toLowerCase() !== q);
    return [...exact, ...rest];
  }, [entities, query, type]);

  // Disabled rows are skipped by the keys but stay VISIBLE (rule 1).
  const pickable = useMemo(
    () => rows.map((r, i) => ({ i, id: r.id })).filter((r) => !excluded.has(r.id)),
    [excluded, rows],
  );

  // A new search resets the cursor to the first pickable row.
  useEffect(() => {
    setActive(pickable[0]?.i ?? -1);
  }, [pickable]);

  const moveActive = (delta: number) => {
    if (pickable.length === 0) return;
    const at = pickable.findIndex((r) => r.i === active);
    const next =
      pickable[(((at < 0 ? 0 : at + delta) % pickable.length) + pickable.length) % pickable.length];
    setActive(next.i);
    setHover({ id: rows[next.i].id, state });
  };

  const preview = hover
    ? formatToken(namespace ?? type, hover.id, hover.state ?? state ?? null)
    : null;

  return (
    <div className="dlg-picker" role="dialog" aria-label={title}>
      <header className="dlg-picker-head">
        <span>Pick from the world</span>
        <span className="dlg-mono dlg-dim">{title}</span>
      </header>
      <input
        ref={inputRef}
        className="dlg-picker-search"
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            moveActive(e.key === "ArrowDown" ? 1 : -1);
            return;
          }
          if (e.key === "Enter") {
            const row = rows[active];
            if (!row || excluded.has(row.id)) return;
            e.preventDefault();
            slot.onPick(row.id, state);
          }
        }}
        aria-label="Search the world"
      />
      {slot.types.length > 1 ? (
        <div className="dlg-picker-tabs">
          {slot.types.map((t) => (
            <button
              key={t}
              className={`seg-btn ${t === type ? "active" : ""}`}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      <div className="dlg-picker-list">
        {rows.length === 0 ? (
          <p className="dlg-picker-empty">
            nothing in <span className="dlg-mono">{type}</span> matches. The list is the pack's own
            rows — an id that is not here does not exist in this world.
          </p>
        ) : (
          rows.map((row) => {
            const why = excluded.has(row.id)
              ? (slot.excludeReason?.(row.id) ?? "already used")
              : null;
            const consequence = slot.consequence?.(row.id) ?? null;
            const isActive = rows[active]?.id === row.id;
            return (
              <button
                key={row.id}
                className={`dlg-picker-row ${isActive ? "on" : ""}`}
                aria-selected={isActive}
                // Rule 1: already-added rows stay VISIBLE and disabled with the
                // reason, so searching for someone you added does not look like
                // they are missing from the world.
                disabled={!!why}
                title={why ?? undefined}
                onMouseEnter={() => setHover({ id: row.id, state })}
                onFocus={() => setHover({ id: row.id, state })}
                onClick={() => slot.onPick(row.id, state)}
              >
                <span className="dlg-picker-name">{row.name ?? row.id}</span>
                <span className="dlg-mono dlg-dim">{row.id}</span>
                {why ? <span className="dlg-picker-why">{why}</span> : null}
                {/* Rule 2: the consequence is named on the row, before the pick. */}
                {consequence ? <span className="dlg-picker-consequence">{consequence}</span> : null}
              </button>
            );
          })
        )}
      </div>
      {slot.states?.length ? (
        <div className="dlg-picker-state">
          <label>
            state
            <select value={state} onChange={(e) => setState(e.target.value)}>
              {slot.states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <footer className="dlg-picker-foot">
        {preview ? (
          <>
            <span className="dlg-mono">{preview}</span>
            <span
              className="dlg-ribbon-dot"
              data-engine={engineEvaluable?.(preview) === false ? "lag" : "ok"}
            />
          </>
        ) : (
          <span className="dlg-dim">token previewed here before you commit</span>
        )}
        <span className="dlg-dim">↑↓ navigate · ↵ insert · esc close</span>
      </footer>
    </div>
  );
}
