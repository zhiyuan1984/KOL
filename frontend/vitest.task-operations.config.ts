import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "src/tasks/TaskOperationsReport.test.tsx",
      "src/tasks/taskQuery.test.ts",
      "src/tasks/taskCenterModel.test.ts",
      "src/tasks/TaskExpandedDetails.test.tsx",
      "src/tasks/taskDetailNavigation.test.ts",
    ],
    fileParallelism: false,
  },
});
