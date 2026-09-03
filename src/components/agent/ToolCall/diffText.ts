// The two text diffs' pure helpers (row P1-A5, README §5) — beside
// `DiffCode.tsx` / `DiffFields.tsx` so those files export only components.

/** Which kind of unified-diff line this is (hunk header, add, delete, ctx). */
export function kindOf(line: string): "hunk" | "add" | "del" | "ctx" {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return "ctx";
}

/** One field value as the fields diff prints it (`—` for absent). */
export function fmt(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map(fmt).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
