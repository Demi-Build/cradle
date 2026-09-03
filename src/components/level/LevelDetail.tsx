// The level editor. Fetches the render bundle (canon level export), renders it
// in Blocks/Art/Overlay via <LevelCanvas>, and supports the full construction
// loop: select+drag placements, paint tile TYPES from the palette, place/erase
// enemies/items/checkpoints, resize the grid, and create/publish flows.
//
// Save model is BATCH: every edit mutates the local bundle (live re-render in
// all modes) and marks its layer dirty; Save (⌘S) persists — sparse layers via
// `canon level apply-edit`, the painted grid via `canon level import-grids`
// (terrain/background/hazards re-derived canon-side) — then re-exports fresh.
//
// `room` is the SAME screen rendering a dungeon ROOM: the bundle comes from
// the one `canon grid export` in the same shape, blocks mode is forced (no
// tilesheet), and the Dock's tabs come from `pack info`'s placements. Row
// P0-5 shipped it read-only; row P0-8 turned the writes on — paint / fill /
// erase → `grid import-grids`, drag / place / erase placements → `grid
// apply-edit`, a monster drop → an ENCOUNTER (a combat event carrying
// `monster_ids`, P0 paper P.9 G4), and the per-step 🎲 rolls → `grid roll`,
// all code-only and $0 (doctrine 3: free never spend-confirms). What a room
// still cannot do keeps its reason on screen (doctrine 4) — see
// `readOnlyReasons.ts`.
//
// Optimistic UI never diverges from disk: after every write the bundle is
// re-exported, so what renders is what canon wrote.

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type CostEstimate, type ValidationReport } from "../../lib/invoke";
import { fmtRange } from "../../lib/cost";
import { enqueueJob } from "../../lib/jobs";
import { placementTabs, typeIdForKind, type PlacementTab } from "../../lib/placements";
import { countProblems } from "../../lib/validation";
import { isShortcut, kbd } from "../../lib/keys";
import { useStore } from "../../store";
import { confirmSpend } from "../agent/confirmGateState";
import { EntityLink } from "../EntityLink";
import { LevelCanvas } from "./LevelCanvas";
import { Dock } from "./Dock";
import { RegenerateLayoutModal } from "./RegenerateLayoutModal";
import { ImproveLayoutModal } from "./ImproveLayoutModal";
import { MusicPanel } from "./MusicPanel";
import { ToolRail, type Tool } from "./ToolRail";
import { TOOL_KEYS } from "./toolKeys";
import { Minimap } from "./Minimap";
import { AudioLane } from "./AudioLane";
import type { CamApi, CamState } from "./LevelCanvas";
import { floodFill } from "./gridOps";
import { RAIL_ROOM, ROLL_COST_NOTE, ROOM_REASONS } from "./readOnlyReasons";
import {
  SEL_KIND_BY_WIRE,
  type Brush,
  type LevelBundle,
  type RenderMode,
  type Selection,
} from "./drawLevel";

const MODES: { id: RenderMode; label: string }[] = [
  { id: "blocks", label: "Blocks" },
  { id: "art", label: "Art" },
  { id: "overlay", label: "Overlay" },
];

function resolveAsset(p: string | null, rev = 0): string | null {
  if (!p) return p;
  if (p.startsWith("/__mockassets__") || p.startsWith("http")) return p;
  if (p.startsWith("/")) {
    try {
      const url = convertFileSrc(p);
      // rev busts the browser image cache after an asset-bytes replacement
      // (same path, new pixels).
      return rev ? `${url}?r=${rev}` : url;
    } catch {
      return p;
    }
  }
  return p;
}

/** The reason out of a canon CLI refusal: the verb wraps its structured
 *  error as JSON, and the useful half is the `error` field's sentence. */
function cleanReason(message: string | undefined): string {
  if (!message) return "";
  const brace = message.indexOf("{");
  if (brace >= 0) {
    try {
      const body = JSON.parse(message.slice(brace, message.lastIndexOf("}") + 1));
      if (typeof body.error === "string") return body.error;
    } catch {
      /* not JSON after all — fall through to the raw text */
    }
  }
  return message.replace(/^Error:\s*/, "");
}

/** Compact relative time ("just now" / "5m ago" / "3h ago" / "2d ago") from an
 *  ISO timestamp — for the revision chip's "how long ago it last changed". */
function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function resolveBundleAssets(b: LevelBundle, rev = 0): LevelBundle {
  const ra = (p: string | null) => resolveAsset(p, rev);
  return {
    ...b,
    tileset: { ...b.tileset, tilesheet_path_abs: ra(b.tileset.tilesheet_path_abs) },
    entities: b.entities.map((e) => ({ ...e, sprite_path_abs: ra(e.sprite_path_abs) })),
    items: b.items.map((it) => ({ ...it, sprite_path_abs: ra(it.sprite_path_abs) })),
    props: Object.fromEntries(Object.entries(b.props).map(([k, v]) => [k, ra(v)])),
    backdrop: b.backdrop
      ? { ...b.backdrop, band_paths_abs: b.backdrop.band_paths_abs.map(ra) }
      : null,
  };
}

type DbInfo = {
  name: string;
  size: number;
  kind: string | null;
  color: string;
  spriteUrl: string | null;
};

/** enemy/item DB lookups for stamping new placements with display data.
 *  `enabled=false` skips the fetch: a room lists its OWN kinds (see
 *  `useRoomDb`), and a dungeon pack has no `enemies` type to ask for. */
function useDbInfo(typeId: string, enabled = true): Record<string, DbInfo> {
  const worldPath = useStore((s) => s.worldPath);
  const [map, setMap] = useState<Record<string, DbInfo>>({});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const rows = await api.listEntityRows(worldPath, typeId);
        const out: Record<string, DbInfo> = {};
        for (const row of rows) {
          const data = row.data ?? {};
          const sprite = data.sprite_path as string | undefined;
          let spriteUrl: string | null = null;
          if (sprite) {
            try {
              spriteUrl = resolveAsset(await api.resolveAsset(worldPath, sprite));
            } catch {}
          }
          out[row.id] = {
            name: (data.name as string) ?? row.id,
            size: (data.size as number) ?? 1.0,
            kind: (data.kind as string) ?? null,
            color:
              ((data.stats as Record<string, unknown> | undefined)?.placeholder_color as string) ??
              "#ff00ff",
            spriteUrl,
          };
        }
        if (alive) setMap(out);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [worldPath, typeId, enabled]);
  return map;
}

/** One `Record<id, DbInfo>` per cradle type id — the room palettes' rows.
 *  Built on `useDbInfo`'s body via one hook per id would break the rules of
 *  hooks, so this fetches the whole set in a single effect. */
function useRoomDb(typeIds: string[], enabled: boolean): Record<string, Record<string, DbInfo>> {
  const worldPath = useStore((s) => s.worldPath);
  const [map, setMap] = useState<Record<string, Record<string, DbInfo>>>({});
  const key = typeIds.join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    (async () => {
      const out: Record<string, Record<string, DbInfo>> = {};
      for (const typeId of key.split(",")) {
        try {
          const rows = await api.listEntityRows(worldPath, typeId);
          out[typeId] = Object.fromEntries(
            rows.map((r) => {
              const data = r.data ?? {};
              return [
                r.id,
                {
                  name: (data.name as string) ?? (data.title as string) ?? r.id,
                  size: 1,
                  kind: (data.category as string) ?? (data.type as string) ?? null,
                  color: "#7a8b99",
                  spriteUrl: null,
                } satisfies DbInfo,
              ];
            }),
          );
        } catch {
          out[typeId] = {};
        }
      }
      if (alive) setMap(out);
    })();
    return () => {
      alive = false;
    };
  }, [worldPath, key, enabled]);
  return map;
}

type DirtyLayer = "grids" | "entities" | "items" | "triggers" | "markers";
type SaveState = { status: "idle" | "saving" | "saved" | "error"; msg?: string };

export function LevelDetail({
  levelId,
  room = false,
}: {
  levelId: string;
  /** This grid is a dungeon ROOM (rows P0-5 + P0-8): blocks mode, tabs from
   *  `pack info` placements, the maze cell palette, per-step 🎲 rolls, and the
   *  platformer-only affordances disabled with their reasons. */
  room?: boolean;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const select = useStore((s) => s.select);
  const setEntities = useStore((s) => s.setEntities);
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  // The registry's placements block (`pack info`, kept on the world summary —
  // one fetch per world load): the Dock tabs and the tray's row links.
  const packInfo = useStore((s) => s.world?.pack_info ?? null);
  const tabs = useMemo<PlacementTab[]>(
    () => (room ? placementTabs(packInfo) : []),
    [room, packInfo],
  );
  /** The roster a monster drop draws from (P.9 G4): a room places monsters
   *  through an encounter, so the Dock gains a tab for the kind the pack
   *  declares beside its event placement. Data — absent kind, absent tab. */
  const monsterTypeId = useMemo(
    () =>
      room && packInfo?.entities?.monster && tabs.some((t) => t.kind === "event")
        ? typeIdForKind("monster")
        : null,
    [room, packInfo, tabs],
  );
  const [bundle, setBundle] = useState<LevelBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<RenderMode>(room ? "blocks" : "art");
  const [showGrid, setShowGrid] = useState(room);
  const [showLabels, setShowLabels] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [brush, setBrushState] = useState<Brush | null>(null);
  // The tool rail makes the editor's previously-IMPLICIT mode visible: "select"
  // used to mean "no brush armed" and nothing on screen said so. Tool and brush
  // stay coupled — arming a palette entry switches to Paint, choosing Select
  // disarms — so the rail always reflects what a click will actually do.
  const [tool, setToolState] = useState<Tool>("select");
  const setBrush = (b: Brush | null) => {
    setBrushState(b);
    if (b) setToolState(b.kind === "eraser" ? "erase" : "paint");
    else setToolState("select");
  };
  const setTool = (t: Tool) => {
    setToolState(t);
    if (t === "select") setBrushState(null);
    // Erase reuses the existing eraser brush so the palette row and the tool
    // are the same state, not two competing ones.
    else if (t === "erase") setBrushState({ kind: "eraser" });
    else if (brush?.kind === "eraser") setBrushState(null);
  };
  const [painted, setPainted] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState<Set<DirtyLayer>>(new Set());
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [resizeW, setResizeW] = useState<number>(0);
  const [resizeH, setResizeH] = useState<number>(0);
  const [publishPos, setPublishPos] = useState<string>("");
  const [assetRev, setAssetRev] = useState(0);
  const setLevelValidation = useStore((s) => s.setLevelValidation);
  const [valReport, setValReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [playNote, setPlayNote] = useState<string | null>(null);
  const [placeBackend, setPlaceBackend] = useState<"fake" | "anthropic">("fake");
  const [regenOpen, setRegenOpen] = useState(false);
  const [improveOpen, setImproveOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [showBounds, setShowBounds] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [audioOpen, setAudioOpen] = useState(false);
  // Camera mirror for the minimap. The canvas keeps the authoritative copy in
  // a ref (it mutates on every wheel tick); this is a throttled snapshot for
  // drawing the viewport rectangle.
  const [cam, setCam] = useState<CamState | null>(null);
  const camApi = useRef<CamApi | null>(null);

  // Validation/play notes are per-level — drop them when switching levels.
  useEffect(() => {
    setValReport(null);
    setPlayNote(null);
  }, [levelId]);

  // The Rust reaper emits play-exited when a detached session ends — clear
  // the "playing…" note instead of asserting it forever. (The mock has no
  // event plumbing; the listener just never attaches there.)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("play-exited", () => setPlayNote(null));
      } catch {
        /* browser mock — no native events */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);
  const enemyDb = useDbInfo("enemies", !room);
  const itemDb = useDbInfo("items", !room);
  // A room's palettes list the pack's OWN rows, per placement kind plus the
  // monster roster — one fetch per type id, keyed by it.
  const roomTypeIds = useMemo(
    () => [...tabs.map((t) => t.typeId), ...(monsterTypeId ? [monsterTypeId] : [])],
    [tabs, monsterTypeId],
  );
  const roomDb = useRoomDb(roomTypeIds, room);

  const bundleRef = useRef<LevelBundle | null>(null);
  const setBundleSynced = (b: LevelBundle | null) => {
    bundleRef.current = b;
    setBundle(b);
    if (b) {
      setResizeW(b.grid_width);
      setResizeH(b.grid_height);
    }
  };
  const markDirty = (layer: DirtyLayer) => {
    setDirty((d) => (d.has(layer) ? d : new Set(d).add(layer)));
    // Any edit invalidates the last validation verdict — a "valid ✓" chip
    // must never describe a level that no longer exists.
    setValReport(null);
    setLevelValidation(levelId, null);
  };

  const reload = async (rev = assetRev) => {
    const b = (await api.exportLevel(worldPath, levelId)) as LevelBundle;
    setBundleSynced(resolveBundleAssets(b, rev));
    setPainted(new Set());
    setDirty(new Set());
  };

  // When a background generation job that targeted THIS level finishes, refresh
  // the view and report what happened (changed / no change / failed) — closes
  // the "did it run / did it update?" gap the old blocking flow left open.
  const lastCompletedJob = useStore((s) => s.lastCompletedJob);
  useEffect(() => {
    const c = lastCompletedJob;
    if (!c || c.targetType !== "levels" || c.target !== levelId) return;
    if (c.status === "failed") {
      setPlayNote(`${c.op} failed — see ⚙ Jobs`);
      return;
    }
    void reload();
    setPlayNote(
      c.op === "improve"
        ? `improved — ${c.changed ? "terrain changed ✓" : "ran, no change"}`
        : `${c.op} done — ${c.changed ? "updated ✓" : "no change"}`,
    );
    // reload/setPlayNote are stable enough; re-run only when a new job completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCompletedJob, levelId]);

  // Replace an asset's bytes: native file picker → `canon asset replace` →
  // cache-busted reload so the new pixels show at the same paths.
  const replaceArt = async (target: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const file = await open({
        multiple: false,
        filters: [{ name: "PNG image", extensions: ["png"] }],
      });
      if (!file) return;
      setSave({ status: "saving" });
      await api.replaceAsset(worldPath, target, file as string);
      const rev = assetRev + 1;
      setAssetRev(rev);
      await reload(rev);
      setSave({ status: "saved" });
    } catch (e) {
      setSave({ status: "error", msg: String(e) });
    }
  };

  // Switch a placement to a different definition (position/variant kept).
  const onSwitch = (sel: Selection, newId: string) => {
    const b = bundleRef.current;
    if (!b) return;
    if (sel.kind === "enemy") {
      const info = enemyDb[newId];
      setBundleSynced({
        ...b,
        entities: b.entities.map((e, i) =>
          i === sel.index
            ? {
                ...e,
                enemy_id: newId,
                name: info?.name ?? newId,
                size: info?.size ?? e.size,
                placeholder_color: info?.color ?? e.placeholder_color,
                sprite_path_abs: info?.spriteUrl ?? null,
              }
            : e,
        ),
      });
      markDirty("entities");
    } else if (sel.kind === "item") {
      const info = itemDb[newId];
      setBundleSynced({
        ...b,
        items: b.items.map((it, i) =>
          i === sel.index
            ? {
                ...it,
                item_id: newId,
                name: info?.name ?? newId,
                kind: info?.kind ?? it.kind,
                placeholder_color: info?.color ?? it.placeholder_color,
                sprite_path_abs: info?.spriteUrl ?? null,
              }
            : it,
        ),
      });
      markDirty("items");
    }
  };

  useEffect(() => {
    let alive = true;
    setBundleSynced(null);
    setErr(null);
    setSelection(null);
    setBrush(null);
    setPainted(new Set());
    setDirty(new Set());
    setSave({ status: "idle" });
    api
      .exportLevel(worldPath, levelId)
      .then((b) => alive && setBundleSynced(resolveBundleAssets(b as LevelBundle)))
      .catch((e) => alive && setErr(String(e)));
    // Baselining journals the level's current bytes through the PLATFORMER's
    // own verb — a WRITE into the pack. A room has no baseline verb (its
    // journal starts at the first edit), so the room path skips it.
    if (!room) api.baselineLevel(worldPath, levelId).catch(() => {});
    return () => {
      alive = false;
    };
  }, [worldPath, levelId, room]);

  // Unsaved-changes guard for window close.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // --- edit mutations (local bundle; Save persists) ------------------------

  const paintTile = (x: number, y: number, tileType: number) => {
    const b = bundleRef.current;
    if (!b) return;
    if ((b.grids.collision[y]?.[x] ?? 0) === tileType) return;
    b.grids.collision[y][x] = tileType;
    markDirty("grids");
    setPainted((p) => new Set(p).add(`${x},${y}`));
  };

  const onPaint = (x: number, y: number) => {
    if (brush?.kind === "tile") paintTile(x, y, brush.tileType);
  };

  /** Flood-fill the connected run of same-typed cells with the armed tile. */
  const onFill = (x: number, y: number) => {
    const b = bundleRef.current;
    if (!b || brush?.kind !== "tile") return;
    const touched = floodFill(b.grids.collision, x, y, brush.tileType);
    if (!touched.length) return;
    markDirty("grids");
    setPainted((p) => {
      const next = new Set(p);
      for (const k of touched) next.add(k);
      return next;
    });
    setBundleSynced({ ...b });
  };

  const onPlace = (x: number, y: number) => {
    const b = bundleRef.current;
    if (!b || !brush) return;
    if (brush.kind === "enemy") {
      const info = enemyDb[brush.enemyId];
      setBundleSynced({
        ...b,
        entities: [
          ...b.entities,
          {
            enemy_id: brush.enemyId,
            x,
            y,
            variant: brush.variant,
            name: info?.name ?? brush.enemyId,
            archetype: null,
            size: info?.size ?? 1.0,
            placeholder_color: info?.color ?? "#ff00ff",
            sprite_path_abs: info?.spriteUrl ?? null,
          },
        ],
      });
      markDirty("entities");
    } else if (brush.kind === "item") {
      const info = itemDb[brush.itemId];
      setBundleSynced({
        ...b,
        items: [
          ...b.items,
          {
            item_id: brush.itemId,
            x,
            y,
            source: brush.source,
            name: info?.name ?? brush.itemId,
            kind: info?.kind ?? null,
            placeholder_color: info?.color ?? "#ffd700",
            sprite_path_abs: info?.spriteUrl ?? null,
          },
        ],
      });
      markDirty("items");
    } else if (brush.kind === "checkpoint") {
      setBundleSynced({
        ...b,
        triggers: [...b.triggers, { x, y, type: "checkpoint", params: {} }],
      });
      markDirty("triggers");
    } else if (brush.kind === "event") {
      // A room's event tile (P.6.2 row 6): the trigger wire carries the row
      // id in `params.event_id`, exactly as the export emits it.
      setBundleSynced({
        ...b,
        triggers: [
          ...b.triggers.filter((t) => !(t.x === x && t.y === y)),
          { x, y, type: brush.eventType, params: { event_id: brush.eventId } },
        ],
      });
      markDirty("triggers");
    } else if (brush.kind === "monster") {
      // P.9 G4: a monster is not a placement — dropping one BUILDS or targets
      // the combat encounter on that cell. Cross-file write, so it goes to
      // canon at once rather than riding the batch save.
      void dropMonster(x, y, brush.monsterId);
    }
  };

  /** The encounter currently selected on the canvas — what 🎲 Monsters
   *  re-rolls (a monsters roll is per-encounter, P.9 G4). */
  const selectedEventId = useMemo(() => {
    if (!bundle || selection?.kind !== "trigger") return null;
    const id = bundle.triggers[selection.index]?.params?.event_id;
    return id === undefined || id === null ? null : String(id);
  }, [bundle, selection]);

  /** Drop a monster on a cell: target the encounter already there, or ask
   *  canon to create one (`event_id: null` → a new combat event from the
   *  kind's own id_alloc). Flushes pending edits first so the write lands on
   *  the room as it looks, then re-exports — optimistic UI never diverges
   *  from disk. */
  const dropMonster = async (x: number, y: number, monsterId: string) => {
    const b = bundleRef.current;
    if (!b) return;
    if (!(await doSave())) return;
    const at = bundleRef.current?.triggers.find(
      (t) => t.x === x && t.y === y && t.params?.event_id !== undefined,
    );
    const existing = (at?.params?.monster_ids as (string | number)[] | undefined) ?? [];
    setSave({ status: "saving" });
    try {
      await api.saveLevelEdit(worldPath, levelId, {
        encounters: [
          {
            x,
            y,
            event_id: at?.params?.event_id ?? null,
            monster_ids: [...existing.map(String), monsterId].filter(
              (m, i, all) => all.indexOf(m) === i,
            ),
          },
        ],
      });
      await reload();
      setSave({ status: "saved" });
      setPlayNote(
        at ? `monster added to encounter ${at.params?.event_id}` : "new encounter created here",
      );
    } catch (e) {
      setSave({ status: "error", msg: String(e) });
    }
  };

  /** One per-step 🎲 roll (`canon grid roll`) — code only and $0, so it never
   *  raises a spend card (doctrine 3). Pending edits flush first (canon owns
   *  the formats), then the fresh room re-exports. */
  const doRoll = async (step: string) => {
    if (!(await doSave())) return;
    setPlayNote(null);
    setSave({ status: "saving" });
    try {
      const result = await api.rollGrid(worldPath, levelId, step, {
        encounter: step === "monsters" ? selectedEventId : null,
      });
      await reload();
      setSave({ status: "saved" });
      const warning = result.warnings?.[0];
      setPlayNote(
        `${step} rolled — ${result.changed ? "updated ✓" : "no change"}` +
          (warning ? ` · ${warning}` : ""),
      );
    } catch (e) {
      setSave({ status: "error", msg: String(e) });
    }
  };

  const deleteSelection = (sel: Selection) => {
    const b = bundleRef.current;
    if (!b) return;
    if (sel.kind === "enemy") {
      setBundleSynced({ ...b, entities: b.entities.filter((_, i) => i !== sel.index) });
      markDirty("entities");
    } else if (sel.kind === "item") {
      setBundleSynced({ ...b, items: b.items.filter((_, i) => i !== sel.index) });
      markDirty("items");
    } else if (sel.kind === "trigger") {
      setBundleSynced({ ...b, triggers: b.triggers.filter((_, i) => i !== sel.index) });
      markDirty("triggers");
    }
    setSelection(null);
  };

  const onErase = (x: number, y: number) => {
    const b = bundleRef.current;
    if (!b) return;
    // Topmost placement at the cell first (enemy → item → checkpoint) …
    const ei = b.entities.findIndex((e) => e.x === x && e.y === y);
    if (ei >= 0) return deleteSelection({ kind: "enemy", index: ei });
    const ii = b.items.findIndex((it) => it.x === x && it.y === y);
    if (ii >= 0) return deleteSelection({ kind: "item", index: ii });
    // Checkpoints for a platformer level; every event tile for a room (the
    // ROW stays on disk — erasing a placement never deletes a row).
    const ti = b.triggers.findIndex(
      (t) => t.x === x && t.y === y && (room || t.type === "checkpoint"),
    );
    if (ti >= 0) return deleteSelection({ kind: "trigger", index: ti });
    // … otherwise clear the tile.
    paintTile(x, y, 0);
  };

  const onMove = (sel: Selection, x: number, y: number) => {
    const b = bundleRef.current;
    if (!b) return;
    let next: LevelBundle = b;
    if (sel.kind === "enemy")
      next = { ...b, entities: b.entities.map((e, i) => (i === sel.index ? { ...e, x, y } : e)) };
    else if (sel.kind === "item")
      next = { ...b, items: b.items.map((it, i) => (i === sel.index ? { ...it, x, y } : it)) };
    else if (sel.kind === "trigger")
      next = { ...b, triggers: b.triggers.map((t, i) => (i === sel.index ? { ...t, x, y } : t)) };
    else if (sel.kind === "spawn") next = { ...b, spawn: [x, y] };
    else if (sel.kind === "exit") next = { ...b, exit: [x, y] };
    setBundleSynced(next);
  };

  const onCommit = (sel: Selection) => {
    if (sel.kind === "enemy") markDirty("entities");
    else if (sel.kind === "item") markDirty("items");
    else if (sel.kind === "trigger") markDirty("triggers");
    else markDirty("markers");
  };

  const applyResize = (w: number, h: number) => {
    const b = bundleRef.current;
    if (!b || w < 8 || h < 8) return;
    const col = b.grids.collision;
    const rows: number[][] = [];
    for (let y = 0; y < h; y++) {
      const src = col[y] ?? [];
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(src[x] ?? 0);
      rows.push(row);
    }
    const cl = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, v));
    setBundleSynced({
      ...b,
      grid_width: w,
      grid_height: h,
      grids: { ...b.grids, collision: rows },
      spawn: b.spawn ? [cl(b.spawn[0], w), cl(b.spawn[1], h)] : b.spawn,
      exit: b.exit ? [cl(b.exit[0], w), cl(b.exit[1], h)] : b.exit,
      entities: b.entities.map((e) => ({ ...e, x: cl(e.x, w), y: cl(e.y, h) })),
      items: b.items.map((it) => ({ ...it, x: cl(it.x, w), y: cl(it.y, h) })),
      triggers: b.triggers.map((t) => ({ ...t, x: cl(t.x, w), y: cl(t.y, h) })),
    });
    (["grids", "entities", "items", "triggers", "markers"] as DirtyLayer[]).forEach(markDirty);
  };

  // --- persistence ---------------------------------------------------------

  const doSave = async (): Promise<boolean> => {
    const b = bundleRef.current;
    if (!b || dirty.size === 0) return true;
    setSave({ status: "saving" });
    try {
      if (dirty.has("grids")) {
        await api.saveLevelGrids(worldPath, levelId, b.grids.collision);
      }
      const sparse: Record<string, unknown> = {};
      if (dirty.has("entities"))
        sparse.entities = b.entities.map((e) => ({
          enemy_id: e.enemy_id,
          x: e.x,
          y: e.y,
          variant: e.variant,
        }));
      if (dirty.has("items"))
        sparse.items = b.items.map((it) => ({
          item_id: it.item_id,
          x: it.x,
          y: it.y,
          source: it.source,
        }));
      if (dirty.has("triggers"))
        sparse.triggers = b.triggers.map((t) => ({
          x: t.x,
          y: t.y,
          type: t.type,
          // A room's event placement carries only its row id on the wire; the
          // writer keeps the on-disk sidecar shape (P.6.3's write table).
          params: room ? { event_id: t.params?.event_id } : (t.params ?? {}),
        }));
      if (dirty.has("markers")) {
        sparse.spawn = b.spawn;
        sparse.exit = b.exit;
      }
      if (Object.keys(sparse).length) {
        await api.saveLevelEdit(worldPath, levelId, sparse);
      }
      await reload();
      setSave({ status: "saved" });
      return true;
    } catch (e) {
      setSave({ status: "error", msg: String(e) });
      return false;
    }
  };

  // Validate/Play always see the level AS IT SITS in the editor: dirty
  // layers flush to disk first (canon owns the formats), then the real
  // machinery runs on the saved tree.
  const doValidate = async () => {
    setValidating(true);
    setPlayNote(null);
    try {
      if (!(await doSave())) return;
      const report = await api.validateLevel(worldPath, levelId);
      setValReport(report);
      setLevelValidation(levelId, report);
    } catch (e) {
      setPlayNote(String(e).slice(0, 200));
    } finally {
      setValidating(false);
    }
  };

  // Plays in the CURRENT view mode: Blocks view → plain blocks (no tile
  // art, placeholder sprites), Art/Overlay → full art. Same physics.
  const doPlay = async () => {
    setPlayNote(null);
    const plain = mode === "blocks";
    try {
      if (!(await doSave())) return;
      const result = await api.playLevel(worldPath, levelId, plain);
      setPlayNote(
        result.launched
          ? `playing${plain ? " without art" : ""} in ${result.engine ?? "pygame"} ▶ (Esc quits, R respawns)`
          : (result.note ?? "not launched"),
      );
    } catch (e) {
      setPlayNote(String(e).slice(0, 200));
    }
  };

  // Place enemies/items onto THIS level's current terrain (composable
  // generation) — grid-driven, so it works on a generated OR a hand-painted
  // level. Flushes dirty edits first, then reloads the fresh placements.
  const doPlace = async (kind: "enemies" | "items") => {
    const paid = placeBackend === "anthropic";
    let est: CostEstimate | null = null;
    if (paid) {
      try {
        est = (await api.estimateLevel(worldPath, levelId, kind, placeBackend)).estimate;
      } catch {
        /* estimate is advisory — never block the op on it */
      }
    }
    // The paid card gates a paid backend (row P1-A5); fake runs at once.
    if (
      !(await confirmSpend({
        title: `place ${kind} on ${levelId}`,
        body: `est. ${fmtRange(est?.total_usd)} — (re)places ${kind} using the level's current terrain.`,
        estimate: est,
        backends: { llm: placeBackend },
      }))
    )
      return;
    setPlayNote(null);
    if (!(await doSave())) return;
    // Fire-and-forget background job (the tray tracks it; this level reloads on
    // completion via the job-completion listener below).
    await enqueueJob(
      {
        op: kind,
        label: `Place ${kind} · ${levelId}`,
        target: levelId,
        targetType: "levels",
        scope: "level",
        backends: { llm: placeBackend },
        estimate: est?.total_usd,
      },
      (jobId) =>
        kind === "enemies"
          ? api.placeEnemies(worldPath, levelId, jobId, undefined, undefined, placeBackend)
          : api.placeItems(worldPath, levelId, jobId, undefined, undefined, placeBackend),
    );
    setPlayNote(`place ${kind} queued — watch ⚙ Jobs`);
  };

  // Flush pending edits, then open the "regenerate this level's layout" modal
  // (the LLM rebuilds the terrain; the op reads the level from disk).
  const openRegen = async () => {
    if (!(await doSave())) return;
    setRegenOpen(true);
  };

  // A world-map action can ask to land IN a flow rather than at the editor's
  // front door — "Generate from <area>" on a planned node means "open this
  // draft with the layout modal up". One-shot: consumed, then cleared.
  const pendingAction = useStore((s) => s.pendingLevelAction);
  const setPendingLevelAction = useStore((s) => s.setPendingLevelAction);
  useEffect(() => {
    if (pendingAction !== "layout" || !bundle) return;
    setPendingLevelAction(null);
    setRegenOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, !!bundle]);

  // Flush pending edits, then open the context-aware "improve this level" modal
  // (the LLM sees the current level from disk + an instruction and refines it).
  /** A level that has only ever been CREATED is a flat empty scaffold — there
   *  is nothing there to improve. Improve applies once a human or the LLM has
   *  actually built something (generate / paint / place). */
  const neverBuilt = bundle?.last_change?.op === "create";

  const openImprove = async () => {
    if (neverBuilt) return;
    if (!(await doSave())) return;
    setImproveOpen(true);
  };

  // The design moves the secondary tools into "⌘K + dock tabs". Registering
  // them here means ONE definition serves both surfaces — the toolbar buttons
  // and the palette call the same handlers. Withdrawn on unmount so a closed
  // level never leaves stale commands (they close over this level's state).
  const registerCommands = useStore((s) => s.registerCommands);
  const unregisterCommands = useStore((s) => s.unregisterCommands);
  useEffect(() => {
    // A room registers the same commands: the ones it can run are live, the
    // rest stay greyed with their reason — the palette answers "why can't I?"
    // instead of losing the entry (doctrine 4).
    const group = room ? `Room · ${levelId}` : `Level · ${levelId}`;
    registerCommands("level", [
      {
        id: "level.save",
        label: "Save this level",
        group,
        hint: kbd("S"),
        enabled: dirty.size > 0,
        disabledReason: "no unsaved edits",
        run: () => void doSave(),
      },
      {
        id: "level.validate",
        label: "Validate this level",
        group,
        keywords: "check playable problems reachability",
        enabled: !room,
        disabledReason: ROOM_REASONS.validate,
        run: () => void doValidate(),
      },
      {
        id: "level.improve",
        label: "Improve this level…",
        group,
        keywords: "llm refine instruction harder easier",
        enabled: !room && !neverBuilt,
        disabledReason: room ? ROOM_REASONS.improve : "nothing built yet — generate first",
        run: () => void openImprove(),
      },
      {
        id: "level.layout",
        label: room ? "Roll a new maze layout" : "Regenerate the layout…",
        group,
        keywords: "redesign terrain blind maze roll",
        enabled: true,
        run: () => void (room ? doRoll("layout") : openRegen()),
      },
      {
        id: "level.music",
        label: "Music and regions…",
        group,
        keywords: "audio theme track sections",
        enabled: !room,
        disabledReason: ROOM_REASONS.music,
        run: () => setMusicOpen(true),
      },
    ]);
    return () => unregisterCommands("level");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId, room, dirty.size, neverBuilt, registerCommands, unregisterCommands]);

  const publish = async () => {
    setSave({ status: "saving" });
    try {
      const pos = publishPos.trim() ? parseInt(publishPos, 10) : null;
      await api.publishLevel(worldPath, levelId, pos, false);
      try {
        setEntities("levels", await api.listEntities(worldPath, "levels"));
      } catch {}
      await reload();
      setSave({ status: "saved" });
    } catch (e) {
      setSave({ status: "error", msg: String(e) });
    }
  };

  // Keyboard: mod+S save · Esc disarm brush/selection · Delete removes
  // selection. `isShortcut` resolves the platform's primary modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (isShortcut(e, "s")) {
        e.preventDefault();
        void doSave();
        return;
      }
      if (e.key === "Escape") {
        setBrush(null);
        setSelection(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        deleteSelection(selection);
        return;
      }
      // The rail's tooltips have advertised V/B/G/E since it was built, but
      // nothing bound them — the same "hint with no handler" bug keys.ts was
      // written to stop. Modified keys are handled above and must not fall in.
      if (e.metaKey || e.ctrlKey || e.altKey || target?.isContentEditable) return;
      const t = TOOL_KEYS[e.key.toLowerCase()];
      if (t) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, dirty, room]);

  const selected = useMemo(() => {
    if (!bundle || !selection) return null;
    if (selection.kind === "enemy") return bundle.entities[selection.index];
    if (selection.kind === "item") return bundle.items[selection.index];
    if (selection.kind === "trigger") return bundle.triggers[selection.index];
    return null;
  }, [bundle, selection]);

  if (err)
    return (
      <div className="detail-error" style={{ padding: 16 }}>
        Could not render level: {err}
      </div>
    );
  if (!bundle) return <p style={{ padding: 16 }}>Rendering level…</p>;

  const isDraft = !room && !bundle.display_name && !bundle.parent_level;
  // Count chips read their nouns from the pack's placements (NPCs / events /
  // items for a room) — the platformer keeps its literal enemies / items.
  const nounFor = (wire: string, fallback: string) =>
    (tabs.find((t) => t.wire === wire)?.label ?? fallback).toLowerCase();
  const chip = (label: string, tone?: string, key?: string, title?: string) => (
    <span
      key={key ?? label}
      title={title}
      style={{
        display: "inline-block",
        fontSize: 12,
        fontFamily: "var(--mono)",
        background: "var(--bg-hover)",
        border: `1px solid ${tone ?? "var(--border)"}`,
        borderRadius: 6,
        padding: "1px 8px",
        marginRight: 6,
        color: tone ?? "var(--fg-muted)",
      }}
    >
      {label}
    </span>
  );
  /** A header action; `disabledReason` keeps it visible and explains itself
   *  (doctrine 4 — disabled with a reason beats hidden). */
  const btn = (
    label: string,
    onClick: () => void,
    accent = false,
    disabledReason?: string,
    /** Tooltip when the action IS available — where the room rolls carry
     *  their "$0 — code only" promise (doctrine 3). */
    title?: string,
  ): React.ReactNode => (
    <button
      key={label}
      onClick={onClick}
      className={accent ? "btn pri" : "btn"}
      style={{ marginLeft: 8 }}
      disabled={!!disabledReason}
      title={disabledReason ?? title}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        padding: 16,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {chip(bundle.display_name ?? bundle.level_id)}
        {bundle.revision_short && (
          <span
            title={
              `revision ${bundle.revision}` +
              (bundle.last_change
                ? `\nlast change: ${bundle.last_change.label} (${bundle.last_change.source || "?"})` +
                  (bundle.last_change.actor ? ` by ${bundle.last_change.actor}` : "") +
                  (bundle.last_change.ts ? ` · ${bundle.last_change.ts}` : "")
                : "\nno recorded history")
            }
            style={{
              display: "inline-block",
              fontSize: 12,
              fontFamily: "var(--mono)",
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "1px 8px",
              marginRight: 6,
              color: "var(--fg-dim)",
            }}
          >
            ⬡ {bundle.revision_short}
            {bundle.last_change && (
              <span style={{ color: "var(--fg-muted)" }}>
                {" · "}
                {bundle.last_change.label}
                {bundle.last_change.ts ? ` · ${relTime(bundle.last_change.ts)}` : ""}
              </span>
            )}
          </span>
        )}
        {isDraft && chip("draft — not in world", "var(--accent)")}
        {bundle.parent_level && chip(`secret room of ${bundle.parent_level}`, "var(--special)")}
        {chip(`${bundle.entities.length} ${nounFor("entities", "enemies")}`)}
        {room && chip(`${bundle.triggers.length} ${nounFor("triggers", "events")}`)}
        {chip(`${bundle.items.length} ${nounFor("items", "items")}`)}
        {room &&
          (bundle.warnings?.length ?? 0) > 0 &&
          chip(`${bundle.warnings!.length} warnings`, "var(--warn)", "warnings")}
        {dirty.size > 0 && chip(`unsaved: ${[...dirty].join(" ")}`, "var(--warn)", "dirty")}
        {save.status === "saved" && dirty.size === 0 && chip("saved ✓", "var(--ok)")}
        {save.status === "error" &&
          chip(
            // Canon refuses fail-closed with a REASON (a wall over a
            // placement, a free door drag): show as much as fits and keep
            // the whole sentence on the hover.
            `save failed: ${cleanReason(save.msg).slice(0, 90)}`,
            "var(--err)",
            "save-error",
            cleanReason(save.msg),
          )}
        {valReport &&
          chip(
            !valReport.ok
              ? `invalid ✗ ${countProblems(valReport)}`
              : (valReport.repair_count ?? 0) > 0
                ? `playable · ${valReport.repair_count} placement notes`
                : "valid ✓",
            !valReport.ok
              ? "var(--err)"
              : (valReport.repair_count ?? 0) > 0
                ? "var(--accent)"
                : "var(--ok)",
            "validation",
          )}
        {playNote && chip(playNote.slice(0, 70), "var(--special)", "play-note")}
        <span style={{ flex: 1 }} />
        {btn(
          validating ? "Validating…" : "✓ Validate",
          () => void doValidate(),
          false,
          room ? ROOM_REASONS.validate : undefined,
        )}
        {btn(
          mode === "blocks" ? "▶ Play blocks" : "▶ Play",
          () => void doPlay(),
          !room && dirty.size === 0,
          room ? ROOM_REASONS.play : undefined,
        )}
        {/* 🪄 Layout: the platformer opens the LLM regenerate modal; a room
            re-carves its maze with `grid roll --step layout` — code only,
            $0, no spend card (doctrine 3). */}
        {btn(
          "🪄 Layout",
          () => void (room ? doRoll("layout") : openRegen()),
          false,
          undefined,
          room ? `Re-carve the maze · ${ROLL_COST_NOTE}` : undefined,
        )}
        <button
          className="btn"
          style={{ marginLeft: 8 }}
          disabled={room || neverBuilt}
          title={
            room
              ? ROOM_REASONS.improve
              : neverBuilt
                ? "This level is still an empty scaffold — generate a layout first"
                : "Re-author the layout from an instruction, keeping its size and axis"
          }
          onClick={() => void openImprove()}
        >
          ✨ Improve
        </button>
        {btn("🎵 Music", () => setMusicOpen(true), false, room ? ROOM_REASONS.music : undefined)}
        {room ? (
          <>
            {tabs.map((t) =>
              btn(
                `🎲 ${t.label}`,
                () => void doRoll(`${t.kind}s`),
                false,
                undefined,
                `Re-place every ${t.label.toLowerCase()} in this room · ${ROLL_COST_NOTE}`,
              ),
            )}
            {monsterTypeId &&
              btn(
                "🎲 Monsters",
                () => void doRoll("monsters"),
                false,
                selectedEventId === null
                  ? "select an encounter on the canvas first — a monsters roll re-rolls ONE encounter's roster"
                  : undefined,
                `Re-roll encounter ${selectedEventId}'s monsters · ${ROLL_COST_NOTE}`,
              )}
            {btn(
              "⟳ Whole room",
              () => void doRoll("whole"),
              false,
              undefined,
              `Re-carve and re-place everything, then re-designate the gate · ${ROLL_COST_NOTE}`,
            )}
            <span
              className="chip"
              title="Room rolls are pure code — no model, no provider, no spend card"
              style={{ marginLeft: 6, fontSize: 11 }}
            >
              {ROLL_COST_NOTE}
            </span>
          </>
        ) : (
          <>
            {btn("🎲 Enemies", () => void doPlace("enemies"))}
            {btn("🎲 Items", () => void doPlace("items"))}
            <select
              value={placeBackend}
              onChange={(e) => setPlaceBackend(e.target.value as "fake" | "anthropic")}
              title="Backend for 🎲 placement"
              style={{ fontSize: 11, marginLeft: 6 }}
            >
              <option value="fake">fake ($0)</option>
              <option value="anthropic">paid</option>
            </select>
          </>
        )}
        {/* The view switch: a room has no tilesheet, so blocks is the only
            honest mode — the other two stay visible, disabled with the reason. */}
        <div className="segmented" title={room ? ROOM_REASONS.mode : undefined}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={mode === m.id ? "seg-btn active" : "seg-btn"}
              disabled={room && m.id !== "blocks"}
              title={room && m.id !== "blocks" ? ROOM_REASONS.mode : undefined}
              aria-pressed={mode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label style={{ fontSize: 12, margin: "0 6px 0 10px", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />{" "}
          grid
        </label>
        <label style={{ fontSize: 12, userSelect: "none" }}>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
          />{" "}
          labels
        </label>
        {btn(layout.focusMode ? "⤢ Exit focus" : "⤢ Focus", () =>
          setLayout({ focusMode: !layout.focusMode }),
        )}
        {btn(save.status === "saving" ? "Saving…" : "Save", () => void doSave(), dirty.size > 0)}
      </div>

      {valReport && <ValidationPanel report={valReport} />}

      {/* Fixed-height column, per the design: the stage FLEXES and the dock is
          pinned beneath it. As a scrolling page the dock fell below the fold. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {/* The rail floats over the CANVAS, so it anchors to a wrapper that
              spans only the canvas — anchoring to the column would put it on
              top of the row below. */}
          {/* The stage clips its floating panels (design: `.stage{overflow:hidden}`)
              so a tall minimap can't spill onto the controls below when the
              window is short. Tooltips are portaled to <body>, so they escape. */}
          <div
            style={
              {
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                // In focus mode the dock FLOATS over the stage, so the rail and
                // the zoom pill have to clear it or they end up underneath.
                // (The design does this in JS; one variable is enough here.)
                "--dock-clear": layout.focusMode
                  ? `${182 + (audioOpen ? 112 : 0) + 18 + 14}px`
                  : "10px",
              } as React.CSSProperties
            }
          >
            {/* Read-only: no edit callbacks and no brush — the canvas is the
                pan/zoom viewer it already is without them; select still
                reaches the tray. Bounds are gravity chrome and stay off. */}
            <LevelCanvas
              bundle={bundle}
              scale={26}
              mode={mode}
              showGrid={showGrid}
              showLabels={showLabels}
              showBounds={!room && showBounds}
              showRulers={!room && showBounds}
              selection={selection}
              brush={brush}
              tool={tool}
              painted={painted}
              onSelect={setSelection}
              onMove={onMove}
              onCommit={onCommit}
              onPaint={onPaint}
              onPlace={onPlace}
              onErase={onErase}
              height="100%"
              onFill={onFill}
              onCamera={setCam}
              camApi={camApi}
            />
            {showMinimap && <Minimap bundle={bundle} cam={cam} camApi={camApi} />}
            <ToolRail
              tool={tool}
              onTool={setTool}
              showBounds={!room && showBounds}
              onToggleBounds={() => !room && setShowBounds((v) => !v)}
              showMinimap={showMinimap}
              onToggleMinimap={() => setShowMinimap((v) => !v)}
              onOpenMusic={() => !room && setAudioOpen((v) => !v)}
              audioOpen={audioOpen}
              disabled={room ? RAIL_ROOM : undefined}
            />
          </div>
          <div
            style={{
              margin: "10px 2px 0",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {/* The interaction hint moved into the dock's armed-brush pane,
                where it sits beside the thing it describes. */}
            <span style={{ flex: 1, minWidth: 120 }} />
            <label
              style={{ fontSize: 12, color: "var(--fg-dim)" }}
              title={room ? ROOM_REASONS.resize : undefined}
            >
              W{" "}
              <input
                type="number"
                value={resizeW}
                min={8}
                disabled={room}
                onChange={(e) => setResizeW(parseInt(e.target.value || "0", 10))}
                style={{ width: 58 }}
              />
            </label>
            <label
              style={{ fontSize: 12, color: "var(--fg-dim)" }}
              title={room ? ROOM_REASONS.resize : undefined}
            >
              H{" "}
              <input
                type="number"
                value={resizeH}
                min={8}
                disabled={room}
                onChange={(e) => setResizeH(parseInt(e.target.value || "0", 10))}
                style={{ width: 58 }}
              />
            </label>
            {btn(
              "Resize",
              () => applyResize(resizeW, resizeH),
              false,
              room ? ROOM_REASONS.resize : undefined,
            )}
            {isDraft && (
              <>
                <input
                  type="number"
                  placeholder="pos"
                  value={publishPos}
                  min={1}
                  onChange={(e) => setPublishPos(e.target.value)}
                  style={{ width: 52 }}
                  title="1-based slot in the stage (empty = append)"
                />
                {btn("Publish to world", () => void publish(), true)}
              </>
            )}
          </div>

          <div className="dockwrap">
            <AudioLane bundle={bundle} open={audioOpen} onOpenMusic={() => setMusicOpen(true)} />

            {/* The bottom dock: armed brush · palette tabs · contextual tray.
              The inspector is no longer a third column beside the canvas —
              it IS the tray pane, so selecting something doesn't shrink the
              map you're editing. */}
            <Dock
              bundle={bundle}
              brush={brush}
              onBrush={setBrush}
              onReplaceArt={room ? undefined : replaceArt}
              room={room}
              placements={room ? tabs : undefined}
              rows={roomDb}
              monsterTypeId={monsterTypeId}
              selection={selection}
              onSelect={setSelection}
              tray={
                selection ? (
                  <Inspector
                    bundle={bundle}
                    selection={selection}
                    selected={selected}
                    enemyIds={Object.keys(enemyDb)}
                    itemIds={Object.keys(itemDb)}
                    onOpenEntity={(typeId, id) => select({ kind: "entity", typeId, id })}
                    onDelete={() => deleteSelection(selection)}
                    onReplaceArt={replaceArt}
                    onSwitch={(newId) => onSwitch(selection, newId)}
                    room={room}
                    placements={tabs}
                  />
                ) : room ? (
                  <RoomFacts bundle={bundle} />
                ) : undefined
              }
            />
          </div>
        </div>
      </div>
      {regenOpen && bundle && (
        <RegenerateLayoutModal
          worldPath={worldPath}
          levelId={levelId}
          currentBrief={bundle.brief ?? undefined}
          onClose={() => setRegenOpen(false)}
          // Runs as a background job — just note it; the completion listener
          // above reloads this level when the job finishes.
          onDone={(note) => setPlayNote(note)}
        />
      )}
      {improveOpen && bundle && (
        <ImproveLayoutModal
          worldPath={worldPath}
          levelId={levelId}
          bundle={bundle}
          valReport={valReport}
          onClose={() => setImproveOpen(false)}
          onDone={(note) => setPlayNote(note)}
        />
      )}
      {musicOpen && bundle && (
        <MusicPanel
          worldPath={worldPath}
          levelId={levelId}
          bundle={bundle}
          onClose={() => setMusicOpen(false)}
          onDone={(note) => {
            setPlayNote(note);
            void reload();
          }}
        />
      )}
    </div>
  );
}

/** The tray with nothing selected in a room: the room's own facts
 *  (P0 paper P.6.4 — environment, gate link, quest ids, the monsters bucket)
 *  and every warning the export named, each id an EntityLink to its row. */
function RoomFacts({ bundle }: { bundle: LevelBundle }) {
  const room = bundle.room;
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
      <span style={{ color: "var(--fg-dim)" }}>{k}</span>
      <span style={{ fontFamily: "var(--mono)", textAlign: "right" }}>{v}</span>
    </div>
  );
  if (!room) {
    return (
      <div className="dock-tray-empty">
        <div className="dock-sect">Room</div>
        <p>This bundle carries no room block.</p>
      </div>
    );
  }
  return (
    <div>
      <Header title={room.environment_name || bundle.level_id} sub={`room · ${room.environment}`} />
      {row("id", bundle.level_id)}
      {row("environment", room.environment)}
      {row("door", room.door_revealed ? "revealed" : "hidden")}
      {row(
        "gate",
        room.gate_encounter_id !== null && room.gate_encounter_id !== undefined ? (
          <EntityLink typeId="events" id={String(room.gate_encounter_id)} />
        ) : (
          "—"
        ),
      )}
      {row(
        "quests",
        room.quest_ids.length ? (
          <span
            style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}
          >
            {room.quest_ids.map((q) => (
              <EntityLink key={String(q)} typeId="quests" id={String(q)} />
            ))}
          </span>
        ) : (
          "—"
        ),
      )}
      {row(
        "monsters",
        room.monsters.length ? (
          <span
            style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}
          >
            {room.monsters.map((m, i) => (
              <EntityLink
                key={`${m.entity_id ?? i}`}
                typeId="monsters"
                id={String(m.entity_id ?? "")}
                fallbackLabel={m.name}
              />
            ))}
          </span>
        ) : (
          "—"
        ),
      )}
      {(bundle.warnings?.length ?? 0) > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="dock-sect">Warnings</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
            {bundle.warnings!.map((w, i) => (
              <li key={i} style={{ color: "var(--warn)", fontSize: 11, margin: "2px 0" }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Inspector({
  bundle,
  selection,
  selected,
  enemyIds,
  itemIds,
  onOpenEntity,
  onDelete,
  onReplaceArt,
  onSwitch,
  room = false,
  placements = [],
}: {
  bundle: LevelBundle;
  selection: Selection;
  selected: unknown;
  enemyIds: string[];
  itemIds: string[];
  onOpenEntity: (typeId: string, id: string) => void;
  onDelete: () => void;
  onReplaceArt: (target: string) => void;
  onSwitch: (newId: string) => void;
  /** A dungeon room placement: the row link and delete are live (row P0-8);
   *  sprite replacement and the definition switcher stay platformer verbs. */
  room?: boolean;
  /** The pack's placements — resolves the placed row's type id for the link. */
  placements?: PlacementTab[];
}) {
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
      <span style={{ color: "var(--fg-dim)" }}>{k}</span>
      <span style={{ fontFamily: "var(--mono)", textAlign: "right" }}>{v}</span>
    </div>
  );
  /** The cradle type id behind a selection kind, from the pack's placements
   *  (a room's `enemy` handles are NPCs); the platformer's literal ids else. */
  const typeIdFor = (kind: Selection["kind"], fallback: string) => {
    const wire = Object.entries(SEL_KIND_BY_WIRE).find(([, k]) => k === kind)?.[0];
    return placements.find((p) => p.wire === wire)?.typeId ?? fallback;
  };
  const link = (kind: Selection["kind"], fallback: string, id: string, label?: string) => (
    <div style={{ marginTop: 10 }}>
      <EntityLink typeId={typeIdFor(kind, fallback)} id={id} fallbackLabel={label} />
    </div>
  );
  const actionBtn = (label: string, onClick: () => void, danger = false) => (
    <button
      onClick={onClick}
      style={{
        background: "var(--bg-hover)",
        border: `1px solid ${danger ? "var(--err)" : "var(--border)"}`,
        borderRadius: 6,
        color: danger ? "var(--err)" : "var(--accent)",
        cursor: "pointer",
        fontSize: 12,
        padding: "3px 8px",
        marginTop: 10,
        marginRight: 8,
      }}
    >
      {label}
    </button>
  );
  const deletable = ["enemy", "item", "trigger"].includes(selection.kind);
  const switcher = (current: string, ids: string[]) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
      <span style={{ color: "var(--fg-dim)", fontSize: 12 }}>switch to</span>
      <select
        value=""
        onChange={(e) => e.target.value && onSwitch(e.target.value)}
        style={{ flex: 1, fontSize: 12 }}
      >
        <option value="">choose…</option>
        {ids
          .filter((id) => id !== current)
          .map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
      </select>
    </div>
  );

  if (selection.kind === "enemy") {
    const e = selected as LevelBundle["entities"][number];
    const noun = room ? (placements.find((p) => p.wire === "entities")?.kind ?? "enemy") : "enemy";
    return (
      <div>
        <Header
          title={e.name}
          sub={`${noun} placement`}
          sprite={e.sprite_path_abs}
          color={e.placeholder_color}
        />
        {row(noun, e.enemy_id)}
        {room ? row("type", e.archetype ?? "—") : row("variant", e.variant ?? "—")}
        {!room && row("size", `${e.size}`)}
        {row("cell", `${e.x}, ${e.y}`)}
        {room ? (
          <>
            {link("enemy", "enemies", e.enemy_id, e.name)}
            {actionBtn("delete", onDelete, true)}
          </>
        ) : (
          <>
            {switcher(e.enemy_id, enemyIds)}
            {actionBtn("replace sprite…", () => onReplaceArt(`enemy:${e.enemy_id}`))}
            {actionBtn("open enemy →", () => onOpenEntity("enemies", e.enemy_id))}
            {actionBtn("delete", onDelete, true)}
          </>
        )}
      </div>
    );
  }
  if (selection.kind === "item") {
    const it = selected as LevelBundle["items"][number];
    return (
      <div>
        <Header
          title={it.name}
          sub="item placement"
          sprite={it.sprite_path_abs}
          color={it.placeholder_color}
        />
        {row("item", it.item_id)}
        {row("kind", it.kind ?? "—")}
        {!room && row("source", it.source ?? "—")}
        {row("cell", `${it.x}, ${it.y}`)}
        {room ? (
          <>
            {link("item", "items", it.item_id, it.name)}
            {actionBtn("delete", onDelete, true)}
          </>
        ) : (
          <>
            {switcher(it.item_id, itemIds)}
            {actionBtn("replace sprite…", () => onReplaceArt(`item:${it.item_id}`))}
            {actionBtn("open item →", () => onOpenEntity("items", it.item_id))}
            {actionBtn("delete", onDelete, true)}
          </>
        )}
      </div>
    );
  }
  if (selection.kind === "trigger") {
    const t = selected as LevelBundle["triggers"][number];
    const room = (t.params?.room_id as string | undefined) ?? null;
    // A room's event tile (P.6.2 row 6 / row 13's read side): the event row,
    // its gate flags and the monsters its encounter carries — all links.
    const eventId = t.params?.event_id;
    const monsterIds = Array.isArray(t.params?.monster_ids)
      ? (t.params!.monster_ids as (number | string)[])
      : [];
    return (
      <div>
        <Header
          title={t.type === "room_entrance" ? "door" : t.type}
          sub={eventId !== undefined ? "event placement" : "trigger"}
        />
        {row("type", t.type)}
        {row("cell", `${t.x}, ${t.y}`)}
        {room && row("room", room)}
        {t.params?.verb ? row("verb", String(t.params.verb)) : null}
        {eventId !== undefined && row("event", String(eventId))}
        {eventId !== undefined && row("gate", t.params?.is_gate ? "yes — guards the door" : "no")}
        {eventId !== undefined && t.params?.is_climax_boss ? row("climax boss", "yes") : null}
        {eventId !== undefined && monsterIds.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ color: "var(--fg-dim)", fontSize: 11 }}>monsters</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
              {monsterIds.map((m) => (
                <EntityLink key={String(m)} typeId="monsters" id={String(m)} />
              ))}
            </div>
          </div>
        )}
        {eventId !== undefined && link("trigger", "events", String(eventId))}
        {room && deletable && actionBtn("delete", onDelete, true)}
        {!room && deletable && t.type === "checkpoint" && actionBtn("delete", onDelete, true)}
      </div>
    );
  }
  const pt = selection.kind === "spawn" ? bundle.spawn : bundle.exit;
  return (
    <div>
      <Header title={selection.kind} sub="marker" />
      {row("cell", pt ? `${pt[0]}, ${pt[1]}` : "—")}
    </div>
  );
}

function Header({
  title,
  sub,
  sprite,
  color,
}: {
  title: string;
  sub: string;
  sprite?: string | null;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: color ?? "var(--bg-hover)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {sprite && (
          <img
            src={sprite}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              imageRendering: "pixelated",
            }}
          />
        )}
      </div>
      <div>
        <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{title}</div>
        <div style={{ color: "var(--fg-dim)", fontSize: 11 }}>{sub}</div>
      </div>
    </div>
  );
}

/** Per-check results from `canon level validate` — problems in red, code
 * repairs (nudges the generator would apply) and free-water notes muted.
 * Collapses to nothing when a clean report has nothing to say. */
function ValidationPanel({ report }: { report: ValidationReport }) {
  const rows: React.ReactNode[] = [];
  const line = (color: string, text: string, key: string) => (
    <li key={key} style={{ color, fontSize: 12, margin: "2px 0" }}>
      {text}
    </li>
  );
  const renderOne = (r: ValidationReport, label: string) => {
    for (const c of r.checks) {
      for (const [i, p] of c.problems.entries())
        rows.push(line("var(--err)", `${label}${c.name}: ${p}`, `${label}${c.name}p${i}`));
      for (const [i, p] of (c.repairs ?? []).entries())
        rows.push(
          line(
            "var(--accent)",
            `${label}${c.name} (placement defect — playable, but generation would relocate/drop it): ${p}`,
            `${label}${c.name}r${i}`,
          ),
        );
      for (const [i, p] of (c.notes ?? []).entries())
        rows.push(line("var(--fg-dim)", `${label}${c.name}: ${p}`, `${label}${c.name}n${i}`));
    }
    for (const room of r.rooms ?? []) renderOne(room, `${room.level_id} · `);
  };
  renderOne(report, "");
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${report.ok ? "var(--ok)" : "var(--err)"}`,
        borderRadius: 8,
        padding: "8px 14px",
        margin: "0 0 12px",
        background: "var(--bg-raised)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--fg-dim)", marginBottom: 2 }}>
        canon level validate · {report.ok ? "playable" : "NOT playable as-is"} — reachability
        simulated under this level's own physics
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{rows}</ul>
    </div>
  );
}
