import { expect, test } from "@playwright/test";

test("cron list loads summaries, updates rows in place, and edits with the shared composer", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/cron/")) calls.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto("/cron");
  const list = page.locator("[data-cron-state='ok']");
  await expect(list).toBeVisible();
  await expect(list.locator("[data-cron-job]").first()).toBeVisible();
  expect(calls.filter((call) => call.includes("/runs") || /\/jobs\/[^/]+$/.test(call))).toEqual([]);
  const first = list.locator("[data-cron-job]").first();
  const status = await first.getAttribute("data-cron-status");
  if (status !== "disabled") {
    await first.locator("[data-cron-pause]").click();
    await expect(first).toHaveAttribute("data-cron-status", status === "paused" ? "published" : "paused");
    await expect(page).toHaveURL(/\/cron$/);
  }
  await page.getByRole("link", { name: "新建定时任务" }).click();
  await expect(page.getByRole("heading", { name: "新建定时任务" })).toBeVisible();
  await expect(page.locator("[data-composer]")).toBeVisible();
  await expect(page.locator("[data-composer-input]")).toBeVisible();
  await expect(page.getByLabel("执行方式")).toBeVisible();
  await page.getByLabel("任务名称").fill("定时风险简报");
  await page.locator("[data-composer-input]").fill("扫描在途风险");
  await page.getByRole("button", { name: "保存定时任务" }).click();
  await expect(page).toHaveURL(/\/cron\/cjob_/);
  const jobId = new URL(page.url()).pathname.split("/").at(-1);
  const saved = page.locator(`[data-cron-job="${jobId}"]`);
  await expect(saved).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("任务名称").fill("定时风险巡检");
  await page.getByRole("button", { name: "保存定时任务" }).click();
  const edited = page.locator(`[data-cron-job="${jobId}"]`);
  await expect(edited).toBeVisible();
  await edited.locator("[data-cron-run-now]").click();
  await expect(edited).toContainText("查看执行");
  await expect(page).toHaveURL(/\/cron\/cjob_/);
});
