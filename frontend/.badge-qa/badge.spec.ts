import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const evidence = process.env.APPROVAL_BADGE_EVIDENCE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "artifacts");
test.beforeAll(() => { fs.mkdirSync(evidence, { recursive: true }); });

async function fixture(page: Page) {
  const state = { count: 2, failed: false };
  const account = { id: "qa-reviewer", username: "qa-reviewer", name: "测试评审人", active: true, roles: ["employee"], available_modes: ["employee"], brands: [] };
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (pathname === "/api/health") data = {};
    else if (pathname === "/api/auth/status") data = { authenticated: true, account };
    else if (pathname === "/api/me") data = account;
    else if (pathname === "/api/preferences") data = { theme: "light", left_sidebar_collapsed: false };
    else if (pathname === "/api/approvals/v2/badge") {
      if (state.failed) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "计数暂时不可用" }) });
      data = { count: state.count, nativeCount: state.count, legacyCount: 0, unreadCount: 3, tenant: "qa-company" };
    } else if (pathname.includes("cron")) data = { jobs: [], alerts: {} };
    else if (pathname.includes("preferences")) data = {};
    else if (pathname.includes("mail")) data = { configured: false, unread: 0 };
    else if (pathname.includes("page")) data = { items: [], nextCursor: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  const preferencesReady = page.waitForResponse(response => new URL(response.url()).pathname === "/api/preferences" && response.request().method() === "GET");
  await page.goto("/tasks");
  await expect(page.locator('[data-nav="approvals"]')).toHaveAttribute("aria-label", "审批，2 条待处理");
  await preferencesReady;
  return state;
}
for (const width of [375, 768, 1280, 1920]) {
  test(`real employee sidebar badge ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 480 : 720 }, hasTouch: width === 375 });
    const page = await context.newPage();
    await fixture(page);
    const menu = page.getByRole("button", { name: "打开导航" });
    if (await menu.isVisible()) await menu.click();
    const nav = page.locator('[data-nav="approvals"]');
    await nav.evaluate(element => {
      const pane = element.closest<HTMLElement>(".sidebar-scroll");
      if (!pane) return;
      const row = element.getBoundingClientRect(), box = pane.getBoundingClientRect();
      if (row.bottom > box.bottom) pane.scrollTop += row.bottom - box.bottom;
    });
    await expect(nav).toBeVisible();
    await expect(nav.locator('[data-approval-count="2"]')).toBeVisible();
    const rect = await nav.boundingBox(); const badge = await nav.locator(".ant-badge-count").boundingBox();
    expect(rect).not.toBeNull(); expect(badge).not.toBeNull();
    expect(badge!.x + badge!.width).toBeLessThanOrEqual(rect!.x + rect!.width + 1);
    expect(badge!.y + badge!.height).toBeLessThanOrEqual(await page.locator(".sidebar-scroll").evaluate(element=>element.getBoundingClientRect().bottom)+1);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const contrast = await nav.locator(".ant-badge-count").evaluate(element => {
        const s = getComputedStyle(element);
        const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!;
        const luminance = (color: string) => {
          ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1);
          const rgb = ctx.getImageData(0,0,1,1).data;
          return [0,1,2].map(n=>rgb[n]/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,n)=>sum+v*[.2126,.7152,.0722][n],0);
        };
        const a = luminance(s.color), b = luminance(s.backgroundColor);
        return {ratio:(Math.max(a, b) + .05) / (Math.min(a, b) + .05),fg:s.color,bg:s.backgroundColor};
      });
      console.log({width,theme,...contrast});
      expect(contrast.ratio,JSON.stringify({width,theme,...contrast})).toBeGreaterThanOrEqual(4.5);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.locator(".sidebar").screenshot({ path: path.join(evidence, `sidebar-${width}.png`) });
    await context.close();
  });
}
test("collapsed badge remains visible and focus refreshes without reloading", async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  const nav = page.locator('[data-nav="approvals"]');
  await expect(nav.locator(".ant-badge-dot")).toBeVisible();
  await expect(nav).toHaveAttribute("title", "审批，2 条待处理");
  await page.locator(".sidebar").screenshot({ path: path.join(evidence, "sidebar-collapsed.png") });
  state.count = 3;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav).toHaveAttribute("aria-label", "审批，3 条待处理");
  state.failed = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav).toHaveAttribute("aria-label", "审批，3 条待处理；计数更新失败，显示上次结果");
  state.failed = false; state.count = 0;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav).toHaveAttribute("aria-label", "审批，暂无待处理");
  await expect(nav.locator(".approval-nav-badge")).toHaveCount(0);
});
