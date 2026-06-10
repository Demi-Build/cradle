import { useStore } from "../../store";

export type ScalarType = "string" | "number" | "boolean";

export function inferType(v: unknown): ScalarType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

// Editors always produce a fresh top-level object — dirty detection in the
// store relies on referential inequality.
export function setField<T extends Record<string, unknown>>(
  data: T,
  key: string,
  value: unknown,
): T {
  if (value === undefined) {
    const { [key]: _drop, ...rest } = data;
    void _drop;
    return rest as T;
  }
  return { ...data, [key]: value };
}

export function useDraftUpdater(typeId: string, entityId: string) {
  const setEntityDraft = useStore((s) => s.setEntityDraft);
  return (next: unknown) => setEntityDraft(typeId, entityId, next);
}

// Ghost input — inherits typography from its parent display container so the
// edit-mode layout looks identical to the read view. Affordance is purely
// a dotted accent underline (always on) + accent outline on focus.
export function ScalarInput({
  value,
  type,
  onChange,
  className,
}: {
  value: string | number | boolean | null | undefined;
  type: ScalarType;
  onChange: (next: string | number | boolean | null | undefined) => void;
  className?: string;
}) {
  if (type === "boolean") {
    // Checkboxes don't get the ghost treatment (no text to inherit) — we
    // leave callers to render their own boolean affordance (chip toggles,
    // badges, etc.) and only fall through to <input type="checkbox"> when
    // someone needs a literal checkbox.
    return (
      <input
        type="checkbox"
        className={className}
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  const cls = ["ghost-input", className].filter(Boolean).join(" ");
  if (type === "number") {
    return (
      <input
        type="number"
        className={cls}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const n = Number(raw);
          onChange(Number.isNaN(n) ? value : n);
        }}
      />
    );
  }
  return (
    <input
      type="text"
      className={cls}
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ProseInput({
  value,
  onChange,
  rows,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  className?: string;
}) {
  // Auto-size so the textarea matches the prose it replaces — never tinier
  // than 2 lines, never larger than 12 unless the caller asks.
  const auto = Math.max(2, Math.min(12, Math.ceil((value.length || 1) / 60)));
  const cls = ["ghost-textarea", className].filter(Boolean).join(" ");
  return (
    <textarea
      className={cls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows ?? auto}
    />
  );
}
