import { defineConfig } from 'vitest/config';
/** Isolated contract tests: no live DB, SQLite setup, migrations or external writes. */
export default defineConfig({ test: {
  environment: 'node', setupFiles: [], fileParallelism: false,
  include: ['tests/knowledge-taxonomy-mutations.test.ts', 'tests/knowledge-workspace-query.test.ts', 'tests/knowledge-taxonomy.postgres.integration.test.ts'],
} });
