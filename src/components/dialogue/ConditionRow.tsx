// One namespace-driven condition row, one effect row, and the mono escape
// hatch (README §3: "structured rows, with a token escape hatch").
//
// The row's CONTROLS come from `namespaceShape()`, which derives them from the
// pack's own operand descriptor — so `time` gets a window select, `player` gets
// field/op/value and `has_item` gets an entity picker, with no switch on
// namespace anywhere in this file. A template that adds a namespace gets a
// working row.
//
// No component builds a token by concatenation: every row assembles through
// `formatToken`, and the raw token renders under the row in 9px mono. You
// author by recognising *resonance shard*; you verify by reading the token.

import { useState } from "react";
import { EntityPicker } from "./EntityPicker";
import {
  effectShape,
  formatToken,
  typeIdForEntity,
  isParseError,
  namespaceShape,
  parseEffect,
  parseToken,
  type DialogueVocab,
  type FieldSpec,
  type Token,
} from "./grammar";
import type { PackInfo } from "../../lib/invoke";

function slotsFor(token: Token): string[] {
  return token.split(":").slice(1);
}

export function ConditionRow({
  token,
  scope,
  vocab,
  packInfo,
  engineEvaluable,
  engineReason,
  onChange,
  onRemove,
}: {
  token: Token;
  scope: string;
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  engineEvaluable: boolean;
  engineReason: string | null;
  onChange: (next: Token) => void;
  onRemove: () => void;
}) {
  const [pickerFor, setPickerFor] = useState<FieldSpec | null>(null);
  const namespace = token.split(":")[0];
  const shape = namespaceShape(namespace, vocab);
  const values = slotsFor(token);
  const parsed = parseToken(token, scope, vocab);
  const bad = isParseError(parsed) ? parsed.error : null;

  const setSlot = (index: number, value: string) => {
    const next = [...values];
    while (next.length <= index) next.push("");
    next[index] = value;
    onChange(formatToken(namespace, ...next));
  };

  return (
    <div className={`dlg-row ${bad ? "bad" : ""}`} data-engine={engineEvaluable ? "ok" : "lag"}>
      <select
        className="dlg-row-ns dlg-mono"
        value={namespace}
        aria-label="condition namespace"
        onChange={(e) => onChange(formatToken(e.target.value))}
      >
        {vocab.condition_namespaces.map((ns) => (
          <option key={ns} value={ns}>
            {ns}
          </option>
        ))}
        {scope === "scene"
          ? vocab.scene_only_namespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))
          : null}
      </select>
      {shape.map((slot, i) =>
        slot.choices ? (
          <select
            key={slot.name}
            className="dlg-row-slot"
            aria-label={slot.name}
            value={values[i] ?? ""}
            onChange={(e) => setSlot(i, e.target.value)}
          >
            <option value="">— {slot.name} —</option>
            {slot.choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : slot.entity ? (
          <button
            key={slot.name}
            className="dlg-row-pick"
            onClick={() => setPickerFor(slot)}
            title={`Pick a ${slot.entity} from the world`}
          >
            {values[i] || `pick a ${slot.entity}…`}
          </button>
        ) : (
          <input
            key={slot.name}
            className="dlg-row-slot"
            aria-label={slot.name}
            value={values[i] ?? ""}
            placeholder={slot.name}
            onChange={(e) => setSlot(i, e.target.value)}
          />
        ),
      )}
      <button className="dlg-row-x" onClick={onRemove} aria-label="Remove this condition">
        ×
      </button>
      <div className="dlg-row-token dlg-mono">{token}</div>
      {bad ? <div className="dlg-row-error">{bad}</div> : null}
      {!engineEvaluable && engineReason ? (
        <div className="dlg-row-lag">⚠ {engineReason}</div>
      ) : null}
      {pickerFor ? (
        <EntityPicker
          title={`${namespace} · ${pickerFor.name}`}
          namespace={namespace}
          slot={{
            types: [typeIdForEntity(pickerFor.entity!, packInfo)],
            states: shape[1]?.choices,
            onPick: (id, state) => {
              const next = [...values];
              next[0] = id;
              if (state !== undefined && shape[1]) next[1] = state;
              onChange(formatToken(namespace, ...next));
              setPickerFor(null);
            },
          }}
          onClose={() => setPickerFor(null)}
        />
      ) : null}
    </div>
  );
}

export function EffectRow({
  token,
  vocab,
  packInfo,
  engineEvaluable,
  engineReason,
  onChange,
  onRemove,
}: {
  token: Token;
  vocab: DialogueVocab;
  packInfo: PackInfo | null;
  engineEvaluable: boolean;
  engineReason: string | null;
  onChange: (next: Token) => void;
  onRemove: () => void;
}) {
  const [pickerFor, setPickerFor] = useState<FieldSpec | null>(null);
  const namespace = token.split(":")[0];
  const shape = effectShape(namespace, vocab);
  const values = slotsFor(token);
  const parsed = parseEffect(token, vocab);
  const bad = isParseError(parsed) ? parsed.error : null;

  const setSlot = (index: number, value: string) => {
    const next = [...values];
    while (next.length <= index) next.push("");
    next[index] = value;
    onChange(formatToken(namespace, ...next));
  };

  return (
    <div
      className={`dlg-row effect ${bad ? "bad" : ""}`}
      data-engine={engineEvaluable ? "ok" : "lag"}
    >
      <select
        className="dlg-row-ns dlg-mono"
        value={namespace}
        aria-label="effect"
        onChange={(e) => onChange(formatToken(e.target.value))}
      >
        {vocab.effects.map((fx) => (
          <option key={fx} value={fx}>
            {fx}
          </option>
        ))}
      </select>
      {shape.map((slot, i) =>
        slot.choices ? (
          <select
            key={slot.name}
            className="dlg-row-slot"
            aria-label={slot.name}
            value={values[i] ?? ""}
            onChange={(e) => setSlot(i, e.target.value)}
          >
            <option value="">— {slot.name} —</option>
            {slot.choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : slot.entity ? (
          <button key={slot.name} className="dlg-row-pick" onClick={() => setPickerFor(slot)}>
            {values[i] || `pick a ${slot.entity}…`}
          </button>
        ) : (
          <input
            key={slot.name}
            className="dlg-row-slot"
            aria-label={slot.name}
            value={values[i] ?? ""}
            placeholder={slot.name}
            onChange={(e) => setSlot(i, e.target.value)}
          />
        ),
      )}
      <button className="dlg-row-x" onClick={onRemove} aria-label="Remove this effect">
        ×
      </button>
      <div className="dlg-row-token dlg-mono">{token}</div>
      {bad ? <div className="dlg-row-error">{bad}</div> : null}
      {!engineEvaluable && engineReason ? (
        <div className="dlg-row-lag">⚠ {engineReason}</div>
      ) : null}
      {pickerFor ? (
        <EntityPicker
          title={`${namespace} · ${pickerFor.name}`}
          namespace={namespace}
          slot={{
            types: [typeIdForEntity(pickerFor.entity!, packInfo)],
            onPick: (id) => {
              const next = [...values];
              next[0] = id;
              onChange(formatToken(namespace, ...next));
              setPickerFor(null);
            },
          }}
          onClose={() => setPickerFor(null)}
        />
      ) : null}
    </div>
  );
}

/** The escape hatch: the row stack swaps for a mono textarea, one token per
 *  line, with per-line parse validation. Both directions are lossless. */
export function TokenPaste({
  tokens,
  scope,
  vocab,
  kind,
  onCommit,
  onCancel,
}: {
  tokens: Token[];
  scope: string;
  vocab: DialogueVocab;
  kind: "condition" | "effect";
  onCommit: (tokens: Token[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(tokens.join("\n"));
  const lines = text.split("\n").map((l) => l.trim());
  const problems = lines
    .map((line, i) => {
      if (!line) return null;
      const parsed = kind === "effect" ? parseEffect(line, vocab) : parseToken(line, scope, vocab);
      return isParseError(parsed) ? `line ${i + 1}: ${parsed.error}` : null;
    })
    .filter((p): p is string => p !== null);

  return (
    <div className="dlg-paste">
      <textarea
        className="dlg-paste-area dlg-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={`paste ${kind} tokens`}
      />
      {problems.map((p, i) => (
        <div key={i} className="dlg-row-error">
          {p}
        </div>
      ))}
      <div className="dlg-paste-actions">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn pri"
          disabled={problems.length > 0}
          title={problems[0] ?? "Replace the rows with these tokens"}
          onClick={() => onCommit(lines.filter(Boolean))}
        >
          Use these tokens
        </button>
      </div>
    </div>
  );
}
