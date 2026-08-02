// The level editor's bottom dock — the design's three-pane tray, replacing the
// tall left-hand PaletteRail.
//
//   [ armed brush 218px ][ tabs + scrolling swatch strip (flex) ][ tray 372px ]
//
// The palette content is the SAME data the rail showed (tiles from the pack's
// type registry, enemies/items from their DBs, gameplay markers) — it is the
// LAYOUT that changes: horizontal strip under the canvas instead of a column
// beside it, so the canvas gets the full width it wants.
//
// Type and asset stay separate concerns throughout, per the design: `breakable`
// is the TYPE and its art is a skin bound to it.

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";
import { tileColor, type Brush, type LevelBundle } from "./drawLevel";

type DbEntry = { id: string; name: string; spriteUrl: string | null; color: string };

/** enemy/item rows with resolved sprite URLs. `convertFileSrc` is required —
 *  a native <img src="/abs/path.png"> never loads and silently degrades to a
 *  colour block. */
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
              const resolved = await api.resolveAsset(worldPath, sprite);
              if (resolved) spriteUrl = convertFileSrc(resolved);
            } catch {
              /* fall back to the colour block */
            }
          }
          out.push({
            id: row.id,
            name: (data.name as string) ?? row.id,
            spriteUrl,
            color:
              ((data.stats as Record<string, unknown> | undefined)
                ?.placeholder_color as string) ?? "#ff00ff",
          });
        }
        if (alive) setEntries(out);
      } catch {
        /* leave empty — the tab shows a count of 0 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [worldPath, typeId]);
  return entries;
}

type TabId = "tiles" | "enemies" | "items" | "play";

export function Dock({
  bundle,
  brush,
  onBrush,
  onReplaceArt,
  tray,
}: {
  bundle: LevelBundle;
  brush: Brush | null;
  onBrush: (b: Brush | null) => void;
  onReplaceArt?: (target: string) => void;
  /** Contextual pane on the right — the selection inspector when something is
   *  selected. The dock owns the frame; the caller owns the content. */
  tray?: React.ReactNode;
}) {
  const enemies = useDbEntries("enemies");
  const items = useDbEntries("items");
  const [tab, setTab] = useState<TabId>("tiles");
  const [variant, setVariant] = useState<string | null>(null);
  const [source, setSource] = useState<string>("trail");

  // Paintable tile types: skip empty (that's the eraser) and container/box
  // tiles (boxes exist through item placements, not raw tiles).
  const tiles = Object.values(bundle.tiles_by_type)
    .filter((s) => s.name !== "empty" && !(s.params ?? {}).container)
    .sort((a, b) => a.tile_type - b.tile_type);

  const toggle = (b: Brush) => {
    const same = JSON.stringify(brush) === JSON.stringify(b);
    onBrush(same ? null : b);
  };

  /** One 38px swatch + 60px caption + mono id badge, per the design. */
  const Brushly = ({
    on,
    onClick,
    label,
    color,
    img,
    id,
    title,
    art,
  }: {
    on: boolean;
    onClick: () => void;
    label: string;
    color?: string;
    img?: string | null;
    id?: string | number;
    title?: string;
    art?: string;
  }) => (
    <div className="brush" title={title} onClick={onClick}>
      <div
        className={on ? "sw on" : "sw"}
        style={{
          backgroundColor: img ? undefined : color,
          backgroundImage: img ? `url(${img})` : undefined,
        }}
      >
        {id !== undefined && <span className="sw-id">{id}</span>}
        {art && onReplaceArt && (
          <span
            className="sw-art"
            title="Replace art (PNG)…"
            onClick={(e) => {
              e.stopPropagation();
              onReplaceArt(art);
            }}
          >
            🖌
          </span>
        )}
      </div>
      <div className="brush-nm">{label}</div>
    </div>
  );

  const counts: Record<TabId, number> = {
    tiles: tiles.length,
    enemies: enemies.length,
    items: items.length,
    play: 2,
  };
  const TABS: { id: TabId; label: string }[] = [
    { id: "tiles", label: "Tiles" },
    { id: "enemies", label: "Enemies" },
    { id: "items", label: "Items" },
    { id: "play", label: "Gameplay" },
  ];

  // --- armed-brush summary -------------------------------------------------
  let armedName = "Nothing armed";
  let armedSub = "Pick a tile, enemy or item below";
  let armedColor: string | undefined = "var(--bg-hover)";
  let armedImg: string | null | undefined;
  if (brush?.kind === "tile") {
    const slot = bundle.tiles_by_type[String(brush.tileType)];
    const placed = bundle.grids.collision
      .flat()
      .filter((t) => t === brush.tileType).length;
    armedName = slot?.name ?? `type ${brush.tileType}`;
    armedSub = `tile · id ${brush.tileType} · ${placed} placed`;
    armedColor = tileColor(bundle, brush.tileType) ?? "var(--bg-hover)";
  } else if (brush?.kind === "enemy") {
    const e = enemies.find((x) => x.id === brush.enemyId);
    armedName = e?.name ?? brush.enemyId;
    armedSub = `enemy${brush.variant ? ` · ${brush.variant}` : ""}`;
    armedColor = e?.color;
    armedImg = e?.spriteUrl;
  } else if (brush?.kind === "item") {
    const i = items.find((x) => x.id === brush.itemId);
    armedName = i?.name ?? brush.itemId;
    armedSub = `item · ${brush.source}`;
    armedColor = i?.color;
    armedImg = i?.spriteUrl;
  } else if (brush?.kind === "checkpoint") {
    armedName = "checkpoint";
    armedSub = "gameplay marker";
  } else if (brush?.kind === "eraser") {
    armedName = "eraser";
    armedSub = "removes placements, then tiles";
  }

  return (
    <div className="dock">
      <div className="pane armed">
        <div className="dock-sect">Armed brush</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            className={brush ? "sw on" : "sw"}
            style={{
              width: 46,
              height: 46,
              backgroundColor: armedImg ? undefined : armedColor,
              backgroundImage: armedImg ? `url(${armedImg})` : undefined,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{armedName}</div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--fg-dim)",
              }}
            >
              {armedSub}
            </div>
          </div>
        </div>
        <div className="dock-hint">
          {brush ? (
            <>
              L-click paints · R-click erases · <span className="kbd">Esc</span> disarms
            </>
          ) : (
            <>
              Click selects · drag moves · R-click erases
            </>
          )}
        </div>
      </div>

      <div className="pane mid">
        <div className="dock-tabs-row">
          <div className="dock-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "dtab on" : "dtab"}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                <span className="c">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {tab === "enemies" && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[null, ...(bundle.variants ?? [])].map((v) => (
                <span
                  key={v ?? "normal"}
                  className={variant === v ? "chip on" : "chip"}
                  style={{ cursor: "pointer" }}
                  onClick={() => setVariant(v)}
                >
                  {v ?? "normal"}
                </span>
              ))}
            </div>
          )}
          {tab === "items" && (
            <div style={{ display: "flex", gap: 5 }}>
              {["trail", "reward", "box"].map((s) => (
                <span
                  key={s}
                  className={source === s ? "chip on" : "chip"}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSource(s)}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        {tab === "tiles" && (
          <div className="strip">
            {tiles.map((s) => (
              <Brushly
                key={s.tile_type}
                on={brush?.kind === "tile" && brush.tileType === s.tile_type}
                onClick={() => toggle({ kind: "tile", tileType: s.tile_type })}
                label={s.name}
                color={tileColor(bundle, s.tile_type) ?? "#555"}
                id={s.tile_type}
                title={`${s.name} · collision: ${s.collision}`}
                art={`tile:${bundle.stage_id}/${s.name}`}
              />
            ))}
          </div>
        )}
        {tab === "enemies" && (
          <div className="strip">
            {enemies.map((e) => (
              <Brushly
                key={e.id}
                on={brush?.kind === "enemy" && brush.enemyId === e.id}
                onClick={() => toggle({ kind: "enemy", enemyId: e.id, variant })}
                label={e.name}
                color={e.color}
                img={e.spriteUrl}
                title={e.id}
                art={`enemy:${e.id}`}
              />
            ))}
          </div>
        )}
        {tab === "items" && (
          <div className="strip">
            {items.map((i) => (
              <Brushly
                key={i.id}
                on={brush?.kind === "item" && brush.itemId === i.id}
                onClick={() => toggle({ kind: "item", itemId: i.id, source })}
                label={i.name}
                color={i.color}
                img={i.spriteUrl}
                title={i.id}
                art={`item:${i.id}`}
              />
            ))}
          </div>
        )}
        {tab === "play" && (
          <div className="strip">
            <Brushly
              on={brush?.kind === "checkpoint"}
              onClick={() => toggle({ kind: "checkpoint" })}
              label="checkpoint"
              color="#4ec9b0"
            />
            <Brushly
              on={brush?.kind === "eraser"}
              onClick={() => toggle({ kind: "eraser" })}
              label="eraser"
              color="var(--bg-hover)"
            />
          </div>
        )}
      </div>

      <div className="pane tray">
        {tray ?? (
          <div className="dock-tray-empty">
            <div className="dock-sect">Nothing selected</div>
            <p>
              Click a placement on the canvas to inspect it, or arm a brush to
              paint. Tile types are the physics vocabulary — art is a skin bound
              to them, swappable per level.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
