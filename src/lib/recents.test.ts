import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRecents,
  saveRecents,
  upsertRecent,
  removeRecent,
  togglePin,
  envKeyFor,
  envChipLabel,
  relativeTimeFrom,
  type RecentProject,
} from "./recents";

function mkRecent(over: Partial<RecentProject> = {}): RecentProject {
  return {
    path: "/tmp/world",
    name: "world",
    lastOpenedAt: 1_000_000,
    ...over,
  };
}

describe("loadRecents / saveRecents", () => {
  beforeEach(() => localStorage.clear());

  it("returns [] when nothing is stored", () => {
    expect(loadRecents()).toEqual([]);
  });

  it("returns [] on malformed JSON", () => {
    localStorage.setItem("cradle.recents.v1", "{not json");
    expect(loadRecents()).toEqual([]);
  });

  it("returns [] when the stored value isn't an array", () => {
    localStorage.setItem("cradle.recents.v1", JSON.stringify({ foo: 1 }));
    expect(loadRecents()).toEqual([]);
  });

  it("round-trips through save + load", () => {
    const recents = [mkRecent({ path: "/a" }), mkRecent({ path: "/b" })];
    saveRecents(recents);
    expect(loadRecents()).toEqual(recents);
  });

  it("keeps world_kind (canon's pack_type, open data) and tolerates its absence", () => {
    // Entries saved before P0-3 carry no kind; RecentTile falls back to its
    // count-field sniff for those and reads the kind verbatim otherwise.
    const recents = [
      mkRecent({ path: "/a", world_kind: "platformer", levels: 2 }),
      mkRecent({ path: "/b", world_kind: "shooter" }),
      mkRecent({ path: "/c", rooms: 3 }),
    ];
    saveRecents(recents);
    const loaded = loadRecents();
    expect(loaded.map((r) => r.world_kind)).toEqual(["platformer", "shooter", undefined]);
  });
});

describe("upsertRecent", () => {
  beforeEach(() => localStorage.clear());

  it("adds a new entry at the front", () => {
    const existing = [mkRecent({ path: "/a" })];
    const next = upsertRecent(existing, mkRecent({ path: "/b" }));
    expect(next.map((r) => r.path)).toEqual(["/b", "/a"]);
  });

  it("replaces an entry with the same path and moves it to the front", () => {
    const existing = [mkRecent({ path: "/a", name: "old" }), mkRecent({ path: "/b" })];
    const next = upsertRecent(existing, mkRecent({ path: "/a", name: "new" }));
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ path: "/a", name: "new" });
    expect(next[1].path).toBe("/b");
  });

  it("caps the list at 32 entries", () => {
    const existing = Array.from({ length: 32 }, (_, i) => mkRecent({ path: `/p${i}` }));
    const next = upsertRecent(existing, mkRecent({ path: "/new" }));
    expect(next).toHaveLength(32);
    expect(next[0].path).toBe("/new");
    expect(next.find((r) => r.path === "/p31")).toBeUndefined();
  });

  it("persists to localStorage", () => {
    upsertRecent([], mkRecent({ path: "/a" }));
    expect(loadRecents()).toHaveLength(1);
  });
});

describe("removeRecent", () => {
  it("removes a matching entry and persists", () => {
    const existing = [mkRecent({ path: "/a" }), mkRecent({ path: "/b" })];
    const next = removeRecent(existing, "/a");
    expect(next.map((r) => r.path)).toEqual(["/b"]);
    expect(loadRecents().map((r) => r.path)).toEqual(["/b"]);
  });

  it("is a no-op when path isn't present", () => {
    const existing = [mkRecent({ path: "/a" })];
    expect(removeRecent(existing, "/missing")).toEqual(existing);
  });
});

describe("togglePin", () => {
  it("flips pinned on the matching entry", () => {
    const existing = [mkRecent({ path: "/a" }), mkRecent({ path: "/b", pinned: true })];
    const next = togglePin(existing, "/a");
    expect(next[0].pinned).toBe(true);
    expect(next[1].pinned).toBe(true);
  });

  it("unpins when already pinned", () => {
    const existing = [mkRecent({ path: "/a", pinned: true })];
    expect(togglePin(existing, "/a")[0].pinned).toBe(false);
  });
});

describe("envKeyFor", () => {
  it("maps known env types directly", () => {
    expect(envKeyFor("village")).toBe("whisperbrook");
    expect(envKeyFor("fortress")).toBe("shadowspire");
    expect(envKeyFor("temple")).toBe("nexus");
  });

  it("is case-insensitive", () => {
    expect(envKeyFor("VILLAGE")).toBe("whisperbrook");
  });

  it("falls back to substring match on env keys", () => {
    expect(envKeyFor("ancient-sanctum-ruins")).toBe("sanctum");
  });

  it("deterministically hashes the path when env is unknown", () => {
    const a = envKeyFor(undefined, "/some/path");
    const b = envKeyFor(undefined, "/some/path");
    expect(a).toBe(b);
  });

  it("defaults to whisperbrook when nothing is provided", () => {
    expect(envKeyFor()).toBe("whisperbrook");
  });
});

describe("envChipLabel", () => {
  it("returns 'world' when env is missing", () => {
    expect(envChipLabel()).toBe("world");
  });

  it("returns the lowercased env when no substring match applies", () => {
    expect(envChipLabel("Tundra")).toBe("tundra");
  });

  it("matches a known substring", () => {
    expect(envChipLabel("ancient-village-ruins")).toBe("village");
  });
});

describe("relativeTimeFrom", () => {
  const now = 1_700_000_000_000;

  it("returns 'just now' for sub-minute deltas", () => {
    expect(relativeTimeFrom(now - 30_000, now)).toBe("just now");
  });

  it("formats minutes", () => {
    expect(relativeTimeFrom(now - 5 * 60_000, now)).toBe("5m ago");
  });

  it("formats hours", () => {
    expect(relativeTimeFrom(now - 3 * 60 * 60_000, now)).toBe("3h ago");
  });

  it("returns 'yesterday' for the 24-48h band", () => {
    expect(relativeTimeFrom(now - 30 * 60 * 60_000, now)).toBe("yesterday");
  });

  it("formats days within the last week", () => {
    expect(relativeTimeFrom(now - 4 * 24 * 60 * 60_000, now)).toBe("4d ago");
  });

  it("falls back to a locale date for older entries", () => {
    const ms = now - 30 * 24 * 60 * 60_000;
    const out = relativeTimeFrom(ms, now);
    expect(out).not.toMatch(/ago|yesterday|now/);
    expect(out.length).toBeGreaterThan(0);
  });

  // Boundary cases — pin the comparison operators (`<` vs `<=`) so an
  // off-by-one regression in the threshold ladder is caught.
  it("treats just under 1m as 'just now'", () => {
    expect(relativeTimeFrom(now - (60_000 - 1), now)).toBe("just now");
  });

  it("treats exactly 1m as '1m ago'", () => {
    expect(relativeTimeFrom(now - 60_000, now)).toBe("1m ago");
  });

  it("treats exactly 1h as '1h ago'", () => {
    expect(relativeTimeFrom(now - 60 * 60_000, now)).toBe("1h ago");
  });

  it("treats exactly 24h as 'yesterday'", () => {
    expect(relativeTimeFrom(now - 24 * 60 * 60_000, now)).toBe("yesterday");
  });

  it("treats just under 48h as 'yesterday'", () => {
    expect(relativeTimeFrom(now - (48 * 60 * 60_000 - 1), now)).toBe("yesterday");
  });

  it("treats exactly 48h as '2d ago'", () => {
    expect(relativeTimeFrom(now - 48 * 60 * 60_000, now)).toBe("2d ago");
  });

  it("treats just under 7d as '6d ago'", () => {
    expect(relativeTimeFrom(now - (7 * 24 * 60 * 60_000 - 1), now)).toBe("6d ago");
  });

  it("treats exactly 7d as a locale date (no relative phrase)", () => {
    const out = relativeTimeFrom(now - 7 * 24 * 60 * 60_000, now);
    expect(out).not.toMatch(/ago|yesterday|now/);
  });
});
