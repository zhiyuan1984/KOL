import { defineConfig, devices } from '@playwright/test';
/** Only the ontology UI is tested. API fixtures are explicit; no database claim. */
export default defineConfig({
  testDir:'./e2e',testMatch:'ontology.spec.ts',workers:1,retries:0,timeout:45_000,
  outputDir:'test-results/ontology',
  use:{baseURL:'http://127.0.0.1:4198',viewport:{width:1680,height:940},trace:'retain-on-failure',channel:process.env.PW_CHANNEL||'chrome'},
  webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4198 --strictPort',url:'http://127.0.0.1:4198',reuseExistingServer:false,timeout:60_000},
  projects:[{name:'ontology-chromium',use:{...devices['Desktop Chrome']}}],
});
