import { expect, test, type Page } from "@playwright/test";

// Presentation-only fixtures: no real MCP calls or governance writes.
const connectors = [
  { id: "claw", label: "MediaCrawler MCP", purpose: "创作者采集、检索与画像数据", kind: "app", protocol: "mcp", enabled: 1, status: "verified", approved_tool_count: 8, last_verified_at: "2026-10-07T06:59:32.113Z", updated_at: "2026-10-07T07:36:00.000Z" },
  { id: "starrykol", label: "Starry KOL MCP", purpose: "红人库、负责人、品牌邮箱与合作往来事实", kind: "app", protocol: "mcp", enabled: 1, status: "verified", approved_tool_count: 62, last_verified_at: "2026-10-09T02:05:57.628Z" },
];

async function stubConnectors(page: Page) {
  await page.route("**/api/admin/connectors", route => route.fulfill({ json: connectors }));
}

for (const width of [1280, 1440, 1920]) {
  test(`compact connector list keeps 36px rows, 20px icons and aligned columns at ${width}px`, async ({ page }) => {
    await stubConnectors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/connectors");
    const list = page.locator("[data-admin-connectors-table]");
    await expect(list.locator("[data-connector-card]")).toHaveCount(2);
    await expect(list).toHaveAttribute("role", "list");
    await expect(list.locator(".connector-card-meta, .connector-dense-tag, .connector-added")).toHaveCount(0);
    await expect(list).not.toContainText("未登记凭据");
    await expect(list).not.toContainText("已审阅");
    const rows = await list.evaluate(root => [...root.querySelectorAll<HTMLElement>("[data-connector-card]")].map(row => {
      const rect = (selector: string) => {
        const r = row.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, right: r.right, centerY: r.top + r.height / 2, width: r.width, height: r.height };
      };
      const status = row.querySelector("[data-connector-status-entry]")!;
      const css = getComputedStyle(row);
      return { height: row.getBoundingClientRect().height, radius: css.borderRadius, borderTop: css.borderTopWidth, icon: rect("[data-connector-mark]"), title: rect(".connector-list-title"), status: rect("[data-connector-status-entry]"), purpose: rect(".connector-list-purpose"), actions: rect(".connector-list-actions"), statusBorder: getComputedStyle(status).borderWidth, statusShadow: getComputedStyle(status).boxShadow, statusBg: getComputedStyle(status).backgroundColor, overflow: row.scrollWidth - row.clientWidth };
    }));
    for (const row of rows) {
      expect(row.height).toBe(36);
      expect(row.icon.width).toBe(20);
      expect(row.icon.height).toBe(20);
      expect(row.radius).toBe("0px");
      expect(row.borderTop).toBe("0px");
      expect(row.statusBorder).toBe("0px");
      expect(row.statusShadow).toBe("none");
      expect(row.statusBg).toBe("rgba(0, 0, 0, 0)");
      expect(row.overflow).toBeLessThanOrEqual(1);
      expect(Math.abs(row.title.centerY - row.icon.centerY)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.status.centerY - row.icon.centerY)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.purpose.centerY - row.icon.centerY)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.actions.centerY - row.icon.centerY)).toBeLessThanOrEqual(1);
    }
    expect(rows[0].title.left).toBe(rows[1].title.left);
    expect(rows[0].status.left).toBe(rows[1].status.left);
    expect(rows[0].purpose.left).toBe(rows[1].purpose.left);
    expect(rows[0].actions.right).toBe(rows[1].actions.right);
    await expect(list.locator("[data-connector-status-entry]")).toHaveText(["已启用", "已启用"]);
    await page.screenshot({ path: test.info().outputPath(`connector-list-${width}.png`), fullPage: true });
  });
}

test("compact connector list keeps long purposes readable via title without pushing actions away", async ({ page }) => {
  const purpose = "这是一个用于测试单行用途省略和完整说明可达性的很长描述，".repeat(12);
  await page.route("**/api/admin/connectors", route => route.fulfill({ json: [{ ...connectors[0], label: "Very long custom connector name ".repeat(8), purpose, enabled: 0 }] }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/connectors");
  const row = page.locator("[data-admin-connectors-table] [data-connector-card]");
  await expect(row.locator(".connector-list-purpose")).toHaveAttribute("title", purpose);
  await expect(row.locator("[data-connector-tools-entry]")).toBeInViewport();
  await expect(row.locator("[data-connector-detail-entry]")).toBeInViewport();
  expect(await row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect((await row.boundingBox())?.height).toBe(36);
});

test("compact connector list on mobile has no overflow and keeps touch actions reachable", async ({ page }) => {
  await stubConnectors(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/admin/connectors");
  const list = page.locator("[data-admin-connectors-table]");
  await expect(list.locator("[data-connector-card]")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  for (const selector of ["[data-connector-status-entry]", "[data-connector-config-entry]", "[data-connector-tools-entry]", "[data-connector-detail-entry]"]) {
    const action = list.locator(selector).first();
    await expect(action).toBeInViewport();
    const box = await action.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: test.info().outputPath("connector-list-375.png"), fullPage: true });
});

test("compact connector list preserves search, configuration, tool drawer, keyboard focus and detail navigation", async ({ page }) => {
  await stubConnectors(page);
  await page.route("**/api/admin/runtime/connectors/*/discovery", route => route.fulfill({ json: { tools: [], authorization: "Discovery is not a grant." } }));
  await page.route("**/api/admin/runtime/connectors/*/policies", route => route.fulfill({ json: [] }));
  await page.goto("/admin/connectors");
  const list = page.locator("[data-admin-connectors-table]");
  const search = page.locator("[data-connector-search]");
  await search.fill("Starry");
  await expect(list.locator("[data-connector-card]")).toHaveCount(1);
  await search.fill("");
  await expect(list.locator("[data-connector-card]")).toHaveCount(2);
  const row = list.locator('[data-connector="claw"]');
  for (const selector of ["[data-connector-status-entry]", "[data-connector-config-entry]", ".connector-card-link"]) {
    const entry = row.locator(selector);
    await entry.click();
    await expect(page.locator("[data-connector-panel='connector-config']")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-connector-panel='connector-config']")).toHaveCount(0);
    await expect(entry).toBeFocused();
  }
  const tools = row.locator("[data-connector-tools-entry]");
  await tools.click();
  await expect(page.locator("[data-connector-tools-drawer]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tools).toBeFocused();
  await tools.focus();
  await page.keyboard.press("Tab");
  await expect(row.locator("[data-connector-detail-entry]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/connectors\/claw$/);
  await expect(page.locator("[data-admin-page='connector-detail']")).toBeVisible();
});
