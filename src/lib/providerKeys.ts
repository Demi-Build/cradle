import { api, type ProviderKeyStatus, type ProviderRow, type ProviderRowsDoc } from "./invoke";
import { useStore } from "../store";

/** The key-file status the pane renders. There is ONE source of provider
 *  keys — a plain `KEY=VALUE` file — so `env_file` is where they live and
 *  `env_file_exists` is whether it is there yet. A read never creates it. */
export type KeyFileStatus = ProviderKeyStatus;

/** The status read — names and presence only, never a value. */
export function providerKeyStatus(names: string[]): Promise<ProviderKeyStatus> {
  return api.providerKeys(names);
}

/** First use: create the key file (header only, owner-only) at the path the
 *  status read reports. The one explicit action behind "no key file yet";
 *  `created: false` when it was already there. */
export function createProviderKeyFile(): Promise<{ env_file: string; created: boolean }> {
  return api.createProviderKeyFile();
}

/** Provider rows and the missing-key gate — rows as DATA (row P0-12, master
 *  §6 S6 / doctrine 8's M0-readiness rule).
 *
 *  Before this row cradle carried its own `BACKEND_KEYS` literal, which meant
 *  adding a provider was an edit in two repositories and cradle's PixelLab
 *  entry could (and did) disagree with the backend about the variable's name.
 *  The map now comes from `canon providers list` — canon already owns the
 *  id→var knowledge its backends and `canon.pricing` encode — and cradle holds
 *  no list at all. `missingKeysFor` is unchanged in contract: the same gate the
 *  entity path and (since P0-10) the create wizard both run. */

let rowsPromise: Promise<ProviderRowsDoc> | null = null;

/** The provider rows, fetched once per session and shared. Cached because the
 *  gate runs on every backend change in the wizard and the table is static for
 *  the life of the canon build behind it. */
export function providerRows(): Promise<ProviderRowsDoc> {
  // A REJECTION is not cached. Caching the promise itself meant one transient
  // `canon providers list` failure poisoned the table for the whole session:
  // the Keys pane rendered its terminal error with no way back, and every
  // later `missingKeysFor` swallowed the same rejection and stopped gating.
  rowsPromise ??= api.providerRows().catch((e: unknown) => {
    rowsPromise = null;
    throw e;
  });
  return rowsPromise;
}

/** Drop the cache — for tests, and after anything that could change which
 *  canon answers. */
export function resetProviderRows(): void {
  rowsPromise = null;
}

/** The env var one backend id needs, or undefined for a free backend
 *  (`fake` / `none` / `local`), looked up across every kind. */
export function keyVarFor(doc: ProviderRowsDoc, backendId: string): string | undefined {
  for (const byBackend of Object.values(doc.backend_key_vars ?? {})) {
    const found = byBackend[backendId];
    if (found) return found;
  }
  return undefined;
}

/** The row that owns `envVar` (canonical name or alias). */
export function rowForVar(rows: ProviderRow[], envVar: string): ProviderRow | undefined {
  return rows.find((r) => r.env_var === envVar || r.aliases.includes(envVar));
}

/** A human explanation when a job's backends need keys cradle can't supply,
 *  or null when it's good to go. Free backends (fake/none) never need one. */
export async function missingKeysFor(backends: Record<string, string>): Promise<string | null> {
  try {
    const doc = await providerRows();
    const needed = [...new Set(Object.values(backends))]
      .map((b) => keyVarFor(doc, b))
      .filter((k): k is string => Boolean(k));
    if (!needed.length) return null;
    // A row's ALIAS satisfies its canonical var: the backend reads either, so
    // a key stored under the dashboard's name is not "missing".
    const { env_file, env_file_exists, keys } = await providerKeyStatus(needed);
    const have = new Set(keys);
    const absent = needed.filter((canonical) => {
      const row = rowForVar(doc.providers, canonical);
      const names = row ? [row.env_var, ...row.aliases] : [canonical];
      return !names.some((n) => have.has(n));
    });
    if (!absent.length) return null;
    // The key file is the ONE place cradle looks, so the reason names it —
    // and says when it does not exist yet, which is the first-use case.
    const where = !env_file
      ? "cradle has no key file on this machine; see Settings → API keys"
      : env_file_exists === false
        ? `there is no key file yet at ${env_file}; add it in Settings → API keys`
        : `not in ${env_file}; add it in Settings → API keys`;
    return `missing ${absent.join(", ")} — ${where}`;
  } catch {
    return null; // can't tell (browser mock) — let the job try.
  }
}

/** The Settings → API keys screen exists as of row P0-12. The constant stays
 *  so the refusal call sites read as data rather than as a hardcoded `true`,
 *  and so a future build that ships without the screen can flip one thing. */
export const SETTINGS_KEYS_SCREEN = true;

/** Deep-link into Settings → API keys, optionally FOCUSING the row that owns
 *  `envVar` — the "closes the inversion" clause of row P0-12's gate: the
 *  wizard's precheck link has to land on the key it is complaining about, not
 *  merely open a screen.
 *
 *  Every missing-key refusal calls this: the create wizard's precheck (P0-10),
 *  the entity path's gate, the model picker's unavailable rows (A5) and the
 *  agent's missing-key card. */
export function openProviderKeys(envVar?: string | null): boolean {
  useStore.getState().openSettings("keys", envVar ?? null);
  return SETTINGS_KEYS_SCREEN;
}

/** The first env var a backend map needs — what a refusal deep-links to. */
export async function firstKeyVarFor(backends: Record<string, string>): Promise<string | null> {
  try {
    const doc = await providerRows();
    for (const backendId of Object.values(backends)) {
      const found = keyVarFor(doc, backendId);
      if (found) return found;
    }
  } catch {
    /* mock or no canon — the link still opens the screen, just unfocused */
  }
  return null;
}
