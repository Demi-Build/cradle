import { invoke } from "@tauri-apps/api/core";
import type { PackTemplate } from "./packTemplates";

/** How the animation viewer plays an actor. `grid` puts every state side by
 *  side on its own clock — right for judging ONE pose. `sequence` walks the
 *  storyboard through the game's own state ladder, so `jump → fall → land`
 *  plays as the single motion it is. A toggle, not a replacement. */
export type AnimPreviewMode = "grid" | "sequence";

export type EntityTypeCount = { type_id: string; count: number };
/** One `grids.<kind>.placements` entry of `canon pack info` (P0 paper P.3.2 /
 *  P.4.6): which EntityKind the placement key places and the shared bundle's
 *  literal list it rides on (`entities` | `items` | `triggers`, P.9 G9). */
export type PackPlacement = { kind: string; wire: string };
export type PackGrid = {
  placements: Record<string, PackPlacement>;
  points: string[];
  dims: Record<string, unknown>;
};
/** The `canon pack info` document (P.4.6) — every kind/id in it is open
 *  data. Only the parts cradle reads today are typed; the rest passes
 *  through for the rows that need it later. */
export type PackInfo = {
  pack_type: string;
  label?: string;
  capabilities?: string[];
  entities?: Record<string, { label: string; id_field: string; placeable?: boolean }>;
  grids?: Record<string, PackGrid>;
  [key: string]: unknown;
};
export type WorldSummary = {
  path: string;
  name: string;
  /** The pack's registry id — canon's `pack_type` verbatim (P0 paper P.4.6).
   *  An open id ("platformer", "dungeon", …), never a union: surfaces compare
   *  against it instead of sniffing entity_counts / rows / tilesets. */
  world_kind: string;
  entity_counts: EntityTypeCount[];
  /** The `pack info` document `load_world` shells for once per world load
   *  (row P0-5): the room editor's Dock tabs come from its `grids` block.
   *  Null from a source that has no canon (tests, older mocks). */
  pack_info?: PackInfo | null;
};
/** What `canon grid roll` answers with — the step it ran, the seed it used
 *  (pinning it reproduces the roll) and what changed. `cost_usd` is always 0:
 *  the rolls are pure code. */
export type RollResult = {
  room_id: string;
  level_id: string;
  step: string;
  seed: string;
  changed: boolean;
  changed_artifacts: string[];
  no_change: boolean;
  cost_usd: number;
  warnings?: string[];
  updated?: string[];
  encounter_id?: string | number;
  monster_ids?: (string | number)[];
};
/** One leg of canon's resolution order, as the startup probe found it (row
 *  P0-11 / W3.6). `leg` is a stable id — `env` (the CANON_BIN override),
 *  `bundled` (the vendored runtime inside the app), `path` (`canon` on PATH)
 *  — so the failure screen renders copy from the id, never by parsing prose. */
export type RuntimeLeg = {
  leg: string;
  /** What was actually looked for; null when the leg had nothing to try. */
  tried: string | null;
  found: boolean;
  note: string;
};
/** What `canon --version` answered, plus how cradle got there. `ok: false` is
 *  what raises the guided failure screen instead of a raw
 *  "No such file or directory" at the first verb. */
export type RuntimeStatus = {
  ok: boolean;
  /** Which leg answered — an open id, never a union to switch on. */
  origin: string;
  /** The exact command line, for the copy the screen shows. */
  command: string;
  /** The platform directory the bundled runtime lives under. */
  triple: string;
  resource_dir: string | null;
  legs: RuntimeLeg[];
  version: { canon_version?: string; package_version?: string } | null;
  error: string | null;
};
// ── Row P0-12: keys + Settings ──
/** One provider row, as `canon providers list` answers it (master §6 S6 —
 *  rows are DATA, so this type describes a SHAPE and never a union of ids).
 *  `env_var` is canon's canonical name; `aliases` are other names the backend
 *  accepts (`PIXELLAB_API_KEY` for `PIXELLAB_SECRET`). `test` is the cheapest
 *  authenticated ping, or null when the provider publishes none — in which
 *  case the Test button renders disabled with that reason (doctrine 4). */
export type ProviderRow = {
  id: string;
  label: string;
  env_var: string;
  aliases: string[];
  unlocks: string;
  /** `{kind: [backend id, …]}` — the missing-key precheck's map. */
  backends: Record<string, string[]>;
  docs: string;
  note: string;
  test: { url: string; header: string; prefix: string; note: string } | null;
};
export type ProviderRowsDoc = {
  result: string;
  providers: ProviderRow[];
  /** `{kind: {backend id: env var}}`, derived canon-side from the rows. */
  backend_key_vars: Record<string, Record<string, string>>;
};
/** Names and sources only. There is deliberately no value field, no masked
 *  value and no length: a stored key never reaches the frontend. */
export type ProviderKeyVar = {
  name: string;
  set: boolean;
  /** Which store wins for this var: `keychain` · `file` (the unencrypted
   *  fallback) · `env` · `file` from an env file. Null when unset. */
  source: string | null;
  /** The other places the same name was seen, so an override is visible. */
  also_in: string[];
  /** Stored in cradle's own store, but this machine will not hand it back —
   *  a stale names index, or a keychain that refuses this binary. Reported so
   *  the pane can say "stored, unreadable" instead of a green chip over a key
   *  the canon child never receives (doctrine 4). */
  unreadable?: boolean;
};
export type ProviderKeyStatus = {
  env_file: string | null;
  /** Pre-P0-12 field, unchanged: the names cradle can hand over. */
  keys: string[];
  vars: ProviderKeyVar[];
  /** Which store took the keys: `keychain` · `file` · `none`. */
  backend: string;
  /** The LOUD "stored unencrypted" line when the fallback is in use. */
  warning: string | null;
  config_dir: string | null;
};
export type ProviderTestResult = {
  result?: string;
  id: string;
  /** False when the row declares no test, or no key is set — with a reason. */
  ran: boolean;
  ok: boolean;
  status: number | null;
  reason: string;
};
/** One external tool as the Environment pane found it. `gate` is a stable id:
 *  `ok` · `unpinned` · `off_major` · `unknown` · `missing`. */
export type ToolDetection = {
  tool: string;
  label: string;
  env_var: string;
  found: boolean;
  origin: string | null;
  path: string | null;
  version: string | null;
  major: number | null;
  gate: string;
  note: string;
  install: string;
  legs: RuntimeLeg[];
};
export type ProjectStore = {
  root: string | null;
  exists: boolean;
  /** `env` (CRADLE_PROJECTS_DIR) · `settings` · `default` · `error`. */
  source: string;
  locked_by_env?: boolean;
  error?: string;
};
export type EnvironmentStatus = {
  canon: RuntimeStatus;
  godot: ToolDetection;
  blender: ToolDetection;
  project_store: ProjectStore;
  config_dir: string | null;
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
 *  counts still shown). Same shape from the world and per-level verbs.
 *  The §3.0-E estimate contract (`low / high / backend / model / unitCount`,
 *  plus `accuracy`) rides on the same document as ADDITIVE keys from canon's
 *  estimator (row P0-7) — they pass through the Rust commands untouched. */
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
  /** §3.0-E: the range before any spend (USD). */
  low?: number;
  high?: number;
  /** The primary backend / model the range was priced by (data; null = unpaid). */
  backend?: string | null;
  model?: string | null;
  /** Billable units the range covers (calls + images + tracks + effects + vlm judgments). */
  unitCount?: number;
  /** `measured` | `estimated` — the accuracy flag canon stamps (P.8.8). */
  accuracy?: string;
};
/** A row of `.canon/spend.jsonl`.
 *
 *  Row P1-A6 (P.8.7): this ledger is now a **derived compat index** — the cost
 *  dashboard sums the JOURNAL's `costCents`. A row carrying `journal_ref` is
 *  already counted there; only rows WITHOUT one (pre-A6 history, the create
 *  run) are added to the journal total. Every field below the divider is
 *  optional and additive; the schema string did not change. */
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
  // --- row P1-A6, all optional ---
  actor?: string;
  /** `user` | `agent:<conversation>/<specialist>` — a function of `actor`. */
  identity?: string;
  /** `tokens` | `generation` — open (P.8.8), so a third lane needs no edit. */
  category?: string;
  /** `measured` | `estimated`, the same flag the journal event carries. */
  accuracy?: string;
  genKind?: string;
  session?: string;
  batchId?: string;
  /** The `ts` of the op's first journal event — the do-not-double-count mark. */
  journal_ref?: string;
};
export type SpendByOp = { count: number; actual_usd: number; estimate_usd: number };
export type SpendSummary = {
  count: number;
  total_actual_usd: number;
  total_estimate_usd: number;
  by_op: Record<string, SpendByOp>;
  entries: SpendEntry[];
};
/** A background generation job's lifecycle status.
 *
 *  A plain `string` on purpose (P0 paper P.8.8: never a literal union — a new
 *  status must render without a type edit). The six known values, documented
 *  rather than encoded: `queued` and `running` are live (in-memory);
 *  `ok` (ran and changed something), `no_change` (ran, identical bytes),
 *  `failed` (errored) and `cancelled` (⏹ Stop — kept what landed) are terminal
 *  and also written to the durable ledger. `JOB_STATUSES` is the DATA behind
 *  labels and ordering. */
export type JobStatus = string;

/** The known job statuses, in reading order — data for labels/filters, never
 *  a type. An unknown status renders as itself (P.8.8's passthrough rule). */
export const JOB_STATUSES = [
  "queued",
  "running",
  "ok",
  "no_change",
  "failed",
  "cancelled",
] as const;
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
  progress?: JobProgress; // live pipeline position, for jobs that watch a step log
  /** Who launched it — the JobTray's attribution column (README §10):
   *  absent/`cradle:user` = "you · editor buttons"; `agent:<conversation>/
   *  <specialist>` for agent-launched jobs. Read via `lib/actor.parseActor`. */
  actor?: string;
};
/** Where a watched job is inside canon's pipeline, folded from the raw
 *  `job-progress` event stream (`<pack>/.canon/log.jsonl`). Absent until the
 *  first event lands — a job that watches nothing never grows one. */
export type JobProgress = {
  phases: PhaseProgress[]; // in the order canon ran them
  total?: number; // phase count promised by `run_start`
  startedAt?: number; // ms, from the first event's timestamp
  endedAt?: number; // ms, set by `run_end`
  ok?: boolean; // `run_end`'s verdict
};
/** One pipeline phase's live state. `item` is the sub-phase unit currently in
 *  flight (a sprite, a level, an animation state) — the thing a paid run sits
 *  on for minutes at a time. */
export type PhaseProgress = {
  node: string; // canon's node id, e.g. "phase:plat:sprite_art"
  status: "running" | "done" | "failed" | "skipped";
  item?: string;
  index?: number;
  itemTotal?: number;
};
/** Payload of a Rust `job-progress` event: one raw canon step-log record
 *  (`{ts, event, ...}`) plus the job id it belongs to and the §3.0-E progress
 *  contract keys the worker adds (`phase`, `spentCents`; row P1-A4.5) — every
 *  queued job is relayed, not only project creation. */
export type JobProgressEvent = {
  id: string;
  ts?: string;
  event: string; // run_start | node_start | node_item | node_done | node_failed | node_skipped | run_end
  node?: string;
  /** `node` minus its `phase:` prefix — the id the template's phase-label map keys on. */
  phase?: string;
  item?: string;
  index?: number;
  total?: number;
  /** Cents billed so far, from the op's own cost block when canon reports one; null = unknown, never inferred. */
  spentCents?: number | null;
  /** The run's step total. The SEQUENTIAL scheduler names it `phases`, the
   *  ORCHESTRATED one (canon's create default since master §8 Q6) names it
   *  `nodes` — a reader must accept either or the bar has no denominator. */
  phases?: number;
  nodes?: number;
  ok?: boolean;
  reason?: string;
  /** Cancel-aware `run_end` (row P1-A4.5): the run was stopped; `kept` names what landed. */
  cancelled?: boolean;
  kept?: string[];
};
/** Durable job-ledger entry (`.canon/jobs.jsonl`, written via `canon jobs record`).
 *  Row P1-A6: RUN STATUS ONLY — `actual_usd` here is informational and the cost
 *  dashboard never sums it (money reconciles off the journal). `identity` /
 *  `session` / `batchId` are the additive lane fields. */
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
  // --- row P1-A6, all optional ---
  identity?: string;
  session?: string;
  batchId?: string;
};
/** One line of `.canon/journal.jsonl` — the ONE source the cost dashboard
 *  sums (P0 paper P.8; row P1-A6 implements the shape once, canon-side).
 *
 *  Everything below `gen` is additive and OPTIONAL, and the read-time defaults
 *  are canon's: `identity` is always present (derived from `actor` for pre-A6
 *  rows), while `costCents` / `accuracy` / `genKind` / `batchId` / `session`
 *  stay ABSENT when absent — `costCents` missing means "not a cost row", never
 *  "$0", and `accuracy` is never defaulted to `measured`.
 *
 *  `genKind`, `accuracy`, `op`, `source` and `detail.kind` are plain `string`s
 *  (P.8.8): a new kind — `mesh` at W2.2, or anything later — renders as its own
 *  row without a type edit. */
export type JournalEvent = {
  schema?: number;
  ts?: string;
  artifact_id?: string;
  op?: string;
  source?: string;
  actor?: string;
  identity?: string;
  session?: string;
  detail?: Record<string, unknown>;
  before_hash?: string;
  after_hash?: string;
  gen?: Record<string, unknown>;
  batchId?: string;
  /** The only number any dashboard figure sums. Absent = not a cost row. */
  costCents?: number;
  /** `measured` | `estimated` — rendered distinctly, never assumed. */
  accuracy?: string;
  genKind?: string;
};

/** One row of the dashboard's by-kind table (canon's roll-up, `--summary`). */
export type JournalKindRow = {
  genKind: string;
  runs: number;
  youCents: number;
  agentCents: number;
  totalCents: number;
  backend: string;
  model: string;
  /** How many OTHER backend·model pairs also produced this kind. */
  variants: number;
};
/** One row of the by-identity table. Agent rows carry conversation+specialist
 *  so the UI can nest specialists under their conversation. */
export type JournalIdentityRow = {
  identity: string;
  kind: string; // "user" | "agent" — open
  conversation: string | null;
  specialist: string | null;
  tokensCents: number;
  generationCents: number;
  totalCents: number;
  runs: number;
};
export type JournalConversationRow = {
  session: string;
  tokensCents: number;
  generationCents: number;
  totalCents: number;
  runs: number;
};
/** The roll-up `canon journal list --summary` computes. Every figure is a sum
 *  of the SAME `costCents` field, which is why the tables reconcile. */
export type JournalSummary = {
  totalCents: number;
  generationCents: number;
  tokensCents: number;
  todayCents: number;
  youCents: number;
  agentCents: number;
  costedEvents: number;
  eventCount: number;
  /** Runs a paid backend billed but canon could not price — shown, never $0. */
  unpricedRuns: number;
  accuracyCents: Record<string, number>;
  byKind: JournalKindRow[];
  byIdentity: JournalIdentityRow[];
  byConversation: JournalConversationRow[];
  today: string;
};
/** Filters for `journalList` — P.8.7's exact flag set. */
export type JournalFilter = {
  identity?: string;
  session?: string;
  genKind?: string;
  since?: string;
  artifactPrefix?: string;
  limit?: number;
  summary?: boolean;
};

export type JobSummary = {
  count: number;
  by_op: Record<string, number>;
  by_status: Record<string, number>;
  entries: JobEntry[];
};
/** What an enqueuing gen command returns immediately (before the job runs). */
export type QueuedAck = { job_id: string; status: string };
/** What `cancel_job` answers (row P1-A4.5): `cancelled` (it was queued —
 *  dropped outright) or `cancelling` (it was running — the cancel file landed;
 *  the terminal `job-updated {status: "cancelled", result: {kept…}}` follows
 *  from the worker, after canon's next item boundary or the 10 s grace). */
export type CancelJobAck = {
  job_id: string;
  status: string; // cancelled | cancelling
  was?: string; // queued | running
  cancel_file?: string | null;
  grace_ms?: number;
};
/** `canon level sandbox` (+ row P1-A4.5's `--level` / `--spawn`). */
export type SandboxLevelResult = {
  level_id: string;
  stage_id: string;
  created: boolean;
  draft?: boolean;
  spawn?: [number, number] | null;
  launch?: { env: Record<string, string> };
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

// ── Dialogue (row P0-9) ──────────────────────────────────────────────────────
// The six `canon dialogue` verbs, typed as canon returns them. Every id, kind
// and namespace here is open DATA (`string`), never a literal union: the
// vocabulary is the pack registry's, and a template that adds a namespace adds
// a row, not a type.

/** One condition/effect token as canon describes it — parsed or not, its
 *  engine-evaluability at this scope, and the reason for either. Never an
 *  exception: a bad token describes itself (doctrine 4). */
export type DialogueToken = {
  token: string;
  namespace: string;
  operands?: string[];
  kind?: string;
  slots?: Record<string, string>;
  legal: boolean;
  reason: string | null;
  engine_evaluable: boolean;
  engine_reason: string | null;
  /** The operand names an id the pack does not have, when canon had tables. */
  unresolved?: string | null;
};

export type DialogueGate = {
  node_id: string;
  choice: number;
  text: string;
  conditions: DialogueToken[];
  effects: DialogueToken[];
};

export type DialogueShowTree = {
  tree_id: string;
  label: string;
  axis: string | null;
  rank: number;
  selector: { rows: DialogueToken[] } | null;
  fallback: boolean;
  entry_node_id: string;
  nodes: number;
  choices: number;
  terminal_nodes: string[];
  gates: DialogueGate[];
  /** Which legacy `dialogue_tree*` key this tree is written back to, if any. */
  legacy_slot?: string | null;
};

export type DialogueShow = {
  npc: string;
  name?: string | null;
  quest_id?: number | string | null;
  /** `dialogue_trees` | `legacy` | `none` — where the data came from. */
  source: string;
  storage_field: string;
  legacy_fields: string[];
  legacy_written: string[];
  engine: { id?: string | null; evaluable_namespaces?: Record<string, unknown> | null };
  selector_axes: string[];
  trees: DialogueShowTree[];
  scenes: {
    id: string | number;
    title?: string | null;
    actors: string[];
    required: string[];
    lines: number;
    trigger?: string | null;
  }[];
  warnings: string[];
};

/** `{errors[], warnings[]}` for one NPC. Unreachable nodes, dangling targets,
 *  uncoverable selector rows and engine lag are WARNINGS and never block. */
export type DialogueValidation = {
  npc: string;
  source: string;
  trees: number;
  errors: string[];
  warnings: string[];
};

export type DialogueUpdateResult = {
  npc: string;
  source: string;
  /** One journal entry per op, with its own field diff. */
  ops: { i: number; k: string; target?: string; changed?: Record<string, unknown> }[];
  /** The NPC's trees as they now sit on disk — the new save base. */
  trees: unknown[];
  legacy_written: string[];
  changed: boolean;
  no_change: boolean;
  warnings: string[];
  before_hash?: string | null;
  after_hash?: string | null;
};

/** One condition's verdict inside a walk. `verdict` is the ribbon glyph:
 *  `unevaluable` whenever the engine does not evaluate the token (the split
 *  verdict), else `pass` / `fail`; `error` for a token that will not parse. */
export type DialogueConditionResult = {
  token: string;
  namespace: string;
  operands?: string[];
  pass: boolean;
  reason: string | null;
  verdict: string;
  engine_evaluable: boolean;
  engine_reason: string | null;
};

export type DialogueChoiceResult = {
  index: number;
  text: string;
  next_node_id: string | null;
  dangling: boolean;
  effects: DialogueToken[];
  pass: boolean;
  conditions: DialogueConditionResult[];
  failing_condition: string | null;
  failing_reason: string | null;
  unevaluable: string[];
};

export type DialogueTestResult = {
  tree_id: string;
  entry_node_id: string;
  node: { node_id: string; speaker: string | null; prompt: string; terminal: boolean };
  choices: DialogueChoiceResult[];
  gates: Record<string, number>;
  state: Record<string, unknown>;
  post_effect_state: Record<string, unknown>;
  fired: {
    token: string;
    namespace: string;
    applied: boolean;
    detail: string;
    engine_evaluable: boolean;
    engine_reason: string | null;
  }[];
  chose: number | null;
  next_node_id: string | null;
  /** Present when `--choose` named a blocked choice. */
  refused?: string;
};

export type DialogueSelectRow = {
  tree_id: string;
  label: string | null;
  axis: string | null;
  rank: number;
  fallback: boolean;
  selector: { rows: string[] } | null;
  /** `selected` | `blocked` | `shadowed`. */
  status: string;
  would_play: boolean;
  rows: DialogueConditionResult[];
  why_not: string | null;
  engine_blind_rows: string[];
  legacy_slot?: string | null;
};

export type DialogueSelectResult = {
  npc: string;
  source: string;
  selected: string | null;
  selected_label: string | null;
  trees: DialogueSelectRow[];
  /** The selector-level engine-lag case: the engine SKIPS a row it cannot
   *  evaluate and may play a different tree than the tester does. */
  engine: {
    id: string | null;
    selected: string | null;
    legacy_slot: string | null;
    diverges: boolean;
    reason: string | null;
  };
  state: Record<string, unknown>;
  warnings: string[];
};

// ── Scenes and improve (row P0-9, steps 12–13) ───────────────────────────────
// `canon scene update / validate / test` and `canon dialogue improve`. The
// scene verbs write through the EVENT kind's row path — one store of truth,
// three readers — and `improve` is a PROPOSAL: it always answers `wrote: false`
// and the accepted rows land in the caller's unsaved buffer.

export type SceneUpdateResult = {
  scene: string | number;
  created: boolean;
  ops: { i: number; k: string; target?: string }[];
  /** The row as it now sits on disk — the new save base. */
  row: Record<string, unknown>;
  changed: boolean;
  no_change: boolean;
  warnings: string[];
  before_hash?: string | null;
  after_hash?: string | null;
};

export type SceneValidation = {
  scene: string | number;
  lines: number;
  errors: string[];
  warnings: string[];
};

/** One line as `canon scene test` played it. A skipped line is NAMED
 *  (`skipped_because`), never silently dropped — that is the one test control
 *  scenes need that trees do not. */
export type SceneTestLine = {
  n: number;
  k: string;
  speaker?: string | null;
  text?: string;
  played: boolean;
  skipped_because?: string;
  conditions?: DialogueConditionResult[];
  pass?: boolean;
  failing_reason?: string | null;
  options?: {
    text: string;
    to: number | null;
    pass: boolean;
    conditions: DialogueConditionResult[];
    failing_reason?: string | null;
  }[];
};

export type SceneTestResult = {
  scene: string | number;
  title?: string | null;
  plays: boolean;
  settings: {
    pass: boolean;
    conditions: DialogueConditionResult[];
    failing_reason: string | null;
  };
  blocked_by: string | null;
  absent_required_actors: string[];
  gates: Record<string, number>;
  transcript: SceneTestLine[];
  on_finish: DialogueTestResult["fired"];
  state: Record<string, unknown>;
  post_effect_state: Record<string, unknown>;
};

/** One proposed rewrite — the modal's per-row diff card (README Q10). */
export type ImproveRow = {
  target: string;
  tree: string;
  node_id: string;
  choice: number | null;
  /** `prompt` on a node, `text` on a choice. */
  field: string;
  before: string;
  after: string;
  why: string;
};

export type DialogueImproveResult = {
  npc: string;
  requested_by: string;
  backend_note: string;
  source: string;
  scope: string;
  trees: string[];
  instruction: string;
  keep_structure: boolean;
  backend: string;
  proposal: { rows: ImproveRow[]; count: number };
  gen: { backend?: string; model?: string | null; input_tokens?: number; output_tokens?: number };
  cost: { usd: number | null; paid: boolean; note?: string };
  /** Always `false`. An LLM re-author is never a write. */
  wrote: boolean;
  apply_with: string;
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
  /** `canon grid roll` (row P0-8): re-roll ONE step of a grid — code-only and
   *  $0, so it never raises a spend card (doctrine 3). `step` is open data
   *  (whole | layout | npcs | events | items | monsters), `encounter` names
   *  the combat event a monsters roll re-rolls. */
  rollGrid: (
    path: string,
    levelId: string,
    step: string,
    opts: { encounter?: string | null; seed?: string | null } = {},
  ) =>
    invoke<RollResult>("roll_grid_step", {
      path,
      levelId,
      step,
      encounter: opts.encounter ?? null,
      seed: opts.seed ?? null,
    }),
  /** `canon grid restore` (row P0-8): one stored version of a grid step made
   *  current again. Nothing is deleted — the restore is a new version. */
  restoreGridStep: (path: string, levelId: string, step: string, to: string) =>
    invoke<unknown>("restore_grid_step", { path, levelId, step, to }),
  createLevel: (path: string, stageId: string, width: number, height: number) =>
    invoke<{ level_id: string }>("create_level", { path, stageId, width, height }),
  /** Enqueues — the ack lands immediately with the pack dir the run WILL
   *  write to; the run itself reports via `job-updated` / `job-progress`. */
  newProject: (
    parentDir: string | null,
    name: string,
    opts?: {
      /** Canon's template id, from `packTemplates()`. Cradle never branches
       *  on it — `canon world new --template` dispatches through the pack
       *  registry (row P0-10). */
      template?: string;
      /** Count field → value, BY CANON'S NAMES (the same keys the wizard
       *  rendered from `pack templates`), so a third template needs no
       *  change here or in Rust. */
      counts?: Record<string, number>;
      seed?: string;
      model?: string;
      llmBackend?: string;
      imageBackend?: string;
      musicBackend?: string;
      sfxBackend?: string;
      vlmBackend?: string;
      jobId?: string;
    },
  ) =>
    invoke<QueuedAck & { pack_dir: string }>("new_project", {
      jobId: opts?.jobId,
      // null = the cradle project store (`~/CradleProjects/`, Phase 0 §8.4);
      // a path = the Advanced "choose location" override.
      parentDir: parentDir ?? null,
      name,
      template: opts?.template ?? null,
      counts: opts?.counts ?? null,
      seed: opts?.seed ?? null,
      model: opts?.model ?? null,
      llmBackend: opts?.llmBackend ?? null,
      imageBackend: opts?.imageBackend ?? null,
      musicBackend: opts?.musicBackend ?? null,
      sfxBackend: opts?.sfxBackend ?? null,
      vlmBackend: opts?.vlmBackend ?? null,
    }),
  /** `canon pack templates` — the installed templates + their wizard metadata
   *  (P0 paper P.4.4, row P0-10). Pack-less: asked before a pack exists. */
  packTemplates: () => invoke<{ result: string; templates: PackTemplate[] }>("pack_templates", {}),
  /** Where a project created in cradle lands (Phase 0 §8.4). Pure read. */
  projectStore: () => invoke<{ root: string; exists: boolean }>("project_store", {}),
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
  /** Pre-run cost forecast for a NEW project. Row P0-10: `template` + counts
   *  BY NAME, so one call prices either template from the pack's own
   *  estimator (P0-7's `world estimate --template <id>`). */
  estimateWorld: (opts: {
    template?: string;
    counts: Record<string, number>;
    llmBackend: string;
    imageBackend: string;
    musicBackend: string;
    sfxBackend: string;
    vlmBackend: string;
  }) =>
    invoke<{ result: string; estimate: CostEstimate }>("estimate_world", {
      template: opts.template ?? null,
      counts: opts.counts,
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
  /** The pack's journal (`canon journal list`) — the cost dashboard's ONE
   *  source. `summary: true` asks canon for the roll-up INSTEAD of every event:
   *  the reply then carries `summary` and no `events`, which is the whole point
   *  of the flag. Pass `limit` alongside it to get both (the roll-up is then
   *  computed over those same N events). Pure read. */
  journalList: (path: string, filter: JournalFilter = {}) =>
    invoke<{ result: string; events?: JournalEvent[]; summary?: JournalSummary }>("journal_list", {
      path,
      identity: filter.identity ?? null,
      session: filter.session ?? null,
      genKind: filter.genKind ?? null,
      since: filter.since ?? null,
      artifactPrefix: filter.artifactPrefix ?? null,
      limit: filter.limit ?? null,
      summary: filter.summary ?? false,
    }),
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
  /** The STARTUP PROBE (row P0-11, W3.6): resolve canon the one way every
   *  spawn site resolves it, run `canon --version`, and report what was
   *  tried in what order. Cheap and off the main thread (the command is
   *  async Rust-side); safe to re-run from the failure screen's Try again. */
  runtimeStatus: () => invoke<RuntimeStatus>("runtime_status", {}),
  /** Which provider keys cradle can hand to canon, and the env file they came
   *  from. NAMES and SOURCES only — never a value, not even masked, and never
   *  a length (row P0-12). Lets a paid gate refuse up front instead of dying
   *  at the provider.
   *
   *  `vars` is the union of names to report on, passed in from
   *  `providerRows()` so the list stays canon's DATA rather than a literal
   *  here or in Rust; anything else cradle can see is reported anyway. */
  providerKeys: (vars?: string[]) =>
    invoke<ProviderKeyStatus>("provider_keys", { vars: vars ?? null }),
  /** Store one provider key in the OS keychain (row P0-12 / W3.4).
   *  **Write-only**: the value goes in and no command ever hands it back. */
  setProviderKey: (variable: string, value: string) =>
    invoke<{ var: string; stored: boolean; backend: string; warning: string | null }>(
      "set_provider_key",
      { var: variable, value },
    ),
  /** Forget one provider key. Idempotent — `removed: false` when there was
   *  nothing stored under that name. */
  deleteProviderKey: (variable: string) =>
    invoke<{ var: string; removed: boolean; backend: string; warning: string | null }>(
      "delete_provider_key",
      { var: variable },
    ),
  /** `canon providers list` — the provider ROWS the key screen renders and the
   *  backend→var map the missing-key precheck uses (master §6 S6: rows are
   *  DATA). Cradle keeps no provider list of its own. Pack-less; pure read. */
  providerRows: () => invoke<ProviderRowsDoc>("provider_rows", {}),
  /** `canon providers test <id>` — the USER-INITIATED key check. The cheapest
   *  authenticated ping the row declares, **never a generation** (doctrine 3).
   *  This CONTACTS the provider, so it is only ever called from an explicit
   *  click whose copy says so. The key never passes through here: it reaches
   *  canon from the keychain via the child environment. */
  testProviderKey: (provider: string) =>
    invoke<ProviderTestResult>("test_provider_key", { provider }),
  /** Everything W3.5's Environment pane shows in one read: the effective canon
   *  (from P0-11's own resolver + probe, not re-derived), Godot detection,
   *  `BLENDER_BIN` detection with its version gate, and the project store. */
  environmentStatus: () => invoke<EnvironmentStatus>("environment_status", {}),
  /** Move where NEW projects land. Existing projects are never moved — a
   *  project opened from anywhere is still written back in place. `null`
   *  clears the override and returns to `~/CradleProjects`. */
  setProjectStore: (path: string | null) => invoke<ProjectStore>("set_project_store", { path }),
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
  /** Row P1-A4.5 (C19): `levelId` sandboxes an existing level instead of the
   *  reserved room (a read); `spawn` = "x,y" start cell. The result's
   *  `launch.env` names what the harness needs (`PLAT_SANDBOX`, `PLAT_SPAWN`). */
  sandboxLevel: (path: string, levelId?: string, spawn?: string) =>
    invoke<SandboxLevelResult>("sandbox_level", { path, levelId, spawn }),
  playSandbox: (
    path: string,
    levelId: string,
    engine: "pygame" | "godot" = "pygame",
    spawn?: string,
  ) =>
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
          spawn,
        }),
  playLevel: (path: string, levelId: string, plain = false, spawn?: string) =>
    invoke<{ launched: boolean; engine?: string; note?: string }>("play_level", {
      path,
      levelId,
      plain,
      spawn,
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
  // -- Row P1-A5: the agent sidecar's lifecycle (src-tauri lib.rs sidecar
  //    block). The port is per-process state, never persisted (I5/I8); the
  //    HTTP+SSE conversation itself goes through `lib/agent.ts`, not IPC. --
  /** Spawn `canon agent serve --pack <pack>` (or reuse the running one for
   *  this pack) and return the port it printed. `mock: true` is the devMock
   *  answering — the scripted agent then stands in for the whole service. */
  agentStart: (pack: string, backend: string | null = null, model: string | null = null) =>
    invoke<{ port: number; pid: number; command?: string; mock?: boolean; reused?: boolean }>(
      "agent_start",
      { pack, backend, model },
    ),
  /** POST /shutdown then reap; idempotent. */
  agentStop: () => invoke<{ stopped: boolean }>("agent_stop", {}),
  agentStatus: () =>
    invoke<{
      running: boolean;
      port: number | null;
      pid: number | null;
      pack: string | null;
      exit_code: number | null;
      stderr: string[];
    }>("agent_status", {}),
  // ── Dialogue verbs (row P0-9) ──
  // The editor calls canon; cradle never writes pack files (doctrine 1). Read
  // verbs (`show`, `validate`, `select`) write nothing; `update` is the ONE
  // write and it takes `--actor` from `lib/actor.ts` on the Rust side.
  /** `canon dialogue show` — the trees, selectors, ranks and gates plus each
   *  token's engine-evaluability. What the navigator rail and gate ribbon
   *  render. */
  dialogueShow: (path: string, npc: string) => invoke<DialogueShow>("dialogue_show", { path, npc }),
  /** `canon dialogue update --ops` — the unsaved buffer as ONE batch. Fail-
   *  closed canon-side: one validation error and nothing is written. */
  /** `session` groups a QUEST-SCOPE batch: one save touches several NPCs, so
   *  every call in that batch carries the SAME session id and the journal reads
   *  as ONE undo entry even though the pack stores it per character (README
   *  §7). A single-NPC save passes none. */
  dialogueUpdate: (path: string, npc: string, ops: unknown[], session?: string | null) =>
    invoke<DialogueUpdateResult>("dialogue_update", { path, npc, ops, session: session ?? null }),
  /** `canon dialogue validate` — the validator panel and the save sheet. */
  dialogueValidate: (path: string, npc: string) =>
    invoke<DialogueValidation>("dialogue_validate", { path, npc }),
  /** `canon dialogue test` — walks the UNSAVED tree payload against a
   *  simulated state. The UI never evaluates a gate itself: one evaluator,
   *  canon's. `choose` takes that choice and fires its effects. */
  dialogueTest: (
    path: string,
    tree: unknown,
    state: unknown,
    opts: { node?: string | null; choose?: number | null } = {},
  ) =>
    invoke<DialogueTestResult>("dialogue_test", {
      path,
      tree,
      state,
      node: opts.node ?? null,
      choose: opts.choose ?? null,
    }),
  /** `canon dialogue select` — which tree this state selects and why each
   *  other one did not; drives the rail's would-play / blocked grouping. */
  dialogueSelect: (path: string, npc: string, state: unknown) =>
    invoke<DialogueSelectResult>("dialogue_select", { path, npc, state }),
  /** `canon dialogue improve` — a PROPOSAL, never a write. `none`/`fake` run
   *  canon's built-in deterministic copy pass at $0; any other backend id is a
   *  real, user-run provider call (doctrine 3), which is why the modal gates it
   *  through the same paid card the rest of the editor uses. */
  dialogueImprove: (
    path: string,
    npc: string,
    opts: {
      instruction?: string;
      treeId?: string | null;
      scope?: string;
      backend?: string;
      model?: string | null;
      keepStructure?: boolean;
    } = {},
  ) =>
    invoke<DialogueImproveResult>("dialogue_improve", {
      path,
      npc,
      instruction: opts.instruction ?? "",
      treeId: opts.treeId ?? null,
      scope: opts.scope ?? "tree",
      backend: opts.backend ?? "none",
      model: opts.model ?? null,
      keepStructure: opts.keepStructure ?? true,
    }),
  // ── Scene verbs (row P0-9, step 12) ──
  /** `canon scene update --ops` — the scene buffer as ONE batch, written
   *  through the event row path. `create` allocates the row when the scene is
   *  new (`db update` refuses every scene-only field: they route here). */
  sceneUpdate: (
    path: string,
    scene: string | null,
    ops: unknown[],
    opts: { create?: boolean; title?: string; session?: string | null } = {},
  ) =>
    invoke<SceneUpdateResult>("scene_update", {
      path,
      scene,
      ops,
      create: opts.create ?? false,
      title: opts.title ?? "",
      session: opts.session ?? null,
    }),
  /** `canon scene validate` — `{errors[], warnings[]}` for one scene row. */
  sceneValidate: (path: string, scene: string) =>
    invoke<SceneValidation>("scene_validate", { path, scene }),
  /** `canon scene test` — plays the UNSAVED scene payload against a simulated
   *  state that carries ACTOR PRESENCE. An absent required actor cancels the
   *  scene; an absent optional actor's lines are skipped and NAMED. */
  sceneTest: (path: string, scene: unknown, state: unknown) =>
    invoke<SceneTestResult>("scene_test", { path, scene, state }),
  /** ⏹ on a JobQueue job (row A4.5's `cancel_job`: a queued job is dropped,
   *  a running one stops at its next item boundary via the cancel file). */
  cancelJob: (jobId: string) => invoke<CancelJobAck>("cancel_job", { jobId }),
};
