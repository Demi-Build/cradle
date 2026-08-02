/** Pure grid operations for the level editor.
 *
 *  Kept out of the component so they can be tested directly — the editor's
 *  other mutations are one-cell writes, but flood fill is real algorithmic
 *  code with edge cases worth pinning.
 */

/** Flood-fill the 4-connected run of same-typed cells containing (x, y).
 *
 *  MUTATES `grid` and returns the cells it changed, so the caller can mark
 *  them painted. Returns [] when the click is out of bounds or the target is
 *  already the fill type — the caller should then skip marking dirty.
 *
 *  Iterative on purpose: a recursive fill overflows the stack on a large empty
 *  level (a 76x20 map is 1520 cells, and the sky is usually one region).
 */
export function floodFill(
  grid: number[][],
  x: number,
  y: number,
  fillType: number,
): string[] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  if (x < 0 || y < 0 || x >= w || y >= h) return [];
  const target = grid[y][x];
  if (target === fillType) return [];

  const seen = new Uint8Array(w * h);
  const stack: number[] = [y * w + x];
  const touched: string[] = [];
  while (stack.length) {
    const key = stack.pop()!;
    if (seen[key]) continue;
    seen[key] = 1;
    const cy = Math.floor(key / w);
    const cx = key - cy * w;
    if (grid[cy][cx] !== target) continue;
    grid[cy][cx] = fillType;
    touched.push(`${cx},${cy}`);
    if (cx + 1 < w) stack.push(key + 1);
    if (cx - 1 >= 0) stack.push(key - 1);
    if (cy + 1 < h) stack.push(key + w);
    if (cy - 1 >= 0) stack.push(key - w);
  }
  return touched;
}
