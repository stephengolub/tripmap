import { defineConfig } from "vitest/config";

// Root runs the core and cli tests; packages/web has its own jsdom config.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
