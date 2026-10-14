import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run only source-level tests. Without this, Vitest also discovers
    // compiled copies of test files in dist/ and runs everything twice.
    include: ["tests/**/*.test.ts"],
  },
});
