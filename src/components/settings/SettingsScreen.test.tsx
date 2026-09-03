import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Row P0-12 — Settings: keys + Environment + the mounted Permissions pane.
 *
 *  The four things this row can get wrong, and what pins each:
 *  1. **rows as a literal.** Every key row here comes from `canon providers
 *     list`; the tests add a row the component has never heard of and expect
 *     it rendered, which a hardcoded union cannot pass.
 *  2. **a key value escaping.** The paste field is write-only: after Save, the
 *     value must be gone from the DOM, gone from the component, and absent
 *     from every subsequent status read.
 *  3. **a test button that bills.** It is user-initiated, named, and never
 *     runs without a click; a row with no free endpoint is disabled WITH the
 *     reason instead of hidden.
 *  4. **a deep link that only opens a screen.** Every refusal names a
 *     variable, and the link must land ON that row. */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));

const providerRowsFn = vi.fn();
const providerKeys = vi.fn();
const setProviderKey = vi.fn();
const deleteProviderKey = vi.fn();
const testProviderKey = vi.fn();
const environmentStatus = vi.fn();
const setProjectStore = vi.fn();

vi.mock("../../lib/invoke", () => ({
  api: {
    providerRows: (...a: unknown[]) => providerRowsFn(...a),
    providerKeys: (...a: unknown[]) => providerKeys(...a),
    setProviderKey: (...a: unknown[]) => setProviderKey(...a),
    deleteProviderKey: (...a: unknown[]) => deleteProviderKey(...a),
    testProviderKey: (...a: unknown[]) => testProviderKey(...a),
    environmentStatus: (...a: unknown[]) => environmentStatus(...a),
    setProjectStore: (...a: unknown[]) => setProjectStore(...a),
  },
}));
vi.mock("../../lib/openWorld", () => ({
  pickDirectory: () => Promise.resolve("/new/store"),
  pickAndOpenWorld: () => Promise.resolve(),
}));

import { SettingsScreen } from "./SettingsScreen";
import { resetProviderRows } from "../../lib/providerKeys";
import { setAgentTransport, type AgentTransport } from "../../lib/agent";
import { useStore } from "../../store";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "anthropic",
    label: "Anthropic",
    env_var: "ANTHROPIC_API_KEY",
    aliases: [],
    unlocks: "LLM generation.",
    backends: { llm: ["anthropic"] },
    docs: "https://console.anthropic.com/settings/keys",
    note: "",
    test: { url: "https://api.anthropic.com/v1/models", header: "x-api-key", prefix: "", note: "" },
    ...over,
  };
}

const ROWS = {
  result: "providers",
  providers: [
    row(),
    row({
      id: "pixellab",
      label: "PixelLab",
      env_var: "PIXELLAB_SECRET",
      aliases: ["PIXELLAB_API_KEY"],
      unlocks: "Pixel art.",
      backends: { image: ["pixellab"] },
      test: null,
    }),
    row({
      id: "meshy",
      label: "Meshy (3D)",
      env_var: "MESHY_API_KEY",
      aliases: [],
      unlocks: "Meshes.",
      backends: { mesh: ["meshy"] },
      note: "Free-tier outputs are CC BY 4.0 — commercial use IS allowed with attribution. A paid tier is required for full ownership / commercial use without attribution.",
      test: null,
    }),
  ],
  backend_key_vars: {
    llm: { anthropic: "ANTHROPIC_API_KEY" },
    image: { pixellab: "PIXELLAB_SECRET" },
    mesh: { meshy: "MESHY_API_KEY" },
  },
};

function status(
  vars: {
    name: string;
    set: boolean;
    source: string | null;
    also_in?: string[];
    unreadable?: boolean;
  }[],
) {
  return {
    env_file: "/repo/.env",
    keys: vars.filter((v) => v.set).map((v) => v.name),
    vars: vars.map((v) => ({ ...v, also_in: v.also_in ?? [] })),
    backend: "keychain",
    warning: null,
    config_dir: "/cfg/cradle",
  };
}

const ENV = {
  canon: {
    ok: true,
    origin: "bundled",
    command: "/app/python -m canon.cli.main",
    triple: "aarch64-apple-darwin",
    resource_dir: "/app",
    legs: [{ leg: "env", tried: null, found: false, note: "CANON_BIN is not set." }],
    version: { canon_version: "0.1", package_version: "0.1.0" },
    error: null,
  },
  godot: {
    tool: "godot",
    label: "Godot",
    env_var: "GODOT_BIN",
    found: true,
    origin: "path",
    path: "/usr/local/bin/godot",
    version: "4.3.stable",
    major: 4,
    gate: "unpinned",
    note: "Godot is available.",
    install: "https://godotengine.org/download",
    legs: [],
  },
  blender: {
    tool: "blender",
    label: "Blender",
    env_var: "BLENDER_BIN",
    found: true,
    origin: "app",
    path: "/Applications/Blender.app/Contents/MacOS/Blender",
    version: "Blender 5.0.0",
    major: 5,
    gate: "off_major",
    note: "Blender 5.x is installed; cradle's recipes are pinned to 4.x LTS. It is reported, not silently used — point $BLENDER_BIN at a 4.x build to use it.",
    install: "https://www.blender.org/download/",
    legs: [],
  },
  project_store: { root: "/home/me/CradleProjects", exists: true, source: "default" },
  config_dir: "/cfg/cradle",
};

beforeEach(() => {
  resetProviderRows();
  vi.clearAllMocks();
  providerRowsFn.mockResolvedValue(ROWS);
  providerKeys.mockResolvedValue(
    status([
      { name: "ANTHROPIC_API_KEY", set: true, source: "keychain" },
      { name: "PIXELLAB_SECRET", set: false, source: null },
      { name: "PIXELLAB_API_KEY", set: false, source: null },
      { name: "MESHY_API_KEY", set: false, source: null },
    ]),
  );
  setProviderKey.mockResolvedValue({
    var: "MESHY_API_KEY",
    stored: true,
    backend: "keychain",
    warning: null,
  });
  deleteProviderKey.mockResolvedValue({
    var: "ANTHROPIC_API_KEY",
    removed: true,
    backend: "keychain",
    warning: null,
  });
  environmentStatus.mockResolvedValue(ENV);
  setProjectStore.mockResolvedValue({ root: "/new/store", exists: true, source: "settings" });
  useStore.setState({
    settings: { open: true, pane: "keys", focusVar: null },
    world: null,
  } as never);
});

afterEach(() => setAgentTransport(null));

describe("Settings → API keys", () => {
  it("renders one row per PROVIDER ROW — including a row it has never heard of", async () => {
    providerRowsFn.mockResolvedValue({
      ...ROWS,
      providers: [...ROWS.providers, row({ id: "demi", label: "Demi", env_var: "DEMI_API_KEY" })],
      backend_key_vars: { ...ROWS.backend_key_vars, chat: { demi: "DEMI_API_KEY" } },
    });
    render(<SettingsScreen />);
    const rows = await screen.findAllByTestId("key-row");
    expect(rows.map((r) => r.getAttribute("data-var"))).toEqual([
      "ANTHROPIC_API_KEY",
      "PIXELLAB_SECRET",
      "MESHY_API_KEY",
      "DEMI_API_KEY",
    ]);
  });

  it("carries the CORRECTED Meshy licensing copy, verbatim from the row", async () => {
    render(<SettingsScreen />);
    const rows = await screen.findAllByTestId("key-row");
    const meshy = rows.find((r) => r.dataset.provider === "meshy")!;
    const note = within(meshy).getByTestId("key-note");
    expect(note.textContent).toContain("CC BY 4.0");
    expect(note.textContent).toContain("full ownership / commercial use without attribution");
    // The older, wrong wording must not be what a user reads.
    expect(note.textContent).not.toContain("required for commercial use.");
  });

  it("chips each row set/unset WITH its source", async () => {
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    const chips = screen.getAllByTestId("key-chip");
    expect(chips[0].getAttribute("data-set")).toBe("1");
    expect(chips[0].getAttribute("data-source")).toBe("keychain");
    expect(chips[0].textContent).toContain("keychain");
    expect(chips[1].getAttribute("data-set")).toBe("0");
    expect(chips[1].textContent).toBe("not set");
  });

  it("names the OTHER places a key was seen, so an override is not a mystery", async () => {
    providerKeys.mockResolvedValue(
      status([
        { name: "ANTHROPIC_API_KEY", set: true, source: "keychain", also_in: ["env", "env_file"] },
      ]),
    );
    render(<SettingsScreen />);
    const also = await screen.findByTestId("key-also-in");
    expect(also.textContent).toContain("this machine's environment");
    expect(also.textContent).toContain("the env file");
    // One article, not two: the copy no longer supplies its own "the" on top
    // of the one `sourceLabel` already carries.
    expect(also.textContent).toContain("— the OS keychain is what canon gets");
    expect(also.textContent).not.toContain("the the");
  });

  it("calls a stored-but-unretrievable key UNREADABLE rather than set", async () => {
    // The state a key removed outside cradle (or a keychain refusing this
    // build) leaves behind: the names index still lists it, but canon would
    // receive nothing — so the gate must refuse here rather than mid-job.
    providerKeys.mockResolvedValue(
      status([{ name: "ANTHROPIC_API_KEY", set: false, source: null, unreadable: true }]),
    );
    render(<SettingsScreen />);
    const rows = await screen.findAllByTestId("key-row");
    const anthropic = rows.find((r) => r.dataset.provider === "anthropic")!;
    expect(within(anthropic).getByTestId("key-chip").getAttribute("data-set")).toBe("0");
    expect(within(anthropic).getByTestId("key-chip").textContent).toBe("unreadable");
    expect(within(anthropic).getByTestId("key-unreadable").textContent).toContain(
      "will not release it",
    );
    // Removing the stale entry IS something cradle's own store can do.
    expect(within(anthropic).getByTestId("key-remove")).not.toBeDisabled();
  });

  it("counts an ALIAS as set and says which name holds it (the PixelLab pair)", async () => {
    providerKeys.mockResolvedValue(
      status([
        { name: "PIXELLAB_SECRET", set: false, source: null },
        { name: "PIXELLAB_API_KEY", set: true, source: "keychain" },
      ]),
    );
    render(<SettingsScreen />);
    const alias = await screen.findByTestId("key-alias-note");
    expect(alias.textContent).toContain("PIXELLAB_API_KEY");
    expect(alias.textContent).toContain("PIXELLAB_SECRET");
    const pixellab = screen
      .getAllByTestId("key-row")
      .find((r) => r.dataset.provider === "pixellab")!;
    expect(within(pixellab).getByTestId("key-chip").getAttribute("data-set")).toBe("1");
  });

  it("asks canon about the canonical var AND its aliases", async () => {
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    expect(providerKeys).toHaveBeenCalledWith([
      "ANTHROPIC_API_KEY",
      "PIXELLAB_SECRET",
      "PIXELLAB_API_KEY",
      "MESHY_API_KEY",
    ]);
  });
});

describe("the paste field is WRITE-ONLY", () => {
  it("sends the value once and keeps none of it — not in the field, not in the DOM", async () => {
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    const meshy = screen.getAllByTestId("key-row").find((r) => r.dataset.provider === "meshy")!;
    const field = within(meshy).getByTestId("key-input") as HTMLInputElement;
    // A deliberately fake, obviously-not-real value: no realistic key exists
    // anywhere in this repo, tests included.
    const typed = "not-a-real-key-0000";
    await userEvent.type(field, typed);
    await userEvent.click(within(meshy).getByTestId("key-save"));

    await waitFor(() => expect(setProviderKey).toHaveBeenCalledWith("MESHY_API_KEY", typed));
    expect(field.value).toBe("");
    expect(document.body.innerHTML).not.toContain(typed);
    // And the status read that follows carries no value field at all.
    expect(JSON.stringify(providerKeys.mock.results)).not.toContain(typed);
  });

  it("refuses to save nothing, and only offers Remove when something is stored", async () => {
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    const meshy = screen.getAllByTestId("key-row").find((r) => r.dataset.provider === "meshy")!;
    expect(within(meshy).getByTestId("key-save")).toBeDisabled();
    expect(within(meshy).getByTestId("key-remove")).toBeDisabled();
    const anthropic = screen
      .getAllByTestId("key-row")
      .find((r) => r.dataset.provider === "anthropic")!;
    expect(within(anthropic).getByTestId("key-remove")).not.toBeDisabled();
  });

  it("disables Remove WITH the reason for a key cradle's store does not hold", async () => {
    // A shell export or the dev `.env` — `delete_provider_key` reaches only
    // cradle's own store, so an enabled button would promise a withdrawal it
    // cannot perform. Doctrine 4: disabled with the reason, never hidden.
    providerKeys.mockResolvedValue(
      status([{ name: "ANTHROPIC_API_KEY", set: true, source: "env" }]),
    );
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    const anthropic = screen
      .getAllByTestId("key-row")
      .find((r) => r.dataset.provider === "anthropic")!;
    const remove = within(anthropic).getByTestId("key-remove");
    expect(remove).toBeDisabled();
    expect(remove.getAttribute("title")).toContain("this machine's environment");
    expect(remove.getAttribute("title")).toContain("unset it there");
  });

  it("removes by the NAME that actually holds the key", async () => {
    providerKeys.mockResolvedValue(
      status([
        { name: "PIXELLAB_SECRET", set: false, source: null },
        { name: "PIXELLAB_API_KEY", set: true, source: "keychain" },
      ]),
    );
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    const pixellab = screen
      .getAllByTestId("key-row")
      .find((r) => r.dataset.provider === "pixellab")!;
    await userEvent.click(within(pixellab).getByTestId("key-remove"));
    await waitFor(() => expect(deleteProviderKey).toHaveBeenCalledWith("PIXELLAB_API_KEY"));
  });
});

describe("the key TEST button", () => {
  it("never runs on its own — only on a click — and says it contacts the provider", async () => {
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    expect(testProviderKey).not.toHaveBeenCalled();

    const anthropic = screen
      .getAllByTestId("key-row")
      .find((r) => r.dataset.provider === "anthropic")!;
    const why = within(anthropic).getByTestId("key-test-why");
    expect(why.textContent).toContain("Contacts Anthropic");
    expect(why.textContent).toContain("No generation");
    expect(why.textContent).toContain("effectively $0");

    testProviderKey.mockResolvedValue({
      id: "anthropic",
      ran: true,
      ok: true,
      status: 200,
      reason: "the provider accepted the key",
    });
    await userEvent.click(within(anthropic).getByTestId("key-test"));
    await waitFor(() => expect(testProviderKey).toHaveBeenCalledWith("anthropic"));
    expect((await screen.findByTestId("key-test-result")).textContent).toContain("accepted");
  });

  it("is disabled WITH the reason when the provider publishes no free endpoint", async () => {
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    const meshy = screen.getAllByTestId("key-row").find((r) => r.dataset.provider === "meshy")!;
    const button = within(meshy).getByTestId("key-test");
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toContain("never does");
    expect(within(meshy).getByTestId("key-test-why").textContent).toContain(
      "no free authenticated endpoint",
    );
  });

  it("is disabled when there is no key yet, rather than pinging with nothing", async () => {
    providerKeys.mockResolvedValue(
      status([{ name: "ANTHROPIC_API_KEY", set: false, source: null }]),
    );
    render(<SettingsScreen />);
    await screen.findAllByTestId("key-row");
    const anthropic = screen
      .getAllByTestId("key-row")
      .find((r) => r.dataset.provider === "anthropic")!;
    expect(within(anthropic).getByTestId("key-test")).toBeDisabled();
    expect(within(anthropic).getByTestId("key-test-why").textContent).toContain(
      "no key stored yet",
    );
  });
});

describe("the unencrypted fallback", () => {
  it("warns LOUDLY when keys are not in a keychain", async () => {
    providerKeys.mockResolvedValue({
      ...status([{ name: "ANTHROPIC_API_KEY", set: true, source: "fallback_file" }]),
      backend: "fallback_file",
      warning: "stored UNENCRYPTED: this machine has no OS keychain…",
    });
    render(<SettingsScreen />);
    const warn = await screen.findByTestId("keys-store-warning");
    expect(warn.textContent).toContain("UNENCRYPTED");
    // …and the macOS keychain-prompt note is NOT shown on that machine.
    expect(screen.queryByTestId("keys-store-note")).toBeNull();
  });

  it("explains the macOS first-access prompt when the keychain IS in use", async () => {
    render(<SettingsScreen />);
    const note = await screen.findByTestId("keys-store-note");
    expect(note.textContent).toContain("keychain permission prompt");
    expect(note.textContent).toContain("expected, not a failure");
  });
});

describe("Settings → Environment", () => {
  it("shows the effective canon, Godot and BLENDER_BIN, and the project store", async () => {
    useStore.setState({ settings: { open: true, pane: "environment", focusVar: null } } as never);
    render(<SettingsScreen />);
    const canon = await screen.findByTestId("env-canon");
    expect(canon.textContent).toContain("/app/python -m canon.cli.main");
    expect(canon.textContent).toContain("the runtime bundled with this app");

    expect(screen.getByTestId("env-godot").textContent).toContain("/usr/local/bin/godot");
    expect(screen.getByTestId("env-godot-gate").getAttribute("data-gate")).toBe("unpinned");

    // The version gate: a 5.0 Blender is REPORTED, never silently used.
    const blender = screen.getByTestId("env-blender");
    expect(blender.textContent).toContain("BLENDER_BIN");
    expect(screen.getByTestId("env-blender-gate").getAttribute("data-gate")).toBe("off_major");
    expect(blender.textContent).toContain("pinned to 4.x LTS");

    expect(screen.getByTestId("env-store").textContent).toContain("/home/me/CradleProjects");
  });

  it("relocates the project store, and says existing projects do not move", async () => {
    useStore.setState({ settings: { open: true, pane: "environment", focusVar: null } } as never);
    render(<SettingsScreen />);
    await screen.findByTestId("env-store");
    expect(screen.getByTestId("env-store").textContent).toContain("Projects already created stay");
    await userEvent.click(screen.getByTestId("store-relocate"));
    await waitFor(() => expect(setProjectStore).toHaveBeenCalledWith("/new/store"));
  });

  it("disables relocation with the reason when the env var owns the store", async () => {
    environmentStatus.mockResolvedValue({
      ...ENV,
      project_store: { root: "/forced", exists: true, source: "env", locked_by_env: true },
    });
    useStore.setState({ settings: { open: true, pane: "environment", focusVar: null } } as never);
    render(<SettingsScreen />);
    const button = await screen.findByTestId("store-relocate");
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toContain("CRADLE_PROJECTS_DIR");
  });

  it("says what to do when a tool is not installed, instead of showing nothing", async () => {
    environmentStatus.mockResolvedValue({
      ...ENV,
      blender: { ...ENV.blender, found: false, gate: "missing", version: null, path: null },
    });
    useStore.setState({ settings: { open: true, pane: "environment", focusVar: null } } as never);
    render(<SettingsScreen />);
    const blender = await screen.findByTestId("env-blender");
    expect(blender.textContent).toContain("not installed");
    expect(blender.textContent).toContain("https://www.blender.org/download/");
    expect(blender.textContent).toContain("BLENDER_BIN");
  });
});

describe("deep links and panes", () => {
  it("FOCUSES the row a refusal named", async () => {
    useStore.setState({
      settings: { open: true, pane: "keys", focusVar: "MESHY_API_KEY" },
    } as never);
    render(<SettingsScreen />);
    const rows = await screen.findAllByTestId("key-row");
    const focused = rows.filter((r) => r.dataset.focused === "1");
    expect(focused).toHaveLength(1);
    expect(focused[0].getAttribute("data-var")).toBe("MESHY_API_KEY");
  });

  it("focuses through an ALIAS too — the deep link may name either", async () => {
    useStore.setState({
      settings: { open: true, pane: "keys", focusVar: "PIXELLAB_API_KEY" },
    } as never);
    render(<SettingsScreen />);
    const rows = await screen.findAllByTestId("key-row");
    const focused = rows.filter((r) => r.dataset.focused === "1");
    expect(focused).toHaveLength(1);
    expect(focused[0].getAttribute("data-var")).toBe("PIXELLAB_SECRET");
  });

  it("MOUNTS A6's Permissions pane as the third pane", async () => {
    useStore.setState({
      settings: { open: true, pane: "permissions", focusVar: null },
      worldPath: "/w",
      world: {
        path: "/w",
        name: "The Wandering Wick",
        world_kind: "platformer",
        entity_counts: [],
      },
    } as never);
    setAgentTransport({
      listGrants: vi
        .fn()
        .mockResolvedValue({ pack: "/w", path: "/w/.canon/agent/permissions.json", grants: [] }),
    } as unknown as AgentTransport);
    render(<SettingsScreen />);
    expect(await screen.findByTestId("permissions-pane")).toBeTruthy();
  });

  it("keeps the Permissions tab visible-and-inert with a reason when no project is open", async () => {
    render(<SettingsScreen />);
    const tab = await screen.findByTestId("settings-tab-permissions");
    expect(tab).toBeDisabled();
    expect(tab.getAttribute("title")).toContain("per project");
  });
});
