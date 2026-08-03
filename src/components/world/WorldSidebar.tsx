import { useStore } from "../../store";
import { areaName, areaStroke, nodeLabel } from "./drawWorld";
import type { WorldMapNode } from "../../lib/invoke";

/** The world map's 208px sidebar (design screen 05).
 *
 *  While the map is open this REPLACES the type list in the left nav rather
 *  than adding a second sidebar beside it — the design has exactly one 208px
 *  column, and on this screen it is area-centric: areas, the levels inside
 *  them, and their secret rooms as children.
 *
 *  Rows select the same objects the canvas does (shared `worldMapSel`), so
 *  clicking `1-2` here and clicking its node there are the same act.
 */
export function WorldSidebar() {
  const map = useStore((s) => s.worldMap);
  const sel = useStore((s) => s.worldMapSel);
  const setSel = useStore((s) => s.setWorldMapSel);
  const select = useStore((s) => s.select);
  const world = useStore((s) => s.world);

  if (!map) return <div className="wm-side-empty">loading the map…</div>;

  const byId = new Map(map.nodes.map((n) => [n.level_id, n]));
  const areaIds = new Set(map.areas.map((a) => a.stage_id));
  // Nodes whose stage isn't one of the areas — defensive, but if it ever
  // happens the level must not silently vanish from the list.
  const unassigned = map.nodes.filter((n) => !areaIds.has(n.stage_id));
  // A draft nobody has positioned sits at the map's default spot: it exists,
  // but it has no place in the world yet.
  const unplaced = map.nodes.filter((n) => n.status === "planned" && n.origin !== "manual");
  const sets = world?.entity_counts.find((c) => c.type_id === "tilesets")?.count ?? 0;

  const levelRow = (n: WorldMapNode) => (
    <div key={n.level_id}>
      <button
        className={`wm-row ${sel?.kind === "node" && sel.id === n.level_id ? "on" : ""}`}
        onClick={() => setSel({ kind: "node", id: n.level_id })}
      >
        <span>
          {nodeLabel(n)}
          {n.status === "planned" && <span className="n"> planned</span>}
        </span>
        <span className="n">{n.size ?? "—"}</span>
      </button>
      {(n.rooms ?? []).map((r) => (
        <button
          key={r}
          className="wm-row sub"
          title="A secret room INSIDE this level — it has no node of its own on the world map"
          onClick={() => select({ kind: "entity", typeId: "levels", id: r })}
        >
          ↳ {r}
        </button>
      ))}
    </div>
  );

  return (
    <div className="wm-side">
      <h4>{map.world || world?.name}</h4>
      <div className="wm-grp">
        Areas <span className="n">{map.areas.length}</span>
      </div>
      {map.areas.map((a, i) => (
        <div key={a.stage_id}>
          <button
            className={`wm-ar ${sel?.kind === "area" && sel.id === a.stage_id ? "on" : ""}`}
            onClick={() => setSel({ kind: "area", id: a.stage_id })}
          >
            <span className="sw" style={{ background: areaStroke(i) }} />
            <span className="m">
              <b>{areaName(a)}</b>
              <i>
                {a.level_ids.length} levels · {a.music ?? "no music"}
              </i>
            </span>
          </button>
          {a.level_ids.map((id) => {
            const n = byId.get(id);
            return n ? levelRow(n) : null;
          })}
        </div>
      ))}

      {unassigned.length > 0 && (
        <>
          <div className="wm-grp">
            Unassigned <span className="n">{unassigned.length}</span>
          </div>
          {unassigned.map(levelRow)}
        </>
      )}

      {unplaced.length > 0 && (
        <>
          <div className="wm-hr" />
          <div className="wm-grp">
            Unplaced levels <span className="n">{unplaced.length}</span>
          </div>
          {unplaced.map((n) => (
            <button
              key={n.level_id}
              className={`wm-row ${sel?.kind === "node" && sel.id === n.level_id ? "on" : ""}`}
              title="Exists, but nobody has given it a position in the world yet — drag its node to place it"
              onClick={() => setSel({ kind: "node", id: n.level_id })}
            >
              <span>
                {nodeLabel(n)} <span className="n">{n.size ?? "draft"}</span>
              </span>
              <span className="n">›</span>
            </button>
          ))}
        </>
      )}

      <div className="wm-side-foot">
        <button
          className="btn wide"
          disabled
          title="Areas are the pack's stages, so a new area means a new stage — that isn't wired from here yet."
        >
          New area
        </button>
        <button className="wm-grp as-btn" onClick={() => select({ kind: "library" })}>
          Library <span className="n">{sets} sets</span>
        </button>
      </div>
    </div>
  );
}
