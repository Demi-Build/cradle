import { describe, it, expect, beforeEach, vi } from "vitest";

/** Row P0-12 — the missing-key gate reads canon's provider ROWS.
 *
 *  What this pins is the M0-readiness rule (doctrine 8): cradle carries no
 *  provider list. Before this row `BACKEND_KEYS` was a literal here, which is
 *  how cradle came to store `PIXELLAB_API_KEY` while canon's backend read
 *  `PIXELLAB_SECRET` — the two lists disagreed and nothing caught it. Now a
 *  backend id cradle has never seen resolves purely from data. */

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

const providerRowsFn = vi.fn();
const providerKeysFn = vi.fn();
vi.mock("./invoke", () => ({
  api: {
    providerRows: (...a: unknown[]) => providerRowsFn(...a),
    providerKeys: (...a: unknown[]) => providerKeysFn(...a),
  },
}));

import {
  firstKeyVarFor,
  keyVarFor,
  missingKeysFor,
  openProviderKeys,
  providerRows,
  resetProviderRows,
  rowForVar,
} from "./providerKeys";
import { useStore } from "../store";

function makeRow(over: Record<string, unknown>) {
  return {
    id: "x",
    label: "X",
    env_var: "X_KEY",
    aliases: [],
    unlocks: "",
    backends: {},
    docs: "",
    note: "",
    test: null,
    ...over,
  };
}

const DOC = {
  result: "providers",
  providers: [
    makeRow({
      id: "pixellab",
      label: "PixelLab",
      env_var: "PIXELLAB_SECRET",
      aliases: ["PIXELLAB_API_KEY"],
      backends: { image: ["pixellab"] },
    }),
    makeRow({
      id: "anthropic",
      label: "Anthropic",
      env_var: "ANTHROPIC_API_KEY",
      backends: { llm: ["anthropic"], vlm: ["anthropic"] },
    }),
  ],
  backend_key_vars: {
    image: { pixellab: "PIXELLAB_SECRET" },
    llm: { anthropic: "ANTHROPIC_API_KEY" },
    vlm: { anthropic: "ANTHROPIC_API_KEY" },
  },
};

beforeEach(() => {
  resetProviderRows();
  vi.clearAllMocks();
  providerRowsFn.mockResolvedValue(DOC);
  providerKeysFn.mockResolvedValue({
    env_file: "/repo/.env",
    keys: [],
    vars: [],
    backend: "keychain",
    warning: null,
    config_dir: null,
  });
  useStore.setState({ settings: { open: false, pane: "keys", focusVar: null } } as never);
});

describe("the rows are data", () => {
  it("fetches once and shares the result", async () => {
    await Promise.all([providerRows(), providerRows(), providerRows()]);
    expect(providerRowsFn).toHaveBeenCalledTimes(1);
  });

  it("maps a backend id to its var across every kind", () => {
    expect(keyVarFor(DOC, "pixellab")).toBe("PIXELLAB_SECRET");
    expect(keyVarFor(DOC, "anthropic")).toBe("ANTHROPIC_API_KEY");
    // Free backends have no row and therefore no var.
    expect(keyVarFor(DOC, "fake")).toBeUndefined();
    expect(keyVarFor(DOC, "none")).toBeUndefined();
  });

  it("finds a row by its canonical var OR its alias", () => {
    expect(rowForVar(DOC.providers, "PIXELLAB_SECRET")?.id).toBe("pixellab");
    expect(rowForVar(DOC.providers, "PIXELLAB_API_KEY")?.id).toBe("pixellab");
  });
});

describe("the PixelLab pair", () => {
  it("asks for canon's CANONICAL name — the P0-12 var fix", async () => {
    const reason = await missingKeysFor({ image: "pixellab" });
    expect(reason).toContain("PIXELLAB_SECRET");
    expect(reason).not.toContain("PIXELLAB_API_KEY");
  });

  it("treats the dashboard's ALIAS as satisfying it, exactly as the backend does", async () => {
    providerKeysFn.mockResolvedValue({
      env_file: null,
      keys: ["PIXELLAB_API_KEY"],
      vars: [],
      backend: "keychain",
      warning: null,
      config_dir: null,
    });
    expect(await missingKeysFor({ image: "pixellab" })).toBeNull();
  });

  it("passes the canonical var AND its aliases to the status read", async () => {
    await missingKeysFor({ image: "pixellab" });
    expect(providerKeysFn).toHaveBeenCalledWith(["PIXELLAB_SECRET"]);
  });
});

describe("the gate", () => {
  it("is silent for free backends", async () => {
    expect(await missingKeysFor({ image: "fake", llm: "none" })).toBeNull();
    expect(providerKeysFn).not.toHaveBeenCalled();
  });

  it("names the missing var and where cradle looked", async () => {
    const reason = await missingKeysFor({ llm: "anthropic" });
    expect(reason).toContain("ANTHROPIC_API_KEY");
    expect(reason).toContain("keychain");
    expect(reason).toContain("/repo/.env");
  });

  it("cannot tell, and says nothing, when canon is unreachable (the browser mock)", async () => {
    providerRowsFn.mockRejectedValue(new Error("no canon"));
    expect(await missingKeysFor({ llm: "anthropic" })).toBeNull();
  });

  it("resolves a backend id it has never seen, from data alone", async () => {
    providerRowsFn.mockResolvedValue({
      ...DOC,
      providers: [...DOC.providers, makeRow({ id: "demi", env_var: "DEMI_API_KEY" })],
      backend_key_vars: { ...DOC.backend_key_vars, chat: { demi: "DEMI_API_KEY" } },
    });
    expect(await missingKeysFor({ chat: "demi" })).toContain("DEMI_API_KEY");
  });
});

describe("the deep link", () => {
  it("opens Settings on the keys pane, FOCUSED on the offending row", () => {
    openProviderKeys("FAL_KEY");
    expect(useStore.getState().settings).toEqual({
      open: true,
      pane: "keys",
      focusVar: "FAL_KEY",
    });
  });

  it("still opens the screen when no variable is known", () => {
    openProviderKeys();
    expect(useStore.getState().settings).toEqual({ open: true, pane: "keys", focusVar: null });
  });

  it("names the variable a backend selection needs, for the refusal to link to", async () => {
    expect(await firstKeyVarFor({ image: "fake", llm: "anthropic" })).toBe("ANTHROPIC_API_KEY");
    expect(await firstKeyVarFor({ image: "fake" })).toBeNull();
  });
});
