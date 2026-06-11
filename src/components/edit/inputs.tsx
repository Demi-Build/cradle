import type { ScalarType } from "./draftHelpers";

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
