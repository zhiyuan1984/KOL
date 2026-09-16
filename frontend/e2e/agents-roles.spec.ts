import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("roster keeps one sidebar entry and three role cards", async ({ page }) => {
  await page.goto("/agents");
  await expect(page.locator("[data-expert-page='roster']")).toBeVisible();
  await expect(page.locator("[data-expert-card='expert:kol']")).toBeVisible();
  await expect(page.locator("[data-expert-card='expert:crawler']")).toBeVisible();
  await expect(page.locator("[data-expert-card='expert:approver']")).toBeVisible();
  await expect(page.locator('nav[aria-label="数字员工"] [data-nav]')).toHaveCount(1);
  await expect(page.locator('[data-nav="approvals"]')).toBeVisible();
  await expect(page.locator('[data-nav="law"]')).toHaveCount(0);
  await expect(page.locator(".sidebar")).not.toContainText("数字宪法");
});

test("kol primary CTA summons a bound session", async ({ page }) => {
  const sideEffects: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();
    if (method !== "POST" && method !== "PUT" && method !== "PATCH") return;
    if (
      /\/messages(?:\?|$)/.test(url)
      || /\/drafts\/[^/]+\/send/.test(url)
      || /\/confirm-stage/.test(url)
    ) {
      sideEffects.push(`${method} ${url}`);
    }
  });
  await page.goto("/agents");
  const summonWait = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/api/experts/")
    && response.url().includes("/summon")
  ));
  await page.locator("[data-expert-primary='expert:kol']").click();
  const body = await (await summonWait).json() as Record<string, unknown>;
  await page.waitForURL(/\/s\//);
  expect(body.expert_id).toBe("expert:kol");
  await expect(page.locator("[data-expert-identity='expert:kol']")).toBeVisible();
  expect(sideEffects).toEqual([]);
});

test("crawler and approver primary CTAs do not summon", async ({ page }) => {
  const summons: string[] = [];
  const sessions: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().includes("/summon")) summons.push(request.url());
    if (/\/api\/sessions(?:\?|$)/.test(request.url())) sessions.push(request.url());
  });

  await page.goto("/agents");
  await page.locator("[data-expert-primary='expert:crawler']").click();
  await expect(page).toHaveURL(/\/agents\/crawler/);
  await expect(page.locator("[data-expert-page='crawler']")).toBeVisible();
  await expect(page.locator("[data-crawl-console]")).toBeVisible();
  await expect(page.locator("[data-crawler-analyze-disabled]")).toContainText("分析走作业台，不建思考会话");
  await expect(page.locator("[data-crawler-analyze-go]")).toHaveCount(0);
  await expect(page.locator("[data-expert-page='crawler']")).not.toContainText("正在思考");
  await expect(page.getByRole("button", { name: "已入库" })).toHaveCount(0);
  await expect(page.locator("[data-crawler-status-copy='已入库']")).toHaveCount(0);
  expect(summons).toEqual([]);
  expect(sessions).toEqual([]);

  await page.goto("/agents");
  await page.locator("[data-expert-primary='expert:approver']").click();
  await expect(page).toHaveURL(/\/agents\/approver/);
  await expect(page.locator("[data-expert-page='approver']")).toBeVisible();
  await expect(page.locator("[data-approval-queue='embedded']")).toBeVisible();
  await expect(page.locator("[data-expert-summon='expert:approver']")).toHaveCount(0);
  expect(summons).toEqual([]);
  expect(sessions).toEqual([]);
});
