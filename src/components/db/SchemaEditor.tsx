// Roll-table editor: the pack's field-spec schema (`canon db schema`) as an
// editable form — weighted choices, ranges, and dependency lookups. Saving
// sends ONLY touched fields; canon validates fail-closed (loader + lookup
// coverage + smoke roll) and lands the result as a PACK-LOCAL override, so
// the repo default is never touched and generation immediately rolls from
// the edited tables. Validation errors (e.g. "added a choice but no lookup
// row") surface right here.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";

type FieldEntry = {
  choices?: [unknown, number][];
  range?: [number, number];
  lookup?: [unknown, unknown][];
  depends_on?: string;
  depends_on_context?: string;
  lookup_ranges?: boolean;
};

// cradle type id → canon db type
const DB_TYPE: Record<string, string> = { enemies: "enemy", items: "item" };

/** Parse an input back to its JSON-ish scalar (numbers stay numbers). */
function parseScalar(raw: string): unknown {
  if (raw.trim() === "") return "";
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

/** Lookup VALUES may be scalars or [lo, hi] bands — edited as JSON-ish text. */
function parseLookupValue(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return parseScalar(t);
}

function fmtLookupValue(v: unknown): string {
  return Array.isArray(v) ? JSON.stringify(v) : String(v);
}

export function SchemaEditor({
  typeId,
  onClose,
}: {
  typeId: string;
  onClose: () => void;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const dbType = DB_TYPE[typeId];
  const [source, setSource] = useState<string>("");
  const [fields, setFields] = useState<Record<string, FieldEntry> | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api
      .dbSchema(worldPath, dbType)
      .then((r) => {
        setSource(r.source);
        setFields((r.schema.fields as Record<string, FieldEntry>) ?? {});
      })
      .catch((e) => setErr(String(e)));
  }, [worldPath, dbType]);

  const touch = (name: string, entry: FieldEntry) => {
    setFields((f) => ({ ...(f ?? {}), [name]: entry }));
    setTouched((t) => new Set(t).add(name));
  };

  const dirty = touched.size > 0;

  const save = async () => {
    if (!fields || !dirty) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const set = {
        fields: Object.fromEntries([...touched].map((n) => [n, fields[n]])),
      };
      const result = await api.dbUpdateSchema(worldPath, dbType, set);
      setSource(result.source);
      setFields((result.schema.fields as Record<string, FieldEntry>) ?? {});
      setTouched(new Set());
      setNote("saved as pack override ✓ — generation now rolls these tables");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const label: React.CSSProperties = {
    fontSize: 11,
    color: "var(--fg-dim)",
  };
  const num: React.CSSProperties = { width: 64 };

  const fieldNames = useMemo(() => Object.keys(fields ?? {}), [fields]);

  const choicesEditor = (name: string, entry: FieldEntry) => (
    <table style={{ borderCollapse: "collapse" }}>
      <tbody>
        {(entry.choices ?? []).map(([value, weight], i) => (
          <tr key={i}>
            <td>
              <input
                style={{ width: 110 }}
                value={String(value)}
                onChange={(e) => {
                  const next = (entry.choices ?? []).map((p) => [...p] as [unknown, number]);
                  next[i][0] = parseScalar(e.target.value);
                  touch(name, { ...entry, choices: next });
                }}
              />
            </td>
            <td style={label}>×</td>
            <td>
              <input
                style={num}
                type="number"
                step="any"
                value={weight}
                onChange={(e) => {
                  const next = (entry.choices ?? []).map((p) => [...p] as [unknown, number]);
                  next[i][1] = Number(e.target.value);
                  touch(name, { ...entry, choices: next });
                }}
              />
            </td>
            <td>
              <button
                title="remove choice"
                style={{ cursor: "pointer", fontSize: 11 }}
                onClick={() =>
                  touch(name, {
                    ...entry,
                    choices: (entry.choices ?? []).filter((_, j) => j !== i),
                  })
                }
              >
                −
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={4}>
            <button
              style={{ cursor: "pointer", fontSize: 11 }}
              onClick={() =>
                touch(name, {
                  ...entry,
                  choices: [...(entry.choices ?? []), ["", 1]],
                })
              }
            >
              + choice
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  );

  const rangeEditor = (name: string, entry: FieldEntry) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        style={num}
        type="number"
        value={entry.range?.[0] ?? 0}
        onChange={(e) =>
          touch(name, {
            ...entry,
            range: [Number(e.target.value), entry.range?.[1] ?? 0],
          })
        }
      />
      <span style={label}>to</span>
      <input
        style={num}
        type="number"
        value={entry.range?.[1] ?? 0}
        onChange={(e) =>
          touch(name, {
            ...entry,
            range: [entry.range?.[0] ?? 0, Number(e.target.value)],
          })
        }
      />
    </div>
  );

  const lookupEditor = (name: string, entry: FieldEntry) => {
    // Rows are keyed by the DEPENDED-ON field's choice values; after adding
    // a choice up there, missing rows appear here as a one-click add —
    // canon's coverage check refuses a save until every choice has a row.
    const parent = entry.depends_on ? fields?.[entry.depends_on] : undefined;
    const parentKeys = (parent?.choices ?? []).map(([v]) => v);
    const existing = new Set((entry.lookup ?? []).map(([k]) => String(k)));
    const missing = parentKeys.filter((k) => !existing.has(String(k)));
    return (
      <div>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {(entry.lookup ?? []).map(([key, value], i) => (
              <tr key={i}>
                <td style={{ ...label, paddingRight: 6 }}>{String(key)} →</td>
                <td>
                  <input
                    style={{ width: 110 }}
                    value={fmtLookupValue(value)}
                    onChange={(e) => {
                      const next = (entry.lookup ?? []).map((p) => [...p] as [unknown, unknown]);
                      next[i][1] = parseLookupValue(e.target.value);
                      touch(name, { ...entry, lookup: next });
                    }}
                    placeholder={entry.lookup_ranges ? "n or [lo, hi]" : ""}
                  />
                </td>
                <td>
                  <button
                    title="remove row"
                    style={{ cursor: "pointer", fontSize: 11 }}
                    onClick={() =>
                      touch(name, {
                        ...entry,
                        lookup: (entry.lookup ?? []).filter((_, j) => j !== i),
                      })
                    }
                  >
                    −
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {missing.length > 0 && (
          <button
            style={{ cursor: "pointer", fontSize: 11 }}
            onClick={() =>
              touch(name, {
                ...entry,
                lookup: [
                  ...(entry.lookup ?? []),
                  ...missing.map(
                    (k) =>
                      [k, entry.lookup_ranges ? [0, 0] : 0] as [unknown, unknown],
                  ),
                ],
              })
            }
          >
            + rows for {missing.map(String).join(", ")}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0,
        width: 360,
        background: "var(--bg-raised)",
        borderLeft: "1px solid var(--border)",
        padding: 16,
        overflowY: "auto",
        zIndex: 40,
        boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6, gap: 8 }}>
        <strong style={{ flex: 1 }}>{dbType} roll tables</strong>
        {source && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              color: source === "pack" ? "var(--accent)" : "var(--fg-dim)",
            }}
          >
            {source === "pack" ? "customized" : "default"}
          </span>
        )}
        <button onClick={onClose} style={{ cursor: "pointer" }}>✕</button>
      </div>
      <p style={{ fontSize: 11, color: "var(--fg-dim)", margin: "0 0 8px" }}>
        The tables generation rolls from. Edits save as a <b>pack-local
        override</b> and apply to every future roll; existing rows are
        untouched. Canon validates before writing — a choice without its
        lookup rows is refused here.
      </p>
      {err && (
        <p style={{ color: "#e0453a", fontSize: 12, whiteSpace: "pre-wrap" }}>{err}</p>
      )}
      {note && <p style={{ color: "var(--accent)", fontSize: 12 }}>{note}</p>}
      {!fields && !err && <p style={{ fontSize: 12 }}>Loading schema…</p>}
      {fields &&
        fieldNames.map((name) => {
          const entry = fields[name];
          return (
            <div key={name} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {name} {touched.has(name) && "✎"}
                {entry.depends_on && (
                  <span style={{ ...label, fontWeight: 400 }}>
                    {" "}· keyed by {entry.depends_on}
                  </span>
                )}
                {entry.lookup_ranges && (
                  <span style={{ ...label, fontWeight: 400 }}> · banded [lo, hi]</span>
                )}
              </div>
              {entry.choices !== undefined
                ? choicesEditor(name, entry)
                : entry.range !== undefined
                  ? rangeEditor(name, entry)
                  : entry.lookup !== undefined
                    ? lookupEditor(name, entry)
                    : null}
            </div>
          );
        })}
      <div style={{ marginTop: 16 }}>
        <button
          disabled={busy || !dirty}
          onClick={save}
          style={{
            cursor: dirty ? "pointer" : "default",
            background: dirty ? "var(--accent)" : undefined,
            color: dirty ? "var(--accent-ink)" : undefined,
            fontWeight: 600,
            border: dirty ? "none" : "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 12px",
            opacity: dirty ? 1 : 0.6,
          }}
        >
          {busy ? "…" : dirty ? `Save ${touched.size} table${touched.size > 1 ? "s" : ""}` : "No changes"}
        </button>
      </div>
    </div>
  );
}
