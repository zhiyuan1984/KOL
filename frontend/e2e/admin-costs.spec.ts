import { expect, test } from "@playwright/test";

const summary = {
  month: "2026-09",
  timezone: "Asia/Shanghai",
  window: { start: "2026-08-31T16:00:00.000Z", end: "2026-09-30T16:00:00.000Z" },
  totals: { input_tokens: 1200, output_tokens: 800, total_tokens: 2000, events: 3 },
  agents: [{ agent_id: "agent:kol", input_tokens: 1200, output_tokens: 800, total_tokens: 2000, events: 3 }],
  users: [{ user_id: "usr_demo", input_tokens: 700, output_tokens: 300, total_tokens: 1000, events: 1 }],
  budgets: [
    {
      scope: "company",
      scope_ref: "company:amperetime",
      limit_tokens: 10000,
      warn_percent: 80,
      hard_stop_percent: 100,
      enabled: 1,
      version: 2,
      used_tokens: 2000,
      percent: 20,
      state: "ok",
    },
    {
      scope: "agent",
      scope_ref: "agent:kol",
      limit_tokens: null,
      warn_percent: 80,
      hard_stop_percent: 100,
      enabled: null,
      version: null,
      used_tokens: 2000,
      percent: null,
      state: "unconfigured",
    },
    {
      scope: "user",
      scope_ref: "usr_demo",
      limit_tokens: 800,
      warn_percent: 80,
      hard_stop_percent: 100,
      enabled: 1,
      version: 4,
      used_tokens: 1000,
      percent: 125,
      state: "stopped",
    },
  ],
  notes: ["usage_estimated_source", "auxiliary_codex_calls_unmetered", "cost_cents_unavailable"],
};

const events = {
  events: [
    {
      id: "cost_1",
      occurred_at: "2026-09-29T03:10:00.000Z",
      agent_id: "agent:kol",
      user_id: "usr_demo",
      skill_id: "email_compose",
      session_id: "sess_1",
      thread_id: "thread_1",
      source: "codex_account_usage_estimated",
      input_tokens: 1200,
      output_tokens: 800,
      total_tokens: 2000,
      cost_cents: null,
    },
  ],
};

test("cost governance shows the month, honest gaps, and budget states without inventing money", async ({ page }) => {
  const saves: unknown[] = [];
  await page.route("**/api/admin/costs/summary**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(summary) });
  });
  await page.route("**/api/admin/costs/events**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(events) });
  });
  await page.route("**/api/admin/costs/budget", async (route) => {
    saves.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(summary.budgets[1]) });
  });
  await page.route("**/api/admin/users**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "usr_demo", name: "演示员工" }]),
    });
  });

  await page.goto("/admin/cost");
  const costs = page.locator("[data-admin-page='costs']");
  await expect(costs).toBeVisible();
  await expect(costs.getByRole("heading", { name: "成本与预算" })).toBeVisible();
  await expect(costs.locator("[data-cost-window]")).toContainText("2026-09 · Asia/Shanghai");
  await expect(costs.locator("[data-cost-window]")).toContainText("不显示金额");

  // 缺口如实呈现：估计值 / 辅助未计量 / 无金额，三条都在。
  await expect(costs.locator("[data-cost-notes]")).toContainText("估计值");
  await expect(costs.locator("[data-cost-disclosure]")).toContainText("辅助调用（邮件摘要 / 翻译 / 简报 / 意图识别等）暂未计量。");
  await expect(costs.locator("[data-cost-disclosure]")).toContainText("未配置价格来源，本页不显示金额。");

  // 按个人：id 映射成姓名，名称下方仍给原始 id 便于核对。
  const personUsage = costs.locator("[data-cost-user-row='usr_demo']");
  await expect(costs.locator("[data-cost-user-table]")).toContainText("演示员工");
  await expect(personUsage).toContainText("usr_demo");
  await expect(personUsage).toContainText("1,000");

  // 预算行：状态词是文字，不是只有颜色；percent 为 null 的行显示「—」。
  const company = costs.locator("[data-cost-budget-row='company:company:amperetime']");
  await expect(company.locator("[data-cost-budget-state]")).toHaveText("正常");
  await expect(company.locator("[data-cost-budget-usage]")).toContainText("2,000 / 10,000 tokens");
  await expect(company.locator("[data-cost-budget-usage]")).toContainText("20%");
  const agent = costs.locator("[data-cost-budget-row='agent:agent:kol']");
  await expect(agent.locator("[data-cost-budget-state]")).toHaveText("未配置");
  await expect(agent.locator("[data-cost-budget-usage]")).toContainText("—");
  // 员工预算行：只阻断该员工触发的新运行，判定顺序写在面板说明里。
  const person = costs.locator("[data-cost-budget-row='user:usr_demo']");
  await expect(person).toContainText("演示员工");
  await expect(person.locator("[data-cost-budget-state]")).toHaveText("已硬停");
  await expect(person.locator("[data-cost-budget-usage]")).toContainText("1,000 / 800 tokens");
  await expect(person.locator("[data-cost-budget-usage]")).toContainText("125%");
  await expect(costs.locator("[data-cost-budgets]")).toContainText("判定顺序：公司 → Agent → 员工");

  // 事件表与来源。
  await expect(costs.locator("[data-cost-event-table]")).toContainText("codex_account_usage_estimated");

  // 行级编辑：带版本写入；保存走 PUT 而不是页面级主 CTA。
  await agent.locator("[data-cost-budget-edit]").click();
  const editor = costs.locator("[data-cost-budget-editor='agent:agent:kol']");
  await expect(editor).toBeVisible();
  await editor.locator("input[name='limit_tokens']").fill("50000");
  await editor.locator("[data-cost-budget-save]").click();
  await expect.poll(() => saves).toEqual([
    {
      scope: "agent",
      scope_ref: "agent:kol",
      limit_tokens: 50000,
      warn_percent: 80,
      hard_stop_percent: 100,
      enabled: true,
      expected_version: 0,
    },
  ]);
});

test("cost governance falls back to raw user ids when the employee directory is unavailable", async ({ page }) => {
  await page.route("**/api/admin/costs/summary**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(summary) });
  });
  await page.route("**/api/admin/costs/events**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(events) });
  });
  await page.route("**/api/admin/users**", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "员工目录读取失败" }) });
  });

  await page.goto("/admin/cost");
  const costs = page.locator("[data-admin-page='costs']");
  await expect(costs).toBeVisible();
  // 姓名读不到就显示原始 id（静默降级），用量、预算与事件照常渲染。
  await expect(costs.locator("[data-cost-user-row='usr_demo']")).toContainText("usr_demo");
  await expect(costs.locator("[data-cost-user-row='usr_demo']")).toContainText("1,000");
  await expect(costs.locator("[data-cost-budget-row='user:usr_demo']")).toContainText("usr_demo");
  await expect(costs.locator("[data-cost-budget-row='user:usr_demo'] [data-cost-budget-state]")).toHaveText("已硬停");
  await expect(costs.locator("[data-cost-budget-table]")).toBeVisible();
  await expect(costs.locator("[data-cost-event-table]")).toBeVisible();
});
