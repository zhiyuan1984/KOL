import { expect, test } from "@playwright/test";

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

test("技能页呈现实现度与工具依赖，并按实现状态筛选", async ({ page }) => {
  await page.route("**/api/admin/runtime/skills/coverage*", (route) => route.fulfill({ json: COVERAGE }));
  await page.goto("/admin/skills");

  const summary = page.locator("[data-skill-coverage-summary]");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("已上线 1");
  await expect(summary).toContainText("工具依赖 已挂载 1/3（待挂载 2）");

  const liveRow = page.locator(".skill-governance-row", { hasText: "creator_profile" });
  await expect(liveRow.locator("[data-skill-implementation='live']")).toHaveText("已上线");
  await expect(liveRow.locator("[data-skill-tool-coverage='1/2']")).toHaveText("工具 1/2");

  const definedRow = page.locator(".skill-governance-row", { hasText: "creator_library_query" });
  await expect(definedRow.locator("[data-skill-implementation='defined']")).toHaveText("待上线");

  await page.getByLabel("实现状态").selectOption("live");
  await expect(page.locator(".skill-governance-row", { hasText: "creator_profile" })).toBeVisible();
  await expect(page.locator(".skill-governance-row", { hasText: "creator_library_query" })).toHaveCount(0);

  await page.getByLabel("实现状态").selectOption("pending_tools");
  await expect(page.locator(".skill-governance-row", { hasText: "creator_profile" })).toBeVisible();
  await expect(page.locator(".skill-governance-row", { hasText: "creator_library_query" })).toBeVisible();
});

test("技能详情按 SKILL.md 声明列出工具依赖，并给出按定义挂载入口", async ({ page }) => {
  await page.route("**/api/admin/runtime/skills/coverage*", (route) => route.fulfill({ json: COVERAGE }));
  await page.goto("/admin/skills");
  await page.locator(".skill-governance-row", { hasText: "creator_profile" }).click();
  await page.getByRole("button", { name: "工具与知识" }).click();

  const declared = page.locator("[data-skill-declared-dependencies='creator_profile']");
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
  await page.locator(".skill-governance-row", { hasText: "creator_profile" }).click();
  await page.getByRole("button", { name: "工具与知识" }).click();

  const declared = page.locator("[data-skill-declared-dependencies='creator_profile']");
  await expect(declared).toContainText("目录里没有对应连接器");
  await expect(declared.locator("[data-skill-declared-tool='get_collaboration']")).toContainText("无对应连接器");
  await expect(declared.locator("[data-skill-declared-mount='unknown']")).toBeDisabled();
});

test("扫描读不到时只有这一块降级，技能列表照常可用", async ({ page }) => {
  await page.route("**/api/admin/runtime/skills/coverage*", (route) => route.fulfill({
    status: 403, json: { detail: { code: "runtime_auth_required" } },
  }));
  await page.goto("/admin/skills");
  await expect(page.locator("[data-skill-coverage-error]")).toContainText("技能实现与工具依赖未读取");
  await expect(page.locator(".skill-governance-row", { hasText: "creator_profile" })).toBeVisible();
  await expect(page.locator("[data-skill-coverage-summary]")).toHaveCount(0);
});
