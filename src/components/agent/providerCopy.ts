// Provider copy — the ONE place the panel words a provider and a missing
// key (row P1-A5; Phase 1 Appendix I deviation 2: the copy names the REAL
// key sources, never a toml path). Extracted from `ErrorNotice.tsx` so the
// missing-key notice and the model picker say the same thing, and so those
// component files export only components (react-refresh).
//
// The lookup path is cradle's, not the service's: `/models` rows carry
// `key_env` and `available`, never a `reason`, so the phrase is built here.

/** Display name for a provider id (ids are data; unknown ids pass through). */
export function providerLabel(p: string): string {
  return { anthropic: "Anthropic", openai: "OpenAI", kimi: "Moonshot (Kimi)" }[p] ?? p;
}

/** Where cradle looked for a key, in order. The service reads its env file
 *  (`CANON_ENV_FILE`) first, then the process environment. */
export const KEY_SOURCES = ["the env file (CANON_ENV_FILE)", "the environment"];

/** "looked in the env file (CANON_ENV_FILE), then the environment". */
export function lookedInPhrase(lookedIn?: string[]): string {
  return `looked in ${(lookedIn?.length ? lookedIn : KEY_SOURCES).join(", then ")}`;
}

/** Why a model is unavailable — the env var AND where cradle looked. Used
 *  for a `/models` row, whose `reason` (when the service ever sends one)
 *  wins over the built phrase. */
export function unavailableReason(m: { reason?: string; key_env?: string }): string {
  return m.reason ?? `No ${m.key_env ?? "key"} — ${lookedInPhrase()}`;
}
