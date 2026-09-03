// "Show me" — the `show_user` UI tool and every write card's deep-link
// (Phase 1 §4.E; agent-panel README §5, §8). One function turns a target
// into the editor's existing selection (`useStore.select`, the same
// `{kind, typeId, id, tab}` the LeftNav and History links use) and asks the
// open view to pulse the affected thing once. Nothing here touches disk.

import { useStore, type Selection } from "../store";

/** What a Show-me link points at — the editor's own selection vocabulary.
 *  `tab` reuses DetailPane's tab ids (`history`, `animation`, …). */
export type ShowMeTarget =
  | { kind: "entity"; typeId: string; id: string; tab?: string }
  | { kind: "worldmap" }
  | { kind: "library" }
  | { kind: "bible" };

/** A `show_user` tool input (`{selection: entity|level|tab|worldmap, ...}`)
 *  read into a target. Returns null for a shape this build cannot navigate
 *  — the tool still acks; the line says "could not navigate". */
export function showMeFromToolInput(input: Record<string, unknown>): ShowMeTarget | null {
  const sel = typeof input.selection === "string" ? input.selection : "";
  const typeId =
    typeof input.type === "string"
      ? input.type
      : typeof input.typeId === "string"
        ? input.typeId
        : "";
  const id =
    typeof input.id === "string"
      ? input.id
      : typeof input.level_id === "string"
        ? input.level_id
        : "";
  const tab = typeof input.tab === "string" ? input.tab : undefined;
  if (sel === "worldmap") return { kind: "worldmap" };
  if (sel === "library") return { kind: "library" };
  if (sel === "bible") return { kind: "bible" };
  if (sel === "level" && id) return { kind: "entity", typeId: "levels", id, tab };
  if ((sel === "entity" || sel === "tab" || !sel) && typeId && id)
    return { kind: "entity", typeId, id, tab };
  return null;
}

/** Navigate the editor to `target` and pulse it (README §8: "opens the
 *  artifact, selects the affected thing, and pulses the selection once"). */
export function showMe(target: ShowMeTarget): void {
  const st = useStore.getState();
  const selection: Selection =
    target.kind === "entity"
      ? { kind: "entity", typeId: target.typeId, id: target.id, tab: target.tab }
      : { kind: target.kind };
  st.select(selection);
  st.setAgentPulse({ target, ts: Date.now() });
}
