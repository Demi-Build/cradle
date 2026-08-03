export type ValidationStatus = "validated" | "warn" | "failed" | "bundled";

export type RecentProject = {
  path: string;
  name: string;
  storyTitle?: string;
  synopsis?: string;
  seed?: string | number;
  rooms?: number;
  npcs?: number;
  events?: number;
  quests?: number;
  cost?: number;
  primaryEnv?: string;
  envName?: string;
  startPortrait?: string;
  validation?: ValidationStatus;
  lastOpenedAt: number;
  pinned?: boolean;
  /** Hidden from the recents view. NOT deleted: the project is still on disk
   *  and still openable from "Open another…". This distinction is the point
   *  of the card menu, so it's modelled rather than implied. */
  hidden?: boolean;
};

const STORAGE_KEY = "cradle.recents.v1";
const MAX_RECENTS = 32;

export function loadRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentProject[];
  } catch {
    return [];
  }
}

export function saveRecents(recents: RecentProject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // ignore
  }
}

export function upsertRecent(recents: RecentProject[], next: RecentProject): RecentProject[] {
  const filtered = recents.filter((r) => r.path !== next.path);
  const merged = [next, ...filtered].slice(0, MAX_RECENTS);
  saveRecents(merged);
  return merged;
}

export function removeRecent(recents: RecentProject[], path: string): RecentProject[] {
  const next = recents.filter((r) => r.path !== path);
  saveRecents(next);
  return next;
}

export function togglePin(recents: RecentProject[], path: string): RecentProject[] {
  const next = recents.map((r) => (r.path === path ? { ...r, pinned: !r.pinned } : r));
  saveRecents(next);
  return next;
}

/** Hide/show a project in the recents view. The entry is KEPT — hiding a card
 *  never touches the project on disk, and "show" brings it straight back. */
export function toggleHidden(recents: RecentProject[], path: string): RecentProject[] {
  const next = recents.map((r) => (r.path === path ? { ...r, hidden: !r.hidden } : r));
  saveRecents(next);
  return next;
}

const ENV_KEYS = ["whisperbrook", "sanctum", "crystal", "shadowspire", "nexus"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const ENV_BY_TYPE: Record<string, EnvKey> = {
  village: "whisperbrook",
  ruins: "sanctum",
  underground: "crystal",
  fortress: "shadowspire",
  temple: "nexus",
  cave: "crystal",
  city: "whisperbrook",
  forest: "sanctum",
  desert: "shadowspire",
  shrine: "nexus",
};

export function envKeyFor(envType?: string, pathFallback?: string): EnvKey {
  if (envType) {
    const lower = envType.toLowerCase();
    if (lower in ENV_BY_TYPE) return ENV_BY_TYPE[lower];
    for (const k of ENV_KEYS) {
      if (lower.includes(k)) return k;
    }
  }
  if (pathFallback) {
    let h = 0;
    for (let i = 0; i < pathFallback.length; i++) h = (h * 31 + pathFallback.charCodeAt(i)) | 0;
    return ENV_KEYS[Math.abs(h) % ENV_KEYS.length];
  }
  return "whisperbrook";
}

export function envChipLabel(env?: string): string {
  if (!env) return "world";
  const lower = env.toLowerCase();
  for (const [k, v] of Object.entries(ENV_BY_TYPE)) {
    if (v && lower.includes(k)) return k;
  }
  return lower;
}

export function relativeTimeFrom(ms: number, now: number = Date.now()): string {
  const delta = now - ms;
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (delta < min) return "just now";
  if (delta < hr) return `${Math.floor(delta / min)}m ago`;
  if (delta < day) return `${Math.floor(delta / hr)}h ago`;
  if (delta < 2 * day) return "yesterday";
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
