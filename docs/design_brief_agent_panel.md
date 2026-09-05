# Design brief — the Cradle Agent panel

**For a Claude Design session (Track-A pattern).** Deliver the house package:
an interaction-spec `README.md` (every state, every transition, real copy), a
`PLAN.md` implementation map (components, mount points, store slices), and
mock screens covering the states below **in both themes**. The approved
package is adopted into `canon-ai/docs/Phase_1_prd.md` (build row A0; the
September dialogue-design row #2 is the precedent) and A5 builds to it.

**Background to attach alongside this brief:**
- The PRD artifact: https://claude.ai/code/artifact/f3469c77-0c51-4973-bcbd-f599bd4582e0
- Screenshots of the current app in `docs/screenshots/agent_brief_*.png`
  (start page, level editor, entity overview) — the design must feel native
  to these, not bolted on.

## What this is

One general AI agent living in cradle. v1 = editor copilot: it converses,
reads everything, edits through canon verbs behind permission gates, fires
paid generation behind cost estimates, and drives project creation from the
start page. It mounts as a **docked third column on the right of the shell**,
present globally (open-world AND start page). Under the hood it is a
**foreman that routes work to specialists** (level designer, artist, writer,
playtester) — the user never picks an agent; the system routes by task, and
the transcript shows who is acting. **Multiple conversations can run at
once** (Cursor-style tabs), and any streaming run can be **stopped**. Every
action journals under an attribution identity (`agent:<name>/<specialist>`),
and its money and edits are first-class citizens of the existing History and
💰 Cost surfaces.

## Surfaces to design, with every state

1. **The column.** Expanded (user-resizable width, persisted), collapsed
   rail, TopBar toggle. Coexistence with the NotesDrawer (440px right-edge
   overlay) — decide stacking/interaction. Focus-mode behavior.
2. **Transcript.** User messages, agent streaming text (markdown), session
   boundaries, service-starting / service-failed (guided error, not raw
   stderr), provider-error and missing-key states (existing precedent: the
   `missing FAL_KEY — not found in <path>` pre-flight message; deep-link to
   the future Settings Keys pane).
3. **Tool-call cards, three tiers with distinct visual weight:**
   - **read** — quiet, collapsed by default ("read level 2-3").
   - **write** — the **diff chip**: spatial edits (level geometry/placements)
     need a before/after or mini-canvas treatment; row/schema edits need
     field-level old→new. What changes must be legible BEFORE approval.
   - **paid** — estimate chip first (cost range, backend + model named —
     "paid must read as paid before the confirm", Track-A doctrine), then
     live progress (phase + item + count + ticking elapsed; `CreateProgress`
     is the precedent), then result with actual cost. Include the **stopped
     state**: a run cancelled mid-flight shows what completed and what it
     cost so far.
4. **Permission chips** inline in the transcript: **Accept / Always allow in
   this project / Reject.** Grants are PROJECT-scoped — the copy must say so.
   Also design: the rejected state, and how a previously-granted action
   renders (auto-runs with a quiet note, not another ask).
5. **Plan-then-execute mode.** The plan as numbered steps with tier badges,
   one approval for the batch, per-step check-off as it runs, and the
   mid-plan-failure state (what ran, what didn't, what now).
6. **Header + sessions.** Mode switch (ask / plan / allow — current mode
   always visible; disabled-with-a-reason beats hidden), **conversation
   tabs** (multiple concurrent conversations, Cursor-style), **⏹ Stop** on
   any streaming/in-flight run, new session + history. There is **no agent
   picker** — routing is automatic. Design instead the **specialist run
   card**: a nested, collapsible card inside the transcript showing which
   specialist is acting (level designer / artist / writer / playtester), its
   task one-liner, live status, and a result summary; permission chips
   inside a run card name the specialist ("Level designer wants to import
   grids"). Also: two conversations running at once must be legible —
   what's active where, and which tab is asking for an approval.
7. **Start-page variant.** The panel with no open project, driving create —
   reconcile with the hero/recents-rail layout and the existing
   NewProjectModal + CreateProgress flow. (No always-allow exists here;
   ask/plan only.)
8. **"Show me" affordances.** The agent navigates the user to what it
   changed (selection deep-links exist) — how a transcript entry links to /
   highlights its target; the change-feed summary after a batch.
9. **Cost dashboard, agent lane.** Agent spend (conversation tokens + tool
   spend) per agent name, separate and aggregated, inside the existing 💰
   dashboard.
10. **Empty / first-run.** No session yet; what the panel offers before the
    first message (this is also the feature's introduction — make it earn
    the column).

## Hard constraints (unchanged Track-A block)

- Desktop app; dark-first with a working light theme toggle.
- Every chrome colour from `src/styles/tokens.css` custom properties;
  canvases resolve the same tokens via `lib/canvasTheme.ts`. **No new hex
  literals for chrome.** Game *content* colours stay literal.
- Pixel-art content is never smooth-scaled.
- Shell geometry is fixed: 36px TopBar / (208px LeftNav | detail) / 24px
  ValidationBar; scrollbars are hidden app-wide; `--shell-max` applies to
  start pages only — the editor shell does not use it.
- Feel native to the existing patterns: CommandPalette, JobTray,
  CreateProgress, PromptOverride (the editable-prompt expander), EngineChip.
  The `window.confirm` cost gates are what your chips REPLACE.
- Fixed-artboard handoffs do not translate 1:1 to the fluid app (learned on
  the start page): state responsive behavior explicitly — minimum panel
  width, what collapses first, and what the level-editor canvas gives up
  when the column is open.

## Out of scope for this package

The service/loop internals, provider choice, tool semantics (all decided in
the PRD); the Settings screen (September W3.5); the dialogue tester (its own
approved package).
