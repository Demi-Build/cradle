/** The design tokens, resolved for canvas drawing.
 *
 *  CSS gets its colours from `styles/tokens.css` and nothing else. A `<canvas>`
 *  can't, so anything drawn there used to carry its own hex literals — which is
 *  how the world map ended up painting a dark stage inside a light-themed app.
 *  This reads the SAME custom properties the stylesheet defines, so one token
 *  edit moves both.
 *
 *  Semantic colours (accent / ok / warn / err) are identical in both themes by
 *  design, so they pass through as authored.
 */

export type CanvasTheme = {
  bg: string;
  bgRaised: string;
  bgSunken: string;
  bgHover: string;
  border: string;
  borderHi: string;
  fg: string;
  fgMuted: string;
  fgDim: string;
  accent: string;
  accentInk: string;
  ok: string;
  warn: string;
  err: string;
  /** `--fg` at an arbitrary alpha — for hairlines, grids and edges, which need
   *  to read against the surface in EITHER theme. */
  ink: (alpha: number) => string;
  /** True when the resolved palette is the dark one. */
  dark: boolean;
};

const FALLBACK = {
  bg: "#0e0f12",
  bgRaised: "#15171c",
  bgSunken: "#0a0b0e",
  bgHover: "#1b1e24",
  border: "#23262d",
  borderHi: "#2e323b",
  fg: "#e8e6df",
  fgMuted: "#9a988e",
  fgDim: "#5e5d55",
};

/** #rgb / #rrggbb → [r,g,b]. The surface tokens are authored as hex; anything
 *  else falls back to mid-grey rather than producing an invalid colour. */
function rgbOf(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length >= 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return [128, 128, 128];
}

/** Relative luminance, good enough to tell the two themes apart. */
function isDark(hex: string): boolean {
  const [r, g, b] = rgbOf(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

export function readCanvasTheme(el?: Element | null): CanvasTheme {
  let vars: Record<string, string> = {};
  if (typeof window !== "undefined" && typeof getComputedStyle === "function") {
    const cs = getComputedStyle(el ?? document.body);
    const read = (name: string) => cs.getPropertyValue(name).trim();
    vars = {
      bg: read("--bg"),
      bgRaised: read("--bg-raised"),
      bgSunken: read("--bg-sunken"),
      bgHover: read("--bg-hover"),
      border: read("--border"),
      borderHi: read("--border-hi"),
      fg: read("--fg"),
      fgMuted: read("--fg-muted"),
      fgDim: read("--fg-dim"),
    };
  }
  const v = (k: keyof typeof FALLBACK) => vars[k] || FALLBACK[k];
  const [r, g, b] = rgbOf(v("fg"));
  return {
    bg: v("bg"),
    bgRaised: v("bgRaised"),
    bgSunken: v("bgSunken"),
    bgHover: v("bgHover"),
    border: v("border"),
    borderHi: v("borderHi"),
    fg: v("fg"),
    fgMuted: v("fgMuted"),
    fgDim: v("fgDim"),
    accent: "oklch(72% 0.13 78)",
    accentInk: "oklch(28% 0.05 78)",
    ok: "oklch(68% 0.13 150)",
    warn: "oklch(72% 0.14 45)",
    err: "oklch(62% 0.18 25)",
    ink: (alpha: number) => `rgba(${r},${g},${b},${alpha})`,
    dark: isDark(v("bg")),
  };
}
