// Why an edit affordance is still off in the ROOM view — shown as the
// control's title / tooltip / ⌘K reason, never by hiding it (doctrine 4).
// One table so the copy is authored once and reads the same on the rail, the
// header, the palette and the dock.
//
// Row P0-5 shipped the room read-only and every control carried a reason.
// Row P0-8 turned the writes on — paint / fill / erase, drag, place, the
// per-step 🎲 rolls and Save are LIVE now — so this table shrank to the four
// things a room genuinely cannot do yet, plus the two the platformer's
// gravity chrome owns:
//
//   mode / bounds   — a room has no tilesheet and no gravity (never will)
//   resize          — 40×30 is an engine constant until the runtime pull-in
//   validate / play / improve / music — the dungeon runtime (W2.0) and the
//                      platformer-only verbs behind them
//
// The copy is product language (doctrine 9): what the control cannot do
// HERE, never the build plan.

import type { RailDisabled } from "./ToolRail";

export const ROOM_REASONS = {
  mode: "art/overlay need a tilesheet — none for rooms",
  bounds: "no gravity here — bounds are platformer chrome",
  music: "no music lane for rooms — tracks bind per environment, not per cell",
  resize: "40×30 is an engine constant — rooms cannot be resized",
  validate: "no room validator yet — the room's own warnings are in the tray",
  play: "playing a dungeon from cradle is not available yet",
  improve: "improve is a platformer level verb — no room equivalent yet",
  publish: "rooms are published by the world, not one at a time",
} as const;

/** The rail's share of the table: paint / fill / erase are LIVE on a room,
 *  so only the two platformer-chrome tools stay off. */
export const RAIL_ROOM: RailDisabled = {
  bounds: ROOM_REASONS.bounds,
  music: ROOM_REASONS.music,
};

/** The $0 copy every room roll button carries — code only, never a spend
 *  card (master §1 doctrine 3: "free never spend-confirms"). */
export const ROLL_COST_NOTE = "$0 — code only";
