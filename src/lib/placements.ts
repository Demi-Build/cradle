// The room editor's Dock tabs, derived from `pack info` (P0 paper P.3.2:
// "Dock tabs = the `kind` of every `placements` entry, in this order").
// Labels come from the same document's entity block; the wire key names the
// shared bundle's literal list (P.9 G9) the tab reads its rows from. Nothing
// here is a fixed vocabulary — a third template's placements render the same
// way (row P0-5; P0-8 reuses this for the editable tabs).

import type { PackInfo } from "./invoke";

export type PlacementTab = {
  /** The placement key in maze.json (`npc_positions`) — the tab id. */
  key: string;
  /** The EntityKind it places (`npc`), as canon names it. */
  kind: string;
  /** The bundle list it rides on: `entities` | `items` | `triggers`. */
  wire: string;
  /** Display label from `pack info`'s entity block (`NPCs`). */
  label: string;
  /** Cradle's entity type id for the row (`npcs`) — for EntityLink / select. */
  typeId: string;
};

/** Cradle's type ids are the plural of canon's kind everywhere the two
 *  already meet (`npc` → `npcs`, `event` → `events`, `item` → `items`) — the
 *  irregular plurals are the only data this table needs. */
const TYPE_ID_BY_KIND: Record<string, string> = {
  enemy: "enemies",
  class: "classes",
};

export function typeIdForKind(kind: string): string {
  return TYPE_ID_BY_KIND[kind] ?? `${kind}s`;
}

/** The canon kind behind a cradle type id, resolved against `pack info`'s own
 *  entity list (row P0-8) — the replacement for `RowEditor`'s 2-entry
 *  `{enemies: "enemy", items: "item"}` literal. Falls back to the plural
 *  inverse so a source without pack info still names something sensible. */
export function kindForTypeId(info: PackInfo | null | undefined, typeId: string): string {
  for (const kind of Object.keys(info?.entities ?? {})) {
    if (typeIdForKind(kind) === typeId) return kind;
  }
  return typeId.endsWith("ies")
    ? `${typeId.slice(0, -3)}y`
    : typeId.endsWith("es") && typeId.endsWith("sses")
      ? typeId.slice(0, -2)
      : typeId.endsWith("s")
        ? typeId.slice(0, -1)
        : typeId;
}

/** Kinds a row editor may CREATE: every kind the registry declares except the
 *  ones a grid owns (a room is made by its own grid verb, not `db new`).
 *  Data, never a hardcoded list of type ids (row P0-8 replaces
 *  `EntityTable`'s platformer gate with this). */
export function creatableKinds(info: PackInfo | null | undefined): Set<string> {
  const gridOwned = new Set(Object.keys(info?.grids ?? {}));
  return new Set(Object.keys(info?.entities ?? {}).filter((kind) => !gridOwned.has(kind)));
}

/** The tabs for the grid named `gridKind` (else the first grid the pack
 *  declares), in the registry's placement order; empty when the pack info
 *  carries no grids (a source without canon). */
export function placementTabs(
  info: PackInfo | null | undefined,
  gridKind?: string,
): PlacementTab[] {
  const grids = info?.grids ?? {};
  const grid = gridKind ? grids[gridKind] : Object.values(grids)[0];
  if (!grid) return [];
  return Object.entries(grid.placements ?? {}).map(([key, p]) => ({
    key,
    kind: p.kind,
    wire: p.wire,
    label: info?.entities?.[p.kind]?.label ?? p.kind,
    typeId: typeIdForKind(p.kind),
  }));
}
