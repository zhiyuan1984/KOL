import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/home/kolSurfaceApi.test.ts", "src/components/kol/KolSharedPresentation.test.tsx", "src/home/kolContract.test.ts", "src/home/poolView.test.ts", "src/home/poolScoreEvidence.test.ts", "src/home/discoveryLeadRow.test.ts"],
    fileParallelism: false,
  },
});
