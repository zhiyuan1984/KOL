import { expect, test, type Page } from "@playwright/test";
import { BUSINESS_ID, title, verified, independentFixture } from "./independent-detail-fixture";

async function openIndependentFromRow(page: Page) {
  const row = page.locator(`tr[data-task-id="${BUSINESS_ID}"]`);
  const direct = row.getByRole("link", { name: "独立详情", exact: true });
  await expect(row).toBeVisible();
  if (await direct.isVisible()) await direct.click();
  else {
    await row.getByRole("button", { name: /更多操作$/ }).click();
    await page.getByRole("group", { name: "任务操作" }).getByRole("link", { name: "独立详情", exact: true }).click();
  }
  await expect(page).toHaveURL(new RegExp(`/tasks/${BUSINESS_ID}$`));
  await expect(page.locator("[data-task-kind=business]")).toBeVisible();
}
async function fillDraft(page: Page) {
  await page.getByRole("button", { name: "登记事件", exact: true }).click();
  await page.getByRole("textbox", { name: /已核验事实摘要/ }).fill("已核验但尚未提交的测试事实");
  await page.getByRole("textbox", { name: /证据引用/ }).fill("fixture:evidence");
}

test("business deep link uses authoritative task_type and real business goal, not Agent manual template", async ({ page }) => {
  const control = await independentFixture(page);
  await page.goto(`/tasks/${BUSINESS_ID}`);
  const detail = page.locator("[data-task-detail]");
  await expect(detail).toHaveAttribute("data-task-kind", "business");
  await expect(detail.getByRole("heading", { name: title })).toBeVisible();
  await expect(detail.getByText("业务目标", { exact: true })).toBeVisible();
  await expect(detail.getByText("线索已建档", { exact: true })).toBeVisible();
  await expect(detail.getByText("Agent 任务", { exact: true })).toHaveCount(0);
  await expect(detail.getByText("manual", { exact: true })).not.toBeVisible();
  await expect(detail.getByText(BUSINESS_ID, { exact: true })).not.toBeVisible();
  await expect(detail.getByText("尚无可展示的执行记录。", { exact: true })).toHaveCount(0);
  expect(await detail.locator("h1").evaluate(el => getComputedStyle(el).fontSize)).toBe("13px");
  const goal = await detail.getByText("业务目标", { exact: true }).boundingBox();
  const action = await detail.getByRole("button", { name: "登记事件", exact: true }).boundingBox();
  expect(goal!.y + goal!.height).toBeLessThan(800);
  expect(action!.y + action!.height).toBeLessThan(800);
  await page.screenshot({ path: test.info().outputPath("independent-business-desktop.png"), fullPage: true, animations: "disabled" });
  expect(control.writes()).toBe(0); expect(control.apiErrors).toEqual([]);
});

test("return restores canonical new source/search/period filters and focuses original task row", async ({ page }) => {
  const control = await independentFixture(page);
  await page.goto("/tasks?period=week&source=business&q=MAX&status=queued");
  await openIndependentFromRow(page);
  await page.getByRole("link", { name: /返回任务明细/ }).click();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/tasks"); expect(url.hash).toBe("#task-details");
  for (const [key, value] of Object.entries({ period: "week", source: "business", q: "MAX", status: "queued" })) expect(url.searchParams.get(key)).toBe(value);
  await expect(page.locator(`tr[data-task-id="${BUSINESS_ID}"] [data-task-detail-entry]`)).toBeFocused();
  await expect(page.getByRole("textbox", { name: "搜索任务名称、内容、技能或模板" })).toHaveValue("MAX");
  expect(control.writes()).toBe(0);
});

test("direct independent page refresh retains same object then returns to task details anchor and row", async ({ page }) => {
  await independentFixture(page);
  await page.goto(`/tasks/${BUSINESS_ID}`); await page.reload();
  await expect(page).toHaveURL(new RegExp(`/tasks/${BUSINESS_ID}$`));
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("link", { name: /返回任务明细/ })).toHaveAttribute("href", "/tasks#task-details");
  await page.getByRole("link", { name: /返回任务明细/ }).click();
  await expect(page.locator(`tr[data-task-id="${BUSINESS_ID}"] [data-task-detail-entry]`)).toBeFocused();
});

test("future unknown type stays generic rather than masquerading as Agent", async ({ page }) => {
  await independentFixture(page, { unknownType: true });
  await page.goto(`/tasks/${BUSINESS_ID}`);
  const detail = page.locator("[data-task-detail]");
  await expect(detail).toHaveAttribute("data-task-kind", "unknown");
  await expect(detail.getByText("Agent 任务", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/tasks/${BUSINESS_ID}$`));
});

test("restricted related module keeps independently authorized business root without a re-fetch/remount loop", async ({ page }) => {
  const control = await independentFixture(page, { relatedDenied: true });
  await page.goto(`/tasks/${BUSINESS_ID}`);
  await expect(page.getByRole("alert")).toContainText("审批与工单依赖当前不可访问");
  await expect(page.getByText("线索已建档", { exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  expect(control.reads()).toBeLessThanOrEqual(3);
  await expect(page.getByText("线索已建档", { exact: true })).toBeVisible();
});

test("actual root permission revoke after related error clears private body and retains safe return", async ({ page }) => {
  await independentFixture(page, { rootDeniedAfterRelated: true });
  await page.goto(`/tasks/${BUSINESS_ID}`);
  await expect(page.getByRole("alert")).toContainText("没有访问此任务的权限");
  await expect(page.getByText("业务目标", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登记事件", exact: true })).toHaveCount(0);
  await expect(page.getByText(verified.summary, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /返回任务明细/ })).toBeVisible();
});

for (const status of [401, 403, 404]) test(`root ${status} is truthful and does not change deep link`, async ({ page }) => {
  await independentFixture(page, { rootStatus: status });
  await page.goto(`/tasks/${BUSINESS_ID}`);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新读取" })).toBeVisible();
  await expect(page.getByRole("button", { name: "登记事件" })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/tasks/${BUSINESS_ID}$`));
});

test("root refresh permission failure clears the previously visible task", async ({ page }) => {
  const control = await independentFixture(page);
  await page.goto(`/tasks/${BUSINESS_ID}`);
  await expect(page.getByText("线索已建档", { exact: true })).toBeVisible();
  control.revoke(); await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("没有访问此任务的权限");
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  await expect(page.getByText(verified.summary, { exact: true })).toHaveCount(0);
});

test("aggregate failure is visible, not an empty Agent view or hidden error", async ({ page }) => {
  await independentFixture(page, { aggregateStatus: 500 });
  await page.goto(`/tasks/${BUSINESS_ID}`);
  await expect(page.getByRole("alert")).toContainText("业务详情未能完整读取");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新读取" })).toBeVisible();
});

test("Agent capabilities still expose real execution, artifacts and existing session", async ({ page }) => {
  await independentFixture(page); await page.goto("/tasks/agent-fixture");
  await expect(page.getByText("资料核对完成", { exact: true })).toBeVisible();
  await expect(page.getByText("来源核对报告", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入完整会话 →" })).toHaveAttribute("href", "/s/session-fixture");
  await expect(page.locator("[data-task-kind=agent]")).toBeVisible();
});

test("browser back cancellation preserves the actual unsent draft, not just the URL", async ({ page }) => {
  const control = await independentFixture(page);
  await page.goto("/tasks?period=week&source=business"); await openIndependentFromRow(page); await fillDraft(page);
  page.once("dialog", dialog => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/tasks/${BUSINESS_ID}$`));
  await expect(page.getByRole("textbox", { name: /已核验事实摘要/ })).toHaveValue("已核验但尚未提交的测试事实");
  expect(control.writes()).toBe(0);
});

test("managed return protects drafts and confirmed write uses original preview and actual async receipt", async ({ page }) => {
  const control = await independentFixture(page);
  await page.goto(`/tasks/${BUSINESS_ID}`); await fillDraft(page);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("link", { name: /返回任务明细/ }).click();
  await expect(page.getByRole("textbox", { name: /已核验事实摘要/ })).toHaveValue("已核验但尚未提交的测试事实");
  await page.getByRole("button", { name: "提交已核验事件", exact: true }).click();
  expect(control.writes()).toBe(0);
  const confirmation = page.getByRole("dialog").filter({ hasText: "确认登记已核验事件" });
  await expect(confirmation).toContainText("fixture:evidence");
  await confirmation.getByRole("button", { name: "确认写入并进入异步处理" }).click();
  await expect(page.getByText("已登记核验事件", { exact: true })).toBeVisible();
  await expect(page.getByText(/异步作业 job-fixture 当前为「queued」/)).toBeVisible();
  expect(control.writes()).toBe(1); expect(control.apiErrors).toEqual([]);
});

for (const size of [{ width: 375, height: 700 }, { width: 768, height: 700 }, { width: 1024, height: 600 }, { width: 1920, height: 1080 }]) test(`independent detail is usable at ${size.width}x${size.height}`, async ({ page }) => {
  await page.setViewportSize(size); await independentFixture(page);
  await page.goto(`/tasks/${BUSINESS_ID}`);
  const detail = page.locator("[data-task-detail]");
  await expect(detail.getByText("线索已建档", { exact: true })).toBeVisible();
  expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("link", { name: /返回任务明细/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`independent-${size.width}.png`), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "登记事件", exact: true }).click();
  await expect(page.getByRole("button", { name: "提交已核验事件", exact: true })).toBeVisible();
  const box = await page.getByRole("button", { name: "提交已核验事件", exact: true }).boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
});

test("dark/reduced-motion and hidden technical evidence retain readable hierarchy", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await independentFixture(page, { theme: "dark" }); await page.goto(`/tasks/${BUSINESS_ID}`);
  await expect(page.getByText("线索已建档", { exact: true })).toBeVisible();
  await expect(page.getByText(verified.evidence_ref, { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "查看证据与追溯", exact: true }).click();
  await expect(page.getByText(verified.evidence_ref, { exact: false })).toBeVisible();
  await expect(page.getByText(/原始：2026-10-09T02:09:00.123Z/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("independent-dark.png"), fullPage: true, animations: "disabled" });
});


test("missing original row focuses the details region without clearing original filters", async ({ page }) => {
  await independentFixture(page);
  await page.goto("/tasks?period=week&source=business&q=MAX"); await openIndependentFromRow(page);
  await page.route("**/api/task-work-orders/dashboard**", route => route.fulfill({ json: { summary: { tasks: { total: 0, open: 0, blocked: 0 }, work_orders: { total: 0, open: 0, blocked: 0 } }, by_template: [], tasks: { items: [], page: { total: 0, next_cursor: null } } } }));
  await page.getByRole("link", { name: /返回任务明细/ }).click();
  await expect(page.getByRole("region", { name: "任务明细" })).toBeFocused();
  await expect(page.getByRole("status")).toContainText("未自动改变筛选");
  expect(new URL(page.url()).searchParams.get("q")).toBe("MAX");
});

test.describe("independent touch targets", () => {
  test.use({ hasTouch: true, viewport: { width: 860, height: 700 } });
  test("touch retains compact painted button and a 44px click target", async ({ page }) => {
    await independentFixture(page); await page.goto(`/tasks/${BUSINESS_ID}`);
    const back = page.getByRole("link", { name: /返回任务明细/ });
    await expect(back).toBeVisible();
    const before = await back.evaluate(el => ({ hit: el.getBoundingClientRect().height, paint: parseFloat(getComputedStyle(el, "::before").height) }));
    expect(before.hit).toBeGreaterThanOrEqual(44); expect(before.paint).toBe(24);
    await page.getByRole("button", { name: "登记事件", exact: true }).click();
    const sizes = await page.getByRole("button", { name: "提交已核验事件", exact: true }).evaluate(el => ({ hit: el.getBoundingClientRect().height, paint: parseFloat(getComputedStyle(el, "::before").height) }));
    expect(sizes.hit).toBeGreaterThanOrEqual(44); expect(sizes.paint).toBe(28);
  });
});

test("native Chrome 200 percent zoom uses browser zoom, not CSS scaling", async ({ baseURL }) => {
  const { chromium } = await import("@playwright/test");
  const { execFileSync } = await import("node:child_process");
  test.skip(!process.env.DISPLAY, "A real X11 display is required; CI runs under xvfb-run.");
  const browser = await chromium.launch({ headless: false, executablePath: process.env.PW_EXECUTABLE_PATH || "/usr/bin/chromium", args: ["--window-size=1440,900"] });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage(); await independentFixture(page);
    await page.goto(`${baseURL}/tasks/${BUSINESS_ID}`);
    await expect(page.getByText("线索已建档", { exact: true })).toBeVisible();
    const width = await page.evaluate(() => innerWidth);
    execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+plus", "ctrl+plus", "ctrl+plus", "ctrl+plus", "ctrl+plus"]);
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
    expect(await page.evaluate(() => innerWidth)).toBeLessThanOrEqual(width / 2 + 1);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("1");
    await expect(page.getByRole("link", { name: /返回任务明细/ })).toBeVisible();
    await page.getByRole("button", { name: "登记事件", exact: true }).click();
    const button = page.getByRole("button", { name: "提交已核验事件", exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight) + 1);
    expect(await page.locator("[data-task-detail]").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("independent-native-200-percent.png"), fullPage: true, animations: "disabled" });
  } finally { await browser.close(); }
});
