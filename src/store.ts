import { create } from "zustand";
import type { EntityRef, WorldSummary } from "./lib/invoke";

export type Selection =
  | { kind: "none" }
  | { kind: "bible" }
  | { kind: "type"; typeId: string }
  | { kind: "entity"; typeId: string; id: string };

type EntitiesByType = Record<string, EntityRef[]>;

type Store = {
  worldPath: string;
  world: WorldSummary | null;
  entities: EntitiesByType;
  selection: Selection;
  error: string | null;
  setWorldPath: (p: string) => void;
  setWorld: (w: WorldSummary | null) => void;
  setEntities: (typeId: string, refs: EntityRef[]) => void;
  select: (s: Selection) => void;
  setError: (e: string | null) => void;
};

export const useStore = create<Store>((set) => ({
  worldPath: "",
  world: null,
  entities: {},
  selection: { kind: "none" },
  error: null,
  setWorldPath: (p) => set({ worldPath: p }),
  setWorld: (w) => set({ world: w, entities: {}, selection: w ? { kind: "bible" } : { kind: "none" } }),
  setEntities: (typeId, refs) =>
    set((s) => ({ entities: { ...s.entities, [typeId]: refs } })),
  select: (s) => set({ selection: s }),
  setError: (e) => set({ error: e }),
}));
