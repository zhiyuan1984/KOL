import { expect, test, type Page } from "@playwright/test";

/**
 * 管理侧 Agent 页（/admin/agents）：两组单选筛选、新增 Agent 草稿、五节详情、
 * 「预览覆盖变化 → 确认绑定」「revoke-preview → 原因 → 移除」与发布闸门。
 *
 * 与 admin-employees.spec.ts 同一约定：admin/agents 的读写全部按真实接口契约在
 * page.route 里桩化。真实 stub 后端可写但不可删除 Agent，落库会污染后续运行；
 * 桩数据按 config/org-registry.yaml 的真实口径构造（含三级组组织单元）。
 */

const COMPANY = "company:amperetime";

const UNITS = [
  { id: "org:brand_user_growth_center", display_name: "品牌与用户增长中心", company_id: COMPANY, parent_id: null, level: 1, status: "active" },
  { id: "org:research_institute", display_name: "研究院", company_id: COMPANY, parent_id: null, level: 1, status: "active" },
  { id: "org:promotion_department", display_name: "推广部", company_id: COMPANY, parent_id: "org:brand_user_growth_center", level: 2, status: "active" },
  { id: "org:digital_intelligence_center", display_name: "数智中心", company_id: COMPANY, parent_id: "org:research_institute", level: 2, status: "active" },
  { id: "org:lt_team", display_name: "LT组", company_id: COMPANY, parent_id: "org:promotion_department", level: 3, status: "active" },
  { id: "org:ai_product", display_name: "AI产品", company_id: COMPANY, parent_id: "org:digital_intelligence_center", level: 3, status: "active" },
];

const PEOPLE = [
  { person_ref: "person:yan_chen", display_name: "鄢棽", user_id: "sriphy", status: "active" },
  { person_ref: "person:ye_guanwang", display_name: "叶观旺", user_id: "usr_lead", status: "active" },
];

const SKILLS = [{ id: "creator_profile", label: "达人画像", category: "线索", summary: "查看红人详情与负责人" }];

type Json = Record<string, unknown>;

type AgentRow = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "disabled";
  version: number;
  created_at: string;
  updated_at: string;
  skills: Json[];
  bindings: Json[];
  coverage: { org_version: number; users: Json[]; person_refs: string[]; user_ids: string[] };
  knowledge: Json[];
};

const stamp = "2026-10-03T10:48:06.825Z";

function yanAccess(bindingId: string): Json {
  return {
    person_ref: "person:yan_chen", user_id: "sriphy", display_name: "鄢棽", via: "binding_target",
    via_unit_id: "org:ai_product", via_unit_display_name: "AI产品", binding_id: bindingId,
  };
}

function personBinding(id: string, agentId: string, target: string): Json {
  return {
    id, agent_id: agentId, target_type: "person", target_id: target, company_id: COMPANY, status: "active",
    binding_version: 1, org_version: 1, reason: "试点", created_by: "admin", created_at: stamp, updated_at: stamp,
  };
}

function baseAgent(overrides: Partial<AgentRow> & Pick<AgentRow, "id" | "name">): AgentRow {
  return {
    description: "合作跟进", status: "published", version: 1, created_at: stamp, updated_at: stamp,
    skills: [], bindings: [], coverage: { org_version: 1, users: [], person_refs: [], user_ids: [] }, knowledge: [],
    ...overrides,
  };
}

const AGENT_KOL: AgentRow = baseAgent({
  id: "agent:kol",
  name: "KOL 助理",
  version: 3,
  skills: [{ agent_id: "agent:kol", skill_id: "creator_profile", enabled: 1, version: 2 }],
  bindings: [personBinding("binding-kol-yan", "agent:kol", "person:yan_chen")],
  coverage: { org_version: 1, users: [yanAccess("binding-kol-yan")], person_refs: ["person:yan_chen"], user_ids: ["sriphy"] },
});

const AGENT_SALES: AgentRow = baseAgent({
  id: "agent:sales",
  name: "商务 Agent",
  bindings: [{
    id: "binding-sales-lt", agent_id: "agent:sales", target_type: "organization_unit", target_id: "org:lt_team",
    company_id: COMPANY, status: "active", binding_version: 1, org_version: 1, reason: null, created_by: "admin",
    created_at: stamp, updated_at: stamp,
  }],
  coverage: { org_version: 1, users: [], person_refs: [], user_ids: [] },
});

const AGENT_DRAFT: AgentRow = baseAgent({
  id: "agent:empty", name: "空草稿", description: "", status: "draft",
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** admin/agents 全接口桩：按真实后端契约维护一份可变状态，记录写调用。 */
async function stubAgentBackend(page: Page, seed: AgentRow[]) {
  const state = {
    agents: clone(seed),
    previews: [] as Json[],
    binds: [] as Json[],
    unbinds: [] as Json[],
    patches: [] as Json[],
  };
  const find = (id: string) => state.agents.find((agent) => agent.id === id);
  await page.route("**/api/admin/agents**", async (route) => {
    const request = route.request();
    const method = request.method();
    const segments = new URL(request.url()).pathname.split("/").map((segment) => decodeURIComponent(segment));
    const id = segments[4] || "";
    const sub = segments[5] || "";
    const sub2 = segments[6] || "";
    const body = (): Json => { try { return JSON.parse(request.postData() || "{}") as Json; } catch { return {}; } };
    if (method === "GET" && !id) {
      return route.fulfill({ json: { agents: state.agents, units: UNITS, people: PEOPLE, skills: SKILLS, bases: [] } });
    }
    if (method === "GET" && sub === "audit") {
      return route.fulfill({ json: { items: [{ id: 1, ts: stamp, actor: "sriphy", event_type: "admin.agent.bind", payload: { binding_id: "binding-kol-yan", target_type: "person", target_id: "person:yan_chen" } }], next_cursor: null } });
    }
    if (method === "POST" && !id) {
      const input = body();
      const created = baseAgent({ id: "agent:risk_e2e", name: String(input.name || "未命名"), description: String(input.description || ""), status: "draft" });
      state.agents = [created, ...state.agents];
      return route.fulfill({ status: 201, json: created });
    }
    if (method === "PATCH" && id && !sub) {
      const input = body();
      state.patches.push({ id, ...input });
      const agent = find(id);
      if (!agent) return route.fulfill({ status: 404, json: { detail: "Agent 不存在" } });
      if (input.status === "published") {
        if (!agent.skills.some((skill) => Number(skill.enabled) === 1)) {
          return route.fulfill({ status: 409, json: { detail: "发布前请先装配至少一项技能" } });
        }
        if (!agent.bindings.length) return route.fulfill({ status: 409, json: { detail: "发布前请先绑定组织或人员" } });
      }
      if (typeof input.status === "string") agent.status = input.status as AgentRow["status"];
      agent.version += 1;
      return route.fulfill({ json: agent });
    }
    if (method === "POST" && sub === "bindings" && sub2 === "preview") {
      const input = body();
      state.previews.push(input);
      const agent = find(id);
      if (!agent) return route.fulfill({ status: 404, json: { detail: "Agent 不存在" } });
      const targetId = String(input.target_id || input.user_id || "");
      const added: Json[] = [];
      if (input.target_type === "organization_unit" && targetId === "org:lt_team") {
        added.push({
          person_ref: "person:ye_guanwang", user_id: "usr_lead", display_name: "叶观旺", via: "unit_head",
          via_unit_id: "org:lt_team", via_unit_display_name: "LT组", binding_id: "binding-kol-lt",
        });
      }
      const after = [...agent.coverage.users, ...added.filter((entry) => !agent.coverage.users.some((user) => user.person_ref === entry.person_ref))];
      return route.fulfill({
        json: {
          agent_id: id,
          org_version: agent.coverage.org_version + 1,
          before: { person_refs: agent.coverage.person_refs, user_ids: agent.coverage.user_ids },
          after: { person_refs: after.map((user) => user.person_ref), user_ids: after.map((user) => user.user_id) },
          added,
          removed: [],
        },
      });
    }
    if (method === "POST" && sub === "bindings" && !sub2) {
      const input = body();
      state.binds.push(input);
      const agent = find(id);
      if (!agent) return route.fulfill({ status: 404, json: { detail: "Agent 不存在" } });
      const bindingId = input.target_type === "organization_unit" && input.target_id === "org:lt_team" ? "binding-kol-lt" : `binding-${agent.bindings.length + 1}`;
      agent.bindings = [...agent.bindings, {
        id: bindingId, agent_id: id, target_type: input.target_type, target_id: input.target_id || input.user_id,
        company_id: COMPANY, status: "active", binding_version: 1, org_version: agent.coverage.org_version + 1,
        reason: input.reason || null, created_by: "sriphy", created_at: stamp, updated_at: stamp,
      }];
      agent.coverage = {
        ...agent.coverage,
        org_version: agent.coverage.org_version + 1,
        users: [...agent.coverage.users, {
          person_ref: "person:ye_guanwang", user_id: "usr_lead", display_name: "叶观旺", via: "unit_head",
          via_unit_id: "org:lt_team", via_unit_display_name: "LT组", binding_id: bindingId,
        }],
        person_refs: [...agent.coverage.person_refs, "person:ye_guanwang"],
        user_ids: [...agent.coverage.user_ids, "usr_lead"],
      };
      return route.fulfill({ json: agent });
    }
    if (method === "POST" && sub === "bindings" && sub2 && segments[7] === "revoke-preview") {
      const agent = find(id);
      if (!agent) return route.fulfill({ status: 404, json: { detail: "Agent 不存在" } });
      const bindingId = sub2;
      const removed = agent.coverage.users.filter((user) => user.binding_id === bindingId);
      const after = agent.coverage.users.filter((user) => user.binding_id !== bindingId);
      return route.fulfill({
        json: {
          agent_id: id,
          org_version: agent.coverage.org_version,
          before: { person_refs: agent.coverage.person_refs, user_ids: agent.coverage.user_ids },
          after: { person_refs: after.map((user) => user.person_ref), user_ids: after.map((user) => user.user_id) },
          added: [],
          removed,
        },
      });
    }
    if (method === "DELETE" && sub === "bindings" && sub2) {
      const input = body();
      state.unbinds.push({ binding_id: sub2, reason: input.reason });
      const agent = find(id);
      if (!agent) return route.fulfill({ status: 404, json: { detail: "Agent 不存在" } });
      agent.bindings = agent.bindings.filter((binding) => binding.id !== sub2);
      const users = agent.coverage.users.filter((user) => user.binding_id !== sub2);
      agent.coverage = { ...agent.coverage, users, person_refs: users.map((user) => user.person_ref), user_ids: users.map((user) => user.user_id) };
      return route.fulfill({ json: agent });
    }
    return route.fulfill({ status: 500, json: { detail: `unhandled ${method} ${segments.join("/")}` } });
  });
  return state;
}

/** 守护断言：全程不得出现原生 dialog（alert/confirm/prompt）。 */
function guardNativeDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (dialog) => { seen.push(`${dialog.type()}:${dialog.message()}`); void dialog.dismiss(); });
  return seen;
}

function filterGroup(page: Page, label: string) {
  return page.locator(".governance-filter-group").filter({ hasText: label });
}

test("Agent 页状态与绑定类型两组筛选恒一项选中，点已选中项不取消", async ({ page }) => {
  const native = guardNativeDialogs(page);
  await stubAgentBackend(page, [AGENT_KOL, AGENT_SALES, AGENT_DRAFT]);
  await page.goto("/admin/agents");
  const root = page.locator("[data-admin-page='agents']");
  await expect(root).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 Agent" })).toBeVisible();
  await expect(page.locator(".governance-agent-row")).toHaveCount(3);
  await expect(page.locator(".governance-count").first()).toHaveText("3 / 3 个 Agent");

  await expect(filterGroup(page, "绑定类型").locator("button")).toHaveCount(4);
  for (const label of ["发布状态", "绑定类型"]) {
    await expect(filterGroup(page, label).locator("[aria-pressed=true]")).toHaveCount(1);
  }

  const statusGroup = filterGroup(page, "发布状态");
  const bindingGroup = filterGroup(page, "绑定类型");
  await statusGroup.getByRole("button", { name: "已发布", exact: true }).click();
  await expect(statusGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);
  // 点已选中项不取消：仍是同一项选中，列表不变。
  await statusGroup.getByRole("button", { name: "已发布", exact: true }).click();
  await expect(statusGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(statusGroup.getByRole("button", { name: "已发布", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);

  await statusGroup.getByRole("button", { name: "草稿", exact: true }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await bindingGroup.getByRole("button", { name: "组织单元", exact: true }).click();
  await expect(bindingGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await expect(page.locator(".governance-empty")).toContainText("没有符合条件的 Agent");
  await bindingGroup.getByRole("button", { name: "人员", exact: true }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await bindingGroup.getByRole("button", { name: "未绑定", exact: true }).click();
  await expect(bindingGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("空草稿");

  await statusGroup.getByRole("button", { name: "全部", exact: true }).click();
  // 绑定类型「未绑定」仍生效：只剩空草稿。
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("空草稿");
  await statusGroup.getByRole("button", { name: "已发布", exact: true }).click();
  await bindingGroup.getByRole("button", { name: "人员", exact: true }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("KOL 助理");
  await bindingGroup.getByRole("button", { name: "组织单元", exact: true }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("商务 Agent");
  await bindingGroup.getByRole("button", { name: "未绑定", exact: true }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await bindingGroup.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);
  expect(native).toEqual([]);
});

test("新增 Agent 弹窗创建草稿；空草稿直接发布被 409 拒绝并显示原因", async ({ page }) => {
  const native = guardNativeDialogs(page);
  const state = await stubAgentBackend(page, [AGENT_KOL, AGENT_SALES]);
  await page.goto("/admin/agents");
  const root = page.locator("[data-admin-page='agents']");
  await expect(root).toBeVisible();

  // 新增走居中模态弹窗：名称必填、创建后关弹窗并选中新 Agent。
  await page.getByRole("button", { name: "新增 Agent" }).click();
  const createDialog = page.getByRole("dialog", { name: "新增 Agent" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog).toContainText("创建后为草稿");
  await createDialog.getByLabel("Agent 名称", { exact: true }).fill("风控 Agent");
  await createDialog.getByLabel("描述", { exact: true }).fill("风险巡检与告警");
  await createDialog.getByRole("button", { name: "创建 Agent" }).click();
  await expect(createDialog).toHaveCount(0);

  await expect(root.getByRole("status")).toContainText("Agent 草稿已创建");
  await expect(page.locator(".governance-agent-row", { hasText: "风控 Agent" })).toBeVisible();
  await expect(page.locator(".governance-count").first()).toHaveText("3 / 3 个 Agent");
  await expect(root.locator(".governance-main-head h2")).toHaveText("风控 Agent");

  // 五节详情（技能与知识库 / 人员范围 / 发布 / 运行与审计 / 版本）。
  for (const section of ["技能与知识库", "人员范围", "发布", "运行与审计", "版本"]) {
    await expect(root.getByRole("heading", { name: section, exact: true })).toBeVisible();
  }
  await expect(root).toContainText("尚未绑定组织单元或人员");
  await expect(root.locator(".governance-audit-row")).toHaveCount(1);

  await root.getByRole("button", { name: "发布 Agent" }).click();
  const publishDialog = page.locator("[data-admin-confirm='agent-publish']");
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.locator("[data-admin-confirm-scope]")).toContainText("草稿 → 已发布");
  await expect(publishDialog.locator("[data-admin-confirm-change]")).toContainText("启用技能 0 项");
  await publishDialog.locator("[data-admin-confirm-ok]").click();
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.locator("[role='alert']")).toContainText("发布前请先装配至少一项技能");
  expect(state.patches).toEqual([{ id: "agent:risk_e2e", status: "published", expected_version: 1 }]);
  await publishDialog.locator("[data-admin-confirm-cancel]").click();
  await expect(publishDialog).toHaveCount(0);
  expect(native).toEqual([]);
});

test("绑定三级组先预览覆盖变化再确认；撤绑走 revoke-preview 名单与原因", async ({ page }) => {
  const native = guardNativeDialogs(page);
  const state = await stubAgentBackend(page, [clone(AGENT_KOL)]);
  await page.goto("/admin/agents");
  const root = page.locator("[data-admin-page='agents']");
  await expect(root).toBeVisible();
  await expect(root.locator(".governance-main-head h2")).toHaveText("KOL 助理");
  await expect(root).toContainText("组织版本 1");
  await expect(root.locator(".governance-via-group", { hasText: "直接绑定" })).toContainText("直接绑定 · 1 人");

  // 三级组是可选绑定点：optgroup 按层级分组。
  const target = page.getByLabel("选择目标");
  await expect(target.locator("optgroup[label='三级组'] option")).toHaveCount(2);
  await target.selectOption("org:lt_team");
  await page.getByRole("button", { name: "预览绑定影响" }).click();
  const preview = page.locator("[data-agent-binding-preview]");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("组织版本 2 · 将新增覆盖 1 人（绑定后共 2 人）");
  await expect(preview).toContainText("叶观旺");
  await expect(preview).toContainText("部门负责人 · LT组");
  expect(state.previews).toEqual([{ target_type: "organization_unit", target_id: "org:lt_team" }]);

  await preview.getByRole("button", { name: "确认绑定" }).click();
  await expect(root.getByRole("status")).toContainText("绑定已保存，覆盖人员按组织树重新计算。");
  expect(state.binds).toEqual([{ target_type: "organization_unit", target_id: "org:lt_team", reason: "管理侧 Agent 页面绑定" }]);
  const bindingRow = page.locator(".governance-row-split", { hasText: "LT组" });
  await expect(bindingRow).toContainText("组织单元 · LT组");
  await expect(root).toContainText("覆盖名单（按来源分组 · 共 2 人）");
  await expect(root).toContainText("部门负责人 · 1 人");
  await expect(root).toContainText("组织版本 2");

  // 撤绑：先 revoke-preview 给出将移除名单，再填原因确认移除。
  await bindingRow.getByRole("button", { name: "撤销" }).click();
  const confirm = page.locator("[data-admin-confirm='agent-binding-revoke']");
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-admin-confirm-change]")).toContainText("将移除 1 人：叶观旺");
  await confirm.locator("[data-admin-confirm-reason]").fill("试点结束");
  await confirm.locator("[data-admin-confirm-ok]").click();
  await expect(root.getByRole("status")).toContainText("绑定已撤销，覆盖名单已按组织树重算。");
  expect(state.unbinds).toEqual([{ binding_id: "binding-kol-lt", reason: "试点结束" }]);
  await expect(page.locator(".governance-row-split", { hasText: "LT组" })).toHaveCount(0);
  await expect(root).toContainText("覆盖名单（按来源分组 · 共 1 人）");
  expect(native).toEqual([]);
});
