import { invoke } from "@tauri-apps/api/core";

/** How the animation viewer plays an actor. `grid` puts every state side by
 *  side on its own clock — right for judging ONE pose. `sequence` walks the
 *  storyboard through the game's own state ladder, so `jump → fall → land`
 *  plays as the single motion it is. A toggle, not a replacement. */
export type AnimPreviewMode = "grid" | "sequence";

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
export type GenLevelOpts = {
  brief?: string;
  difficulty?: number | null;
  width?: number | null;
  height?: number | null;
  axis?: string | null;
  enemies?: number | null;
  items?: number | null;
  seed?: string | null;
  llmBackend?: string;
  /** Edited SYSTEM prompt for the layout agent (this call only). */
  systemOverride?: string | null;
};
/** Which generator's prompt to preview / override. */
export type PromptKind = "layout" | "improve" | "enemy" | "item" | "sprite" | "animate" | "music";
/** The default prompt a generator would send (`canon prompt show`).
 *  LLM kinds split system (editable) / user_message (context, rebuilt per call);
 *  image/audio/vlm kinds have no such split and carry one `prompt` string.
 *  `vlm` is the animate path's motion-spec AUTHORING prompt — a vision call,
 *  so it takes the single-prompt shape. */
export type PromptPreview = {
  kind: PromptKind;
  label: string;
  mode: "llm" | "image" | "audio" | "vlm";
  system?: string;
  user_message?: string;
  prompt?: string;
};
/** Canon's full `asset generate` knob set. Every field is optional and blank
 *  values are dropped Rust-side, so `{}` is byte-identical to the old call. */
export type AssetGenOpts = {
  imageBackend?: string;
  imageModel?: string;
  imageEditModel?: string;
  imageEditBackend?: string;
  musicBackend?: string;
  sfxBackend?: string;
  promptOverride?: string | null;
};
/** Canon's full `asset animate` knob set. NOTE only `fal` and `fake`
 *  implement ImageEditBackend, so only they can animate — anything else
 *  draws nothing and still bills the VLM. `promptOverride` edits the motion-
 *  spec authoring prompt and is inert under `reuseSpec`. */
export type AnimateOpts = {
  imageBackend?: string;
  imageModel?: string;
  imageEditModel?: string;
  imageEditBackend?: string;
  vlmBackend?: string;
  vlmModel?: string;
  reuseSpec?: boolean;
  promptOverride?: string | null;
};
export type GenLevelResult = {
  level_id: string;
  stage_id: string;
  ok: boolean;
  repair_count: number;
  layout_fallback: boolean;
  seed: string;
  cost?: OpCost;
  warnings: string[];
};
/** Actual measured LLM spend of one op (real returned tokens × price). */
export type OpCost = {
  usd: number;
  input_tokens: number;
  output_tokens: number;
  calls: number;
  backend: string;
};
/** A user-authored music region on a level (cells along its layout axis). */
export type MusicSection = {
  start: number;
  end: number;
  music_path?: string;
  music_hash?: string;
  name?: string;
};
export type MusicTrack = { path: string; label: string };
export type MusicGenResult = {
  level_id: string;
  stage_id: string;
  target: string;
  music_path: string;
  cost?: OpCost;
  warnings: string[];
};
export type Usd = { best: number; worst: number };
export type EstimateByTask = {
  calls: number;
  model: string;
  input_tokens_per_call: number;
  output_tokens_per_call: number;
  usd: number;
};
/** Pre-run cost forecast — backend-aware (fake/none categories priced at $0,
 *  counts still shown). Same shape from the world and per-level verbs. */
export type CostEstimate = {
  scope: string;
  backends: Record<string, string>;
  llm: { by_task: Record<string, EstimateByTask>; calls: number; usd: Usd };
  assets: {
    images: { count: number; usd: number };
    music: { count: number; usd: number };
    sfx: { count: number; usd: number };
    vlm: { usd?: Usd } & Record<string, unknown>;
    usd: Usd;
  };
  total_usd: Usd;
  warnings: string[];
};
export type SpendEntry = {
  schema?: string;
  ts?: string;
  op: string;
  scope?: string;
  level_id?: string;
  backends?: Record<string, string>;
  estimate?: Usd;
  actual_usd?: number;
  tokens?: { input: number; output: number; calls: number };
};
export type SpendByOp = { count: number; actual_usd: number; estimate_usd: number };
export type SpendSummary = {
  count: number;
  total_actual_usd: number;
  total_estimate_usd: number;
  by_op: Record<string, SpendByOp>;
  entries: SpendEntry[];
};
/** A background generation job's lifecycle status. `queued`/`running` are live
 *  (in-memory); `ok`/`no_change`/`failed` are terminal (also written to the
 *  durable ledger). `ok` = ran and changed something; `no_change` = ran, same. */
export type JobStatus = "queued" | "running" | "ok" | "no_change" | "failed";
/** One background generation job the tray tracks. The frontend owns the id +
 *  metadata; the Rust worker's `job-updated` events carry only {id,status,result}. */
export type Job = {
  id: string;
  op: string; // improve | layout | generate | enemies | items | sprite | animate | music | audio
  label: string; // human summary, e.g. "Improve l1"
  target: string; // artifact id to navigate to on View (level id / enemy id / stage id)
  targetType: string; // nav typeId: levels | enemies | items | audio
  scope?: string; // level | section | stage | asset
  backends?: Record<string, string>;
  estimate?: Usd;
  status: JobStatus;
  changed?: boolean;
  cost?: OpCost;
  error?: string;
  result?: Record<string, unknown>; // raw canon op result (carries level_id/id/changed/…)
  ts: number; // enqueue time (ms)
  endedAt?: number;
};
/** Durable job-ledger entry (`.canon/jobs.jsonl`, written via `canon jobs record`). */
export type JobEntry = {
  schema?: string;
  ts?: string;
  job_id: string;
  op: string;
  scope?: string;
  target?: string;
  target_type?: string;
  status: string;
  backends?: Record<string, string>;
  estimate?: Usd;
  actual_usd?: number;
  duration_ms?: number;
  changed?: boolean;
  changed_artifacts?: string[];
  error?: string;
};
export type JobSummary = {
  count: number;
  by_op: Record<string, number>;
  by_status: Record<string, number>;
  entries: JobEntry[];
};
/** What an enqueuing gen command returns immediately (before the job runs). */
export type QueuedAck = { job_id: string; status: string };
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
/** One frame's measured opaque content box, in FRAME pixel space. `null` when
 *  the frame has no opaque pixel at all. */
export type AnimFrameBox = {
  index: number;
  box: { x: number; y: number; w: number; h: number } | null;
  /** How far the content's feet sit above the cell's bottom edge. */
  foot_gap?: number;
};
export type AnimState = {
  state: string;
  frames: number;
  frame_width: number;
  frame_height: number;
  path: string;
  path_abs: string | null;
  loop: string;
  durations_ms: number[];
  /** Authored per-frame nudges, or null when generation's seating is untouched. */
  offsets: [number, number][] | null;
  boxes: AnimFrameBox[];
  widest: number;
  tallest: number;
  /** Content reaches the cell edge. */
  flush: boolean;
  /** Feet moving between frames of one state — reads as bobbing. */
  foot_wander: number;
};
/** One state's motion, as authored by a previous animate run: actor-specific,
 *  and therefore truer than the generic brief. */
export type MotionSpecEntry = { frames?: number; motion?: string };
export type AnimationInfo = {
  target: string;
  label: string;
  sprite_dir: string;
  has_atlas: boolean;
  atlas_path_abs: string | null;
  states: AnimState[];
  flush_states: string[];
  /** More than one flush state ⇒ the states were squared separately. */
  independently_sized: boolean;
  /** What an animate run works FROM — the sprite it edits, the states it will
   *  author, the generic per-state brief, and any spec already stored on this
   *  actor. `spec` is empty for the player in runner-built packs (no bible). */
  base_sprite: string;
  base_sprite_abs: string | null;
  planned_states: string[];
  briefs: Record<string, string>;
  spec: Record<string, MotionSpecEntry>;
};
export type AnimEditPatch = {
  offsets?: [number, number][] | null;
  durations_ms?: number[];
  loop?: string;
};

/** One runtime file's standing versus canon's current engine template.
 *  `modified` = differs from its own stamp, i.e. hand-edited — sync refuses
 *  those by name. `unstamped` = the pack predates stamping, so a hand edit
 *  can't be told from an old build. */
export type EngineFileState = "current" | "stale" | "missing" | "modified" | "unstamped";
export type EngineStatus = {
  pack: string;
  has_engine: boolean;
  stamped: boolean;
  current: boolean;
  template_hash: string;
  pack_hash: string | null;
  files: { path: string; state: EngineFileState }[];
  behind: string[];
  modified: string[];
};
export type EngineSyncResult = {
  engine: "updated" | "no_change" | "dry_run";
  written?: string[];
  would_write?: string[];
  refused: string[];
  template_hash?: string;
};
export type WorldMapNode = {
  level_id: string;
  display_name: string | null;
  stage_id: string;
  pos: [number, number];
  /** Present only once a human has placed it. */
  origin?: "manual";
  /** `planned` = a draft level: on the map, not yet in the progression. */
  status?: "planned";
  /** Detail the map shows without opening the level. Absent when the level
   *  file couldn't be read (a half-written pack still renders). */
  size?: string;
  entities?: number;
  items?: number;
  /** Secret rooms INSIDE this level. They are deliberately not map nodes. */
  rooms?: string[];
  /** Which area defaults this level actually departs from — reported from
   *  what's on disk, never a setting cradle invented. */
  overrides?: string[];
};
export type WorldMapEdge = {
  a: string;
  b: string;
  kind: "path" | "one" | "lock" | "new";
  condition?: string;
  stop?: string;
};
export type WorldMapArea = {
  stage_id: string;
  index: number;
  theme: string;
  biome: string;
  level_ids: string[];
  music: string | null;
  /** Defaults every level inside inherits: the area's tile set and roster. */
  blocks?: string;
  enemy_pool?: string[];
  boss?: string;
};
export type WorldMap = {
  world: string;
  nodes: WorldMapNode[];
  edges: WorldMapEdge[];
  areas: WorldMapArea[];
  locked: boolean;
  manual_count: number;
};
export type WorldMapEdit = {
  nodes?: Record<string, { pos: [number, number] } | null>;
  edges?: WorldMapEdge[];
  locked?: boolean;
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
  newProject: (
    parentDir: string,
    name: string,
    opts?: {
      stages?: number;
      levels?: number;
      enemies?: number;
      items?: number;
      llmBackend?: string;
      imageBackend?: string;
      musicBackend?: string;
      sfxBackend?: string;
      vlmBackend?: string;
    },
  ) =>
    invoke<{ pack_dir: string; world: string; seed: string }>("new_project", {
      parentDir,
      name,
      stages: opts?.stages ?? null,
      levels: opts?.levels ?? null,
      enemies: opts?.enemies ?? null,
      items: opts?.items ?? null,
      llmBackend: opts?.llmBackend ?? null,
      imageBackend: opts?.imageBackend ?? null,
      musicBackend: opts?.musicBackend ?? null,
      sfxBackend: opts?.sfxBackend ?? null,
      vlmBackend: opts?.vlmBackend ?? null,
    }),
  regenerateLayout: (
    path: string,
    levelId: string,
    opts: {
      brief?: string;
      difficulty?: number | null;
      width?: number | null;
      height?: number | null;
      axis?: string | null;
      seed?: string | null;
      llmBackend?: string;
      systemOverride?: string | null;
      jobId: string;
    },
  ) =>
    invoke<QueuedAck>("regenerate_layout", {
      path,
      levelId,
      brief: opts.brief ?? "",
      difficulty: opts.difficulty ?? null,
      width: opts.width ?? null,
      height: opts.height ?? null,
      axis: opts.axis ?? null,
      seed: opts.seed ?? null,
      llmBackend: opts.llmBackend ?? "fake",
      systemOverride: opts.systemOverride ?? null,
      jobId: opts.jobId,
    }),
  /** Context-aware IMPROVE: the LLM sees the current level + an instruction and
   *  re-authors it in place (keeps dims/axis). Placements are KEPT by default
   *  (validate surfaces any that no longer fit) or re-adapted when rerollPlacements.
   *  Runs as a background job — returns a queued ack, not the result. */
  improveLevel: (
    path: string,
    levelId: string,
    opts: {
      instruction: string;
      fixProblems?: boolean;
      rerollPlacements?: boolean;
      seed?: string | null;
      llmBackend?: string;
      systemOverride?: string | null;
      jobId: string;
    },
  ) =>
    invoke<QueuedAck>("improve_layout", {
      path,
      levelId,
      instruction: opts.instruction,
      fixProblems: opts.fixProblems ?? false,
      rerollPlacements: opts.rerollPlacements ?? false,
      seed: opts.seed ?? null,
      llmBackend: opts.llmBackend ?? "fake",
      systemOverride: opts.systemOverride ?? null,
      jobId: opts.jobId,
    }),
  publishLevel: (path: string, levelId: string, position: number | null, remove: boolean) =>
    invoke<unknown>("publish_level", { path, levelId, position, remove }),
  generateLevel: (path: string, stageId: string, opts: GenLevelOpts & { jobId: string }) =>
    invoke<QueuedAck>("generate_level", {
      path,
      stageId,
      brief: opts.brief ?? "",
      difficulty: opts.difficulty ?? null,
      width: opts.width ?? null,
      height: opts.height ?? null,
      axis: opts.axis ?? null,
      enemies: opts.enemies ?? null,
      items: opts.items ?? null,
      seed: opts.seed ?? null,
      llmBackend: opts.llmBackend ?? "fake",
      systemOverride: opts.systemOverride ?? null,
      jobId: opts.jobId,
    }),
  placeEnemies: (
    path: string,
    levelId: string,
    jobId: string,
    enemies?: number,
    seed?: string,
    llmBackend?: string,
  ) => invoke<QueuedAck>("place_enemies", { path, levelId, enemies, seed, llmBackend, jobId }),
  placeItems: (
    path: string,
    levelId: string,
    jobId: string,
    items?: number,
    seed?: string,
    llmBackend?: string,
  ) => invoke<QueuedAck>("place_items", { path, levelId, items, seed, llmBackend, jobId }),
  estimateWorld: (opts: {
    stages: number;
    levels: number;
    enemies: number;
    items: number;
    llmBackend: string;
    imageBackend: string;
    musicBackend: string;
    sfxBackend: string;
    vlmBackend: string;
  }) =>
    invoke<{ result: string; estimate: CostEstimate }>("estimate_world", {
      stages: opts.stages,
      levels: opts.levels,
      enemies: opts.enemies,
      items: opts.items,
      llmBackend: opts.llmBackend,
      imageBackend: opts.imageBackend,
      musicBackend: opts.musicBackend,
      sfxBackend: opts.sfxBackend,
      vlmBackend: opts.vlmBackend,
    }),
  estimateLevel: (path: string, levelId: string, op: string, llmBackend: string, width?: number) =>
    invoke<{ result: string; estimate: CostEstimate }>("estimate_level", {
      path,
      levelId,
      op,
      llmBackend,
      width: width ?? null,
    }),
  spendRecord: (path: string, entry: SpendEntry) =>
    invoke<{ result: string; entry: SpendEntry }>("spend_record", { path, entry }),
  spendList: (path: string) =>
    invoke<{ result: string; spend: SpendSummary }>("spend_list", { path }),
  jobRecord: (path: string, entry: JobEntry) =>
    invoke<{ result: string; entry: JobEntry }>("jobs_record", { path, entry }),
  jobList: (path: string) => invoke<{ result: string; jobs: JobSummary }>("jobs_list", { path }),
  generateLevelMusic: (
    path: string,
    levelId: string,
    opts: {
      brief?: string;
      section?: number | null;
      musicBackend?: string;
      seconds?: number | null;
      /** Edited music prompt (this call only); wins over `brief`. */
      promptOverride?: string | null;
      jobId: string;
    },
  ) =>
    invoke<QueuedAck>("generate_level_music", {
      path,
      levelId,
      brief: opts.brief ?? "",
      section: opts.section ?? null,
      musicBackend: opts.musicBackend ?? "fake",
      seconds: opts.seconds ?? null,
      promptOverride: opts.promptOverride ?? null,
      jobId: opts.jobId,
    }),
  listMusicTracks: (path: string) =>
    invoke<{ tracks: MusicTrack[] }>("list_music_tracks", { path }),
  replaceAsset: (path: string, target: string, file: string) =>
    invoke<unknown>("replace_asset", { path, target, file }),
  dbTypes: (path: string) => invoke<unknown>("db_types", { path }),
  dbNew: (
    path: string,
    entityType: string,
    fields: Record<string, unknown>,
    complete: boolean,
    llmBackend?: string,
    systemOverride?: string | null,
  ) =>
    invoke<{ id: string; row: Record<string, unknown> }>("db_new", {
      path,
      entityType,
      fields,
      complete,
      llmBackend,
      systemOverride: systemOverride ?? null,
    }),
  dbComplete: (
    path: string,
    entityType: string,
    id: string,
    locked: string[],
    llmBackend?: string,
    systemOverride?: string | null,
  ) =>
    invoke<{ id: string; row: Record<string, unknown> }>("db_complete", {
      path,
      entityType,
      id,
      locked,
      llmBackend,
      systemOverride: systemOverride ?? null,
    }),
  dbUpdate: (path: string, entityType: string, id: string, set: Record<string, unknown>) =>
    invoke<{
      row?: Record<string, unknown>;
      changed: Record<string, unknown>;
      warnings?: string[];
    }>("db_update", { path, entityType, id, set }),
  dbSchema: (path: string, entityType: string) =>
    invoke<{ source: string; schema: { fields: Record<string, Record<string, unknown>> } }>(
      "db_schema",
      { path, entityType },
    ),
  dbUpdateSchema: (path: string, entityType: string, set: Record<string, unknown>) =>
    invoke<{ source: string; schema: { fields: Record<string, Record<string, unknown>> } }>(
      "db_update_schema",
      { path, entityType, set },
    ),
  generateAsset: (path: string, target: string, jobId: string, opts: AssetGenOpts = {}) =>
    invoke<QueuedAck>("generate_asset", {
      path,
      target,
      jobId,
      imageBackend: opts.imageBackend,
      imageModel: opts.imageModel ?? null,
      imageEditModel: opts.imageEditModel ?? null,
      imageEditBackend: opts.imageEditBackend ?? null,
      musicBackend: opts.musicBackend,
      sfxBackend: opts.sfxBackend,
      promptOverride: opts.promptOverride ?? null,
    }),
  animateAsset: (path: string, target: string, jobId: string, opts: AnimateOpts = {}) =>
    invoke<QueuedAck>("animate_asset", {
      path,
      target,
      jobId,
      imageBackend: opts.imageBackend,
      imageModel: opts.imageModel ?? null,
      imageEditModel: opts.imageEditModel ?? null,
      imageEditBackend: opts.imageEditBackend ?? null,
      vlmBackend: opts.vlmBackend,
      vlmModel: opts.vlmModel ?? null,
      reuseSpec: opts.reuseSpec ?? false,
      promptOverride: opts.promptOverride ?? null,
    }),
  /** Pre-run cost for animating ONE actor — priced BY STATES, not frames.
   *  `reuseSpec` drops the VLM authoring call from the quote. */
  estimateAsset: (
    path: string,
    target: string,
    opts: {
      op?: string;
      imageBackend?: string;
      vlmBackend?: string;
      reuseSpec?: boolean;
    } = {},
  ) =>
    invoke<{ estimate: CostEstimate }>("estimate_asset", {
      path,
      target,
      op: opts.op ?? "animate",
      imageBackend: opts.imageBackend ?? "fake",
      vlmBackend: opts.vlmBackend ?? "none",
      reuseSpec: opts.reuseSpec ?? false,
    }),
  /** The level graph: nodes + typed edges + the areas (stages) they cluster
   *  under. Pure read. */
  /** Measured animation geometry + playback for one actor. Pure read. */
  animInspect: (path: string, target: string) =>
    invoke<{ animation: AnimationInfo }>("anim_inspect", { path, target }),
  /** Correct one state's playback by hand. Frame geometry is not editable —
   *  these are corrections layered on generation's output. */
  animEdit: (path: string, target: string, state: string, edit: AnimEditPatch) =>
    invoke<{ frames_edit: string; fields?: string[] }>("anim_edit", {
      path,
      target,
      state,
      edit,
    }),
  /** Is the pack's game runtime current with canon's template? Pure read. */
  engineStatus: (path: string) => invoke<{ status: EngineStatus }>("engine_status", { path }),
  /** Refresh the pack's game runtime. `dryRun` reports without writing;
   *  `force` overwrites hand-edited runtime files (refused by default). */
  engineSync: (path: string, opts?: { dryRun?: boolean; force?: boolean }) =>
    invoke<EngineSyncResult>("engine_sync", {
      path,
      dryRun: opts?.dryRun ?? false,
      force: opts?.force ?? false,
    }),
  worldMap: (path: string) => invoke<WorldMap>("world_map", { path }),
  /** Hand-author the map. Overrides are DURABLE (the map itself is recomputed
   *  from the seed on every resume). */
  worldMapEdit: (path: string, edit: WorldMapEdit) =>
    invoke<{ world_map: string; changed: string[] }>("world_map_edit", { path, edit }),
  validateLevel: (path: string, levelId: string) =>
    invoke<ValidationReport>("validate_level", { path, levelId }),
  /** Which provider keys cradle can hand to canon, and the env file they came
   *  from. NAMES only — never values. Lets a paid gate refuse up front instead
   *  of dying at the provider. */
  providerKeys: () => invoke<{ env_file: string | null; keys: string[] }>("provider_keys", {}),
  /** The DEFAULT prompt a generator would send — fills the "✎ Edit prompt"
   *  textarea. Pure read: no LLM call, no cost, no journal. */
  previewPrompt: (
    path: string,
    kind: PromptKind,
    opts?: {
      levelId?: string | null;
      target?: string | null;
      instruction?: string | null;
      brief?: string | null;
    },
  ) =>
    invoke<PromptPreview>("preview_prompt", {
      path,
      kind,
      levelId: opts?.levelId ?? null,
      target: opts?.target ?? null,
      instruction: opts?.instruction ?? null,
      brief: opts?.brief ?? null,
    }),
  /** Open the ANIMATION VIEWER on one actor — every state playing side by side
   *  in a surface that renders the game, so the art can be judged where it
   *  ships. `target` is `enemy:<id>` | `item:<id>` | `player` | `all` (`all`
   *  is pygame-only). `engine` picks which surface; run both to compare them.
   *  Native only. */
  previewAnimation: (
    path: string,
    target: string,
    engine: "pygame" | "godot" = "pygame",
    animMode: AnimPreviewMode = "grid",
  ) =>
    engine === "godot"
      ? invoke<{ launched: boolean; engine?: string; mode?: string; note?: string }>("play_game", {
          path,
          levelId: null,
          animTarget: target,
          animMode,
        })
      : invoke<{ launched: boolean; engine?: string; mode?: string; note?: string }>("play_level", {
          path,
          levelId: "l1",
          plain: false,
          animTarget: target,
          animMode,
        }),
  /** Scaffold-or-reuse the flat draft room the sandbox plays in, then play it
   *  with no win condition and the state HUD. Two calls because cradle never
   *  writes pack files — the room comes from a canon verb. */
  sandboxLevel: (path: string) =>
    invoke<{ level_id: string; stage_id: string; created: boolean }>("sandbox_level", { path }),
  playSandbox: (path: string, levelId: string, engine: "pygame" | "godot" = "pygame") =>
    engine === "godot"
      ? invoke<{ launched: boolean; engine?: string; mode?: string; note?: string }>("play_game", {
          path,
          levelId,
          sandbox: true,
        })
      : invoke<{ launched: boolean; engine?: string; mode?: string; note?: string }>("play_level", {
          path,
          levelId,
          plain: false,
          sandbox: true,
        }),
  playLevel: (path: string, levelId: string, plain = false) =>
    invoke<{ launched: boolean; engine?: string; note?: string }>("play_level", {
      path,
      levelId,
      plain,
    }),
  playGame: (path: string, levelId?: string) =>
    invoke<{ launched: boolean; engine?: string; note?: string }>("play_game", { path, levelId }),
  assetLineage: (path: string, target: string) =>
    invoke<LineageTree>("asset_lineage", { path, target }),
  assetRestore: (path: string, target: string, to: string) =>
    invoke<{ artifact_id: string; kind: string }>("asset_restore", { path, target, to }),
  objectCat: (path: string, hash: string) =>
    invoke<{ hash: string; size: number; bytes_b64: string }>("object_cat", { path, hash }),
  libraryList: (kind?: string, query?: string, project?: string) =>
    invoke<{ entries: LibraryEntry[]; count: number; root: string }>("library_list", {
      kind,
      query,
      project,
    }),
  libraryPublish: (path: string, target: string) =>
    invoke<LibraryEntry & { deduped?: boolean }>("library_publish", { path, target }),
  libraryImport: (path: string, id: string, into?: string) =>
    invoke<{ kind: string; id?: string; library_id: string }>("library_import", { path, id, into }),
  libraryCat: (hash: string) =>
    invoke<{ hash: string; size: number; bytes_b64: string }>("library_cat", { hash }),
  assetAssign: (path: string, source: string, to: string) =>
    invoke<{ from: string; to: string; sprite_hash: string }>("asset_assign", { path, source, to }),
  resolveAsset: (path: string, hint: string) =>
    invoke<string | null>("resolve_asset", { path, hint }),
  getBundledDemoPath: () => invoke<string>("get_bundled_demo_path"),
};
