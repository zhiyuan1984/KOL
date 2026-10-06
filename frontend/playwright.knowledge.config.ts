import { defineConfig, devices } from "@playwright/test";
// Browser contract tests use HTTP fixtures; PostgreSQL integration is tested separately.
export default defineConfig({
  testDir:"./e2e",testMatch:["admin-knowledge-presentation.spec.ts","knowledge-qa-context.spec.ts"],workers:1,retries:0,timeout:30000,
  use:{baseURL:"http://127.0.0.1:4179",viewport:{width:1440,height:900},trace:"retain-on-failure",...(process.env.PW_EXECUTABLE_PATH?{launchOptions:{executablePath:process.env.PW_EXECUTABLE_PATH}}:{})},
  webServer:{command:"npm run dev -- --port 4179",url:"http://127.0.0.1:4179",reuseExistingServer:false,timeout:60000},
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}],
});
