/* 知识库 IA v2 P1 冒烟/截图脚本（先探针；P1.9 扩展为全断点×浅深截图）。
   用法：node scripts/kb-v2-screens.mjs
   前置：仓库根目录起 LINGONG_PORT=8899 E2E_SKIP_BUILD=1 node scripts/e2e-server.mjs */
import { chromium, request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.SCREEN_BASE || "http://127.0.0.1:8899";
const out = path.resolve(process.env.SCREEN_OUT || path.join(here, "..", "..", "artifacts", "knowledge-ia-v2", "p1"));
fs.mkdirSync(out, { recursive: true });

const api = await request.newContext({ baseURL: base });
let res = await api.post("/api/auth/login", {
  data: { username: "sriphy", email: "sriphy", password: "123456789" },
});
if (!res.ok()) {
  res = await api.post("/api/login", { data: { username: "sriphy", password: "123456789" } });
}
if (!res.ok()) {
  console.error("login failed:", res.status());
  process.exit(1);
}
const state = await api.storageState();

const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push("pageerror: " + String(error)));
page.on("response", (response) => {
  if (response.status() >= 400) errors.push(`http ${response.status()} ${response.url()}`);
});
page.on("console", (message) => {
  if (message.type() === "error") errors.push("console: " + message.text().slice(0, 300));
});

await page.goto(base + "/admin/knowledge", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-admin-kb-v2="home"]', { timeout: 20000 });
await page.waitForTimeout(900);

const records = await page.locator("[data-kbv-record]").count();
const views = await page.locator("[data-kbv-view]").count();
const countText = await page.locator("[data-kbv-count]").textContent().catch(() => null);
const overflow = await page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth,
  width: window.innerWidth,
}));
await page.screenshot({ path: path.join(out, "probe-admin-home.png") });

await page.locator("[data-kbv-category-button]").click();
await page.waitForSelector("[data-kbv-category-dialog][open]", { timeout: 5000 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, "probe-admin-category.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

await page.locator('[data-kbv-view="published"]').click();
await page.waitForTimeout(400);
const publishedCount = await page.locator("[data-kbv-record]").count();
await page.locator("[data-kbv-record]").first().click();
await page.waitForTimeout(400);
const railTabs = await page.locator("[data-kbv-detail-tab]").count();
const railTitle = await page.locator("[data-kbv-detail] h2").first().textContent().catch(() => null);
await page.screenshot({ path: path.join(out, "probe-admin-rail.png") });

await page.locator("[data-kbv-upload]").click();
await page.waitForSelector("[data-kbv-upload-dialog][open]", { timeout: 5000 });
await page.waitForTimeout(300);
const uploadSubmitDisabled = await page.locator("[data-kbv-upload-submit]").isDisabled();
await page.screenshot({ path: path.join(out, "probe-admin-upload.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

console.log(JSON.stringify({ base, records, views, countText, publishedCount, railTabs, railTitle, uploadSubmitDisabled, overflow, errors, out }, null, 2));
await browser.close();
