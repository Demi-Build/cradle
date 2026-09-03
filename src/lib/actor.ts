// Actor strings — the ONE module in cradle that spells them (master doctrine 8,
// I6; Phase 1 §5.4). Every canon write verb takes `--actor`; the journal and
// the ledger filter by it. Before this module the user string was typed at
// 32 call sites across TS and Rust; the Rust side (which runs the verbs)
// mirrors it as the `USER_ACTOR` const in src-tauri/src/lib.rs — a const,
// not a shared file, because the two sides cannot import each other. Keep
// the two literals identical.
//
// Canon's own side of the same vocabulary lives in `canon.agent.actors`
// (`agent_actor` / `parse_actor`) — the service builds the agent string
// there; cradle only READS it back (chip copy, "agent changed this" pills,
// History attribution) and never concatenates one at a call site.

/** What cradle stamps on every user-driven canon write (`--actor`). */
export const USER_ACTOR = "cradle:user";

/** The agent identity prefix; `agent:<conversation>/<specialist>`. */
export const AGENT_ACTOR_PREFIX = "agent:";

/** The specialist every turn runs as until row A4.5 threads delegated runs. */
export const FOREMAN = "foreman";

/** A parsed actor string. `kind` is "agent" for `agent:…`, else "user"
 *  (`cradle:user`, canon's CLI `user` — a person either way). */
export type ActorRef = {
  actor: string;
  kind: "agent" | "user";
  conversation: string | null;
  specialist: string | null;
};

/** `agent:<conversation>/<specialist>` — mirrors canon's `agent_actor`.
 *  Cradle never sends this to a verb (the sidecar attributes its own
 *  writes); it exists so the panel can build a matching string for
 *  filtering History/ledger rows by the open conversation. */
export function agentActor(conversation: string, specialist: string = FOREMAN): string {
  if (!conversation || !specialist) {
    throw new Error("agentActor needs a non-empty conversation and specialist");
  }
  if (conversation.includes("/")) {
    throw new Error(`conversation id may not contain '/': ${conversation}`);
  }
  return `${AGENT_ACTOR_PREFIX}${conversation}/${specialist}`;
}

/** Read an actor string back — mirrors canon's `parse_actor`. */
export function parseActor(actor: string): ActorRef {
  if (!actor.startsWith(AGENT_ACTOR_PREFIX)) {
    return { actor, kind: "user", conversation: null, specialist: null };
  }
  const rest = actor.slice(AGENT_ACTOR_PREFIX.length);
  const slash = rest.indexOf("/");
  const conversation = slash < 0 ? rest : rest.slice(0, slash);
  const specialist = slash < 0 ? "" : rest.slice(slash + 1);
  return {
    actor,
    kind: "agent",
    conversation: conversation || null,
    specialist: specialist || null,
  };
}

/** Is `actor` an `agent:…` identity? */
export function isAgentActor(actor: string): boolean {
  return parseActor(actor).kind === "agent";
}
