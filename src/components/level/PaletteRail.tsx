// The editor palette: everything placeable, sourced from the pack's own
// databases. Tiles are canon's TILE TYPES (id + name + block color — the
// physics vocabulary; art is a skin on top), enemies/items come from the
// enemy/ and item/ DBs with their sprites. Click to arm a brush; Esc or
// clicking the entry again disarms.

import { useEffect, useState } from "react";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";
import { tileColor, type Brush, type LevelBundle } from "./drawLevel";

interface PaletteRailProps {
  bundle: LevelBundle;
  brush: Brush | null;
  onBrush: (b: Brush | null) => void;
  onReplaceArt?: (target: string) => void;
}

type DbEntry = { id: string; name: string; spriteUrl: string | null; color: string };

function useDbEntries(typeId: "enemies" | "items"): DbEntry[] {
  const worldPath = useStore((s) => s.worldPath);
  const [entries, setEntries] = useState<DbEntry[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await api.listEntityRows(worldPath, typeId);
        const out: DbEntry[] = [];
        for (const row of rows) {
          const data = row.data ?? {};
          const sprite = data.sprite_path as string | undefined;
          let spriteUrl: string | null = null;
          if (sprite) {
            try {
              spriteUrl = await api.resolveAsset(worldPath, sprite);
            } catch {}
          }
          out.push({
            id: row.id,
            name: (data.name as string) ?? row.id,
            spriteUrl,
            color:
              ((data.stats as Record<string, unknown> | undefined)?.placeholder_color as string) ??
              "#888",
          });
        }
        if (alive) setEntries(out);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [worldPath, typeId]);
  return entries;
}

const SOURCES = ["trail", "reward", "box"];

export function PaletteRail({ bundle, brush, onBrush, onReplaceArt }: PaletteRailProps) {
  const enemies = useDbEntries("enemies");
  const items = useDbEntries("items");
  const [variant, setVariant] = useState<string | null>(null);
  const [source, setSource] = useState<string>("trail");

  // Paintable tile types: skip empty (that's the eraser) and container/box
  // tiles (boxes exist through item placements, not raw tiles).
  const tiles = Object.values(bundle.tiles_by_type)
    .filter((s) => s.name !== "empty" && !(s.params ?? {}).container)
    .sort((a, b) => a.tile_type - b.tile_type);

  const cell = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "3px 8px",
    borderRadius: 6,
    border: active ? "1px solid var(--accent, #e2b714)" : "1px solid transparent",
    background: active ? "rgba(226,183,20,0.12)" : "transparent",
    color: "var(--text-1, #e8e4ee)",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
  });
  const swatch = (color: string): React.CSSProperties => ({
    width: 18,
    height: 18,
    borderRadius: 4,
    background: color,
    border: "1px solid rgba(255,255,255,0.25)",
    flexShrink: 0,
  });
  const header: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "var(--text-3, #8a8398)",
    margin: "10px 0 4px",
  };

  const toggle = (b: Brush) => {
    const same = JSON.stringify(brush) === JSON.stringify(b);
    onBrush(same ? null : b);
  };

  // Tiny per-row "replace this asset's art" affordance (native file picker).
  const artBtn = (target: string) =>
    onReplaceArt ? (
      <span
        title="Replace art (PNG)…"
        onClick={(e) => {
          e.stopPropagation();
          onReplaceArt(target);
        }}
        style={{ opacity: 0.55, cursor: "pointer", fontSize: 11, padding: "0 2px" }}
      >
        🖌
      </span>
    ) : null;

  return (
    <aside
      style={{
        width: 190,
        flexShrink: 0,
        background: "var(--surface-1, #1a1420)",
        border: "1px solid var(--border, #3a2f4a)",
        borderRadius: 10,
        padding: "8px 10px",
        maxHeight: "min(68vh, 820px)",
        overflowY: "auto",
      }}
    >
      <div style={header}>Tiles · type ids</div>
      {tiles.map((slot) => {
        const active = brush?.kind === "tile" && brush.tileType === slot.tile_type;
        return (
          <button
            key={slot.tile_type}
            style={cell(active)}
            onClick={() => toggle({ kind: "tile", tileType: slot.tile_type })}
            title={`${slot.name} · collision: ${slot.collision}`}
          >
            <span style={swatch(tileColor(bundle, slot.tile_type) ?? "#555")} />
            <span style={{ flex: 1 }}>{slot.name}</span>
            <span style={{ color: "var(--text-3, #8a8398)", fontFamily: "monospace" }}>
              {slot.tile_type}
            </span>
            {artBtn(`tile:${bundle.stage_id}/${slot.name}`)}
          </button>
        );
      })}

      <div style={header}>Enemies</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
        {[null, ...(bundle.variants ?? [])].map((v) => (
          <button
            key={v ?? "normal"}
            onClick={() => {
              setVariant(v);
              if (brush?.kind === "enemy") onBrush({ ...brush, variant: v });
            }}
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 9,
              cursor: "pointer",
              border:
                variant === v
                  ? "1px solid var(--accent, #e2b714)"
                  : "1px solid var(--border, #3a2f4a)",
              background: variant === v ? "rgba(226,183,20,0.12)" : "transparent",
              color: "var(--text-2, #d9cfe8)",
            }}
          >
            {v ?? "normal"}
          </button>
        ))}
      </div>
      {enemies.map((e) => {
        const active = brush?.kind === "enemy" && brush.enemyId === e.id;
        return (
          <button
            key={e.id}
            style={cell(active)}
            onClick={() => toggle({ kind: "enemy", enemyId: e.id, variant })}
          >
            {e.spriteUrl ? (
              <img
                src={e.spriteUrl}
                alt=""
                style={{ width: 18, height: 18, objectFit: "contain", imageRendering: "pixelated" }}
              />
            ) : (
              <span style={swatch(e.color)} />
            )}
            <span style={{ flex: 1 }}>{e.name}</span>
            {artBtn(`enemy:${e.id}`)}
          </button>
        );
      })}

      <div style={header}>Items</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
        {SOURCES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setSource(s);
              if (brush?.kind === "item") onBrush({ ...brush, source: s });
            }}
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 9,
              cursor: "pointer",
              border:
                source === s ? "1px solid var(--accent, #e2b714)" : "1px solid var(--border, #3a2f4a)",
              background: source === s ? "rgba(226,183,20,0.12)" : "transparent",
              color: "var(--text-2, #d9cfe8)",
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {items.map((it) => {
        const active = brush?.kind === "item" && brush.itemId === it.id;
        return (
          <button
            key={it.id}
            style={cell(active)}
            onClick={() => toggle({ kind: "item", itemId: it.id, source })}
          >
            {it.spriteUrl ? (
              <img
                src={it.spriteUrl}
                alt=""
                style={{ width: 18, height: 18, objectFit: "contain", imageRendering: "pixelated" }}
              />
            ) : (
              <span style={swatch(it.color)} />
            )}
            <span style={{ flex: 1 }}>{it.name}</span>
            {artBtn(`item:${it.id}`)}
          </button>
        );
      })}

      <div style={header}>Gameplay</div>
      <button
        style={cell(brush?.kind === "checkpoint")}
        onClick={() => toggle({ kind: "checkpoint" })}
      >
        <span style={{ ...swatch("#e2b714"), borderRadius: 2 }} />
        <span style={{ flex: 1 }}>checkpoint</span>
      </button>
      <button style={cell(brush?.kind === "eraser")} onClick={() => toggle({ kind: "eraser" })}>
        <span style={{ ...swatch("transparent"), border: "1px dashed rgba(255,255,255,0.4)" }} />
        <span style={{ flex: 1 }}>eraser</span>
      </button>
    </aside>
  );
}
