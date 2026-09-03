import { useEffect, useState } from "react";
import { api } from "./invoke";

/** One installed template's wizard metadata — canon's `pack templates`
 *  (P0 paper P.4.4, row P0-10). This is the DATA the create wizard renders:
 *  the two cards, their vocabulary line, the count fields on step 2 and their
 *  numeric bands, plus the phase-id → label map every progress surface uses.
 *
 *  `id` is a plain string on purpose (the M0-readiness rule): a third template
 *  is an entry in canon's registry, never a union here. */
export type PackTemplate = {
  id: string;
  label: string;
  description: string;
  vocab: string[];
  /** Count field → its starting value. The field ORDER is this object's. */
  defaults: Record<string, number>;
  /** Count field → [min, max], or null when the template authored no bands. */
  ranges: Record<string, [number, number]> | null;
  /** Counts that live under "Advanced" rather than on the main form (W2.1.1). */
  advanced: string[];
  engine: string[];
  dimension: string;
  /** Derived from the engines block's `exports` — never authored (W2.4). */
  distribution: string[];
  beta: boolean;
  /** §3.0-E: phase id → human label. The SAME map CreateProgress, the JobTray
   *  and the agent's run cards render — no build hardcodes a second list.
   *  Keys are whole ids (`plat:world`), node FAMILIES (`review`) or family
   *  LEAVES (`level:terrain`) — see `phaseLabel`. */
  phase_labels: Record<string, string>;
  /** The generator lanes this template's runner accepts (`llm`, `image`,
   *  `music`, `sfx`, `vlm`). The dungeon has no `vlm` lane, so the wizard
   *  disables Animation for it WITH the reason instead of offering a control
   *  that key-gates and spend-confirms a run canon prices at $0 and ignores. */
  generators: string[];
  /** Count field → `"per_map"` (the generator multiplies by the map count) or
   *  `"total"`. "NPCs 2" on a 3-room dungeon is six NPCs; the label says so. */
  count_scope: Record<string, string>;
};

/** Human count-field labels. The template gives canon's vocabulary (`npc`,
 *  `monster`, `rooms`); this says it in English. A field with no entry
 *  renders its own name Title Cased, so a new count is never invisible —
 *  and NOTHING here invents structure the manifest doesn't have (W2.1.1:
 *  no "Floors"; rooms are rooms). */
const COUNT_LABELS: Record<string, string> = {
  stages: "Stages",
  levels: "Levels per stage",
  enemies: "Enemies",
  items: "Items",
  rooms: "Rooms",
  npc: "NPCs",
  monster: "Monsters",
  item: "Items",
  event: "Encounters",
  quest: "Quests",
  class: "Player classes",
};

export function countLabel(field: string, template?: PackTemplate): string {
  const base =
    COUNT_LABELS[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  // W2.1.1 honesty: canon's own `--npcs` help says "NPCs PER ROOM", because
  // the generator multiplies the count by the map count. The suffix is the
  // template's own `count_scope` value (`per_room` — the entity kind's
  // `per_map` flag plus the template's grid vocabulary), never a table here,
  // so a third template says "per level" without a change in cradle.
  const scope = template?.count_scope?.[field];
  return scope && scope !== "total" ? `${base} ${scope.replace(/_/g, " ")}` : base;
}

/** The count fields shown on the main form vs under Advanced (W2.1.1's split,
 *  which the template declares). Order follows `defaults`. */
export function splitCounts(t: PackTemplate): { primary: string[]; advanced: string[] } {
  const fields = Object.keys(t.defaults);
  return {
    primary: fields.filter((f) => !t.advanced.includes(f)),
    advanced: fields.filter((f) => t.advanced.includes(f)),
  };
}

export function rangeFor(t: PackTemplate, field: string): [number, number] {
  const band = t.ranges?.[field];
  // No authored band = no invented one: an unbounded (non-negative) stepper.
  return band ?? [0, Number.MAX_SAFE_INTEGER];
}

/** Human name for a canon pipeline node, from TEMPLATE DATA (§3.0-E).
 *
 *  `templates` is whatever this surface has loaded; the first map that knows
 *  the id wins. A node no installed template names still renders — de-prefixed
 *  and de-underscored — rather than vanishing, which is what kept the old
 *  hardcoded map honest and is the only part of it worth keeping.
 *
 *  Three keys are tried, because the ORCHESTRATED scheduler (canon's create
 *  default since master §8 Q6) emits per-ARTIFACT nodes and not just phases:
 *  the whole id (`plat:world`), then `<family>:<leaf>` (`level:terrain` for
 *  `level:ashen_depths/l1/terrain`), then the bare `<family>` (`review`). When
 *  a family key matches, the id's own context rides along — "Terrain ·
 *  ashen_depths/l1" — so 41 of a default create's 55 rows read as names
 *  instead of raw ids, from ten entries in the template's map. */
export function phaseLabel(node: string, templates: PackTemplate[] = []): string {
  const id = node.replace(/^phase:/, "");
  const look = (key: string): string | undefined => {
    for (const t of templates) {
      const label = t.phase_labels?.[key];
      if (label) return label;
    }
    return undefined;
  };
  const exact = look(id);
  if (exact) return exact;
  const colon = id.indexOf(":");
  const family = colon >= 0 ? id.slice(0, colon) : "";
  const rest = colon >= 0 ? id.slice(colon + 1) : "";
  if (rest) {
    const cut = rest.lastIndexOf("/");
    const leaf = cut >= 0 ? rest.slice(cut + 1) : rest;
    const byLeaf = look(`${family}:${leaf}`);
    // A leaf label names the LAYER, so the context is what is left of the id;
    // a family label names the whole node, so the context is all of it.
    if (byLeaf) return cut >= 0 ? `${byLeaf} · ${rest.slice(0, cut)}` : byLeaf;
    const byFamily = look(family);
    if (byFamily) return `${byFamily} · ${rest}`;
  }
  const bare = rest || id;
  return bare.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** One in-flight fetch shared by every caller: `pack templates` is pack-less,
 *  immutable for the life of the process, and asked by three surfaces. */
let pending: Promise<PackTemplate[]> | null = null;

export function loadPackTemplates(): Promise<PackTemplate[]> {
  if (!pending) {
    pending = api
      .packTemplates()
      .then((r) => r.templates)
      .catch((e: unknown) => {
        pending = null; // a failure must not poison the cache
        throw e;
      });
  }
  return pending;
}

/** Test seam: drop the memoized fetch. */
export function resetPackTemplates(): void {
  pending = null;
}

export type PackTemplatesState = {
  templates: PackTemplate[];
  loading: boolean;
  /** Non-null when canon could not be asked — surfaces say so (doctrine 4)
   *  instead of silently falling back to a hardcoded list. */
  error: string | null;
};

export function usePackTemplates(): PackTemplatesState {
  const [state, setState] = useState<PackTemplatesState>({
    templates: [],
    loading: true,
    error: null,
  });
  useEffect(() => {
    let live = true;
    loadPackTemplates()
      .then((templates) => live && setState({ templates, loading: false, error: null }))
      .catch(
        (e) => live && setState({ templates: [], loading: false, error: String(e).slice(0, 300) }),
      );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
