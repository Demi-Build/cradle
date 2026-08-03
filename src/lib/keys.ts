// Cross-platform keyboard shortcuts.
//
// cradle runs on macOS AND Windows (a Windows contributor is on the two-repo
// dev path), so every shortcut must accept BOTH modifiers and every hint must
// render the one the reader actually presses. Before this, `⌘S` was handled
// correctly (`metaKey || ctrlKey`) but LABELLED with the Mac glyph on every
// platform, and `⌘O` was advertised in three places with no handler at all.

/** True on macOS. `userAgentData` where available, userAgent otherwise —
 *  `navigator.platform` is deprecated and lies under some webviews. */
export const IS_MAC: boolean = (() => {
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /mac/i.test(uaData.platform);
  return /Mac|iPhone|iPad/i.test(navigator.userAgent);
})();

/** The primary modifier's LABEL for this platform: "⌘" or "Ctrl". */
export const MOD = IS_MAC ? "⌘" : "Ctrl";

/** Render a shortcut for display: `kbd("K")` → "⌘K" / "Ctrl+K". */
export function kbd(key: string): string {
  return IS_MAC ? `${MOD}${key}` : `${MOD}+${key}`;
}

/** Was the primary modifier held? ⌘ on macOS, Ctrl elsewhere.
 *
 *  Deliberately platform-EXCLUSIVE: on Windows, ⌘ is the Windows key, and
 *  accepting it would fire commands on Win+K (a system shortcut). Handlers
 *  that only need "some modifier" should keep testing both directly. */
export function isMod(e: KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

/** True when the event is the primary modifier plus `key`, with no other
 *  modifier held. Case-insensitive; ignores the physical layout. */
export function isShortcut(e: KeyboardEvent, key: string): boolean {
  if (!isMod(e) || e.altKey) return false;
  // The OTHER modifier must not be held: ⌃⌘K is not ⌘K.
  if (IS_MAC ? e.ctrlKey : e.metaKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

/** True when the event targets a text-entry surface, where global shortcuts
 *  must not steal the keystroke. */
export function inTextField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable === true;
}
