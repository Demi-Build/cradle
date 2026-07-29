// Tileset slot-param editor: gameplay knobs per tile TYPE (hazard damage,
// water speed_factor/gravity/impulse, breakable/container flags…). One row
// per tile NAME — all same-name slots update together via `canon db update
// --type tile` (the same doctrine as tile reskins). Structural fields
// (px_region, autotile_mask, water_deep) are generation-owned and hidden.

import { useState } from "react";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";

type Slot = {
  index: number;
  name: string;
  tile_type: number;
  collision: string;
  params?: Record<string, unknown>;
};

const COLLISION_CATEGORIES = ["empty", "solid", "one_way", "hazard", "volume"];
const STRUCTURAL_PARAMS = new Set(["autotile_mask", "water_deep"]);

type GroupEdit = { collision?: string; params: Record<string, unknown> };

export function TileSlotEditor({
  data,
  entityId,
}: {
  data: Record<string, unknown>;
  entityId: string;
}) {
  void entityId;
  const worldPath = useStore((s) => s.worldPath);
  const stageId = String(data.stage_id ?? "");
  const slots = (data.slots as Slot[] | undefined) ?? [];
  const [edits, setEdits] = useState<Record<string, GroupEdit>>({});
  // Saved-but-not-refetched values overlay the (now stale) manifest prop —
  // re-selecting the entity to refresh would remount this component and
  // swallow the confirmation note.
  const [savedOverlay, setSavedOverlay] = useState<Record<string, GroupEdit>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Rebuilt every render on purpose: saves refresh the same slot objects in
  // place, so a dependency-array memo would serve stale knob values.
  const byName = new Map<string, Slot[]>();
  for (const s of slots) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  const groups = [...byName.entries()].map(([name, group]) => {
    const knobs: Record<string, unknown> = {};
    for (const s of group) {
      for (const [k, v] of Object.entries(s.params ?? {})) {
        if (!STRUCTURAL_PARAMS.has(k) && !(k in knobs)) knobs[k] = v;
      }
    }
    return { name, group, knobs };
  });

  if (!stageId || groups.length === 0) return null;

  const editFor = (name: string): GroupEdit => edits[name] ?? { params: {} };

  const setParam = (name: string, key: string, value: unknown) =>
    setEdits((e) => ({
      ...e,
      [name]: {
        ...editFor(name),
        params: { ...editFor(name).params, [key]: value },
      },
    }));

  const setCollision = (name: string, value: string) =>
    setEdits((e) => ({ ...e, [name]: { ...editFor(name), collision: value } }));

  const dirtySet = (name: string, base: { collision: string; knobs: Record<string, unknown> }) => {
    const edit = editFor(name);
    const set: Record<string, unknown> = {};
    if (edit.collision !== undefined && edit.collision !== base.collision)
      set.collision = edit.collision;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edit.params)) {
      if (JSON.stringify(v) !== JSON.stringify(base.knobs[k])) params[k] = v;
    }
    if (Object.keys(params).length) set.params = params;
    return set;
  };

  const save = async (name: string, set: Record<string, unknown>) => {
    setBusy(name);
    setNote(null);
    try {
      await api.dbUpdate(worldPath, "tile", `${stageId}/${name}`, set);
      setSavedOverlay((s) => ({
        ...s,
        [name]: {
          collision: (set.collision as string) ?? s[name]?.collision,
          params: { ...(s[name]?.params ?? {}), ...((set.params as Record<string, unknown>) ?? {}) },
        },
      }));
      setEdits((e) => {
        const next = { ...e };
        delete next[name];
        return next;
      });
      setNote(`${name} saved · user_edited ✓`);
    } catch (e) {
      setNote(String(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const cell: React.CSSProperties = { padding: "4px 8px", fontSize: 12 };
  const knobInput = (name: string, key: string, current: unknown) => {
    const edit = editFor(name);
    const value = key in edit.params ? edit.params[key] : current;
    if (typeof current === "boolean") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => setParam(name, key, e.target.checked)}
        />
      );
    }
    if (typeof current === "number") {
      return (
        <input
          style={{ width: 72 }}
          type="number"
          step="any"
          value={value as number}
          onChange={(e) =>
            setParam(name, key, e.target.value === "" ? 0 : Number(e.target.value))
          }
        />
      );
    }
    return (
      <input
        style={{ width: 90 }}
        value={String(value ?? "")}
        onChange={(e) => setParam(name, key, e.target.value)}
      />
    );
  };

  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>tile gameplay knobs</h3>
        <span style={{ fontSize: 11, color: "var(--text-3, #8a8398)" }}>
          per tile type — all its slots update together; art/structure stay untouched
        </span>
      </div>
      {note && (
        <p style={{ fontSize: 11, color: "var(--accent, #e2b714)", margin: "2px 0 6px" }}>
          {note}
        </p>
      )}
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--text-3, #8a8398)", fontSize: 11, textAlign: "left" }}>
            <th style={cell}>tile</th>
            <th style={cell}>slots</th>
            <th style={cell}>collision</th>
            <th style={cell}>params</th>
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          {groups.map(({ name, group, knobs }) => {
            const ov = savedOverlay[name];
            const base = {
              collision: ov?.collision ?? group[0].collision,
              knobs: { ...knobs, ...(ov?.params ?? {}) },
            };
            const set = dirtySet(name, base);
            const dirty = Object.keys(set).length > 0;
            return (
              <tr key={name} style={{ borderTop: "1px solid var(--border, #3a2f4a)" }}>
                <td style={{ ...cell, fontWeight: 600 }}>{name}</td>
                <td style={{ ...cell, color: "var(--text-3, #8a8398)" }}>{group.length}</td>
                <td style={cell}>
                  <select
                    value={editFor(name).collision ?? base.collision}
                    onChange={(e) => setCollision(name, e.target.value)}
                  >
                    {COLLISION_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td style={cell}>
                  {Object.keys(base.knobs).length === 0 && (
                    <span style={{ color: "var(--text-3, #8a8398)" }}>—</span>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {Object.entries(base.knobs).map(([k, v]) => (
                      <label key={k} style={{ fontSize: 11, color: "var(--text-3, #8a8398)" }}>
                        {k}{" "}
                        {knobInput(name, k, v)}
                      </label>
                    ))}
                  </div>
                </td>
                <td style={cell}>
                  {dirty && (
                    <button
                      disabled={busy === name}
                      onClick={() => save(name, set)}
                      style={{
                        cursor: "pointer",
                        background: "var(--accent, #e2b714)",
                        color: "#1a1208",
                        fontWeight: 600,
                        border: "none",
                        borderRadius: 6,
                        padding: "2px 10px",
                        fontSize: 12,
                      }}
                    >
                      {busy === name ? "…" : "Save"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
