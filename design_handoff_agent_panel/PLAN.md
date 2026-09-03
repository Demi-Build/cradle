# Implementation map

Component tree, store slices and the order to build them in. Geometry and copy
are in `README.md`; this file is what to create and where it mounts.

## Mount points

| Where | Change |
| --- | --- |
| `App.tsx` shell grid | Add a third column: `208px | 1fr | 4px | var(--agent-w)`. The handle and column render only when `agentOpen`. |
| `TopBar` | Panel toggle button (accent when open), `⌘⇧A`. Sits left of the theme toggle. |
| `ValidationBar` | New left segment: active conversation status + `+N running`. |
| Start page | Same column, `<AgentPanel context="start">`. Hero and recents rail keep `--shell-max`; the column is outside it. |
| `NotesDrawer` | Raise z-index above the panel; set `aria-hidden` + 60% opacity on the panel while open. |
| `JobTray` | Add an attribution column; agent-launched jobs appear here too. |
| `CostDashboard` | Summary tiles + launcher split bar + `GenerationByKindTable` + `IdentityCostTable`. Editor-launched generations must be journaled the same way agent ones are, or the tables won't reconcile. |
| `History` | Attribution column renders `agent:<name>/<specialist>`; plan batches are one collapsible entry. |

## New components

```
AgentPanel/
  AgentPanel.tsx          column shell, resize handle, collapsed rail
  AgentRail.tsx           40px collapsed state
  TabStrip.tsx            tabs, status dots, overflow menu, +, history
  SessionHistoryMenu.tsx
  PanelHeader.tsx         mode switch, ModelPicker, session cost, stop
  ModelPicker.tsx         grouped, priced, disabled-with-reason
  Transcript.tsx          virtualised list, session rules, autoscroll-with-pin
  MessageUser.tsx / MessageAgent.tsx
  ErrorNotice.tsx         four variants (starting / failed / no-key / provider)
  RunCard.tsx             specialist card, collapsible, per-card stop
  ToolCall/
    ReadLine.tsx
    WriteCard.tsx         picks a diff renderer by payload kind
    DiffSpatial.tsx       two mini-canvases, integer scale, nearest-neighbour
    DiffFields.tsx
    DiffCode.tsx
    PaidCard.tsx          estimate | running | result | stopped
  PermissionChips.tsx     ask / granted / rejected / disabled-in-ask
  PlanCard.tsx            proposed | running | halted | complete
  ChangeFeed.tsx
  Composer.tsx            context chips, mode readout, send
  FirstRun.tsx
```

`DiffSpatial` and the paid card's result thumbnails share the existing
`canvasTheme.ts` token resolution. Never smooth-scale: `imageSmoothingEnabled =
false`, integer scale factors only, letterbox the remainder.

## Store slices

```ts
agentUi:    { open, width, collapsed, activeTabId }        // persisted: open, width
agentTabs:  { tabs: Conversation[], order }                 // per project, on disk
conversation: { id, title, model, mode, messages[], status, costCents }
runs:       { id, conversationId, specialist, task, status, startedAt, costCents }
toolCalls:  { id, runId, tier, payload, approval, result }
grants:     { projectId, tool, specialist, grantedAt }      // per project, on disk
agentCost:  { byKind, byIdentity, byConversation }          // derived from journal
```

`status` on a conversation is the union the tab dot reads:
`idle | streaming | awaiting_approval | error`.

## Order to build

1. **Column + rail + resize + persistence.** No content. Prove the editor
   reflow, the NotesDrawer stacking and the auto-collapse threshold first —
   this is where the fixed-artboard handoff will diverge from the fluid app.
2. **Tabs, sessions, header, model picker.** Static transcript.
3. **Transcript + streaming + the four error states.** Errors before happy path;
   they are what users hit on day one.
4. **Read lines and write cards** with the three diff renderers. `Show me`
   deep-links reuse the existing selection URLs.
5. **Permission chips + grants**, including the per-project store and the
   Settings → Permissions list that revokes them.
6. **Paid card**, all four states. This replaces every `window.confirm` cost
   gate; delete those in the same PR so two gates never coexist.
7. **Run cards** and foreman routing display.
8. **Plan mode**, including halted and the batch undo entry.
9. **Stop** across all three surfaces, plus the job-tray attribution column.
10. **Start-page variant** wired to the existing create pipeline.
11. **Cost dashboard** — journal the editor-launched generations first, then
    build the by-kind and by-identity tables over one source.

## Storage / backend changes needed

- Journal entries gain an `identity` field (`user` or
  `agent:<name>/<specialist>`) and an optional `costCents`. History and Cost
  both read it.
- Paid entries also gain `genKind` (`image | animation | video | code | audio`)
  plus `backend` and `model`, so Cost can group by kind without parsing tool
  names. This applies to generations started from the editor's own buttons too —
  today those bypass the journal and are invisible to the dashboard.
- A plan batch needs a `batchId` so undo can revert it as one entry.
- Grants file per project: `.cradle/permissions.toml`, keyed by tool name.
- Conversations persist per project so tabs survive a restart; the transcript is
  append-only JSONL alongside the journal.
- The paid path needs an estimate endpoint that returns `{low, high, backend,
  model, unitCount}` before any spend, and streams `{phase, item, index, total,
  spentCents}` while running. The stopped state needs the partial spend to be
  reported by the backend, not inferred client-side.
- Provider metadata (per-1M in/out price, key presence) must be readable without
  a key, so the picker can render priced-but-disabled entries.

## Responsive rules to implement

- Panel min 340px, max 720px, default 412px.
- Below 900px remaining main width: editor floating panels reflow inward.
- Below 720px remaining: panel auto-collapses to the rail + one-time toast.
- The panel never scrolls horizontally. Diff cards scroll their own code blocks.
- Tab strip scrolls; overflow folds to `+N`.

## Out of scope here

Service internals, routing heuristics, tool semantics, the Settings screen
itself (only the deep-links to it are designed), the dialogue tester.
