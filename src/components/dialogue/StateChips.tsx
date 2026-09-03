// The simulated state: compact chips in the collapsed dock, a full panel in the
// expanded one (README Q5).
//
// The panel's sections ARE the selector axes plus inventory — Checkpoint ·
// Inventory · Quests · Segment · Clock & place · Player · Flags · Scenes seen —
// so the thing you edit to change which tree plays is laid out the way the
// selector model thinks.
//
// Every change re-evaluates every gate live, because the surface re-asks
// `canon dialogue test`. Nothing here decides a verdict.
//
// Checkpoints are session-local and the panel SAYS SO in place: they are never
// written to the pack (doctrine 1, and the design's own promise).

import { useState } from "react";
import type { Checkpoint, SimState } from "./useDialogueTest";

/** The compact strip: `inv 3 · quest offered · 23:10 · hp 14`, editable in
 *  place. Deliberately lossy — it is a summary, and the expanded panel is the
 *  full editor. */
export function StateChips({
  state,
  onChange,
}: {
  state: SimState;
  onChange: (next: SimState) => void;
}) {
  const items = Object.values(state.inventory).reduce((n, v) => n + Number(v || 0), 0);
  const quest = Object.entries(state.quests)[0];
  const clock = state.clock.window ?? state.clock.time ?? "";
  return (
    <div className="dlg-statechips" data-testid="dialogue-state-chips">
      <span className="chip chip-muted" title="Items in the simulated inventory">
        inv {items}
      </span>
      <label className="chip" title="The first simulated quest and its state">
        <span className="dlg-mono">{quest ? quest[0] : "quest"}</span>
        <input
          className="dlg-chip-input"
          value={quest ? quest[1] : ""}
          placeholder="not_started"
          aria-label="quest state"
          onChange={(e) => {
            const key = quest ? quest[0] : "quest";
            onChange({ ...state, quests: { ...state.quests, [key]: e.target.value } });
          }}
        />
      </label>
      <label className="chip" title="Clock window — the `time:` axis">
        <input
          className="dlg-chip-input"
          value={clock}
          placeholder="night"
          aria-label="clock window"
          onChange={(e) =>
            onChange({ ...state, clock: { ...state.clock, window: e.target.value } })
          }
        />
      </label>
      <label className="chip" title="Player health — the `player:health:…` axis">
        hp
        <input
          className="dlg-chip-input"
          value={String(state.player.health ?? "")}
          aria-label="player health"
          onChange={(e) =>
            onChange({ ...state, player: { ...state.player, health: e.target.value } })
          }
        />
      </label>
      <span className="dlg-dim dlg-state-note">simulated · never written to the pack</span>
    </div>
  );
}

/** The expanded dock's right column — the same 300px slot the inspector uses in
 *  Edit mode, so the eye doesn't move between modes. */
export function StatePanel({
  state,
  onChange,
  checkpoints,
  onSnapshot,
  onRestore,
  /** Keys the last walk changed, flashed `new` / `set`. */
  touched = [],
}: {
  state: SimState;
  onChange: (next: SimState) => void;
  checkpoints: Checkpoint[];
  onSnapshot: (name: string) => void;
  onRestore: (name: string) => void;
  touched?: string[];
}) {
  const [name, setName] = useState("");
  const flash = (key: string) => (touched.includes(key) ? "set" : undefined);

  const setMap = (section: keyof SimState, key: string, value: string) => {
    const map = { ...(state[section] as Record<string, unknown>) };
    if (value === "") delete map[key];
    else
      map[key] =
        section === "inventory" ? Number(value) : section === "flags" ? value === "true" : value;
    onChange({ ...state, [section]: map });
  };

  return (
    <div className="dlg-statepanel" data-testid="dialogue-state-panel">
      <section className="dlg-state-sect">
        <header>Checkpoint</header>
        <div className="dlg-state-checkpoint">
          <input
            value={name}
            placeholder="fresh save"
            aria-label="checkpoint name"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn"
            disabled={!name.trim()}
            title={name.trim() ? "Name this state" : "name it first"}
            onClick={() => {
              onSnapshot(name.trim());
              setName("");
            }}
          >
            Snapshot
          </button>
        </div>
        {checkpoints.map((c) => (
          <div key={c.name} className="dlg-state-row">
            <span>{c.name}</span>
            <button className="btn" onClick={() => onRestore(c.name)}>
              Reset to it
            </button>
          </div>
        ))}
        <p className="dlg-state-note dlg-dim">
          Checkpoints are session-local. They are never written to the pack.
        </p>
      </section>

      <MapSection
        title="Inventory"
        entries={Object.entries(state.inventory).map(([k, v]) => [k, String(v)])}
        placeholder="item id"
        valuePlaceholder="count"
        onSet={(k, v) => setMap("inventory", k, v)}
        flash={flash}
      />
      <MapSection
        title="Quests"
        entries={Object.entries(state.quests)}
        placeholder="quest id"
        valuePlaceholder="state"
        onSet={(k, v) => setMap("quests", k, v)}
        flash={flash}
      />

      <section className="dlg-state-sect">
        <header>Segment</header>
        <input
          value={state.segment ?? ""}
          placeholder="act_3"
          aria-label="segment"
          onChange={(e) => onChange({ ...state, segment: e.target.value || null })}
        />
      </section>

      <section className="dlg-state-sect">
        <header>Clock &amp; place</header>
        <input
          value={state.clock.window ?? ""}
          placeholder="night"
          aria-label="clock window"
          onChange={(e) =>
            onChange({ ...state, clock: { ...state.clock, window: e.target.value } })
          }
        />
        <input
          value={state.room ?? ""}
          placeholder="room id"
          aria-label="room"
          onChange={(e) => onChange({ ...state, room: e.target.value || null })}
        />
      </section>

      <MapSection
        title="Player"
        entries={Object.entries(state.player).map(([k, v]) => [k, String(v)])}
        placeholder="field"
        valuePlaceholder="value"
        onSet={(k, v) => setMap("player", k, v)}
        flash={flash}
      />
      <MapSection
        title="Flags"
        entries={Object.entries(state.flags).map(([k, v]) => [k, String(v)])}
        placeholder="flag key"
        valuePlaceholder="true"
        onSet={(k, v) => setMap("flags", k, v)}
        flash={flash}
      />

      <section className="dlg-state-sect">
        <header>Scenes seen</header>
        <input
          value={state.scenes_seen.join(", ")}
          placeholder="evt_3120"
          aria-label="scenes seen"
          onChange={(e) =>
            onChange({
              ...state,
              scenes_seen: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </section>
    </div>
  );
}

function MapSection({
  title,
  entries,
  placeholder,
  valuePlaceholder,
  onSet,
  flash,
}: {
  title: string;
  entries: [string, string][];
  placeholder: string;
  valuePlaceholder: string;
  onSet: (key: string, value: string) => void;
  flash: (key: string) => string | undefined;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  return (
    <section className="dlg-state-sect">
      <header>{title}</header>
      {entries.map(([k, v]) => (
        <div key={k} className="dlg-state-row" data-flash={flash(k)}>
          <span className="dlg-mono">{k}</span>
          <input
            value={v}
            aria-label={`${title} ${k}`}
            onChange={(e) => onSet(k, e.target.value)}
          />
          <button className="dlg-row-x" aria-label={`Remove ${k}`} onClick={() => onSet(k, "")}>
            ×
          </button>
        </div>
      ))}
      <div className="dlg-state-add">
        <input
          value={key}
          placeholder={placeholder}
          aria-label={`${title} key`}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          value={value}
          placeholder={valuePlaceholder}
          aria-label={`${title} value`}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn"
          disabled={!key.trim()}
          onClick={() => {
            onSet(key.trim(), value);
            setKey("");
            setValue("");
          }}
        >
          ＋
        </button>
      </div>
    </section>
  );
}
