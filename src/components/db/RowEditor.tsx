// Spec-driven DB row form, two modes:
//
// CREATE ("+ new row"): generated from `canon db types` (the pack's own
// field-spec registry). Closed sets render as dropdowns of the actual choice
// tables; anything you set becomes a LOCKED ANCHOR the skeleton rolls around;
// Create runs the roll, Create+LLM also authors name/flavor exactly as
// pipeline generation would (confirm-gated — it spends tokens).
//
// EDIT (pass editRow/editId): prefilled from the EXISTING row's flat view
// (top-level + stats/behavior/params). Values land verbatim via `canon db
// update` — no rerolls, no LLM; canon rehashes, stamps user_edited, and
// journals op=edit with the field diff. Only CHANGED fields are sent.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/invoke";
import { DB_NESTING } from "../../lib/dbNesting";
import { useStore } from "../../store";

type SpecField = {
  name: string;
  mode: "choices" | "range" | "lookup";
  choices?: (string | number)[];
  range?: [number, number];
  depends_on?: string;
};

type DbType = {
  skeleton_fields: SpecField[];
  llm_fields: string[];
  code_fields: string[];
  schema_source?: string;
};

// cradle type id → canon db type
const DB_TYPE: Record<string, string> = { enemies: "enemy", items: "item" };

// Identity/provenance/art plumbing — canon refuses these; don't render them.
const HIDDEN = new Set([
  "artifact_id", "enemy_id", "item_id", "provenance_hash", "parents",
  "status", "review_status", "sprite_path", "sprite_hash", "animation",
  "canon_version",
]);

/** The row's editable flat view — mirrors canon's db-update routing. Known
 * knobs keep their bare names; hand-added custom knobs become dotted
 * "<container>.<key>" paths (the only spelling canon can route). */
function flattenRow(
  dbType: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const nesting = DB_NESTING[dbType] ?? {};
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (HIDDEN.has(k)) continue;
    if ((k === "stats" || k === "behavior" || k === "params") && v && typeof v === "object") {
      for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
        if (HIDDEN.has(nk)) continue;
        flat[nesting[nk] === k ? nk : `${k}.${nk}`] = nv;
      }
    } else if (typeof v !== "object" || Array.isArray(v)) {
      flat[k] = v;
    }
  }
  return flat;
}

function scalarEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function RowEditor({
  typeId,
  onClose,
  onCreated,
  editRow,
  editId,
}: {
  typeId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** Present = edit mode: the existing row (raw JSON) and its id. */
  editRow?: Record<string, unknown>;
  editId?: string;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const dbType = DB_TYPE[typeId];
  const editing = Boolean(editRow && editId);
  const original = useMemo(
    () => (editRow ? flattenRow(dbType, editRow) : {}),
    [dbType, editRow],
  );
  const [spec, setSpec] = useState<DbType | null>(null);
  const [fields, setFields] = useState<Record<string, unknown>>(original);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api
      .dbTypes(worldPath)
      .then((r) => {
        const types = (r as { types: Record<string, DbType> }).types;
        setSpec(types[dbType] ?? null);
      })
      .catch((e) => setErr(String(e)));
  }, [worldPath, dbType]);

  const set = (name: string, value: unknown) =>
    setFields((f) => {
      const next = { ...f };
      if (!editing && (value === "" || value === undefined || value === null))
        delete next[name];
      else next[name] = value;
      return next;
    });

  const changed = useMemo(() => {
    if (!editing) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      // A cleared input ("") is "leave it alone", never a literal write —
      // an empty-string hp would poison the play surfaces' numerics.
      if (v === "" && original[k] !== "") continue;
      if (!scalarEqual(v, original[k])) out[k] = v;
    }
    return out;
  }, [editing, fields, original]);
  const dirty = Object.keys(changed).length > 0;

  const create = async (complete: boolean) => {
    if (
      complete &&
      !window.confirm(
        "LLM-complete this row?\n\nBackend: anthropic (cheap tier — Haiku for " +
          "enemy/item text). Rough cost: well under 1¢. Anchored fields are " +
          "preserved; the model authors the rest.",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const result = await api.dbNew(worldPath, dbType, fields, complete);
      onCreated(result.id);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Re-selecting the entity remounts the whole detail pane (and this
  // panel with it), so a warning shown alongside an immediate refresh
  // would never be seen — defer the refresh to close instead.
  const [refreshOnClose, setRefreshOnClose] = useState(false);
  const close = () => {
    if (refreshOnClose && editId) onCreated(editId);
    onClose();
  };

  const save = async () => {
    if (!editId || !dirty) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const result = await api.dbUpdate(worldPath, dbType, editId, changed);
      const warnings = result.warnings ?? [];
      if (warnings.length) {
        setNote(`saved ✓ — ${warnings[0]}`);
        setRefreshOnClose(true); // panel stays open to show the warning
      } else {
        onCreated(editId);
        onClose();
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const label: React.CSSProperties = {
    fontSize: 11,
    color: "var(--fg-dim)",
    display: "block",
    marginTop: 8,
  };
  const marked = (name: string) =>
    editing ? name in changed && "✎" : name in fields && "🔒";

  // Edit mode shows every flat row field; spec metadata upgrades matching
  // names to dropdowns/bounded inputs. Extra hand-added knobs render as
  // plain inputs after the spec-known ones.
  const specNames = new Set([
    "name", "flavor", ...(spec?.skeleton_fields.map((f) => f.name) ?? []),
  ]);
  const extraFields = editing
    ? Object.keys(original).filter((k) => !specNames.has(k))
    : [];

  const textInput = (name: string) => (
    <input
      style={{ width: "100%" }}
      value={String(fields[name] ?? "")}
      onChange={(e) => set(name, e.target.value)}
      placeholder={editing ? "" : "(let the LLM write it)"}
    />
  );

  const genericInput = (name: string) => {
    const orig = original[name];
    if (typeof orig === "boolean") {
      return (
        <input
          type="checkbox"
          checked={Boolean(fields[name])}
          onChange={(e) => set(name, e.target.checked)}
        />
      );
    }
    if (Array.isArray(orig)) {
      return (
        <input
          style={{ width: "100%" }}
          value={(fields[name] as unknown[])?.join(", ") ?? ""}
          onChange={(e) =>
            set(
              name,
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="comma-separated"
        />
      );
    }
    if (typeof orig === "number") {
      return (
        <input
          style={{ width: "100%" }}
          type="number"
          step="any"
          value={(fields[name] as number) ?? ""}
          onChange={(e) =>
            set(name, e.target.value === "" ? "" : Number(e.target.value))
          }
        />
      );
    }
    return textInput(name);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0,
        width: 320,
        background: "var(--bg-raised)",
        borderLeft: "1px solid var(--border)",
        padding: 16,
        overflowY: "auto",
        zIndex: 40,
        boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <strong style={{ flex: 1 }}>
          {editing ? `Edit ${dbType} · ${editId}` : `New ${dbType}`}
        </strong>
        <button onClick={close} style={{ cursor: "pointer" }}>✕</button>
      </div>
      <p style={{ fontSize: 11, color: "var(--fg-dim)", margin: "0 0 8px" }}>
        {editing ? (
          <>
            Values land <b>verbatim</b> — no rerolls, no LLM. Canon rehashes,
            stamps <code>user_edited</code>, and journals the diff.
          </>
        ) : (
          <>
            Anything you set is a <b>locked anchor</b> — the skeleton rolls the
            rest around it (dependent stats follow your anchors).
          </>
        )}
      </p>
      {err && <p style={{ color: "#e0453a", fontSize: 12 }}>{err}</p>}
      {note && <p style={{ color: "var(--accent)", fontSize: 12 }}>{note}</p>}
      {!spec && !err && <p style={{ fontSize: 12 }}>Loading field spec…</p>}
      {spec && (
        <>
          <label style={label}>
            name {marked("name")}
            <input
              style={{ width: "100%" }}
              value={(fields.name as string) ?? ""}
              onChange={(e) => set("name", e.target.value)}
              placeholder={editing ? "" : "(let the LLM name it)"}
            />
          </label>
          <label style={label}>
            flavor {marked("flavor")}
            {textInput("flavor")}
          </label>
          {spec.skeleton_fields
            .filter((f) => !editing || f.name in original)
            .map((f) => (
              <label key={f.name} style={label}>
                {f.name} {marked(f.name)}
                {f.mode === "choices" ? (
                  <select
                    style={{ width: "100%" }}
                    value={String(fields[f.name] ?? "")}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") return set(f.name, "");
                      const asNum = Number(raw);
                      set(
                        f.name,
                        f.choices?.some((c) => typeof c === "number") && !Number.isNaN(asNum)
                          ? asNum
                          : raw,
                      );
                    }}
                  >
                    {!editing && <option value="">roll 🎲</option>}
                    {/* A hand-edited off-table value still shows up selected. */}
                    {editing &&
                      fields[f.name] !== undefined &&
                      !f.choices?.some((c) => String(c) === String(fields[f.name])) && (
                        <option value={String(fields[f.name])}>
                          {String(fields[f.name])} (off-table)
                        </option>
                      )}
                    {(f.choices ?? []).map((c) => (
                      <option key={String(c)} value={String(c)}>{String(c)}</option>
                    ))}
                  </select>
                ) : f.mode === "range" ? (
                  <input
                    style={{ width: "100%" }}
                    type="number"
                    min={f.range?.[0]}
                    max={f.range?.[1]}
                    value={(fields[f.name] as number) ?? ""}
                    onChange={(e) =>
                      set(f.name, e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder={editing ? "" : `roll 🎲 [${f.range?.[0]}–${f.range?.[1]}]`}
                  />
                ) : editing ? (
                  // Lookups are derived at ROLL time; the rolled value is
                  // concrete now and hand-editable.
                  <input
                    style={{ width: "100%" }}
                    type="number"
                    step="any"
                    value={(fields[f.name] as number) ?? ""}
                    onChange={(e) =>
                      set(f.name, e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder={`derived from ${f.depends_on}`}
                  />
                ) : (
                  <input
                    style={{ width: "100%", opacity: 0.6 }}
                    disabled
                    value=""
                    placeholder={`derived from ${f.depends_on}`}
                  />
                )}
              </label>
            ))}
          {extraFields.map((name) => (
            <label key={name} style={label}>
              {name} {marked(name)}
              {genericInput(name)}
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {editing ? (
              <button
                disabled={busy || !dirty}
                onClick={save}
                style={{
                  cursor: dirty ? "pointer" : "default",
                  background: dirty ? "var(--accent)" : undefined,
                  color: dirty ? "var(--accent-ink)" : undefined,
                  fontWeight: 600,
                  border: dirty ? "none" : undefined,
                  borderRadius: 6,
                  padding: "4px 10px",
                  opacity: dirty ? 1 : 0.6,
                }}
              >
                {busy ? "…" : dirty
                  ? `Save ${Object.keys(changed).length} change${Object.keys(changed).length > 1 ? "s" : ""}`
                  : "No changes"}
              </button>
            ) : (
              <>
                <button disabled={busy} onClick={() => create(false)} style={{ cursor: "pointer" }}>
                  {busy ? "…" : "Create (roll only)"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => create(true)}
                  style={{
                    cursor: "pointer",
                    background: "var(--accent)",
                    color: "var(--accent-ink)",
                    fontWeight: 600,
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                  }}
                >
                  {busy ? "…" : "Create + LLM complete"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
