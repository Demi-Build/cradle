import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Node 22+ exposes a native (experimental) `localStorage` global that returns
// undefined unless the runtime is started with `--localstorage-file`. That
// shadows jsdom's own implementation in vitest's globalThis. Install a Map-
// backed Storage shim so tests always have a working localStorage regardless
// of Node version / runtime flags.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
