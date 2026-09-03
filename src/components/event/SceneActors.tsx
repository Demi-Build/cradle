// The Actors list (README screen 08, "Tray — Actors").
//
// EXTENDS `EntityPicker` for the `＋ actor` gesture — the same 326px popover
// used to pick an item for a condition, so adding an NPC to a scene and
// choosing an item are the same gesture learned once. The picker's two rules
// carry here verbatim: an NPC already in the scene stays VISIBLE and disabled
// with the reason (`already an actor`), and the consequence of a pick is named
// on the row before it is made.
//
// Stated in place, because it is the whole model: an absent OPTIONAL actor's
// lines are skipped, not blocked; removing a REQUIRED actor cancels the scene,
// and that is previewed before it commits.

import { useState } from "react";
import { EntityPicker } from "../dialogue/EntityPicker";
import { typeIdForEntity, type DialogueVocab } from "../dialogue/grammar";
import { lineCounts, type SceneDoc } from "../dialogue/scene";
import type { EditOp } from "../dialogue/ops";
import type { PackInfo } from "../../lib/invoke";

export function SceneActors({
  doc,
  vocab,
  packInfo,
  editable,
  onOps,
  onRemoveRequired,
}: {
  doc: SceneDoc;
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  editable: boolean;
  onOps: (ops: EditOp[]) => void;
  /** Removing a required actor cancels the scene — previewed before commit. */
  onRemoveRequired: (characterId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const counts = lineCounts(doc);
  const npcType = typeIdForEntity(vocab.operands.actor?.entity ?? "npc", packInfo);

  return (
    <section className="dlg-inspector-sect dlg-scene-actors" data-testid="scene-actors">
      <header>
        <span>actors</span>
        <span className="dlg-rail-count">{doc.actors.length}</span>
        <button
          className="btn"
          disabled={!editable}
          title={editable ? "add an actor from this world" : "enter Edit mode to change the cast"}
          onClick={() => setPickerOpen(true)}
        >
          ＋ actor
        </button>
      </header>

      {doc.actors.length === 0 ? (
        <p className="dlg-inspector-note">
          No actors yet. A scene with no actors is legal — it plays as narration.
        </p>
      ) : null}

      {doc.actors.map((actor) => (
        <div key={actor.character_id} className="dlg-scene-actor">
          <span className="dlg-mono">{actor.character_id}</span>
          <span className="dlg-dim">speaks {counts[actor.character_id] ?? 0}</span>
          <select
            value={actor.required ? "required" : "optional"}
            aria-label={`${actor.character_id} required`}
            disabled={!editable}
            onChange={(e) =>
              onOps([
                {
                  k: "scene.actor.required",
                  scene: doc.id,
                  character_id: actor.character_id,
                  required: e.target.value === "required",
                },
              ])
            }
          >
            <option value="required">required</option>
            <option value="optional">optional</option>
          </select>
          <button
            className="dlg-row-x"
            disabled={!editable}
            aria-label={`Remove ${actor.character_id}`}
            onClick={() =>
              actor.required
                ? onRemoveRequired(actor.character_id)
                : onOps([
                    {
                      k: "scene.actor.remove",
                      scene: doc.id,
                      character_id: actor.character_id,
                    },
                  ])
            }
          >
            ×
          </button>
        </div>
      ))}

      <p className="dlg-inspector-note">
        An absent <strong>optional</strong> actor&apos;s lines are skipped, not blocked. Removing a{" "}
        <strong>required</strong> actor cancels the scene — previewed before commit.
      </p>

      {pickerOpen ? (
        <EntityPicker
          title="scene actor"
          slot={{
            types: [npcType],
            exclude: doc.actors.map((a) => a.character_id),
            excludeReason: () => "already an actor",
            // Named before the pick, not after: an NPC with no lines yet gets
            // a new lane in every surface that reads this scene.
            consequence: (id) =>
              counts[id] ? null : "no lines yet — adding them opens a new lane",
            states: ["optional", "required"],
            onPick: (id, state) => {
              onOps([
                {
                  k: "scene.actor.add",
                  scene: doc.id,
                  character_id: id,
                  required: state === "required",
                },
              ]);
              setPickerOpen(false);
            },
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
