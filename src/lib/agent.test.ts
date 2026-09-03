import { describe, it, expect } from "vitest";
import { HttpAgentTransport, parseSse, type AgentEvent } from "./agent";

// The app's tsconfig is browser-only (no node types): the integration test
// below reaches node's builtins lazily and types them itself.
declare const process: { env: Record<string, string | undefined>; pid: number };
type NodeMods = {
  spawn: (
    cmd: string,
    args: string[],
    opts: { stdio: string[] },
  ) => {
    stdout: { on: (ev: "data", fn: (d: unknown) => void) => void };
    on: (ev: "exit", fn: (code: unknown) => void) => void;
    kill: () => void;
  };
  mkdtempSync: (p: string) => string;
  cpSync: (a: string, b: string, o: { recursive: boolean }) => void;
  existsSync: (p: string) => boolean;
  writeFileSync: (p: string, s: string) => void;
  tmpdir: () => string;
  join: (...p: string[]) => string;
};
async function nodeMods(): Promise<NodeMods> {
  // @ts-expect-error node builtins are untyped under the browser tsconfig
  const cp = await import("node:child_process");
  // @ts-expect-error see above
  const fs = await import("node:fs");
  // @ts-expect-error see above
  const os = await import("node:os");
  // @ts-expect-error see above
  const path = await import("node:path");
  return {
    spawn: cp.spawn,
    mkdtempSync: fs.mkdtempSync,
    cpSync: fs.cpSync,
    existsSync: fs.existsSync,
    writeFileSync: fs.writeFileSync,
    tmpdir: os.tmpdir,
    join: path.join,
  };
}

/** The SSE parser — every frame the service streams goes through it, in
 *  whatever chunking the network chose. */
describe("parseSse", () => {
  it("parses event + data frames and carries a split frame to the next chunk", () => {
    const a = parseSse('event: text_delta\ndata: {"text":"hi"}\n\nevent: do');
    expect(a.events).toEqual([{ event: "text_delta", data: { text: "hi" } }]);
    expect(a.carry).toBe("event: do");
    const b = parseSse('ne\ndata: {"stop_reason":"end_turn"}\n\n', a.carry);
    expect(b.events).toEqual([{ event: "done", data: { stop_reason: "end_turn" } }]);
    expect(b.carry).toBe("");
  });

  it("joins multi-line data, ignores comments, and keeps non-JSON data as raw", () => {
    const r = parseSse(': ping\nevent: x\ndata: {"a":\ndata: 1}\n\nevent: y\ndata: not json\n\n');
    expect(r.events[0]).toEqual({ event: "x", data: { a: 1 } });
    expect(r.events[1]).toEqual({ event: "y", data: { raw: "not json" } });
  });

  it("tolerates CRLF framing", () => {
    const r = parseSse('event: a\r\ndata: {"k":2}\r\n\r\n');
    expect(r.events).toEqual([{ event: "a", data: { k: 2 } }]);
  });
});

/** ONE integration test against the real sidecar with the fake backend:
 *  create → message → SSE → permission request → decision → done. Skipped
 *  unless CANON_BIN points at a canon with the agent extra AND a platformer
 *  pack is named in CRADLE_TEST_PACK (the fixture pack is not in this repo).
 *  $0 by construction (`--backend fake`), doctrine 3. */
const CANON_BIN = typeof process !== "undefined" ? process.env.CANON_BIN : undefined;
const PACK = typeof process !== "undefined" ? process.env.CRADLE_TEST_PACK : undefined;
const canRun = !!CANON_BIN && !!PACK;

describe.skipIf(!canRun)("the real sidecar (CANON_BIN + CRADLE_TEST_PACK)", () => {
  it("answers a scripted turn with a permission round-trip over HTTP+SSE", async () => {
    const { spawn, mkdtempSync, cpSync, existsSync, writeFileSync, tmpdir, join } =
      await nodeMods();
    if (!existsSync(PACK!)) throw new Error(`CRADLE_TEST_PACK does not exist: ${PACK}`);
    // Work on a copy: the write tool below journals into the pack.
    const dir = mkdtempSync(join(tmpdir(), "cradle-agent-"));
    const pack = join(dir, "pack");
    cpSync(PACK!, pack, { recursive: true });
    const script = join(dir, "script.json");
    writeFileSync(
      script,
      JSON.stringify({
        turns: [
          [
            { type: "text", text: "Pinning nothing — publishing l1." },
            {
              type: "tool_use",
              id: "tu_1",
              name: "publish_level",
              input: { level_id: "l1", position: null, remove: false },
            },
          ],
          [{ type: "text", text: "Done." }],
        ],
      }),
    );
    const child = spawn(
      CANON_BIN!,
      [
        "agent",
        "serve",
        "--pack",
        pack,
        "--port",
        "0",
        "--backend",
        "fake",
        "--fake-script",
        script,
        "--parent-pid",
        String(process.pid),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const port = await new Promise<number>((resolve, reject) => {
      let buf = "";
      child.stdout.on("data", (d: unknown) => {
        buf += String(d);
        const line = buf.split("\n")[0];
        if (buf.includes("\n")) {
          try {
            resolve(JSON.parse(line).port);
          } catch (e) {
            reject(e);
          }
        }
      });
      child.on("exit", (code: unknown) => reject(new Error(`sidecar exited ${String(code)}`)));
      setTimeout(() => reject(new Error("no port line")), 15000);
    });
    try {
      const t = new HttpAgentTransport(`http://127.0.0.1:${port}`);
      expect((await t.health()).ok).toBe(true);
      const { id } = await t.createConversation({});
      const events: AgentEvent[] = [];
      let decided = false;
      await t.sendMessage(id, { text: "publish l1", mode: "ask" }, (ev) => {
        events.push(ev);
        if (ev.event === "permission_request" && !decided) {
          decided = true;
          void t.decidePermission(id, {
            request_id: String(ev.data.request_id),
            decision: "accept",
          });
        }
      });
      const names = events.map((e) => e.event);
      expect(names).toContain("permission_request");
      expect(names).toContain("permission_decision");
      expect(names[names.length - 1]).toBe("done");
      const lines = await t.getConversation(id);
      expect(lines.some((l) => l.type === "permission_decision")).toBe(true);
      await t.shutdown();
    } finally {
      child.kill();
    }
  }, 60_000);
});
