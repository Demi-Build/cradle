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
export type ValidationCheck = {
  name: string;
  problems: string[];
  repairs?: string[];
  notes?: string[];
  count?: number;
};
export type LibraryEntry = {
  library_id: string;
  ts: string;
  kind: string;
  name: string;
  tags: string[];
  source: { pack: string; world: string; artifact_id: string; target: string };
  objects: Record<string, string>;
  meta: Record<string, unknown>;
  preview: string;
  actor: string;
};
export type LineageNode = {
  id: string;
  facet: string;
  op: string;
  source: string;
  actor: string;
  ts: string;
  gen: { llm_model?: string; prompt?: string } | null;
  artifacts: string[];
  current_of: string[];
  usage: Record<string, string[]>;
  detail: Record<string, unknown>;
  depth: number;
};
export type LineageEdge = {
  from: string;
  to: string;
  op: string;
  kind: string;
  actor: string;
  ts: string;
};
export type LineageTree = {
  artifact_id: string;
  root_id: string | null;
  requested_node_id: string | null;
  nodes: LineageNode[];
  edges: LineageEdge[];
  metadata: { total_nodes: number; max_depth: number; pruned: boolean };
};
export type ValidationReport = {
  level_id: string;
  stage_id?: string;
  display_name?: string;
  ok: boolean;
  checks: ValidationCheck[];
  /** Placement defects generation would relocate/drop — level still plays. */
  repair_count?: number;
  rooms?: ValidationReport[];
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
  dbUpdate: (path: string, entityType: string, id: string, set: Record<string, unknown>) =>
    invoke<{ row?: Record<string, unknown>; changed: Record<string, unknown>; warnings?: string[] }>(
      "db_update", { path, entityType, id, set }),
  dbSchema: (path: string, entityType: string) =>
    invoke<{ source: string; schema: { fields: Record<string, Record<string, unknown>> } }>(
      "db_schema", { path, entityType }),
  dbUpdateSchema: (path: string, entityType: string, set: Record<string, unknown>) =>
    invoke<{ source: string; schema: { fields: Record<string, Record<string, unknown>> } }>(
      "db_update_schema", { path, entityType, set }),
  generateAsset: (path: string, target: string, imageBackend?: string, musicBackend?: string, sfxBackend?: string) =>
    invoke<unknown>("generate_asset", { path, target, imageBackend, musicBackend, sfxBackend }),
  animateAsset: (path: string, target: string, imageBackend?: string, vlmBackend?: string, reuseSpec = false) =>
    invoke<unknown>("animate_asset", { path, target, imageBackend, vlmBackend, reuseSpec }),
  validateLevel: (path: string, levelId: string) =>
    invoke<ValidationReport>("validate_level", { path, levelId }),
  playLevel: (path: string, levelId: string, plain = false) =>
    invoke<{ launched: boolean; engine?: string; note?: string }>("play_level", { path, levelId, plain }),
  playGame: (path: string, levelId?: string) =>
    invoke<{ launched: boolean; engine?: string; note?: string }>("play_game", { path, levelId }),
  assetLineage: (path: string, target: string) =>
    invoke<LineageTree>("asset_lineage", { path, target }),
  assetRestore: (path: string, target: string, to: string) =>
    invoke<{ artifact_id: string; kind: string }>("asset_restore", { path, target, to }),
  objectCat: (path: string, hash: string) =>
    invoke<{ hash: string; size: number; bytes_b64: string }>("object_cat", { path, hash }),
  libraryList: (kind?: string, query?: string, project?: string) =>
    invoke<{ entries: LibraryEntry[]; count: number; root: string }>(
      "library_list", { kind, query, project }),
  libraryPublish: (path: string, target: string) =>
    invoke<LibraryEntry & { deduped?: boolean }>("library_publish", { path, target }),
  libraryImport: (path: string, id: string, into?: string) =>
    invoke<{ kind: string; id?: string; library_id: string }>(
      "library_import", { path, id, into }),
  libraryCat: (hash: string) =>
    invoke<{ hash: string; size: number; bytes_b64: string }>("library_cat", { hash }),
  assetAssign: (path: string, source: string, to: string) =>
    invoke<{ from: string; to: string; sprite_hash: string }>(
      "asset_assign", { path, source, to }),
  resolveAsset: (path: string, hint: string) =>
    invoke<string | null>("resolve_asset", { path, hint }),
  getBundledDemoPath: () => invoke<string>("get_bundled_demo_path"),
};
