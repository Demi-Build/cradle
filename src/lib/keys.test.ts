import { describe, it, expect, beforeEach, vi } from "vitest";

/** The Windows path can't be exercised on the dev machine, so it is pinned
 *  here instead. `IS_MAC` is computed once at module load from `navigator`,
 *  so each case stubs the platform and re-imports with a fresh registry. */
async function loadKeys(userAgent: string, uaDataPlatform?: string) {
  vi.resetModules();
  vi.stubGlobal("navigator", {
    userAgent,
    ...(uaDataPlatform ? { userAgentData: { platform: uaDataPlatform } } : {}),
  });
  return await import("./keys");
}

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function key(k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  } as KeyboardEvent;
}

beforeEach(() => vi.unstubAllGlobals());

describe("platform detection", () => {
  it("prefers userAgentData over the userAgent string", async () => {
    // A Windows UA with macOS userAgentData: the structured signal wins.
    const k = await loadKeys(WIN_UA, "macOS");
    expect(k.IS_MAC).toBe(true);
  });

  it("falls back to the userAgent when userAgentData is absent", async () => {
    expect((await loadKeys(MAC_UA)).IS_MAC).toBe(true);
    expect((await loadKeys(WIN_UA)).IS_MAC).toBe(false);
  });
});

describe("labels", () => {
  it("renders the glyph on mac and the word on windows", async () => {
    const mac = await loadKeys(MAC_UA);
    expect(mac.MOD).toBe("⌘");
    expect(mac.kbd("K")).toBe("⌘K");

    const win = await loadKeys(WIN_UA);
    expect(win.MOD).toBe("Ctrl");
    // The separator matters: "CtrlK" is unreadable.
    expect(win.kbd("K")).toBe("Ctrl+K");
  });
});

describe("isShortcut", () => {
  it("matches the platform's own modifier", async () => {
    const mac = await loadKeys(MAC_UA);
    expect(mac.isShortcut(key("k", { metaKey: true }), "k")).toBe(true);

    const win = await loadKeys(WIN_UA);
    expect(win.isShortcut(key("k", { ctrlKey: true }), "k")).toBe(true);
  });

  it("does NOT match the other platform's modifier", async () => {
    // On Windows ⌘ is the Windows key — Win+K is a system shortcut, so
    // accepting it would fire our command on an OS gesture.
    const win = await loadKeys(WIN_UA);
    expect(win.isShortcut(key("k", { metaKey: true }), "k")).toBe(false);

    const mac = await loadKeys(MAC_UA);
    expect(mac.isShortcut(key("k", { ctrlKey: true }), "k")).toBe(false);
  });

  it("rejects extra modifiers", async () => {
    const mac = await loadKeys(MAC_UA);
    expect(mac.isShortcut(key("k", { metaKey: true, altKey: true }), "k")).toBe(false);
    // ⌃⌘K is a different chord than ⌘K.
    expect(mac.isShortcut(key("k", { metaKey: true, ctrlKey: true }), "k")).toBe(false);
  });

  it("is case-insensitive (shift-held keys still report uppercase)", async () => {
    const mac = await loadKeys(MAC_UA);
    expect(mac.isShortcut(key("K", { metaKey: true }), "k")).toBe(true);
  });

  it("requires a modifier at all", async () => {
    const mac = await loadKeys(MAC_UA);
    expect(mac.isShortcut(key("k"), "k")).toBe(false);
  });
});

describe("inTextField", () => {
  it("is true for inputs, textareas and contenteditable", async () => {
    const k = await loadKeys(MAC_UA);
    const ev = (target: unknown) => ({ target }) as unknown as KeyboardEvent;
    expect(k.inTextField(ev({ tagName: "INPUT" }))).toBe(true);
    expect(k.inTextField(ev({ tagName: "TEXTAREA" }))).toBe(true);
    expect(k.inTextField(ev({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    expect(k.inTextField(ev({ tagName: "DIV", isContentEditable: false }))).toBe(false);
    expect(k.inTextField(ev(null))).toBe(false);
  });
});
