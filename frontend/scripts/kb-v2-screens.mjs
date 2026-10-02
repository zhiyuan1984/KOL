/* 知识库 IA v2 · P1.9 全断点截图脚本（双端 × 5 视口 × 浅深 + 关键弹窗）。
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

const VIEWPORTS = [
  [1440, 900, "1440"],
  [1280, 600, "1280x600"],
  [1100, 800, "1100"],
  [860, 700, "860"],
  [390, 844, "390"],
];

const errors = [];
const summary = {};

const api = await request.newContext({ baseURL: base });
let res = await api.post("/api/auth/login", { data: { username: "sriphy", email: "sriphy", password: "123456789" } });
if (!res.ok()) res = await api.post("/api/login", { data: { username: "sriphy", password: "123456789" } });
if (!res.ok()) {
  console.error("login failed:", res.status());
  process.exit(1);
}
const state = await api.storageState();
const browser = await chromium.launch();

async function withPage(width, height, colorScheme, fn) {
  const context = await browser.newContext({ storageState: state, viewport: { width, height }, colorScheme });
  const page = await context.newPage();
  const scope = `${width}x${height}/${colorScheme}`;
  page.on("pageerror", (error) => errors.push(`[${scope}] pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401")) errors.push(`[${scope}] console: ${message.text().slice(0, 200)}`);
  });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function metrics(page, scope) {
  summary[scope] = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    primaries: [...document.querySelectorAll(".btn.work")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length,
  }));
}

// ── 员工端 /kb ───────────────────────────────────────────────────────
for (const [width, height, tag] of VIEWPORTS) {
  await withPage(width, height, "light", async (page) => {
    await page.goto(base + "/kb", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-kb-page="mine"]');
    await page.waitForSelector("[data-knowledge]", { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `employee-${tag}.png`) });
    if (tag === "1440") summary.employeeRecords = await page.locator("[data-knowledge]").count();
    await metrics(page, `employee-${tag}-light`);
  });
}
await withPage(1440, 900, "dark", async (page) => {
  await page.goto(base + "/kb", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-knowledge]", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "employee-1440-dark.png") });
});
await withPage(390, 844, "dark", async (page) => {
  await page.goto(base + "/kb", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-knowledge]", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "employee-390-dark.png") });
});

// ── 管理端 /admin/knowledge ─────────────────────────────────────────
for (const [width, height, tag] of VIEWPORTS) {
  await withPage(width, height, "light", async (page) => {
    await page.goto(base + "/admin/knowledge", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-admin-kb-v2="home"]');
    await page.waitForSelector("[data-kbv-record]", { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `admin-${tag}.png`) });
    if (tag === "1440") summary.adminRecords = await page.locator("[data-kbv-record]").count();
    await metrics(page, `admin-${tag}-light`);

    if (tag === "1440") {
      await page.locator("[data-kbv-category]").click();
      await page.waitForSelector("[data-kbv-category-dialog][open]");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, "admin-1440-category.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);

      await page.locator("[data-kbv-upload]").click();
      await page.waitForSelector("[data-kbv-upload-dialog][open]");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, "admin-1440-upload.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);

      await page.locator('[data-kbv-detail-tab="props"]').click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, "admin-1440-props.png") });
      await page.locator('[data-kbv-detail-tab="content"]').click();
      await page.waitForTimeout(200);
    }
  });
}
await withPage(1440, 900, "dark", async (page) => {
  await page.goto(base + "/admin/knowledge", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-kbv-record]", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "admin-1440-dark.png") });
});
await withPage(390, 844, "dark", async (page) => {
  await page.goto(base + "/admin/knowledge", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-kbv-record]", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "admin-390-dark.png") });
});

console.log(JSON.stringify({ base, out, summary, errors }, null, 2));
await browser.close();
