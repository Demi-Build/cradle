// The scene scope — an event of type `scene`, hosted on the event's own tab
// (README screen 08; PLAN step 12).
//
// A scene is ITS OWN ENTITY, not a tree with multiple speakers and not a lane:
// it has actors, its own trigger gates, and a life independent of any one
// participant's dialogue. The NPC and quest surfaces EMBED and deep-link to it.
// One scene, many surfaces — editing here edits it everywhere.
//
// EXTENDS the same machinery as the other two scopes: the keyed buffer (this
// one is `scene:<id>`, holding a `SceneDoc`), `⌘S` → one canon verb, the same
// mode bar, tray, condition rows and dock. The only genuinely new parts are the
// script reader, the Actors list and the presence toggles — the one test
// control scenes need that trees do not.
//
// `actor:<id>:present|absent` is the scene-only namespace, and the grammar
// refuses it in a tree WITH THE REASON. The rejection is tested; nothing in
// this file re-checks scope.

import { useCallback, useEffect, useMemo, useState } from "react";
import { SceneActors } from "./SceneActors";
import { SceneScript } from "./SceneScript";
import { SceneSettings } from "./SceneSettings";
import { ModeBar } from "../dialogue/ModeBar";
import { SaveSheet } from "../dialogue/SaveSheet";
import { EngineChip, EngineLagTrayNote } from "../dialogue/EngineLag";
import { ConditionRow } from "../dialogue/ConditionRow";

import type { Consequences } from "../dialogue/DeletePreview";
import { engineReasonFor, engineSupports, formatToken, vocabOf } from "../dialogue/grammar";
import { sceneKey } from "../dialogue/ops";
import { sceneReport, toSceneDoc, toSceneRow, type SceneDoc } from "../dialogue/scene";
import { dirtyChipText, useDialogueEditor } from "../dialogue/useDialogueEditor";
import { api, type SceneTestResult, type SceneValidation } from "../../lib/invoke";
import { useStore, type DialogueMode } from "../../store";
import { isShortcut } from "../../lib/keys";

export function SceneTab({
  event,
  sceneId,
  onOpenNpc,
}: {
  event: unknown;
  sceneId: string;
  onOpenNpc?: (npcId: string) => void;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const packInfo = useStore((s) => s.world?.pack_info ?? null);
  const mode = useStore((s) => s.dialogue.mode);
  const setMode = useStore((s) => s.setDialogueMode);
  const setScope = useStore((s) => s.setDialogueScope);
  const setActiveKey = useStore((s) => s.setActiveDialogueKey);

  const vocab = useMemo(() => vocabOf(packInfo), [packInfo]);
  const base = useMemo(() => toSceneDoc(event, sceneId, vocab), [event, sceneId, vocab]);
  const key = sceneKey(sceneId);
  const editor = useDialogueEditor<SceneDoc>(key, base);
  const doc = editor.doc ?? base;

  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stored, setStored] = useState<SceneValidation | null>(null);
  const [walk, setWalk] = useState<SceneTestResult | null>(null);
  const [presence, setPresence] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Consequences | null>(null);

  useEffect(() => {
    editor.ensure();
  }, [editor]);

  useEffect(() => {
    setActiveKey(key);
    setScope("scene");
    return () => {
      setActiveKey(null);
      setScope("npc");
    };
  }, [key, setActiveKey, setScope]);

  const refreshStored = useCallback(() => {
    if (!worldPath) return;
    api
      .sceneValidate(worldPath, sceneId)
      .then(setStored)
      .catch(() => setStored(null));
  }, [sceneId, worldPath]);
  useEffect(refreshStored, [refreshStored]);

  // Every actor starts PRESENT: the default reading of a scene is the one
  // where everyone showed up, and the toggles are how you ask "what if not".
  useEffect(() => {
    setPresence((current) => {
      const next = { ...current };
      let changed = false;
      for (const actor of doc.actors) {
        if (!(actor.character_id in next)) {
          next[actor.character_id] = "present";
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [doc.actors]);

  // The tester walks the UNSAVED buffer, so the scene travels as a payload.
  useEffect(() => {
    if (mode !== "test" || !worldPath) return;
    let alive = true;
    api
      .sceneTest(worldPath, toSceneRow(doc), { actors: presence })
      .then((r) => alive && setWalk(r))
      .catch(() => alive && setWalk(null));
    return () => {
      alive = false;
    };
  }, [doc, mode, presence, worldPath]);

  const push = editor.push;
  const report = useMemo(() => sceneReport(doc), [doc]);

  /** One emitter for a line's gate list — `value`, the key canon reads. */
  const setLineConditions = useCallback(
    (n: number, value: string[]) => push([{ k: "scene.line.conditions", scene: doc.id, n, value }]),
    [doc.id, push],
  );

  const doSave = useCallback(async () => {
    if (!editor.dirty || !worldPath) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.sceneUpdate(worldPath, sceneId, editor.ops);
      editor.commit(toSceneDoc(result.row, sceneId, vocab));
      setSheetOpen(false);
      refreshStored();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editor, refreshStored, sceneId, vocab, worldPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, "s")) {
        e.preventDefault();
        if (editor.dirty) setSheetOpen(true);
      } else if (isShortcut(e, "z")) {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (e.key === "Escape") {
        if (pendingDelete) setPendingDelete(null);
        else if (sheetOpen) setSheetOpen(false);
        else if (mode !== "view") setMode("view");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, mode, pendingDelete, setMode, sheetOpen]);

  /** Removing a REQUIRED actor cancels the scene — named before it commits. */
  const previewActorRemoval = (characterId: string) => {
    const spoken = doc.lines.filter((l) => l.k === "line" && l.speaker === characterId).length;
    setPendingDelete({
      kind: "tree",
      id: characterId,
      inbound: [],
      newlyUnreachable: [],
      gatesLost: spoken,
      entryMoves: false,
    });
  };

  const played = useMemo(() => {
    const map = new Map<number, { played: boolean; skipped_because?: string }>();
    for (const entry of walk?.transcript ?? []) {
      map.set(entry.n, { played: entry.played, skipped_because: entry.skipped_because });
    }
    return map;
  }, [walk]);

  const choicePoints = doc.lines.filter((l) => l.k === "choice").length;
  const gatedLines = doc.lines.filter((l) => l.k === "line" && l.conditions.length > 0).length;
  const selected = doc.lines.find((l) => l.n === selectedLine) ?? null;

  return (
    <div
      className="dialogue-tab dlg-surface dlg-scene-scope"
      data-mode={mode}
      data-testid="scene-tab"
    >
      <ModeBar
        mode={mode}
        onMode={(m: DialogueMode) => setMode(m)}
        treeLabel={doc.title || sceneId}
        selectorText={`${doc.actors.length} actor${doc.actors.length === 1 ? "" : "s"} · ${doc.trigger}`}
        counts={`${doc.lines.length} lines · ${choicePoints} choice point${choicePoints === 1 ? "" : "s"} · ${gatedLines} gated lines`}
        dirtyText={editor.summary ? dirtyChipText(editor.summary) : ""}
        onOpenUnsaved={() => setSheetOpen(true)}
        onSave={() => editor.dirty && setSheetOpen(true)}
        saving={saving}
        saveDisabledReason={editor.dirty ? "" : "nothing to save — the buffer is clean"}
        improveDisabledReason="Improve re-authors a character's tree — a scene's lines belong to several"
        testDisabledReason={doc.lines.length === 0 ? "no lines to play yet" : ""}
      >
        <EngineChip vocab={vocab} packInfo={packInfo} scope="scene" />
      </ModeBar>

      <div className="dlg-columns">
        <aside className="dlg-rail" data-testid="scene-rail">
          <div className="dlg-rail-head">
            {/* No ⌘P hint here: the tree switcher is a character-scope
                affordance and is not mounted on this scope, so advertising the
                key would name an action nothing performs. */}
            <span className="dlg-mono">appears in</span>
          </div>
          <section className="dlg-rail-group">
            <header className="dlg-rail-group-head">
              <span className="dlg-mono">npc tree lists</span>
              <span className="dlg-rail-count">· {doc.actors.length}</span>
            </header>
            {doc.actors.map((actor) => (
              <button
                key={actor.character_id}
                className="dlg-rail-row"
                disabled={!onOpenNpc}
                onClick={() => onOpenNpc?.(actor.character_id)}
              >
                <span className="dlg-rail-label">{actor.character_id}</span>
                <span className="dlg-rail-count">→</span>
              </button>
            ))}
          </section>
          <section className="dlg-rail-group">
            <header className="dlg-rail-group-head">
              <span className="dlg-mono">scene outline</span>
              <span className="dlg-rail-count">· {doc.lines.length}</span>
            </header>
            {doc.lines.map((line) => (
              <button
                key={line.n}
                className={`dlg-rail-row ${selectedLine === line.n ? "on" : ""}`}
                onClick={() => setSelectedLine(line.n)}
              >
                <span className="dlg-mono">{String(line.n).padStart(2, "0")}</span>
                <span className="dlg-rail-label">
                  {line.k === "choice"
                    ? `choice · ${line.options.length} options`
                    : `${line.speaker ?? "narration"} · ${line.text.slice(0, 24)}`}
                </span>
                {line.k === "line" && line.conditions.length ? (
                  <span className="dlg-rail-count">⊳{line.conditions.length}</span>
                ) : null}
              </button>
            ))}
          </section>
          <p className="dlg-rail-note">
            One scene, many surfaces. Editing here edits it everywhere.
          </p>
        </aside>

        <div className="dlg-canvas" data-mode={mode}>
          <span className="dlg-mode-pill" data-mode={mode}>
            {mode} mode · scene scope
          </span>
          <SceneScript
            doc={doc}
            packInfo={packInfo}
            editable={mode === "edit"}
            selected={selectedLine}
            onSelect={setSelectedLine}
            onOps={push}
            onDeleteLine={(n) => push([{ k: "scene.line.remove", scene: doc.id, n }])}
            played={mode === "test" ? played : undefined}
          />
        </div>

        {mode !== "view" ? (
          <div className="dlg-tray">
            <SceneActors
              doc={doc}
              vocab={vocab}
              packInfo={packInfo}
              editable={mode === "edit"}
              onOps={push}
              onRemoveRequired={previewActorRemoval}
            />
            <SceneSettings
              doc={doc}
              vocab={vocab}
              packInfo={packInfo}
              editable={mode === "edit"}
              onOps={push}
            />
            {selected && selected.k === "line" ? (
              <section className="dlg-inspector-sect">
                <header>
                  <span>selected line · {String(selected.n).padStart(2, "0")}</span>
                </header>
                {/* The SAME condition-row vocabulary as everywhere else
                    (README screen 08). Rendering these as read-only text left
                    the seeded namespace — a bare `actor` canon refuses by name
                    — with no way to complete or remove it, so one click made
                    the scene unsavable until ⌘Z. */}
                {selected.conditions.length === 0 ? (
                  <p className="dlg-inspector-note">none — this line always plays</p>
                ) : null}
                {selected.conditions.map((token, i) => (
                  <ConditionRow
                    key={`${token}#${i}`}
                    token={token}
                    scope="scene"
                    vocab={vocab}
                    packInfo={packInfo}
                    engineEvaluable={engineSupports(token, "condition", packInfo, "scene")}
                    engineReason={engineReasonFor(token, "condition", packInfo, "scene")}
                    onChange={(next) =>
                      setLineConditions(
                        selected.n,
                        selected.conditions.map((t, j) => (j === i ? next : t)),
                      )
                    }
                    onRemove={() =>
                      setLineConditions(
                        selected.n,
                        selected.conditions.filter((_, j) => j !== i),
                      )
                    }
                  />
                ))}
                <button
                  className="btn"
                  disabled={mode !== "edit"}
                  onClick={() =>
                    setLineConditions(selected.n, [
                      ...selected.conditions,
                      // `actor:` is legal HERE and nowhere else — the picker
                      // and the grammar agree because both read the vocab.
                      formatToken(vocab.scene_only_namespaces[0] ?? "actor"),
                    ])
                  }
                >
                  ＋ condition on this line
                </button>
                <EngineLagTrayNote
                  tokens={selected.conditions}
                  vocab={vocab}
                  packInfo={packInfo}
                  scope="scene"
                />
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "test" ? (
        <div className="dlg-dock" data-testid="scene-dock">
          <header className="dlg-dock-head">
            <span className="dlg-mode-pill" data-mode="test">
              test
            </span>
            <span className="dlg-dock-title">
              who&apos;s present{editor.dirty ? " · testing the unsaved buffer" : ""}
            </span>
            <span className="dlg-dock-gates dlg-mono">
              gates {walk?.gates.pass ?? 0} pass · {walk?.gates.fail ?? 0} fail ·{" "}
              {walk?.gates.unevaluable ?? 0} unevaluable
            </span>
          </header>
          <div className="dlg-statechips" data-testid="scene-presence">
            {doc.actors.map((actor) => {
              const here = presence[actor.character_id] !== "absent";
              return (
                <button
                  key={actor.character_id}
                  className="chip"
                  data-present={here ? "1" : "0"}
                  onClick={() =>
                    setPresence((p) => ({
                      ...p,
                      [actor.character_id]: here ? "absent" : "present",
                    }))
                  }
                >
                  {actor.character_id} {here ? "✓" : "✗ absent"}
                </button>
              );
            })}
            <span className="dlg-state-note">simulated presence — never written to the pack</span>
          </div>
          <div className="dlg-dock-body">
            <div className="dlg-dock-transcript">
              <header className="dlg-dock-colhead">transcript</header>
              {!walk?.plays ? (
                <p className="dlg-verdict-sub fail">
                  ✗ the scene does not play — {walk?.blocked_by ?? "no answer yet"}
                </p>
              ) : null}
              {(walk?.transcript ?? []).map((entry) => (
                <div
                  key={entry.n}
                  className="dlg-transcript-entry"
                  data-played={entry.played ? "1" : "0"}
                >
                  <span className="dlg-mono dlg-dim">
                    {String(entry.n).padStart(2, "0")} {entry.speaker ?? "narration"}
                  </span>
                  <p className="dlg-transcript-prompt">{entry.text}</p>
                  {/* A skipped line is NAMED, never silently vanished. */}
                  {entry.skipped_because ? (
                    <p className="dlg-script-skip">⚠ {entry.skipped_because}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="dlg-sheet-scrim" role="dialog" aria-label="Remove a required actor">
          <div className="dlg-sheet">
            <h3 className="dlg-sheet-title">
              Remove <span className="dlg-mono">{pendingDelete.id}</span>, a required actor?
            </h3>
            <p className="dlg-sheet-note">
              A required actor&apos;s absence cancels the scene. Removing them means the scene can
              no longer play as written, and their {pendingDelete.gatesLost} line(s) stay in the
              script with nobody to speak them — a warning, never a silent deletion of prose.
            </p>
            <div className="dlg-sheet-actions">
              <button className="btn" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button
                className="btn dang"
                onClick={() => {
                  push([
                    {
                      k: "scene.actor.remove",
                      scene: doc.id,
                      character_id: pendingDelete.id,
                    },
                  ]);
                  setPendingDelete(null);
                }}
              >
                Remove the actor
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sheetOpen ? (
        <SaveSheet
          npcLabel={doc.title || sceneId}
          groups={editor.groups}
          report={report}
          stored={
            stored
              ? {
                  npc: String(stored.scene),
                  source: "events",
                  trees: stored.lines,
                  errors: stored.errors,
                  warnings: stored.warnings,
                }
              : null
          }
          saving={saving}
          error={saveError}
          onCancel={() => setSheetOpen(false)}
          onSave={doSave}
        />
      ) : null}
    </div>
  );
}
