import { defineConfig } from 'vitest/config';

// No live business IO: shipped pack parsing, version mismatch and action gates.
export default defineConfig({ test: {
  include: ['tests/creator-query-dependencies.test.ts', 'tests/capability-contracts.test.ts',
    'tests/ontology-runtime-dependencies.test.ts', 'tests/task-intake-clarification.test.ts',
    'tests/task-recognize-selected.test.ts'],
  fileParallelism: false,
} });
