import { expect, test } from "@playwright/test";

/**
 * 管理侧员工页（/admin）：单选筛选、精简员工列表、两栏独立滚动，以及
 * 「管理绑定」弹窗的完整闭环：来源文案 → 选新 Agent 先试算覆盖 → 确认绑定 →
 * 直接绑定可撤销（先 revoke-preview 名单，再填原因）。
 */

// 全部接口在浏览器内隔离。细分测试后注册的 route 覆盖此兜底，不接触真实员工。
test.beforeEach(async ({ page }) => {
  const account = { id: "admin-fixture", name: "测试管理员", roles: ["admin"], available_modes: ["employee", "admin"] };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/admin/retention-policy") json = {};
    await route.fulfill({ json });
  });
});

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

  await expect(directory.locator(".governance-main-head")).toHaveCount(0);
  await expect(directory.locator(".governance-rail .governance-count")).toHaveCount(0);
  const row = directory.locator("[data-employee-row='usr_directory']");
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("LT、PQ");
  await expect(row).not.toContainText("KOL 经理");
  await expect(row).toContainText("商务 Agent");
  const card = row.locator(".employee-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".employee-row-primary .employee-name")).toHaveText("目录员工");
  await expect(card.locator(".employee-row-primary .employee-agent")).toHaveText("商务 Agent");
  await expect(card.locator(".employee-row-primary .employee-status")).toHaveCount(0);
  await expect(card.locator(".employee-row-secondary .employee-email")).toHaveText("directory@amperetime.com");
  await expect(card.locator(".employee-actions button")).toHaveCount(3);
  await expect(card.getByRole("button", { name: "停用", exact: true })).toHaveCount(1);
  expect((await card.boundingBox())!.height).toBeLessThan(92);
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
  await expect(directory.locator(".governance-empty")).toHaveText("没有符合筛选条件的员工。");
  await accountGroup.getByRole("button", { name: "停用", exact: true }).click();
  await expect(accountGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(directory.locator("[data-employee-row]")).toHaveCount(0);
  await accountGroup.getByRole("button", { name: "全部", exact: true }).click();
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await expect(directory.locator(".governance-main-head")).toHaveCount(0);

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
    const card = directory.locator('[data-employee-row="usr_promotion"] .employee-card');
    await expect(card.locator(".employee-actions").getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await expect(card.locator("[data-employee-action='deactivate']")).toBeVisible();
    // 删除顶行重复状态后，操作组仍固定在主信息区域右缘。
    const edges = await card.evaluate((el) => {
      const main = el.querySelector(".employee-main")!.getBoundingClientRect().right;
      const actions = el.querySelector(".employee-actions")!.getBoundingClientRect().right;
      return Math.abs(main - actions);
    });
    expect(edges).toBeLessThanOrEqual(1);
    expect(await directory.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
});

test("组织筛选按权威成员关系；同一 Agent 经两个部门覆盖时两条来源都显示", async ({ page }) => {
  const people = [{ ...employee, id: "sriphy", name: "鄢棽", site: "深圳站", org_unit_ids: ["org:ai_product"], primary_org_unit_id: "org:ai_product" }];
  const organizationUnits = [
    { id: "org:research_institute", display_name: "研究院", parent_id: null, level: 1 },
    { id: "org:digital_intelligence_center", display_name: "数字智能中心", parent_id: "org:research_institute", level: 2 },
    { id: "org:ai_product", display_name: "AI产品组", parent_id: "org:digital_intelligence_center", level: 3 },
  ].map((unit) => ({ ...unit, company_id: "company:amperetime", status: "active" }));
  const source = (target: string, label: string) => ({
    via: "unit_member", via_unit_id: "org:ai_product", via_unit_display_name: "AI产品组", binding_id: `binding:agent:lead:organization_unit:${target}`,
    binding_target_type: "organization_unit", binding_target_id: target, binding_target_display_name: label,
  });
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: people }));
  await page.route("**/api/admin/agents", (route) => route.fulfill({ json: { agents: [], units: organizationUnits, people: [], skills: [], bases: [] } }));
  await page.route("**/api/admin/users/sriphy/agents", (route) => route.fulfill({ json: { agents: [{
    id: "agent:lead", name: "线索智能体", status: "published", person_ref: "person:yan_chen", user_id: "sriphy", display_name: "鄢棽",
    ...source("org:research_institute", "研究院"), sources: [source("org:research_institute", "研究院"), source("org:digital_intelligence_center", "数字智能中心")],
  }] } }));
  await page.goto("/admin");
  const directory = page.locator("[data-admin-employees]");
  await directory.locator('[data-employee-department="1"]').selectOption("org:research_institute");
  await expect(directory.locator("[data-employee-row='sriphy']")).toBeVisible();
  await directory.locator("[data-employee-row='sriphy']").getByRole("button", { name: "管理绑定", exact: true }).click();
  const row = page.locator("[data-employee-agent='agent:lead']");
  await expect(row.locator("[data-employee-agent-source]")).toHaveCount(2);
  await expect(row).toContainText("绑定点：研究院");
  await expect(row).toContainText("绑定点：数字智能中心");
  await expect(row).toContainText("继承来源");
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

test("停用员工确认卡：紧凑三区、执行中防重复、成功后更新账号状态", async ({ page }) => {
  const target = {
    id: "usr_deactivate", name: "停用对象", username: "deactivate@amperetime.com", email: "deactivate@amperetime.com",
    site: "", position: "KOL 经理", brands: [], roles: ["employee"], active: true,
  };
  let active = true;
  let releasePatch: (() => void) | null = null;
  const patches: Json[] = [];

  await page.route("**/api/admin/users", (route) => route.fulfill({ json: [{ ...target, active }] }));
  await page.route("**/api/admin/agents", (route) => route.fulfill({ json: { agents: [], units: [], people: [], skills: [], bases: [] } }));
  await page.route("**/api/admin/users/usr_deactivate", async (route) => {
    patches.push(route.request().postDataJSON() as Json);
    await new Promise<void>((resolve) => { releasePatch = resolve; });
    active = false;
    await route.fulfill({ json: { ...target, active: false } });
  });

  await page.goto("/admin");
  const row = page.locator("[data-employee-row='usr_deactivate']");
  await expect(row).toBeVisible();
  await row.locator("[data-employee-action='deactivate']").click();

  const dialog = page.locator("[data-admin-confirm='user-deactivate']");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "停用员工" })).toBeVisible();
  // 姓名＋邮箱、停用范围＋值同一行；影响与次要说明分行；默认取消提示不再渲染。
  await expect(dialog.locator("[data-admin-confirm-object]")).toContainText("停用对象");
  await expect(dialog.locator("[data-admin-confirm-object]")).toContainText("deactivate@amperetime.com");
  await expect(dialog.locator(".admin-confirm-scope-line")).toContainText("停用范围");
  await expect(dialog.locator("[data-admin-confirm-scope]")).toContainText("组织账号");
  await expect(dialog.locator("[data-admin-confirm-consequence]")).toContainText("无法登录");
  await expect(dialog.locator("[data-admin-confirm-note]")).toContainText("保留");
  await expect(dialog.locator("[data-admin-confirm-cancel-hint]")).toHaveCount(0);
  const geometry = await dialog.locator(".admin-confirm").evaluate((el) => {
    const personLine = el.querySelector("[data-admin-confirm-object]") as HTMLElement;
    const mail = personLine.querySelector("span") as HTMLElement;
    const scopeLine = el.querySelector(".admin-confirm-scope-line") as HTMLElement;
    const token = parseFloat(getComputedStyle(el).getPropertyValue("--dialog-w-sm"));
    return {
      sameLine: Math.abs(personLine.querySelector("strong")!.getBoundingClientRect().top - mail.getBoundingClientRect().top) < 2,
      personHeight: Math.round(personLine.getBoundingClientRect().height),
      scopeHeight: Math.round(scopeLine.getBoundingClientRect().height),
      width: Math.round(el.getBoundingClientRect().width),
      tokenWidth: Math.round(token),
    };
  });
  expect(geometry.sameLine).toBe(true);
  expect(geometry.personHeight).toBeLessThan(28);
  expect(geometry.scopeHeight).toBeLessThan(28);
  expect(geometry.width).toBe(geometry.tokenWidth);
  await expect(dialog.locator("[data-admin-confirm-cancel]")).toHaveText("取消");
  await expect(dialog.locator("[data-admin-confirm-cancel]")).toBeFocused();

  await dialog.locator("[data-admin-confirm-ok]").click();
  await expect(dialog.locator("[data-admin-confirm-ok]")).toHaveText("停用中…");
  await expect(dialog.locator("[data-admin-confirm-ok]")).toBeDisabled();
  await expect(dialog.locator("[data-admin-confirm-cancel]")).toBeDisabled();
  await expect.poll(() => Boolean(releasePatch)).toBe(true);
  releasePatch?.();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => patches).toEqual([{ active: false }]);
  await expect(row.locator("[data-employee-action='enable']")).toBeVisible();
  await expect(page.locator(".governance-notice")).toContainText("已停用");
});

test("停用失败时确认卡保持打开并在卡内显示原因", async ({ page }) => {
  const target = {
    id: "usr_deactivate_fail", name: "失败对象", username: "deactivate-fail@amperetime.com", email: "deactivate-fail@amperetime.com",
    site: "", position: "", brands: [], roles: ["employee"], active: true,
  };
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: [target] }));
  await page.route("**/api/admin/agents", (route) => route.fulfill({ json: { agents: [], units: [], people: [], skills: [], bases: [] } }));
  await page.route("**/api/admin/users/usr_deactivate_fail", (route) => route.fulfill({ status: 500, json: { message: "账号服务暂不可用" } }));

  await page.goto("/admin");
  const row = page.locator("[data-employee-row='usr_deactivate_fail']");
  await expect(row).toBeVisible();
  await row.locator("[data-employee-action='deactivate']").click();
  const dialog = page.locator("[data-admin-confirm='user-deactivate']");
  await expect(dialog).toBeVisible();
  await dialog.locator("[data-admin-confirm-ok]").click();
  await expect(dialog.locator("[role='alert']")).toContainText("账号服务暂不可用");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".governance-main .error")).toHaveCount(0);
  await expect(dialog.locator("[data-admin-confirm-ok]")).toHaveText("确认停用");
  await dialog.locator("[data-admin-confirm-cancel]").click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator("[data-employee-action='deactivate']")).toBeVisible();
});

// 员工列表呈现回归：数据为隔离夹具，不代表线上人员或实际绑定。
async function compactDirectoryFixture(page: import("@playwright/test").Page, theme = "light") {
  const people = [
    { ...employee, id: "compact_many", name: "多智能体员工", employee_no: "0999" },
    { ...employee, id: "compact_other", name: "另一位员工", avatar_url: null },
    { ...employee, id: "compact_single", name: "单智能体员工" },
    { ...employee, id: "compact_empty", name: "未绑定员工", username: "empty", email: "", avatar_url: null },
    { ...employee, id: "compact_long", name: "这是用于验证长姓名不会挤出操作区的员工姓名", employee_no: "123456789012345678901234567890", email: `${"long".repeat(30)}@amperetime.com` },
    { ...employee, id: "compact_disabled", name: "已停用员工", active: false },
  ];
  const agents = ["KOL 智能体", "产品专家", "线索智能体", "工作规划智能体", "知识问答智能体"].map((name, index) => ({
    ...baseAgent(`agent:compact-${index}`, name), status: index === 3 ? "draft" : index === 4 ? "disabled" : "published",
    coverage: { org_version: 1, users: [], user_ids: ["compact_many", "compact_other", ...(index === 0 ? ["compact_single"] : [])] },
  }));
  agents.push({ ...baseAgent("agent:long", "这是一个非常长的智能体名称".repeat(12)), status: "published", coverage: { org_version: 1, users: [], user_ids: ["compact_long"] } });
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") writes.push(request.method()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/preferences", (route) => route.fulfill({ json: { theme } }));
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: people }));
  await page.route("**/api/admin/agents", (route) => route.fulfill({ json: { agents, units, people: [], skills: [], bases: [] } }));
  await page.goto("/admin");
  await expect(page.locator('[data-employee-row="compact_many"] .employee-agent')).toContainText("KOL 智能体");
  return { writes, errors, agents };
}

test("智能体默认折叠、按员工独立展开且键盘可收起，不触发写接口", async ({ page }) => {
  const state = await compactDirectoryFixture(page);
  const many = page.locator('[data-employee-row="compact_many"]');
  const other = page.locator('[data-employee-row="compact_other"]');
  const toggle = many.locator(".employee-agent-toggle");
  await expect(toggle).toHaveText("更多");
  await expect(toggle).toHaveAccessibleName("更多");
  await expect(toggle).toHaveAttribute("title", /展开其余 \d+ 个智能体/);
  await expect(many.locator("[data-agent-toggle-measure]")).toHaveText("更多");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(many.locator(".employee-agent")).not.toContainText("知识问答");
  await expect(page.locator('[data-employee-row="compact_single"] .employee-agent-toggle')).toHaveCount(0);
  await expect(page.locator('[data-employee-row="compact_empty"] .employee-agent')).toHaveText("未绑定 Agent");
  await expect(page.locator('[data-employee-row="compact_empty"] .employee-email')).toHaveText("未登记邮箱");
  await expect(page.locator('[data-employee-row="compact_disabled"]').getByRole("button", { name: "启用", exact: true })).toHaveCount(1);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveText("收起");
  await expect(many.locator(".employee-agent")).toHaveText("KOL 智能体、产品专家、线索智能体、工作规划智能体（草稿）、知识问答智能体（停用）");
  const controlled = await toggle.getAttribute("aria-controls");
  expect(controlled).toBe(await many.locator(".employee-agent").getAttribute("id"));
  await expect(other.locator(".employee-agent-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveText("更多");
  await page.locator("[data-employee-search]").fill("多智能体");
  await expect(page.locator("[data-employee-row]")).toHaveCount(1);
  await page.locator("[data-employee-search]").fill("没有这个员工");
  await expect(page.locator(".governance-empty")).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const theme of ["light", "dark"]) {
  test(`紧凑员工列表：长字段、完整展开、各视口无溢出（${theme}）`, async ({ page }, info) => {
    const state = await compactDirectoryFixture(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const viewport of [{ width: 1920, height: 900 }, { width: 1440, height: 900 }, { width: 1280, height: 520 }, { width: 768, height: 900 }, { width: 375, height: 844 }]) {
      await page.setViewportSize(viewport);
      const directory = page.locator("[data-admin-employees]");
      await expect(directory.locator(".governance-main-head")).toHaveCount(0);
      const ordinary = directory.locator('[data-employee-row="compact_single"] .employee-card');
      const geometry = await ordinary.evaluate((el) => {
        const avatar = el.querySelector(".employee-avatar")!;
        const primary = el.querySelector(".employee-row-primary")!.getBoundingClientRect();
        const secondary = el.querySelector(".employee-row-secondary")!.getBoundingClientRect();
        return { height: el.getBoundingClientRect().height, avatarWidth: avatar.getBoundingClientRect().width,
          avatarHeight: avatar.getBoundingClientRect().height, radius: getComputedStyle(avatar).borderRadius,
          primaryHeight: primary.height, rowGap: secondary.top - primary.bottom,
          paddingTop: getComputedStyle(el).paddingTop,
          secondaryBorder: getComputedStyle(el.querySelector(".employee-row-secondary")!).borderTopWidth,
          cardOverflow: el.scrollWidth > el.clientWidth + 1 };
      });
      expect(geometry.avatarWidth).toBe(32);
      expect(geometry.avatarHeight).toBe(32);
      expect(geometry.radius).toBe("6px");
      expect(geometry.cardOverflow).toBe(false);
      expect(geometry.secondaryBorder).toBe("0px");
      expect(geometry.paddingTop).toBe("4px");
      expect(geometry.rowGap).toBe(0);
      if (viewport.width >= 1440) {
        expect(geometry.height).toBeLessThanOrEqual(54);
        expect(geometry.primaryHeight).toBe(20);
      }
      if (viewport.width >= 1280) expect(geometry.height).toBeLessThan(92);
      for (const row of await directory.locator("[data-employee-row]").all()) {
        await expect(row.locator(".employee-actions button")).toHaveCount(3);
        const measure = await row.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { overflow: el.scrollWidth > el.clientWidth + 1,
            id: el.getAttribute("data-employee-row"), width: el.clientWidth, scrollWidth: el.scrollWidth,
            fields: [...el.querySelectorAll(".employee-profile > *, .employee-agent-summary > :not(.employee-agent-measure)")].map((field) => ({ className: field.className, width: field.getBoundingClientRect().width })),
            actionsInside: [...el.querySelectorAll(".employee-actions button")].every((button) => { const b = button.getBoundingClientRect(); return b.left >= rect.left && b.right <= rect.right + 1; }) };
        });
        expect(measure.overflow, JSON.stringify({ viewport, measure })).toBe(false);
        expect(measure.actionsInside).toBe(true);
      }
      const long = directory.locator('[data-employee-row="compact_long"]');
      const toggle = long.locator(".employee-agent-toggle");
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveText("更多");
      await expect(toggle).toHaveAttribute("title", "查看完整智能体名称");
      await toggle.click();
      await expect(long.locator(".employee-agent")).toHaveText("这是一个非常长的智能体名称".repeat(12));
      expect(await long.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await toggle.click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`employees-${theme}-${viewport.width}.png`) });
    }
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test.describe("触摸员工目录", () => {
  test.use({ hasTouch: true });
  test("展开与操作命中区保持至少44px，窄屏不溢出", async ({ page }) => {
    const state = await compactDirectoryFixture(page);
    await page.setViewportSize({ width: 375, height: 844 });
    const row = page.locator('[data-employee-row="compact_many"]');
    const heights = await row.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    expect(heights.every((height) => height >= 44)).toBe(true);
    await row.locator(".employee-agent-toggle").tap();
    await expect(row.locator(".employee-agent-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});

test("智能体加载失败保留错误，不把失败误报为未绑定", async ({ page }) => {
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: [employee] }));
  let release: (() => void) | undefined;
  await page.route("**/api/admin/agents", async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 503, json: { message: "智能体目录暂不可用" } });
  });
  await page.goto("/admin");
  const summary = page.locator('[data-employee-row="usr_directory"] .employee-agent');
  await expect(summary).toHaveText("读取中…");
  await expect.poll(() => Boolean(release)).toBe(true);
  release?.();
  await expect(page.locator(".governance-main [role='alert']")).toContainText("智能体目录暂不可用");
  await expect(summary).not.toHaveText("未绑定 Agent");
});
