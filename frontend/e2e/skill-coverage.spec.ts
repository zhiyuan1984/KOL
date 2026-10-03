import { expect, test, type Page } from "@playwright/test";

// 治理读数在无鉴权 stub 模式下按设计返回 403（与 connector-admin.spec.ts 同一约定）；
// 这里把扫描结果固定为确定性桩，只验证呈现、筛选与「按定义挂载」的入口。
const COVERAGE = {
  summary: { skills: 2, live: 1, defined: 1, declared_tools: 3, mounted_tools: 1, pending_tools: 2 },
  connectors: [{ id: "starrykol", label: "Starry KOL MCP", enabled: true, status: "verified", approved_tool_count: 9 }],
  skills: [
    {
      skill_id: "creator_profile", label: "达人画像", stage: "published", published_version: 2,
      agents: ["agent:kol"], agent_bound: true, implementation: "live",
      declared_tools: 2, mounted_tools: 1, pending_tools: 1,
      tools: [
        {
          connector_id: "starrykol", connector_label: "Starry KOL MCP", tool_name: "pageKolProfiles",
          declared_as: "starrykol.pageKolProfiles", state: "mounted", policy_risk: "L1", policy_enabled: true,
          connector_enabled: true, connector_status: "verified",
        },
        {
          connector_id: "starrykol", connector_label: "Starry KOL MCP", tool_name: "getKolProfileDetail",
          declared_as: "starrykol.getKolProfileDetail", state: "available", policy_risk: "L1", policy_enabled: true,
          connector_enabled: true, connector_status: "verified",
        },
      ],
    },
    {
      skill_id: "creator_library_query", label: "达人库查询", stage: "draft", published_version: null,
      agents: [], agent_bound: false, implementation: "defined",
      declared_tools: 1, mounted_tools: 0, pending_tools: 1,
      tools: [
        {
          connector_id: "starrykol", connector_label: "Starry KOL MCP", tool_name: "pageKolProfiles",
          declared_as: "starrykol.pageKolProfiles", state: "unregistered", connector_enabled: true, connector_status: "verified",
        },
      ],
    },
  ],
};

/** SkillLifecycleV2 的列表行不显示 id：用列表搜索定位技能，再点行选中并进入「工具与知识」。 */
async function openSkillDependencies(page: Page, skillId: string) {
  await page.getByLabel("搜索技能").fill(skillId);
  const row = page.locator(".skill-v2-row").first();
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole("button", { name: "工具与知识" }).click();
  return page.locator(`[data-skill-declared-dependencies='${skillId}']`);
}

test("技能页呈现实现度读数与工具依赖，并按阶段筛选", async ({ page }) => {
  await page.route("**/api/admin/runtime/skills/coverage*", (route) => route.fulfill({ json: COVERAGE }));
  await page.goto("/admin/skills");
  const root = page.locator("[data-admin-page='skills']");
  await expect(root).toBeVisible();

  await page.getByLabel("搜索技能").fill("creator_profile");
  await expect(page.locator(".governance-count")).toHaveText(/^1 \/ \d+ 项技能$/);
  const row = page.locator(".skill-v2-row", { hasText: "达人画像" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("发布上线");

  // 实现度读数（声明 / 已挂载 / 待挂载）在详情「工具与知识」内呈现。
  await row.click();
  await page.getByRole("button", { name: "工具与知识" }).click();
  const declared = page.locator("[data-skill-declared-dependencies='creator_profile']");
  await expect(declared).toBeVisible();
  await expect(declared).toContainText("声明 2 个 · 已挂载 1 个 · 待挂载 1 个");

  // 阶段筛选是单选：点已选中项不取消，切到草稿后列表收窄，再切回已发布恢复。
  const stageGroup = page.locator(".governance-filter-group").filter({ hasText: "阶段" });
  await expect(stageGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await stageGroup.getByRole("button", { name: "已发布", exact: true }).click();
  await expect(stageGroup.getByRole("button", { name: "已发布", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeVisible();
  await stageGroup.getByRole("button", { name: "草稿", exact: true }).click();
  await expect(stageGroup.locator("[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".skill-v2-row")).toHaveCount(0);
  await stageGroup.getByRole("button", { name: "草稿", exact: true }).click();
  await expect(page.locator(".skill-v2-row")).toHaveCount(0);
  await stageGroup.getByRole("button", { name: "已发布", exact: true }).click();
  await expect(row).toBeVisible();
});

test("技能详情按 SKILL.md 声明列出工具依赖，并给出按定义挂载入口", async ({ page }) => {
  await page.route("**/api/admin/runtime/skills/coverage*", (route) => route.fulfill({ json: COVERAGE }));
  await page.goto("/admin/skills");

  const declared = await openSkillDependencies(page, "creator_profile");
  await expect(declared).toBeVisible();
  await expect(declared).toContainText("声明 2 个 · 已挂载 1 个 · 待挂载 1 个");
  await expect(declared.locator("[data-skill-declared-agents]")).toContainText("已挂到数字员工：agent:kol");
  await expect(declared.locator("[data-skill-declared-tool='pageKolProfiles']")).toHaveAttribute("data-state", "mounted");
  await expect(declared.locator("[data-skill-declared-tool='pageKolProfiles']")).toContainText("已挂载");
  await expect(declared.locator("[data-skill-declared-tool='getKolProfileDetail']")).toContainText("可挂载");
  // 只有「可挂载」的那个进入一键挂载；已挂载的不重算，阻塞的仍要逐项决定。
  await expect(declared.locator("[data-skill-declared-mount='starrykol']")).toHaveText("按定义挂载（1 个）");
});

test("技能声明了目录里没有的连接器时如实说明，不提供挂载", async ({ page }) => {
  await page.route("**/api/admin/runtime/skills/coverage*", (route) => route.fulfill({
    json: {
      summary: { skills: 1, live: 1, defined: 0, declared_tools: 1, mounted_tools: 0, pending_tools: 1 },
      connectors: [],
      skills: [{
        skill_id: "creator_profile", label: "达人画像", stage: "published", published_version: 2,
        agents: ["agent:kol"], agent_bound: true, implementation: "live",
        declared_tools: 1, mounted_tools: 0, pending_tools: 1,
        tools: [{
          connector_id: "", tool_name: "get_collaboration",
          declared_as: "starry.get_collaboration", state: "unknown_connector",
        }],
      }],
    },
  }));
  await page.goto("/admin/skills");

  const declared = await openSkillDependencies(page, "creator_profile");
  await expect(declared).toContainText("目录里没有对应连接器");
  await expect(declared.locator("[data-skill-declared-tool='get_collaboration']")).toContainText("无对应连接器");
  await expect(declared.locator("[data-skill-declared-mount='unknown']")).toBeDisabled();
});

test("扫描读不到时只有工具依赖降级，技能列表照常可用", async ({ page }) => {
  await page.route("**/api/admin/runtime/skills/coverage*", (route) => route.fulfill({
    status: 403, json: { detail: { code: "runtime_auth_required" } },
  }));
  await page.goto("/admin/skills");
  await expect(page.locator("[data-admin-page='skills']")).toBeVisible();

  await page.getByLabel("搜索技能").fill("creator_profile");
  const row = page.locator(".skill-v2-row", { hasText: "达人画像" });
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole("button", { name: "工具与知识" }).click();
  const degraded = page.locator("[data-skill-declared-dependencies='unavailable']");
  await expect(degraded).toBeVisible();
  await expect(degraded).toContainText("这次没有读到扫描结果");
  await expect(page.locator("[data-skill-declared-dependencies='creator_profile']")).toHaveCount(0);
});
