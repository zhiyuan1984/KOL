import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type TypeMetrics = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
};

async function typeOf(page: Page, selector: string): Promise<TypeMetrics> {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontFamily: cs.fontFamily,
      fontSize: Number.parseFloat(cs.fontSize),
      fontWeight: Number.parseFloat(cs.fontWeight),
      color: cs.color,
    };
  });
}

async function collectShellMetrics(page: Page) {
  const sidebar = page.locator(".sidebar");
  const workbench = page.locator(".workbench");
  const layout = await page.evaluate(() => {
    const rail = document.querySelector(".sidebar");
    const shell = document.querySelector(".workbench");
    if (!rail || !shell) throw new Error("missing shell");
    const grid = getComputedStyle(shell).gridTemplateColumns;
    return {
      tokenLeftWidth: getComputedStyle(document.documentElement).getPropertyValue("--left-width").trim(),
      workbenchGrid: grid,
      workbenchFirstCol: grid.split(/\s+/)[0],
      sidebarWidth: getComputedStyle(rail).width,
      sidebarMinWidth: getComputedStyle(rail).minWidth,
      sidebarMaxWidth: getComputedStyle(rail).maxWidth,
      sidebarRect: rail.getBoundingClientRect().width,
      html: {
        fontFamily: getComputedStyle(document.documentElement).fontFamily,
        fontSize: getComputedStyle(document.documentElement).fontSize,
        fontWeight: getComputedStyle(document.documentElement).fontWeight,
        color: getComputedStyle(document.documentElement).color,
      },
      body: {
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: getComputedStyle(document.body).fontSize,
        fontWeight: getComputedStyle(document.body).fontWeight,
        color: getComputedStyle(document.body).color,
      },
    };
  });
  return {
    ...layout,
    homeTitle: await typeOf(page, "[data-home-title], [data-home] h1"),
    navItem: await typeOf(page, '.nav-link[data-nav="running"]'),
    navActive: await typeOf(page, ".nav-link.active"),
    username: await typeOf(page, "[data-account-name]"),
  };
}

test("desktop employee shell computed 264 rail and compact type", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("[data-home] h1")).toBeVisible();

  const beforeLifecycle = await collectShellMetrics(page);
  const sidebarRect = await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width);
  expect(beforeLifecycle.workbenchFirstCol).toBe("264px");
  expect(beforeLifecycle.sidebarWidth).toBe("264px");
  expect(sidebarRect).toBeGreaterThanOrEqual(263);
  expect(sidebarRect).toBeLessThanOrEqual(265);
  expect(Math.round(beforeLifecycle.sidebarRect)).toBe(264);
  await expect(page.locator(".workbench")).toHaveAttribute("data-left-width", "264");
  expect(beforeLifecycle.body.fontFamily.startsWith("ui-sans-serif, system-ui, \"PingFang SC\", \"Noto Sans SC\"")).toBe(true);
  expect(beforeLifecycle.body.fontFamily).not.toContain("Microsoft YaHei");
  expect(beforeLifecycle.body.fontFamily).not.toContain("Noto Sans CJK SC");
  expect(beforeLifecycle.body.fontSize).toBe("15px");
  expect(beforeLifecycle.body.fontWeight).toBe("400");
  expect(beforeLifecycle.body.color).toBe("rgb(26, 26, 26)");
  expect(beforeLifecycle.homeTitle.fontSize).toBeGreaterThanOrEqual(18);
  expect(beforeLifecycle.homeTitle.fontSize).toBeLessThanOrEqual(20);
  expect(beforeLifecycle.homeTitle.fontWeight).toBeLessThanOrEqual(600);
  expect(beforeLifecycle.navItem.fontSize).toBeGreaterThanOrEqual(14);
  expect(beforeLifecycle.navItem.fontSize).toBeLessThanOrEqual(15);
  expect(beforeLifecycle.navItem.fontWeight).toBe(400);
  expect(beforeLifecycle.navActive.fontWeight).toBe(500);
  expect(beforeLifecycle.username.fontSize).toBe(13);
  expect(beforeLifecycle.username.fontWeight).toBe(400);
  const composer = await typeOf(page, "[data-home] [data-composer-input]");
  expect(composer.fontSize).toBeLessThanOrEqual(15);
  expect(composer.fontWeight).toBeLessThanOrEqual(400);

  await page.locator('[data-home-mode="lifecycle"]').click();
  const conclusion = page.locator("[data-followed-agent-report] .page-conclusion");
  await expect(conclusion).toBeVisible();
  const conclusionType = await typeOf(page, "[data-followed-agent-report] .page-conclusion");
  const handle = page.locator("[data-followed-agent-report] [data-kol-scope]").first();
  await expect(handle).toBeVisible();
  const handleType = await typeOf(page, "[data-followed-agent-report] [data-kol-scope] >> nth=0");
  expect(conclusionType.fontSize).toBeGreaterThanOrEqual(18);
  expect(conclusionType.fontSize).toBeLessThanOrEqual(20);
  expect(conclusionType.fontWeight).toBeLessThanOrEqual(600);
  expect(handleType.fontSize).toBe(13);
  expect(handleType.fontWeight).toBeLessThanOrEqual(400);

  await page.locator(".collapse-toggle").click();
  await expect(page.locator(".workbench")).toHaveClass(/sidebar-collapsed/);
  const collapsed = await page.evaluate(() => {
    const rail = document.querySelector(".sidebar");
    const shell = document.querySelector(".workbench");
    if (!rail || !shell) throw new Error("missing shell");
    return {
      firstCol: getComputedStyle(shell).gridTemplateColumns.split(/\s+/)[0],
      sidebarWidth: getComputedStyle(rail).width,
    };
  });
  expect(collapsed.firstCol).toBe("56px");
  expect(collapsed.sidebarWidth).toBe("56px");

  await page.locator(".collapse-toggle").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".mobile-top button").click();
  const mobile = await page.evaluate(() => {
    const rail = document.querySelector(".sidebar");
    if (!rail) throw new Error("missing sidebar");
    return {
      width: getComputedStyle(rail).width,
      display: getComputedStyle(rail).display,
    };
  });
  expect(mobile.display).toBe("flex");
  expect(mobile.width).not.toBe("264px");

  const dest = path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results", "shell-metrics-after.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({
    desktop: { ...beforeLifecycle, conclusion: conclusionType, handle: handleType },
    collapsed,
    mobile,
  }, null, 2));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results", "home-1440-after.png"),
    fullPage: false,
  });
});
