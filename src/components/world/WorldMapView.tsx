import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type WorldMap, type WorldMapEdge } from "../../lib/invoke";
import { useStore } from "../../store";
import { countProblems } from "../../lib/validation";
import { readCanvasTheme } from "../../lib/canvasTheme";
import { inTextField, kbd } from "../../lib/keys";
import { Icon } from "../start/Icons";
import { Tooltip } from "../Tooltip";
import { WorldToolRail, TOOL_KEYS, type WorldTool } from "./WorldToolRail";
import { WorldInspector, type InspectorActions } from "./WorldInspector";
import {
  areaHull,
  drawWorld,
  hitTest,
  WORLD_H,
  WORLD_W,
  type WorldCamera,
  type WorldMode,
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

/** Design: 0.4–2×, 8% per wheel notch. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
/** A drag under this many screen px counts as a click, so selection still
 *  works when your hand isn't perfectly still. Past it, panning must NOT
 *  change the selection. */
const CLICK_SLOP = 3;

export function WorldMapView() {
  const worldPath = useStore((s) => s.worldPath);
  const select = useStore((s) => s.select);
  const map = useStore((s) => s.worldMap);
  const setMap = useStore((s) => s.setWorldMap);
  const sel = useStore((s) => s.worldMapSel);
  const setSel = useStore((s) => s.setWorldMapSel);
  const setPendingLevelAction = useStore((s) => s.setPendingLevelAction);
  const registerCommands = useStore((s) => s.registerCommands);
  const unregisterCommands = useStore((s) => s.unregisterCommands);
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const levelValidation = useStore((st) => st.levelValidation);
  // Resolved design tokens for the canvas. Re-read when the theme flips —
  // `setTheme` publishes `data-theme` synchronously, so this never reads a
  // stale palette. Memoised so a wheel-tick redraw isn't a getComputedStyle.
  const theme = useStore((st) => st.theme);
  const canvasTheme = useMemo(() => readCanvasTheme(), [theme]);

  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<WorldMode>("schematic");
  const [note, setNote] = useState<string | null>(null);
  const [tool, setTool] = useState<WorldTool>("select");
  /** First endpoint while the path tool is mid-gesture. */
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, HTMLImageElement>>({});
  const [areaArt, setAreaArt] = useState<Record<string, HTMLImageElement>>({});
  const [showStops, setShowStops] = useState(true);
  const [showArt, setShowArt] = useState(true);
  const [zoomLabel, setZoomLabel] = useState(100);

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ ox: 0, oy: 0, zoom: 1 });
  const [viewSize, setViewSize] = useState({ w: 800, h: 480 });
  /** Live gesture. `moved` flips once past CLICK_SLOP; everything the pointer
   *  handlers need at release time lives here, never in lagging state. */
  const gesture = useRef<{
    kind: "pan" | "node";
    id?: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const space = useRef(false);
  const mapRef = useRef<WorldMap | null>(null);

  const load = async () => {
    try {
      const m = await api.worldMap(worldPath);
      mapRef.current = m;
      setMap(m);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldPath]);
  // The store is the shared copy (the sidebar reads it); this ref is the one
  // the pointer handlers and the draw loop use, because a drag mutates it
  // between renders.
  useEffect(() => {
    mapRef.current = map;
  }, [map]);

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

  const resolveImage = async (hint: string): Promise<HTMLImageElement | null> => {
    try {
      const abs = await api.resolveAsset(worldPath, hint);
      if (!abs) return null;
      const url = abs.startsWith("/__mockassets__") ? abs : convertFileSrc(abs);
      return await new Promise<HTMLImageElement | null>((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = url;
      });
    } catch {
      return null;
    }
  };

  // Level thumbnails (canon's review renders). Resolved per node id; a level
  // with no render just draws its placeholder.
  useEffect(() => {
    if (!map) return;
    let alive = true;
    (async () => {
      const next: Record<string, HTMLImageElement> = {};
      await Promise.all(
        map.nodes.map(async (n) => {
          const img = await resolveImage(`review/${n.stage_id}/${n.level_id}.png`);
          if (img) next[n.level_id] = img;
        }),
      );
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.nodes.length, worldPath]);

  // Area art — the nearest backdrop band stands in for the design's painted
  // area terrain. Bands are numbered per stage, so take the closest one that
  // actually resolves rather than assuming a count.
  useEffect(() => {
    if (!map) return;
    let alive = true;
    (async () => {
      const next: Record<string, HTMLImageElement> = {};
      await Promise.all(
        map.areas.map(async (a) => {
          for (const band of [2, 1, 0]) {
            const img = await resolveImage(`backdrop/${a.stage_id}/band_${band}.png`);
            if (img) {
              next[a.stage_id] = img;
              return;
            }
          }
        }),
      );
      if (alive) setAreaArt(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.areas.length, worldPath]);

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
    drawWorld(canvas, m, {
      mode,
      camera,
      selection: sel,
      thumbs,
      status: statusMap,
      showStops,
      areaArt: showArt ? areaArt : undefined,
      theme: canvasTheme,
    });
    setZoomLabel((z) => {
      const next = Math.round(cam.current.zoom * 100);
      return z === next ? z : next;
    });
  };
  useEffect(redraw);

  /** Fit the whole world into the viewport at 90%, like the design's `fit`. */
  const fit = () => {
    const z = Math.min(viewSize.w / WORLD_W, viewSize.h / WORLD_H) * 0.9;
    setZoom(z, viewSize.w / 2, viewSize.h / 2, true);
  };

  /** Zoom about a point in VIEW px, clamped to the design's range. */
  const setZoom = (next: number, px: number, py: number, centre = false) => {
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (centre) {
      cam.current.zoom = z;
      cam.current.ox = (WORLD_W - viewSize.w / z) / 2;
      cam.current.oy = (WORLD_H - viewSize.h / z) / 2;
    } else {
      // Keep the world point under the cursor pinned.
      const wx = px / cam.current.zoom + cam.current.ox;
      const wy = py / cam.current.zoom + cam.current.oy;
      cam.current.zoom = z;
      cam.current.ox = wx - px / z;
      cam.current.oy = wy - py / z;
    }
    redraw();
  };

  useEffect(() => {
    if (map) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.world, viewSize.w, viewSize.h]);

  // Wheel must be a NON-passive listener to preventDefault, and React attaches
  // wheel handlers passively — so bind it by hand.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (e.shiftKey || e.altKey) {
        cam.current.ox += (e.deltaX || e.deltaY) / cam.current.zoom;
        redraw();
        return;
      }
      setZoom(
        cam.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSize.w, viewSize.h]);

  // Hold Space to pan from anywhere — including over a node, where a drag
  // would otherwise move it.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !inTextField(e)) {
        e.preventDefault();
        space.current = true;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || inTextField(e)) return;
      const t = TOOL_KEYS[e.key.toLowerCase()];
      if (t) {
        setTool(t);
        setLinkFrom(null);
      }
      if (e.key === "Escape") {
        setLinkFrom(null);
        setTool("select");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const worldAt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / cam.current.zoom + cam.current.ox,
      y: (e.clientY - r.top) / cam.current.zoom + cam.current.oy,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const m = mapRef.current;
    if (!m) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = worldAt(e);
    const hit = hitTest(m, mode, p.x, p.y);
    // Middle button and held Space always pan, whatever the tool.
    const forcePan = e.button === 1 || space.current;
    const grabsNode = !forcePan && tool === "select" && hit?.kind === "node";
    gesture.current = {
      kind: grabsNode ? "node" : "pan",
      id: grabsNode ? hit.id : undefined,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const m = mapRef.current;
    if (!g || !m) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < CLICK_SLOP) return;
    g.moved = true;
    if (g.kind === "node") {
      const p = worldAt(e);
      const node = m.nodes.find((n) => n.level_id === g.id);
      if (!node) return;
      node.pos = [
        Math.min(1, Math.max(0, p.x / WORLD_W)),
        Math.min(1, Math.max(0, p.y / WORLD_H)),
      ];
      node.origin = "manual";
    } else {
      cam.current.ox -= (e.clientX - g.x) / cam.current.zoom;
      cam.current.oy -= (e.clientY - g.y) / cam.current.zoom;
    }
    g.x = e.clientX;
    g.y = e.clientY;
    redraw();
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    const m = mapRef.current;
    if (!g || !m) return;

    // A pan past the slop must not change the selection; a node drag past it
    // commits the placement.
    if (g.moved) {
      if (g.kind !== "node") return;
      const node = m.nodes.find((n) => n.level_id === g.id);
      if (!node) return;
      try {
        await api.worldMapEdit(worldPath, { nodes: { [g.id!]: { pos: node.pos } } });
        setNote(`placed ${node.display_name ?? g.id}`);
        void load();
      } catch (err2) {
        setErr(String(err2));
      }
      return;
    }

    // Under the slop: this was a click. Whatever the armed tool does, it does
    // here, so a shaky hand still selects.
    const p = worldAt(e);
    const hit = hitTest(m, mode, p.x, p.y);
    if (tool === "place") {
      void placeLevel(p.x / WORLD_W, p.y / WORLD_H);
      return;
    }
    if (tool === "path") {
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
    if (tool === "stop") {
      if (hit?.kind !== "edge") {
        setNote("click a path to put a stop on it");
        return;
      }
      const edge = m.edges[hit.index];
      void setEdges(
        m.edges.map((x, i) =>
          i === hit.index
            ? { ...x, stop: edge.stop ? undefined : "jump · secret exit?" }
            : x,
        ),
      );
      setSel(hit);
      setNote(edge.stop ? "stop removed" : "stop added");
      return;
    }
    setSel(hit);
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
    // Assigned to an area ONLY if the drop point is inside that area's
    // rendered hull — never by nearest-cluster guessing, which inflates hulls.
    const hull = m.areas.find((a) => {
      const h = areaHull(a, m.nodes, mode);
      return h && nx * WORLD_W >= h.x && nx * WORLD_W <= h.x + h.w
        && ny * WORLD_H >= h.y && ny * WORLD_H <= h.y + h.h;
    });
    try {
      const created = await api.createLevel(worldPath, hull?.stage_id ?? stage, 40, 16);
      const lid = String((created as { level_id?: string }).level_id ?? "");
      if (lid) {
        await api.worldMapEdit(worldPath, { nodes: { [lid]: { pos: [nx, ny] } } });
        setNote(`placed ${lid} — use Generate to build it`);
        setSel({ kind: "node", id: lid });
      }
      setTool("select");
      void load();
    } catch (e) {
      setErr(String(e));
    }
  };

  /** Path tool: append a two-way path between two levels. */
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

  /** Re-run: hand EVERY hand-placed node back to the generator so the next
   *  compose lays the whole map out from the seed again. Locking is what
   *  protects your placements, so a locked map refuses. */
  const rerun = async () => {
    const m = mapRef.current;
    if (!m || m.locked) return;
    const manual = m.nodes.filter((n) => n.origin === "manual");
    if (!manual.length) {
      setNote("nothing hand-placed — the layout is already the generator's");
      return;
    }
    if (
      !window.confirm(
        `Hand ${manual.length} hand-placed level${manual.length > 1 ? "s" : ""} back to the generator?\n\n` +
          "Their positions are recomputed from the seed on the next run. Paths you authored are kept.",
      )
    )
      return;
    try {
      await api.worldMapEdit(worldPath, {
        nodes: Object.fromEntries(manual.map((n) => [n.level_id, null])),
      });
      setNote("layout handed back to the generator");
      void load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const openLevel = (levelId: string, generate = false) => {
    if (generate) setPendingLevelAction("layout");
    select({ kind: "entity", typeId: "levels", id: levelId });
  };

  /** Area action: a flat draft in this area, opened straight into the layout
   *  flow — the two-step the Place tool follows, without picking a spot. */
  const createIn = async (stageId: string) => {
    try {
      const created = await api.createLevel(worldPath, stageId, 40, 16);
      const lid = String((created as { level_id?: string }).level_id ?? "");
      void load();
      if (lid) openLevel(lid, true);
    } catch (e) {
      setErr(String(e));
    }
  };

  const actions: InspectorActions = {
    select: setSel,
    setEdges: (edges) => void setEdges(edges),
    deleteEdge: (i) => void deleteEdge(i),
    resetNode: (id) => void resetNode(id),
    openLevel,
    createIn: (id) => void createIn(id),
    startConnection: (levelId) => {
      setTool("path");
      setLinkFrom(levelId);
      setNote(`connecting from ${levelId} — now click the other level`);
    },
  };

  // Secondary tools belong in ⌘K as well as on screen — one definition, two
  // surfaces, withdrawn on unmount so they never outlive this view.
  useEffect(() => {
    registerCommands("world", [
      {
        id: "world.fit",
        label: "Fit the whole world",
        group: "World map",
        run: fit,
      },
      {
        id: "world.canvas",
        label: mode === "schematic" ? "Switch to the overworld view" : "Switch to the schematic view",
        group: "World map",
        keywords: "canvas treatment smw",
        run: () => setMode(mode === "schematic" ? "overworld" : "schematic"),
      },
      {
        id: "world.lock",
        label: map?.locked ? "Unlock the layout" : "Lock the layout",
        group: "World map",
        keywords: "generator placement protect",
        run: () => void setLocked(!map?.locked),
      },
      {
        id: "world.rerun",
        label: "Re-run the agent layout…",
        group: "World map",
        keywords: "regenerate positions hand back generator",
        enabled: !map?.locked && !!map?.manual_count,
        disabledReason: map?.locked ? "the layout is locked" : "nothing hand-placed",
        run: () => void rerun(),
      },
    ]);
    return () => unregisterCommands("world");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, map?.locked, map?.manual_count, registerCommands, unregisterCommands]);

  const planned = map?.nodes.filter((n) => n.status === "planned").length ?? 0;
  const stops = map?.edges.filter((e) => e.stop).length ?? 0;

  return (
    <div className="wm">
      <div className="wm-head">
        <span className="wm-meta">
          world
          {map && (
            <>
              {" · "}
              <b>{map.areas.length}</b> areas · <b>{map.nodes.length}</b> levels ·{" "}
              <b>{map.edges.length}</b> paths
              {planned > 0 && ` · ${planned} planned`}
              {stops > 0 && ` · ${stops} stops`}
            </>
          )}
        </span>
        <span style={{ flex: 1 }} />
        <span className="sect">canvas</span>
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
        <button
          className="tool"
          aria-label={layout.inspectorCollapsed ? "Show the inspector" : "Hide the inspector"}
          title={`${layout.inspectorCollapsed ? "Show" : "Hide"} the inspector · ${kbd("I")}`}
          onClick={() => setLayout({ inspectorCollapsed: !layout.inspectorCollapsed })}
        >
          <Icon id="g-panel" size={15} />
        </button>
      </div>

      <div className="wm-body">
        <div ref={boxRef} className="wm-stage" data-tool={tool}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => void onPointerUp(e)}
            onPointerCancel={() => (gesture.current = null)}
            style={{ display: "block" }}
          />

          {/* Layout provenance — a float over the stage, per the design; it
              was in the header, furthest from the map it describes. */}
          <div className="float wm-lay">
            <span>
              Layout <b>agent</b>
            </span>
            {!!map?.manual_count && (
              <span className="n">
                {map.manual_count} human edit{map.manual_count > 1 ? "s" : ""}
              </span>
            )}
            <span className="wm-div" />
            <Tooltip
              title="Re-run agent layout"
              desc="Hand your placements back so the generator lays the map out from the seed again. Locked placements are kept."
            >
              <button
                className="btn sm"
                disabled={!map || map.locked || !map.manual_count}
                onClick={() => void rerun()}
              >
                <Icon id="g-rerun" size={12} />
                Re-run
              </button>
            </Tooltip>
            <Tooltip
              title={map?.locked ? "Unlock human edits" : "Lock human edits"}
              desc="When locked, the generator may add and connect levels but never moves what you placed."
            >
              <button
                className={map?.locked ? "btn sm on" : "btn sm"}
                disabled={!map}
                onClick={() => void setLocked(!map?.locked)}
              >
                <Icon id={map?.locked ? "g-lock" : "g-unlock"} size={12} />
                {map?.locked ? "Locked" : "Unlocked"}
              </button>
            </Tooltip>
          </div>

          <WorldToolRail
            tool={tool}
            onTool={(t) => {
              setTool(t);
              setLinkFrom(null);
              setNote(null);
            }}
          />

          <div className="float wm-legend">
            <div className="l">
              <i className="k" />
              path · walk either way
            </div>
            <div className="l">
              <i className="k lock" />
              locked · needs item
            </div>
            <div className="l">
              <i className="k new" />
              planned · level not built
            </div>
            <div className="l">
              <i className="k m" />
              placed by you
            </div>
            <div className="l">
              <i className="k s" />
              path stop · secret hunt
            </div>
            <div className="l dim">drag to pan · scroll to zoom · space to pan anywhere</div>
          </div>

          <div className="float wm-chips">
            <button
              className={showStops ? "chip on" : "chip"}
              onClick={() => setShowStops((v) => !v)}
            >
              stops
            </button>
            <button
              className={showArt ? "chip on" : "chip"}
              title="Paint each area with its own backdrop art (overworld view)"
              onClick={() => setShowArt((v) => !v)}
            >
              world art
            </button>
          </div>

          <div className="float wm-zoom">
            <button onClick={() => setZoom(cam.current.zoom - 0.1, viewSize.w / 2, viewSize.h / 2)}>
              −
            </button>
            <span className="v">{zoomLabel}%</span>
            <button onClick={() => setZoom(cam.current.zoom + 0.1, viewSize.w / 2, viewSize.h / 2)}>
              +
            </button>
            <button onClick={fit}>fit</button>
            <button onClick={() => setZoom(1, viewSize.w / 2, viewSize.h / 2, true)}>1:1</button>
          </div>

          {(err || note || linkFrom) && (
            <div className={`float wm-toast ${err ? "err" : ""}`}>
              {err ?? (linkFrom ? `connecting from ${linkFrom} — pick the other end` : note)}
            </div>
          )}
          {!map && !err && <div className="wm-loading">loading the map…</div>}
        </div>

        {!layout.inspectorCollapsed && (
          <aside className="wm-inspector">
            {map && (
              <WorldInspector
                map={map}
                sel={sel}
                thumbs={thumbs}
                areaArt={areaArt}
                actions={actions}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
