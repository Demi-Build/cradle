import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../../store";
import { type RecentProject, relativeTimeFrom } from "../../lib/recents";
import { IconSymbols, Icon } from "../start/Icons";
import { StartTitleBar } from "../start/StartTitleBar";
import { StartStatusBar } from "../start/StartStatusBar";
import { NotesDrawer } from "../start/NotesDrawer";
import { RecentCard } from "./RecentCard";
import { RecentRow } from "./RecentRow";

type Filter = "all" | "validated" | "issues" | "pinned";
type Sort = "recent" | "name" | "rooms";
type View = "grid" | "list";

function sectionFor(ms: number, now: number): string {
  const delta = now - ms;
  const day = 24 * 60 * 60 * 1000;
  if (delta < day) return "Today";
  if (delta < 2 * day) return "Yesterday";
  if (delta < 7 * day) return "Earlier this week";
  if (delta < 31 * day) return "Earlier this month";
  return "Older";
}

const SECTION_ORDER = ["Today", "Yesterday", "Earlier this week", "Earlier this month", "Older"] as const;

export function RecentProjectsPage() {
  const recents = useStore((s) => s.recents);
  const setError = useStore((s) => s.setError);
  const loadWorldByPath = useStore((s) => s.loadWorldByPath);
  const togglePinAction = useStore((s) => s.togglePin);

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let rows = recents;
    if (filter === "validated") rows = rows.filter((r) => r.validation === "validated" || r.validation === "bundled" || !r.validation);
    if (filter === "issues") rows = rows.filter((r) => r.validation === "warn" || r.validation === "failed");
    if (filter === "pinned") rows = rows.filter((r) => r.pinned);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const hay = [r.path, r.name, r.storyTitle, String(r.seed ?? "")].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    if (sort === "recent") rows = [...rows].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    if (sort === "name") rows = [...rows].sort((a, b) => (a.storyTitle ?? a.name).localeCompare(b.storyTitle ?? b.name));
    if (sort === "rooms") rows = [...rows].sort((a, b) => (b.rooms ?? 0) - (a.rooms ?? 0));
    return rows;
  }, [recents, filter, sort, query]);

  const grouped = useMemo(() => {
    if (sort !== "recent") return null;
    const now = Date.now();
    const map = new Map<string, RecentProject[]>();
    for (const r of filtered) {
      const sec = sectionFor(r.lastOpenedAt, now);
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(r);
    }
    return SECTION_ORDER
      .map((sec) => [sec, map.get(sec) ?? []] as const)
      .filter(([, rows]) => rows.length > 0);
  }, [filtered, sort]);

  const openFromDisk = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string") await loadWorldByPath(selected);
    } catch (e) {
      setError(String(e));
    }
  };

  const lastTime = recents[0]?.lastOpenedAt;
  const subtitle = `${recents.length} world${recents.length === 1 ? "" : "s"} on this machine${
    lastTime ? ` · last loaded ${relativeTimeFrom(lastTime)}` : ""
  }`;

  return (
    <div className="start-app" data-view={view}>
      <IconSymbols />
      <StartTitleBar here="recent projects" />

      <main className="page">
        <div className="page-head">
          <div>
            <h1>Recent projects</h1>
            <p className="sub">{subtitle}</p>
          </div>
          <button className="head-cta" onClick={openFromDisk}>
            <Icon id="g-plus" size={14} className="g g-on-cta" />
            Open world from disk
            <span className="kbd kbd-on-cta">⌘O</span>
          </button>
        </div>

        <div className="toolbar">
          <div className="search">
            <span className="s-icon"><Icon id="g-search" size={14} /></span>
            <input
              placeholder="Filter by name, path, seed, or story title…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="s-kbd">/</span>
          </div>
          <div className="filter">
            <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>All</FilterBtn>
            <FilterBtn active={filter === "validated"} onClick={() => setFilter("validated")}>Validated</FilterBtn>
            <FilterBtn active={filter === "issues"} onClick={() => setFilter("issues")}>Has issues</FilterBtn>
            <FilterBtn active={filter === "pinned"} onClick={() => setFilter("pinned")}>Pinned</FilterBtn>
          </div>
          <SortDropdown sort={sort} onChange={setSort} />
          <div className="view-toggle">
            <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} title="Grid">
              <Icon id="g-grid" size={14} />
            </button>
            <button className={view === "list" ? "on" : ""} onClick={() => setView("list")} title="List">
              <Icon id="g-rows" size={14} />
            </button>
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="empty-recents">
            <p>No matching projects.</p>
          </div>
        )}

        {view === "grid" && grouped && grouped.map(([sec, rows]) => (
          <div key={sec}>
            <div className="section-label">{sec} <span className="count">· {rows.length}</span></div>
            <div className="grid">
              {rows.map((r) => (
                <RecentCard
                  key={r.path}
                  recent={r}
                  onClick={() => loadWorldByPath(r.path)}
                  onTogglePin={() => togglePinAction(r.path)}
                />
              ))}
            </div>
          </div>
        ))}
        {view === "grid" && !grouped && filtered.length > 0 && (
          <div className="grid">
            {filtered.map((r) => (
              <RecentCard
                key={r.path}
                recent={r}
                onClick={() => loadWorldByPath(r.path)}
                onTogglePin={() => togglePinAction(r.path)}
              />
            ))}
          </div>
        )}

        {view === "list" && filtered.length > 0 && (
          <div className="list">
            <div className="list-head">
              <div />
              <div>World</div>
              <div>Synopsis</div>
              <div style={{ textAlign: "right" }}>Rooms</div>
              <div style={{ textAlign: "right" }}>NPCs</div>
              <div style={{ textAlign: "right" }}>Events</div>
              <div>Status</div>
              <div>Opened</div>
              <div />
            </div>
            {filtered.map((r) => (
              <RecentRow
                key={r.path}
                recent={r}
                onClick={() => loadWorldByPath(r.path)}
                onTogglePin={() => togglePinAction(r.path)}
              />
            ))}
          </div>
        )}

        <div className="foot-stats">
          <span>Showing {filtered.length} of {recents.length}</span>
          <span>Cradle stores this list in <code>localStorage</code> (v0.1; disk persistence in v0.2)</span>
        </div>
      </main>

      <StartStatusBar note={`${recents.length} worlds · none loaded`} />
      <NotesDrawer />
    </div>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={active ? "on" : ""} onClick={onClick}>
      {children}
    </button>
  );
}

function SortDropdown({ sort, onChange }: { sort: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const label = sort === "recent" ? "Recently opened" : sort === "name" ? "Name" : "Rooms";
  return (
    <div style={{ position: "relative" }}>
      <button className="sort-by" onClick={() => setOpen((o) => !o)}>
        Sort: <b>{label}</b>
        <Icon id="g-chev-d" size={12} />
      </button>
      {open && (
        <div className="sort-menu">
          {(["recent", "name", "rooms"] as const).map((s) => (
            <button
              key={s}
              className={sort === s ? "on" : ""}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
            >
              {s === "recent" ? "Recently opened" : s === "name" ? "Name" : "Rooms"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
