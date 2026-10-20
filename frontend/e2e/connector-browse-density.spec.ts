import { expect, test } from "./fixtures/connector-density-fixture";

// 目录弹窗的三个分类页签（应用 / 自定义 API / 自定义 MCP）都必须是单行列表行：
// 28px 图标砖 + 名称 + 单行截断描述 + 行尾动作位（DESIGN §7.3）。
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 768, height: 900 },
  { width: 375, height: 844 },
];

async function openBrowse(page: import("@playwright/test").Page) {
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-browse-toggle]").click();
  const modal = page.locator("[data-connector-browse-modal]");
  await expect(modal).toBeVisible();
  return modal;
}

async function rows(modal: import("@playwright/test").Locator) {
  return modal.locator("[data-connector-browse-grid] [data-connector-card]").evaluateAll(nodes => nodes.map(node => {
    const rect = (selector: string) => {
      const box = node.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { top: box.top, height: box.height, centerY: box.top + box.height / 2, width: box.width };
    };
    const row = node.getBoundingClientRect();
    const title = rect(".connector-card-title");
    const purpose = rect(".connector-card-purpose");
    const side = rect(".connector-card-side");
    return {
      label: node.querySelector(".connector-card-title")?.textContent?.trim() || "",
      rowHeight: row.height,
      rowOverflow: node.scrollWidth - node.clientWidth,
      titleHeight: title.height,
      titleCenterY: title.centerY,
      purposeCenterY: purpose.centerY,
      purposeWidth: purpose.width,
      sideCenterY: side.centerY,
      purposeTitle: node.querySelector<HTMLElement>(".connector-card-purpose")?.getAttribute("title") || "",
      purposeText: node.querySelector(".connector-card-purpose")?.textContent?.trim() || "",
    };
  }));
}

for (const { width, height } of VIEWPORTS) {
  test(`browse catalog rows stay on one line at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const modal = await openBrowse(page);
    const measured = await rows(modal);
    expect(measured.length).toBeGreaterThan(0);
    for (const row of measured) {
      // 单行：名称行与描述同处一行，行高就是列表行高 36px。
      expect(row.rowHeight, JSON.stringify(row)).toBe(36);
      expect(Math.abs(row.titleCenterY - row.purposeCenterY), JSON.stringify(row)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.sideCenterY - row.purposeCenterY), JSON.stringify(row)).toBeLessThanOrEqual(1);
      // 名称行只有一行（20px 行高），描述截断但可读全文。
      expect(row.titleHeight, JSON.stringify(row)).toBeLessThanOrEqual(20.5);
      expect(row.purposeWidth).toBeGreaterThan(0);
      expect(row.purposeTitle).toBe(row.purposeText);
      expect(row.rowOverflow).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`browse-app-${width}x${height}.png`), fullPage: true });
  });
}

test("custom MCP and custom API tabs keep the same single-line row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const modal = await openBrowse(page);
  for (const [tab, label] of [["custom_mcp", "新建自定义 MCP"], ["custom_api", "新建自定义 HTTP API"]] as const) {
    await modal.locator(`[data-connector-tab="${tab}"]`).click();
    const card = modal.locator("[data-connector-card-new]");
    await expect(card).toBeVisible();
    await expect(card).toContainText(label);
    const measurement = await card.evaluate(node => {
      const box = (selector: string) => node.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const title = box(".connector-card-title");
      const purpose = box(".connector-card-purpose");
      return { rowHeight: node.getBoundingClientRect().height, titleCenterY: title.top + title.height / 2, purposeCenterY: purpose.top + purpose.height / 2, overflow: node.scrollWidth - node.clientWidth };
    });
    expect(measurement.rowHeight).toBe(36);
    expect(Math.abs(measurement.titleCenterY - measurement.purposeCenterY)).toBeLessThanOrEqual(1);
    expect(measurement.overflow).toBeLessThanOrEqual(1);
    await modal.screenshot({ path: test.info().outputPath(`browse-${tab}.png`) });
  }
});
