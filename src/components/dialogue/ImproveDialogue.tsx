// `✨ Improve…` — a PROPOSAL, never an application (README Q10, board 04b).
//
// The one rule this whole file exists to keep: AN LLM RE-AUTHOR IS NEVER A
// WRITE. `canon dialogue improve` returns per-field before/after rows and
// answers `wrote: false`; accepting rows turns them into `node.prompt` /
// `choice.text` EditOps that land in the UNSAVED BUFFER, so `⌘S` remains the
// only write and `⌘Z` still undoes it. Nothing here calls `dialogue update`.
//
// EXTENDS two things rather than growing its own:
//   • `PromptOverride` — the same "✎ Edit prompt (advanced)" disclosure every
//     other paid gate in the editor carries, holding the editable system
//     prompt fetched from canon (a pure read: no LLM call, no cost).
//   • `confirmSpend` / `PaidCard` — the editor's ONE spend gate (row P1-A5).
//     Doctrine 3: a `fake`/`none` selection is $0 and never raises the card;
//     any other backend id is a real, user-run provider call and always asks,
//     estimate or no estimate.
//
// Paid reads as paid THREE times before any confirm, exactly as the design
// says: a `paid · <backend>` chip in the header, `paid run` in the cost-box
// label, and the estimate itself as the largest number on screen — plus where
// the key comes from (`CANON_ENV_FILE`) and that a missing one is refused up
// front with the variable named.
//
// AND THE TARGET IS GATED ON DISK, NOT ON THE BUFFER. `canon dialogue improve`
// resolves its tree from the pack and refuses an id that is not there; a gate
// computed from the unsaved buffer therefore admitted a tree canon could not
// take, and the user found that out only after committing to a paid run. So
// `savedTreeIds` — what the pack actually holds — drives the scope pills, the
// unit count and Propose itself. A control it blocks is greyed with the reason
// on hover or focus; Propose, being this screen's primary action, also states
// the reason inline and carries the save that clears it.
//
// WHICH IS ONLY HALF THE HAZARD. Blocking the "this tree" pill stops canon's
// refusal, but it does not stop the SPEND: a user who opened this modal looking
// at an unsaved tree lands on the NPC scope, and every live control then reads
// normal. Money would be spent re-authoring the other trees with the switch
// explained nowhere but a tooltip on a greyed pill. So whenever the run is
// aimed somewhere other than the tree on screen, that is said inline beside
// Propose, and the spend card NAMES the trees the money buys — a unit count
// prices a request without ever saying which one it is.

import { useMemo, useState } from "react";
import { GatedButton } from "../GatedButton";
import { PromptOverride } from "../PromptOverride";
import { FREE_BACKENDS, confirmSpend } from "../agent/confirmGateState";
import { kbd } from "../../lib/keys";
import { api, type DialogueImproveResult } from "../../lib/invoke";
import type { AuthorDoc } from "./model";
import { improveRowToOps, type EditOp } from "./ops";

export function ImproveDialogue({
  worldPath,
  npcId,
  npcLabel,
  doc,
  treeId,
  savedTreeIds,
  onOps,
  onClose,
  onNote,
  onSave,
}: {
  worldPath: string;
  npcId: string;
  npcLabel: string;
  doc: AuthorDoc;
  treeId: string | null;
  /** The tree ids canon will find ON DISK. `improve` resolves its target from
   *  the pack, so a tree that exists only in the unsaved buffer is not a target
   *  it can take — the scope pills and Propose are gated on this set, and never
   *  on `doc.trees`. */
  savedTreeIds: Set<string>;
  /** Accepted rows land here — in the UNSAVED buffer, never on disk. */
  onOps: (ops: EditOp[]) => void;
  onClose: () => void;
  onNote?: (note: string) => void;
  /** The way OUT of an unsaved-tree block: the refusal carries the save that
   *  clears it, rather than describing one. */
  onSave?: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  // The scope opens on whichever pill can actually run: "this tree" unless the
  // open tree is unsaved, in which case the character's SAVED trees are the
  // only thing improve can read. The modal never opens onto a dead primary
  // action when a live one exists.
  const [scope, setScope] = useState<"tree" | "npc">(() =>
    treeId !== null && savedTreeIds.has(treeId) ? "tree" : "npc",
  );
  const [keepStructure, setKeepStructure] = useState(true);
  const [backend, setBackend] = useState("fake");
  const [systemOverride, setSystemOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DialogueImproveResult | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  // The editor's ONE $0 vocabulary (`confirmGateState.FREE_BACKENDS`), not a
  // second list: doctrine 3 must mean the same thing at every call site.
  const paid = !FREE_BACKENDS.has((backend ?? "").toLowerCase());
  const tree = doc.trees.find((t) => t.tree_id === treeId) ?? null;
  const treeOnDisk = !!tree && savedTreeIds.has(tree.tree_id);
  const treeLabel = tree?.label || tree?.tree_id || "this tree";

  /** The trees THIS RUN would send — the saved ones inside the chosen scope.
   *  An unsaved tree is dropped rather than counted: canon resolves the scope
   *  from disk, so counting a buffer-only tree would price a request that is
   *  not the one being made. Empty means the run cannot happen at all. */
  const scopeTrees = useMemo(() => {
    const inScope = scope === "npc" ? doc.trees : tree ? [tree] : [];
    return inScope.filter((t) => savedTreeIds.has(t.tree_id));
  }, [doc.trees, savedTreeIds, scope, tree]);

  /** Why the open tree cannot be the target. ONE sentence, written once: the
   *  scope pill and the blocked Propose below are the same refusal seen from
   *  two places, and they must not drift apart. */
  const treeReason = !tree
    ? "no tree is open — pick one in the rail, or improve every saved tree"
    : treeOnDisk
      ? ""
      : `${treeLabel} is not in the saved pack yet — ${kbd("S")} saves it, then improve can read it`;

  /** Why this run cannot be made at all. Empty = it can. The block is always
   *  the same one thing — improve reads the pack, and the pack does not have
   *  this yet. */
  const blockedReason = scopeTrees.length
    ? ""
    : scope === "tree"
      ? treeReason
      : `none of ${npcLabel}'s dialogue is saved yet — ${kbd("S")} saves it, then improve can read it`;

  /** The trees this run would actually re-author, NAMED. "18 nodes · 40
   *  choices" prices a request without ever saying which one it is; this is the
   *  half that says what the money is for, and it is written once so the cost
   *  box and the spend card cannot describe two different runs. */
  const scopeLabel =
    scope === "npc"
      ? `${npcLabel}'s ${scopeTrees.length} saved tree${scopeTrees.length === 1 ? "" : "s"}`
      : tree
        ? `${npcLabel}'s ${treeLabel} tree`
        : // No tree open: the run is blocked below and never reaches the card.
          `${npcLabel}'s dialogue`;

  /** The run is aimed somewhere other than the tree on screen. Not fatal — the
   *  request CAN go — but it is not the request the click implied, so it is
   *  stated inline rather than left to the greyed pill's tooltip. */
  const retargeted = scope === "npc" && !!tree && !treeOnDisk && scopeTrees.length > 0;
  const retargetNote = retargeted
    ? `${treeLabel} is not in the saved pack yet, so this run improves ${scopeLabel} instead ` +
      `— ${kbd("S")} saves ${treeLabel} first`
    : "";

  const units = useMemo(() => {
    const nodes = scopeTrees.reduce((n, t) => n + Object.keys(t.nodes).length, 0);
    const choices = scopeTrees.reduce(
      (n, t) => n + Object.values(t.nodes).reduce((m, node) => m + node.choices.length, 0),
      0,
    );
    return { nodes, choices, label: `${nodes} nodes · ${choices} choices in one request` };
  }, [scopeTrees]);

  const run = async () => {
    if (busy) return;
    // The gate again, at the call itself: a paid request is never sent for a
    // target canon cannot resolve, however the click got here.
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    // Doctrine 3, run one way: $0 never asks, everything else always does.
    // There is no dialogue-specific estimate verb, so the card renders the
    // price as UNKNOWN rather than a confident "$0.00" — and still gates.
    if (
      !(await confirmSpend({
        // The card names the TARGET, not just the owner: "improve Tam's
        // dialogue" reads the same whether it is re-authoring the tree on
        // screen or the four others, and those are different purchases.
        title: `improve ${scopeLabel}`,
        body:
          `Re-authors ${scopeLabel} — ${units.label}.` +
          (retargetNote ? ` ${retargetNote}.` : "") +
          " The result is a PROPOSAL — nothing is applied and nothing is " +
          "written until you accept rows and then save.",
        estimate: null,
        backends: { llm: backend },
        backend,
        unitCount: units.nodes + units.choices,
        unitLabel: units.label,
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.dialogueImprove(worldPath, npcId, {
        instruction,
        treeId: scope === "tree" ? treeId : null,
        scope,
        backend,
        keepStructure,
      });
      setResult(r);
      setAccepted(new Set());
      if (r.wrote) {
        // Canon promises `wrote: false`. If that ever changes, say so loudly
        // rather than rendering a diff over a write that already happened.
        setError("canon reported a WRITE from improve — this verb must only propose.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = result?.proposal.rows ?? [];

  /** Improve reads the SAVED pack (`canon.dialogue.improve` resolves the row
   *  from disk and is handed no buffer), so a proposal can be a rewrite of
   *  prose the buffer has already changed — or of a node an unsaved delete
   *  removed, which `applyOps` refuses with an `OpError`. Each row is
   *  reconciled against the live buffer BEFORE it can be accepted, and a row
   *  that no longer fits is DISABLED WITH THE REASON rather than dropped
   *  silently (doctrine 4). */
  const conflictOf = (row: (typeof rows)[number]): string | null => {
    const tree = doc.trees.find((t) => t.tree_id === row.tree);
    if (!tree) return `tree '${row.tree}' is not in the unsaved buffer any more`;
    const node = tree.nodes[row.node_id];
    if (!node) return `node '${row.node_id}' was deleted in an unsaved edit`;
    if (row.choice === null) {
      if (node.prompt !== row.before) {
        return "the prompt changed in an unsaved edit after improve read the saved pack";
      }
      return null;
    }
    const choice = node.choices[row.choice];
    if (!choice) return `choice ${row.choice + 1} was removed in an unsaved edit`;
    if (choice.text !== row.before) {
      return "the choice text changed in an unsaved edit after improve read the saved pack";
    }
    return null;
  };
  const conflicts = rows.map(conflictOf);

  const apply = () => {
    const picked = rows.filter((_, i) => accepted.has(i) && conflicts[i] === null);
    const ops = improveRowToOps(picked);
    try {
      if (ops.length) onOps(ops);
    } catch (e) {
      // An op the buffer cannot take must read as a refusal with its reason,
      // never as an unhandled exception out of a click handler.
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    onNote?.(`${ops.length} improved line(s) landed unsaved — ⌘S writes them.`);
    onClose();
  };

  return (
    <div className="dlg-sheet-scrim" role="dialog" aria-label="Improve this dialogue">
      <div className="dlg-sheet dlg-improve-sheet" data-testid="dialogue-improve">
        <header className="dlg-improve-head">
          <h3 className="dlg-sheet-title">✨ Improve this tree</h3>
          {paid ? (
            <span className="chip dlg-paid-chip" data-testid="improve-paid-chip">
              paid · {backend}
            </span>
          ) : (
            <span className="chip chip-muted">$0 · {backend || "none"}</span>
          )}
          <span className="dlg-mono dlg-dim">canon dialogue improve</span>
        </header>
        <p className="dlg-sheet-note">
          The result arrives as a proposal you accept row by row. Nothing is applied and nothing is
          written until you accept and then save. Improve reads the <strong>saved pack</strong>, not
          the unsaved buffer — a tree you have not saved yet is not a target it can take, and a row
          whose text you have already edited here is offered disabled, with the reason.
        </p>

        <div className="dlg-improve-cols">
          <div className="dlg-improve-request">
            <label className="dlg-field">
              <span>instruction</span>
              <textarea
                className="dlg-improve-instruction"
                value={instruction}
                placeholder="Make Tam more reluctant to name the Prophet directly — she should hint, not accuse. Keep every node id."
                onChange={(e) => setInstruction(e.target.value)}
                aria-label="improve instruction"
              />
            </label>

            <div className="dlg-field">
              <span>scope</span>
              <div className="segmented">
                {/* An unsaved tree is not a scope improve can take, so the pill
                    is greyed WITH the reason on hover or focus — never hidden,
                    because "save it" is the thing to go and do. */}
                <GatedButton
                  className={`seg-btn ${scope === "tree" ? "active" : ""}`}
                  reason={treeReason}
                  testId="improve-scope-tree"
                  onClick={() => setScope("tree")}
                >
                  this tree
                </GatedButton>
                <GatedButton
                  className={`seg-btn ${scope === "npc" ? "active" : ""}`}
                  reason=""
                  testId="improve-scope-npc"
                  onClick={() => setScope("npc")}
                >
                  every tree for this NPC
                </GatedButton>
              </div>
            </div>

            <label className="dlg-improve-keep">
              <input
                type="checkbox"
                checked={keepStructure}
                onChange={(e) => setKeepStructure(e.target.checked)}
              />
              <span>
                <strong>Keep structure</strong> — node ids, choice targets and gates are preserved;
                only prose changes.
              </span>
            </label>

            <label className="dlg-field">
              <span>backend</span>
              <select
                value={backend}
                aria-label="improve backend"
                onChange={(e) => setBackend(e.target.value)}
              >
                <option value="fake">fake — $0, canned text</option>
                <option value="none">none — $0, deterministic copy pass</option>
                <option value="anthropic">anthropic — paid</option>
              </select>
            </label>

            <div className="dlg-improve-cost" data-paid={paid ? "1" : "0"}>
              <span className="dlg-improve-cost-label">
                Estimated cost · <strong>{paid ? "paid run" : "free run"}</strong>
              </span>
              <span className="dlg-improve-cost-figure">{paid ? "not estimated" : "$0"}</span>
              <span className="dlg-dim">
                {/* WHAT, then how much — the scope is part of the price. */}
                Re-authors {scopeLabel} · {units.label}.{" "}
                {paid ? (
                  <>
                    Key read from <span className="dlg-mono">CANON_ENV_FILE</span>; a missing one is
                    refused up front with the variable named.
                  </>
                ) : (
                  "A $0 backend never raises the spend card."
                )}
              </span>
            </div>

            {/* The same disclosure every other paid gate carries — DISABLED
                with the reason, not hidden (doctrine 4). `canon dialogue
                improve` carries its own system prompt and takes no
                `--system-prompt` yet, so an editable box here would send an
                override canon silently ignores. Naming that is honest; hiding
                the control would make the gap invisible. */}
            <PromptOverride
              worldPath={worldPath}
              kind="improve"
              ctx={{ target: npcId, instruction }}
              value={systemOverride}
              onChange={setSystemOverride}
              disabled
              label="✎ Edit prompt (advanced) — canon dialogue improve takes no override yet"
            />
          </div>

          <div className="dlg-improve-result">
            {error ? <p className="dlg-sheet-failed">{error}</p> : null}
            {result ? (
              <>
                <header className="dlg-improve-result-head">
                  <span>
                    proposal · {rows.length} change{rows.length === 1 ? "" : "s"}
                  </span>
                  {result.keep_structure ? (
                    <span className="chip chip-muted">structure unchanged</span>
                  ) : null}
                  <button
                    className="btn"
                    disabled={rows.length === 0}
                    onClick={() =>
                      setAccepted(
                        new Set(rows.map((_, i) => i).filter((i) => conflicts[i] === null)),
                      )
                    }
                  >
                    accept all
                  </button>
                </header>
                <p className="dlg-dim">{result.backend_note}</p>
                {rows.length === 0 ? (
                  <p className="dlg-improve-empty">
                    Nothing proposed. The prose is already clean by this backend&apos;s rules —
                    which is an answer, not a failure.
                  </p>
                ) : null}
                {rows.map((row, i) => (
                  <div key={row.target} className="dlg-improve-row" data-testid="improve-row">
                    <header>
                      <span className="dlg-mono">{row.node_id}</span>
                      <span className="dlg-dim">
                        {row.choice === null ? "prompt" : `choice ${row.choice + 1} text`}
                      </span>
                      <span className="dlg-modebar-spacer" />
                      <button
                        className="btn"
                        onClick={() =>
                          setAccepted((s) => {
                            const next = new Set(s);
                            next.delete(i);
                            return next;
                          })
                        }
                      >
                        Skip
                      </button>
                      <button
                        className={`btn ${accepted.has(i) ? "" : "pri"}`}
                        disabled={conflicts[i] !== null}
                        title={conflicts[i] ?? undefined}
                        onClick={() =>
                          setAccepted((s) => {
                            const next = new Set(s);
                            next.add(i);
                            return next;
                          })
                        }
                      >
                        {accepted.has(i) ? "Accepted ✓" : "Accept"}
                      </button>
                    </header>
                    <p className="dlg-improve-before">− {row.before}</p>
                    <p className="dlg-improve-after">+ {row.after}</p>
                    <p className="dlg-dim">{row.why}</p>
                    {conflicts[i] ? (
                      <p className="dlg-sheet-failed" data-testid="improve-conflict">
                        ⚠ {conflicts[i]} — this row cannot be applied.
                      </p>
                    ) : null}
                  </div>
                ))}
              </>
            ) : (
              <p className="dlg-dim">
                No proposal yet. Write an instruction and run it — the diff lands here, row by row.
              </p>
            )}
          </div>
        </div>

        {/* Propose IS this screen's primary action, so when it is blocked the
            reason stays VISIBLE here rather than living only in a tooltip — and
            it carries the save that clears it.

            THE RETARGET NOTE IS THE SAME PARAGRAPH IN ITS NON-FATAL KEY: the
            run can go, but not at the tree on screen, and that is not something
            to learn from a tooltip after paying. Same words, same way out, warn
            colouring instead of error — one refusal seen from two places, so
            they cannot drift apart. */}
        {(blockedReason || retargetNote) && !result ? (
          <p
            className="dlg-sheet-failed"
            style={
              retargetNote ? { borderLeftColor: "var(--warn)", color: "var(--warn)" } : undefined
            }
            data-testid={blockedReason ? "improve-blocked" : "improve-retargeted"}
          >
            ⚠ {blockedReason || retargetNote}.{" "}
            {onSave ? (
              <button
                className="btn"
                onClick={() => {
                  onClose();
                  onSave();
                }}
              >
                Save this dialogue
              </button>
            ) : null}
          </p>
        ) : null}

        <footer className="dlg-improve-foot">
          <span className="dlg-dim">
            {accepted.size} of {rows.length} accepted · accepted rows land unsaved
          </span>
          <span className="dlg-modebar-spacer" />
          <button className="btn" onClick={onClose}>
            {result ? "Discard proposal" : "Cancel"}
          </button>
          {result ? (
            <button className="btn pri" disabled={accepted.size === 0} onClick={apply}>
              Apply {accepted.size} accepted change{accepted.size === 1 ? "" : "s"}
            </button>
          ) : (
            <GatedButton
              className="btn pri"
              reason={blockedReason}
              testId="improve-propose"
              onClick={() => void run()}
            >
              {busy ? "Asking…" : paid ? "Propose — paid run" : "Propose — $0"}
            </GatedButton>
          )}
        </footer>
      </div>
    </div>
  );
}
