# Agent panel — interaction spec

Six mock screens in `design_handoff_agent/`. Every screen has a theme toggle in
its top bar; dark is the default and the design was drawn dark-first. Panel
mocks are drawn at the default width, **412px**.

| Screen | Covers |
| --- | --- |
| 01 Panel in the editor | The docked column in context. Click the panel icon in the top bar to cycle **expanded → resizing → collapsed rail**. |
| 02 Tool-call cards | The three tiers in every state, plus the four permission-chip states. |
| 03 Plan mode | Proposed, running, halted mid-plan, and the finished change feed. |
| 04 Sessions, errors and stop | Tabs, history, first run, mode + model picker, four failure states, stop in its three places. |
| 05 Start page | The panel with no project open, driving create. |
| 06 Cost and attribution | Every generation by kind and by launcher, and the three places a change says who made it. |
| 07 Conversation and coexistence | A plain multi-turn conversation with no tool calls, the @-context picker, the NotesDrawer stacking, the narrow-window auto-collapse, and the Permissions pane. |

---

## 1. The column

**Geometry.** Third column of the shell, right of main. Default 412px, min
340px, max 720px, persisted per user (not per project). Drag the 4px handle on
its left edge; while dragging, the handle goes accent and a mono width readout
follows the cursor. Double-click the handle resets to 412px.

**Collapsed** is a 40px rail, not a hidden panel: expand button on top, then one
initial-glyph button per open conversation carrying the same status dot as its
tab, then the session cost rotated at the bottom. Clicking a glyph expands the
panel to that conversation. Toggle from the top bar icon or `⌘⇧A`.

**What the editor gives up.** Left nav (208px) and the status bar never change.
The canvas absorbs the whole width loss. Below 900px of remaining main width the
editor's floating panels (minimap, audio lane) reflow inside the canvas rather
than clipping; below 720px the panel auto-collapses to the rail and shows a
one-time toast: *"Agent collapsed to make room. ⌘⇧A brings it back."* The toast
shows once per window session. Re-expanding at a narrow width is allowed and
remembered — the rule fires on resize only, and never fights an explicit choice.

**NotesDrawer.** The 440px notes overlay stays an overlay and floats *above* the
agent column; it does not push or resize it. Opening notes while the panel is
expanded dims the panel to 60% and blocks its input until notes closes. Two
right-edge surfaces are never both interactive. `Esc` closes notes first, then
stops the agent.

**Focus mode** hides the panel entirely; the rail comes back on exit.

**Revoking grants.** Settings → Permissions lists the standing grants for the
open project — tool name, granting specialist, when — each with `Revoke`, plus
`Revoke all`. Paid work never appears. Revoking does not undo anything already
done. Stored at `.cradle/permissions.toml`.

## 2. Conversation tabs

Tabs are Cursor-style, scrollable, overflow folds to a `+N` button that opens a
menu. Status is carried by a dot at the left of the label:

- **accent, pulsing** — a run is streaming.
- **amber, static** — waiting on a permission chip or a plan approval.
- **no dot** — idle.
- **red** — errored and unread.

Waiting tabs sort ahead of idle ones; running tabs never re-sort while running.
The active tab has a raised background and a 2px accent underline. Middle-click
closes; closing a tab with a live run asks first. `+` starts a new conversation
(`⌘⇧N` in the panel), `⏱` opens per-project history — a list of past sessions
with their date and cost, "Show all N" at the bottom.

Two conversations running at once is normal. The rail, the tab dots and the
status bar all report it; the status bar shows the *active* conversation's
specialist and a `+1` when another is running.

**First run** replaces the transcript with three seeded prompts drawn from the
current project ("Why does 2-3 feel empty?"). One sentence explains the rule
that earns the column: *it reads everything, and asks before it changes or
spends anything.*

## 3. Transcript

User messages are right-aligned in a bordered bubble with one square corner.
Agent text is flush left, unbubbled, prefixed by a mono `WICK` label — the
transcript reads as a log, not a chat app. Markdown renders; code blocks are
mono on `--bg-sunken`. A streaming reply ends in a blinking accent block caret.
Session boundaries are a hairline rule with a timestamp.

**It is a conversation before it is a tool runner.** Most turns touch nothing:
Wick answers questions about the project, quotes the world bible back at you,
and disagrees when the project's own notes disagree. A reply that needed a read
carries it as one dim mono line above the prose, so text keeps the floor. After
a reply that ends in a judgement, up to three follow-up chips offer the obvious
next turns (*Show me the spacing in both* · *Fix the back half* · *Leave it*) —
suggestions, never a menu the user must answer.

Hovering a user message reveals ✎ edit-and-resend, ↻ retry-from-here and ⧉ copy.
Editing a message truncates the transcript below it, as in any branching chat.

**Composer context.** `@` opens a typed picker — levels, actors, docs, and *what's
on screen now*. Attached context renders as an accent token inline in the draft
and as a chip under the composer once sent. The current level is attached by
default in the editor; nothing is attached on the start page.

**Errors.** Four shapes, each naming what broke, where the app looked, and the
one action that fixes it. Raw stderr is always behind a `▸ show stderr` line.

| State | Copy |
| --- | --- |
| Service starting | *Starting the agent service…* with elapsed. Non-blocking; the composer stays enabled and queues. |
| Service failed | *The agent service didn't start* · names the command and the port · Retry / Open logs. |
| Missing key | *No key for Anthropic* · `missing ANTHROPIC_API_KEY` · names both lookup paths · Add key in Settings / Use gpt-5.1 instead. |
| Provider error mid-stream | Partial text is kept above a dashed rule. *Reply cut off. Anthropic returned 529 — overloaded.* · *Nothing was written.* · Retry / Retry on haiku-4.5. |

## 4. Specialist run cards

A delegated task is a nested card inside the transcript: header row with a
caret, the mono specialist name, a one-line task, live status (`running 0:38`),
and a per-card `⏹`. Collapsed it is one line and keeps the status and cost.
Tool calls, permission chips and results live inside the card, indented under
it. The user never chooses a specialist; the card is how routing becomes
visible. A finished card collapses to `✓ Artist · re-tinted east columns · $0.31`.

## 5. Tool-call cards — three weights

**read.** No card. One mono line, collapsed, `▸` to expand the payload the agent
saw. Never asks. More than six reads in a run fold into `read 9 artifacts ▸`.
A failed read is the same line in red with the reason.

**write.** Bordered card, filled accent `WRITE` badge, and a diff that is always
visible before the chips. Three diff shapes by payload:

- *Spatial* (level geometry, placements) — side-by-side mini-canvases, before
  and after, added things in green, with a mono line naming counts and extents.
  Pixel content is nearest-neighbour at integer scale, never smoothed.
- *Row / schema* — a four-column grid of field, old (struck, red), `→`, new
  (green), plus `N fields · M unchanged hidden`.
- *Code* — a real unified diff with `@@` hunk headers, tinted add/remove lines,
  and `open full diff`.

Every write card has a **Show me** link (§8).

**paid.** Outlined in accent with a 2px accent cap, so it is the only card that
reads as expensive at a glance. Four states:

1. **Estimate.** Dollar range at 13px in accent, backend *and* model named, the
   unit of work, and today's spend for context. Buttons: `Accept · spend up to
   $0.64` / `Reject`. The price is in the button label. Footnote: *Paid work is
   never covered by "always allow". Every spend asks.*
2. **Running.** Indeterminate cap bar, phase + item + `3 / 4`, ticking elapsed,
   progress bar, and *spent so far $0.36 of $0.64*. `⏹ Stop` in the header.
3. **Result.** Green-edged, actual cost in accent, output thumbnails, duration
   and backend, `Show me in Library`.
4. **Stopped.** *Stopped by you at 0:52* with the billed amount. Lists what was
   kept and what never started, states *Nothing was rolled back*, and offers
   `Finish the last one · ~$0.16` / `Undo all 3`.

## 6. Permission chips

Chips sit inline where the action would have happened, inside the run card that
wants it. Copy is always *"‹Specialist› wants to ‹verb› ‹target›."*

`Accept` · `Always allow in this project` · `Reject`

The middle button is never shortened to "Always allow": grants are per project
and the label carries the scope. Footnote names the exact tool and project:
*"Always allow" covers `import_grid` for The Wandering Wick only. Revoke in
Settings → Permissions.*

- **Already granted** — no chip. A quiet mono line: `✓ Level designer imported 1
  grid into 2-4 · allowed in this project`, on a left rule.
- **Rejected** — the chip collapses to a neutral card stating what did *not*
  happen and what the agent did instead, with `Allow after all` / `Tell it why`.
- **Ask mode** — the middle button renders disabled with a dashed border and the
  reason underneath. Disabled-with-a-reason, never hidden.
- **Paid** — never shows the middle button at all.

## 7. Plan mode

The reply is a numbered plan; every step carries a tier badge *and* a
specialist, paid steps also carry their range. One button approves the batch and
puts the total on itself: `Run plan · up to $0.64`, beside `Edit steps` and
`Discard`. Footnote: approving the plan approves the read and write steps; paid
steps still ask when reached.

**Running** — steps check off in place with their duration. The current step
expands into its run card; finished steps collapse to one line with a `show me`
link. Header shows `3 of 5 · 1:24` and a batch `⏹ Stop`.

**Halted** — red border, `plan · halted at step 4`. The ledger is explicit: the
three ✓ steps with their times, the failed step with the provider's real reason
and what it billed, and the untouched step marked `not started`. Four ways out:
`Continue from step 4` · `Skip to step 5` · `Undo steps 1–3` · `Stop here`.
Footnote: undo reverts the writes as one History entry and cannot refund spend.

**Complete** — the plan collapses into the change feed (§8).

## 8. "Agent changed this"

Three sightings of one fact, all carrying `agent:wick/<specialist>`:

- **Transcript** — `Show me ↗` on every write card, and a change feed after a
  batch: one row per artifact, typed prefix, what changed, deep-link. Clicking
  opens the artifact, selects the affected thing, and pulses the selection once.
  The feed's footer offers `▶ Play 2-3`, `Undo the batch`, `Open in History`.
- **Editor** — a dismissible accent pill over the canvas (*Level designer
  changed this level · 6 placements · Review*), and an accent dot next to any
  artifact the agent touched this session in the left nav.
- **History** — normal rows, attributed to `wick/level-designer` instead of
  `you`, paid rows carrying their cost. A plan batch is one undoable entry that
  expands to its rows.

## 9. Header

`Ask · Plan · Allow` as a three-up segmented control, current mode filled
accent, always visible. Model picker beside it, mono, showing the current model.
The open menu groups by provider, lists in/out price per 1M for every entry, and
keeps unavailable entries in place at 50% opacity with the reason under them
(*⚠ No MOONSHOT_API_KEY in ~/.cradle/keys.toml* · `Add key`). Model is per
conversation. Right side: running session cost, and `⏹ Stop` while anything is
in flight. **No agent picker.**

## 10. Stop

One verb, three places, same contract: start nothing new, keep what landed, say
what it cost.

- **Conversation** — header `⏹ Stop`, `esc` from the composer. Stops the reply
  and every run beneath it.
- **Run card** — `⏹` in the card header. Stops that run only; the rest of the
  conversation continues. Result states what completed and offers a resume.
- **Job tray** — editor-launched jobs (Regenerate layout, Improve) and
  agent-launched jobs share one tray; the attribution line is what tells them
  apart. Each row has its own `⏹`; finished rows get `Show me`.

## 11. Start page

Same column, same width, over the hero. Differences:

- **Allow mode is disabled** with the reason in the header strip: *No project
  open — Allow mode is off. Grants are per project.* Ask and Plan only.
- Create is a conversation, not a modal. The agent asks at most two clarifying
  questions, then answers with the same numbered plan; the button reads
  `Create · up to $2.20`, next to `Edit steps` and `Start blank instead`.
- Footnote: *A folder is written to disk before anything is spent. You can stop
  at any step and keep what exists.*
- While creating, the recents rail shows a live project card with the same step
  counter, and the status bar mirrors it. The existing NewProjectModal remains
  for `+ New project`; the panel is the conversational route to the same
  pipeline, and both feed CreateProgress.

## 12. Cost

The 💰 dashboard counts **every generation in the project, whatever launched
it** — the editor's own buttons as much as the agent. Four summary tiles (total,
generation, conversation, today), then a split bar showing the generation total
divided between *you* and *agent*, then two tables:

- **Generation · by kind** — one row per kind of paid work: image (sprites,
  tiles, backdrops), animation (frame sets), video (cutscene clips), code
  (systems, behaviours), audio (loops, stingers). Each row names its backend and
  model and splits the money into `you` / `agent` / `total`, with a run count. A
  totals row closes the table.
- **By identity** — `you · editor buttons` and `agent:wick` with its specialists
  nested, in `tokens` / `generation` / `total` / `runs` columns. Tokens are a
  separate column from generation spend because they fail differently: tokens
  are the cost of thinking, generation is the cost of asking a backend to make
  something. Human rows have no token column entry.
- **Agent · by conversation** — per-session totals, running sessions marked.

Every row is one journal entry, so the two tables always reconcile. Unconfirmed
estimates are never counted; stopped runs count what they billed. New generation
kinds appear as new rows without a schema change — the kind is a field on the
journal entry, not a column.
