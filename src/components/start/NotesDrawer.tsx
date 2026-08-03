import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { Icon } from "./Icons";

// ============================================================
// Outbound links. Fill in a `url` to make a row live — until then
// each row explains itself rather than opening nothing.
//
// NOTE: opening an external URL from the native shell needs the Tauri
// opener plugin, which isn't in this build. In the browser dev-mock a
// filled-in url opens in a new tab.
// ============================================================
const LINKS: { title: string; desc: string; url: string | null }[] = [
  { title: "Demi Games", desc: "The studio behind cradle and canon.", url: null },
  { title: "Docs", desc: "How packs, levels and the generators fit together.", url: null },
  { title: "Roadmap", desc: "What's being built next, and what's parked.", url: null },
  { title: "Report an issue", desc: "Something broken or missing? Say so here.", url: null },
];

const CHANNELS = ["Stable", "Beta", "Nightly"] as const;
const APP_VERSION = "0.1.0";

// ============================================================
// Changelog — edit this array to update the drawer's changelog.
//   • Newest entries first.
//   • `tag`: "new" (ok color), "next" (dim color), or null.
// ============================================================
const CHANGELOG = [
  {
    ver: "v0.2",
    title: "Level editor",
    tag: "new" as const,
    body: "The map is the surface. Paint tile types, place and move enemies, items and checkpoints, resize the grid, and save the batch with ⌘S. Three render modes (Blocks / Art / Overlay) all drive the same edits. Right-click always erases. Tool rail, bottom dock, minimap, audio lane, bounds and rulers — all toggleable, and the floating panels remember where you put them.",
  },
  {
    ver: "v0.2",
    title: "World map",
    tag: "new" as const,
    body: "Place levels, group them into areas, wire typed paths (two-way, one-way, conditional, planned) and drop path stops. Two canvas treatments over one graph — Schematic for authoring, Overworld for how it reads in game. The map is recomputed from the seed on every run, so anything you place is written as a durable override; the header tracks how many human edits it's carrying and can hand them back.",
  },
  {
    ver: "v0.2",
    title: "Generation, without the freeze",
    tag: "new" as const,
    body: "New projects, new levels, regenerate a layout blind, or Improve one with the LLM looking at what's there. Everything runs as a background job — the queue tray shows what ran, what it cost, how long it took, and whether it actually changed anything. Generators default to $0; turning one up shows a live estimate and asks before it spends.",
  },
  {
    ver: "v0.2",
    title: "Play and validate",
    tag: "new" as const,
    body: "▶ Play a level in pygame (following your current view mode, so Blocks plays without art), ▶ Play game boots the whole loop in Godot, and ✓ Validate runs canon's real checks — reachability simulation included — against the level on disk.",
  },
  {
    ver: "v0.2",
    title: "History you can walk back",
    tag: "new" as const,
    body: "Every asset carries a lineage tree: what generated it, the prompt it came from, where it's used, and every version since. Compare two side by side with an onion-skin blend and restore any of them — restoring branches, it never deletes.",
  },
  {
    ver: "v0.2",
    title: "Chrome",
    tag: "new" as const,
    body: "⌘K command palette, tooltips on every icon button, collapsible nav (⌘B) and inspector (⌘I), focus mode (⌘.). Colour now comes from one token file — including the canvases, which used to carry their own dark-theme values and stayed dark in light mode.",
  },
  {
    ver: "v0.1.0",
    title: "First read-only release",
    tag: null,
    body: "Start screen with recent projects, four-lane NPC dialogue (default / complete / incomplete / failed) with quest-gate routing, monster stat blocks, NPC combat forms, quest contract cards with type-driven objectives, room hero (entry portrait + maze map), events with puzzle tab, items with per-category stats tables, classes with ability and spell pools, bible hero with clickable beats.",
  },
  {
    ver: "v0.3",
    title: "Animation and feel",
    tag: "next" as const,
    body: "An animation tab with QA badges, per-actor custom states, dust and VFX, and a game-feel tuning panel for momentum, gravity and per-tile friction.",
  },
  {
    ver: "v0.3",
    title: "Live dialogue",
    tag: "next" as const,
    body: "Talk to loaded NPCs via their dialogue tree at runtime, with the full state machine running against the LLM.",
  },
];

/** The design's tray: a right slide-over with What's new / Updates / Links.
 *
 *  Built ON the existing notes drawer rather than beside it — the drawer was
 *  already the changelog panel the design calls "What's new", so this widens
 *  it to the three tenants instead of adding a second slide-over. The design
 *  says the set is meant to grow. */
export function NotesDrawer() {
  const open = useStore((s) => s.drawerOpen);
  const setOpen = useStore((s) => s.setDrawerOpen);
  const [pane, setPane] = useState<"news" | "updates" | "links">("news");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("Stable");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <>
      <div className={`drawer-scrim ${open ? "on" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`drawer ${open ? "on" : ""}`}>
        <div className="drawer-head">
          <div className="drawer-tabs">
            {(
              [
                ["news", "What's new"],
                ["updates", "Updates"],
                ["links", "Links"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`drawer-tab ${pane === id ? "on" : ""}`}
                onClick={() => setPane(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <button className="drawer-close" onClick={() => setOpen(false)} aria-label="close">
            <Icon id="g-x" size={14} />
          </button>
        </div>

        {pane === "news" && (
          <div className="drawer-body">
            {CHANGELOG.map((row, i) => (
              <div key={`${row.ver}-${i}`} className="cl-row">
                <span className="cl-ver">{row.ver}</span>
                <div className="cl-body">
                  <h4>
                    {row.tag && <span className={`cl-tag ${row.tag}`}>{row.tag}</span>}
                    {row.title}
                  </h4>
                  <p>{row.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {pane === "updates" && (
          <div className="drawer-body">
            <div className="upd-card">
              <div className="upd-row">
                <span>
                  cradle <b>v{APP_VERSION}</b>
                </span>
                <span className="upd-state">up to date</span>
              </div>
              <p className="upd-note">
                No update channel is wired yet — cradle has no updater plugin in this build, so it
                can't check for or install releases.
              </p>
              <div className="upd-actions">
                <button
                  className="btn"
                  disabled
                  title="Needs the Tauri updater plugin, which isn't in this build."
                >
                  Download &amp; restart
                </button>
                <button className="btn" onClick={() => setPane("news")}>
                  Release notes
                </button>
              </div>
            </div>
            <div className="upd-channel">
              <span className="sect">Release channel</span>
              <div className="segmented">
                {CHANNELS.map((c) => (
                  <button
                    key={c}
                    className={channel === c ? "seg-btn active" : "seg-btn"}
                    onClick={() => setChannel(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <p className="upd-mono">
              Updates install in place. Your projects live outside the app and are never touched by
              one.
            </p>
          </div>
        )}

        {pane === "links" && (
          <div className="drawer-body">
            {LINKS.map((l) => (
              <button
                key={l.title}
                className="link-row"
                disabled={!l.url}
                title={l.url ?? "No destination set yet — fill in LINKS in NotesDrawer.tsx."}
                onClick={() => l.url && window.open(l.url, "_blank", "noopener")}
              >
                <span className="link-ico">
                  <Icon id="g-ext" size={14} />
                </span>
                <span className="link-meta">
                  <b>{l.title}</b>
                  <i>{l.desc}</i>
                </span>
              </button>
            ))}
            <p className="upd-mono">
              Destinations aren't configured yet, and opening an external URL from the native shell
              needs the Tauri opener plugin.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
