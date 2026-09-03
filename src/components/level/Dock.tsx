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
//
// A dungeon ROOM uses the same three panes with tabs built from `pack info`'s
// placements (NPCs / Events / Items — P0 paper P.3.2). Row P0-5 listed what
// the bundle PLACES, view-only; row P0-8 made them PALETTES: each tab lists
// the pack's own rows of that kind and arming one paints it onto a cell, plus
//
//   • a Tiles tab with the maze cell palette — two swatches, `empty` (the
//     eraser carves) and `wall`, coloured from the tile registry the export
//     synthesised (P.9 G1/G2);
//   • a Monsters tab (P.9 G4): a monster is not a placement, so dropping one
//     builds or targets the combat ENCOUNTER on that cell.
//
// The `Placed` tab keeps P0-5's view of what is on the room right now, so
// selecting an entry still highlights it and opens its row in the tray.

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../../lib/invoke";
import type { PlacementTab } from "../../lib/placements";
import { useStore } from "../../store";
import {
  SEL_KIND_BY_WIRE,
  tileColor,
  type Brush,
  type LevelBundle,
  type Selection,
} from "./drawLevel";

type DbEntry = { id: string; name: string; spriteUrl: string | null; color: string };

/** enemy/item rows with resolved sprite URLs. `convertFileSrc` is required —
 *  a native <img src="/abs/path.png"> never loads and silently degrades to a
 *  colour block. `enabled=false` skips the fetch — a room's tabs list the
 *  bundle's own placements, and the pack has no `enemies` type to ask for. */
function useDbEntries(typeId: "enemies" | "items", enabled = true): DbEntry[] {
  const worldPath = useStore((s) => s.worldPath);
  const [entries, setEntries] = useState<DbEntry[]>([]);
  useEffect(() => {
    if (!enabled) return;
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
              ((data.stats as Record<string, unknown> | undefined)?.placeholder_color as string) ??
              "#ff00ff",
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
  }, [worldPath, typeId, enabled]);
  return entries;
}

/** A tab id is the platformer's literal palette tab or a placement KEY from
 *  `pack info` (`npc_positions`) — open data, not a union. */
type TabId = string;

/** What one placement tab lists: the bundle's records on that wire, with the
 *  display facts the strip needs. */
function placedEntries(bundle: LevelBundle, wire: string): DbEntry[] {
  if (wire === "entities")
    return bundle.entities.map((e) => ({
      id: e.enemy_id,
      name: e.name,
      spriteUrl: e.sprite_path_abs,
      color: e.placeholder_color,
    }));
  if (wire === "items")
    return bundle.items.map((it) => ({
      id: it.item_id,
      name: it.name,
      spriteUrl: it.sprite_path_abs,
      color: it.placeholder_color,
    }));
  if (wire === "triggers")
    return bundle.triggers.map((t) => ({
      id: String(t.params?.event_id ?? t.type),
      name: `${t.type}${t.params?.is_gate ? " · gate" : ""}`,
      spriteUrl: null,
      color: bundle.tileset.palette.event ?? "#c084fc",
    }));
  return [];
}

export function Dock({
  bundle,
  brush,
  onBrush,
  onReplaceArt,
  tray,
  room,
  placements,
  rows,
  monsterTypeId,
  selection,
  onSelect,
}: {
  bundle: LevelBundle;
  brush: Brush | null;
  onBrush: (b: Brush | null) => void;
  onReplaceArt?: (target: string) => void;
  /** Contextual pane on the right — the selection inspector when something is
   *  selected. The dock owns the frame; the caller owns the content. */
  tray?: React.ReactNode;
  /** This grid is a dungeon room: the tabs come from `placements` + `rows`. */
  room?: boolean;
  /** Tabs from `pack info`'s `grids.<kind>.placements`, in registry order. */
  placements?: PlacementTab[];
  /** The pack's own rows per cradle type id — what each room palette lists.
   *  Absent (or empty) leaves a tab saying so, never a platformer fallback. */
  rows?: Record<string, Record<string, { name: string; kind: string | null }>>;
  /** The roster the Monsters tab lists (P.9 G4); null = no such kind. */
  monsterTypeId?: string | null;
  selection?: Selection | null;
  onSelect?: (sel: Selection | null) => void;
}) {
  const fromPack = !!placements?.length;
  // A room never asks for the platformer's enemies/items DBs — it lists its
  // own kinds through `rows` (fetched once by the level detail).
  const enemies = useDbEntries("enemies", !room && !fromPack);
  const items = useDbEntries("items", !room && !fromPack);
  const collapsed = useStore((s) => s.layout.inspectorCollapsed);
  const [tab, setTab] = useState<TabId>(fromPack ? "tiles" : "tiles");
  const [variant, setVariant] = useState<string | null>(null);
  const [source, setSource] = useState<string>("trail");
  const placementTab = placements?.find((p) => p.key === tab) ?? null;

  // Paintable tile types: skip empty (that's the eraser) and container/box
  // tiles (boxes exist through item placements, not raw tiles).
  const tiles = Object.values(bundle.tiles_by_type)
    .filter((s) => s.name !== "empty" && !(s.params ?? {}).container)
    .sort((a, b) => a.tile_type - b.tile_type);

  const toggle = (b: Brush) => {
    const same = JSON.stringify(brush) === JSON.stringify(b);
    onBrush(same ? null : b);
  };

  /** The brush one room row arms, by the WIRE the registry put it on (P.9
   *  G9: `entities` / `items` / `triggers` are the shared bundle's literal
   *  list names — the kind behind them is the pack's). */
  const roomBrush = (wire: string, id: string, kind: string | null): Brush => {
    if (wire === "items") return { kind: "item", itemId: id, source: "" };
    if (wire === "triggers") return { kind: "event", eventId: id, eventType: kind ?? "event" };
    return { kind: "enemy", enemyId: id, variant: null };
  };
  const roomColor = (wire: string): string =>
    wire === "items"
      ? "#ffd700"
      : wire === "triggers"
        ? String(bundle.tileset.palette.event ?? "#c084fc")
        : "#7a8b99";

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

  /** How many rows a room palette offers (its DB), vs how many are placed. */
  const roomRows = (typeId: string) => Object.entries(rows?.[typeId] ?? {});
  const counts: Record<TabId, number> = fromPack
    ? {
        tiles: tiles.length,
        ...Object.fromEntries(placements!.map((p) => [p.key, roomRows(p.typeId).length])),
        ...(monsterTypeId ? { monsters: roomRows(monsterTypeId).length } : {}),
        placed: bundle.entities.length + bundle.items.length + bundle.triggers.length,
      }
    : room
      ? {}
      : {
          tiles: tiles.length,
          enemies: enemies.length,
          items: items.length,
          play: 2,
        };
  const TABS: { id: TabId; label: string }[] = fromPack
    ? [
        { id: "tiles", label: "Tiles" },
        ...placements!.map((p) => ({ id: p.key, label: p.label })),
        ...(monsterTypeId ? [{ id: "monsters", label: "Monsters" }] : []),
        { id: "placed", label: "Placed" },
      ]
    : room
      ? // A room with no pack info has nothing honest to offer — the strip
        // says where the tabs come from rather than falling back to the
        // platformer palette (doctrine 4).
        []
      : [
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
    const placed = bundle.grids.collision.flat().filter((t) => t === brush.tileType).length;
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
  } else if (brush?.kind === "event") {
    armedName =
      rows?.[placements?.find((p) => p.kind === "event")?.typeId ?? ""]?.[brush.eventId]?.name ??
      brush.eventId;
    armedSub = `event · ${brush.eventType}`;
    armedColor = bundle.tileset.palette.event ?? "#c084fc";
  } else if (brush?.kind === "monster") {
    armedName = rows?.[monsterTypeId ?? ""]?.[brush.monsterId]?.name ?? brush.monsterId;
    armedSub = "monster · drops into the encounter on that cell";
    armedColor = "#b04a4a";
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
            <>Click selects · drag moves · R-click erases</>
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
            {room && !fromPack && (
              <span style={{ fontSize: 11, color: "var(--fg-dim)", alignSelf: "center" }}>
                no pack info — tabs come from <span className="kbd">canon pack info</span>
              </span>
            )}
          </div>
          <span style={{ flex: 1 }} />
          {placementTab?.wire === "entities" && (
            <span
              className="chip"
              aria-disabled="true"
              title="variants — none for rooms; the engine has no NPC variant vocabulary"
              style={{ opacity: 0.45, cursor: "default" }}
            >
              variants
            </span>
          )}
          {!fromPack && tab === "enemies" && (
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
          {!fromPack && tab === "items" && (
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

        {placementTab && (
          <div className="strip" role="list" aria-label={placementTab.label}>
            {roomRows(placementTab.typeId).map(([id, info]) => {
              const armed =
                (brush?.kind === "enemy" && brush.enemyId === id) ||
                (brush?.kind === "item" && brush.itemId === id) ||
                (brush?.kind === "event" && brush.eventId === id);
              return (
                <Brushly
                  key={id}
                  on={armed}
                  onClick={() => toggle(roomBrush(placementTab.wire, id, info.kind))}
                  label={info.name}
                  color={roomColor(placementTab.wire)}
                  id={id}
                  title={`${placementTab.kind} ${id} · arm to place`}
                />
              );
            })}
            {roomRows(placementTab.typeId).length === 0 && (
              <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                no {placementTab.label.toLowerCase()} rows in this pack yet — make one on its table
              </span>
            )}
          </div>
        )}
        {fromPack && tab === "monsters" && monsterTypeId && (
          <div className="strip" role="list" aria-label="Monsters">
            {roomRows(monsterTypeId).map(([id, info]) => (
              <Brushly
                key={id}
                on={brush?.kind === "monster" && brush.monsterId === id}
                onClick={() => toggle({ kind: "monster", monsterId: id })}
                label={info.name}
                color="#b04a4a"
                id={id}
                title={`monster ${id} · drop it on a cell to build or join the encounter there`}
              />
            ))}
            {roomRows(monsterTypeId).length === 0 && (
              <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                no monster rows in this pack yet
              </span>
            )}
          </div>
        )}
        {fromPack && tab === "placed" && (
          <div className="strip" role="list" aria-label="Placed">
            {(placements ?? []).flatMap((p) =>
              placedEntries(bundle, p.wire).map((e, index) => {
                const kind = SEL_KIND_BY_WIRE[p.wire];
                const on = !!selection && selection.kind === kind && selection.index === index;
                return (
                  <Brushly
                    key={`${p.wire}:${e.id}:${index}`}
                    on={on}
                    onClick={() => onSelect?.(on ? null : { kind, index })}
                    label={e.name}
                    color={e.color}
                    img={e.spriteUrl}
                    id={e.id}
                    title={`${p.kind} ${e.id} · click to inspect`}
                  />
                );
              }),
            )}
            {counts.placed === 0 && (
              <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                nothing placed on this room
              </span>
            )}
          </div>
        )}
        {tab === "tiles" && TABS.some((t) => t.id === "tiles") && (
          <div className="strip" role="list" aria-label="Tiles">
            {tiles.map((s) => (
              <Brushly
                key={s.tile_type}
                on={brush?.kind === "tile" && brush.tileType === s.tile_type}
                onClick={() => toggle({ kind: "tile", tileType: s.tile_type })}
                label={s.name}
                color={tileColor(bundle, s.tile_type) ?? "#555"}
                id={s.tile_type}
                title={`${s.name} · collision: ${s.collision}`}
                art={fromPack ? undefined : `tile:${bundle.stage_id}/${s.name}`}
              />
            ))}
            {/* The maze cell palette is two swatches (P.9 G1): `wall` above,
                and `empty` as the eraser that carves it back open. */}
            {fromPack && (
              <Brushly
                on={brush?.kind === "eraser"}
                onClick={() => toggle({ kind: "eraser" })}
                label="empty"
                color={String(bundle.tileset.palette.background ?? "var(--bg-hover)")}
                id={0}
                title="empty · carves the cell open, and clears a placement standing on it"
              />
            )}
          </div>
        )}
        {!fromPack && tab === "enemies" && (
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
        {!fromPack && tab === "items" && (
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
        {!fromPack && tab === "play" && (
          <div className="strip">
            <Brushly
              on={brush?.kind === "checkpoint"}
              onClick={() => toggle({ kind: "checkpoint" })}
              label="checkpoint"
              color="var(--special)"
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

      {/* The tray is this screen's right-hand panel, so it answers the same
          collapse toggle (and ⌘I) the world map's inspector does. */}
      {!collapsed && (
        <div className="pane tray">
          {tray ?? (
            <div className="dock-tray-empty">
              <div className="dock-sect">Nothing selected</div>
              <p>
                {room
                  ? "Arm a swatch to paint the maze or place a row, or click something on the canvas to inspect it. Dropping a monster builds (or joins) the encounter on that cell."
                  : "Click a placement on the canvas to inspect it, or arm a brush to paint. Tile types are the physics vocabulary — art is a skin bound to them, swappable per level."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
