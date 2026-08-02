import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Command } from "../store";
import { kbd } from "../lib/keys";

/** ⌘K / Ctrl+K — one launcher for every action the current surface offers.
 *
 *  Commands come from the store REGISTRY, so whichever surface is mounted
 *  contributes its own (the level editor registers Validate / Layout /
 *  Improve / Music while it's open). The design puts those secondary tools in
 *  "⌘K + dock tabs" — same definitions, two surfaces.
 *
 *  Not designed in the handoff bundle (⌘K is listed as an entry point that was
 *  never mocked), so this follows the bundle's own primitives and idioms:
 *  --bg-raised panel, .kbd hints, mono for ids, accent for the active row.
 */

/** Subsequence match — "gl" finds "Generate level". Returns null when the
 *  query doesn't match at all, else a score where LOWER is better. */
function scoreOne(haystack: string, query: string): number | null {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  const direct = h.indexOf(q);
  if (direct >= 0) return direct; // contiguous: best, ranked by position
  let i = 0;
  let first = -1;
  let last = 0;
  for (const ch of q) {
    const at = h.indexOf(ch, i);
    if (at < 0) return null;
    if (first < 0) first = at;
    last = at;
    i = at + 1;
  }
  // Scattered: rank after every contiguous hit. `first` is weighted above the
  // span so an early match wins — without it "vll" scored "Save this level"
  // and "Validate this level" IDENTICALLY and stable sort decided by
  // registration order, which put Save on top.
  return 1000 + first * 4 + (last - first);
}

/** Score a command: a hit in the LABEL always outranks one that only lands in
 *  the group or keywords, so typing a visible word never surfaces something
 *  that merely shares a group name. */
function score(cmd: Command, query: string): number | null {
  if (!query) return 0;
  const inLabel = scoreOne(cmd.label, query);
  if (inLabel !== null) return inLabel;
  const rest = scoreOne(`${cmd.label} ${cmd.group} ${cmd.keywords ?? ""}`, query);
  return rest === null ? null : rest + 10_000;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const registry = useStore((s) => s.commands);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo<Command[]>(() => Object.values(registry).flat(), [registry]);

  const matches = useMemo(() => {
    const scored = all
      .map((c) => ({ cmd: c, s: score(c, query) }))
      .filter((x): x is { cmd: Command; s: number } => x.s !== null);
    scored.sort((a, b) => a.s - b.s);
    return scored.map((x) => x.cmd);
  }, [all, query]);

  // The window listener below is bound ONCE per opening, so it would close
  // over the first render's matches/active. Refs keep it reading current
  // values without rebinding on every keystroke.
  const matchesRef = useRef(matches);
  const activeRef = useRef(active);
  matchesRef.current = matches;
  activeRef.current = active;

  const run = (cmd: Command | undefined) => {
    if (!cmd || cmd.enabled === false) return;
    setOpen(false);
    cmd.run();
  };
  const runRef = useRef(run);
  runRef.current = run;

  // Reset per opening, not per keystroke — reopening should feel fresh.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after paint, or the input isn't in the DOM yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp rather than reset: typing narrows the list, and an active index
  // past the end would leave Enter running nothing.
  useEffect(() => {
    setActive((a) => (a >= matches.length ? Math.max(0, matches.length - 1) : a));
  }, [matches.length]);

  useEffect(() => {
    // Optional call: jsdom (and some webviews) don't implement scrollIntoView,
    // and keeping the row visible is a nicety, not a correctness requirement.
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="1"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  // Navigation keys live at WINDOW level while the palette is open, matching
  // Lightbox/NotesDrawer. Handling them on the dialog only works while focus
  // is inside it — and focus can legitimately be elsewhere (the autofocus is
  // one frame late, a click landed on the scrim, a webview stole it), which
  // would strand the palette open with Escape doing nothing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, matchesRef.current.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        runRef.current(matchesRef.current[activeRef.current]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Every hook is above this line (Rules of Hooks).
  if (!open) return null;

  let lastGroup: string | null = null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        zIndex: 1100,
      }}
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "92vw",
          background: "var(--bg-raised)",
          border: "1px solid var(--border-hi)",
          borderRadius: 12,
          boxShadow: "var(--shadow-2)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands…"
          aria-label="Search commands"
          style={{
            width: "100%",
            padding: "13px 16px",
            border: "none",
            borderBottom: "1px solid var(--border)",
            background: "transparent",
            color: "var(--fg)",
            fontFamily: "var(--ui)",
            fontSize: 14,
            outline: "none",
          }}
        />
        <div ref={listRef} style={{ maxHeight: "46vh", overflowY: "auto", padding: 6 }}>
          {matches.length === 0 && (
            <div style={{ padding: "14px 12px", color: "var(--fg-dim)", fontSize: 12.5 }}>
              No commands match “{query}”.
            </div>
          )}
          {matches.map((c, i) => {
            // Headers only while BROWSING. Once a query sorts by relevance the
            // groups interleave, so a per-change header would repeat the same
            // title down the list; the group rides on the row instead.
            const head = !query && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const on = i === active;
            const off = c.enabled === false;
            return (
              <div key={c.id}>
                {head && (
                  <div
                    style={{
                      padding: "8px 10px 4px",
                      fontSize: 9.5,
                      letterSpacing: "0.11em",
                      textTransform: "uppercase",
                      fontFamily: "var(--mono)",
                      color: "var(--fg-dim)",
                    }}
                  >
                    {head}
                  </div>
                )}
                <button
                  data-active={on ? "1" : "0"}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                  disabled={off}
                  title={off ? c.disabledReason : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    border: "none",
                    borderRadius: 6,
                    background: on ? "var(--bg-hover)" : "transparent",
                    boxShadow: on ? "inset 2px 0 0 var(--accent)" : "none",
                    color: off ? "var(--fg-dim)" : "var(--fg)",
                    fontFamily: "var(--ui)",
                    fontSize: 13,
                    cursor: off ? "default" : "pointer",
                  }}
                >
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {query && (
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        color: "var(--fg-dim)",
                      }}
                    >
                      {c.group}
                    </span>
                  )}
                  {off && c.disabledReason && (
                    <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                      {c.disabledReason}
                    </span>
                  )}
                  {c.hint && <span className="kbd">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: "7px 12px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-sunken)",
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--fg-dim)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
          <span style={{ marginLeft: "auto" }}>{kbd("K")}</span>
        </div>
      </div>
    </div>
  );
}
