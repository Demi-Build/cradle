import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useStore } from "../store";
import { api, type EntityRow } from "../lib/invoke";
import { Portrait } from "./Portrait";
import { RowEditor } from "./db/RowEditor";
import { Icon } from "./start/Icons";

type Row = EntityRow;

const COLUMN_CONFIG: Record<string, string[]> = {
  npcs: ["name", "type", "job", "environment_name", "is_story_npc"],
  items: ["name", "category", "room_level"],
  monsters: ["name", "species", "level", "is_boss", "elemental_affinity"],
  events: ["name", "type", "difficulty", "room_level"],
  quests: ["title", "type", "is_story_quest", "room_id"],
  classes: ["name", "archetype"],
  rooms: ["environment_name", "environment", "level"],
  music: ["name", "filename"],
  sfx: ["name", "filename"],
  // Platformer catalog — dotted keys reach nested fields, __keys are computed.
  enemies: [
    "name", "archetype", "size", "rarity", "stats.hp", "stats.damage",
    "stats.speed", "habitats", "behavior.patrol_range", "behavior.aggro_range",
    "review_status",
  ],
  levels: [
    "stage_id", "__dims", "__enemies", "__items", "layout_fallback", "status",
    "review_status",
  ],
  tilesets: ["stage_id", "__slots", "render_filter", "tilesheet_path"],
  backdrops: ["stage_id", "__bands", "depths"],
  audio: ["stage_id", "music_path", "__sfx"],
};

// Platformer items share the "items" type id with MazeWorld's — pick by shape.
const PLATFORMER_ITEM_COLUMNS = [
  "name", "kind", "rarity", "params.coin_value", "params.heal_amount",
  "params.duration_s", "params.boost_mult", "review_status",
];
const PLATFORMER_ITEM_SORTS: SortOption[] = [
  { id: "name", label: "Name", keys: ["name"] },
  { id: "kind-name", label: "Kind → Name", keys: ["kind", "name"], groupKey: "kind" },
  { id: "rarity-name", label: "Rarity → Name", keys: ["rarity", "name"], groupKey: "rarity" },
];
function isPlatformerItems(typeId: string, rows: Row[]): boolean {
  return typeId === "items" && !!rows[0]?.data && "item_id" in rows[0].data;
}

// Computed table fields (spreadsheet-style rollups of nested data).
const COMPUTED: Record<string, (row: Row) => string | number> = {
  __dims: (r) => `${r.data?.grid_width ?? "?"}×${r.data?.grid_height ?? "?"}`,
  __enemies: (r) => ((r.data?.entities as unknown[] | undefined) ?? []).length,
  __items: (r) => ((r.data?.items as unknown[] | undefined) ?? []).length,
  __slots: (r) => ((r.data?.slots as unknown[] | undefined) ?? []).length,
  __bands: (r) => ((r.data?.band_paths as unknown[] | undefined) ?? []).length,
  __sfx: (r) => Object.keys((r.data?.sfx_paths as object | undefined) ?? {}).length,
};

const PARTITION_FIELD: Record<string, string> = {
  items: "category",
  events: "type",
  quests: "type",
};

const SFX_CATEGORY_RE = /^(weapon|spell|ambience|item|door|player|dice|event)/;

// Sort options per type. `-field` means descending (booleans: true first).
// `groupKey` renders a section label before each group's cards.
type SortOption = {
  id: string;
  label: string;
  keys: string[];
  groupKey?: string;
};

const SORT_CONFIG: Record<string, SortOption[]> = {
  npcs: [
    { id: "name", label: "Name", keys: ["name"] },
    {
      id: "env-name",
      label: "Environment → Name",
      keys: ["environment_name", "name"],
      groupKey: "environment_name",
    },
    { id: "type-name", label: "Type → Name", keys: ["type", "name"], groupKey: "type" },
    { id: "story-first", label: "Story NPCs first", keys: ["-is_story_npc", "name"] },
    { id: "job-name", label: "Job → Name", keys: ["job", "name"] },
  ],
  items: [
    { id: "name", label: "Name", keys: ["name"] },
    { id: "cat-name", label: "Category → Name", keys: ["category", "name"], groupKey: "category" },
    {
      id: "level-name",
      label: "Room level → Name",
      keys: ["room_level", "name"],
      groupKey: "room_level",
    },
  ],
  monsters: [
    { id: "name", label: "Name", keys: ["name"] },
    { id: "boss-first", label: "Bosses first", keys: ["-is_boss", "name"] },
    { id: "species-name", label: "Species → Name", keys: ["species", "name"], groupKey: "species" },
    { id: "level-name", label: "Level → Name", keys: ["level", "name"], groupKey: "level" },
    {
      id: "element-name",
      label: "Element → Name",
      keys: ["elemental_affinity", "name"],
      groupKey: "elemental_affinity",
    },
  ],
  events: [
    { id: "name", label: "Name", keys: ["name"] },
    { id: "type-name", label: "Type → Name", keys: ["type", "name"], groupKey: "type" },
    {
      id: "diff-name",
      label: "Difficulty → Name",
      keys: ["difficulty", "name"],
      groupKey: "difficulty",
    },
    {
      id: "level-name",
      label: "Room level → Name",
      keys: ["room_level", "name"],
      groupKey: "room_level",
    },
  ],
  quests: [
    { id: "title", label: "Title", keys: ["title"] },
    { id: "type-title", label: "Type → Title", keys: ["type", "title"], groupKey: "type" },
    { id: "story-first", label: "Story quests first", keys: ["-is_story_quest", "title"] },
    { id: "room-title", label: "Room → Title", keys: ["room_id", "title"], groupKey: "room_id" },
  ],
  classes: [
    { id: "name", label: "Name", keys: ["name"] },
    {
      id: "archetype-name",
      label: "Archetype → Name",
      keys: ["archetype", "name"],
      groupKey: "archetype",
    },
  ],
  rooms: [
    { id: "id", label: "Room id", keys: ["id"] },
    { id: "env-name", label: "Environment name", keys: ["environment_name"] },
    {
      id: "env-group",
      label: "Environment → Id",
      keys: ["environment", "id"],
      groupKey: "environment",
    },
  ],
  music: [{ id: "name", label: "Name", keys: ["name"] }],
  sfx: [{ id: "name", label: "Name", keys: ["name"] }],
  enemies: [
    { id: "name", label: "Name", keys: ["name"] },
    { id: "arch-name", label: "Archetype → Name", keys: ["archetype", "name"], groupKey: "archetype" },
    { id: "rarity-name", label: "Rarity → Name", keys: ["rarity", "name"], groupKey: "rarity" },
    { id: "size-first", label: "Biggest first", keys: ["-size", "name"] },
  ],
  levels: [
    { id: "id", label: "Level id", keys: ["id"] },
    { id: "stage-id", label: "Stage → Id", keys: ["stage_id", "id"], groupKey: "stage_id" },
  ],
  tilesets: [{ id: "id", label: "Stage", keys: ["id"] }],
  backdrops: [{ id: "id", label: "Stage", keys: ["id"] }],
  audio: [{ id: "id", label: "Stage", keys: ["id"] }],
};

function labelFor(key: string): string {
  if (key.startsWith("__")) return key.slice(2);
  const leaf = key.includes(".") ? key.split(".").pop()! : key;
  return leaf.replace(/_/g, " ");
}

/** Raw cell value: dotted paths reach nested fields, __keys are computed,
 * primitive arrays join, numbers stay numeric (so sorting sorts). */
function cellRaw(row: Row, key: string): string | number {
  if (key.startsWith("__")) return COMPUTED[key]?.(row) ?? "";
  let v: unknown = row.data;
  for (const part of key.split(".")) {
    v = (v as Record<string, unknown> | undefined)?.[part];
  }
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return v;
  if (Array.isArray(v)) {
    return v.every((x) => typeof x !== "object") ? v.join(", ") : `[${v.length}]`;
  }
  if (typeof v === "object") return "{…}";
  return String(v);
}


function portraitHintFor(typeId: string, row: Row): string | null {
  // First non-empty image-ish field (platformer entities carry sprite_path /
  // tilesheet_path; empty strings are canon's "no art yet", so skip them).
  const p = [
    row.data?.profile_image,
    row.data?.portrait_path,
    row.data?.sprite_path,
    row.data?.tilesheet_path,
  ].find((v): v is string => typeof v === "string" && v.length > 0);
  if (p) return p;
  if (typeId === "levels") {
    // Canon's review render is the level thumbnail.
    const stage = row.data?.stage_id as string | undefined;
    const lid = (row.data?.level_id as string | undefined) ?? row.id;
    if (stage) return `review/${stage}/${lid}.png`;
  }
  if (typeId === "backdrops") {
    const bands = row.data?.band_paths as string[] | undefined;
    if (bands?.length) return bands[bands.length - 1];
  }
  if (typeId === "rooms") {
    const m = /(\d+)$/.exec(row.id);
    if (m) return `environment_${m[1]}.png`;
  }
  return null;
}

function rowTitle(row: Row): string {
  const d = row.data ?? {};
  return (
    (typeof d.name === "string" && d.name) ||
    (typeof d.title === "string" && d.title) ||
    (typeof d.environment_name === "string" && d.environment_name) ||
    row.id
  );
}

function rowField(row: Row, key: string): unknown {
  if (key === "id") return row.id;
  return row.data?.[key];
}

function compareScalar(a: unknown, b: unknown): number {
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function sortRows(rows: Row[], keys: string[]): Row[] {
  const out = [...rows];
  out.sort((a, b) => {
    for (const rawKey of keys) {
      const desc = rawKey.startsWith("-");
      const key = desc ? rawKey.slice(1) : rawKey;
      const cmp = compareScalar(rowField(a, key), rowField(b, key));
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
  return out;
}

function groupValue(row: Row, key: string): string {
  const v = rowField(row, key);
  if (v === undefined || v === null || v === "") return "—";
  return String(v);
}

export function EntityTable({
  typeId,
  rows,
  initialPartition,
}: {
  typeId: string;
  rows: Row[];
  initialPartition?: string | null;
}) {
  const select = useStore((s) => s.select);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");
  const [newRowOpen, setNewRowOpen] = useState(false);
  const canCreateRow =
    typeId === "enemies" || isPlatformerItems(typeId, rows);
  const [partition, setPartition] = useState<string | null>(initialPartition ?? null);
  const [view, setView] = useState<"list" | "cards">(
    typeId === "music" || typeId === "sfx" ? "list" : "cards",
  );
  const sortOptions = isPlatformerItems(typeId, rows)
    ? PLATFORMER_ITEM_SORTS
    : (SORT_CONFIG[typeId] ?? [{ id: "id", label: "Id", keys: ["id"] }]);
  const [sortId, setSortId] = useState<string>(sortOptions[0]?.id ?? "id");
  const partitionKey = PARTITION_FIELD[typeId];

  const partitionCounts = useMemo(() => {
    if (typeId === "sfx") {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const m = SFX_CATEGORY_RE.exec(r.id);
        if (!m) continue;
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      }
      if (counts.size < 2) return null;
      return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    }
    if (!partitionKey) return null;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r.data?.[partitionKey];
      if (typeof v !== "string") continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (counts.size < 2) return null;
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows, partitionKey, typeId]);

  const filteredRows = useMemo(() => {
    if (!partition) return rows;
    if (typeId === "sfx") {
      return rows.filter((r) => {
        const m = SFX_CATEGORY_RE.exec(r.id);
        return m?.[1] === partition;
      });
    }
    if (!partitionKey) return rows;
    return rows.filter((r) => r.data?.[partitionKey] === partition);
  }, [rows, partition, partitionKey, typeId]);

  const activeSort = sortOptions.find((s) => s.id === sortId) ?? sortOptions[0];
  const sortedRows = useMemo(
    () => sortRows(filteredRows, activeSort?.keys ?? []),
    [filteredRows, activeSort],
  );

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const configured = isPlatformerItems(typeId, rows)
      ? PLATFORMER_ITEM_COLUMNS
      : (COLUMN_CONFIG[typeId] ?? []);
    const fallback = configured.length ? configured : deriveColumns(rows);
    const noPortraits = typeId === "music" || typeId === "sfx" || typeId === "audio";
    const cols: ColumnDef<Row>[] = [];
    if (!noPortraits) {
      cols.push({
        id: "portrait",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Portrait hint={portraitHintFor(typeId, row.original)} alt={row.original.id} size={40} />
        ),
      });
    }
    cols.push({
      id: "id",
      header: "id",
      accessorFn: (r) => r.id,
      cell: ({ getValue }) => <span className="cell-id">{String(getValue())}</span>,
    });
    for (const key of fallback) {
      cols.push({
        id: key,
        header: labelFor(key),
        // Raw values keep numbers numeric so header-click sorting is sane.
        accessorFn: (r) => cellRaw(r, key),
      });
    }
    return cols;
  }, [typeId, rows]);

  const table = useReactTable({
    data: sortedRows,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _id, value) => {
      const needle = String(value).toLowerCase();
      if (!needle) return true;
      if (row.original.id.toLowerCase().includes(needle)) return true;
      for (const v of Object.values(row.original.data ?? {})) {
        if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
        if (typeof v === "number" && String(v).includes(needle)) return true;
      }
      return false;
    },
  });

  // For card view, apply the same text filter as the table uses.
  const filteredForCards = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sortedRows;
    return sortedRows.filter((r) => {
      if (r.id.toLowerCase().includes(needle)) return true;
      for (const v of Object.values(r.data ?? {})) {
        if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
        if (typeof v === "number" && String(v).includes(needle)) return true;
      }
      return false;
    });
  }, [sortedRows, filter]);

  const grouped = useMemo(() => {
    if (!activeSort?.groupKey) return null;
    const key = activeSort.groupKey;
    const map = new Map<string, Row[]>();
    for (const r of filteredForCards) {
      const g = groupValue(r, key);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(r);
    }
    return Array.from(map.entries());
  }, [filteredForCards, activeSort]);

  const visibleCount =
    view === "cards" ? filteredForCards.length : table.getFilteredRowModel().rows.length;

  return (
    <div className="entity-table-wrap">
      {partitionCounts && (
        <div className="partition-chips">
          <button
            className={`partition-chip ${partition === null ? "active" : ""}`}
            onClick={() => setPartition(null)}
          >
            all <span className="partition-count">{rows.length}</span>
          </button>
          {partitionCounts.map(([value, count]) => (
            <button
              key={value}
              className={`partition-chip ${partition === value ? "active" : ""}`}
              onClick={() => setPartition(value)}
            >
              {value} <span className="partition-count">{count}</span>
            </button>
          ))}
        </div>
      )}
      {newRowOpen && (
        <RowEditor
          typeId={typeId}
          onClose={() => setNewRowOpen(false)}
          onCreated={(id) => select({ kind: "entity", typeId, id })}
        />
      )}
      <div className="entity-table-toolbar">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${filteredRows.length} ${partition ?? typeId}…`}
          className="entity-filter"
        />
        <span className="entity-table-count">
          {visibleCount} / {filteredRows.length}
          {partition ? ` (of ${rows.length} total)` : ""}
        </span>
        <span className="tb-spacer" />
        {canCreateRow && (
          <button
            className="view-toggle"
            title="New row (anchored generation)"
            onClick={() => setNewRowOpen(true)}
            style={{ cursor: "pointer" }}
          >
            ＋ new row
          </button>
        )}
        {sortOptions.length > 1 && (
          <label className="sort-inline">
            <span className="sort-inline-label">sort</span>
            <select
              className="sort-select"
              value={sortId}
              onChange={(e) => setSortId(e.target.value)}
            >
              {sortOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="view-toggle">
          <button
            className={view === "cards" ? "on" : ""}
            onClick={() => setView("cards")}
            title="Cards"
          >
            <Icon id="g-grid" size={14} />
          </button>
          <button
            className={view === "list" ? "on" : ""}
            onClick={() => setView("list")}
            title="List"
          >
            <Icon id="g-rows" size={14} />
          </button>
        </div>
      </div>

      {view === "list" && (
        <table className="entity-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sort = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      onClick={
                        header.column.getCanSort()
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                      className={header.column.getCanSort() ? "th-sortable" : ""}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sort === "asc" && " ▲"}
                      {sort === "desc" && " ▼"}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="entity-row"
                onClick={() => select({ kind: "entity", typeId, id: row.original.id })}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {view === "cards" && (
        <CardGrid
          rows={filteredForCards}
          grouped={grouped}
          typeId={typeId}
          onSelect={(id) => select({ kind: "entity", typeId, id })}
        />
      )}
    </div>
  );
}

function CardGrid({
  rows,
  grouped,
  typeId,
  onSelect,
}: {
  rows: Row[];
  grouped: Array<[string, Row[]]> | null;
  typeId: string;
  onSelect: (id: string) => void;
}) {
  if (grouped && grouped.length) {
    return (
      <div className="entity-cards-wrap">
        {grouped.map(([label, group]) => (
          <section key={label} className="entity-cards-group">
            <h3 className="entity-cards-group-label">
              {label} <span className="entity-cards-group-count">· {group.length}</span>
            </h3>
            <div className="entity-cards-grid">
              {group.map((r) => (
                <EntityPortraitCard
                  key={r.id}
                  row={r}
                  typeId={typeId}
                  onClick={() => onSelect(r.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }
  return (
    <div className="entity-cards-grid">
      {rows.map((r) => (
        <EntityPortraitCard key={r.id} row={r} typeId={typeId} onClick={() => onSelect(r.id)} />
      ))}
    </div>
  );
}

function EntityPortraitCard({
  row,
  typeId,
  onClick,
}: {
  row: Row;
  typeId: string;
  onClick: () => void;
}) {
  const title = rowTitle(row);
  const d = row.data ?? {};
  const subtitle = subtitleFor(typeId, d);
  const hint = portraitHintFor(typeId, row);
  return (
    <button className="entity-card" onClick={onClick} title={title}>
      <EntityCardImage hint={hint} />
      <div className="entity-card-overlay">
        <div className="entity-card-title">{title}</div>
        {subtitle && <div className="entity-card-sub">{subtitle}</div>}
      </div>
    </button>
  );
}

function EntityCardImage({ hint }: { hint: string | null }) {
  const worldPath = useStore((s) => s.worldPath);
  const [src, setSrc] = useState<string | null>(null);
  const [isSquare, setIsSquare] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(null);
    setIsSquare(false);
    setFailed(false);
    if (!hint || !worldPath) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resolved = await api.resolveAsset(worldPath, hint);
        if (cancelled) return;
        if (resolved) setSrc(convertFileSrc(resolved));
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hint, worldPath]);

  if (failed || !src) {
    return <div className="entity-card-missing">no image</div>;
  }
  return (
    <img
      src={src}
      className={`entity-card-img ${isSquare ? "is-square" : ""}`}
      alt=""
      loading="lazy"
      onLoad={(e) => {
        const img = e.currentTarget;
        const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
        setIsSquare(Math.abs(ratio - 1) < 0.02);
      }}
      onError={() => setFailed(true)}
    />
  );
}

function subtitleFor(typeId: string, d: Record<string, unknown>): string | null {
  const bits: string[] = [];
  switch (typeId) {
    case "npcs":
      if (typeof d.type === "string") bits.push(d.type);
      if (typeof d.environment_name === "string") bits.push(d.environment_name);
      if (d.is_story_npc) bits.push("story");
      break;
    case "items":
      if (typeof d.category === "string") bits.push(d.category);
      if (typeof d.room_level === "number") bits.push(`lvl ${d.room_level}`);
      break;
    case "monsters":
      if (typeof d.species === "string") bits.push(d.species);
      if (d.is_boss) bits.push("boss");
      if (typeof d.level === "number") bits.push(`lvl ${d.level}`);
      break;
    case "events":
      if (typeof d.type === "string") bits.push(d.type);
      if (typeof d.difficulty === "number") bits.push(`diff ${d.difficulty}`);
      break;
    case "quests":
      if (typeof d.type === "string") bits.push(d.type);
      if (d.is_story_quest) bits.push("story");
      break;
    case "classes":
      if (typeof d.archetype === "string") bits.push(d.archetype);
      break;
    case "rooms":
      if (typeof d.environment === "string") bits.push(d.environment);
      if (typeof d.level === "number") bits.push(`lvl ${d.level}`);
      break;
  }
  return bits.length ? bits.join(" · ") : null;
}

function deriveColumns(rows: Row[]): string[] {
  if (!rows.length) return [];
  const keys = new Set<string>();
  for (const row of rows.slice(0, 10)) {
    for (const [k, v] of Object.entries(row.data ?? {})) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        if (k === "profile_image" || k === "portrait_path" || k === "portrait_prompt") continue;
        keys.add(k);
      }
    }
  }
  return Array.from(keys).slice(0, 6);
}
