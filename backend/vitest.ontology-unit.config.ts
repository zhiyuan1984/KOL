import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/ontology.test.ts'],environment:'node'}});
