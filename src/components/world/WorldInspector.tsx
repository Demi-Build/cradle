import { useStore } from "../../store";
import { countProblems } from "../../lib/validation";
import { areaName, areaStroke, nodeLabel, type WorldSel } from "./drawWorld";
import type { WorldMap, WorldMapArea, WorldMapEdge, WorldMapNode } from "../../lib/invoke";

/** The world map's 308px inspector (design screen 05).
 *
 *  Three shapes over one panel — level, area, path — each with the design's
 *  own field rows, the `Inherited from area` block and the connections list.
 *
 *  Where a row describes something canon can't yet express, the control is
 *  DISABLED with the reason rather than omitted or faked: the model really
 *  does have one theme per area and no per-level override, and a greyed row
 *  that says so is the only version of this panel that stays honest. Same
 *  rule the command palette follows for disabled commands.
 */

const INHERIT_REASON =
  "A level inherits its area's theme, blocks and music bed — canon has no per-level field for any of them yet.";

export type InspectorActions = {
  select: (s: WorldSel | null) => void;
  setEdges: (edges: WorldMapEdge[]) => void;
  deleteEdge: (index: number) => void;
  resetNode: (levelId: string) => void;
  openLevel: (levelId: string, generate?: boolean) => void;
  createIn: (stageId: string) => void;
  startConnection: (levelId: string) => void;
};

export function WorldInspector({
  map,
  sel,
  thumbs,
  areaArt,
  actions,
}: {
  map: WorldMap;
  sel: WorldSel | null;
  thumbs: Record<string, HTMLImageElement>;
  areaArt: Record<string, HTMLImageElement>;
  actions: InspectorActions;
}) {
  const node = sel?.kind === "node" ? map.nodes.find((n) => n.level_id === sel.id) : undefined;
  const area = sel?.kind === "area" ? map.areas.find((a) => a.stage_id === sel.id) : undefined;
  const edge = sel?.kind === "edge" ? map.edges[sel.index] : undefined;

  if (node) {
    return <NodePanel map={map} node={node} thumb={thumbs[node.level_id]} actions={actions} />;
  }
  if (area) {
    return <AreaPanel map={map} area={area} art={areaArt[area.stage_id]} actions={actions} />;
  }
  if (edge && sel?.kind === "edge") {
    return <EdgePanel map={map} edge={edge} index={sel.index} actions={actions} />;
  }
  return (
    <>
      <div className="wm-hd">
        <div className="t">
          <h3>Nothing selected</h3>
        </div>
      </div>
      <div className="wm-bd">
        <p className="note">
          Click a level, an area or a path. Areas are the pack's stages — they already carry the
          theme, blocks, roster and music every level inside inherits.
        </p>
      </div>
    </>
  );
}

/** One labelled field row: 78px label column, mono value, optional badge and
 *  inline action link (design `.f`). */
function Field({
  label,
  value,
  badge,
  action,
  title,
}: {
  label: string;
  value: string;
  badge?: "area" | "override";
  action?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="f">
      <span>{label}</span>
      <span className="v" title={title ?? value}>
        {value}
      </span>
      {badge && <span className={badge === "override" ? "inh ovr" : "inh"}>{badge}</span>}
      {action}
    </div>
  );
}

function statusPill(node: WorldMapNode, verdict: { ok: boolean; problems: number } | undefined) {
  if (node.status === "planned") return { cls: "new", text: "not built" };
  if (!verdict) return { cls: "", text: "not validated" };
  if (verdict.ok) return { cls: "ok", text: "validated" };
  return { cls: "warn", text: `${verdict.problems} issues` };
}

function NodePanel({
  map,
  node,
  thumb,
  actions,
}: {
  map: WorldMap;
  node: WorldMapNode;
  thumb?: HTMLImageElement;
  actions: InspectorActions;
}) {
  const levelValidation = useStore((s) => s.levelValidation);
  const report = levelValidation[node.level_id];
  // Same count the status dot and the level editor's chip use — rooms folded
  // in, so the pill can never disagree with them.
  const verdict = report ? { ok: report.ok, problems: countProblems(report) } : undefined;
  const pill = statusPill(node, verdict);
  const area = map.areas.find((a) => a.stage_id === node.stage_id);
  const planned = node.status === "planned";
  const overrides = node.overrides ?? [];
  // The world starts at the first level of the first area — that's the
  // progression order canon builds, not a flag on the level.
  const isStart = map.areas[0]?.level_ids[0] === node.level_id;
  const connections = map.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.a === node.level_id || e.b === node.level_id);

  const inherited = (key: string): "area" | "override" =>
    overrides.includes(key) ? "override" : "area";
  const overrideLink = (
    <button className="lnk" disabled title={INHERIT_REASON}>
      override
    </button>
  );

  return (
    <>
      <div className="wm-hd">
        <div className="t">
          <h3>{planned ? "Untitled level" : nodeLabel(node)}</h3>
        </div>
        <div className="t">
          <span className="id">{node.level_id}</span>
          <span className={`pill ${pill.cls}`}>{pill.text}</span>
          {isStart && <span className="pill">world start</span>}
          {node.origin === "manual" && <span className="pill">placed by you</span>}
        </div>
      </div>
      <div className="wm-bd">
        {planned ? (
          <>
            <div className="wm-thumb empty">no level yet</div>
            <div className="blk">
              <Field
                label="Area"
                value={area ? areaName(area) : "unassigned"}
                action={
                  area ? (
                    <button
                      className="lnk"
                      onClick={() => actions.select({ kind: "area", id: area.stage_id })}
                    >
                      open
                    </button>
                  ) : undefined
                }
              />
            </div>
            <p className="note">
              {area
                ? "This slot is on the world map but has no level behind it yet. Build it from the area's theme now, or leave it and design it later — paths and area rules already apply."
                : "Dropped outside every area, so it inherits nothing yet. Publish it into a stage to give it a theme, block set and music bed."}
            </p>
            <div className="blk">
              <button
                className="btn pri wide"
                disabled={!area}
                onClick={() => actions.openLevel(node.level_id, true)}
              >
                {area ? `Generate from ${areaName(area)}` : "Generate"}
              </button>
              <button className="btn wide" onClick={() => actions.openLevel(node.level_id)}>
                Open blank in editor
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              className="wm-thumb"
              style={thumb ? { backgroundImage: `url(${thumb.src})` } : undefined}
            >
              <span className="ov">
                {node.size ?? "—"} · {node.entities ?? 0} entities
              </span>
            </div>
            <div className="blk">
              <Field
                label="Area"
                value={area ? areaName(area) : "unassigned"}
                action={
                  area ? (
                    <button
                      className="lnk"
                      onClick={() => actions.select({ kind: "area", id: area.stage_id })}
                    >
                      open
                    </button>
                  ) : undefined
                }
              />
              <Field label="Size" value={node.size ?? "—"} />
              <Field label="Entities" value={`${node.entities ?? 0} placed`} />
              <Field label="Items" value={`${node.items ?? 0} placed`} />
              <Field
                label="Placed by"
                value={node.origin === "manual" ? "you" : "the generator"}
                action={
                  node.origin === "manual" ? (
                    <button
                      className="lnk"
                      title="Drop your placement so the generator positions this level again"
                      onClick={() => actions.resetNode(node.level_id)}
                    >
                      reset
                    </button>
                  ) : undefined
                }
              />
              {node.rooms && <Field label="Rooms" value={node.rooms.join(", ")} />}
            </div>
            <div className="hr" />
            <div className="blk">
              <span className="sect">Inherited from area</span>
              <Field
                label="Theme"
                value={area?.theme || "—"}
                badge={inherited("theme")}
                action={overrideLink}
              />
              <Field
                label="Blocks"
                value={area?.blocks || "—"}
                badge={inherited("blocks")}
                action={overrideLink}
              />
              <Field
                label="Music"
                value={area?.music ?? "no music bed"}
                badge={inherited("music")}
                action={overrideLink}
              />
              <Field
                label="Enemy pool"
                value={area?.enemy_pool?.length ? `${area.enemy_pool.length} enemies` : "—"}
                title={area?.enemy_pool?.join(", ")}
                badge={inherited("enemies")}
                action={overrideLink}
              />
              {overrides.includes("physics") && (
                <Field
                  label="Physics"
                  value="per-level rules"
                  badge="override"
                  title="This level validates under its own movement/rule overrides."
                />
              )}
            </div>
          </>
        )}

        <div className="hr" />
        <div className="blk">
          <span className="sect">Connections · {connections.length}</span>
          {connections.map(({ e, i }) => {
            const other = e.a === node.level_id ? e.b : e.a;
            const dir = e.kind === "one" ? (e.a === node.level_id ? "→" : "←") : "↔";
            return (
              <button
                key={i}
                className="conn"
                onClick={() => actions.select({ kind: "edge", index: i })}
              >
                {dir} <b>{other}</b>
                <span className="sp" />
                {e.kind === "lock" ? (
                  <span className="pill warn">{e.condition || "locked"}</span>
                ) : e.kind === "new" ? (
                  <span className="pill new">planned</span>
                ) : e.stop ? (
                  <span className="pill">stop</span>
                ) : (
                  <span className="pill">open</span>
                )}
              </button>
            );
          })}
          <button className="btn wide" onClick={() => actions.startConnection(node.level_id)}>
            ＋ Add connection
          </button>
        </div>

        <div className="acts">
          {!planned && (
            <button className="btn pri wide" onClick={() => actions.openLevel(node.level_id)}>
              Open in level editor
            </button>
          )}
          <button
            className="btn wide"
            disabled
            title="Copying a level into a new branch needs a duplicate verb canon doesn't have yet."
          >
            Duplicate as branch
          </button>
        </div>
      </div>
    </>
  );
}

function AreaPanel({
  map,
  area,
  art,
  actions,
}: {
  map: WorldMap;
  area: WorldMapArea;
  art?: HTMLImageElement;
  actions: InspectorActions;
}) {
  const index = map.areas.findIndex((a) => a.stage_id === area.stage_id);
  const members = area.level_ids
    .map((id) => map.nodes.find((n) => n.level_id === id))
    .filter((n): n is WorldMapNode => !!n);
  const overriding = members.filter((n) => (n.overrides ?? []).length);
  const changeLink = (
    <button className="lnk" disabled title={INHERIT_REASON}>
      change
    </button>
  );

  return (
    <>
      <div className="wm-hd">
        <div className="t">
          <span className="wm-swatch" style={{ background: areaStroke(index) }} />
          <h3>{areaName(area)}</h3>
        </div>
        <div className="t">
          <span className="id">{area.stage_id}</span>
          <span className="pill">{area.level_ids.length} levels</span>
        </div>
      </div>
      <div className="wm-bd">
        <div className="wm-thumb" style={art ? { backgroundImage: `url(${art.src})` } : undefined}>
          <span className="ov">area art</span>
        </div>
        <p className="note">{area.theme || "No design note on this area."}</p>
        <div className="blk">
          <span className="sect">Defaults for every level inside</span>
          <Field label="Theme" value={area.theme || "—"} action={changeLink} />
          <Field label="Biome" value={area.biome || "—"} action={changeLink} />
          <Field label="Blocks" value={area.blocks || "—"} action={changeLink} />
          <Field
            label="Enemy pool"
            value={area.enemy_pool?.length ? area.enemy_pool.join(", ") : "—"}
            title={area.enemy_pool?.join(", ")}
            action={changeLink}
          />
          <Field label="Music bed" value={area.music ?? "no music bed"} action={changeLink} />
          {area.boss && <Field label="Boss" value={area.boss} />}
        </div>
        <p className="note">
          {overriding.length ? (
            <>
              <b className="accent">
                {overriding.length} level{overriding.length > 1 ? "s" : ""}
              </b>{" "}
              depart{overriding.length > 1 ? "" : "s"} from this —{" "}
              {overriding.map((n) => nodeLabel(n)).join(", ")}. Changing a default here leaves those
              alone.
            </>
          ) : (
            "No level inside departs from these yet."
          )}
        </p>
        <div className="hr" />
        <div className="blk">
          <span className="sect">Levels</span>
          {members.map((n) => (
            <button
              key={n.level_id}
              className="conn"
              onClick={() => actions.select({ kind: "node", id: n.level_id })}
            >
              <b>{nodeLabel(n)}</b> {n.status === "planned" ? "planned" : n.level_id}
              <span className="sp" />
              <span className="pill">{n.size ?? "—"}</span>
            </button>
          ))}
        </div>
        <div className="acts">
          <button className="btn pri wide" onClick={() => actions.createIn(area.stage_id)}>
            Generate a level here
          </button>
          <button
            className="btn wide"
            disabled
            title="Re-theming a whole area means regenerating its tile set, roster and music together — that's a pipeline run, not an edit."
          >
            Re-theme area
          </button>
        </div>
      </div>
    </>
  );
}

const KINDS: [WorldMapEdge["kind"], string][] = [
  ["path", "Two-way"],
  ["one", "One-way"],
  ["lock", "Conditional"],
];

function EdgePanel({
  map,
  edge,
  index,
  actions,
}: {
  map: WorldMap;
  edge: WorldMapEdge;
  index: number;
  actions: InspectorActions;
}) {
  const patch = (p: Partial<WorldMapEdge>) =>
    actions.setEdges(map.edges.map((e, i) => (i === index ? { ...e, ...p } : e)));

  return (
    <>
      <div className="wm-hd">
        <div className="t">
          <h3>Path</h3>
        </div>
        <div className="t">
          <span className="id">
            {edge.a} {edge.kind === "one" ? "→" : "↔"} {edge.b}
          </span>
        </div>
      </div>
      <div className="wm-bd">
        <div className="blk">
          <span className="sect">Direction</span>
          <div className="segmented wide">
            {KINDS.map(([k, label]) => (
              <button
                key={k}
                className={edge.kind === k ? "seg-btn active" : "seg-btn"}
                onClick={() => patch({ kind: k })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="note">
            {edge.kind === "one"
              ? "One-way. The player crosses into the next area and cannot walk back — used at area gates."
              : edge.kind === "lock"
                ? `Opens only while the player carries ${edge.condition || "the required item"}. Drawn as a dashed amber path.`
                : edge.kind === "new"
                  ? "The level at the far end isn't built yet, so this path is drawn dim and dashed."
                  : "Walkable in both directions once either end is cleared."}
          </p>
        </div>
        {edge.kind === "lock" && (
          <div className="blk">
            <span className="sect">Condition</span>
            <label className="wm-field">
              <span>Requires</span>
              <input
                defaultValue={edge.condition ?? ""}
                placeholder="item name"
                onBlur={(e) => {
                  if (e.target.value !== (edge.condition ?? "")) {
                    patch({ condition: e.target.value });
                  }
                }}
              />
            </label>
          </div>
        )}
        <div className="hr" />
        <div className="blk">
          <span className="sect">Path stops</span>
          {edge.stop ? (
            <>
              <div className="conn">
                <b>midpoint</b>
                <span className="sp" />
                <span className="pill">jumpable</span>
              </div>
              <label className="wm-field">
                <span>Label</span>
                <input
                  defaultValue={edge.stop}
                  onBlur={(e) => {
                    if (e.target.value !== edge.stop) patch({ stop: e.target.value });
                  }}
                />
              </label>
              <p className="note">
                Players can pause here and jump. Attach a secret exit or a hidden reward to make
                poking around pay.
              </p>
              <button className="btn wide" onClick={() => patch({ stop: undefined })}>
                Remove stop
              </button>
            </>
          ) : (
            <>
              <p className="note">No stop on this path — the player walks straight through.</p>
              <button className="btn wide" onClick={() => patch({ stop: "jump · secret exit?" })}>
                ＋ Add stop
              </button>
            </>
          )}
        </div>
        <div className="acts">
          <button className="btn dang wide" onClick={() => actions.deleteEdge(index)}>
            Delete path
          </button>
        </div>
      </div>
    </>
  );
}
