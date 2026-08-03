import { useEffect, useState } from "react";
import { api, type WorldMap } from "../../lib/invoke";
import { areaHue, areaName, nodeLabel, WORLD_H, WORLD_W } from "../world/drawWorld";
import type { RecentProject } from "../../lib/recents";
import { Icon } from "./Icons";

/** "World at a glance" — the 392px panel in the start hero (design screen 06).
 *
 *  Deliberately the SAME vocabulary as the world map screen: dashed area
 *  rectangles at 10% fill, 12px node squares, thin edges, dashed dim for
 *  planned. The design's point is that the two read as one product, so this
 *  draws from the same `worldMap` payload rather than a start-page-only model.
 *
 *  Reads the pack directly, so it works with no project loaded.
 */
export function WorldGlance({ recent }: { recent: RecentProject }) {
  const [map, setMap] = useState<WorldMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [pane, setPane] = useState<"map" | "sets" | "levels">("map");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    setMap(null);
    setFailed(false);
    api
      .worldMap(recent.path)
      .then((m) => alive && setMap(m))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [recent.path]);

  const planned = map?.nodes.filter((n) => n.status === "planned").length ?? 0;
  const built = (map?.nodes.length ?? 0) - planned;
  const meta =
    pane === "map"
      ? map
        ? `${map.areas.length} areas · ${map.nodes.length} levels`
        : ""
      : pane === "sets"
        ? `${map?.areas.length ?? 0} sets`
        : `${map?.nodes.length ?? 0} levels`;

  return (
    <aside className="glance" data-open={open ? "1" : "0"} data-pane={pane}>
      <div className="glance-head">
        <span className="glance-title">World at a glance</span>
        <span className="glance-meta">{meta}</span>
        <button
          className="glance-min"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Minimise" : "Expand"}
          aria-expanded={open}
        >
          <Icon id="g-chev-d" size={13} />
        </button>
      </div>

      {open && (
        <>
          <div className="glance-tabs">
            {(
              [
                ["map", "Map"],
                ["sets", "Asset sets"],
                ["levels", "Levels"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={pane === id ? "glance-tab on" : "glance-tab"}
                onClick={() => setPane(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="glance-pane">
            {!map && !failed && <div className="glance-empty">reading the world…</div>}
            {failed && (
              <div className="glance-empty">
                no world map — this project may predate one, or canon isn't on PATH
              </div>
            )}
            {map && pane === "map" && <GlanceMap map={map} />}
            {map && pane === "sets" && (
              <ul className="glance-list">
                {map.areas.map((a) => (
                  <li key={a.stage_id}>
                    <b>{areaName(a)}</b>
                    <span>{a.blocks || a.biome || "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            {map && pane === "levels" && (
              <ul className="glance-list">
                {map.nodes.map((n) => (
                  <li key={n.level_id}>
                    <b>{nodeLabel(n)}</b>
                    <span>{n.status === "planned" ? "planned" : (n.size ?? "—")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="glance-foot">
            <span>
              <i className="dot built" />
              {built} built
            </span>
            <span>
              <i className="dot planned" />
              {planned} planned
            </span>
            {recent.validation === "validated" && <span className="ok">validated ✓</span>}
          </div>
        </>
      )}
    </aside>
  );
}

/** The schematic itself. An SVG, not a canvas: it's small, static and lives in
 *  a scaled hero — vector keeps it crisp with no DPR bookkeeping. */
function GlanceMap({ map }: { map: WorldMap }) {
  const VB_W = 360;
  const VB_H = 196;
  const NODE = 12;
  const PAD = 10;
  const at = (n: { pos: [number, number] }) => ({
    x: PAD + (n.pos[0] * WORLD_W * (VB_W - PAD * 2)) / WORLD_W,
    y: PAD + (n.pos[1] * WORLD_H * (VB_H - PAD * 2)) / WORLD_H,
  });
  const byId = new Map(map.nodes.map((n) => [n.level_id, n]));

  return (
    <svg
      className="glance-svg"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label="World map preview"
    >
      {map.areas.map((a, i) => {
        const members = map.nodes.filter((n) => a.level_ids.includes(n.level_id));
        if (!members.length) return null;
        const pts = members.map(at);
        const x = Math.min(...pts.map((p) => p.x)) - NODE;
        const y = Math.min(...pts.map((p) => p.y)) - NODE;
        const w = Math.max(...pts.map((p) => p.x)) + NODE - x;
        const h = Math.max(...pts.map((p) => p.y)) + NODE - y;
        const hue = areaHue(i);
        return (
          <rect
            key={a.stage_id}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={7}
            fill={`oklch(60% 0.13 ${hue} / 0.10)`}
            stroke={`oklch(72% 0.13 ${hue})`}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        );
      })}
      {map.edges.map((e, i) => {
        const a = byId.get(e.a);
        const b = byId.get(e.b);
        if (!a || !b) return null;
        const p = at(a);
        const q = at(b);
        const locked = e.kind === "lock";
        const isNew = e.kind === "new";
        return (
          <line
            key={i}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            strokeWidth={1.2}
            stroke={
              locked ? "oklch(72% 0.14 45 / 0.8)" : isNew ? "var(--fg-dim)" : "var(--border-hi)"
            }
            strokeDasharray={locked ? "4 3" : isNew ? "2 4" : undefined}
          />
        );
      })}
      {map.nodes.map((n) => {
        const p = at(n);
        const planned = n.status === "planned";
        return (
          <rect
            key={n.level_id}
            x={p.x - NODE / 2}
            y={p.y - NODE / 2}
            width={NODE}
            height={NODE}
            rx={2}
            fill={planned ? "transparent" : "var(--bg-raised)"}
            stroke={planned ? "var(--fg-dim)" : "var(--border-hi)"}
            strokeDasharray={planned ? "2 2" : undefined}
          />
        );
      })}
    </svg>
  );
}
