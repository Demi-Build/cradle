import { invoke } from "@tauri-apps/api/core";

export type EntityTypeCount = { type_id: string; count: number };
export type WorldSummary = {
  path: string;
  name: string;
  entity_counts: EntityTypeCount[];
};
export type EntityRef = {
  type_id: string;
  id: string;
  name: string | null;
};
export type EntityRow = {
  id: string;
  data: Record<string, unknown>;
};

export const api = {
  loadWorld: (path: string) => invoke<WorldSummary>("load_world", { path }),
  getWorldBible: (path: string) => invoke<unknown>("get_world_bible", { path }),
  listEntities: (path: string, typeId: string) =>
    invoke<EntityRef[]>("list_entities", { path, typeId }),
  listEntityRows: (path: string, typeId: string) =>
    invoke<EntityRow[]>("list_entity_rows", { path, typeId }),
  getEntity: (path: string, typeId: string, id: string) =>
    invoke<unknown>("get_entity", { path, typeId, id }),
  resolveAsset: (path: string, hint: string) =>
    invoke<string | null>("resolve_asset", { path, hint }),
};
