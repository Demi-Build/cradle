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
