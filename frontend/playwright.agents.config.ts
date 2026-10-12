import {defineConfig,devices} from '@playwright/test';
// HTTP fixtures exercise browser contracts; native PG boundaries are tested separately.
export default defineConfig({
 testDir:'./e2e',testMatch:['admin-agents.spec.ts','admin-employees.spec.ts','admin-knowledge-presentation.spec.ts'],workers:1,retries:0,timeout:60000,expect:{timeout:15000},
 use:{baseURL:'http://127.0.0.1:4182',viewport:{width:1440,height:900},trace:'retain-on-failure',...(process.env.PW_EXECUTABLE_PATH?{launchOptions:{executablePath:process.env.PW_EXECUTABLE_PATH}}:{})},
 webServer:{command:'npm run preview -- --port 4182',url:'http://127.0.0.1:4182',reuseExistingServer:false,timeout:120000},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
});
