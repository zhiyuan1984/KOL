import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

function rgb(css: string) {
  const rgbMatch = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  const spaceMatch = css.match(/rgba?\((\d+)\s+(\d+)\s+(\d+)/);
  if (spaceMatch) return [Number(spaceMatch[1]), Number(spaceMatch[2]), Number(spaceMatch[3])];
  const srgb = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (srgb) {
    return [srgb[1], srgb[2], srgb[3]].map((n) => Math.round(Number(n) * 255));
  }
  return css;
}

function near(actual: number[], expected: number[], slop = 8) {
  expect(actual.length).toBe(3);
  for (let i = 0; i < 3; i += 1) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(slop);
  }
}

async function composerChrome(page: Page, root: string) {
  return page.locator(`${root} [data-composer] .composer`).evaluate((el) => {
    const cs = getComputedStyle(el);
    const input = el.querySelector("[data-composer-input]");
    const plus = el.querySelector("[data-attach]");
    const divider = el.querySelector("[data-composer-divider]");
    const send = el.querySelector("[data-send]");
    const inputCs = input instanceof HTMLElement ? getComputedStyle(input) : null;
    const placeholderCs = input ? getComputedStyle(input, "::placeholder") : null;
    const plusCs = plus instanceof HTMLElement ? getComputedStyle(plus) : null;
    const dividerCs = divider instanceof HTMLElement ? getComputedStyle(divider) : null;
    const sendCs = send instanceof HTMLElement ? getComputedStyle(send) : null;
    return {
      width: el.getBoundingClientRect().width,
      minHeight: cs.minHeight,
      radius: cs.borderTopLeftRadius,
      borderColor: cs.borderTopColor,
      background: cs.backgroundColor,
      placeholderColor: placeholderCs?.color || "",
      placeholderSize: placeholderCs?.fontSize || inputCs?.fontSize || "",
      placeholderLine: placeholderCs?.lineHeight || inputCs?.lineHeight || "",
      plusWidth: plusCs?.width || "",
      plusHeight: plusCs?.height || "",
      plusBg: plusCs?.backgroundColor || "",
      dividerWidth: dividerCs?.width || "",
      dividerHeight: dividerCs?.height || "",
      dividerColor: dividerCs?.backgroundColor || "",
      sendColor: sendCs?.color || "",
    };
  });
}

test("home composer matches PromptInput tokens, opens plus menu, and sends", async ({ page }) => {
  const reqs: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/messages") && request.method() === "POST") reqs.push(request.url());
  });

  await page.goto("/");
  const dock = page.locator("[data-home] .home-composer-dock");
  const shell = page.locator("[data-home] [data-composer] .composer");
  await expect(shell).toBeVisible();
  await expect(page.locator("[data-home] [data-composer-divider]")).toBeVisible();
  await expect(page.locator("[data-coach-next], [data-next-step-card]")).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const pane = document.querySelector("[data-home]");
    const dockEl = document.querySelector("[data-home] .home-composer-dock");
    const composer = document.querySelector("[data-home] [data-composer] .composer");
    if (!(pane instanceof HTMLElement) || !(dockEl instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
      return null;
    }
    return {
      pane: pane.getBoundingClientRect().width,
      dock: dockEl.getBoundingClientRect().width,
      composer: composer.getBoundingClientRect().width,
      overflowX: getComputedStyle(pane).overflowX,
    };
  });
  expect(layout).toBeTruthy();
  expect(Math.abs(layout!.pane - layout!.dock)).toBeLessThan(8);
  expect(layout!.composer).toBeGreaterThan(layout!.dock * 0.86);
  expect(layout!.composer).toBeLessThanOrEqual(layout!.dock);
  expect(layout!.overflowX).not.toBe("scroll");

  const chrome = await composerChrome(page, "[data-home]");
  expect(parseFloat(chrome.minHeight)).toBeGreaterThanOrEqual(96);
  expect(parseFloat(chrome.radius)).toBeGreaterThanOrEqual(24);
  expect(parseFloat(chrome.radius)).toBeLessThanOrEqual(26);
  near(rgb(chrome.borderColor) as number[], [194, 209, 255]);
  near(rgb(chrome.background) as number[], [255, 255, 255]);
  near(rgb(chrome.placeholderColor) as number[], [166, 166, 166]);
  expect(chrome.placeholderSize).toBe("16px");
  expect(parseFloat(chrome.plusWidth)).toBe(36);
  expect(parseFloat(chrome.plusHeight)).toBe(36);
  near(rgb(chrome.plusBg) as number[], [246, 247, 248]);
  expect(parseFloat(chrome.dividerWidth)).toBe(1);
  expect(parseFloat(chrome.dividerHeight)).toBe(16);
  near(rgb(chrome.dividerColor) as number[], [229, 229, 229]);
  near(rgb(chrome.sendColor) as number[], [107, 114, 128]);

  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "上传文件" })).toBeVisible();
  await page.locator("[data-home] [data-composer-tool='skills']").click();
  await expect(page.locator("[data-home] [data-composer-tool='skills']")).toHaveClass(/is-selected/);
  const skillChip = await page.locator("[data-home] [data-composer-tool='skills']").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.width, height: cs.height, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, color: cs.color };
  });
  expect(parseFloat(skillChip.width)).toBe(98);
  expect(parseFloat(skillChip.height)).toBe(32);
  expect(parseFloat(skillChip.radius)).toBe(12);
  near(rgb(skillChip.bg) as number[], [243, 246, 255]);
  near(rgb(skillChip.color) as number[], [79, 70, 229]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.locator("[data-home] [data-composer-input]").fill("给@小美妆日记 写阶段跟进邮件");
  const ready = await page.locator("[data-home] [data-send]").evaluate((el) => getComputedStyle(el).color);
  near(rgb(ready) as number[], [79, 70, 229]);
  await page.locator("[data-home] [data-send]").click();
  await page.waitForURL(/\/s\//);
  await expect(page.locator('[data-kind="me"]')).toContainText("给@小美妆日记 写阶段跟进邮件", { timeout: 15000 });
  expect(reqs.length).toBeGreaterThan(0);
  await expect(dock).toHaveCount(0);
});

test("session PromptInput stays at the thread foot with the same tokens", async ({ page }) => {
  await page.goto("/s/stop-run");
  const footer = page.locator(".session-composer.prompt-input");
  const shell = footer.locator(".composer");
  await expect(footer).toBeVisible();
  await expect(shell).toBeVisible();
  await expect(page.locator("[data-coach-next], [data-next-step-card]")).toHaveCount(0);

  const placement = await page.evaluate(() => {
    const stream = document.querySelector("[data-session-stream-pane]");
    const foot = document.querySelector(".session-composer.prompt-input");
    const composer = document.querySelector(".session-composer .composer");
    if (!(stream instanceof HTMLElement) || !(foot instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
      return null;
    }
    return {
      streamBottom: stream.getBoundingClientRect().bottom,
      footTop: foot.getBoundingClientRect().top,
      composerTop: composer.getBoundingClientRect().top,
      footParent: foot.parentElement?.className || "",
    };
  });
  expect(placement).toBeTruthy();
  expect(placement!.composerTop).toBeGreaterThanOrEqual(placement!.streamBottom - 12);
  expect(placement!.footTop).toBeGreaterThanOrEqual(placement!.streamBottom - 12);

  const chrome = await composerChrome(page, ".session-composer");
  expect(parseFloat(chrome.radius)).toBeGreaterThanOrEqual(24);
  expect(parseFloat(chrome.radius)).toBeLessThanOrEqual(26);
  near(rgb(chrome.borderColor) as number[], [194, 209, 255]);
  near(rgb(chrome.placeholderColor) as number[], [166, 166, 166]);

  await page.locator(".session-composer [data-attach]").click();
  await expect(page.getByRole("menu", { name: "添加内容" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("settings fields keep a MASTER focus ring and login error-summary uses defined tokens", async ({ page }) => {
  await page.goto("/settings");
  const input = page.locator(".field input").first();
  await expect(input).toBeVisible();
  await input.focus();
  const fieldFocus = await input.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { outlineColor: cs.outlineColor, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
  });
  expect(fieldFocus.outlineStyle).not.toBe("none");
  expect(parseFloat(fieldFocus.outlineWidth)).toBeGreaterThanOrEqual(2);
  near(rgb(fieldFocus.outlineColor) as number[], [79, 70, 229]);

  const summary = await page.evaluate(() => {
    const host = document.createElement("div");
    host.className = "auth-card";
    const el = document.createElement("div");
    el.className = "error-summary";
    host.appendChild(el);
    document.body.appendChild(host);
    const cs = getComputedStyle(el);
    const out = { bg: cs.backgroundColor, color: cs.color };
    host.remove();
    return out;
  });
  near(rgb(summary.color) as number[], [196, 60, 60]);
  near(rgb(summary.bg) as number[], [242, 232, 233]);
});
