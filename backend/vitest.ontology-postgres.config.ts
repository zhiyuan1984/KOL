import { defineConfig } from 'vitest/config';
/** Native PostgreSQL only; do not load the legacy test database setup. */
export default defineConfig({
  cacheDir:'.vite-cache-ontology-postgres',
  test:{include:['tests/ontology.postgres.test.ts'],environment:'node',fileParallelism:false,
    sequence:{concurrent:false},testTimeout:30_000,hookTimeout:30_000},
});
