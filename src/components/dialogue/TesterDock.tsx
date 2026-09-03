// The tester dock — 186px along the bottom of the canvas, `⌃↑` to full height
// (README Q5). NOT a canvas replacement: the graph stays live above it and
// lights the walked path, and switching between fixing a gate and re-walking it
// is not a mode change.
//
// EXTENDS `level/Dock`'s geometry and its open/closed transition — the same
// bottom dock the level editor already trained users on. It is a separate
// component because the level dock's three panes are palettes; this one is a
// transcript and a choice list.
//
// Gate feedback is canon's, rendered (README Q6):
//   ✓ pass, and the sub-line names what passed;
//   ✗ fail, err-washed and NOT clickable, one mono line per condition so
//     passing conditions still read as passing and only the blocker is red,
//     plus the count and the two repairs;
//   ? unevaluable, dashed and STILL CLICKABLE, naming the namespace and the
//     split verdict — the tester evaluates it, the game will not.

import { useEffect, useState } from "react";
import { StateChips, StatePanel } from "./StateChips";
import type { DialogueTester } from "./useDialogueTest";
import type { DialogueChoiceResult, DialogueConditionResult } from "../../lib/invoke";

export function TesterDock({
  tester,
  treeLabel,
  unsaved,
  onRepairQuest,
  onJumpToNode,
  onExpanded,
  onToggleGraph,
}: {
  tester: DialogueTester;
  treeLabel: string;
  /** Testing the UNSAVED buffer — the statusbar and the dock both say so. */
  unsaved: boolean;
  onRepairQuest?: (token: string) => void;
  onJumpToNode?: (nodeId: string) => void;
  /** The surface owns the columns above, so it needs to know. */
  onExpanded?: (expanded: boolean) => void;
  /** `G` — show the graph again while the dock is expanded. */
  onToggleGraph?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { result, transcript, error } = tester;

  useEffect(() => {
    onExpanded?.(expanded);
  }, [expanded, onExpanded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setExpanded(true);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 1–9 pick a choice, ⌫ steps back, R restarts — Test mode's own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        void tester.choose(Number(e.key) - 1);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        tester.back();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        tester.restart();
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        onToggleGraph?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleGraph, tester]);

  const tally = result?.gates ?? {};
  const touched = result?.fired?.map((f) => f.token.split(":")[1] ?? "") ?? [];

  return (
    <div className={`dlg-dock ${expanded ? "expanded" : ""}`} data-testid="dialogue-dock">
      <header className="dlg-dock-head">
        <span className="dlg-mode-pill" data-mode="test">
          test
        </span>
        <span className="dlg-dock-title">
          walking <span className="dlg-mono">{treeLabel}</span> · exchange {transcript.length}
          {unsaved ? " · testing the unsaved buffer" : ""}
        </span>
        <span className="dlg-dock-gates dlg-mono">
          gates {tally.pass ?? 0} pass · {tally.fail ?? 0} fail · {tally.unevaluable ?? 0}{" "}
          unevaluable
        </span>
        <span className="dlg-modebar-spacer" />
        <button className="btn" onClick={tester.restart} title="Restart the walk (R)">
          Restart
        </button>
        <button className="btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Collapse" : "Expand"} <span className="kbd">{expanded ? "⌃↓" : "⌃↑"}</span>
        </button>
      </header>

      {!expanded ? <StateChips state={tester.state} onChange={tester.setState} /> : null}

      <div className="dlg-dock-body">
        <div className="dlg-dock-transcript">
          <header className="dlg-dock-colhead">transcript</header>
          {transcript.map((entry, i) => (
            <div key={`${entry.nodeId}#${i}`} className="dlg-transcript-entry">
              <span className="dlg-mono dlg-dim">{entry.nodeId}</span>
              <p className="dlg-transcript-prompt">{entry.prompt}</p>
              {entry.took ? <p className="dlg-transcript-took">you: {entry.took}</p> : null}
              {entry.fired?.length ? (
                <div className="dlg-ledger">
                  {entry.fired.length} effect{entry.fired.length === 1 ? "" : "s"} fired
                  {entry.fired.map((f) => (
                    <div
                      key={f.token}
                      className="dlg-ledger-row"
                      data-applied={f.applied ? "1" : "0"}
                    >
                      + <span className="dlg-mono">{f.token}</span> — {f.detail}
                      {!f.engine_evaluable ? (
                        <span className="dlg-ledger-lag"> · {f.engine_reason}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {transcript.length === 0 ? (
            <p className="dlg-dim">The walk starts at the tree's entry node.</p>
          ) : null}
        </div>

        <div className="dlg-dock-choices">
          <header className="dlg-dock-colhead">choices here · 1–9 to pick</header>
          {error ? <p className="dlg-dock-error">{error}</p> : null}
          {result?.node.terminal ? (
            <p className="dlg-dim">
              terminal node — the conversation ends here. <span className="kbd">R</span> restarts.
            </p>
          ) : null}
          {(result?.choices ?? []).map((choice) => (
            <ChoiceVerdict
              key={choice.index}
              choice={choice}
              onTake={() => void tester.choose(choice.index)}
              onRepairQuest={onRepairQuest}
              onJumpToNode={onJumpToNode}
            />
          ))}
          {tester.unreachableHere.length > 0 ? (
            <footer className="dlg-dock-unreachable">
              unreachable in this state:{" "}
              <span className="dlg-mono">{tester.unreachableHere.join(", ")}</span>
            </footer>
          ) : null}
        </div>

        {expanded ? (
          <div className="dlg-dock-state">
            <StatePanel
              state={tester.state}
              onChange={tester.setState}
              checkpoints={tester.checkpoints}
              onSnapshot={tester.snapshot}
              onRestore={tester.restore}
              touched={touched}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChoiceVerdict({
  choice,
  onTake,
  onRepairQuest,
  onJumpToNode,
}: {
  choice: DialogueChoiceResult;
  onTake: () => void;
  onRepairQuest?: (token: string) => void;
  onJumpToNode?: (nodeId: string) => void;
}) {
  const unevaluable = choice.conditions.some((c) => c.verdict === "unevaluable");
  const verdict = !choice.pass ? "fail" : unevaluable ? "unevaluable" : "pass";
  const glyph = verdict === "pass" ? "✓" : verdict === "fail" ? "✗" : "?";
  const failing = choice.conditions.filter((c) => !c.pass);
  return (
    <div className={`dlg-verdict ${verdict}`} data-verdict={verdict}>
      <button
        className="dlg-verdict-take"
        // A failing choice is not clickable; an UNEVALUABLE one still is —
        // the tester evaluates it and passing it is a legal walk.
        disabled={verdict === "fail"}
        title={verdict === "fail" ? (choice.failing_reason ?? "blocked") : "Take this choice"}
        onClick={onTake}
      >
        <span className="dlg-verdict-glyph">{glyph}</span>
        <span className="dlg-verdict-text">{choice.text}</span>
      </button>
      {choice.conditions.length === 0 ? (
        <p className="dlg-verdict-sub dlg-dim">no conditions · → {choice.next_node_id ?? "end"}</p>
      ) : (
        choice.conditions.map((c) => <ConditionLine key={c.token} c={c} />)
      )}
      {verdict === "fail" ? (
        <div className="dlg-verdict-repairs">
          <span className="dlg-dim">
            Blocked by {failing.length} of {choice.conditions.length} conditions
          </span>
          {failing[0]?.namespace === "quest" && onRepairQuest ? (
            <button className="btn" onClick={() => onRepairQuest(failing[0].token)}>
              Set the quest active
            </button>
          ) : null}
          {choice.next_node_id && onJumpToNode ? (
            <button className="btn" onClick={() => onJumpToNode(choice.next_node_id!)}>
              jump to this node
            </button>
          ) : null}
        </div>
      ) : null}
      {choice.dangling ? (
        <p className="dlg-verdict-sub warn">
          points at <span className="dlg-mono">{choice.next_node_id}</span>, which this tree does
          not have.
        </p>
      ) : null}
    </div>
  );
}

function ConditionLine({ c }: { c: DialogueConditionResult }) {
  const glyph = c.verdict === "unevaluable" ? "?" : c.pass ? "✓" : "✗";
  return (
    <p className={`dlg-verdict-sub dlg-mono ${c.verdict}`} data-verdict={c.verdict}>
      {c.token} {glyph} {c.reason}
      {c.verdict === "unevaluable" && c.engine_reason ? (
        <span className="dlg-verdict-split"> · {c.engine_reason}</span>
      ) : null}
    </p>
  );
}
