import { useMemo, useState } from "react";
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
import type { EntityRow } from "../lib/invoke";
import { Portrait } from "./Portrait";

type Row = EntityRow;

const COLUMN_CONFIG: Record<string, string[]> = {
  npcs: ["name", "type", "job", "environment_name", "is_story_npc"],
  items: ["name", "category", "room_level"],
  monsters: ["name", "species", "level", "is_boss", "elemental_affinity"],
  events: ["name", "type", "difficulty", "room_level"],
  quests: ["title", "type", "is_story_quest", "room_id"],
  classes: ["name", "archetype"],
  rooms: ["environment_name", "environment", "level"],
};

function labelFor(key: string): string {
  return key.replace(/_/g, " ");
}

function cellValue(row: Row, key: string): string {
  const v = row.data?.[key];
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return Array.isArray(v) ? `[${v.length}]` : "{…}";
  return String(v);
}

function portraitHintFor(typeId: string, row: Row): string | null {
  const p = (row.data?.profile_image as string | undefined) ?? (row.data?.portrait_path as string | undefined);
  if (p) return p;
  if (typeId === "rooms") return `${row.id}_map.png`;
  return null;
}

export function EntityTable({ typeId, rows }: { typeId: string; rows: Row[] }) {
  const select = useStore((s) => s.select);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const configured = COLUMN_CONFIG[typeId] ?? [];
    const fallback = configured.length
      ? configured
      : deriveColumns(rows);
    const cols: ColumnDef<Row>[] = [
      {
        id: "portrait",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Portrait
            hint={portraitHintFor(typeId, row.original)}
            alt={row.original.id}
            size={40}
          />
        ),
      },
      {
        id: "id",
        header: "id",
        accessorFn: (r) => r.id,
        cell: ({ getValue }) => <span className="cell-id">{String(getValue())}</span>,
      },
    ];
    for (const key of fallback) {
      cols.push({
        id: key,
        header: labelFor(key),
        accessorFn: (r) => cellValue(r, key),
      });
    }
    return cols;
  }, [typeId, rows]);

  const table = useReactTable({
    data: rows,
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

  return (
    <div className="entity-table-wrap">
      <div className="entity-table-toolbar">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${rows.length} ${typeId}…`}
          className="entity-filter"
        />
        <span className="entity-table-count">
          {table.getFilteredRowModel().rows.length} / {rows.length}
        </span>
      </div>
      <table className="entity-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const sort = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
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
    </div>
  );
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
