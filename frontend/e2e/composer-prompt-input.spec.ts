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
      maxHeight: cs.maxHeight,
      inputMaxHeight: inputCs?.maxHeight || "",
      radius: cs.borderTopLeftRadius,
      borderTopWidth: cs.borderTopWidth,
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

// The shell fades its border colour over .18s, so a reading taken the instant
// focus lands catches that fade mid-flight. Wait for the frame to commit and for
// the element's own transitions to finish before measuring a writing state.
async function settleComposer(page: Page, root: string) {
  await page.locator(`${root} [data-composer] .composer`).evaluate(async (el) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(el.getAnimations().map((anim) => anim.finished.catch(() => undefined)));
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
  await expect(page.locator("[data-home] [data-composer-tool]")).toHaveCount(0);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveAttribute("placeholder", "有问题，尽管问");
  await expect(page.locator("[data-coach-next], [data-next-step-card]")).toHaveCount(0);
  const sans = await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily);
  expect(sans.toLowerCase()).toMatch(/ui-sans-serif|system-ui|pingfang|noto sans/);

  const layout = await page.evaluate(() => {
    const pane = document.querySelector("[data-home]");
    const dockEl = document.querySelector("[data-home] .home-composer-dock");
    const composer = document.querySelector("[data-home] [data-composer] .composer");
    if (!(pane instanceof HTMLElement) || !(dockEl instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
      return null;
    }
    const dockCs = getComputedStyle(dockEl);
    const dockRect = dockEl.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const contentLeft = dockRect.left + parseFloat(dockCs.borderLeftWidth) + parseFloat(dockCs.paddingLeft);
    const contentRight = dockRect.right - parseFloat(dockCs.borderRightWidth) - parseFloat(dockCs.paddingRight);
    return {
      pane: pane.getBoundingClientRect().width,
      dock: dockRect.width,
      composer: composerRect.width,
      gapLeft: composerRect.left - contentLeft,
      gapRight: contentRight - composerRect.right,
      overflowX: getComputedStyle(pane).overflowX,
    };
  });
  expect(layout).toBeTruthy();
  // §10b: the ask box is a 768px centred column. The full-bleed footer bar that
  // spanned the whole content width was rejected, so the cap is the contract.
  expect(layout!.composer).toBeLessThanOrEqual(768);
  expect(layout!.composer).toBeGreaterThanOrEqual(766);
  expect(layout!.composer).toBeLessThanOrEqual(layout!.dock);
  expect(layout!.overflowX).not.toBe("scroll");
  // ...and it is centred in the dock's content box, not pinned to one edge.
  expect(Math.abs(layout!.gapLeft - layout!.gapRight)).toBeLessThanOrEqual(2);

  const chrome = await composerChrome(page, "[data-home]");
  // 产品要求（2026-09-22）：提问框默认就是「一行输入 + 工具行」= 105px。
  // 不再是 240px 的 dvh 地板 —— 页脚控件给小字让路，多行时盒子自己长高。
  expect(parseFloat(chrome.minHeight)).toBeGreaterThanOrEqual(105);
  expect(parseFloat(chrome.minHeight)).toBeLessThanOrEqual(112);
  // Editor cap + the box's own chrome (padding + toolbar) stays inside the box
  // cap, so long text scrolls inside the editor and the toolbar never leaves the
  // floor it is pinned to.
  expect(parseFloat(chrome.maxHeight)).toBeGreaterThanOrEqual(540);
  expect(parseFloat(chrome.maxHeight)).toBeLessThanOrEqual(550);
  expect(parseFloat(chrome.inputMaxHeight)).toBeGreaterThanOrEqual(440);
  expect(parseFloat(chrome.inputMaxHeight)).toBeLessThanOrEqual(450);
  expect(parseFloat(chrome.radius)).toBeGreaterThanOrEqual(26);
  expect(parseFloat(chrome.radius)).toBeLessThanOrEqual(30);
  expect(parseFloat(chrome.borderTopWidth)).toBe(1);
  near(rgb(chrome.borderColor) as number[], [229, 229, 229], 16);
  near(rgb(chrome.background) as number[], [255, 255, 255]);
  near(rgb(chrome.placeholderColor) as number[], [138, 138, 138], 16);
  expect(chrome.placeholderSize).toBe("14px");
  expect(chrome.placeholderLine).toBe("20px");
  expect(parseFloat(chrome.plusWidth)).toBe(32);
  expect(parseFloat(chrome.plusHeight)).toBe(32);
  expect(chrome.plusBg).toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/);
  near(rgb(chrome.sendColor) as number[], [180, 180, 180], 24);

  // The 分析跟进 / 开始发现 / 安排今天 row is gone from the ask box, and the
  // 推荐技能 row that briefly lived at the top of Home was removed too, so neither
  // the plural wrapper nor the singular pill may render anywhere on Home.
  await expect(page.locator("[data-home-composer-pills]")).toHaveCount(0);
  await expect(page.locator("[data-home] .home-composer-pill")).toHaveCount(0);

  // Focus still toggles is-composer-focused (it dims neighbouring panels), but it
  // must no longer move the box. Comparing the focused read against the idle one
  // is the regression test for the jump the user reported.
  await page.locator("[data-home] [data-composer-input]").click();
  await expect(page.locator("[data-home]")).toHaveClass(/is-composer-focused/);
  await settleComposer(page, "[data-home]");
  const focusedChrome = await composerChrome(page, "[data-home]");
  expect(parseFloat(focusedChrome.minHeight)).toBe(parseFloat(chrome.minHeight));
  expect(parseFloat(focusedChrome.radius)).toBe(parseFloat(chrome.radius));
  expect(parseFloat(focusedChrome.borderTopWidth)).toBe(parseFloat(chrome.borderTopWidth));
  expect(Math.abs(focusedChrome.width - chrome.width)).toBeLessThanOrEqual(1);

  await page.locator("[data-home] [data-composer-input]").blur();
  await expect(page.locator("[data-home]")).not.toHaveClass(/is-composer-focused/);
  await settleComposer(page, "[data-home]");
  const blurredChrome = await composerChrome(page, "[data-home]");
  expect(parseFloat(blurredChrome.minHeight)).toBe(parseFloat(chrome.minHeight));
  expect(parseFloat(blurredChrome.radius)).toBe(parseFloat(chrome.radius));
  expect(parseFloat(blurredChrome.borderTopWidth)).toBe(parseFloat(chrome.borderTopWidth));
  expect(Math.abs(blurredChrome.width - chrome.width)).toBeLessThanOrEqual(1);

  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "上传文件" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "上传图片" })).toBeVisible();
  await expect(menu.locator('[data-menu-section="技能"]')).toBeVisible();
  await expect(page.locator("[data-home] [data-composer-tool]")).toHaveCount(0);
  // The model tier moved into the composer toolbar, next to send.
  await expect(page.locator("[data-home] .composer .tier-control")).toHaveCount(1);
  await expect(page.locator("[data-home] .home-composer-dock .tier-control")).toHaveCount(1);
  // 档位是 chip + 面板：触发器带当前值，展开后当前档打 ✓（不只靠颜色）。
  await expect(page.locator("[data-home] [data-tier-trigger]")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-home] [data-tier-trigger] [data-tier-value]")).toHaveText(/快速|均衡|高质量/);
  // + 菜单（图 4 形态 + 搜索）：一个面板、分组平铺、顶部搜索框；没有子菜单，也没有路由路径文案。
  await expect(menu.getByRole("menuitem", { name: "上传文件" })).toHaveAttribute("title", "把本地文件加进提问");
  await expect(menu.locator(".cascade-scroll")).toHaveCount(1);
  await expect(menu.locator("[data-composer-subpanel]")).toHaveCount(0);
  await expect(menu.locator("[data-composer-menu-search]")).toBeVisible();
  await expect(menu.locator("[data-composer-menu-all-skills]")).toBeVisible();
  await expect(menu.locator('a[href="/kb"], a[href="/connectors"]')).toHaveCount(0);
  // 技能条目就在同一面板里 —— 不需要进二级菜单。
  await expect(menu.locator('[data-skill-option="email_compose"]')).toBeVisible();
  await menu.locator("[data-composer-menu-search]").fill("写合作");
  await expect(menu.locator("[data-composer-menu-row]")).toHaveCount(1);
  await menu.locator("[data-composer-menu-search]").fill("");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.locator("[data-home] [data-composer-input]").fill("给@小美妆日记 写阶段跟进邮件");
  const ready = await page.locator("[data-home] [data-send]").evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement("i");
    probe.style.background = "var(--primary)";
    document.body.appendChild(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      color: cs.color,
      background: cs.backgroundColor,
      primary,
      disabled: (el as HTMLButtonElement).disabled,
    };
  });
  expect(ready.disabled).toBe(false);
  near(rgb(ready.color) as number[], [255, 255, 255]);
  expect(rgb(ready.background)).toEqual(rgb(ready.primary));
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
  expect(parseFloat(chrome.radius)).toBeGreaterThanOrEqual(26);
  expect(parseFloat(chrome.radius)).toBeLessThanOrEqual(30);
  near(rgb(chrome.borderColor) as number[], [229, 229, 229], 16);
  near(rgb(chrome.placeholderColor) as number[], [138, 138, 138], 16);

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
  near(rgb(fieldFocus.outlineColor) as number[], [0, 0, 0]);

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

  const work = page.locator(".btn.work").first();
  await expect(work).toBeVisible();
  const workIdle = await work.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize };
  });
  near(rgb(workIdle.bg) as number[], [199, 59, 122]);
  near(rgb(workIdle.color) as number[], [255, 255, 255]);
  expect(parseFloat(workIdle.fontSize)).toBeGreaterThanOrEqual(14);

  await work.focus();
  const workFocus = await work.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      outlineColor: cs.outlineColor,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow,
    };
  });
  expect(workFocus.outlineStyle).not.toBe("none");
  expect(parseFloat(workFocus.outlineWidth)).toBeGreaterThanOrEqual(2);
  expect(parseFloat(workFocus.outlineOffset)).toBeGreaterThanOrEqual(2);
  near(rgb(workFocus.outlineColor) as number[], [255, 255, 255]);
  expect(workFocus.boxShadow).toMatch(/rgb\(0,\s*0,\s*0\)|rgba\(0,\s*0,\s*0/);
});
