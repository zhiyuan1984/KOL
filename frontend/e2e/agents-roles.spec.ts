import { test, expect } from "@playwright/test";

const now = "2026-10-16T00:00:00.000Z";
const authorized = { id: "agent:authorized-e2e", display_name: "已授权产品 Agent", version: "7", status: "published", profession: "产品协作", mission: "仅在员工已授权的已发布能力范围内协作。", description: "核对已发布产品资料并整理下一步。", kind: "business", primary_entry: "think", can_summon: true, skill_ids: ["creator_profile"], tool_ids: [], quick_prompts: ["核对当前产品资料"], good_at: ["产品资料核对"] };
const collector = { id: "agent:authorized-collector", display_name: "已授权采集作业", version: "3", status: "published", profession: "采集作业", mission: "以已授权采集作业处理公开候选。", description: "通过作业台处理采集。", kind: "collector", primary_entry: "job_console", can_summon: false, skill_ids: [], tool_ids: [], quick_prompts: [] };
const approver = { id: "agent:authorized-approver", display_name: "已授权审批处理", version: "4", status: "published", profession: "审批处理", mission: "仅在当前审批范围内处理待决事项。", description: "通过审批队列处理。", kind: "governance", primary_entry: "approval_queue", can_summon: false, skill_ids: [], tool_ids: [], quick_prompts: [] };

/** The fixture models a published assembly already qualified for the active employee. It never relaxes server 409 authorization. */
async function authorizedDirectory(page: import("@playwright/test").Page, rows = [authorized, collector, approver]) {
  await page.route("**/api/experts/browse", route => route.fulfill({ json: { rows: rows.map(row => ({ expert_id: row.id, published_by: "admin-e2e", updated_at: now, scopes: [] })), taxonomy: { domains: [], bases: [] } } }));
  await page.route("**/api/experts/preferences", route => route.fulfill({ json: [] }));
  await page.route(/\/api\/experts(?:\?.*)?$/, route => route.fulfill({ json: rows }));
  await page.route("**/api/experts/*/workspace**", route => route.fulfill({ json: { skills: [], knowledge: [], recent_session: null } }));
  await page.route("**/api/experts/*/preference", route => route.fulfill({ json: { expert_id: decodeURIComponent(route.request().url().split("/").at(-2) || ""), favorite: false, viewed_at: now } }));
}

test("directory keeps one sidebar entry and exposes only current authorized published Agent records", async ({ page }) => {
  await authorizedDirectory(page);
  await page.goto("/agents");
  await expect(page.locator("[data-expert-page='roster']")).toBeVisible();
  await expect(page.locator(`[data-expert-card='${authorized.id}']`)).toBeVisible();
  await expect(page.locator("[data-expert-card='expert:kol'], [data-expert-card='expert:crawler'], [data-expert-card='expert:approver']")).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Agent"] [data-nav]')).toHaveCount(1);
  await expect(page.locator('[data-nav="approvals"]')).toBeVisible();
  await expect(page.locator('[data-nav="law"]')).toHaveCount(0);
  await expect(page.locator(".sidebar")).not.toContainText("数字宪法");
});

test("authorized work-session CTA summons the bound Agent without drafting, sending, or approving", async ({ page }) => {
  await authorizedDirectory(page, [authorized]);
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
  await page.route("**/api/experts/*/summon", route => route.fulfill({ json: { session_id: "authorized-agent-session", expert_id: authorized.id, expert_version: "7", intro: "已进入授权工作会话。" } }));
  await page.goto("/agents");
  await page.locator(`[data-expert-open='${authorized.id}']`).click();
  const summonWait = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/api/experts/")
    && response.url().includes("/summon")
  ));
  await page.locator(`[data-expert-primary='${authorized.id}']`).click();
  const body = await (await summonWait).json() as Record<string, unknown>;
  await page.waitForURL("/s/authorized-agent-session");
  expect(body.expert_id).toBe(authorized.id);
  expect(sideEffects).toEqual([]);
});

test("authorized primary-entry consoles never submit a summon or create a work session", async ({ page }) => {
  await authorizedDirectory(page, [collector, approver]);
  const summons: string[] = [];
  const sessions: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().includes("/summon")) summons.push(request.url());
    if (/\/api\/sessions(?:\?|$)/.test(request.url())) sessions.push(request.url());
  });

  await page.goto("/agents");
  await page.locator(`[data-expert-open='${collector.id}']`).click();
  const collectorPrimary = page.locator(`[data-expert-primary='${collector.id}']`);
  await expect(collectorPrimary).toHaveText("查看采集作业");
  await expect(page.locator(`[data-expert-summon='${collector.id}']`)).toHaveCount(0);
  await collectorPrimary.click();
  expect(summons).toEqual([]);
  expect(sessions).toEqual([]);

  await page.goto("/agents");
  await page.locator(`[data-expert-open='${approver.id}']`).click();
  const approverPrimary = page.locator(`[data-expert-primary='${approver.id}']`);
  await expect(approverPrimary).toHaveText("处理审批");
  await expect(page.locator(`[data-expert-summon='${approver.id}']`)).toHaveCount(0);
  await approverPrimary.click();
  expect(summons).toEqual([]);
  expect(sessions).toEqual([]);
});
