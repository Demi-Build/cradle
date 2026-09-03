import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no ResizeObserver; the level canvas observes its box to size the
// viewport. A no-op observer lets the editor mount under test — sizing is
// not what these tests assert.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
