import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useStore } from "./store";

function resetStore() {
  localStorage.clear();
  useStore.setState({
    worldPath: "",
    world: null,
    worldStoryTitle: null,
    worldBeats: [],
    entities: {},
    entityCache: {},
    saving: {},
    saveError: {},
    selection: { kind: "none" },
    error: null,
    lightbox: null,
    recents: [],
    route: "start",
    drawerOpen: false,
    loading: false,
  });
  invokeMock.mockReset();
}

describe("store: sync actions", () => {
  beforeEach(resetStore);

  it("setWorld with a value selects the bible and resets entities", () => {
    useStore.setState({ entities: { npcs: [] }, selection: { kind: "none" } });
    useStore.getState().setWorld({
      path: "/w",
      name: "w",
      entity_counts: [{ type_id: "npcs", count: 0 }],
    });
    const s = useStore.getState();
    expect(s.selection).toEqual({ kind: "bible" });
    expect(s.entities).toEqual({});
  });

  it("setWorld with null resets to no selection", () => {
    useStore.setState({ selection: { kind: "bible" } });
    useStore.getState().setWorld(null);
    expect(useStore.getState().selection).toEqual({ kind: "none" });
  });

  it("setEntities merges, it does not overwrite", () => {
    const { setEntities } = useStore.getState();
    setEntities("npcs", [{ type_id: "npcs", id: "a", name: null }]);
    setEntities("rooms", [{ type_id: "rooms", id: "r1", name: null }]);
    const ents = useStore.getState().entities;
    expect(Object.keys(ents).sort()).toEqual(["npcs", "rooms"]);
  });

  it("openLightbox / closeLightbox toggle the image", () => {
    const { openLightbox, closeLightbox } = useStore.getState();
    openLightbox({ src: "/x.png", alt: "x" });
    expect(useStore.getState().lightbox).toEqual({ src: "/x.png", alt: "x" });
    closeLightbox();
    expect(useStore.getState().lightbox).toBeNull();
  });

  it("setTheme persists to localStorage", () => {
    useStore.getState().setTheme("light");
    expect(localStorage.getItem("cradle.theme.v1")).toBe("light");
    expect(useStore.getState().theme).toBe("light");
  });

  it("closeWorld clears world-related state and returns to start route", () => {
    useStore.setState({
      world: { path: "/w", name: "w", entity_counts: [] },
      worldPath: "/w",
      worldStoryTitle: "t",
      worldBeats: [{ summary: "b" }],
      entities: { npcs: [] },
      selection: { kind: "bible" },
      route: "recents",
    });
    useStore.getState().closeWorld();
    const s = useStore.getState();
    expect(s.world).toBeNull();
    expect(s.worldPath).toBe("");
    expect(s.worldStoryTitle).toBeNull();
    expect(s.worldBeats).toEqual([]);
    expect(s.entities).toEqual({});
    expect(s.selection).toEqual({ kind: "none" });
    expect(s.route).toBe("start");
  });
});

describe("store: recents actions", () => {
  beforeEach(resetStore);

  it("togglePin toggles the pinned flag for a matching recent", () => {
    useStore.setState({
      recents: [{ path: "/a", name: "a", lastOpenedAt: 1 }],
    });
    useStore.getState().togglePin("/a");
    expect(useStore.getState().recents[0].pinned).toBe(true);
  });

  it("removeRecent drops the entry", () => {
    useStore.setState({
      recents: [
        { path: "/a", name: "a", lastOpenedAt: 1 },
        { path: "/b", name: "b", lastOpenedAt: 2 },
      ],
    });
    useStore.getState().removeRecent("/a");
    expect(useStore.getState().recents.map((r) => r.path)).toEqual(["/b"]);
  });
});

describe("store: loadWorldByPath", () => {
  beforeEach(resetStore);

  it("populates world, story title, beats, and recents on success", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "load_world":
          return Promise.resolve({
            path: "/canonical/world",
            name: "canonical",
            entity_counts: [
              { type_id: "rooms", count: 5 },
              { type_id: "npcs", count: 3 },
              { type_id: "events", count: 2 },
              { type_id: "quests", count: 1 },
            ],
          });
        case "get_world_bible":
          return Promise.resolve({
            story: {
              title: "Saga of X",
              synopsis: "A synopsis",
              beats: [{ summary: "beat one" }],
            },
          });
        case "read_world_json":
          return Promise.resolve({
            seed: 42,
            environment_names: ["village"],
            num_rooms: 5,
            npc_count: 3,
            event_count: 2,
            quest_count: 1,
            start_portrait: "hero.png",
            validation_report: { status: "validated" },
            generation_stats: { total_cost_usd: 1.23 },
          });
        default:
          return Promise.reject(new Error(`unexpected cmd ${cmd}`));
      }
    });

    await useStore.getState().loadWorldByPath("/user/selected");

    const s = useStore.getState();
    expect(s.worldPath).toBe("/canonical/world");
    expect(s.world?.name).toBe("canonical");
    expect(s.worldStoryTitle).toBe("Saga of X");
    expect(s.worldBeats).toEqual([{ summary: "beat one" }]);
    expect(s.selection).toEqual({ kind: "bible" });
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();

    expect(s.recents).toHaveLength(1);
    expect(s.recents[0]).toMatchObject({
      path: "/canonical/world",
      storyTitle: "Saga of X",
      synopsis: "A synopsis",
      seed: 42,
      rooms: 5,
      npcs: 3,
      events: 2,
      quests: 1,
      cost: 1.23,
      validation: "validated",
    });
  });

  it("falls back to entity_counts when manifest fields are missing", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "load_world":
          return Promise.resolve({
            path: "/w",
            name: "w",
            entity_counts: [
              { type_id: "rooms", count: 9 },
              { type_id: "npcs", count: 8 },
              { type_id: "events", count: 7 },
              { type_id: "quests", count: 6 },
            ],
          });
        case "get_world_bible":
          return Promise.reject(new Error("no bible"));
        case "read_world_json":
          return Promise.reject(new Error("no manifest"));
        default:
          return Promise.reject(new Error(`unexpected ${cmd}`));
      }
    });

    await useStore.getState().loadWorldByPath("/w");
    const r = useStore.getState().recents[0];
    expect(r).toMatchObject({ rooms: 9, npcs: 8, events: 7, quests: 6 });
  });

  // validationFrom branch coverage — exercised through the only call site,
  // which is loadWorldByPath's manifest.validation_report path.
  for (const [report, expected] of [
    [{ status: "warn" }, "warn"],
    [{ status: "failed" }, "failed"],
    [{ status: "error in pipeline" }, "failed"],
    ["passed checks", "validated"],
    ["validated", "validated"],
    [null, undefined],
    [undefined, undefined],
    [{ status: "unknown" }, undefined],
  ] as const) {
    it(`maps validation_report ${JSON.stringify(report)} → ${String(expected)}`, async () => {
      invokeMock.mockImplementation((cmd: string) => {
        switch (cmd) {
          case "load_world":
            return Promise.resolve({ path: "/w", name: "w", entity_counts: [] });
          case "get_world_bible":
            return Promise.resolve({ story: {} });
          case "read_world_json":
            return Promise.resolve({ validation_report: report });
          default:
            return Promise.reject(new Error(cmd));
        }
      });
      await useStore.getState().loadWorldByPath("/w");
      expect(useStore.getState().recents[0].validation).toBe(expected);
    });
  }

  it("sets error and re-throws when load_world fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "load_world") return Promise.reject(new Error("boom"));
      return Promise.resolve(null);
    });

    await expect(useStore.getState().loadWorldByPath("/bad")).rejects.toThrow("boom");
    const s = useStore.getState();
    expect(s.world).toBeNull();
    expect(s.error).toContain("boom");
    expect(s.loading).toBe(false);
  });
});

describe("store: enrichRecent", () => {
  beforeEach(resetStore);

  it("preserves existing lastOpenedAt and pinned state", async () => {
    useStore.setState({
      recents: [{ path: "/w", name: "stale", lastOpenedAt: 1234, pinned: true }],
    });
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "load_world":
          return Promise.resolve({
            path: "/w",
            name: "fresh",
            entity_counts: [],
          });
        case "get_world_bible":
          return Promise.resolve({ story: { title: "T" } });
        case "read_world_json":
          return Promise.resolve({});
        default:
          return Promise.reject(new Error(cmd));
      }
    });

    await useStore.getState().enrichRecent("/w");
    const r = useStore.getState().recents[0];
    expect(r.lastOpenedAt).toBe(1234);
    expect(r.pinned).toBe(true);
    expect(r.storyTitle).toBe("T");
  });

  it("silently ignores failure (stale entry preserved)", async () => {
    const original = { path: "/w", name: "original", lastOpenedAt: 1 };
    useStore.setState({ recents: [original] });
    invokeMock.mockImplementation(() => Promise.reject(new Error("down")));

    await useStore.getState().enrichRecent("/w");
    expect(useStore.getState().recents).toEqual([original]);
  });
});

describe("store: entity cache", () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ worldPath: "/w" });
  });

  it("loadEntityIntoCache fetches once and reuses cached drafts on subsequent calls", async () => {
    invokeMock.mockResolvedValueOnce({ id: "1", name: "Alice" });

    const first = await useStore.getState().loadEntityIntoCache("npcs", "1");
    const second = await useStore.getState().loadEntityIntoCache("npcs", "1");
    expect(first).toEqual({ id: "1", name: "Alice" });
    expect(second).toBe(first);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("setEntityDraft marks the entry dirty and updates the draft", async () => {
    invokeMock.mockResolvedValueOnce({ name: "Alice" });
    await useStore.getState().loadEntityIntoCache("npcs", "1");

    useStore.getState().setEntityDraft("npcs", "1", { name: "Alicia" });

    const entry = useStore.getState().entityCache["npcs:1"];
    expect(entry.dirty).toBe(true);
    expect(entry.draft).toEqual({ name: "Alicia" });
    expect(entry.pristine).toEqual({ name: "Alice" });
    expect(useStore.getState().isEntityDirty("npcs", "1")).toBe(true);
  });

  it("setEntityDraft is a no-op when the cache entry is absent", () => {
    useStore.getState().setEntityDraft("npcs", "ghost", { x: 1 });
    expect(useStore.getState().entityCache["npcs:ghost"]).toBeUndefined();
  });

  it("revertEntity restores pristine and clears dirty + saveError", async () => {
    invokeMock.mockResolvedValueOnce({ name: "Alice" });
    await useStore.getState().loadEntityIntoCache("npcs", "1");
    useStore.getState().setEntityDraft("npcs", "1", { name: "Alicia" });
    useStore.setState((s) => ({ saveError: { ...s.saveError, "npcs:1": "boom" } }));

    useStore.getState().revertEntity("npcs", "1");

    const entry = useStore.getState().entityCache["npcs:1"];
    expect(entry.draft).toEqual({ name: "Alice" });
    expect(entry.dirty).toBe(false);
    expect(useStore.getState().saveError["npcs:1"]).toBeUndefined();
  });

  it("saveEntity calls api.updateEntity and promotes draft to pristine on success", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_entity") return Promise.resolve({ name: "Alice" });
      if (cmd === "update_entity") return Promise.resolve();
      return Promise.reject(new Error(cmd));
    });

    await useStore.getState().loadEntityIntoCache("npcs", "1");
    useStore.getState().setEntityDraft("npcs", "1", { name: "Alicia" });
    await useStore.getState().saveEntity("npcs", "1");

    expect(invokeMock).toHaveBeenCalledWith("update_entity", {
      path: "/w",
      typeId: "npcs",
      id: "1",
      data: { name: "Alicia" },
    });
    const entry = useStore.getState().entityCache["npcs:1"];
    expect(entry.pristine).toEqual({ name: "Alicia" });
    expect(entry.dirty).toBe(false);
    expect(useStore.getState().saving["npcs:1"]).toBeUndefined();
    expect(useStore.getState().saveError["npcs:1"]).toBeUndefined();
  });

  it("saveEntity stores saveError and keeps draft dirty on backend failure", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_entity") return Promise.resolve({ name: "Alice" });
      if (cmd === "update_entity") return Promise.reject(new Error("write failed"));
      return Promise.reject(new Error(cmd));
    });

    await useStore.getState().loadEntityIntoCache("npcs", "1");
    useStore.getState().setEntityDraft("npcs", "1", { name: "Alicia" });
    await expect(useStore.getState().saveEntity("npcs", "1")).rejects.toThrow("write failed");

    const entry = useStore.getState().entityCache["npcs:1"];
    expect(entry.dirty).toBe(true);
    expect(entry.pristine).toEqual({ name: "Alice" });
    expect(useStore.getState().saveError["npcs:1"]).toContain("write failed");
    expect(useStore.getState().saving["npcs:1"]).toBeUndefined();
  });

  it("setWorld and closeWorld reset the entity cache and save state", async () => {
    invokeMock.mockResolvedValueOnce({ name: "Alice" });
    await useStore.getState().loadEntityIntoCache("npcs", "1");
    useStore.setState((s) => ({
      saving: { ...s.saving, "npcs:1": true },
      saveError: { ...s.saveError, "npcs:1": "stale" },
    }));

    useStore.getState().closeWorld();
    expect(useStore.getState().entityCache).toEqual({});
    expect(useStore.getState().saving).toEqual({});
    expect(useStore.getState().saveError).toEqual({});
  });
});
