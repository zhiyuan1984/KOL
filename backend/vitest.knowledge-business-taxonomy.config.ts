import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/knowledge-business-taxonomy.test.ts'],
    isolate: true,
    globals: false,
  },
});
