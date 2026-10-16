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
  await page.getByRole("button", { name: /新建定时任务$/ }).click();
  await expect(page.getByRole("dialog", { name: "新建定时任务" })).toBeVisible();
  await expect(page.locator("[data-composer]")).toBeVisible();
  await expect(page.locator("[data-composer-input]")).toBeVisible();
  await expect(page.getByLabel("执行方式")).toBeVisible();
  await page.getByLabel("任务名称").fill("定时风险简报");
  await page.locator("[data-composer-input]").fill("扫描在途风险");
  await page.getByRole("button", { name: "保存为草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/cron\/cjob_/);
  const jobId = new URL(page.url()).pathname.split("/").at(-1);
  const saved = page.locator(`[data-cron-job="${jobId}"]`);
  await expect(saved).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("任务名称").fill("定时风险巡检");
  await page.getByRole("button", { name: "保存更改", exact: true }).click();
  const edited = page.locator(`[data-cron-job="${jobId}"]`);
  await expect(edited).toBeVisible();
  // Current flow saves a draft first. Explicit publication retains the review
  // confirmation and capability gate before a manual run becomes available.
  await page.getByRole("button", { name: "发布并启用", exact: true }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "核对并启用此任务？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "发布并启用", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  const detailDialog = page.getByRole("dialog", { name: "定时风险巡检" });
  const runNow = detailDialog.getByRole("button", { name: "立即运行", exact: true });
  await expect(runNow).toBeEnabled();
  await runNow.click();
  // Stub execution truthfully records a queued run; it must not fabricate a
  // completed session link before a worker produces one.
  await expect(detailDialog.getByRole("heading", { name: "最近执行" })).toBeVisible();
  await expect(detailDialog).toContainText("排队中");
  await expect(detailDialog.locator("[data-cron-timeline]")).toContainText("运行记录（1）");
  await expect(page).toHaveURL(/\/cron\/cjob_/);
});
