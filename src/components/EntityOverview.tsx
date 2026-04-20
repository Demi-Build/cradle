import type { ReactNode } from "react";
import { Portrait } from "./Portrait";

type Json = Record<string, unknown>;

const SCALAR_TYPES = ["string", "number", "boolean"];

const PORTRAIT_FIELDS = ["profile_image", "portrait_path"];

// Fields rendered verbatim as full-width prose, not as a key/value row.
const PROSE_FIELDS = new Set([
  "backstory",
  "description",
  "desc",
  "personality",
  "personality_notes",
  "flavor_text",
  "opening_greeting",
  "exhausted_dialogue",
  "hobby",
  "portrait_prompt",
]);

// Fields we never want in the overview (handled by other tabs, or noise).
const HIDE_FIELDS = new Set([
  "dialogue_tree",
  "profile_image",
  "portrait_path",
  "name",
  "id",
]);

function isScalar(v: unknown): v is string | number | boolean {
  return SCALAR_TYPES.includes(typeof v) || v === null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function labelFor(key: string): string {
  return key.replace(/_/g, " ");
}

export function EntityOverview({ data, typeId, entityId }: { data: Json; typeId: string; entityId: string }) {
  const name =
    (data.name as string | undefined) ??
    (data.environment_name as string | undefined) ??
    (data.id as string | number | undefined)?.toString() ??
    entityId ??
    "(unnamed)";
  const portraitHint =
    (data[PORTRAIT_FIELDS[0]] as string | undefined) ??
    (data[PORTRAIT_FIELDS[1]] as string | undefined) ??
    (typeId === "rooms" ? `${entityId}_map.png` : null);

  const prose: Array<[string, string]> = [];
  const scalars: Array<[string, string]> = [];
  const complex: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(data)) {
    if (HIDE_FIELDS.has(key)) continue;
    if (PROSE_FIELDS.has(key) && typeof value === "string" && value.length > 60) {
      prose.push([key, value]);
    } else if (isScalar(value)) {
      scalars.push([key, formatValue(value)]);
    } else {
      complex.push([key, value]);
    }
  }

  return (
    <div className="overview">
      <header className="overview-header">
        <Portrait hint={portraitHint} alt={name} size={160} />
        <div className="overview-titleblock">
          <h2 className="overview-name">{name}</h2>
          <div className="overview-sub">
            <span className="chip">{typeId}</span>
            {typeof data.id !== "undefined" && <span className="chip chip-muted">id {String(data.id)}</span>}
            {typeof data.type === "string" && <span className="chip chip-muted">{data.type}</span>}
          </div>
        </div>
      </header>

      {prose.length > 0 && (
        <section className="overview-prose">
          {prose.map(([k, v]) => (
            <div key={k} className="prose-block">
              <div className="prose-label">{labelFor(k)}</div>
              <div className="prose-body">{v}</div>
            </div>
          ))}
        </section>
      )}

      {scalars.length > 0 && (
        <section className="overview-fields">
          {scalars.map(([k, v]) => (
            <div key={k} className="field-row">
              <div className="field-key">{labelFor(k)}</div>
              <div className="field-val">{v}</div>
            </div>
          ))}
        </section>
      )}

      {complex.length > 0 && (
        <section className="overview-complex">
          {complex.map(([k, v]) => (
            <ComplexField key={k} name={k} value={v} />
          ))}
        </section>
      )}
    </div>
  );
}

function ComplexField({ name, value }: { name: string; value: unknown }): ReactNode {
  return (
    <details className="complex-field">
      <summary>{labelFor(name)}</summary>
      <pre className="complex-json">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
