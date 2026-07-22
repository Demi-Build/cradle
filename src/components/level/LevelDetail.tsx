// The level editor. Fetches the render bundle (canon level export), renders it
// in Blocks/Art/Overlay via <LevelCanvas>, and supports the full construction
// loop: select+drag placements, paint tile TYPES from the palette, place/erase
// enemies/items/checkpoints, resize the grid, and create/publish flows.
//
// Save model is BATCH: every edit mutates the local bundle (live re-render in
// all modes) and marks its layer dirty; Save (⌘S) persists — sparse layers via
// `canon level apply-edit`, the painted grid via `canon level import-grids`
// (terrain/background/hazards re-derived canon-side) — then re-exports fresh.

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";
import { LevelCanvas } from "./LevelCanvas";
import { PaletteRail } from "./PaletteRail";
import type { Brush, LevelBundle, RenderMode, Selection } from "./drawLevel";

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

/** enemy/item DB lookups for stamping new placements with display data. */
function useDbInfo(typeId: "enemies" | "items"): Record<string, DbInfo> {
  const worldPath = useStore((s) => s.worldPath);
  const [map, setMap] = useState<Record<string, DbInfo>>({});
  useEffect(() => {
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
  }, [worldPath, typeId]);
  return map;
}

type DirtyLayer = "grids" | "entities" | "items" | "triggers" | "markers";
type SaveState = { status: "idle" | "saving" | "saved" | "error"; msg?: string };

export function LevelDetail({ levelId }: { levelId: string }) {
  const worldPath = useStore((s) => s.worldPath);
  const select = useStore((s) => s.select);
  const setEntities = useStore((s) => s.setEntities);
  const [bundle, setBundle] = useState<LevelBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<RenderMode>("art");
  const [showGrid, setShowGrid] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [brush, setBrush] = useState<Brush | null>(null);
  const [painted, setPainted] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState<Set<DirtyLayer>>(new Set());
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [resizeW, setResizeW] = useState<number>(0);
  const [resizeH, setResizeH] = useState<number>(0);
  const [publishPos, setPublishPos] = useState<string>("");
  const [assetRev, setAssetRev] = useState(0);
  const enemyDb = useDbInfo("enemies");
  const itemDb = useDbInfo("items");

  const bundleRef = useRef<LevelBundle | null>(null);
  const setBundleSynced = (b: LevelBundle | null) => {
    bundleRef.current = b;
    setBundle(b);
    if (b) {
      setResizeW(b.grid_width);
      setResizeH(b.grid_height);
    }
  };
  const markDirty = (layer: DirtyLayer) =>
    setDirty((d) => (d.has(layer) ? d : new Set(d).add(layer)));

  const reload = async (rev = assetRev) => {
    const b = (await api.exportLevel(worldPath, levelId)) as LevelBundle;
    setBundleSynced(resolveBundleAssets(b, rev));
    setPainted(new Set());
    setDirty(new Set());
  };

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
    api.baselineLevel(worldPath, levelId).catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldPath, levelId]);

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
            x, y,
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
            x, y,
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
    const ti = b.triggers.findIndex((t) => t.x === x && t.y === y && t.type === "checkpoint");
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

  const doSave = async () => {
    const b = bundleRef.current;
    if (!b || dirty.size === 0) return;
    setSave({ status: "saving" });
    try {
      if (dirty.has("grids")) {
        await api.saveLevelGrids(worldPath, levelId, b.grids.collision);
      }
      const sparse: Record<string, unknown> = {};
      if (dirty.has("entities"))
        sparse.entities = b.entities.map((e) => ({
          enemy_id: e.enemy_id, x: e.x, y: e.y, variant: e.variant,
        }));
      if (dirty.has("items"))
        sparse.items = b.items.map((it) => ({
          item_id: it.item_id, x: it.x, y: it.y, source: it.source,
        }));
      if (dirty.has("triggers"))
        sparse.triggers = b.triggers.map((t) => ({
          x: t.x, y: t.y, type: t.type, params: t.params ?? {},
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
    } catch (e) {
      setSave({ status: "error", msg: String(e) });
    }
  };

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

  // Keyboard: ⌘S save · Esc disarm brush/selection · Delete removes selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, dirty]);

  const selected = useMemo(() => {
    if (!bundle || !selection) return null;
    if (selection.kind === "enemy") return bundle.entities[selection.index];
    if (selection.kind === "item") return bundle.items[selection.index];
    if (selection.kind === "trigger") return bundle.triggers[selection.index];
    return null;
  }, [bundle, selection]);

  if (err) return <div className="detail-error" style={{ padding: 16 }}>Could not render level: {err}</div>;
  if (!bundle) return <p style={{ padding: 16 }}>Rendering level…</p>;

  const isDraft = !bundle.display_name && !bundle.parent_level;
  const chip = (label: string, tone?: string, key?: string) => (
    <span
      key={key ?? label}
      style={{
        display: "inline-block",
        fontSize: 12,
        fontFamily: "var(--font-mono, monospace)",
        background: "var(--surface-2, #2a2136)",
        border: `1px solid ${tone ?? "var(--border, #3a2f4a)"}`,
        borderRadius: 6,
        padding: "1px 8px",
        marginRight: 6,
        color: tone ?? "var(--text-2, #d9cfe8)",
      }}
    >
      {label}
    </span>
  );
  const btn = (label: string, onClick: () => void, accent = false): React.ReactNode => (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: "3px 12px",
        borderRadius: 7,
        cursor: "pointer",
        border: "1px solid var(--border, #3a2f4a)",
        background: accent ? "var(--accent, #e2b714)" : "var(--surface-2, #2a2136)",
        color: accent ? "#1a1208" : "var(--text-2, #d9cfe8)",
        fontWeight: accent ? 600 : 400,
        marginLeft: 8,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        {chip(bundle.display_name ?? bundle.level_id)}
        {isDraft && chip("draft — not in world", "#e0a15a")}
        {bundle.parent_level && chip(`secret room of ${bundle.parent_level}`, "#a78bfa")}
        {chip(`${bundle.entities.length} enemies`)}
        {chip(`${bundle.items.length} items`)}
        {dirty.size > 0 && chip(`unsaved: ${[...dirty].join(" ")}`, "#e2b714", "dirty")}
        {save.status === "saved" && dirty.size === 0 && chip("saved ✓", "#3ddc84")}
        {save.status === "error" && chip(`save failed: ${save.msg?.slice(0, 60)}`, "#e0453a")}
        <span style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", border: "1px solid var(--border, #3a2f4a)", borderRadius: 7, overflow: "hidden" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                fontSize: 12,
                padding: "3px 11px",
                border: "none",
                cursor: "pointer",
                background: mode === m.id ? "var(--accent, #e2b714)" : "transparent",
                color: mode === m.id ? "#1a1208" : "var(--text-2, #d9cfe8)",
                fontWeight: mode === m.id ? 600 : 400,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label style={{ fontSize: 12, margin: "0 6px 0 10px", userSelect: "none" }}>
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> grid
        </label>
        <label style={{ fontSize: 12, userSelect: "none" }}>
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> labels
        </label>
        {btn(save.status === "saving" ? "Saving…" : "Save", () => void doSave(), dirty.size > 0)}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <PaletteRail bundle={bundle} brush={brush} onBrush={setBrush} onReplaceArt={replaceArt} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <LevelCanvas
            bundle={bundle}
            scale={26}
            mode={mode}
            showGrid={showGrid}
            showLabels={showLabels}
            selection={selection}
            brush={brush}
            painted={painted}
            onSelect={setSelection}
            onMove={onMove}
            onCommit={onCommit}
            onPaint={onPaint}
            onPlace={onPlace}
            onErase={onErase}
          />
          <div style={{ margin: "10px 2px 0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <p style={{ margin: 0, color: "var(--text-3, #8a8398)", fontSize: 12, flex: 1, minWidth: 260 }}>
              {brush
                ? "Brush armed: click/drag the canvas · Esc to disarm."
                : "Click to select · drag to move · Delete removes · drag space/scroll pans · ⌘S saves."}
            </p>
            <label style={{ fontSize: 12, color: "var(--text-3, #8a8398)" }}>
              W{" "}
              <input
                type="number"
                value={resizeW}
                min={8}
                onChange={(e) => setResizeW(parseInt(e.target.value || "0", 10))}
                style={{ width: 58 }}
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--text-3, #8a8398)" }}>
              H{" "}
              <input
                type="number"
                value={resizeH}
                min={8}
                onChange={(e) => setResizeH(parseInt(e.target.value || "0", 10))}
                style={{ width: 58 }}
              />
            </label>
            {btn("Resize", () => applyResize(resizeW, resizeH))}
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
        </div>

        {selection && (
          <aside
            style={{
              width: 250,
              flexShrink: 0,
              background: "var(--surface-1, #1a1420)",
              border: "1px solid var(--border, #3a2f4a)",
              borderRadius: 10,
              padding: 14,
              fontSize: 13,
            }}
          >
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
            />
          </aside>
        )}
      </div>
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
}) {
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
      <span style={{ color: "var(--text-3, #8a8398)" }}>{k}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)", textAlign: "right" }}>{v}</span>
    </div>
  );
  const actionBtn = (label: string, onClick: () => void, danger = false) => (
    <button
      onClick={onClick}
      style={{
        background: "var(--surface-2, #2a2136)",
        border: `1px solid ${danger ? "#e0453a" : "var(--border, #3a2f4a)"}`,
        borderRadius: 6,
        color: danger ? "#e0453a" : "var(--accent, #e2b714)",
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
      <span style={{ color: "var(--text-3, #8a8398)", fontSize: 12 }}>switch to</span>
      <select
        value=""
        onChange={(e) => e.target.value && onSwitch(e.target.value)}
        style={{ flex: 1, fontSize: 12 }}
      >
        <option value="">choose…</option>
        {ids.filter((id) => id !== current).map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>
    </div>
  );

  if (selection.kind === "enemy") {
    const e = selected as LevelBundle["entities"][number];
    return (
      <div>
        <Header title={e.name} sub="enemy placement" sprite={e.sprite_path_abs} color={e.placeholder_color} />
        {row("enemy", e.enemy_id)}
        {row("variant", e.variant ?? "—")}
        {row("size", `${e.size}`)}
        {row("cell", `${e.x}, ${e.y}`)}
        {switcher(e.enemy_id, enemyIds)}
        {actionBtn("replace sprite…", () => onReplaceArt(`enemy:${e.enemy_id}`))}
        {actionBtn("open enemy →", () => onOpenEntity("enemies", e.enemy_id))}
        {actionBtn("delete", onDelete, true)}
      </div>
    );
  }
  if (selection.kind === "item") {
    const it = selected as LevelBundle["items"][number];
    return (
      <div>
        <Header title={it.name} sub="item placement" sprite={it.sprite_path_abs} color={it.placeholder_color} />
        {row("item", it.item_id)}
        {row("kind", it.kind ?? "—")}
        {row("source", it.source ?? "—")}
        {row("cell", `${it.x}, ${it.y}`)}
        {switcher(it.item_id, itemIds)}
        {actionBtn("replace sprite…", () => onReplaceArt(`item:${it.item_id}`))}
        {actionBtn("open item →", () => onOpenEntity("items", it.item_id))}
        {actionBtn("delete", onDelete, true)}
      </div>
    );
  }
  if (selection.kind === "trigger") {
    const t = selected as LevelBundle["triggers"][number];
    const room = (t.params?.room_id as string | undefined) ?? null;
    return (
      <div>
        <Header title={t.type === "room_entrance" ? "door" : t.type} sub="trigger" />
        {row("type", t.type)}
        {row("cell", `${t.x}, ${t.y}`)}
        {room && row("room", room)}
        {t.params?.verb ? row("verb", String(t.params.verb)) : null}
        {deletable && t.type === "checkpoint" && actionBtn("delete", onDelete, true)}
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

function Header({ title, sub, sprite, color }: { title: string; sub: string; sprite?: string | null; color?: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: color ?? "var(--surface-2, #2a2136)",
          border: "1px solid var(--border, #3a2f4a)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {sprite && <img src={sprite} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "pixelated" }} />}
      </div>
      <div>
        <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{title}</div>
        <div style={{ color: "var(--text-3, #8a8398)", fontSize: 11 }}>{sub}</div>
      </div>
    </div>
  );
}
