import { create } from "zustand";
import type { EntityRef, WorldSummary } from "./lib/invoke";

export type Selection =
  | { kind: "none" }
  | { kind: "bible" }
  | { kind: "type"; typeId: string }
  | { kind: "entity"; typeId: string; id: string };

type EntitiesByType = Record<string, EntityRef[]>;

export type LightboxImage = { src: string; alt: string };

type Store = {
  worldPath: string;
  world: WorldSummary | null;
  entities: EntitiesByType;
  selection: Selection;
  error: string | null;
  lightbox: LightboxImage | null;
  setWorldPath: (p: string) => void;
  setWorld: (w: WorldSummary | null) => void;
  setEntities: (typeId: string, refs: EntityRef[]) => void;
  select: (s: Selection) => void;
  setError: (e: string | null) => void;
  openLightbox: (img: LightboxImage) => void;
  closeLightbox: () => void;
};

export const useStore = create<Store>((set) => ({
  worldPath: "",
  world: null,
  entities: {},
  selection: { kind: "none" },
  error: null,
  lightbox: null,
  setWorldPath: (p) => set({ worldPath: p }),
  setWorld: (w) => set({ world: w, entities: {}, selection: w ? { kind: "bible" } : { kind: "none" } }),
  setEntities: (typeId, refs) =>
    set((s) => ({ entities: { ...s.entities, [typeId]: refs } })),
  select: (s) => set({ selection: s }),
  setError: (e) => set({ error: e }),
  openLightbox: (img) => set({ lightbox: img }),
  closeLightbox: () => set({ lightbox: null }),
}));
