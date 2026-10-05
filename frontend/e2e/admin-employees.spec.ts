import { expect, test } from "@playwright/test";

/**
 * 管理侧员工页（/admin）：单选筛选、精简员工列表、两栏独立滚动，以及
 * 「管理绑定」弹窗的完整闭环：来源文案 → 选新 Agent 先试算覆盖 → 确认绑定 →
 * 直接绑定可撤销（先 revoke-preview 名单，再填原因）。
 */

const employee = {
  id: "usr_directory", name: "目录员工", username: "directory@amperetime.com", email: "directory@amperetime.com",
  site: "org:promotion_department", position: "KOL 经理", brands: ["LT", "PQ"], roles: ["employee"], active: true,
  avatar_url: "/avatars/employees/ye_guanwang.png",
};
const units = [{ id: "org:promotion_department", display_name: "推广部", company_id: "company:amperetime", parent_id: null, level: 1, status: "active" }];

type Json = Record<string, unknown>;

function baseAgent(id: string, name: string): Json {
  return {
    id, name, description: "合作跟进", status: "published", version: 1,
    skills: [], bindings: [], coverage: { org_version: 1, users: [], user_ids: [] }, knowledge: [],
  };
}

const agentTest = baseAgent("agent:test", "商务 Agent");
agentTest.coverage = { org_version: 1, users: [], user_ids: [employee.id] };
const agentOther = baseAgent("agent:other", "协作 Agent");

function directAccess(agentId: string, bindingId: string): Json {
  return {
    id: agentId, name: agentId === "agent:test" ? "商务 Agent" : "协作 Agent", status: "published",
    person_ref: "person:usr_directory", user_id: employee.id, display_name: "目录员工", via: "binding_target",
    via_unit_id: "org:promotion_department", via_unit_display_name: "推广部", binding_id: bindingId,
  };
}

const inheritedAccess: Json = {
  id: "agent:inherit", name: "继承 Agent", status: "published",
  person_ref: "person:usr_directory", user_id: employee.id, display_name: "目录员工", via: "unit_head",
  via_unit_id: "org:promotion_department", via_unit_display_name: "推广部", binding_id: "binding-inherit-1",
};

test("员工页单选筛选与精简列表；管理绑定先试算覆盖再确认，撤销只对直接绑定", async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => { nativeDialogs.push(`${dialog.type()}:${dialog.message()}`); void dialog.dismiss(); });

  let available: Json[] = [directAccess("agent:test", "binding-test-1"), inheritedAccess];
  const binds: Json[] = [];
  const revokes: Json[] = [];

  await page.route("**/api/admin/users", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: [employee] });
    else await route.continue();
  });
  await page.route("**/api/admin/agents", async (route) => {
    await route.fulfill({ json: { agents: [agentTest, agentOther], units, people: [], skills: [], bases: [] } });
  });
  await page.route("**/api/admin/users/usr_directory/agents", async (route) => {
    await route.fulfill({ json: { agents: available } });
  });
  await page.route("**/api/admin/agents/agent%3Aother/bindings/preview", async (route) => {
    await route.fulfill({
      json: {
        agent_id: "agent:other", org_version: 2,
        before: { person_refs: [], user_ids: [] },
        after: { person_refs: ["person:usr_directory"], user_ids: [employee.id] },
        added: [directAccess("agent:other", "binding-other-1")],
        removed: [],
      },
    });
  });
  await page.route("**/api/admin/agents/agent%3Aother/bindings", async (route) => {
    binds.push(route.request().postDataJSON() as Json);
    available = [...available, directAccess("agent:other", "binding-other-1")];
    await route.fulfill({ json: agentOther });
  });
  await page.route("**/api/admin/agents/agent%3Atest/bindings/binding-test-1/revoke-preview", async (route) => {
    await route.fulfill({
      json: {
        agent_id: "agent:test", org_version: 2,
        before: { person_refs: ["person:usr_directory"], user_ids: [employee.id] },
        after: { person_refs: [], user_ids: [] },
        added: [],
        removed: [directAccess("agent:test", "binding-test-1")],
      },
    });
  });
  await page.route("**/api/admin/agents/agent%3Atest/bindings/binding-test-1", async (route) => {
    revokes.push(route.request().postDataJSON() as Json);
    available = available.filter((row) => row.binding_id !== "binding-test-1");
    await route.fulfill({ json: agentTest });
  });

  await page.goto("/admin");
  const directory = page.locator("[data-admin-employees]");
  await expect(directory).toBeVisible();
  await expect(directory.locator("[data-employee-row='usr_directory'] [data-employee-avatar]"))
    .toHaveAttribute("src", "/avatars/employees/ye_guanwang.png");

  await expect(directory.locator(".governance-main-head .governance-count")).toHaveText("1/1名员工");
  await expect(directory.locator(".governance-rail .governance-count")).toHaveCount(0);
  const row = directory.locator("[data-employee-row='usr_directory']");
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("LT、PQ");
  await expect(row).not.toContainText("KOL 经理");
  await expect(row).toContainText("商务 Agent");
  const cells = await row.evaluate((el) => Array.from(el.children).map((child) => (child.textContent || "").trim()));
  expect(cells).toHaveLength(4);
  const groups = directory.locator(".governance-filter-group");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator("strong")).toHaveText("品牌");
  await expect(groups.nth(1).locator("strong")).toHaveText("状态");
  for (let index = 0; index < 2; index += 1) {
    await expect(groups.nth(index).locator("[aria-pressed=true]")).toHaveCount(1);
  }
  const brandGroup = groups.nth(0);
  const accountGroup = groups.nth(1);
  const orgSelect = directory.locator("[data-employee-department=\"1\"]");
  await accountGroup.getByRole("button", { name: "停用", exact: true }).click();
  await expect(accountGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(directory.locator("[data-employee-row]")).toHaveCount(0);
  await expect(directory.locator(".governance-main-head .governance-count")).toHaveText("0/1名员工");
  await accountGroup.getByRole("button", { name: "停用", exact: true }).click();
  await expect(accountGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(directory.locator("[data-employee-row]")).toHaveCount(0);
  await accountGroup.getByRole("button", { name: "全部", exact: true }).click();
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await expect(directory.locator(".governance-main-head .governance-count")).toHaveText("1/1名员工");

  await brandGroup.getByRole("button", { name: "LT", exact: true }).click();
  await expect(brandGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await brandGroup.getByRole("button", { name: "PQ", exact: true }).click();
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await brandGroup.getByRole("button", { name: "全部", exact: true }).click();
  await orgSelect.selectOption("org:promotion_department");
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);

  // 两栏独立竖向滚动。
  const panes = await directory.locator(".governance-scroll").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).overflowY));
  expect(panes).toEqual(["auto", "auto"]);

  await row.getByRole("button", { name: "管理绑定" }).click();
  const dialog = page.getByRole("dialog", { name: "目录员工 · 管理绑定" });
  await expect(dialog).toBeVisible();
  // 来源文案：直接绑定 / 部门负责人；撤销只对直接绑定出现，继承来源只读。
  await expect(dialog.locator("[data-employee-agent='agent:test']")).toContainText("直接绑定");
  await expect(dialog.locator("[data-employee-agent='agent:inherit']")).toContainText("部门负责人");
  await expect(dialog.locator("[data-employee-agent='agent:inherit']")).toContainText("继承来源");
  await expect(dialog.getByRole("button", { name: "撤销" })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "撤销" })).toBeVisible();

  // 绑定新 Agent：先试算覆盖变化，再确认写入。
  await dialog.locator("label", { hasText: "协作 Agent" }).getByRole("radio").check();
  const preview = dialog.locator("[data-employee-binding-preview]");
  await expect(preview).toContainText("组织版本 2 · 将新增覆盖 1 人（绑定后共 1 人）");
  await expect(preview).toContainText("目录员工");
  await dialog.getByRole("button", { name: "确认绑定" }).click();
  await expect.poll(() => binds).toEqual([{ target_type: "person", user_id: "usr_directory", reason: "管理侧员工页绑定" }]);
  await expect(dialog.locator("[data-employee-agent='agent:other']")).toContainText("直接绑定");
  await expect(dialog.locator("p.governance-notice[role='status']")).toContainText("已将 目录员工 绑定到 Agent");

  // 撤销直接绑定：revoke-preview 名单 → 填原因 → 移除；继承来源不受影响。
  await dialog.locator("[data-employee-agent='agent:test']").getByRole("button", { name: "撤销" }).click();
  const confirm = page.locator("[data-admin-confirm='agent-binding-revoke']");
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-admin-confirm-change]")).toContainText("将移除 1 人：目录员工");
  await confirm.locator("[data-admin-confirm-reason]").fill("员工转岗");
  await confirm.locator("[data-admin-confirm-ok]").click();
  await expect.poll(() => revokes).toEqual([{ reason: "员工转岗" }]);
  await expect(dialog.locator("[data-employee-agent='agent:test']")).toHaveCount(0);
  await expect(dialog.locator("[data-employee-agent='agent:inherit']")).toBeVisible();
  await expect(dialog.locator("p.governance-notice[role='status']")).toContainText("直接绑定已撤销");
  expect(nativeDialogs).toEqual([]);
});

test("选择上级组织时包含下级组员工，不包含旁支员工", async ({ page }) => {
  const people = [
    { ...employee, id: "sriphy", name: "鄢棽", site: "org:ai_product" },
    { ...employee, id: "usr_promotion", name: "推广员工", site: "org:promotion_department" },
  ];
  const organizationUnits = [
    { id: "org:research_institute", display_name: "研究院", parent_id: null, level: 1 },
    { id: "org:product_department", display_name: "产品部", parent_id: "org:research_institute", level: 2 },
    { id: "org:ai_product", display_name: "AI产品组", parent_id: "org:product_department", level: 3 },
    { id: "org:promotion_department", display_name: "推广部", parent_id: null, level: 1 },
  ].map((unit) => ({ ...unit, company_id: "company:amperetime", status: "active" }));
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: people }));
  await page.route("**/api/admin/agents", (route) => route.fulfill({ json: { agents: [], units: organizationUnits, people: [], skills: [], bases: [] } }));
  await page.goto("/admin");
  const directory = page.locator("[data-admin-employees]");
  const first = directory.locator('[data-employee-department="1"]');
  const second = directory.locator('[data-employee-department="2"]');
  const third = directory.locator('[data-employee-department="3"]');
  await first.selectOption("org:research_institute");
  await expect(directory.locator("[data-employee-row='sriphy']")).toBeVisible();
  await expect(directory.locator("[data-employee-row='usr_promotion']")).toHaveCount(0);
  await second.selectOption("org:product_department");
  await third.selectOption("org:ai_product");
  await directory.getByRole("combobox", { name: "人员", exact: true }).selectOption("sriphy");
  await first.selectOption("org:promotion_department");
  await expect(second).toHaveValue("");
  await expect(third).toHaveValue("");
  await expect(second).toBeDisabled();
  await expect(directory.getByRole("combobox", { name: "人员", exact: true })).toHaveValue("");
  await expect(directory.locator("[data-employee-row='sriphy']")).toHaveCount(0);
  await expect(directory.locator("[data-employee-row='usr_promotion']")).toBeVisible();
  for (const width of [1280, 1024, 860]) {
    await page.setViewportSize({ width, height: 700 });
    await expect(directory.locator('[data-employee-row="usr_promotion"]').getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    expect(await directory.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
});

test("编辑员工统一控件高度，品牌全部支持半选，绑定失败不显示零统计", async ({ page }) => {
  let contextUnavailable = true;
  let saved: Json | undefined;
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: [employee] }));
  await page.route("**/api/admin/agents", (route) => route.fulfill({ json: { agents: [], units, people: [], skills: [], bases: [] } }));
  await page.route("**/api/admin/users/usr_directory/context", (route) => {
    return contextUnavailable ? route.fulfill({ status: 503, json: { detail: "绑定数据暂不可用" } }) : route.fulfill({ json: { user: employee, mailboxes: [], kols: [] } });
  });
  await page.route("**/api/admin/users/usr_directory", (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: employee });
  });
  await page.goto("/admin");
  await page.locator('[data-employee-row="usr_directory"]').getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑员工", exact: true });
  await expect(dialog).toContainText("绑定数据读取失败");
  await expect(dialog.locator(".employee-binding-summary")).toHaveCount(0);
  contextUnavailable = false;
  await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(dialog.locator(".employee-binding-summary")).toHaveText("当前共绑定 0 个邮箱，负责 0 个 KOL。");
  const all = dialog.getByRole("checkbox", { name: "全部", exact: true });
  await expect(all).toBeChecked();
  await dialog.getByRole("checkbox", { name: "LT", exact: true }).uncheck();
  expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true);
  await all.check();
  await expect(dialog.getByRole("checkbox", { name: "LT", exact: true })).toBeChecked();
  const sizes = await dialog.locator(".employee-form-grid input, .employee-form-grid select").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(new Set(sizes)).toEqual(new Set([32]));
  await dialog.locator("[data-employee-edit-save]").click();
  await expect(dialog).not.toBeVisible();
  expect(saved?.brands).toEqual(expect.arrayContaining(["LT", "PQ"]));
});
