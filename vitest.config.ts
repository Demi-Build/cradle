import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // jsdom 29+ refuses to expose localStorage for opaque origins (default
    // about:blank), which breaks every test that touches localStorage.
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/main.tsx", "src/test/**"],
    },
  },
});
