import { describe, it, expect } from "vitest";
import { AGENT_ACTOR_PREFIX, USER_ACTOR, agentActor, isAgentActor, parseActor } from "./actor";

/** I6: ONE module owns actor strings. The functions, and then the guard that
 *  nothing else in `src/` spells one by hand. */
describe("actor strings", () => {
  it("builds and parses the two identities", () => {
    expect(USER_ACTOR).toBe("cradle:user");
    expect(AGENT_ACTOR_PREFIX).toBe("agent:");
    expect(agentActor("conv_1", "level_designer")).toBe("agent:conv_1/level_designer");
    expect(agentActor("conv_1")).toBe("agent:conv_1/foreman");
    expect(parseActor("agent:conv_1/artist")).toMatchObject({
      kind: "agent",
      conversation: "conv_1",
      specialist: "artist",
    });
    expect(parseActor(USER_ACTOR)).toMatchObject({ kind: "user", conversation: null });
    expect(isAgentActor(USER_ACTOR)).toBe(false);
    expect(() => agentActor("a/b", "artist")).toThrow();
  });

  it("is the only place in src/ that spells one", () => {
    // Every source file, read through the bundler (no node:fs, so this runs
    // with the same module resolution the app uses).
    const files = import.meta.glob("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(files)) {
      if (/(^|\/)actor(\.test)?\.ts$/.test(path)) continue;
      text.split("\n").forEach((line, i) => {
        // Comments and docstrings may SHOW the shape; code may not build it.
        const code = line.replace(/^\s*(\/\/|\/?\*).*$/, "");
        if (/["']cradle:user["']/.test(code)) offenders.push(`${path}:${i + 1}`);
        if (/`agent:\$\{|["']agent:["']\s*\+/.test(code)) offenders.push(`${path}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
    expect(Object.keys(files).length).toBeGreaterThan(20);
  });
});
