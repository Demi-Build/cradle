import { describe, expect, it } from "vitest";
import { runStatusStyle } from "./runlog";

describe("runStatusStyle", () => {
  it("labels every status canon reports", () => {
    expect(runStatusStyle("failed")).toEqual(["failed", "var(--err)"]);
    expect(runStatusStyle("incomplete")[0]).toBe("no end");
    expect(runStatusStyle("cancelled")[0]).toBe("stopped");
    expect(runStatusStyle("warnings")[0]).toBe("warnings");
    expect(runStatusStyle("ok")).toEqual(["ok", "var(--ok)"]);
  });

  it("renders an unknown status as itself", () => {
    expect(runStatusStyle("paused")).toEqual(["paused", "var(--fg-dim)"]);
  });
});
