import { defineConfig } from "vitest/config";
export default defineConfig({ esbuild: { jsx: "automatic" }, test: { environment: "node", include: ["src/tasks/TaskExpandedDetails.test.tsx", "src/tasks/taskDetailNavigation.test.ts", "src/tasks/taskCenterModel.test.ts", "src/tasks/taskDetailPresentation.test.ts"], fileParallelism: false } });
