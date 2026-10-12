import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["src/tasks/*.test.ts", "src/tasks/*.test.tsx"], fileParallelism: false },
});
