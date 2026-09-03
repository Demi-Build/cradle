import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
afterEach(() => vi.restoreAllMocks());

import { addedCells, drawSpatial, integerScale, toBundle } from "./diffSpatialDraw";
import { DiffFields } from "./DiffFields";
import { DiffCode } from "./DiffCode";
import { kindOf } from "./diffText";
import { WriteCard } from "./WriteCard";
import { ReadFold } from "./ReadLine";
import { useStore } from "../../../store";
import type { ToolItem } from "../../../lib/agentState";
import { setupAgent } from "../testUtils";

/** Step 4 (README §5): read lines fold past six; write cards pick a diff
 *  renderer by payload — spatial (via the SAME `drawLevel`, integer scale,
 *  nearest-neighbour), fields (old struck red → new green, unchanged
 *  hidden), code (a real unified diff with hunk headers) — each with Show me. */

/** jsdom has no 2D context: a recording one captures what `drawLevel`
 *  painted, so the drawn pixels of a tiny level can be snapshotted. */
function recordingContext() {
  const ops: string[] = [];
  const ctx: Record<string, unknown> = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    fillText: () => {},
    drawImage: () => {},
    setLineDash: () => {},
    measureText: () => ({ width: 0 }),
    rect: () => {},
    clip: () => {},
    translate: () => {},
    scale: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      ops.push(`fill ${ctx.fillStyle} ${x},${y} ${w}x${h}`);
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      ops.push(`stroke ${ctx.strokeStyle} ${x},${y} ${w}x${h}`);
    },
  };
  return { ctx, ops };
}

const tiny = (entities: { x: number; y: number }[]) => ({
  level_id: "t",
  grid_width: 4,
  grid_height: 3,
  grids: {
    collision: [
      [0, 0, 0, 0],
      [0, 2, 0, 0],
      [1, 1, 1, 1],
    ],
  },
  entities: entities.map((e) => ({ enemy_id: "e", ...e, placeholder_color: "#ff0000" })),
  items: [],
});

describe("DiffSpatial", () => {
  it("fits an integer scale and never a fractional one", () => {
    expect(integerScale(24, 190)).toBe(7);
    expect(integerScale(53, 190)).toBe(3);
    expect(integerScale(400, 190)).toBe(1);
    expect(integerScale(4, 10_000)).toBe(10); // capped
  });

  it("finds the added placements between before and after", () => {
    const b = toBundle(tiny([{ x: 1, y: 0 }]));
    const a = toBundle(
      tiny([
        { x: 1, y: 0 },
        { x: 3, y: 1 },
      ]),
    );
    expect(addedCells(b, a)).toEqual([[3, 1]]);
  });

  it("draws through drawLevel at the integer scale with smoothing off, and tints the added cells green", () => {
    const { ctx, ops } = recordingContext();
    const canvas = document.createElement("canvas");
    canvas.getContext = (() => ctx) as unknown as typeof canvas.getContext;
    const b = toBundle(tiny([{ x: 1, y: 0 }]));
    const a = toBundle(
      tiny([
        { x: 1, y: 0 },
        { x: 3, y: 1 },
      ]),
    );
    drawSpatial(canvas, a, 5, addedCells(b, a));
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(canvas.style.width).toBe("20px"); // 4 cells × 5 — integer, letterbox the rest
    expect(canvas.style.height).toBe("15px");
    // The pixel record of the tiny level: background, terrain tiles, the
    // actor, then the green tint on the one added cell.
    expect(ops[0]).toBe("fill #141018 0,0 20x15");
    expect(ops.filter((o) => o.startsWith("fill #776459"))).toHaveLength(4); // the floor row
    expect(ops.filter((o) => o.startsWith("fill #b8804a"))).toHaveLength(1); // the platform
    const green = ops.filter((o) => o.includes("oklch(68% 0.13 150)"));
    expect(green).toContain("fill oklch(68% 0.13 150) 15,5 5x5");
    expect(green.some((o) => o.startsWith("stroke"))).toBe(true);
  });
});

describe("DiffFields and DiffCode", () => {
  it("shows old struck → new and the hidden-unchanged count", () => {
    render(
      <DiffFields
        fields={[
          { name: "rarity", old: "rare", new: "uncommon" },
          { name: "size", old: 1, new: 2 },
        ]}
        unchanged={11}
      />,
    );
    expect(document.querySelector(".old")!.textContent).toBe("rare");
    expect(document.querySelector(".new")!.textContent).toBe("uncommon");
    expect(screen.getByText("2 fields · 11 unchanged hidden")).toBeInTheDocument();
  });

  it("renders a real unified diff with hunk headers and tinted lines, folded past twelve lines", () => {
    const unified = [
      "@@ -41,7 +41,9 @@ class Hopper",
      " def step(self, dt):",
      "-  self.vy += G",
      "+  g = G",
      "+  self.vy += g",
      ...Array(10).fill(" ctx"),
    ].join("\n");
    render(<DiffCode path="systems/hopper.py" unified={unified} added={2} removed={1} />);
    const pre = screen.getByTestId("diff-code");
    expect(pre.querySelector(".ln.hunk")!.textContent).toContain("@@ -41,7 +41,9 @@");
    expect(pre.querySelectorAll(".ln.add")).toHaveLength(2);
    expect(pre.querySelectorAll(".ln.del")).toHaveLength(1);
    expect(pre.classList.contains("folded")).toBe(true);
    fireEvent.click(screen.getByText("open full diff"));
    expect(pre.classList.contains("folded")).toBe(false);
    expect(kindOf("--- a/x")).toBe("ctx");
    expect(kindOf("+++ b/x")).toBe("ctx");
  });
});

describe("WriteCard + ReadFold", () => {
  beforeEach(() => setupAgent(invokeMock));

  const tool = (over: Partial<ToolItem>): ToolItem => ({
    kind: "tool",
    id: "t1",
    name: "apply_level_edit",
    input: { level_id: "l3" },
    tier: "write",
    status: "ok",
    label: "place 6 enemies in 2-3",
    ts: 0,
    showMe: { kind: "entity", typeId: "levels", id: "l3" },
    journal: [{ artifact_id: "l3", before_hash: "aaa111", after_hash: "bbb222" }],
    ...over,
  });

  it("picks the renderer by payload kind and Show me navigates the editor's selection", () => {
    render(
      <WriteCard
        tool={tool({
          diff: { kind: "fields", fields: [{ name: "a", old: 1, new: 2 }], unchanged: 3 },
        })}
        conversationId="c"
      />,
    );
    expect(screen.getByTestId("write-card").textContent).toContain("Row · place 6 enemies in 2-3");
    expect(screen.getByText("1 field · 3 unchanged hidden")).toBeInTheDocument();
    useStore.getState().select({ kind: "none" });
    fireEvent.click(screen.getByText("Show me ↗"));
    expect(useStore.getState().selection).toEqual({
      kind: "entity",
      typeId: "levels",
      id: "l3",
      tab: undefined,
    });
  });

  it("a write with no diff block still shows what it did and the before → after hashes", () => {
    render(<WriteCard tool={tool({ summary: "imported 1 grid" })} conversationId="c" />);
    expect(screen.getByTestId("write-card").textContent).toContain("imported 1 grid");
    expect(screen.getByTestId("write-card").textContent).toContain("aaa111 → bbb222");
    expect(screen.getByText("undo this")).toBeInTheDocument();
  });

  it("more than six reads fold into one line that expands", () => {
    const reads = Array.from({ length: 9 }, (_, i) =>
      tool({ id: `r${i}`, tier: "read", name: "describe_level", label: `read level ${i}` }),
    );
    render(<ReadFold tools={reads} />);
    expect(screen.getByTestId("read-fold").textContent).toContain("read 9 artifacts");
    fireEvent.click(within(screen.getByTestId("read-fold")).getByRole("button"));
    expect(screen.getAllByTestId("read-line")).toHaveLength(9);
  });
});
