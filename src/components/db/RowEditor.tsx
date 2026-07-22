// Spec-driven "+ new row" form: generated from `canon db types` (the pack's
// own field-spec registry). Closed sets render as dropdowns of the actual
// choice tables; anything you set becomes a LOCKED ANCHOR the skeleton rolls
// around; Create runs the roll, Create+LLM also authors name/flavor exactly
// as pipeline generation would (confirm-gated — it spends tokens).

import { useEffect, useState } from "react";
import { api } from "../../lib/invoke";
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
};

// cradle type id → canon db type
const DB_TYPE: Record<string, string> = { enemies: "enemy", items: "item" };

export function RowEditor({
  typeId,
  onClose,
  onCreated,
}: {
  typeId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const dbType = DB_TYPE[typeId];
  const [spec, setSpec] = useState<DbType | null>(null);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      if (value === "" || value === undefined || value === null) delete next[name];
      else next[name] = value;
      return next;
    });

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

  const label: React.CSSProperties = {
    fontSize: 11,
    color: "var(--text-3, #8a8398)",
    display: "block",
    marginTop: 8,
  };
  const anchored = (name: string) => name in fields;

  return (
    <div
      style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0,
        width: 320,
        background: "var(--surface-1, #1a1420)",
        borderLeft: "1px solid var(--border, #3a2f4a)",
        padding: 16,
        overflowY: "auto",
        zIndex: 40,
        boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <strong style={{ flex: 1 }}>New {dbType}</strong>
        <button onClick={onClose} style={{ cursor: "pointer" }}>✕</button>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-3, #8a8398)", margin: "0 0 8px" }}>
        Anything you set is a <b>locked anchor</b> — the skeleton rolls the
        rest around it (dependent stats follow your anchors).
      </p>
      {err && <p style={{ color: "#e0453a", fontSize: 12 }}>{err}</p>}
      {!spec && !err && <p style={{ fontSize: 12 }}>Loading field spec…</p>}
      {spec && (
        <>
          <label style={label}>
            name {anchored("name") && "🔒"}
            <input
              style={{ width: "100%" }}
              value={(fields.name as string) ?? ""}
              onChange={(e) => set("name", e.target.value)}
              placeholder="(let the LLM name it)"
            />
          </label>
          <label style={label}>
            flavor {anchored("flavor") && "🔒"}
            <input
              style={{ width: "100%" }}
              value={(fields.flavor as string) ?? ""}
              onChange={(e) => set("flavor", e.target.value)}
              placeholder="(let the LLM write it)"
            />
          </label>
          {spec.skeleton_fields.map((f) => (
            <label key={f.name} style={label}>
              {f.name} {anchored(f.name) && "🔒"}
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
                  <option value="">roll 🎲</option>
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
                  placeholder={`roll 🎲 [${f.range?.[0]}–${f.range?.[1]}]`}
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
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button disabled={busy} onClick={() => create(false)} style={{ cursor: "pointer" }}>
              {busy ? "…" : "Create (roll only)"}
            </button>
            <button
              disabled={busy}
              onClick={() => create(true)}
              style={{
                cursor: "pointer",
                background: "var(--accent, #e2b714)",
                color: "#1a1208",
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                padding: "4px 10px",
              }}
            >
              {busy ? "…" : "Create + LLM complete"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
