import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/knowledge-browser-env.ts'],
    include: ['src/ontology/WecomOntologySourcePanel.test.tsx'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
