// Can this pack LLM-author a row of this kind? — asked BEFORE any money card.
//
// THE BUG THIS EXISTS FOR. `canon db complete` (and `db new --complete`)
// answers a structured "not yet" for any kind whose registry entry binds no
// per-row authoring body: only the platformer's enemy/item kinds bind one, so
// every dungeon kind — music and sfx included — refuses. Cradle used to learn
// that AFTER `confirmSpend` had already asked the user to approve ~1¢. A free
// action that cannot run was raising a money dialog. The refusal has to come
// first.
//
// EXTENDS, rather than adding a parallel system:
//   • `api.dbComplete` — the SAME verb the button runs, invoked with the free
//     `none` backend and an id no pack allocates. Canon checks the kind's
//     authoring body BEFORE it looks for the row and BEFORE it touches the
//     LLM, so the answer comes back for free and nothing is written either
//     way: a kind without one raises the not-yet; a kind with one gets as far
//     as "row not found", which is the yes.
//   • canon's structured refusal — dispatched on the `not_yet` payload the
//     CLI already emits, never on prose.
//   • `GatedButton` at the call sites — the app's one blocked-control
//     rendering (greyed, focusable, reason on hover OR keyboard focus).
//
// WHY A PROBE AND NOT A REGISTRY READ. Whether a kind can be completed is
// `EntityKind.builder`, and that is declared SEED_ONLY in canon's pack spec —
// it is deliberately not stamped into the registry and appears in neither
// `pack info` nor `db types`. There is no field to read today. The nearest
// thing in `db types` is `llm_fields`, and it is NOT the capability: the
// dungeon's sfx kind lists `["title", "brief"]` and still refuses. So this
// gates on canon's own honest refusal instead of on a list of kinds — no kind
// name appears anywhere in this file, and a pack that later binds a body
// starts answering yes with no code change here.
//
// FAIL-OPEN. Anything that is not a recognisable not-yet counts as available.
// A probe that cannot run (no canon, a transport error) must not grey out a
// button that works; the spend card still gates the money, and the call site
// re-gates on the refusal if one arrives late.

import { api } from "../../lib/invoke";

/** An id no pack allocates — dungeon ids are numeric, platformer ids are
 *  slugs. The probe never matches a row, which is the point: the answer we
 *  want is decided before the lookup. */
export const CAPABILITY_PROBE_ID = "__cradle_capability_probe__";

/** Canon's structured "not yet", in the three shapes it reaches the frontend
 *  in: the CLI's `not_yet: true` payload, the agent tools' `error: "not_yet"`,
 *  and — last — the prose, so an older canon still lands on the right copy. */
export function isNotYetRefusal(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const payload = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      if (payload.not_yet === true) return true;
      if (payload.error === "not_yet") return true;
    } catch {
      // Not JSON (a truncated or wrapped message) — fall through to the prose.
    }
  }
  return /not[_ ]yet/i.test(text);
}

/** The words a user needs when a kind cannot be LLM-authored. Canon's own
 *  message names the planning row that would bring the capability, which is
 *  not something a user can act on and not something the product says out
 *  loud — so its prose never reaches the screen. `alternative` is the part
 *  that IS actionable, and it differs per surface (create a row and edit it;
 *  edit the row you are on). */
export function completionUnavailable(label: string, alternative: string): string {
  return (
    `This pack has no LLM authoring step for ${label} rows, so there is nothing to ` +
    `generate and nothing to spend. ${alternative}`
  );
}

/** What the new-row panel offers instead. */
export const CREATE_INSTEAD =
  "Create the row — the roll fills its fields — then edit them by hand. Both work today.";

/** What an existing row's surface offers instead. */
export const EDIT_INSTEAD = "Edit the row and write its fields by hand — that works today.";

/** Is completion blocked for this world+kind? Memoised: the answer is a
 *  property of the pack registry, so one probe per kind per session is
 *  enough. The COPY is deliberately not cached with it — each surface names
 *  its own actionable alternative. */
const answers = new Map<string, Promise<boolean>>();

function cacheKey(worldPath: string, kind: string): string {
  return `${worldPath} ${kind}`;
}

export function completionBlocked(worldPath: string, kind: string): Promise<boolean> {
  if (!worldPath || !kind) return Promise.resolve(false);
  const key = cacheKey(worldPath, kind);
  const cached = answers.get(key);
  if (cached) return cached;
  const asked = api
    // `none` builds no client at all — never a paid provider, and this one
    // cannot even reach a free one.
    .dbComplete(worldPath, kind, CAPABILITY_PROBE_ID, [], "none")
    .then(() => false)
    .catch((e: unknown) => isNotYetRefusal(e));
  answers.set(key, asked);
  return asked;
}

/** Record a refusal that arrived from the real run rather than the probe —
 *  the fail-open path's second chance. Keeps the control greyed for the rest
 *  of the session instead of asking for money again. */
export function rememberBlocked(worldPath: string, kind: string): void {
  if (!worldPath || !kind) return;
  answers.set(cacheKey(worldPath, kind), Promise.resolve(true));
}

/** Test-only: drop the memo between cases. */
export function resetCompletionGate(): void {
  answers.clear();
}
