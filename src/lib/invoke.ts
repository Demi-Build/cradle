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
  readWorldJson: (path: string, name: string) => invoke<unknown>("read_world_json", { path, name }),
  listEntities: (path: string, typeId: string) =>
    invoke<EntityRef[]>("list_entities", { path, typeId }),
  listEntityRows: (path: string, typeId: string) =>
    invoke<EntityRow[]>("list_entity_rows", { path, typeId }),
  getEntity: (path: string, typeId: string, id: string) =>
    invoke<unknown>("get_entity", { path, typeId, id }),
  exportLevel: (path: string, levelId: string) =>
    invoke<unknown>("export_level", { path, levelId }),
  saveLevelEdit: (path: string, levelId: string, edit: Record<string, unknown>) =>
    invoke<unknown>("save_level_edit", { path, levelId, edit }),
  baselineLevel: (path: string, levelId: string) =>
    invoke<unknown>("baseline_level", { path, levelId }),
  saveLevelGrids: (path: string, levelId: string, collision: number[][]) =>
    invoke<unknown>("save_level_grids", { path, levelId, collision }),
  createLevel: (path: string, stageId: string, width: number, height: number) =>
    invoke<{ level_id: string }>("create_level", { path, stageId, width, height }),
  publishLevel: (path: string, levelId: string, position: number | null, remove: boolean) =>
    invoke<unknown>("publish_level", { path, levelId, position, remove }),
  replaceAsset: (path: string, target: string, file: string) =>
    invoke<unknown>("replace_asset", { path, target, file }),
  dbTypes: (path: string) => invoke<unknown>("db_types", { path }),
  dbNew: (path: string, entityType: string, fields: Record<string, unknown>, complete: boolean, llmBackend?: string) =>
    invoke<{ id: string; row: Record<string, unknown> }>("db_new", { path, entityType, fields, complete, llmBackend }),
  dbComplete: (path: string, entityType: string, id: string, locked: string[], llmBackend?: string) =>
    invoke<{ id: string; row: Record<string, unknown> }>("db_complete", { path, entityType, id, locked, llmBackend }),
  generateAsset: (path: string, target: string, imageBackend?: string, musicBackend?: string, sfxBackend?: string) =>
    invoke<unknown>("generate_asset", { path, target, imageBackend, musicBackend, sfxBackend }),
  animateAsset: (path: string, target: string, imageBackend?: string, vlmBackend?: string, reuseSpec = false) =>
    invoke<unknown>("animate_asset", { path, target, imageBackend, vlmBackend, reuseSpec }),
  resolveAsset: (path: string, hint: string) =>
    invoke<string | null>("resolve_asset", { path, hint }),
  getBundledDemoPath: () => invoke<string>("get_bundled_demo_path"),
};
