// The scene's own gates, trigger, `once` and on-finish effects (README screen
// 08, "Tray — Scene settings").
//
// EXTENDS `ConditionRow` / `EffectRow` unchanged — the same namespace-driven
// controls, the same raw token under each row, the same engine-evaluability
// dot. The ONE thing that differs is the SCOPE: these rows are authored at
// `scene` scope, which is the only scope where `actor:<id>:present|absent` is
// legal. The grammar decides that (`legalIn`), not this file — and a tree
// carrying an `actor:` row is refused WITH THAT REASON rather than silently
// ignored.
//
// Triggers come from the pack's own `dialogue.scene.triggers`, never a
// hardcoded three: a template that adds a trigger gets the option for free.

import { ConditionRow, EffectRow } from "../dialogue/ConditionRow";
import { EngineLagTrayNote } from "../dialogue/EngineLag";
import {
  engineReasonFor,
  engineSupports,
  formatToken,
  type DialogueVocab,
} from "../dialogue/grammar";
import type { SceneDoc } from "../dialogue/scene";
import type { EditOp } from "../dialogue/ops";
import type { PackInfo } from "../../lib/invoke";

export function SceneSettings({
  doc,
  vocab,
  packInfo,
  editable,
  onOps,
}: {
  doc: SceneDoc;
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  editable: boolean;
  onOps: (ops: EditOp[]) => void;
}) {
  const triggers = vocab.scene.triggers ?? [];
  // `value`, not `tokens`: canon's `_apply_scene_op` reads `value` for every
  // scene op, and refuses the tree half's spelling fail-closed.
  const setSettings = (value: string[]) => onOps([{ k: "scene.settings", scene: doc.id, value }]);
  const setFinish = (value: string[]) => onOps([{ k: "scene.on_finish", scene: doc.id, value }]);

  return (
    <section className="dlg-inspector-sect dlg-scene-settings" data-testid="scene-settings">
      <header>
        <span>scene settings</span>
        <span className="dlg-rail-count">{doc.settings.length}</span>
      </header>
      <p className="dlg-inspector-note">when can this play</p>

      {doc.settings.map((token, i) => (
        <ConditionRow
          key={`${token}#${i}`}
          token={token}
          // `scene` scope — the ONE scope where `actor:` is legal. A tree row
          // carrying one is refused by the grammar with that reason named.
          scope="scene"
          vocab={vocab}
          packInfo={packInfo}
          engineEvaluable={engineSupports(token, "condition", packInfo, "scene")}
          engineReason={engineReasonFor(token, "condition", packInfo, "scene")}
          onChange={(next) => setSettings(doc.settings.map((t, j) => (j === i ? next : t)))}
          onRemove={() => setSettings(doc.settings.filter((_, j) => j !== i))}
        />
      ))}
      <button
        className="btn"
        disabled={!editable}
        title={editable ? "gate this scene" : "enter Edit mode to gate this scene"}
        onClick={() => setSettings([...doc.settings, formatToken(vocab.condition_namespaces[0])])}
      >
        ＋ setting
      </button>
      <EngineLagTrayNote tokens={doc.settings} vocab={vocab} packInfo={packInfo} scope="scene" />

      <label className="dlg-scene-once">
        <input
          type="checkbox"
          checked={doc.once}
          disabled={!editable}
          onChange={(e) => onOps([{ k: "scene.once", scene: doc.id, value: e.target.checked }])}
        />
        <span>Plays once</span>
      </label>

      <label className="dlg-field">
        <span>triggered by</span>
        <select
          value={doc.trigger}
          aria-label="scene trigger"
          disabled={!editable}
          onChange={(e) => onOps([{ k: "scene.trigger", scene: doc.id, value: e.target.value }])}
        >
          {triggers.map((trigger) => (
            <option key={trigger} value={trigger}>
              {trigger}
            </option>
          ))}
          {triggers.includes(doc.trigger) ? null : (
            <option value={doc.trigger}>{doc.trigger} (not declared by this pack)</option>
          )}
        </select>
      </label>

      <header>
        <span>on finish</span>
        <span className="dlg-rail-count">{doc.on_finish.length}</span>
      </header>
      {doc.on_finish.map((token, i) => (
        <EffectRow
          key={`${token}#${i}`}
          token={token}
          vocab={vocab}
          packInfo={packInfo}
          engineEvaluable={engineSupports(token, "effect", packInfo, "scene")}
          engineReason={engineReasonFor(token, "effect", packInfo, "scene")}
          onChange={(next) => setFinish(doc.on_finish.map((t, j) => (j === i ? next : t)))}
          onRemove={() => setFinish(doc.on_finish.filter((_, j) => j !== i))}
        />
      ))}
      <button
        className="btn"
        disabled={!editable}
        onClick={() => setFinish([...doc.on_finish, formatToken(vocab.effects[0])])}
      >
        ＋ effect
      </button>
      <EngineLagTrayNote tokens={doc.on_finish} vocab={vocab} packInfo={packInfo} scope="effects" />
    </section>
  );
}
