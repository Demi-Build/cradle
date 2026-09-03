import { useStore } from "../../store";
import { api } from "../../lib/invoke";
import { nextId, titleFrom } from "../../lib/agentState";
import { loadPackTemplates, countLabel, type PackTemplate } from "../../lib/packTemplates";
import { stopConversation } from "../../lib/agentActions";
import {
  beginCreate,
  currentCreate,
  isPaidSelection,
  stopCreate,
  type CreateParams,
} from "./startCreate";
import { confirmSpend } from "./confirmGateState";

/** The start page's create conversation (row P1-A9; Phase 1 §2.4;
 *  agent-panel README §11 + board 05).
 *
 *  **Why it is driven here and not by the sidecar.** A conversation requires
 *  an open pack — the service checks it on every create, and pack-less session
 *  storage is deferred to the service's own row. The start page has no pack by
 *  definition. So its turns are produced locally and dispatched through the
 *  SAME reducer (`agentDispatch`) every service event goes through: the cards
 *  on screen are the shipped `request_input` chips, the shipped `PlanCard` and
 *  the shipped `CreateProgress` — not a second panel. Everything durable
 *  (templates, the estimate, the create itself) is a canon verb.
 *
 *  **The shape it holds to**, from the PRD:
 *  - **at most two clarifying questions** ({@link MAX_QUESTIONS}), then a
 *    numbered plan — never a third round;
 *  - the plan card carries the estimate from the CHOSEN template's own
 *    estimator (`canon estimate --template`), so the button can say
 *    `Create · up to $X`;
 *  - a $0 (all fake/none) selection shows "$0" and never raises the spend card
 *    (doctrine 3 / master §8 A-5);
 *  - the create is the JobQueue create, the one the wizard uses.
 */

/** Phase 1 §2.4's ceiling, as data — the tests assert against this, never a
 *  literal buried in the script. */
export const MAX_QUESTIONS = 2;

/** The header strip's reason (README §11, verbatim). */
export const ALLOW_DISABLED_REASON = "No project open — Allow mode is off. Grants are per project.";

/** Why `Edit steps` is disabled here (doctrine 4: disabled WITH a reason,
 *  never hidden). The editor's `edit` decision is a POST the service re-plans
 *  from; with no project open there is no service, and this plan's two steps
 *  are what approving it performs rather than a script to rewrite. The way to
 *  change the template, the counts or the generators is the form. */
export const PLAN_EDIT_DISABLED_REASON =
  "Editing the steps needs a project open. Use Start blank instead to set the template, " +
  "counts and generators yourself.";

/** The composer's mode line on the start page (board 05: "Plan mode · no
 *  project open"). The MODE half stays live — the header's control is the
 *  truth about it — and only the second half is this surface's fact. */
export function startModeLine(mode: string): string {
  return `${mode.charAt(0).toUpperCase()}${mode.slice(1)} mode · no project open`;
}

/** The plan card's footnote on the start page (README §11, verbatim). */
export const CREATE_FOOTNOTE =
  "A folder is written to disk before anything is spent. You can stop at any step and keep what exists.";

/** The FREE default selection: canned text, placeholder art, no audio. The
 *  start page opens on it deliberately — the first world anyone makes should
 *  cost nothing, and turning a dial up is the paid decision.
 *
 *  It is the draft's SEED, not a constant the proposal re-applies: this page
 *  has no backend control of its own yet (the wizard's form owns that, and
 *  `Start blank instead` opens it), and when one arrives it sets
 *  `draftFor(id).backends` — the estimate, the step's tier, the button's
 *  `Create · up to $X` and the spend card all already follow from there. */
export const FREE_SELECTION = {
  llm: "fake",
  image: "fake",
  music: "none",
  sfx: "none",
  vlm: "none",
} as const;

/** What the conversation has worked out so far. One per start-page tab. */
export type CreateDraft = {
  /** The user's own words, first turn — the brief. */
  brief: string;
  /** How many clarifying questions have been ASKED (capped at MAX_QUESTIONS). */
  asked: number;
  /** Answers collected, in order. */
  answers: string[];
  template: PackTemplate | null;
  name: string;
  counts: Record<string, number>;
  backends: Record<string, string>;
  planId: string | null;
  params: CreateParams | null;
};

const drafts = new Map<string, CreateDraft>();

export function draftFor(conversationId: string): CreateDraft {
  let d = drafts.get(conversationId);
  if (!d) {
    d = {
      brief: "",
      asked: 0,
      answers: [],
      template: null,
      name: "",
      counts: {},
      backends: { ...FREE_SELECTION },
      planId: null,
      params: null,
    };
    drafts.set(conversationId, d);
  }
  return d;
}

/** Tests, and closing a tab. */
export function resetDrafts(): void {
  drafts.clear();
  creatingIn = null;
}

function dispatch(id: string, event: string, data: Record<string, unknown>): void {
  useStore.getState().agentDispatch(id, { event, data });
}

function say(id: string, text: string): void {
  dispatch(id, "message_start", {});
  dispatch(id, "text_delta", { text });
  dispatch(id, "done", { stop_reason: "end_turn" });
}

/** A title for the project, taken from the user's own words. Deliberately
 *  crude: the user renames it whenever they like, and inventing a poetic name
 *  for them is not this row's job. */
export function nameFromBrief(brief: string): string {
  const words = brief
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w.toLowerCase()));
  const picked = words.slice(0, 2).join(" ");
  return (picked || "New project").replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

const STOP = new Set([
  "make",
  "made",
  "game",
  "about",
  "with",
  "that",
  "this",
  "want",
  "would",
  "like",
  "please",
  "build",
  "create",
  "there",
  "from",
  "into",
  "some",
]);

/** The two questions, in order. They are the ones board 05 asks — structure
 *  first, then whether anything fights back — because those are the two the
 *  template and the counts actually depend on. */
const QUESTION_LEAD =
  "Two things before I build it: should the world be one continuous run, or separate areas " +
  "you unlock? And is there combat, or only hazards?";

const QUESTIONS: { question: string; options: string[] }[] = [
  {
    question: "Is it one continuous run, or separate areas you unlock?",
    options: ["Separate areas", "One continuous run"],
  },
  {
    question: "Is there combat, or only hazards?",
    options: ["Hazards only", "Combat too"],
  },
];

/** Put the user's words in the transcript, exactly as `sendMessage` does
 *  (same item shape, same session rule, same title-from-first-message). */
function pushUser(conversationId: string, text: string): void {
  const st = useStore.getState();
  const conv = st.agent.conversations[conversationId];
  if (!conv) return;
  const seeded = conv.items.length === 0;
  st.patchAgentConversation(conversationId, {
    items: [
      ...conv.items,
      ...(seeded ? [{ kind: "rule" as const, ts: Date.now(), label: "Session started" }] : []),
      { kind: "user" as const, id: nextId("u"), text, ts: Date.now(), context: [] },
    ],
    draft: "",
    title: conv.title === "New conversation" ? titleFrom(text) : conv.title,
    status: "idle",
  });
}

/** One turn of the start-page conversation. */
export async function sendStartMessage(conversationId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const draft = draftFor(conversationId);
  // "What can you build for me?" is one of this page's own seeds, and it is a
  // question about the page, not a brief. Answering it with two clarifying
  // questions and a plan to create a project called "What" would be the panel
  // misreading its own prompt, so it is answered from `pack templates`.
  if (!draft.brief && isCapabilityQuestion(trimmed)) {
    pushUser(conversationId, trimmed);
    await sayWhatIsCreatable(conversationId);
    return;
  }
  pushUser(conversationId, trimmed);
  if (!draft.brief) {
    draft.brief = trimmed;
    draft.name = nameFromBrief(trimmed);
  } else {
    draft.answers.push(trimmed);
    // ONE typed reply answers every question on screen. Board 05's own script
    // is exactly that — both questions ride one turn, and the user answers
    // both in one sentence ("Separate areas. Hazards only — ice, wind,
    // dark.") — so counting replies against questions would leave the
    // conversation silently waiting for a chip the user has already answered.
    if (draft.asked > draft.answers.length) {
      draft.asked = draft.answers.length;
      closeOpenQuestions(conversationId, trimmed);
    }
  }
  await advance(conversationId);
}

/** Is this first message a question about what the page can do, rather than a
 *  brief? Deliberately narrow — "what/which … can/do … you" — because a false
 *  positive costs a user their brief, while a false negative only costs the
 *  extra sentence they would have typed anyway. */
export function isCapabilityQuestion(text: string): boolean {
  return /^(what|which)\b[^?]*\b(can|could|do|does)\b[^?]*\byou\b/i.test(text.trim());
}

/** Answer it from `pack templates` — the same DATA the wizard's cards render,
 *  so a third template appears here with no branch (M0-readiness: template ids
 *  are entries, never a union). */
async function sayWhatIsCreatable(conversationId: string): Promise<void> {
  let templates: PackTemplate[];
  try {
    templates = await loadPackTemplates();
  } catch (e) {
    dispatch(conversationId, "error", {
      variant: "generic",
      message: `I could not read the installed templates: ${String(e).slice(0, 200)}`,
      retryable: true,
    });
    return;
  }
  if (templates.length === 0) {
    say(conversationId, "No templates are installed, so there is nothing I can create yet.");
    return;
  }
  say(
    conversationId,
    `I can start a project from ${templates.length === 1 ? "this template" : "any of these"}:\n` +
      templates.map((t) => `· ${t.label} — ${t.description}`).join("\n") +
      "\n\nDescribe the game you want and I'll turn it into one of them — I ask at most two " +
      "questions first, and nothing is created until you approve the plan.",
  );
}

/** Mark the chips still on screen as answered by the reply the user typed —
 *  they were answered, and leaving them offering buttons would invite a second
 *  answer to a question the conversation has already moved past. */
function closeOpenQuestions(conversationId: string, answer: string): void {
  const st = useStore.getState();
  const conv = st.agent.conversations[conversationId];
  if (!conv) return;
  st.patchAgentConversation(conversationId, {
    items: conv.items.map((i) => (i.kind === "request_input" && !i.answer ? { ...i, answer } : i)),
  });
}

/** A `request_input` chip was answered. Same path as a typed reply — the chip
 *  is a shortcut, never a different conversation. */
export async function answerStartInput(
  conversationId: string,
  itemId: string,
  answer: string,
): Promise<void> {
  const st = useStore.getState();
  const conv = st.agent.conversations[conversationId];
  if (!conv) return;
  st.patchAgentConversation(conversationId, {
    items: conv.items.map((i) =>
      i.kind === "request_input" && i.id === itemId ? { ...i, answer } : i,
    ),
  });
  draftFor(conversationId).answers.push(answer);
  await advance(conversationId);
}

/** Ask the next question, or — once the cap is reached or every question is
 *  answered — propose the plan. This is where the "at most two" ceiling is
 *  enforced: `asked` never exceeds MAX_QUESTIONS, so a third round cannot
 *  happen however the user replies. */
async function advance(conversationId: string): Promise<void> {
  const draft = draftFor(conversationId);
  const outstanding = draft.asked - draft.answers.length;
  if (outstanding > 0) return; // waiting on a chip already on screen
  if (draft.asked < MAX_QUESTIONS && draft.asked < QUESTIONS.length && draft.answers.length === 0) {
    // Both questions ride ONE turn — board 05 asks them together, and one
    // round of questions is the least the user can be asked.
    say(conversationId, QUESTION_LEAD);
    for (const q of QUESTIONS.slice(0, MAX_QUESTIONS)) {
      dispatch(conversationId, "request_input", {
        request_id: nextId("q"),
        question: q.question,
        options: q.options,
      });
    }
    draft.asked = Math.min(MAX_QUESTIONS, QUESTIONS.length);
    return;
  }
  await proposePlan(conversationId);
}

/** The numbered plan, with the create priced by the CHOSEN template's own
 *  estimator. */
export async function proposePlan(conversationId: string): Promise<void> {
  const draft = draftFor(conversationId);
  let templates: PackTemplate[];
  try {
    templates = await loadPackTemplates();
  } catch (e) {
    dispatch(conversationId, "error", {
      variant: "generic",
      message: `I could not read the installed templates: ${String(e).slice(0, 200)}`,
      retryable: true,
    });
    return;
  }
  const template = draft.template ?? pickTemplate(draft, templates);
  if (!template) {
    dispatch(conversationId, "error", {
      variant: "generic",
      message: "No templates are installed, so there is nothing I can create.",
      retryable: false,
    });
    return;
  }
  draft.template = template;
  draft.counts = { ...template.defaults };
  // The selection is the DRAFT's (seeded FREE by `draftFor` — the first world
  // anyone makes should cost nothing). Re-seeding it here on every proposal
  // would overwrite whatever set it and make `Create · up to $X` unreachable,
  // so the draft keeps its own and this only fills a missing one.
  const backends = { ...FREE_SELECTION, ...draft.backends };
  draft.backends = { ...backends };

  let estimate: { best: number; worst: number } | null;
  try {
    const r = await api.estimateWorld({
      template: template.id,
      counts: draft.counts,
      llmBackend: backends.llm,
      imageBackend: backends.image,
      musicBackend: backends.music,
      sfxBackend: backends.sfx,
      vlmBackend: backends.vlm,
    });
    estimate = r.estimate.total_usd;
  } catch {
    // No estimate is NOT $0 (doctrine 3): the card renders without a price
    // rather than with a confident zero.
    estimate = null;
  }
  draft.params = {
    name: draft.name,
    template,
    counts: draft.counts,
    backends,
    estimateUsd: estimate,
  };

  const planId = nextId("plan");
  draft.planId = planId;
  const paid = isPaidSelection(backends);
  dispatch(conversationId, "plan_proposed", {
    plan_id: planId,
    title: `${draft.name} · new project`,
    steps: planSteps(template, draft.counts, paid, estimate),
  });
  say(
    conversationId,
    paid
      ? "Here's the plan. Nothing is spent until you approve it."
      : "Here's the plan. Every generator is on its free setting, so this costs $0 — " +
          "you can turn any of them up later, in the project.",
  );
}

/** The plan's steps — and every one of them is a step approving it ACTUALLY
 *  performs (doctrine 5: honest progress). The create is ONE run whose own
 *  phases the run card reports live, so re-listing those phases as plan steps
 *  would be a second, less honest progress display; what the plan carries is
 *  the two things approving it does, and the run drives them by index.
 *
 *  Tier is the honest one too: on a free selection the create is an ordinary
 *  `write` step showing $0, never a `paid` step (which is what raises the
 *  spend card).
 */
export const CREATE_STEP = 0;
export const OPEN_STEP = 1;

/** Move one plan step, from whoever knows the fact (the run card's settle,
 *  `openCreated`). The reducer flips the card to complete once every step is
 *  done. */
export function markPlanStep(
  conversationId: string,
  index: number,
  status: "running" | "done" | "failed",
  extra: Record<string, unknown> = {},
): void {
  const planId = draftFor(conversationId).planId;
  if (!planId) return;
  dispatch(conversationId, "plan_step", { plan_id: planId, index, status, ...extra });
}

/** The turn is over. `plan_decided` leaves the conversation "streaming" (the
 *  approved work is running), so without this the tab pulses and the header
 *  keeps its ⏹ forever once the create lands — a status bar that lies.
 *  The remaining plan step ("open it") is the USER's move, not a running one. */
export function settleTurn(conversationId: string): void {
  dispatch(conversationId, "done", { stop_reason: "end_turn" });
}

/** Which conversation owns the create in flight — the run card reports the
 *  outcome back to that plan. One create at a time, exactly like the wizard. */
let creatingIn: string | null = null;

export function creatingConversation(): string | null {
  return creatingIn;
}

export function planSteps(
  template: PackTemplate,
  counts: Record<string, number>,
  paid: boolean,
  estimate: { best: number; worst: number } | null,
): Array<Record<string, unknown>> {
  const shape = Object.entries(counts)
    .map(([field, value]) => `${value} ${countLabel(field).toLowerCase()}`)
    .join(" · ");
  return [
    {
      text: `Create the project from the ${template.label} template — ${shape}`,
      // The tier is the SELECTION's, never the estimate's: a paid selection
      // whose estimator failed is still paid, and rendering it as a free
      // `write` step under a `Create · $0` button would be exactly the lie
      // doctrine 3 forbids — no estimate is not $0.
      tier: paid ? "paid" : "write",
      specialist: "foreman",
      ...(estimate ? { estimate: { low: estimate.best, high: estimate.worst } } : {}),
    },
    {
      text: "Open it — every room is editable from the first run",
      tier: "read",
      specialist: "foreman",
    },
  ];
}

/** Which template the brief is asking for. Template ids are DATA: the match is
 *  made against each template's own label / vocabulary / description, so a
 *  third template competes on equal terms with no branch here. Ties go to the
 *  first registered template (`pack templates` order = the wizard's card
 *  order), which is the same default the wizard opens on. */
export function pickTemplate(
  draft: Pick<CreateDraft, "brief" | "answers">,
  templates: PackTemplate[],
): PackTemplate | null {
  if (templates.length === 0) return null;
  const words = `${draft.brief} ${draft.answers.join(" ")}`.toLowerCase();
  let best: { t: PackTemplate; score: number } | null = null;
  for (const t of templates) {
    const terms = [t.id, t.label, ...t.vocab, ...t.description.split(/\s+/)]
      .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((w) => w.length > 3);
    const score = new Set(terms.filter((w) => words.includes(w))).size;
    if (!best || score > best.score) best = { t, score };
  }
  return best?.t ?? templates[0];
}

/** `Create · up to $X` — the approve button. A paid selection confirms with
 *  the shipped spend card first; a $0 one never sees it (doctrine 3). */
export async function approveCreatePlan(conversationId: string, planId: string): Promise<void> {
  const draft = draftFor(conversationId);
  const params = draft.params;
  if (!params || draft.planId !== planId) return;
  const paid = isPaidSelection(params.backends);
  if (
    paid &&
    !(await confirmSpend({
      title: `create ${params.name}`,
      body: `Projected cost for the whole project.\n` + `${CREATE_FOOTNOTE}`,
      backends: params.backends,
    }))
  )
    return;
  useStore.getState().agentDispatch(conversationId, {
    event: "plan_decided",
    data: { plan_id: planId, decision: "approve" },
  });
  creatingIn = conversationId;
  markPlanStep(conversationId, CREATE_STEP, "running");
  try {
    await beginCreate(params);
  } catch (e) {
    markPlanStep(conversationId, CREATE_STEP, "failed", { error: String(e).slice(0, 200) });
    useStore.getState().agentDispatch(conversationId, {
      event: "error",
      data: { variant: "generic", message: String(e).slice(0, 300), retryable: true },
    });
  }
}

/** ⏹ on the start page — the header's, the running plan card's and Esc's.
 *
 *  `stopConversation` stops a SIDECAR conversation, and this page's approved
 *  plan is a JobQueue create the sidecar never held: taking that path would
 *  write "Stopped by you. Nothing new was started." into the transcript while
 *  the create ran on to completion — a Stop that reports a stop and does not
 *  stop (A4.5's cancel contract inverted, doctrine 5). So while a create is in
 *  flight this cancels the JOB, exactly as the run card's own ⏹ does; the run
 *  card then reports what was kept. With nothing creating, the local cancel is
 *  the honest one and is kept.
 */
export async function stopStartWork(conversationId: string): Promise<void> {
  if (currentCreate().status === "creating") {
    await stopCreate();
    return;
  }
  await stopConversation(conversationId);
}

/** `Start blank instead` — the button route, unchanged: the same
 *  NewProjectModal, feeding the same CreateProgress (README §11). */
export function startBlankInstead(conversationId: string, planId: string): void {
  const st = useStore.getState();
  st.agentDispatch(conversationId, {
    event: "plan_decided",
    data: { plan_id: planId, decision: "reject" },
  });
  st.agentDispatch(conversationId, {
    event: "note",
    data: { text: "Opening the New project form — nothing was created." },
  });
  st.setNewProjectOpen(true);
}

/** The start page's first-run seeds. They cannot be drawn from an open
 *  project (there isn't one), so they are the three shapes of thing this page
 *  can actually do. */
export const START_SEEDS = [
  "Make me a game about a lighthouse keeper in a frozen harbour",
  "A dungeon crawl with four classes and a shop",
  "What can you build for me?",
];
