import { useEffect, useState } from "react";
import { api, type CostEstimate, type EntityRow } from "../lib/invoke";
import { fmtRange } from "../lib/cost";
import { enqueueJob } from "../lib/jobs";
import { PromptOverride } from "./PromptOverride";
import { useStore } from "../store";

/** Inline "+ New level" form: a blank DRAFT to paint, or a generated DRAFT
 *  (terrain + enemies + items). Either way it lands a draft — publish is a
 *  separate step. Generation's fake backend is $0; anthropic is paid. */
function NewLevelForm({ onDone }: { onDone: () => void }) {
  const { worldPath, setEntities, select, setError } = useStore();
  const [stages, setStages] = useState<string[]>([]);
  const [stage, setStage] = useState("");
  const [mode, setMode] = useState<"blank" | "generate">("blank");
  const [width, setWidth] = useState(60);
  const [height, setHeight] = useState(16);
  const [brief, setBrief] = useState("");
  const [difficulty, setDifficulty] = useState(2);
  const [axis, setAxis] = useState<"horizontal" | "vertical">("horizontal");
  const [enemies, setEnemies] = useState(3);
  const [items, setItems] = useState(6);
  const [seed, setSeed] = useState("");
  const [backend, setBackend] = useState<"fake" | "anthropic">("fake");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [systemOverride, setSystemOverride] = useState<string | null>(null);

  useEffect(() => {
    api
      .listEntities(worldPath, "tilesets")
      .then((refs) => {
        const ids = refs.map((r) => r.id);
        setStages(ids);
        if (ids.length) setStage(ids[0]);
      })
      .catch(() => {});
  }, [worldPath]);

  const createBlank = async () => {
    if (!stage) return;
    setBusy(true);
    try {
      const result = await api.createLevel(worldPath, stage, width, height);
      setEntities("levels", await api.listEntities(worldPath, "levels"));
      select({ kind: "entity", typeId: "levels", id: result.level_id });
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!stage) return;
    let est: CostEstimate | null = null;
    if (backend === "anthropic") {
      try {
        // A new level has no id yet — price by the form's width.
        est = (await api.estimateLevel(worldPath, "__preview__", "generate", backend, width)).estimate;
      } catch {
        /* estimate is advisory */
      }
    }
    const cost =
      backend === "fake"
        ? "Generate with the FAKE backend — $0, no API calls (placeholder layout)."
        : `Generate with anthropic — PAID (est. ${fmtRange(est?.total_usd)}).`;
    if (
      !window.confirm(
        `${cost}\n\nStage ${stage} · difficulty ${difficulty} · ${width}×${height} · ` +
          `${enemies} enemies · ${items} items.\n\nLands a DRAFT (publish separately). Proceed?`,
      )
    )
      return;
    setBusy(true);
    setNote(null);
    // Fire-and-forget background job. The new level's id isn't known until the
    // job finishes, so App's global job listener opens it + refreshes the nav on
    // completion; the tray tracks progress. The form just closes.
    await enqueueJob(
      {
        op: "generate",
        label: `Generate in ${stage}`,
        target: stage, // resolved to the new level id on completion
        targetType: "levels",
        scope: "level",
        backends: { llm: backend },
        estimate: est?.total_usd,
      },
      (jobId) =>
        api.generateLevel(worldPath, stage, {
          brief,
          difficulty,
          width,
          height,
          axis,
          enemies,
          items,
          seed: seed.trim() || null,
          llmBackend: backend,
          systemOverride,
          jobId,
        }),
    );
    setBusy(false);
    onDone();
  };

  const field: React.CSSProperties = { width: 52, fontSize: 11 };
  const tab = (m: "blank" | "generate"): React.CSSProperties => ({
    fontSize: 11,
    padding: "2px 8px",
    cursor: "pointer",
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: mode === m ? "var(--accent)" : "transparent",
    color: mode === m ? "var(--accent-ink)" : "var(--fg-muted)",
  });
  return (
    <div style={{ padding: "6px 10px 8px 26px", display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={tab("blank")} onClick={() => setMode("blank")}>blank</button>
        <button style={tab("generate")} onClick={() => setMode("generate")}>generate</button>
      </div>
      <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ fontSize: 11 }}>
        {stages.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      {mode === "generate" && (
        <textarea
          placeholder="brief — what this level should feel like"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={2}
          style={{ fontSize: 11, resize: "vertical" }}
        />
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
        W <input type="number" min={8} value={width} onChange={(e) => setWidth(+e.target.value)} style={field} />
        H <input type="number" min={8} value={height} onChange={(e) => setHeight(+e.target.value)} style={field} />
      </div>
      {mode === "generate" && (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
            <label>diff
              <select value={difficulty} onChange={(e) => setDifficulty(+e.target.value)} style={{ fontSize: 11, marginLeft: 3 }}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <label>axis
              <select value={axis} onChange={(e) => setAxis(e.target.value as "horizontal" | "vertical")} style={{ fontSize: 11, marginLeft: 3 }}>
                <option value="horizontal">horiz</option>
                <option value="vertical">vert</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
            enemies <input type="number" min={0} value={enemies} onChange={(e) => setEnemies(+e.target.value)} style={{ ...field, width: 40 }} />
            items <input type="number" min={0} value={items} onChange={(e) => setItems(+e.target.value)} style={{ ...field, width: 40 }} />
          </div>
          <input
            placeholder="seed (optional — blank = varied)"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            style={{ fontSize: 11 }}
          />
          <label style={{ fontSize: 11 }}>backend
            <select value={backend} onChange={(e) => setBackend(e.target.value as "fake" | "anthropic")} style={{ fontSize: 11, marginLeft: 3 }}>
              <option value="fake">fake ($0)</option>
              <option value="anthropic">anthropic (paid)</option>
            </select>
          </label>
          <PromptOverride
            worldPath={worldPath}
            kind="layout"
            ctx={{ brief }}
            value={systemOverride}
            onChange={setSystemOverride}
            disabled={busy}
          />
        </>
      )}
      <button
        onClick={mode === "blank" ? createBlank : generate}
        disabled={busy || !stage}
        style={{ fontSize: 11, cursor: "pointer" }}
      >
        {busy ? (mode === "blank" ? "creating…" : "generating…") : mode === "blank" ? "create draft" : "generate draft"}
      </button>
      {note && <div style={{ fontSize: 10, color: "var(--fg-dim)" }}>{note}</div>}
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  npcs: "NPCs",
  items: "Items",
  monsters: "Monsters",
  quests: "Quests",
  rooms: "Rooms",
  events: "Events",
  classes: "Classes",
  music: "Music",
  sfx: "SFX",
  levels: "Levels",
  player: "Player",
  enemies: "Enemies",
  tilesets: "Tilesets",
  backdrops: "Backdrops",
  audio: "Audio",
};

/** Types that sit under a shared heading. The hero and the roster are the same
 *  KIND of thing — animated actors you generate, animate and preview — so they
 *  read as one group instead of two unrelated rows. A type with no entry here
 *  renders exactly as before, so MazeWorld packs are untouched. */
const TYPE_GROUP: Record<string, string> = {
  player: "Actors",
  enemies: "Actors",
};

const PARTITION_FIELD: Record<string, string> = {
  items: "category",
  events: "type",
};

type PartitionCount = { value: string; count: number };

export function LeftNav() {
  const { world, worldPath, entities, selection, select, setEntities, setError } = useStore();
  const worldStoryTitle = useStore((s) => s.worldStoryTitle);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [partitionCounts, setPartitionCounts] = useState<Record<string, PartitionCount[]>>({});
  const [newLevelOpen, setNewLevelOpen] = useState(false);
  const [playingGame, setPlayingGame] = useState(false);
  // Platformer packs expose tilesets — that's the "can create levels" signal.
  const isPlatformer = !!world?.entity_counts.some((c) => c.type_id === "tilesets");

  useEffect(() => {
    setExpanded({});
    setPartitionCounts({});
    setNewLevelOpen(false);
  }, [worldPath]);

  if (!world) {
    return <aside className="leftnav leftnav-empty">Load a world to begin.</aside>;
  }

  async function toggleType(typeId: string) {
    const next = !expanded[typeId];
    setExpanded((e) => ({ ...e, [typeId]: next }));
    if (!next) return;
    const partitionKey = PARTITION_FIELD[typeId];
    if (partitionKey) {
      if (!partitionCounts[typeId]) {
        try {
          const rows: EntityRow[] = await api.listEntityRows(worldPath, typeId);
          const counts = new Map<string, number>();
          for (const r of rows) {
            const v = r.data?.[partitionKey];
            if (typeof v !== "string") continue;
            counts.set(v, (counts.get(v) ?? 0) + 1);
          }
          const arr = Array.from(counts.entries())
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count);
          setPartitionCounts((p) => ({ ...p, [typeId]: arr }));
        } catch (e) {
          setError(String(e));
        }
      }
      return;
    }
    if (!entities[typeId]) {
      try {
        const refs = await api.listEntities(worldPath, typeId);
        setEntities(typeId, refs);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  const isTypeSelected = (typeId: string, partition?: string) =>
    selection.kind === "type" &&
    selection.typeId === typeId &&
    (selection.partition ?? null) === (partition ?? null);
  const isEntitySelected = (typeId: string, id: string) =>
    selection.kind === "entity" && selection.typeId === typeId && selection.id === id;
  const isBibleSelected = selection.kind === "bible";

  // Whole-game playtest (platformer packs): godot boots the full loop —
  // splash → world map → progression. Per-level feel-checks live on the
  // level editor's ▶ Play (pygame).
  const playGame = async () => {
    setPlayingGame(true);
    try {
      const result = await api.playGame(worldPath);
      if (!result.launched && result.note) setError(result.note);
    } catch (e) {
      setError(String(e));
    } finally {
      setPlayingGame(false);
    }
  };

  return (
    <aside className="leftnav">
      <button
        className={`nav-root ${isBibleSelected ? "selected" : ""}`}
        onClick={() => select({ kind: "bible" })}
        title={worldStoryTitle ?? world?.name ?? "World Bible"}
      >
        {worldStoryTitle ?? world?.name ?? "World Bible"}
      </button>
      {isPlatformer && (
        <button
          className={`nav-root ${selection.kind === "worldmap" ? "selected" : ""}`}
          onClick={() => select({ kind: "worldmap" })}
          title="The level graph — place levels, group them into areas, wire the paths between them"
          style={{ fontSize: 12 }}
        >
          🗺 WORLD MAP
        </button>
      )}
      {isPlatformer && (
        <button
          className={`nav-root ${selection.kind === "library" ? "selected" : ""}`}
          onClick={() => select({ kind: "library" })}
          title="The global asset library — publish here from any project, import into this one"
          style={{ fontSize: 12 }}
        >
          🗂 LIBRARY
        </button>
      )}
      {isPlatformer && (
        <button
          onClick={() => void playGame()}
          title="Launch the whole game in Godot: splash → world map → progression (set GODOT_BIN if godot isn't on PATH)"
          style={{
            margin: "6px 10px 2px",
            fontSize: 12,
            padding: "3px 12px",
            borderRadius: 7,
            cursor: "pointer",
            border: "1px solid var(--border)",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontWeight: 600,
          }}
        >
          {playingGame ? "launching…" : "▶ Play game"}
        </button>
      )}
      <div className="nav-types">
        {world.entity_counts.map(({ type_id, count }, i) => {
          const hasPartition = !!PARTITION_FIELD[type_id];
          const parts = partitionCounts[type_id];
          // Head the group when this type opens one (types arrive in registry
          // order, so grouped types are already adjacent).
          const group = TYPE_GROUP[type_id];
          const opensGroup =
            !!group && TYPE_GROUP[world.entity_counts[i - 1]?.type_id ?? ""] !== group;
          return (
            <div key={type_id} className="nav-type">
              {opensGroup && (
                <div
                  className="nav-group-label"
                  style={{
                    fontSize: 10,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    opacity: 0.55,
                    padding: "8px 0 2px 6px",
                  }}
                >
                  {group}
                </div>
              )}
              <button
                className={`nav-type-header ${isTypeSelected(type_id) ? "selected" : ""}`}
                onClick={() => {
                  select({ kind: "type", typeId: type_id });
                  if (!expanded[type_id]) toggleType(type_id);
                }}
              >
                <span
                  className="caret"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleType(type_id);
                  }}
                >
                  {expanded[type_id] ? "▼" : "▶"}
                </span>
                <span className="nav-label">{TYPE_LABELS[type_id] ?? type_id}</span>
                <span className="nav-count">({count})</span>
                {type_id === "levels" && isPlatformer && (
                  <span
                    title="New draft level"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewLevelOpen((v) => !v);
                    }}
                    style={{ marginLeft: 6, cursor: "pointer", opacity: 0.8 }}
                  >
                    ＋
                  </span>
                )}
              </button>
              {type_id === "levels" && newLevelOpen && (
                <NewLevelForm onDone={() => setNewLevelOpen(false)} />
              )}

              {expanded[type_id] && hasPartition && parts && (
                <ul className="nav-entities">
                  {parts.map((p) => (
                    <li key={p.value}>
                      <button
                        className={`nav-entity ${
                          isTypeSelected(type_id, p.value) ? "selected" : ""
                        }`}
                        onClick={() =>
                          select({ kind: "type", typeId: type_id, partition: p.value })
                        }
                      >
                        <span className="nav-part-label">{p.value}</span>
                        <span className="nav-count">({p.count})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {expanded[type_id] && !hasPartition && entities[type_id] && (
                <ul className="nav-entities">
                  {entities[type_id].map((ref) => (
                    <li key={ref.id}>
                      <button
                        className={`nav-entity ${
                          isEntitySelected(type_id, ref.id) ? "selected" : ""
                        }`}
                        onClick={() => select({ kind: "entity", typeId: type_id, id: ref.id })}
                      >
                        {ref.name ?? ref.id}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
