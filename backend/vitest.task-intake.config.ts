import { defineConfig } from "vitest/config";

// Isolated HTTP contract tests: no database, auth bypass, or external writes.
export default defineConfig({ test: {
  include: ["tests/task-intake-clarification.test.ts", "tests/task-recognize-selected.test.ts"], fileParallelism: false,
} });
