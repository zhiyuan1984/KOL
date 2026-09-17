import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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

type RailMetrics = {
  tokenLeftWidth: string;
  workbenchFirstCol: string;
  sidebarWidth: string;
  sidebarMinWidth: string;
  sidebarMaxWidth: string;
  sidebarRect: number;
};

function expectExpandedDesktopRail(metrics: RailMetrics) {
  const firstCol = Number.parseFloat(metrics.workbenchFirstCol);
  const sidebarWidth = Number.parseFloat(metrics.sidebarWidth);
  const minWidth = Number.parseFloat(metrics.sidebarMinWidth);
  const maxWidth = Number.parseFloat(metrics.sidebarMaxWidth);
  expect(metrics.tokenLeftWidth).toBe("260px");
  expect(metrics.workbenchFirstCol).toBe("260px");
  expect(metrics.sidebarWidth).toBe("260px");
  expect(firstCol).toBeGreaterThanOrEqual(259);
  expect(firstCol).toBeLessThanOrEqual(261);
  expect(sidebarWidth).toBeGreaterThanOrEqual(259);
  expect(sidebarWidth).toBeLessThanOrEqual(261);
  expect(minWidth).toBeGreaterThanOrEqual(259);
  expect(minWidth).toBeLessThanOrEqual(261);
  expect(maxWidth).toBeGreaterThanOrEqual(259);
  expect(maxWidth).toBeLessThanOrEqual(261);
  expect(firstCol).toBeCloseTo(260, 0);
  expect(sidebarWidth).toBeCloseTo(260, 0);
  expect(metrics.sidebarRect).toBeCloseTo(260, 0);
}

async function collectShellMetrics(page: Page) {
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

test("desktop employee shell computed 260 rail and Codex Regular type", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("[data-home] h1")).toBeVisible();

  const beforeLifecycle = await collectShellMetrics(page);
  expectExpandedDesktopRail(beforeLifecycle);
  await expect(page.locator(".workbench")).toHaveAttribute("data-left-width", "260");

  const sidebarScrollCss = await page.locator(".sidebar-scroll").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      scrollbarWidth: cs.scrollbarWidth,
      scrollbarColor: cs.scrollbarColor,
      scrollbarGutter: cs.scrollbarGutter,
      paddingRight: cs.paddingRight,
    };
  });
  expect(sidebarScrollCss.scrollbarWidth).toBe("thin");
  expect(sidebarScrollCss.scrollbarColor.replace(/\s+/g, " ")).toMatch(
    /^(#c7c7c7|rgb\(199, 199, 199\)) (transparent|rgba\(0, 0, 0, 0\))$/i,
  );
  expect(sidebarScrollCss.scrollbarGutter).toBe("auto");
  const scrollPadRight = Number.parseFloat(sidebarScrollCss.paddingRight);
  expect(scrollPadRight).toBeGreaterThanOrEqual(4);
  expect(scrollPadRight).toBeLessThanOrEqual(8);

  const railEdge = await page.evaluate(() => {
    const rail = document.querySelector(".sidebar") as HTMLElement | null;
    const scroller = document.querySelector(".sidebar-scroll") as HTMLElement | null;
    if (!rail || !scroller) throw new Error("missing rail");
    const railRect = rail.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    const cs = getComputedStyle(rail);
    return {
      railWidth: railRect.width,
      railRight: railRect.right,
      railPaddingRight: cs.paddingRight,
      scrollRight: scrollRect.right,
      thumbLeft: scrollRect.right - 6,
    };
  });
  expect(railEdge.railWidth).toBeCloseTo(260, 0);
  expect(railEdge.railPaddingRight).toBe("0px");
  expect(railEdge.scrollRight).toBeGreaterThanOrEqual(railEdge.railRight - 2);
  expect(railEdge.scrollRight).toBeLessThanOrEqual(railEdge.railRight);
  expect(railEdge.thumbLeft).toBeGreaterThanOrEqual(250);
  expect(railEdge.thumbLeft).toBeLessThanOrEqual(256);

  // 1280 = 2560×1600 @ 200% CSS viewport — the machine where min-width:0 + > lock crushed to ~210.
  const fixedViewports = [1280, 1920, 2560] as const;
  const fixedTable: Record<string, RailMetrics> = {};
  for (const width of fixedViewports) {
    await page.setViewportSize({ width, height: 1600 });
    const rail = await collectShellMetrics(page);
    expectExpandedDesktopRail(rail);
    fixedTable[String(width)] = {
      tokenLeftWidth: rail.tokenLeftWidth,
      workbenchFirstCol: rail.workbenchFirstCol,
      sidebarWidth: rail.sidebarWidth,
      sidebarMinWidth: rail.sidebarMinWidth,
      sidebarMaxWidth: rail.sidebarMaxWidth,
      sidebarRect: rail.sidebarRect,
    };
  }

  await page.setViewportSize({ width: 1280, height: 1600 });
  const shrinkAttack = await page.evaluate(() => {
    const rail = document.querySelector(".sidebar") as HTMLElement | null;
    const shell = document.querySelector(".workbench") as HTMLElement | null;
    if (!rail || !shell) throw new Error("missing shell");
    rail.style.minWidth = "0";
    rail.style.width = "16vw";
    const grid = getComputedStyle(shell).gridTemplateColumns;
    return {
      width: getComputedStyle(rail).width,
      minWidth: getComputedStyle(rail).minWidth,
      firstCol: grid.split(/\s+/)[0],
      rect: rail.getBoundingClientRect().width,
    };
  });
  expect(Number.parseFloat(shrinkAttack.width)).toBeCloseTo(260, 0);
  expect(Number.parseFloat(shrinkAttack.minWidth)).toBeCloseTo(260, 0);
  expect(Number.parseFloat(shrinkAttack.firstCol)).toBeCloseTo(260, 0);
  expect(shrinkAttack.rect).toBeCloseTo(260, 0);
  await page.evaluate(() => {
    const rail = document.querySelector(".sidebar") as HTMLElement | null;
    if (!rail) throw new Error("missing sidebar");
    rail.style.minWidth = "";
    rail.style.width = "";
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  expect(beforeLifecycle.html.fontSize).toBe("16px");
  expect(beforeLifecycle.body.fontFamily.startsWith("ui-sans-serif, system-ui, \"PingFang SC\", \"Noto Sans SC\"")).toBe(true);
  expect(beforeLifecycle.body.fontFamily).not.toContain("Microsoft YaHei");
  expect(beforeLifecycle.body.fontFamily).not.toContain("Noto Sans CJK SC");
  expect(beforeLifecycle.body.fontSize).toBe("15px");
  expect(beforeLifecycle.body.fontWeight).toBe("400");
  expect(beforeLifecycle.body.color).toBe("rgb(26, 26, 26)");
  expect(beforeLifecycle.homeTitle.fontSize).toBeGreaterThanOrEqual(16);
  expect(beforeLifecycle.homeTitle.fontSize).toBeLessThanOrEqual(18);
  expect(beforeLifecycle.homeTitle.fontWeight).toBe(500);
  expect(beforeLifecycle.navItem.fontSize).toBe(14);
  expect(beforeLifecycle.navItem.fontWeight).toBe(400);
  expect(beforeLifecycle.navActive.fontWeight).toBe(500);
  expect(beforeLifecycle.navActive.fontWeight).toBeLessThan(700);
  expect(beforeLifecycle.username.fontSize).toBe(13);
  expect(beforeLifecycle.username.fontWeight).toBe(400);
  const composer = await typeOf(page, "[data-home] [data-composer-input]");
  expect(composer.fontSize).toBeLessThanOrEqual(15);
  expect(composer.fontWeight).toBeLessThanOrEqual(400);
  const composerRadius = await page.locator("[data-home] [data-composer] .composer").evaluate((el) => {
    const cs = getComputedStyle(el);
    return Number.parseFloat(cs.borderTopLeftRadius);
  });
  expect(composerRadius).toBeGreaterThanOrEqual(20);
  expect(composerRadius).toBeLessThanOrEqual(24);

  await page.locator(".collapse-toggle").click();
  await expect(page.locator(".workbench")).toHaveClass(/sidebar-collapsed/);
  const collapsed = await page.evaluate(() => {
    const rail = document.querySelector(".sidebar");
    const shell = document.querySelector(".workbench");
    const scroller = document.querySelector(".sidebar-scroll");
    if (!rail || !shell || !scroller) throw new Error("missing shell");
    return {
      firstCol: getComputedStyle(shell).gridTemplateColumns.split(/\s+/)[0],
      sidebarWidth: getComputedStyle(rail).width,
      railRect: rail.getBoundingClientRect().width,
      paddingRight: getComputedStyle(rail).paddingRight,
      scrollPadRight: getComputedStyle(scroller).paddingRight,
    };
  });
  expect(collapsed.firstCol).toBe("56px");
  expect(collapsed.sidebarWidth).toBe("56px");
  expect(collapsed.railRect).toBeCloseTo(56, 0);
  expect(collapsed.paddingRight).toBe("0px");
  expect(collapsed.scrollPadRight).toBe("0px");

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
  expect(mobile.width).not.toBe("260px");
  expect(mobile.width).not.toContain("clamp");
  expect(Number.parseFloat(mobile.width)).not.toBe(260);

  const outDir = process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results";
  await page.setViewportSize({ width: 1440, height: 520 });
  const overflowEdge = await page.evaluate(() => {
    const rail = document.querySelector(".sidebar") as HTMLElement | null;
    const scroller = document.querySelector(".sidebar-scroll") as HTMLElement | null;
    if (!rail || !scroller) throw new Error("missing rail");
    const railRect = rail.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    return {
      railWidth: railRect.width,
      railRight: railRect.right,
      scrollRight: scrollRect.right,
      thumbLeft: scrollRect.right - 6,
      canScroll: scroller.scrollHeight > scroller.clientHeight,
    };
  });
  expect(overflowEdge.railWidth).toBeCloseTo(260, 0);
  expect(overflowEdge.canScroll).toBe(true);
  expect(overflowEdge.scrollRight).toBeGreaterThanOrEqual(overflowEdge.railRight - 2);
  expect(overflowEdge.thumbLeft).toBeGreaterThanOrEqual(250);
  expect(overflowEdge.thumbLeft).toBeLessThanOrEqual(256);
  await page.locator(".sidebar").screenshot({ path: path.join(outDir, "sidebar-rail-overflow.png") });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "shell-metrics-after.json"), JSON.stringify({
    desktop: { ...beforeLifecycle, composerRadius, railEdge },
    fixedTable,
    shrinkAttack,
    collapsed,
    mobile,
    overflowEdge,
  }, null, 2));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: path.join(outDir, "home-1440-after.png"),
    fullPage: false,
  });
});

test("sidebar CSS source keeps 260 rail and ChatGPT thin scrollbar", () => {
  const source = fs.readFileSync(path.join(here, "../src/styles.css"), "utf8");
  expect(source).toMatch(/--left-width:\s*260px/);
  expect(source).toContain("width: 260px !important");
  expect(source).toContain("min-width: 260px !important");
  expect(source).toContain("flex: 0 0 260px !important");
  expect(source).toContain("scrollbar-color: #c7c7c7 transparent");
  expect(source).toContain(".sidebar::-webkit-scrollbar-button");
  expect(source).toContain(".sidebar-scroll::-webkit-scrollbar-button");
  expect(source).toContain("scrollbar-gutter: auto");
  expect(source).toMatch(/\.sidebar\s*\{[^}]*padding:\s*12px 0 12px 16px/);
  expect(source).not.toMatch(/scrollbar-gutter:\s*stable\s*;/);
  expect(source).not.toMatch(/\.sidebar\s*\{[^}]*padding:\s*12px 16px/);
  expect(source).not.toMatch(/clamp\([^)]*16vw/);
  expect(source).not.toMatch(/\.sidebar\s*\{[^}]*(?:width|min-width|max-width):\s*264px/);
  expect(source).not.toMatch(/\.sidebar\s*\{[^}]*(?:width|min-width|max-width):\s*312px/);
  expect(source).not.toMatch(/\.sidebar-scroll\s*\{[^}]*scrollbar-color:\s*var\(--sidebar-thumb\)/);
});
