import { defineConfig } from "vitest/config";
export default defineConfig({ esbuild: { jsx: "automatic" }, test: { environment: "node", setupFiles: ["src/test/knowledge-browser-env.ts"], fileParallelism: false,
  include: ["src/knowledgeBusinessTaxonomy.test.ts", "src/employeeKnowledgeFacets.test.ts", "src/components/BusinessTaxonomyFilters.test.tsx", "src/admin/knowledge/KnowledgeBrowseFilters.test.tsx", "src/admin/knowledge/CatalogView.test.tsx"], testTimeout: 15000 } });
