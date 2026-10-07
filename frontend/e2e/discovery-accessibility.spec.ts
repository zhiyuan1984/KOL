import { expect, test, type Locator } from "@playwright/test";

async function fullyVisible(control: Locator) {
  await expect(control).toBeVisible();
  const measure = () => control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { fullyVisible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && !!hit && element.contains(hit),
      rect: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight },
      hit: hit ? { tag: hit.tagName, className: hit.className } : null,
      focused: document.activeElement === element };
  });
  try {
    await expect.poll(measure).toMatchObject({ fullyVisible: true });
  } catch (error) {
    await control.page().screenshot({ path: test.info().outputPath("geometry-failure.png") });
    throw new Error(`Control geometry: ${JSON.stringify(await measure())}`, { cause: error });
  }
}
async function touchHitArea(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  // Measure actual hit testing, including transparent target extensions.
  await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return [-21.5, 0, 21.5].every(x => [-21.5, 0, 21.5].every(y => {
      const hit = document.elementFromPoint(rect.x + rect.width / 2 + x, rect.y + rect.height / 2 + y);
      return !!hit && element.contains(hit);
    }));
  })).toBe(true);
}

for (const width of [820, 390]) test.describe(`touch targets ${width}`, () => {
  test.use({ viewport: { width, height: 700 }, hasTouch: true });
  test("keeps independent filter targets and submission reachable", async ({ page }, info) => {
    await page.goto("/?tab=discovery");
    const card = page.locator("[data-discovery-search-card]");
    await expect(card).toBeVisible();
    const chips = card.locator("button[data-discovery-chip]");
    expect(await chips.count()).toBeGreaterThan(0);
    for (const chip of await chips.all()) {
      await touchHitArea(chip);
    }
    const region = page.locator('[data-skill-param="region"] [data-discovery-chip="na"]');
    await region.tap(); await expect(region).toHaveAttribute("aria-pressed", "true");
    const submit = page.locator("[data-home] [data-ai-prompt-submit]");
    await submit.scrollIntoViewIfNeeded(); await fullyVisible(submit);
    await touchHitArea(submit);
    await page.screenshot({ path: info.outputPath("touch-discovery.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

for (const theme of ["light", "dark"] as const) test.describe(`keyboard ${theme}`, () => {
  test.use({ viewport: { width: 1024, height: 589 }, colorScheme: theme, reducedMotion: "reduce", contrast: "more" });
  test("tabs to the footer without an obscured focus and keeps the draft", async ({ page }, info) => {
    await page.goto("/?tab=discovery");
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole("button", { name: "编辑完整请求" }).click();
    const input = page.locator("[data-home] [data-composer-input]");
    await input.fill("保留键盘验收草稿");
    const submit = page.locator("[data-home] [data-ai-prompt-submit]");
    let found = false;
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press("Tab");
      if (await submit.evaluate(element => document.activeElement === element)) { found = true; break; }
    }
    expect(found).toBe(true);
    await fullyVisible(submit);
    expect(await submit.evaluate(element => element.matches(":focus-visible") && getComputedStyle(element).outlineStyle !== "none")).toBe(true);
    await expect(input).toHaveValue("保留键盘验收草稿");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`keyboard-${theme}.png`), fullPage: true });
  });
});

test("keeps empty candidates distinct from failed reading, and retries only the existing result", async ({ page, request }) => {
  const saved = await (await request.post("/api/home/discovery/workspace", { data: {
    request_id: `accessible-results-${Date.now()}`, text: "隔离结果界面验收", brief: {
      platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"], min_followers: 100,
      max_followers: 20000, min_avg_plays_10: 100, expect_count: 10,
    },
  } })).json();
  let failed = false;
  await page.route("**/api/queries/runtime.actions?*", route => route.fulfill({ json: { actions: [{
    id: "read-fixture", skill_id: "crawler_collect", operation: "start_crawl", arguments: {}, state: "succeeded", risk: "L3",
    confirmation_version: "fixture", receipt: { task_id: "fixture-only" }, crawl: {
      id: "read-fixture", remote_task_id: "fixture-only", state: "succeeded", result_state: failed ? "failed" : "ready",
      result_error: failed ? "transport_error" : null, result_json: failed ? null : {
        task_id: "fixture-only", captured_at: "2026-10-04T10:00:00Z", complete: true, candidates: [],
      },
    },
  }] } }));
  await page.goto(`/s/${saved.session_id}`);
  const results = page.locator("[data-discovery-results]");
  await expect(results).toContainText("本次采集返回空结果");
  await expect(results.getByRole("button")).toHaveCount(0);
  failed = true; await page.reload();
  await expect(results).toContainText("候选读取未完成");
  await expect(results).not.toContainText("本次采集返回空结果");
  const retry = page.waitForRequest(request => request.method() === "POST" && request.url().includes("runtime.crawl.results.retry"));
  await page.route("**/api/actions/runtime.crawl.results.retry", route => route.fulfill({ status: 202, json: { state: "queued" } }));
  await results.getByRole("button", { name: "重试读取结果" }).click();
  expect((await retry).postDataJSON()).toEqual({ action_id: "read-fixture" });
});

test.describe("short touch confirmation", () => {
  test.use({ viewport: { width: 390, height: 589 }, hasTouch: true });
  test("reaches the R3 scope and confirms once through the extended touch target", async ({ page, request }, info) => {
    const response = await request.post("/api/sessions", { data: { title: "Isolated touch confirmation" } });
    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    let confirmed = false;
    await page.route("**/api/queries/runtime.actions?*", route => route.fulfill({ json: { actions: [{
      id: "touch-action", skill_id: "crawler_collect", operation: "start_crawl", state: confirmed ? "succeeded" : "pending",
      risk: "L3", confirmation_version: "touch-snapshot", blocked_reason: null,
      arguments: { platforms: ["youtube"], crawler_type: "search", keywords: "fixture-only", max_notes_count: 5, enable_comments: false, enable_sub_comments: false },
      receipt: confirmed ? { task_id: "fixture-only" } : null,
    }] } }));
    await page.route("**/api/actions/runtime.confirm", route => {
      expect(route.request().postDataJSON()).toEqual({ action_id: "touch-action", confirmation_version: "touch-snapshot" });
      expect(confirmed).toBe(false); confirmed = true;
      return route.fulfill({ status: 202, json: { job: { id: "touch-fixture-job" } } });
    });
    await page.goto(`/s/${session.id}`);
    const actions = page.locator("[data-runtime-actions]");
    await expect(actions).toContainText("请确认本次采集范围");
    await expect(actions).toContainText("需要确认（R3）");
    await expect(actions.locator(".runtime-action-summary")).toContainText("采集评论回复关闭");
    await expect(actions.locator(".runtime-action-summary")).toContainText("关键词fixture-only");
    await expect(actions.locator("pre")).toHaveCount(0);
    expect(confirmed).toBe(false);
    const confirm = actions.getByRole("button", { name: "确认开始采集" });
    await touchHitArea(confirm); await fullyVisible(confirm);
    await page.screenshot({ path: info.outputPath("touch-confirmation.png"), fullPage: true });
    const box = (await confirm.boundingBox())!;
    // Tap the outer part of the target rather than the center of the small visual button.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2 + 21);
    await expect(actions).toContainText("采集请求已提交");
    await expect(actions.getByText("查看操作记录", { exact: true })).toBeVisible();
    expect(confirmed).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: "确认开始采集" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
