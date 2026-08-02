import { create } from "zustand";
import type { EntityRef, Job, ValidationReport, WorldSummary } from "./lib/invoke";
import { api } from "./lib/invoke";
import {
  loadRecents,
  upsertRecent,
  removeRecent as removeRecentFn,
  togglePin as togglePinFn,
  type RecentProject,
  type ValidationStatus,
} from "./lib/recents";

export type Selection =
  | { kind: "none" }
  | { kind: "bible" }
  | { kind: "library" }
  | { kind: "type"; typeId: string; partition?: string }
  | { kind: "entity"; typeId: string; id: string; tab?: string };

/** A just-finished background job, broadcast so open detail views (LevelDetail,
 *  EntityOverview) can refresh themselves when their artifact was the target. */
export type CompletedJobSignal = {
  id: string;
  op: string;
  target: string;
  targetType: string;
  status: "ok" | "no_change" | "failed";
  changed: boolean;
  ts: number;
};

type EntitiesByType = Record<string, EntityRef[]>;

export type LightboxImage = { src: string; alt: string };
export type Route = "start" | "recents";
export type Theme = "dark" | "light";
/** One command-palette entry. `group` heads a section; `hint` renders in the
 *  row's .kbd when the action also has a direct shortcut. `enabled === false`
 *  keeps the row VISIBLE but inert — a hidden command is undiscoverable, and
 *  "why can't I validate?" is answered by seeing it greyed with a reason. */
export type Command = {
  id: string;
  label: string;
  group: string;
  run: () => void;
  hint?: string;
  /** Extra words that should match this command in search but aren't shown. */
  keywords?: string;
  enabled?: boolean;
  /** Shown instead of running it when `enabled` is false. */
  disabledReason?: string;
};
export type AudioTrack = {
  typeId: string;
  id: string;
  name: string;
  hint: string;
};

export type BibleBeat = {
  room_id?: string;
  summary?: string;
  faction_presence?: string;
  escalation?: number;
  boss_name?: string;
  boss_lore?: string;
};

type Store = {
  worldPath: string;
  world: WorldSummary | null;
  worldStoryTitle: string | null;
  worldBeats: BibleBeat[];
  entities: EntitiesByType;
  selection: Selection;
  //: Per-level `canon level validate` reports (keyed by level id) — feeds
  //: the ValidationBar and level chips; cleared with the world.
  levelValidation: Record<string, ValidationReport>;
  error: string | null;
  lightbox: LightboxImage | null;
  recents: RecentProject[];
  route: Route;
  theme: Theme;
  drawerOpen: boolean;
  audioTrack: AudioTrack | null;
  audioResolvedSrc: string | null;
  audioIsPlaying: boolean;
  audioCurrentTime: number;
  audioDuration: number;
  audioError: string | null;
  loading: boolean;
  setWorldPath: (p: string) => void;
  setWorld: (w: WorldSummary | null) => void;
  setEntities: (typeId: string, refs: EntityRef[]) => void;
  setLevelValidation: (levelId: string, report: ValidationReport | null) => void;
  select: (s: Selection) => void;
  setError: (e: string | null) => void;
  openLightbox: (img: LightboxImage) => void;
  closeLightbox: () => void;
  setRoute: (r: Route) => void;
  setTheme: (t: Theme) => void;
  setDrawerOpen: (open: boolean) => void;
  newProjectOpen: boolean;
  setNewProjectOpen: (open: boolean) => void;
  dashboardOpen: boolean;
  setDashboardOpen: (open: boolean) => void;
  //: Command palette. `commands` is a REGISTRY, not a fixed list: whichever
  //: surface is mounted contributes its own actions under a scope key and
  //: withdraws them on unmount. The design puts the level editor's secondary
  //: tools in "⌘K + dock tabs" — one definition, two surfaces.
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  commands: Record<string, Command[]>;
  registerCommands: (scope: string, cmds: Command[]) => void;
  unregisterCommands: (scope: string) => void;
  //: Background generation jobs (the queue tray). `jobs` is live in-memory
  //: state; terminal jobs are also written to the durable ledger.
  jobsOpen: boolean;
  setJobsOpen: (open: boolean) => void;
  jobs: Job[];
  addJob: (job: Job) => void;
  updateJob: (id: string, patch: Partial<Job>) => void;
  lastCompletedJob: CompletedJobSignal | null;
  setLastCompletedJob: (sig: CompletedJobSignal | null) => void;
  playTrack: (track: AudioTrack) => void;
  pauseAudio: () => void;
  resumeAudio: () => void;
  stopAudio: () => void;
  seekAudio: (seconds: number) => void;
  clearAudio: () => void;
  setAudioResolvedSrc: (src: string | null) => void;
  setAudioPlaying: (playing: boolean) => void;
  setAudioTime: (seconds: number) => void;
  setAudioDuration: (seconds: number) => void;
  setAudioError: (e: string | null) => void;
  loadWorldByPath: (path: string) => Promise<void>;
  closeWorld: () => void;
  togglePin: (path: string) => void;
  removeRecent: (path: string) => void;
  enrichRecent: (path: string) => Promise<void>;
};

const THEME_KEY = "cradle.theme.v1";

const INITIAL_AUDIO_STATE = {
  audioTrack: null as AudioTrack | null,
  audioResolvedSrc: null as string | null,
  audioIsPlaying: false,
  audioCurrentTime: 0,
  audioDuration: 0,
  audioError: null as string | null,
};

function initialTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "dark";
}

export const useStore = create<Store>((set, get) => ({
  worldPath: "",
  world: null,
  worldStoryTitle: null,
  worldBeats: [],
  entities: {},
  selection: { kind: "none" },
  levelValidation: {},
  error: null,
  lightbox: null,
  recents: loadRecents(),
  route: "start",
  theme: initialTheme(),
  drawerOpen: false,
  newProjectOpen: false,
  dashboardOpen: false,
  paletteOpen: false,
  commands: {},
  jobsOpen: false,
  jobs: [],
  lastCompletedJob: null,
  ...INITIAL_AUDIO_STATE,
  loading: false,
  setWorldPath: (p) => set({ worldPath: p }),
  setWorld: (w) =>
    set({
      world: w,
      entities: {},
      selection: w ? { kind: "bible" } : { kind: "none" },
      levelValidation: {},
      jobs: [], // jobs are per-pack; a new world starts with an empty tray
      lastCompletedJob: null,
      ...(w ? {} : INITIAL_AUDIO_STATE),
    }),
  setEntities: (typeId, refs) => set((s) => ({ entities: { ...s.entities, [typeId]: refs } })),
  setLevelValidation: (levelId, report) =>
    set((s) => {
      const next = { ...s.levelValidation };
      if (report) next[levelId] = report;
      else delete next[levelId]; // null = the verdict went stale (level edited)
      return { levelValidation: next };
    }),
  select: (s) => set({ selection: s }),
  setError: (e) => set({ error: e }),
  setNewProjectOpen: (open) => set({ newProjectOpen: open }),
  setDashboardOpen: (open) => set({ dashboardOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  registerCommands: (scope, cmds) =>
    set((s) => ({ commands: { ...s.commands, [scope]: cmds } })),
  unregisterCommands: (scope) =>
    set((s) => {
      if (!(scope in s.commands)) return {};
      const next = { ...s.commands };
      delete next[scope];
      return { commands: next };
    }),
  setJobsOpen: (open) => set({ jobsOpen: open }),
  addJob: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
  updateJob: (id, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    })),
  setLastCompletedJob: (sig) => set({ lastCompletedJob: sig }),
  openLightbox: (img) => set({ lightbox: img }),
  closeLightbox: () => set({ lightbox: null }),
  setRoute: (r) => set({ route: r }),
  setTheme: (t) => {
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
    set({ theme: t });
  },
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  playTrack: (track) =>
    set((s) => {
      const sameTrack =
        s.audioTrack?.typeId === track.typeId &&
        s.audioTrack?.id === track.id &&
        s.audioTrack?.hint === track.hint;
      if (sameTrack) {
        return { audioIsPlaying: true, audioError: null };
      }
      return {
        audioTrack: track,
        audioResolvedSrc: null,
        audioIsPlaying: true,
        audioCurrentTime: 0,
        audioDuration: 0,
        audioError: null,
      };
    }),
  pauseAudio: () => set({ audioIsPlaying: false }),
  resumeAudio: () => set((s) => (s.audioTrack ? { audioIsPlaying: true } : {})),
  stopAudio: () => set({ audioIsPlaying: false, audioCurrentTime: 0 }),
  seekAudio: (seconds) => set({ audioCurrentTime: Math.max(0, seconds) }),
  clearAudio: () => set({ ...INITIAL_AUDIO_STATE }),
  setAudioResolvedSrc: (src) => set({ audioResolvedSrc: src }),
  setAudioPlaying: (playing) => set({ audioIsPlaying: playing }),
  setAudioTime: (seconds) => set({ audioCurrentTime: Math.max(0, seconds) }),
  setAudioDuration: (seconds) => set({ audioDuration: Math.max(0, seconds) }),
  setAudioError: (e) => set({ audioError: e }),
  closeWorld: () =>
    set({
      world: null,
      worldPath: "",
      worldStoryTitle: null,
      worldBeats: [],
      entities: {},
      selection: { kind: "none" },
      levelValidation: {},
      jobs: [],
      lastCompletedJob: null,
      jobsOpen: false,
      // Every registered command closes over the world that's going away.
      paletteOpen: false,
      commands: {},
      route: "start",
      ...INITIAL_AUDIO_STATE,
    }),
  togglePin: (path: string) => set((s) => ({ recents: togglePinFn(s.recents, path) })),
  removeRecent: (path) => set((s) => ({ recents: removeRecentFn(s.recents, path) })),
  enrichRecent: async (inputPath: string) => {
    try {
      const summary = await api.loadWorld(inputPath);
      const path = summary.path;
      const existing = get().recents.find((r) => r.path === inputPath || r.path === path);
      const next: RecentProject = {
        path,
        name: summary.name,
        lastOpenedAt: existing?.lastOpenedAt ?? Date.now(),
        pinned: existing?.pinned,
      };
      try {
        const bible = (await api.getWorldBible(path)) as {
          story?: { title?: string; synopsis?: string };
        };
        next.storyTitle = bible.story?.title ?? summary.name;
        next.synopsis = bible.story?.synopsis;
      } catch {}
      try {
        const manifest = (await api.readWorldJson(path, "manifest")) as {
          seed?: string | number;
          environment_names?: string[];
          npc_count?: number;
          quest_count?: number;
          event_count?: number;
          num_rooms?: number;
          start_portrait?: string;
          validation_report?: { status?: string } | string;
          generation_stats?: { total_cost_usd?: number };
        };
        if (typeof manifest.seed === "number") next.seed = manifest.seed;
        next.primaryEnv = manifest.environment_names?.[0];
        next.envName = manifest.environment_names?.[0];
        next.startPortrait = manifest.start_portrait;
        next.rooms = manifest.num_rooms;
        next.npcs = manifest.npc_count;
        next.events = manifest.event_count;
        next.quests = manifest.quest_count;
        if (typeof manifest.generation_stats?.total_cost_usd === "number") {
          next.cost = manifest.generation_stats.total_cost_usd;
        }
        next.validation = validationFrom(manifest.validation_report);
      } catch {}
      if (!next.rooms) next.rooms = summary.entity_counts.find((c) => c.type_id === "rooms")?.count;
      if (!next.npcs) next.npcs = summary.entity_counts.find((c) => c.type_id === "npcs")?.count;
      if (!next.events)
        next.events = summary.entity_counts.find((c) => c.type_id === "events")?.count;
      if (!next.quests)
        next.quests = summary.entity_counts.find((c) => c.type_id === "quests")?.count;
      set((s) => ({
        recents: upsertRecent(
          s.recents.filter((r) => r.path !== inputPath && r.path !== path),
          { ...next, lastOpenedAt: existing?.lastOpenedAt ?? Date.now() },
        ),
      }));
    } catch {
      // silent — stale entries are preserved
    }
  },
  loadWorldByPath: async (inputPath: string) => {
    if (import.meta.env.DEV) console.log("[cradle] loadWorldByPath called with:", inputPath);
    set({ loading: true, error: null, ...INITIAL_AUDIO_STATE });
    try {
      const summary = await api.loadWorld(inputPath);
      // Backend returns the canonical world root (walks up from `/data` if needed).
      // Use that for all downstream reads + recents storage so keys stay canonical.
      const path = summary.path;
      if (import.meta.env.DEV)
        console.log("[cradle] backend returned summary:", {
          requested: inputPath,
          summaryPath: path,
          name: summary.name,
          counts: summary.entity_counts,
        });
      const prevRecents = get().recents.filter((r) => r.path !== inputPath && r.path !== path);

      // Platformer packs have no world_bible.json (manifest.json + world.json +
      // level/ instead). Open straight to the first level rather than a Bible
      // view that would error, and prime the nav with levels + enemies.
      const isPlatformer = summary.entity_counts.some(
        (c) => c.type_id === "levels" && c.count > 0,
      );
      if (isPlatformer) {
        let levelRefs: EntityRef[] = [];
        let enemyRefs: EntityRef[] = [];
        try {
          levelRefs = await api.listEntities(path, "levels");
        } catch {}
        try {
          enemyRefs = await api.listEntities(path, "enemies");
        } catch {}
        const first = levelRefs[0];
        set({
          worldPath: path,
          world: summary,
          worldStoryTitle: summary.name,
          worldBeats: [],
          selection: first
            ? { kind: "entity", typeId: "levels", id: first.id }
            : { kind: "none" },
          entities: { levels: levelRefs, enemies: enemyRefs },
          levelValidation: {},
          route: "start",
          recents: prevRecents,
          ...INITIAL_AUDIO_STATE,
        });
        set((s) => ({
          recents: upsertRecent(s.recents, {
            path,
            name: summary.name,
            lastOpenedAt: Date.now(),
          }),
        }));
        return;
      }

      set({
        worldPath: path,
        world: summary,
        worldStoryTitle: null,
        worldBeats: [],
        selection: { kind: "bible" },
        entities: {},
        route: "start",
        recents: prevRecents,
        ...INITIAL_AUDIO_STATE,
      });

      // Best-effort enrichment of the recent entry.
      const recent: RecentProject = {
        path,
        name: summary.name,
        lastOpenedAt: Date.now(),
      };
      try {
        const bible = (await api.getWorldBible(path)) as {
          story?: { title?: string; synopsis?: string; beats?: BibleBeat[] };
        };
        recent.storyTitle = bible.story?.title ?? summary.name;
        recent.synopsis = bible.story?.synopsis;
        if (bible.story?.title) set({ worldStoryTitle: bible.story.title });
        if (Array.isArray(bible.story?.beats)) set({ worldBeats: bible.story.beats });
      } catch {}
      try {
        const manifest = (await api.readWorldJson(path, "manifest")) as {
          seed?: string | number;
          environment_names?: string[];
          npc_count?: number;
          quest_count?: number;
          event_count?: number;
          num_rooms?: number;
          start_portrait?: string;
          validation_report?: { status?: string } | string;
          generation_stats?: { total_cost_usd?: number };
        };
        recent.seed = manifest.seed;
        recent.primaryEnv = manifest.environment_names?.[0];
        recent.envName = manifest.environment_names?.[0];
        recent.startPortrait = manifest.start_portrait;
        recent.rooms = manifest.num_rooms;
        recent.npcs = manifest.npc_count;
        recent.events = manifest.event_count;
        recent.quests = manifest.quest_count;
        if (typeof manifest.generation_stats?.total_cost_usd === "number") {
          recent.cost = manifest.generation_stats.total_cost_usd;
        }
        recent.validation = validationFrom(manifest.validation_report);
      } catch {}
      if (!recent.rooms)
        recent.rooms = summary.entity_counts.find((c) => c.type_id === "rooms")?.count;
      if (!recent.npcs)
        recent.npcs = summary.entity_counts.find((c) => c.type_id === "npcs")?.count;
      if (!recent.events)
        recent.events = summary.entity_counts.find((c) => c.type_id === "events")?.count;
      if (!recent.quests)
        recent.quests = summary.entity_counts.find((c) => c.type_id === "quests")?.count;

      set((s) => ({ recents: upsertRecent(s.recents, recent) }));
    } catch (e) {
      set({ error: String(e), world: null, ...INITIAL_AUDIO_STATE });
      throw e;
    } finally {
      set({ loading: false });
    }
  },
}));

if (typeof window !== "undefined") {
  (window as unknown as { __cradleStore?: typeof useStore }).__cradleStore = useStore;
}

function validationFrom(report: unknown): ValidationStatus | undefined {
  if (!report) return undefined;
  if (typeof report === "string") {
    const low = report.toLowerCase();
    if (low.includes("pass") || low.includes("valid")) return "validated";
    if (low.includes("warn")) return "warn";
    if (low.includes("fail") || low.includes("error")) return "failed";
    return undefined;
  }
  if (typeof report === "object" && report !== null) {
    const status = (report as { status?: string }).status;
    return validationFrom(status);
  }
  return undefined;
}
