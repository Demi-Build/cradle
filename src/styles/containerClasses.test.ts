import { describe, it, expect, beforeAll } from "vitest";

/** CONTAINER CLASSES ARE NOT BUTTON CLASSES.
 *
 *  A class whose stylesheet writes `<class> button { … }` is a container: it
 *  paints the group's ground and leaves the foreground to its children. Put
 *  that class ON a `<button>` and the child rule never matches, so nothing
 *  sets `color` — and a `<button>` does NOT inherit it (the UA stylesheet
 *  gives it `color: buttontext`). The result is near-black text on whatever
 *  ground the container painted: 1.07:1 in the dark theme, and a perfectly
 *  readable 17.9:1 in the light one, which is how it survived review.
 *
 *  That is exactly what happened on the music/sfx toolbar: "＋ new row" and
 *  "⚙ roll tables" wore `.view-toggle`, the cards/list group's container
 *  class. This test is the SHAPE of the mistake, not the one instance — it
 *  fails for any container class that lands on a button anywhere in the app,
 *  so the same fix cannot quietly come undone in another surface.
 *
 *  `.tsx` sources are read through the bundler the way `lib/actor.test.ts`
 *  scans `src/`. The STYLESHEETS cannot be: vitest runs with `css: false`, so
 *  a `?raw` css import comes back as the empty string — the glob supplies the
 *  file list and node reads the bytes, the same untyped-builtin dance
 *  `lib/agent.test.ts` already does.
 */

const cssModules = import.meta.glob("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

const tsxFiles = Object.fromEntries(
  Object.entries(
    import.meta.glob("../**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  ).filter(([path]) => !path.endsWith(".test.tsx")),
);

const cssFiles: Record<string, string> = {};

beforeAll(async () => {
  // @ts-expect-error node builtins are untyped under the browser tsconfig
  const fs = await import("node:fs");
  for (const rel of Object.keys(cssModules)) {
    cssFiles[rel] = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  }
});

/** Every class some stylesheet styles the `button` CHILDREN of. */
function containerClasses(): Set<string> {
  const out = new Set<string>();
  for (const css of Object.values(cssFiles)) {
    for (const rule of css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of rule[1].split(",")) {
        // ".view-toggle button", ".start-app .view-toggle button.on" — the
        // class is the last one BEFORE the descendant `button`.
        const hit = selector.trim().match(/\.([\w-]+)\s+button\b/);
        if (hit) out.add(hit[1]);
      }
    }
  }
  return out;
}

/** Every class written directly on a `<button>` in the app. */
function buttonClasses(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [path, text] of Object.entries(tsxFiles)) {
    for (const tag of text.matchAll(/<button\b[^>]*?className=(?:\{)?[`"]([^`"]*)/gs)) {
      for (const cls of tag[1].split(/[\s{}$?:]+/)) {
        if (!/^[\w-]+$/.test(cls)) continue;
        out.set(cls, [...(out.get(cls) ?? []), path]);
      }
    }
  }
  return out;
}

describe("container classes", () => {
  it("are found at all — the guard is worthless if the stylesheets read empty", () => {
    expect(Object.keys(cssFiles).length).toBeGreaterThan(0);
    expect(containerClasses().has("view-toggle")).toBe(true);
  });

  it("never sit directly on a <button>", () => {
    const containers = containerClasses();
    const onButtons = buttonClasses();
    const misuse = [...containers]
      .filter((c) => onButtons.has(c))
      .map((c) => `.${c} → ${onButtons.get(c)!.join(", ")}`);
    expect(misuse).toEqual([]);
  });

  it("still name a foreground, so a stray reuse can never render invisible", () => {
    const containers = containerClasses();
    const missing: string[] = [];
    for (const [path, css] of Object.entries(cssFiles)) {
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = rule[2];
        const paints = /(^|[;\s])background(-color)?\s*:\s*(?!none|transparent|inherit)/.test(body);
        if (!paints || /(^|[;\s])color\s*:/.test(body)) continue;
        for (const selector of rule[1].split(",")) {
          const cls = selector.trim().match(/\.([\w-]+)$/)?.[1];
          if (cls && containers.has(cls)) missing.push(`.${cls} in ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
