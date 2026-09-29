// The asset-failure tallies, beside `AssetFailureList.tsx` so that file
// exports only its component (fast refresh): the types canon's
// `generation_stats.json` `failures` list is read as, and the two pure
// readers the bible view and the create card share.

export type AssetFailure = {
  /** Asset family: image | music | sfx — whatever canon's executor ran. */
  kind?: string;
  /** Pack address the repair verb speaks (`npc:1000`, `sfx:door_open`). */
  target?: string;
  path?: string;
  provider?: string;
  message?: string;
  status?: number | null;
  retryable?: boolean;
  attempts?: number;
  hint?: string;
  /** The exception class the provider raised (`FalClientHTTPError`). */
  error?: string;
};

/** The slice of `generation_stats.json` the summary reads. `*_attempted`
 *  counts backend CALLS (a retried asset counts each one); `*_succeeded`
 *  counts files that landed; `failures` is one record per asset that
 *  stayed missing — present only in a file written by an executor that
 *  records them. */
export type AssetStats = {
  images_attempted?: number;
  images_succeeded?: number;
  music_attempted?: number;
  music_succeeded?: number;
  sfx_attempted?: number;
  sfx_succeeded?: number;
  failures?: AssetFailure[];
};

/** One family's tally: what was planned, what landed, what did not.
 *
 *  `listed` says where `failed` came from. True: the stats carried a
 *  `failures` list and `planned` is landed + listed — exact. False: the
 *  file carried NO list (it predates one), so the only fact it holds is
 *  attempts vs landed; `planned` is then the attempt count and `failed` the
 *  shortfall — an upper bound, since a retried asset that landed is two
 *  attempts and one file. Readers word the two differently: a file that
 *  cannot say what failed is never read as "all landed". */
export type AssetFamilySummary = {
  kind: string;
  label: string;
  landed: number;
  failed: number;
  planned: number;
  listed: boolean;
};

/** The stats fields that count a family's attempts and landed files, and
 *  how the family reads in a sentence — the stats file's own schema, not a
 *  list of kinds the UI invents: a failure of any other kind still tallies
 *  under its own name. */
const FAMILY_FIELDS: ReadonlyArray<
  readonly [kind: string, attempted: keyof AssetStats, succeeded: keyof AssetStats, label: string]
> = [
  ["image", "images_attempted", "images_succeeded", "images"],
  ["music", "music_attempted", "music_succeeded", "music"],
  ["sfx", "sfx_attempted", "sfx_succeeded", "sfx"],
];

function count(stats: AssetStats, field: keyof AssetStats): number {
  const raw = stats[field];
  return typeof raw === "number" ? raw : 0;
}

/** Tally a stats snapshot per family. With a `failures` list, `planned` is
 *  landed + failed — honest whatever the retry count did to `*_attempted`.
 *  Without one, the tally falls back to attempts vs landed (`listed:
 *  false`) rather than reading the absence of a list as the absence of
 *  failures — the first paid run's file has no list and lost 26 assets. */
export function summarizeAssets(stats: AssetStats | null | undefined): AssetFamilySummary[] {
  if (!stats) return [];
  const listed = Array.isArray(stats.failures);
  const failedBy = new Map<string, number>();
  for (const f of listed ? stats.failures! : []) {
    const kind = f.kind ?? "asset";
    failedBy.set(kind, (failedBy.get(kind) ?? 0) + 1);
  }
  const out: AssetFamilySummary[] = [];
  for (const [kind, attemptedField, succeededField, label] of FAMILY_FIELDS) {
    const landed = count(stats, succeededField);
    if (listed) {
      const failed = failedBy.get(kind) ?? 0;
      failedBy.delete(kind);
      if (landed + failed > 0) {
        out.push({ kind, label, landed, failed, planned: landed + failed, listed });
      }
    } else {
      const attempted = Math.max(count(stats, attemptedField), landed);
      if (attempted > 0) {
        out.push({ kind, label, landed, failed: attempted - landed, planned: attempted, listed });
      }
    }
  }
  for (const [kind, failed] of failedBy) {
    out.push({ kind, label: kind, landed: 0, failed, planned: failed, listed });
  }
  return out;
}

/** One family's cell for a stats grid: `43 / 44 · 1 failed`, `50 / 50`, or —
 *  for a file with no failure list — `43 / 50 attempted`, which claims only
 *  what the file knows. */
export function assetFamilyCell(f: AssetFamilySummary): string {
  if (!f.listed) return `${f.landed} / ${f.planned} attempted`;
  return `${f.landed} / ${f.planned}${f.failed > 0 ? ` · ${f.failed} failed` : ""}`;
}

/** The one-line summary: `50 images · 43 landed · 7 failed — see list`, one
 *  clause per family that ran; `50 images · all landed` when a list says
 *  nothing failed; `43 images landed of 50 attempted` when the file carries
 *  no list at all. Empty when the snapshot counts nothing. */
export function assetSummaryLine(stats: AssetStats | null | undefined): string {
  const families = summarizeAssets(stats);
  if (families.length === 0) return "";
  const listedFailures = families.reduce((n, f) => n + (f.listed ? f.failed : 0), 0);
  const clauses = families.map((f) => {
    if (!f.listed) return `${f.landed} ${f.label} landed of ${f.planned} attempted`;
    return f.failed > 0
      ? `${f.planned} ${f.label} · ${f.landed} landed · ${f.failed} failed`
      : `${f.planned} ${f.label} · all landed`;
  });
  return listedFailures > 0 ? `${clauses.join(" / ")} — see list` : clauses.join(" / ");
}
