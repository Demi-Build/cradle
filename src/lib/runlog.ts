/** Colour + label for a run status (canon's words, in its order). */
export function runStatusStyle(status: string): [string, string] {
  switch (status) {
    case "failed":
      return ["failed", "var(--err)"];
    case "incomplete":
      return ["no end", "var(--err)"];
    case "cancelled":
      return ["stopped", "var(--fg-dim)"];
    case "warnings":
      return ["warnings", "var(--accent)"];
    case "ok":
      return ["ok", "var(--ok)"];
    default:
      return [status, "var(--fg-dim)"];
  }
}
