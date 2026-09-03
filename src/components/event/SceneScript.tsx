// The scene script — a numbered vertical sequence, not a graph (README screen
// 08, "Canvas").
//
// A scene is mostly linear and a graph would be a worse reader for it, so this
// is deliberately NOT `DialogueGraphMode`. What it does share is the editing
// model: prose edits in place, structure edits in the tray, and every gesture
// emits an `EditOp` and nothing else.
//
// Branch targets are LINE NUMBERS (`→ 07`), which is why `scene.line.add`
// appends a new number rather than renumbering: renumbering would silently
// re-point every choice option in the scene.
//
// Conditional lines are dashed-amber and carry `skipped if absent`; a choice
// point renders as an accent-bordered block listing its options with their
// gates. Both read from the same `GateRibbon` the tree editor uses, so the
// engine-lag dots mean the same thing here.

import { GateRibbon } from "../dialogue/GateRibbon";
import { engineReasonFor, engineSupports } from "../dialogue/grammar";
import { nextLineNumber, type SceneDoc, type SceneLine } from "../dialogue/scene";
import type { EditOp } from "../dialogue/ops";
import type { PackInfo } from "../../lib/invoke";

export function SceneScript({
  doc,
  packInfo,
  editable,
  selected,
  onSelect,
  onOps,
  onDeleteLine,
  /** Per-line playback from `canon scene test`, when the tester is running. */
  played,
}: {
  doc: SceneDoc;
  packInfo: PackInfo | null;
  editable: boolean;
  selected: number | null;
  onSelect: (n: number | null) => void;
  onOps: (ops: EditOp[]) => void;
  onDeleteLine: (n: number) => void;
  played?: Map<number, { played: boolean; skipped_because?: string }>;
}) {
  const optionalActors = new Set(doc.actors.filter((a) => !a.required).map((a) => a.character_id));

  return (
    <div className="dlg-script" data-testid="scene-script">
      {doc.lines.length === 0 ? (
        <p className="dlg-inspector-empty">
          No lines yet. A scene with no lines is legal and plays as an empty beat — add the first
          one below.
        </p>
      ) : null}

      {doc.lines.map((line) => (
        <LineRow
          key={line.n}
          line={line}
          doc={doc}
          packInfo={packInfo}
          editable={editable}
          optionalActors={optionalActors}
          selected={selected === line.n}
          play={played?.get(line.n)}
          onSelect={() => onSelect(line.n)}
          onOps={onOps}
          onDelete={() => onDeleteLine(line.n)}
        />
      ))}

      <button
        className="dlg-script-add"
        disabled={!editable}
        title={editable ? "add a line at the end" : "enter Edit mode to write lines"}
        onClick={() =>
          onOps([
            {
              k: "scene.line.add",
              scene: doc.id,
              // an insert POSITION (canon clamps it to 1..len+1), and `value`
              // is the payload key canon reads.
              n: nextLineNumber(doc),
              value: { k: "line", speaker: doc.actors[0]?.character_id ?? null, text: "" },
            },
          ])
        }
      >
        ＋ line — pick an actor
      </button>
    </div>
  );
}

function LineRow({
  line,
  doc,
  packInfo,
  editable,
  optionalActors,
  selected,
  play,
  onSelect,
  onOps,
  onDelete,
}: {
  line: SceneLine;
  doc: SceneDoc;
  packInfo: PackInfo | null;
  editable: boolean;
  optionalActors: Set<string>;
  selected: boolean;
  play?: { played: boolean; skipped_because?: string };
  onSelect: () => void;
  onOps: (ops: EditOp[]) => void;
  onDelete: () => void;
}) {
  const n = String(line.n).padStart(2, "0");

  if (line.k === "choice") {
    return (
      <div
        className={`dlg-script-line choice ${selected ? "on" : ""}`}
        onClick={onSelect}
        data-testid={`scene-line-${line.n}`}
      >
        <span className="dlg-script-n dlg-mono">{n}</span>
        <div className="dlg-script-body">
          <span className="dlg-dim">choice point · {line.options.length} options</span>
          {line.options.map((option, i) => (
            <div key={i} className="dlg-script-option">
              <GateRibbon
                dots={option.conditions.map((token) => ({
                  token,
                  engineEvaluable: engineSupports(token, "condition", packInfo, "scene"),
                  reason: engineReasonFor(token, "condition", packInfo, "scene"),
                }))}
              />
              <span>{option.text || "(no text)"}</span>
              <span className="dlg-mono dlg-dim">
                → {option.to === null ? "ends the scene" : String(option.to).padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const conditional = line.conditions.length > 0;
  const optional = line.speaker !== null && optionalActors.has(line.speaker);
  return (
    <div
      className={`dlg-script-line ${selected ? "on" : ""}`}
      data-conditional={conditional || optional ? "1" : undefined}
      data-skipped={play && !play.played ? "1" : undefined}
      onClick={onSelect}
      data-testid={`scene-line-${line.n}`}
    >
      <span className="dlg-script-n dlg-mono">{n}</span>
      <div className="dlg-script-body">
        <div className="dlg-script-head">
          <select
            value={line.speaker ?? ""}
            aria-label={`line ${line.n} speaker`}
            disabled={!editable}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onOps([
                {
                  k: "scene.line.speaker",
                  scene: doc.id,
                  n: line.n,
                  value: e.target.value || null,
                },
              ])
            }
          >
            <option value="">— narration —</option>
            {doc.actors.map((actor) => (
              <option key={actor.character_id} value={actor.character_id}>
                {actor.character_id}
              </option>
            ))}
            {line.speaker && !doc.actors.some((a) => a.character_id === line.speaker) ? (
              <option value={line.speaker}>{line.speaker} (not an actor)</option>
            ) : null}
          </select>
          {conditional ? (
            <GateRibbon
              dots={line.conditions.map((token) => ({
                token,
                engineEvaluable: engineSupports(token, "condition", packInfo, "scene"),
                reason: engineReasonFor(token, "condition", packInfo, "scene"),
              }))}
            />
          ) : null}
          {optional ? <span className="dlg-script-tag">skipped if absent</span> : null}
          {editable ? (
            <button
              className="dlg-row-x"
              aria-label={`Delete line ${line.n}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        <textarea
          className="dlg-script-text"
          value={line.text}
          aria-label={`line ${line.n} text`}
          disabled={!editable}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            onOps([{ k: "scene.line.text", scene: doc.id, n: line.n, value: e.target.value }])
          }
        />
        {line.conditions.length ? (
          <div className="dlg-row-token dlg-mono">{line.conditions.join(" · ")}</div>
        ) : null}
        {play && !play.played && play.skipped_because ? (
          <p className="dlg-script-skip">⚠ {play.skipped_because}</p>
        ) : null}
      </div>
    </div>
  );
}
