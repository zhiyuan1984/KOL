import { expect, test, type Page } from "@playwright/test";

/**
 * 管理侧员工页（/admin）：单选筛选、单行品牌列、两栏独立滚动，以及
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

test("员工页单选筛选与单行品牌列；管理绑定先试算覆盖再确认，撤销只对直接绑定", async ({ page }) => {
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

  // 筛选计数 + 单行 + 品牌列：姓名 / 邮箱 / 组织 / 品牌 / 岗位 / Agent / 操作，无独立状态列。
  await expect(directory.locator(".governance-rail .governance-count")).toHaveText("1 / 1 名员工");
  const row = directory.locator("[data-employee-row='usr_directory']");
  await expect(row).toBeVisible();
  await expect(row).toContainText("LT、PQ");
  await expect(row).toContainText("商务 Agent");
  // 每人一行：一行一个 [data-employee-row]，行内固定 7 格（姓名/邮箱/组织/品牌/岗位/Agent/操作，
  // 无独立状态列），行骨架是单行网格；长文本 nowrap + 省略号，不换行撑高行。
  const cells = await row.evaluate((el) => Array.from(el.children).map((child) => (child.textContent || "").trim()));
  expect(cells).toHaveLength(7);
  expect(cells[3]).toBe("LT、PQ");
  const lineContract = await row.evaluate((el) => {
    const gridRows = getComputedStyle(el).gridTemplateRows.trim().split(/\s+/).filter(Boolean);
    const emailCell = el.children[1] as HTMLElement;
    const style = getComputedStyle(emailCell);
    return {
      gridRows: gridRows.length,
      height: el.getBoundingClientRect().height,
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      emailWidth: Math.round(emailCell.getBoundingClientRect().width),
    };
  });
  expect(lineContract.gridRows).toBe(1);
  expect(lineContract.whiteSpace).toBe("nowrap");
  expect(lineContract.textOverflow).toBe("ellipsis");
  // 换行会把行撑到 ~72px（两行文本+内边距）；58px 是一行 + 行内按钮的高度。
  expect(lineContract.height).toBeLessThan(64);
  expect(lineContract.emailWidth).toBeGreaterThan(0);

  // 筛选组顺序按原型：品牌 → 账号 → 组织；每组恒一项选中；点已选中项不取消；计数随筛选联动。
  const groups = directory.locator(".governance-filter-group");
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0).locator("strong")).toHaveText("品牌");
  await expect(groups.nth(1).locator("strong")).toHaveText("账号");
  await expect(groups.nth(2).locator("strong")).toHaveText("组织");
  for (let index = 0; index < 3; index += 1) {
    await expect(groups.nth(index).locator("[aria-pressed=true]")).toHaveCount(1);
  }
  const brandGroup = groups.nth(0);
  const accountGroup = groups.nth(1);
  const orgGroup = groups.nth(2);
  await accountGroup.getByRole("button", { name: "停用", exact: true }).click();
  await expect(accountGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(directory.locator("[data-employee-row]")).toHaveCount(0);
  await expect(directory.locator(".governance-rail .governance-count")).toHaveText("0 / 1 名员工");
  await accountGroup.getByRole("button", { name: "停用", exact: true }).click();
  await expect(accountGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(directory.locator("[data-employee-row]")).toHaveCount(0);
  await accountGroup.getByRole("button", { name: "全部", exact: true }).click();
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await expect(directory.locator(".governance-rail .governance-count")).toHaveText("1 / 1 名员工");

  await brandGroup.getByRole("button", { name: "LT", exact: true }).click();
  await expect(brandGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await brandGroup.getByRole("button", { name: "PQ", exact: true }).click();
  await expect(directory.locator("[data-employee-row]")).toHaveCount(1);
  await brandGroup.getByRole("button", { name: "全部", exact: true }).click();
  await orgGroup.getByRole("button", { name: "推广部" }).click();
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
    { id: "org:research_institute", display_name: "研究院", parent_id: null },
    { id: "org:digital_intelligence_center", display_name: "数字智能中心", parent_id: "org:research_institute" },
    { id: "org:product_department", display_name: "产品部", parent_id: "org:digital_intelligence_center" },
    { id: "org:ai_product", display_name: "AI产品组", parent_id: "org:product_department" },
    { id: "org:promotion_department", display_name: "推广部", parent_id: null },
  ].map((unit, index) => ({ ...unit, company_id: "company:amperetime", level: index + 1, status: "active" }));
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: people }));
  await page.route("**/api/admin/agents", (route) => route.fulfill({ json: { agents: [], units: organizationUnits, people: [], skills: [], bases: [] } }));

  await page.goto("/admin");
  const directory = page.locator("[data-admin-employees]");
  const orgGroup = directory.locator(".governance-filter-group").nth(2);
  for (const name of ["AI产品组", "产品部", "数字智能中心", "研究院"]) {
    await orgGroup.getByRole("button", { name, exact: true }).click();
    await expect(directory.locator("[data-employee-row='sriphy']")).toBeVisible();
    await expect(directory.locator("[data-employee-row='usr_promotion']")).toHaveCount(0);
  }
  await orgGroup.getByRole("button", { name: "推广部", exact: true }).click();
  await expect(directory.locator("[data-employee-row='sriphy']")).toHaveCount(0);
  await expect(directory.locator("[data-employee-row='usr_promotion']")).toBeVisible();
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
