import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['tests/performance-*.test.ts','../frontend/src/layout/sidebarNav.test.ts'],fileParallelism:false,testTimeout:30000,hookTimeout:30000}});
