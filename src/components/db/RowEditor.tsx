// Spec-driven DB row form, two modes:
//
// CREATE ("+ new row"): generated from `canon db types` (the pack's own
// field-spec registry). Closed sets render as dropdowns of the actual choice
// tables; anything you set becomes a LOCKED ANCHOR the skeleton rolls around;
// Create runs the roll, Create+LLM also authors name/flavor exactly as
// pipeline generation would (confirm-gated — it spends tokens).
//
// EDIT (pass editRow/editId): prefilled from the EXISTING row's flat view.
// Values land verbatim via `canon db update` — no rerolls, no LLM; canon
// rehashes, stamps user_edited, and journals op=edit with the field diff.
// Only CHANGED fields are sent.
//
// Row P0-8 made this work for ALL NINE dungeon types, not the two platformer
// ones. Two literals dissolved into pack data:
//
//   • the cradle-typeId → canon-kind map is `pack info`'s own entity list
//     (`kindForTypeId`), so a NEW kind (`db define`) edits with no code change;
//   • the `HIDDEN` set is `canon db schema` / `db types`'s per-kind lists,
//     which row P0-6 added beside the existing four (P0 paper P.1):
//       hidden      — not rendered (the P.9 S5 hide set)
//       protected   — rendered, NOT editable, with the reason (doctrine 4:
//                     disabled-with-a-reason beats hidden), in a collapsed
//                     section so identity plumbing never crowds the form
//       routed      — rendered as a LINK to the owning surface ("owned by the
//                     grid — edit it on the room canvas")
//       decorative  — editable, with "engine ignores this field"
//       user_fields — editable; these are the free wins nothing generates
//
// List containers (`shop_inventory`, `abilities`, `spells`, `loot_table`,
// `target_items`, `choices`, `monster_ids`, …) are detected from the ROW —
// an array value IS a list container — and edited with the grammar the write
// core accepts (P.1): `<c>[<i>].<key>` for a field, `<c>[+]` to append,
// `<c>[<i>] = null` to remove. Add/remove are STRUCTURAL: they issue their
// own `db update` at once (so the indices the next edit uses are the ones on
// disk) and are disabled while there are unsaved field edits.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/invoke";
import { DB_NESTING } from "../../lib/dbNesting";
import { kindForTypeId, typeIdForKind } from "../../lib/placements";
import { useStore } from "../../store";
import { confirmSpend } from "../agent/confirmGateState";

type SpecField = {
  name: string;
  mode: "choices" | "range" | "lookup";
  choices?: (string | number)[];
  range?: [number, number];
  depends_on?: string;
};

/** One entry of `canon db types` — the four original keys plus the five P.1
 *  lists row P0-6 added. Everything is optional: a pack whose registry
 *  predates a list simply renders nothing for it. */
type DbType = {
  skeleton_fields: SpecField[];
  llm_fields: string[];
  code_fields: string[];
  schema_source?: string | null;
  label?: string;
  id_field?: string;
  user_fields?: string[];
  hidden?: string[];
  decorative?: string[];
  protected?: string[];
  routed?: Record<string, string>;
};

const PROTECTED_REASON = "identity / provenance / asset plumbing — canon refuses edits here";
const DECORATIVE_NOTE = "engine ignores this field";

/** What a routed field's owning verb means on screen. The verb string is DATA
 *  (`grid` | `dialogue` | `scene` | anything a future registry adds), so an
 *  unknown one still renders its name rather than disappearing. */
function routedCopy(verb: string): string {
  if (verb === "grid") return "owned by the grid — edit it on the room canvas";
  if (verb === "dialogue") return "owned by dialogue — edit it on the Dialogue tab";
  if (verb === "scene") return "owned by scene — edit it in the scene editor";
  return `owned by ${verb} — use that surface`;
}

/** The last dotted segment — what canon's protected wall matches on
 *  (`write_core.leaf_of`), so the form classifies a field exactly the way the
 *  writer will. */
function leafOf(name: string): string {
  const bare = name.replace(/\[[^\]]*\]/g, "");
  return bare.includes(".") ? bare.slice(bare.lastIndexOf(".") + 1) : bare;
}

function scalarEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type Split = {
  /** Flat scalar fields, addressed exactly as canon takes them. */
  flat: Record<string, unknown>;
  /** Array-valued fields — the P.1 list containers. */
  lists: Record<string, unknown[]>;
};

/** The row's editable view. Known platformer knobs keep their bare names
 *  (canon's `nesting` map routes them); every other nested key becomes the
 *  dotted "<container>.<key>" path — the only other spelling the core
 *  accepts. Arrays split off as list containers. A container the registry
 *  itself claims (routed to another verb, or protected) is NOT flattened:
 *  its sub-keys are not addressable, so the form shows the container by name
 *  and points at the surface that owns it (`dialogue_tree` → dialogue). */
function splitRow(
  dbType: string,
  row: Record<string, unknown>,
  hidden: Set<string>,
  claimed: (name: string) => boolean,
): Split {
  const nesting = DB_NESTING[dbType] ?? {};
  const flat: Record<string, unknown> = {};
  const lists: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(row)) {
    if (hidden.has(k)) continue;
    if (claimed(k)) {
      flat[k] = v;
    } else if (Array.isArray(v)) {
      lists[k] = v;
    } else if (v && typeof v === "object") {
      for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
        if (hidden.has(nk)) continue;
        if (Array.isArray(nv)) continue; // a list inside a container: v1.1
        flat[nesting[nk] === k ? nk : `${k}.${nk}`] = nv;
      }
    } else {
      flat[k] = v;
    }
  }
  return { flat, lists };
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
  const packInfo = useStore((s) => s.world?.pack_info ?? null);
  const select = useStore((s) => s.select);
  const dbType = useMemo(() => kindForTypeId(packInfo, typeId), [packInfo, typeId]);
  const editing = Boolean(editRow && editId);
  const [row, setRow] = useState<Record<string, unknown>>(editRow ?? {});
  useEffect(() => setRow(editRow ?? {}), [editRow]);
  const [spec, setSpec] = useState<DbType | null>(null);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [completeOff, setCompleteOff] = useState<string | null>(null);
  const [showProtected, setShowProtected] = useState(false);
  const [newId, setNewId] = useState("");

  const hidden = useMemo(() => new Set(spec?.hidden ?? []), [spec]);
  const protectedSet = useMemo(() => new Set(spec?.protected ?? []), [spec]);
  const decorative = useMemo(() => new Set(spec?.decorative ?? []), [spec]);
  const routed = useMemo(() => spec?.routed ?? {}, [spec]);
  const idField = spec?.id_field ?? "id";
  const label = spec?.label ?? dbType;
  /** The type id of whatever grid this pack declares — where a `grid`-routed
   *  field is actually edited (rooms for a dungeon, levels for a platformer). */
  const gridTypeId = useMemo(() => {
    const gridKind = Object.keys(packInfo?.grids ?? {})[0];
    return gridKind ? typeIdForKind(gridKind) : null;
  }, [packInfo]);

  const claimed = useCallback(
    (name: string) => Boolean(routed[name]) || protectedSet.has(name),
    [routed, protectedSet],
  );
  const split = useMemo(
    () => (editing ? splitRow(dbType, row, hidden, claimed) : { flat: {}, lists: {} }),
    [editing, dbType, row, hidden, claimed],
  );
  const original = split.flat;

  useEffect(() => {
    setFields(original);
    // `original` is rebuilt whenever the row or the hide set changes; the
    // form follows it so a structural add/remove shows its result at once.
  }, [original]);

  useEffect(() => {
    api
      .dbTypes(worldPath)
      .then((r) => {
        const types = (r as { types: Record<string, DbType> }).types;
        setSpec(types[dbType] ?? null);
        if (!types[dbType]) {
          setErr(`this pack declares no ${dbType} type — nothing to edit`);
        }
      })
      .catch((e) => setErr(String(e)));
  }, [worldPath, dbType]);

  const classify = useCallback(
    (name: string): "protected" | "routed" | "decorative" | "editable" => {
      const leaf = leafOf(name);
      if (protectedSet.has(name) || protectedSet.has(leaf)) return "protected";
      if (routed[name] || routed[leaf]) return "routed";
      if (decorative.has(name) || decorative.has(leaf)) return "decorative";
      return "editable";
    },
    [protectedSet, routed, decorative],
  );

  const set = (name: string, value: unknown) =>
    setFields((f) => {
      const next = { ...f };
      if (!editing && (value === "" || value === undefined || value === null)) delete next[name];
      else next[name] = value;
      return next;
    });

  const changed = useMemo(() => {
    if (!editing) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (classify(k) !== "editable" && classify(k) !== "decorative") continue;
      // A cleared input ("") is "leave it alone", never a literal write —
      // an empty-string hp would poison the play surfaces' numerics.
      if (v === "" && original[k] !== "") continue;
      if (!scalarEqual(v, original[k])) out[k] = v;
    }
    return out;
  }, [editing, fields, original, classify]);
  const dirty = Object.keys(changed).length > 0;

  /** Re-read the row after a structural list op, without remounting the
   *  panel (a remount would drop the pane the user is working in). */
  const refresh = async () => {
    const fresh = (await api.getEntity(worldPath, typeId, editId!)) as Record<string, unknown>;
    setRow(fresh);
  };

  const create = async (complete: boolean) => {
    // Create+LLM spends tokens: the paid card gates it (row P1-A5). A plain
    // Create is free and asks nothing.
    if (
      complete &&
      !(await confirmSpend({
        title: `LLM-complete this ${dbType} row`,
        body:
          "Backend: anthropic (cheap tier). Anchored fields are preserved; the model authors " +
          "the rest.",
        backends: { llm: "anthropic" },
        backend: "anthropic",
        model: "cheap tier (Haiku)",
        fixedUsd: 0.01,
        unitLabel: "1 completion",
      }))
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const payload = { ...fields };
      if (newId.trim()) payload[idField] = newId.trim();
      const result = await api.dbNew(worldPath, dbType, payload, complete);
      onCreated(result.id);
      onClose();
    } catch (e) {
      const message = String(e);
      // `db complete` answers a structured not-yet on a kind whose seed binds
      // no per-row completion body — render the reason, never crash.
      if (complete && /not_yet|not yet/.test(message)) setCompleteOff(message.slice(0, 200));
      setErr(message);
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
        await refresh();
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

  /** One structural list op through the P.1 grammar the core accepts. */
  const listOp = async (address: string, value: unknown) => {
    if (!editId) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await api.dbUpdate(worldPath, dbType, editId, { [address]: value });
      setRefreshOnClose(true);
      await refresh();
      setNote(`saved ✓ — ${address}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--fg-dim)",
    display: "block",
    marginTop: 8,
  };
  const marked = (name: string) => (editing ? name in changed && "✎" : name in fields && "🔒");

  const specNames = new Set([
    "name",
    "flavor",
    ...(spec?.skeleton_fields.map((f) => f.name) ?? []),
  ]);
  const orderedExtras = editing ? Object.keys(original).filter((k) => !specNames.has(k)) : [];
  const extraFields = orderedExtras.filter(
    (k) => classify(k) === "editable" || classify(k) === "decorative",
  );
  const protectedFields = orderedExtras.filter((k) => classify(k) === "protected");
  const routedFields = orderedExtras.filter((k) => classify(k) === "routed");

  const textInput = (name: string, disabled = false) => (
    <input
      style={{ width: "100%" }}
      value={String(fields[name] ?? "")}
      disabled={disabled}
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
    if (typeof orig === "number") {
      return (
        <input
          style={{ width: "100%" }}
          type="number"
          step="any"
          value={(fields[name] as number) ?? ""}
          onChange={(e) => set(name, e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
    }
    return textInput(name);
  };

  const hint = (text: string) => (
    <span style={{ color: "var(--fg-muted)", fontSize: 10, marginLeft: 6 }}>{text}</span>
  );

  return (
    <div
      className="row-editor"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 340,
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
          {editing ? `Edit ${label} · ${editId}` : `New ${label}`}
        </strong>
        <button onClick={close} style={{ cursor: "pointer" }} aria-label="Close">
          ✕
        </button>
      </div>
      <p style={{ fontSize: 11, color: "var(--fg-dim)", margin: "0 0 8px" }}>
        {editing ? (
          <>
            Values land <b>verbatim</b> — no rerolls, no LLM. Canon rehashes, stamps{" "}
            <code>user_edited</code>, and journals the diff.
          </>
        ) : (
          <>
            Anything you set is a <b>locked anchor</b> — the skeleton rolls the rest around it
            (dependent stats follow your anchors).
          </>
        )}
      </p>
      {err && <p style={{ color: "var(--err)", fontSize: 12 }}>{err}</p>}
      {note && <p style={{ color: "var(--accent)", fontSize: 12 }}>{note}</p>}
      {!spec && !err && <p style={{ fontSize: 12 }}>Loading field spec…</p>}
      {spec && (
        <>
          {!editing && (
            <label style={labelStyle}>
              {idField}
              {hint("leave blank when canon allocates it")}
              <input
                style={{ width: "100%" }}
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="(allocated)"
              />
            </label>
          )}
          {(!editing || "name" in original) && (
            <label style={labelStyle}>
              name {marked("name")}
              <input
                style={{ width: "100%" }}
                value={(fields.name as string) ?? ""}
                onChange={(e) => set("name", e.target.value)}
                placeholder={editing ? "" : "(let the LLM name it)"}
              />
            </label>
          )}
          {(!editing || "flavor" in original) && (
            <label style={labelStyle}>
              flavor {marked("flavor")}
              {textInput("flavor")}
            </label>
          )}
          {spec.skeleton_fields
            .filter((f) => (!editing || f.name in original) && classify(f.name) !== "protected")
            .map((f) => (
              <label key={f.name} style={labelStyle}>
                {f.name} {marked(f.name)}
                {classify(f.name) === "decorative" && hint(DECORATIVE_NOTE)}
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
                      <option key={String(c)} value={String(c)}>
                        {String(c)}
                      </option>
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
            <label key={name} style={labelStyle}>
              {name} {marked(name)}
              {classify(name) === "decorative" && hint(DECORATIVE_NOTE)}
              {genericInput(name)}
            </label>
          ))}

          {routedFields.length > 0 && (
            <div style={{ marginTop: 14 }} data-testid="routed-fields">
              <div className="dock-sect">Owned by another surface</div>
              {routedFields.map((name) => {
                const verb = routed[name] ?? routed[leafOf(name)] ?? "another verb";
                const go =
                  verb === "dialogue" && editId
                    ? () => select({ kind: "entity", typeId, id: editId, tab: "dialogue" })
                    : verb === "grid" && gridTypeId
                      ? () => select({ kind: "type", typeId: gridTypeId })
                      : null;
                return (
                  <div key={name} style={{ fontSize: 11, margin: "4px 0" }}>
                    <span style={{ fontFamily: "var(--mono)" }}>{name}</span>{" "}
                    {go ? (
                      <button
                        className="linkish"
                        onClick={go}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent)",
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 11,
                        }}
                      >
                        {routedCopy(verb)} →
                      </button>
                    ) : (
                      <span style={{ color: "var(--fg-muted)" }}>{routedCopy(verb)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {Object.keys(split.lists).length > 0 && (
            <div style={{ marginTop: 14 }} data-testid="list-containers">
              <div className="dock-sect">Lists</div>
              {Object.entries(split.lists).map(([container, items]) => {
                const off = classify(container);
                return (
                  <div key={container} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                      {container}
                      {off === "decorative" && hint(DECORATIVE_NOTE)}
                      {off === "protected" && hint(PROTECTED_REASON)}
                    </div>
                    {items.map((item, index) => (
                      <div
                        key={`${container}-${index}`}
                        style={{ display: "flex", gap: 6, alignItems: "center", margin: "3px 0" }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            color: "var(--fg-muted)",
                          }}
                        >
                          [{index}]
                        </span>
                        <span style={{ flex: 1, fontSize: 11, overflow: "hidden" }}>
                          {typeof item === "object" && item !== null
                            ? Object.entries(item as Record<string, unknown>)
                                .map(([k, v]) => `${k}=${String(v)}`)
                                .join(" · ")
                            : String(item)}
                        </span>
                        <button
                          disabled={busy || off === "protected" || dirty}
                          title={
                            off === "protected"
                              ? PROTECTED_REASON
                              : dirty
                                ? "save your field edits first — removing an item renumbers the list"
                                : `remove ${container}[${index}]`
                          }
                          onClick={() => void listOp(`${container}[${index}]`, null)}
                          style={{ cursor: "pointer", fontSize: 11 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      disabled={busy || off === "protected" || dirty || !editing}
                      title={
                        off === "protected"
                          ? PROTECTED_REASON
                          : !editing
                            ? "add items after the row exists"
                            : dirty
                              ? "save your field edits first — appending renumbers the list"
                              : `append to ${container}`
                      }
                      onClick={() =>
                        void listOp(
                          `${container}[+]`,
                          typeof items[0] === "object" && items[0] !== null
                            ? Object.fromEntries(
                                Object.keys(items[0] as Record<string, unknown>).map((k) => [
                                  k,
                                  "",
                                ]),
                              )
                            : "",
                        )
                      }
                      style={{ cursor: "pointer", fontSize: 11, marginTop: 2 }}
                    >
                      ＋ add
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {protectedFields.length > 0 && (
            <div style={{ marginTop: 14 }} data-testid="protected-fields">
              <button
                onClick={() => setShowProtected((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--fg-dim)",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: 0,
                }}
              >
                {showProtected ? "▾" : "▸"} Protected ({protectedFields.length})
              </button>
              {showProtected &&
                protectedFields.map((name) => (
                  <label key={name} style={labelStyle} title={PROTECTED_REASON}>
                    {name} {hint(PROTECTED_REASON)}
                    <input
                      style={{ width: "100%", opacity: 0.6 }}
                      disabled
                      readOnly
                      value={String(original[name] ?? "")}
                    />
                  </label>
                ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
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
                {busy
                  ? "…"
                  : dirty
                    ? `Save ${Object.keys(changed).length} change${Object.keys(changed).length > 1 ? "s" : ""}`
                    : "No changes"}
              </button>
            ) : (
              <>
                <button disabled={busy} onClick={() => create(false)} style={{ cursor: "pointer" }}>
                  {busy ? "…" : spec.schema_source ? "🎲 Create (roll only)" : "Create"}
                </button>
                <button
                  disabled={busy || !!completeOff}
                  title={completeOff ?? undefined}
                  onClick={() => create(true)}
                  style={{
                    cursor: completeOff ? "default" : "pointer",
                    background: completeOff ? undefined : "var(--accent)",
                    color: completeOff ? undefined : "var(--accent-ink)",
                    fontWeight: 600,
                    border: completeOff ? undefined : "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                    opacity: completeOff ? 0.6 : 1,
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
