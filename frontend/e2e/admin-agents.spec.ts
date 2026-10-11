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
    if (method === "POST" && sub === "bindings" && sub2 === "bulk-preview") {
      const input = body();
      state.previews.push(input);
      const agent = find(id);
      if (!agent) return route.fulfill({ status: 404, json: { detail: "Agent 不存在" } });
      const targets = Array.isArray(input.targets) ? input.targets as Json[] : [];
      const target = targets[0] || {};
      const targetId = String(target.target_id || target.user_id || "");
      const added: Json[] = [];
      if (target.target_type === "organization_unit" && targetId === "org:lt_team") {
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
    if (method === "POST" && sub === "bindings" && sub2 === "bulk") {
      const input = body();
      state.binds.push(input);
      const agent = find(id);
      if (!agent) return route.fulfill({ status: 404, json: { detail: "Agent 不存在" } });
      const targets = Array.isArray(input.targets) ? input.targets as Json[] : [];
      const target = targets[0] || {};
      const targetType = String(target.target_type || "person");
      const targetId = String(target.target_id || target.user_id || "");
      const bindingId = targetType === "organization_unit" && targetId === "org:lt_team" ? "binding-kol-lt" : `binding-${agent.bindings.length + 1}`;
      agent.bindings = [...agent.bindings, {
        id: bindingId, agent_id: id, target_type: targetType, target_id: targetId,
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
      return route.fulfill({ json: { agent } });
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

test("Agent 页状态与绑定类型两组筛选恒一项选中；默认人员范围可主动扩至全部后逐项筛选", async ({ page }) => {
  const native = guardNativeDialogs(page);
  await stubAgentBackend(page, [AGENT_KOL, AGENT_SALES, AGENT_DRAFT]);
  await page.goto("/admin/agents");
  const root = page.locator("[data-admin-page='agents']");
  await expect(root).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 Agent" })).toBeVisible();
  const statusGroup = filterGroup(page, "发布状态");
  const bindingGroup = filterGroup(page, "绑定类型");
  const summary = root.locator("[aria-label='Agent 摘要']");
  await expect(bindingGroup.locator("button")).toHaveCount(7);
  for (const label of ["发布状态", "绑定类型"]) {
    await expect(filterGroup(page, label).locator("[aria-pressed=true]")).toHaveCount(1);
  }
  // 现行默认是「人员」，不是全量；点已选中项不取消。
  await expect(bindingGroup.getByRole("button", { name: /^人员\s*\d*$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("KOL 助理");
  await expect(page.locator(".governance-count").first()).toHaveText("1 / 3 个 Agent");
  await bindingGroup.getByRole("button", { name: /^人员\s*\d*$/ }).click();
  await expect(bindingGroup.getByRole("button", { name: /^人员\s*\d*$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);

  // 主动切至全范围，再验证全部筛选项；已渲染对象选中后由共享摘要呈现该对象。
  await bindingGroup.getByRole("button", { name: /^全部\s*\d*$/ }).click();
  await expect(bindingGroup.getByRole("button", { name: /^全部\s*\d*$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".governance-agent-row")).toHaveCount(3);
  await expect(page.locator(".governance-count").first()).toHaveText("3 / 3 个 Agent");
  await page.locator(".governance-agent-row", { hasText: "商务 Agent" }).click();
  await expect(summary).toContainText("商务 Agent");
  await expect(summary).toContainText("已发布");

  await statusGroup.getByRole("button", { name: /^已发布\s*\d*$/ }).click();
  await expect(statusGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);
  // 点已选中项不取消：仍是同一项选中，列表不变。
  await statusGroup.getByRole("button", { name: /^已发布\s*\d*$/ }).click();
  await expect(statusGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(statusGroup.getByRole("button", { name: /^已发布\s*\d*$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);

  await bindingGroup.getByRole("button", { name: /^公司\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);
  await bindingGroup.getByRole("button", { name: /^一级部门\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await expect(page.locator(".governance-empty")).toContainText("没有符合条件的 Agent");
  await bindingGroup.getByRole("button", { name: /^二级部门\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await bindingGroup.getByRole("button", { name: /^三级部门\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("商务 Agent");
  await bindingGroup.getByRole("button", { name: /^人员\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("KOL 助理");
  // 列表虽因筛选不再显示商务 Agent，共享摘要仍对应刚才选择的对象。
  await expect(summary).toContainText("商务 Agent");
  await bindingGroup.getByRole("button", { name: /^未绑定\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await bindingGroup.getByRole("button", { name: /^全部\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);

  await statusGroup.getByRole("button", { name: /^草稿\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await bindingGroup.getByRole("button", { name: /^三级部门\s*\d*$/ }).click();
  await expect(bindingGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await expect(page.locator(".governance-empty")).toContainText("没有符合条件的 Agent");
  await bindingGroup.getByRole("button", { name: /^人员\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await bindingGroup.getByRole("button", { name: /^未绑定\s*\d*$/ }).click();
  await expect(bindingGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("空草稿");

  await statusGroup.getByRole("button", { name: /^全部\s*\d*$/ }).click();
  // 绑定类型「未绑定」仍生效：只剩空草稿。
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("空草稿");
  await statusGroup.getByRole("button", { name: /^已发布\s*\d*$/ }).click();
  await bindingGroup.getByRole("button", { name: /^人员\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("KOL 助理");
  await bindingGroup.getByRole("button", { name: /^三级部门\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(1);
  await expect(page.locator(".governance-agent-row")).toContainText("商务 Agent");
  await bindingGroup.getByRole("button", { name: /^未绑定\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(0);
  await bindingGroup.getByRole("button", { name: /^全部\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);
  expect(native).toEqual([]);
});

test("新增 Agent 弹窗创建草稿；空草稿直接发布被 409 拒绝并显示原因", async ({ page }) => {
  const native = guardNativeDialogs(page);
  const state = await stubAgentBackend(page, [AGENT_KOL, AGENT_SALES]);
  await page.goto("/admin/agents");
  const root = page.locator("[data-admin-page='agents']");
  await expect(root).toBeVisible();
  // 默认仅显示人员绑定；创建前先展开到全部，避免把新草稿误判为未创建。
  await filterGroup(page, "绑定类型").getByRole("button", { name: /^全部\s*\d*$/ }).click();
  await expect(page.locator(".governance-agent-row")).toHaveCount(2);

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
  const summary = root.locator("[aria-label='Agent 摘要']");
  await expect(summary).toContainText("风控 Agent");
  await expect(summary).toContainText("草稿");

  // 现行共享信息布局以摘要卡 + 三个可折叠治理区呈现，版本仍为独立区块。
  for (const section of ["绑定技能", "绑定知识库", "组织人员绑定"]) await expect(root.getByText(section, { exact: true })).toBeVisible();
  await expect(root.getByRole("heading", { name: "版本", exact: true })).toBeVisible();
  await expect(root).toContainText("尚未绑定组织单元或人员");
  await expect(summary).toContainText("0 项技能");
  await expect(summary).toContainText("0 人覆盖");
  await expect(summary).toContainText("0 个绑定点");

  await root.getByRole("button", { name: "发布智能体" }).click();
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
  const summary = root.locator("[aria-label='Agent 摘要']");
  await expect(summary).toContainText("KOL 助理");
  await expect(summary).toContainText("已发布");
  await expect(root).toContainText("组织版本 1");
  await expect(root.locator(".governance-via-group", { hasText: "直接绑定" })).toContainText("直接绑定 · 1 人");

  // 三级组在现行级联部门筛选中缩小到单个候选，再勾选进入批量试算。
  const level1 = root.getByLabel("筛选1级部门", { exact: true });
  const level2 = root.getByLabel("筛选2级部门", { exact: true });
  const level3 = root.getByLabel("筛选3级部门", { exact: true });
  await expect(level1).toBeEnabled();
  await level1.selectOption("org:brand_user_growth_center");
  await level2.selectOption("org:promotion_department");
  await level3.selectOption("org:lt_team");
  const ltTarget = root.getByLabel("LT组", { exact: true });
  await expect(ltTarget).toBeVisible();
  await ltTarget.check();
  await root.getByRole("button", { name: "预览绑定影响（1 个目标）", exact: true }).click();
  const preview = page.locator("[data-agent-binding-preview]");
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-property="org-version"] dd')).toHaveText("2");
  await expect(preview.locator('[data-property="coverage-impact"] dd')).toHaveText("将新增覆盖 1 人（绑定后共 2 人）");
  await expect(preview).toContainText("叶观旺");
  await expect(preview).toContainText("部门负责人 · LT组");
  const expectedTargets = [{ target_type: "organization_unit", target_id: "org:lt_team" }];
  expect(state.previews).toEqual([{ targets: expectedTargets }]);

  // 取消试算不写入；同一已勾选目标再次试算后才允许确认。
  await preview.getByRole("button", { name: "取消", exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(state.binds).toEqual([]);
  await root.getByRole("button", { name: "预览绑定影响（1 个目标）", exact: true }).click();
  await expect(preview).toBeVisible();
  expect(state.previews).toEqual([{ targets: expectedTargets }, { targets: expectedTargets }]);

  await preview.getByRole("button", { name: "确认绑定" }).click();
  await expect(root.getByRole("status")).toContainText("绑定已保存，覆盖人员已按组织树重算（1 个目标）。");
  expect(state.binds).toEqual([{ targets: expectedTargets, org_version: 2, reason: "管理侧 Agent 页面绑定" }]);
  const bindingRow = root.locator("#agent-bindings-card .ui-record-row").filter({ hasText: "组织单元 · LT组" });
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
  await expect(root.locator("#agent-bindings-card .ui-record-row").filter({ hasText: "组织单元 · LT组" })).toHaveCount(0);
  await expect(root).toContainText("覆盖名单（按来源分组 · 共 1 人）");
  expect(native).toEqual([]);
});

// Global-layout gate uses a Vite-only server: explicitly stub common authentication.
test.beforeEach(async ({ page }) => {
  if (!process.env.GLOBAL_LAYOUT_TEST) return;
  const account = { id: "layout-admin", name: "测试管理员", roles: ["admin"], available_modes: ["employee", "admin"] };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { authenticated: true, account, user: account } });
    if (path === "/api/me") return route.fulfill({ json: account });
    if (path === "/api/preferences") return route.fulfill({ json: { theme: "light" } });
    return route.fulfill({ json: [] });
  });
});
