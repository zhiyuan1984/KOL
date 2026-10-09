import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/components/kol/KolSharedPresentation.test.tsx", "src/home/kolContract.test.ts", "src/home/poolView.test.ts"],
    fileParallelism: false,
  },
});
