// The engine-lag layer's THREE warning treatments (README screen 03, "Engine
// lag"; PLAN step 10). The computation they all render is `model.treeLag` —
// one answer, so a banner and a dot can never disagree.
//
// DATA MAY OUTRUN THE ENGINE. Authoring is never blocked by what the runtime
// can evaluate: a namespace the pack declares is legal to author, is validated,
// is journaled, and is evaluated by the tester. The editor's job is to say —
// loudly, in three places at once — that the GAME will not honour it yet, and
// never to refuse a legal token.
//
//   1. the TREE BANNER (`EngineLagBanner`) — which namespaces, what the engine
//      does instead, and that nothing here blocks saving;
//   2. the dashed CHOICE ROW plus the amber ribbon dot (`EditableNode` /
//      `GateRibbon`, which read the same predicate);
//   3. the TRAY warning naming the namespace and what the engine does instead
//      (`ConditionRow`'s per-row line plus `EngineLagTrayNote`) and the
//      SAVE-SHEET warning block (`SaveSheet`).
//
// EXTENDS `grammar.ts`'s engine block reader rather than adding a second source
// of truth: `pack info` carries the primary engine's `evaluable_namespaces`
// (P.2.4); a MISSING block means "the manifest does not carry it yet" and the
// whole layer is skipped rather than warning falsely, while an EXPLICIT EMPTY
// block means the engine evaluates nothing — which is exactly today's dungeon
// engine at tree scope. Every gate amber on the reference world is CORRECT, and
// this file's job is to make that read as deliberate rather than broken.
//
// "Mute for this tree" is per tree and per session. It silences the BANNER
// only: the dots, the row lines and the save-sheet block stay, because muting
// the warning must never mute the fact.

import { useState } from "react";
import {
  engineCapabilityRows,
  engineLabel,
  engineVerdict,
  namespaceOf,
  type DialogueVocab,
  type Token,
} from "./grammar";
import type { LagGate, TreeLag } from "./model";
import type { PackInfo } from "../../lib/invoke";

/** TREATMENT 1 — the tree banner. Names the namespaces, names what the engine
 *  does instead, and says in so many words that nothing here blocks saving. */
export function EngineLagBanner({
  lag,
  vocab,
  packInfo,
  scope = "tree",
  muted,
  onMute,
  onShowChoices,
}: {
  lag: TreeLag;
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  scope?: string;
  /** Muted per tree, per session — the banner only. */
  muted: boolean;
  onMute: () => void;
  /** "Show the N choices" — selects the first lagging gate on the canvas. */
  onShowChoices?: (gate: LagGate) => void;
}) {
  const [capsOpen, setCapsOpen] = useState(false);
  const total = lag.gates.length + lag.selectorRows.length;
  if (total === 0) return null;
  const engine = engineLabel(packInfo);
  const named = lag.namespaces.map((ns) => `${ns}:`).join(" and ");
  if (muted) {
    return (
      <div className="dlg-lag-banner muted" data-testid="dialogue-lag-banner" data-muted="1">
        <span className="dlg-lag-glyph">⚠</span>
        <span>
          {total} engine-lag warning{total === 1 ? "" : "s"} muted for this tree. The dots and the
          save sheet still show them — muting the banner never mutes the fact.
        </span>
        <button className="btn" onClick={onMute}>
          Unmute
        </button>
      </div>
    );
  }
  return (
    <div className="dlg-lag-banner" data-testid="dialogue-lag-banner">
      <span className="dlg-lag-glyph">⚠</span>
      <div className="dlg-lag-body">
        <p>
          This tree uses {total} gate{total === 1 ? "" : "s"} the pack&apos;s engine can&apos;t
          evaluate yet. <span className="dlg-mono">{named}</span>{" "}
          {lag.namespaces.length === 1 ? "is" : "are"} registered in the pack, so authoring{" "}
          {lag.namespaces.length === 1 ? "it" : "them"} is legal and{" "}
          {lag.namespaces.length === 1 ? "it" : "they"} will be validated and journaled. The tester
          evaluates {lag.namespaces.length === 1 ? "it" : "them"};{" "}
          <strong>
            {engine} ignores {lag.namespaces.length === 1 ? "it" : "them"} and shows the choice
            unconditionally
          </strong>
          . Nothing here blocks saving.
        </p>
        <div className="dlg-lag-actions">
          {lag.choices.length > 0 && onShowChoices ? (
            <button className="btn" onClick={() => onShowChoices(lag.gates[0])}>
              Show the {lag.choices.length} choice{lag.choices.length === 1 ? "" : "s"}
            </button>
          ) : null}
          <button className="btn" onClick={() => setCapsOpen((v) => !v)}>
            Engine capabilities…
          </button>
          <button className="btn" onClick={onMute}>
            Mute for this tree
          </button>
        </div>
        {capsOpen ? <EngineCapabilities vocab={vocab} packInfo={packInfo} scope={scope} /> : null}
      </div>
    </div>
  );
}

/** The capabilities list — every namespace the PACK declares, and whether this
 *  engine evaluates it. Read from the pack registry, never hard-coded. */
export function EngineCapabilities({
  vocab,
  packInfo,
  scope = "tree",
}: {
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  scope?: string;
}) {
  const rows = engineCapabilityRows(vocab, packInfo, scope);
  return (
    <div className="dlg-lag-caps" data-testid="dialogue-engine-capabilities">
      <header className="dlg-mono dlg-dim">engine capabilities · {scope} scope</header>
      {rows.map((row) => (
        <div key={row.namespace} className="dlg-lag-cap" data-evaluated={row.evaluated ? "1" : "0"}>
          <span className="dlg-mono">{row.namespace}</span>
          <span>{row.evaluated ? "evaluated" : "tester only"}</span>
        </div>
      ))}
      <p className="dlg-lag-caps-note">
        Read from the pack registry, not hard-coded. When the engine catches up, these rows go green
        and every warning in the tree clears on its own.
      </p>
    </div>
  );
}

/** The engine chip for the surface header — `engine: pygame · 3 of 9
 *  namespaces`. Present whenever the manifest carries the block at all. */
export function EngineChip({
  vocab,
  packInfo,
  scope = "tree",
}: {
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  scope?: string;
}) {
  const rows = engineCapabilityRows(vocab, packInfo, scope);
  const evaluated = rows.filter((r) => r.evaluated).length;
  return (
    <span
      className="chip chip-muted dlg-engine-chip"
      data-lag={evaluated < rows.length ? "1" : undefined}
      data-testid="dialogue-engine-chip"
      title={
        evaluated === rows.length
          ? "this engine evaluates every namespace the pack declares at this scope"
          : `${rows.length - evaluated} namespace(s) are authored and validated but not enforced in game`
      }
    >
      <span className="dlg-mono">engine</span> {engineLabel(packInfo)}
      <span className="dlg-dim"> · </span>
      <span className="dlg-mono">
        {evaluated} of {rows.length} namespaces
      </span>
    </span>
  );
}

/** TREATMENT 3 (the tray half) — one aggregate note under the condition rows,
 *  naming the engine, what it DOES evaluate, and what happens in game. The
 *  per-row line stays where it is; this is the "Why is this allowed?" answer. */
export function EngineLagTrayNote({
  tokens,
  vocab,
  packInfo,
  scope = "tree",
}: {
  tokens: Token[];
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  scope?: string;
}) {
  const [why, setWhy] = useState(false);
  // TOKEN-level, like every other treatment. Asking the NAMESPACE-level
  // question here made this the one treatment that went silent on an
  // operand-narrowed gate — the reference pack's own case — while the row, the
  // ribbon, the banner and the save sheet all painted it amber.
  const kind = scope === "effects" ? "effect" : "condition";
  const lagging = tokens.filter((token) => !engineVerdict(token, kind, packInfo, scope).ok);
  if (lagging.length === 0) return null;
  const rows = engineCapabilityRows(vocab, packInfo, scope);
  const evaluated = rows.filter((r) => r.evaluated).map((r) => r.namespace);
  return (
    <div className="dlg-lag-tray" data-testid="dialogue-lag-tray">
      <p>
        <strong>
          {lagging.length} not enforced —{" "}
          {[...new Set(lagging.map(namespaceOf))].map((ns) => `${ns}:`).join(", ")}
        </strong>
      </p>
      <p>
        The pack declares <span className="dlg-mono">{engineLabel(packInfo)}</span>, which evaluates{" "}
        {evaluated.length ? (
          <span className="dlg-mono">{evaluated.join(", ")}</span>
        ) : (
          <span className="dlg-mono">nothing at {scope} scope yet</span>
        )}
        . In game this always shows. <strong>The tester does evaluate it</strong>, so you can still
        author and verify the intended behaviour now.
      </p>
      <button className="btn" onClick={() => setWhy((v) => !v)}>
        {why ? "Hide" : "Why is this allowed?"}
      </button>
      {why ? (
        <div className="dlg-lag-why">
          <p>
            Data may outrun the engine. A namespace the pack registers is legal to author, and the
            editor never refuses one — it says what the runtime will do instead. When the engine
            catches up, every warning here clears on its own with no edit.
          </p>
          <EngineCapabilities vocab={vocab} packInfo={packInfo} scope={scope} />
        </div>
      ) : null}
    </div>
  );
}
