import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom is lighter than jsdom for hook tests. Scope it to tests
    // that actually need it via the environmentMatchGlobs fallback — pure
    // utils tests keep running in node.
    environment: "node",
    environmentMatchGlobs: [
      ["src/hooks/__tests__/**", "happy-dom"],
    ],
    setupFiles: ["./src/test/setup.js"],
    globals: false,
  },
});
