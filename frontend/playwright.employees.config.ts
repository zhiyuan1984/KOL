import { defineConfig } from "@playwright/test";
import presentation from "./playwright.presentation.config";

// 员工功能域全部 API 由 spec 隔离；仅验证呈现与前端受控交互，不认证生产集成。
export default defineConfig({
  ...presentation,
  testMatch: ["admin-employees.spec.ts"],
  timeout: 60000,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...presentation.use,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}),
  },
});
