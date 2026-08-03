import { describe, it, expect } from "vitest";
import { floodFill } from "./gridOps";

/** rows given as strings for readability: "0011" -> [0,0,1,1] */
const g = (...rows: string[]) => rows.map((r) => [...r].map(Number));
const s = (grid: number[][]) => grid.map((r) => r.join("")).join("|");

describe("floodFill", () => {
  it("fills the connected region and stops at a different type", () => {
    const grid = g("0001000", "0001000", "1111111");
    const touched = floodFill(grid, 0, 0, 2);
    expect(s(grid)).toBe("2221000|2221000|1111111");
    expect(touched).toHaveLength(6);
  });

  it("is 4-connected, not 8 — diagonals do not leak", () => {
    // The two 0 regions touch only at a corner.
    const grid = g("001", "010", "100");
    floodFill(grid, 0, 0, 2);
    expect(s(grid)).toBe("221|210|100");
  });

  it("returns [] and changes nothing when the target already matches", () => {
    const grid = g("00", "00");
    expect(floodFill(grid, 0, 0, 0)).toEqual([]);
    expect(s(grid)).toBe("00|00");
  });

  it("returns [] for an out-of-bounds click", () => {
    const grid = g("00", "00");
    expect(floodFill(grid, 5, 0, 1)).toEqual([]);
    expect(floodFill(grid, 0, -1, 1)).toEqual([]);
    expect(s(grid)).toBe("00|00");
  });

  it("fills a whole uniform grid without overflowing the stack", () => {
    // Recursion would blow up here; the iterative version must not.
    const w = 200,
      h = 120;
    const grid = Array.from({ length: h }, () => new Array(w).fill(0));
    const touched = floodFill(grid, 0, 0, 1);
    expect(touched).toHaveLength(w * h);
    expect(grid[h - 1][w - 1]).toBe(1);
  });

  it("fills an enclosed pocket without escaping it", () => {
    const grid = g("11111", "10001", "11111");
    floodFill(grid, 2, 1, 2);
    expect(s(grid)).toBe("11111|12221|11111");
  });
});
