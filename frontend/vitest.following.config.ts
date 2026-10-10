import { defineConfig } from 'vitest/config';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', setupFiles: ['src/test/knowledge-browser-env.ts'],
    include: ['src/home/followingTimeout.test.tsx', 'src/home/kolSurfaceApi.test.ts'], fileParallelism: false, testTimeout: 15000 },
});
