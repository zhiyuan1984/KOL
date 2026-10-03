import { expect, test, type Page } from "@playwright/test";

// 运行时治理接口在无鉴权 stub 模式下按设计返回 403；挂载写用例只在
// E2E_AUTH_MODE=enabled 上跑真链路（与 connector-admin.spec.ts 同一约定）。
const AUTH_ENABLED = process.env.E2E_AUTH_MODE === "enabled";

/** 无鉴权模式下把治理读数固定为确定性桩：本用例只关心渲染与挂载门禁。 */
async function stubGovernanceReads(page: Page) {
  await page.route("**/api/admin/runtime/skills/*/connectors", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/runtime/skills/*/tools", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/runtime/connectors/*/policies", (route) => route.fulfill({ json: [] }));
}

/** 工具挂载在技能详情的「工具与知识」页：SkillLifecycleV2 列表行不再直接渲染它。 */
async function openFirstSkillDependencies(page: Page) {
  await page.locator(".skill-v2-row").first().click();
  await page.getByRole("button", { name: "工具与知识" }).click();
  return page.locator("[data-skill-tool-bindings]").first();
}

/**
 * 授权单位是技能；连接器停用只拦运行，不拦登记挂载——后端本就允许
 * （runtime/store.ts 绑定不要求连接器启用），此前是页面把停用连接器的
 * 挂载开关禁用了，管理员因此在控制台里走不完「测试 → 挂载 → 启用」。
 */
test("停用的连接器在技能页仍可先登记挂载（不再被 UI 锁死）", async ({ page }) => {
  if (!AUTH_ENABLED) await stubGovernanceReads(page);
  await page.goto("/admin/skills");
  const bindings = await openFirstSkillDependencies(page);
  await expect(bindings).toBeVisible();
  await expect(bindings).toContainText("平台已登记工具");

  const row = bindings.locator("[data-skill-connector='claw']");
  await expect(row).toBeVisible();
  await expect(row).toContainText("连接器已停用");
  await expect(row).toContainText("可先登记挂载");
  await expect(row.locator("input[type='checkbox']").first()).toBeEnabled();
});

test("挂载写入口对停用连接器可用（需 E2E_AUTH_MODE=enabled）", async ({ page }) => {
  test.skip(!AUTH_ENABLED, "runtime governance writes require E2E_AUTH_MODE=enabled");
  await page.goto("/admin/skills");
  const bindings = await openFirstSkillDependencies(page);
  await expect(bindings).toBeVisible();
  const row = bindings.locator("[data-skill-connector='claw']");
  await expect(row).toBeVisible();
  const mount = row.locator("input[type='checkbox']").first();
  await expect(mount).toBeEnabled();
  if (!(await mount.isChecked())) {
    await mount.check();
    await expect(bindings).toContainText("连接器已显式挂到该 Skill");
  }
  // 还原为未挂载，保持 E2E 数据可重跑。
  await mount.uncheck();
  await expect(bindings).toContainText("连接器已从该 Skill 停用");
});
