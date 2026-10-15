import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    setupFiles: ['src/test/knowledge-browser-env.ts'],
    include: [
      'src/composer/*.test.ts',
      'src/mail/*.test.ts',
      'src/timezoneLabel.test.ts',
      'src/tasks/TaskOperationsReport.test.tsx',
    ],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
