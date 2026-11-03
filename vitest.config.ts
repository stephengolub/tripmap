import { defineConfig } from "vitest/config";

// Root runs only the workspace packages; web/ has its own config until phase 08.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
