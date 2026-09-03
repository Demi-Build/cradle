// The cross-NPC lane grid — one horizontal lane per participating NPC, one
// column per quest state (README screen 07, "Canvas").
//
// EXTENDS the authoring model rather than adding a second one: a "beat" is a
// NODE in some NPC's tree, located by `(npc, tree, node_id)`. Nothing here owns
// data. The grid is a projection — the same beat is legitimately reachable from
// the character who says it, the quest that needs it, and the scene it happens
// in, and that duplication is a feature (README "Overview").
//
// Two things the design pins:
//
//   • EMPTY CELLS ARE DROP TARGETS, not gaps. `＋ beat for <NPC>` sits in every
//     empty cell, which makes coverage holes visible as holes in a grid rather
//     than as an absence you have to notice. Doctrine 4 again: the affordance
//     is disabled-with-a-reason outside Edit mode, never collapsed away.
//   • A GROUP SCENE spans its lanes as a translucent blue block inside the
//     column where it plays — `--info` means "this belongs to another surface
//     too", and a scene belongs to every actor in it.
//
// Which column a beat sits in comes from its own gates: a node whose choices
// carry `quest:<id>:<state>` belongs to that state; a node with no quest gate
// belongs to the lane's fallback column. That is a PROJECTION of authored
// tokens, never a stored position — there is no quest-lane coordinate in the
// pack, and inventing one would be a second source of truth.

import type { QuestBeat, QuestSceneBlock } from "./questBeats";

export function QuestLanes({
  states,
  lanes,
  scenes = [],
  selected,
  editable,
  onSelectBeat,
  onAddBeat,
  onOpenScene,
}: {
  /** The pack's quest states, in the pack's own order, plus the fallback. */
  states: string[];
  lanes: { npcId: string; npcName: string; beats: QuestBeat[] }[];
  scenes?: QuestSceneBlock[];
  selected?: { npcId: string; nodeId: string } | null;
  editable: boolean;
  onSelectBeat: (beat: QuestBeat) => void;
  onAddBeat?: (npcId: string, state: string) => void;
  onOpenScene?: (sceneId: string) => void;
}) {
  const columns = [...states, "—"];
  return (
    <div className="dlg-lanes" data-testid="quest-lanes">
      <div
        className="dlg-lanes-grid"
        style={{ gridTemplateColumns: `160px repeat(${columns.length}, minmax(180px, 1fr))` }}
      >
        <span className="dlg-lanes-corner dlg-mono dlg-dim">npc / state</span>
        {columns.map((state) => (
          <span key={state} className="dlg-lanes-colhead dlg-mono">
            {state === "—" ? "ungated" : state}
          </span>
        ))}
        {lanes.map((lane) => (
          <LaneRow
            key={lane.npcId}
            lane={lane}
            columns={columns}
            selected={selected}
            editable={editable}
            onSelectBeat={onSelectBeat}
            onAddBeat={onAddBeat}
          />
        ))}
      </div>
      {scenes.length > 0 ? (
        <div className="dlg-lanes-scenes">
          {scenes.map((scene) => (
            <button
              key={scene.id}
              className="dlg-lanes-scene"
              disabled={!onOpenScene}
              title="one scene, many surfaces — editing there edits it everywhere"
              onClick={() => onOpenScene?.(scene.id)}
            >
              <span className="dlg-mono">scene</span> {scene.title}
              <span className="dlg-dim">
                {" "}
                · {scene.actors.length} actor{scene.actors.length === 1 ? "" : "s"}
                {scene.state ? ` · plays in ${scene.state}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LaneRow({
  lane,
  columns,
  selected,
  editable,
  onSelectBeat,
  onAddBeat,
}: {
  lane: { npcId: string; npcName: string; beats: QuestBeat[] };
  columns: string[];
  selected?: { npcId: string; nodeId: string } | null;
  editable: boolean;
  onSelectBeat: (beat: QuestBeat) => void;
  onAddBeat?: (npcId: string, state: string) => void;
}) {
  return (
    <>
      <span className="dlg-lanes-npc">{lane.npcName}</span>
      {columns.map((state) => {
        const key = state === "—" ? null : state;
        const cell = lane.beats.filter((beat) => beat.state === key);
        if (cell.length === 0) {
          return (
            <div key={state} className="dlg-lanes-cell empty">
              {/* Disabled WITH a reason rather than collapsed away: an empty
                  cell IS the coverage gap, and hiding it hides the gap. */}
              <button
                className="dlg-lanes-add"
                disabled={!editable || !onAddBeat || key === null}
                title={
                  key === null
                    ? "the ungated column is where beats with no quest gate land — add one in a state instead"
                    : editable
                      ? `add a beat for ${lane.npcName} in ${state}`
                      : "enter Edit mode to add a beat"
                }
                onClick={() => key && onAddBeat?.(lane.npcId, key)}
              >
                ＋ beat for {lane.npcName}
              </button>
            </div>
          );
        }
        return (
          <div key={state} className="dlg-lanes-cell">
            {cell.map((beat) => (
              <button
                key={`${beat.treeId}/${beat.nodeId}`}
                className={`dlg-lanes-beat ${
                  selected?.npcId === beat.npcId && selected.nodeId === beat.nodeId ? "on" : ""
                }`}
                onClick={() => onSelectBeat(beat)}
              >
                <span className="dlg-mono dlg-dim">{beat.nodeId}</span>
                {beat.gates > 0 ? <span className="dlg-ribbon-badge">⊳{beat.gates}</span> : null}
                <span className="dlg-lanes-beat-text">{beat.prompt || "(no prompt)"}</span>
                {/* DECLARED REDUCTION (README screen 07 asks for cross-lane
                    EDGES labelled with the effect that carries the handoff;
                    this draws the token as a chip inside the source beat
                    instead). Closing it needs an edge layer over the lane grid
                    — the grid is a CSS grid, not React Flow, so the edges need
                    measured cell positions — plus resolving which lane receives
                    the quest move. Until then the token is at least named where
                    it fires. */}
                {beat.handoffs.map((token) => (
                  <span key={token} className="dlg-lanes-handoff dlg-mono">
                    {token}
                  </span>
                ))}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
