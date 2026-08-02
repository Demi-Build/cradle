import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type WorldMap, type WorldMapEdge } from "../../lib/invoke";
import { useStore } from "../../store";
import { countProblems } from "../../lib/validation";
import {
  areaHull,
  drawWorld,
  hitTest,
  WORLD_H,
  WORLD_W,
  type WorldCamera,
  type WorldMode,
  type WorldSel,
} from "./drawWorld";

/** The world map: place levels, group them into areas, wire the paths.
 *
 *  Two canvas treatments over ONE graph (schematic / overworld), switched from
 *  the header — a restyle, never a fork, per the design.
 *
 *  Dragging a node writes a DURABLE override through `world map-edit`. That
 *  matters: the map itself is recomputed from the seed on every resume, so
 *  without the override the next generation run would silently revert it.
 */
export function WorldMapView() {
  const worldPath = useStore((s) => s.worldPath);
  const select = useStore((s) => s.select);
  const [map, setMap] = useState<WorldMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<WorldMode>("schematic");
  const [sel, setSel] = useState<WorldSel | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** select = inspect/drag · place = drop a new draft level · connect = wire
   *  two nodes into a path. */
  const [tool, setTool] = useState<"select" | "place" | "connect">("select");
  /** First endpoint while the connect tool is mid-gesture. */
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, HTMLImageElement>>({});
  const levelValidation = useStore((st) => st.levelValidation);

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ ox: 0, oy: 0, zoom: 1 });
  const [viewSize, setViewSize] = useState({ w: 800, h: 480 });
  const pan = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const mapRef = useRef<WorldMap | null>(null);

  const load = async () => {
    try {
      const m = await api.worldMap(worldPath);
      setMap(m);
      mapRef.current = m;
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldPath]);

  // Same two-path container measurement the level canvas needs. NOTE the
  // stage below is rendered UNCONDITIONALLY: an early `return <Loading/>`
  // meant this `[]` effect ran while boxRef was still null, so the observer
  // never attached and the canvas stayed at its 80px floor forever.
  const syncSize = () => {
    const box = boxRef.current;
    if (!box) return;
    const w = Math.max(80, box.clientWidth);
    const h = Math.max(80, box.clientHeight);
    setViewSize((p) => (p.w === w && p.h === h ? p : { w, h }));
  };
  useLayoutEffect(syncSize);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(syncSize);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Level thumbnails (canon's review renders). Resolved per node id; a level
  // with no render just draws its placeholder.
  useEffect(() => {
    if (!map) return;
    let alive = true;
    (async () => {
      const next: Record<string, HTMLImageElement> = {};
      await Promise.all(
        map.nodes.map(async (n) => {
          try {
            const abs = await api.resolveAsset(
              worldPath,
              `review/${n.stage_id}/${n.level_id}.png`,
            );
            if (!abs) return;
            const url = abs.startsWith("/__mockassets__") ? abs : convertFileSrc(abs);
            await new Promise<void>((res) => {
              const img = new Image();
              img.onload = () => {
                next[n.level_id] = img;
                res();
              };
              img.onerror = () => res();
              img.src = url;
            });
          } catch {
            /* no render for this level */
          }
        }),
      );
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.nodes.length, worldPath]);

  /** Validation verdicts keyed by level id, for the status dots. */
  const statusMap = Object.fromEntries(
    Object.entries(levelValidation).map(([lid, r]) => [
      lid,
      { ok: r.ok, problems: countProblems(r) },
    ]),
  );

  const redraw = () => {
    const canvas = canvasRef.current;
    const m = mapRef.current;
    if (!canvas || !m) return;
    const camera: WorldCamera = { ...cam.current, viewW: viewSize.w, viewH: viewSize.h };
    drawWorld(canvas, m, { mode, camera, selection: sel, thumbs, status: statusMap });
  };
  useEffect(redraw);

  /** Fit the whole world into the viewport at 90%, like the design's `fit`. */
  const fit = () => {
    const z = Math.min(viewSize.w / WORLD_W, viewSize.h / WORLD_H) * 0.9;
    cam.current.zoom = Math.max(0.15, Math.min(2, z));
    cam.current.ox = (WORLD_W - viewSize.w / cam.current.zoom) / 2;
    cam.current.oy = (WORLD_H - viewSize.h / cam.current.zoom) / 2;
    redraw();
  };
  useEffect(() => {
    if (map) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.world, viewSize.w, viewSize.h]);

  const worldAt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / cam.current.zoom + cam.current.ox,
      y: (e.clientY - r.top) / cam.current.zoom + cam.current.oy,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!mapRef.current) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = worldAt(e);
    const hit = hitTest(mapRef.current, mode, p.x, p.y);

    if (tool === "place") {
      void placeLevel(p.x / WORLD_W, p.y / WORLD_H);
      return;
    }
    if (tool === "connect") {
      if (hit?.kind !== "node") {
        setLinkFrom(null);
        setNote("pick a level to connect from");
        return;
      }
      if (!linkFrom) {
        setLinkFrom(hit.id);
        setNote(`connecting from ${hit.id} — now pick the other end`);
        return;
      }
      if (linkFrom === hit.id) {
        setLinkFrom(null);
        setNote("a path needs two different levels");
        return;
      }
      void connect(linkFrom, hit.id);
      return;
    }

    setSel(hit);
    if (hit?.kind === "node") {
      drag.current = { id: hit.id, moved: false };
    } else {
      pan.current = { x: e.clientX, y: e.clientY };
    }
  };

  /** Place tool: create a FLAT PLAIN DRAFT level and pin it where you clicked.
   *  It lands on the map as a `planned` node; "Generate" then authors terrain
   *  into it. Improve deliberately does NOT apply until something has been
   *  generated — there's nothing to improve on an empty scaffold. */
  const placeLevel = async (nx: number, ny: number) => {
    const m = mapRef.current;
    if (!m) return;
    const stage = m.areas[0]?.stage_id;
    if (!stage) {
      setErr("no stage to place into");
      return;
    }
    // Drop into whichever area's hull the click landed in, else the first.
    const hull = m.areas.find((a) => {
      const h = areaHull(a, m.nodes, mode);
      return h && nx * WORLD_W >= h.x && nx * WORLD_W <= h.x + h.w
        && ny * WORLD_H >= h.y && ny * WORLD_H <= h.y + h.h;
    });
    try {
      const created = await api.createLevel(worldPath, hull?.stage_id ?? stage, 40, 16);
      const lid = String(
        (created as { level_id?: string }).level_id ?? "",
      );
      if (lid) {
        await api.worldMapEdit(worldPath, { nodes: { [lid]: { pos: [nx, ny] } } });
        setNote(`placed ${lid} — use Generate to build it`);
      }
      setTool("select");
      void load();
    } catch (e) {
      setErr(String(e));
    }
  };

  /** Connect tool: append a two-way path between two levels. */
  const connect = async (a: string, b: string) => {
    const m = mapRef.current;
    if (!m) return;
    const exists = m.edges.some(
      (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
    );
    setLinkFrom(null);
    if (exists) {
      setNote("those levels are already connected");
      return;
    }
    await setEdges([...m.edges, { a, b, kind: "path" }]);
    setNote(`connected ${a} → ${b}`);
    setTool("select");
  };

  const deleteEdge = async (index: number) => {
    const m = mapRef.current;
    if (!m) return;
    await setEdges(m.edges.filter((_, i) => i !== index));
    setSel(null);
    setNote("path removed");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const m = mapRef.current;
    if (drag.current && m) {
      const p = worldAt(e);
      const node = m.nodes.find((n) => n.level_id === drag.current!.id);
      if (!node) return;
      node.pos = [
        Math.min(1, Math.max(0, p.x / WORLD_W)),
        Math.min(1, Math.max(0, p.y / WORLD_H)),
      ];
      node.origin = "manual";
      drag.current.moved = true;
      setMap({ ...m });
      return;
    }
    if (pan.current) {
      cam.current.ox -= (e.clientX - pan.current.x) / cam.current.zoom;
      cam.current.oy -= (e.clientY - pan.current.y) / cam.current.zoom;
      pan.current = { x: e.clientX, y: e.clientY };
      redraw();
    }
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    pan.current = null;
    // Only persist a real move — a grab-and-release in place must not write
    // (canon would no-op it anyway, but this keeps the round trip off).
    if (!d?.moved || !mapRef.current) return;
    const node = mapRef.current.nodes.find((n) => n.level_id === d.id);
    if (!node) return;
    try {
      await api.worldMapEdit(worldPath, { nodes: { [d.id]: { pos: node.pos } } });
      setNote(`placed ${node.display_name ?? d.id}`);
      void load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const setLocked = async (locked: boolean) => {
    try {
      await api.worldMapEdit(worldPath, { locked });
      setNote(locked ? "layout locked" : "layout unlocked");
      void load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const setEdges = async (edges: WorldMapEdge[]) => {
    try {
      await api.worldMapEdit(worldPath, { edges });
      void load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const resetNode = async (levelId: string) => {
    try {
      await api.worldMapEdit(worldPath, { nodes: { [levelId]: null } });
      setNote(`${levelId} returned to the generator`);
      void load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const selNode =
    map && sel?.kind === "node" ? map.nodes.find((n) => n.level_id === sel.id) : null;
  const selArea =
    map && sel?.kind === "area" ? map.areas.find((a) => a.stage_id === sel.id) : null;
  const selEdge = map && sel?.kind === "edge" ? map.edges[sel.index] : null;

  return (
    <div className="wm">
      <div className="wm-head">
        <span className="dock-sect">World map</span>
        <span className="wm-meta">
          {map
            ? `${map.nodes.length} levels · ${map.areas.length} areas · ${map.edges.length} paths`
            : "loading…"}
        </span>
        <span style={{ flex: 1 }} />
        <span className="wm-prov">
          Layout: {map?.manual_count ? `agent · ${map.manual_count} human edits` : "agent"}
        </span>
        <button
          className={map?.locked ? "btn pri" : "btn"}
          disabled={!map}
          onClick={() => void setLocked(!map?.locked)}
          title="Locked means generation may ADD and CONNECT levels, but must not move what you placed"
        >
          {map?.locked ? "🔒 Locked" : "🔓 Unlocked"}
        </button>
        <div className="segmented">
          {(
            [
              ["select", "Select"],
              ["place", "Place"],
              ["connect", "Connect"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              className={tool === t ? "seg-btn active" : "seg-btn"}
              title={
                t === "place"
                  ? "Click the map to drop a new flat draft level, then Generate to build it"
                  : t === "connect"
                    ? "Click two levels to wire a path between them"
                    : "Inspect and drag"
              }
              onClick={() => {
                setTool(t);
                setLinkFrom(null);
                setNote(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="segmented">
          {(["schematic", "overworld"] as WorldMode[]).map((m) => (
            <button
              key={m}
              className={mode === m ? "seg-btn active" : "seg-btn"}
              onClick={() => setMode(m)}
            >
              {m === "schematic" ? "Schematic" : "Overworld"}
            </button>
          ))}
        </div>
      </div>

      <div className="wm-body">
        <div ref={boxRef} className="wm-stage">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => void onPointerUp()}
            onPointerCancel={() => void onPointerUp()}
            style={{ display: "block", cursor: drag.current ? "grabbing" : "grab" }}
          />
          <div className="wm-zoom">
            <button className="btn" onClick={() => { cam.current.zoom *= 0.8; redraw(); }}>−</button>
            <span className="btn" style={{ cursor: "default" }}>
              {Math.round(cam.current.zoom * 100)}%
            </span>
            <button className="btn" onClick={() => { cam.current.zoom *= 1.25; redraw(); }}>+</button>
            <button className="btn" onClick={fit}>fit</button>
          </div>
          <div className="wm-legend">
            {err
              ? err
              : map
                ? "drag a node to place it · drag empty space to pan · click a path to type it"
                : "loading the map…"}
          </div>
        </div>

        <aside className="wm-inspector">
          {!sel && map && (
            <>
              <div className="dock-sect">Nothing selected</div>
              <p className="wm-note">
                Click a level, an area or a path. Areas are the pack's stages —
                they already carry the theme, biome and level membership.
              </p>
            </>
          )}
          {selNode && (
            <>
              <h3 className="wm-title">{selNode.display_name ?? selNode.level_id}</h3>
              <div className="wm-sub">{selNode.level_id}</div>
              <Row k="Area" v={selNode.stage_id} />
              <Row
                k="Placed by"
                v={selNode.origin === "manual" ? "you" : "the generator"}
              />
              <Row
                k="Position"
                v={`${selNode.pos[0].toFixed(3)}, ${selNode.pos[1].toFixed(3)}`}
              />
              <div className="wm-actions">
                <button
                  className="btn"
                  onClick={() => select({ kind: "entity", typeId: "levels", id: selNode.level_id })}
                >
                  Open in level editor →
                </button>
                {selNode.origin === "manual" && (
                  <button className="btn" onClick={() => void resetNode(selNode.level_id)}>
                    Hand back to the generator
                  </button>
                )}
              </div>
            </>
          )}
          {selArea && (
            <>
              <h3 className="wm-title">{selArea.biome || selArea.stage_id}</h3>
              <div className="wm-sub">
                {selArea.stage_id} · {selArea.level_ids.length} levels
              </div>
              <Row k="Theme" v={selArea.theme || "—"} />
              <Row k="Biome" v={selArea.biome || "—"} />
              <Row k="Music" v={selArea.music ?? "stage default"} />
              <div className="dock-sect" style={{ marginTop: 12 }}>
                Levels
              </div>
              <div className="wm-arealist">
                {selArea.level_ids.map((id) => {
                  const n = map!.nodes.find((x) => x.level_id === id);
                  return (
                    <button
                      key={id}
                      className="btn"
                      onClick={() => setSel({ kind: "node", id })}
                    >
                      {n?.display_name ?? id}
                    </button>
                  );
                })}
              </div>
              <p className="wm-note">
                Areas are stages. A level's theme, blocks and enemy pool come
                from its area unless the level overrides them.
              </p>
            </>
          )}
          {selEdge && sel?.kind === "edge" && (
            <>
              <h3 className="wm-title">Path</h3>
              <div className="wm-sub">
                {selEdge.a} → {selEdge.b}
              </div>
              <div className="dock-sect" style={{ marginTop: 10 }}>
                Direction
              </div>
              <div className="segmented" style={{ marginTop: 6 }}>
                {(
                  [
                    ["path", "Two-way"],
                    ["one", "One-way"],
                    ["lock", "Conditional"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    className={selEdge.kind === k ? "seg-btn active" : "seg-btn"}
                    onClick={() => {
                      const next = map!.edges.map((e, i) =>
                        i === sel.index ? { ...e, kind: k } : e,
                      );
                      void setEdges(next);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="wm-note">
                {selEdge.kind === "one"
                  ? "One-way: the player can go A → B but not back."
                  : selEdge.kind === "lock"
                    ? "Conditional: needs a required item to pass."
                    : "Two-way: traversable in both directions."}
              </p>
              <button
                className="btn dang"
                style={{ marginTop: 12 }}
                onClick={() => void deleteEdge(sel.index)}
              >
                Delete path
              </button>
              {selEdge.kind === "lock" && (
                <label className="wm-field">
                  <span>Requires</span>
                  <input
                    defaultValue={selEdge.condition ?? ""}
                    placeholder="item name"
                    onBlur={(e) => {
                      const next = map!.edges.map((x, i) =>
                        i === sel.index ? { ...x, condition: e.target.value } : x,
                      );
                      void setEdges(next);
                    }}
                  />
                </label>
              )}
            </>
          )}
          {note && <div className="wm-saved">{note}</div>}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="wm-row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}
