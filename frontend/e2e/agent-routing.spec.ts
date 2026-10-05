import { expect, test } from "@playwright/test";

test("管理侧发布的产品专家出现在员工目录，并开启绑定该 Agent 的会话", async ({ page, request }) => {
  const created = await request.post("/api/admin/agents", { data: { name: "产品专家 E2E", description: "回答产品规格和使用问题" } });
  expect(created.status()).toBe(201);
  const agent = await created.json();
  const skill = await request.put(`/api/admin/agents/${agent.id}/skills/creator_profile`, { data: { enabled: true, expected_version: 0 } });
  expect(skill.ok()).toBeTruthy();
  const binding = await request.post(`/api/admin/agents/${agent.id}/bindings`, { data: { target_type: "organization_unit", target_id: "org:lt_team" } });
  expect(binding.ok()).toBeTruthy();
  const published = await request.patch(`/api/admin/agents/${agent.id}`, { data: { status: "published", expected_version: 1 } });
  expect(published.ok()).toBeTruthy();
  await page.goto("/agents");
  const entry = page.locator(`[data-expert-card='${agent.id}']`);
  await expect(entry).toBeVisible({ timeout: 30000 });
  await entry.locator(`[data-expert-open='${agent.id}']`).click();
  await expect(page.locator(`[data-expert-detail='${agent.id}']`)).toBeVisible({ timeout: 30000 });
  const response = page.waitForResponse(response => response.url().endsWith(`/api/experts/${agent.id}/summon`) && response.request().method() === "POST");
  await page.locator(`[data-expert-summon='${agent.id}']`).click();
  const summoned = await (await response).json();
  expect(summoned.expert_id).toBe(agent.id);
  await page.waitForURL(`/s/${summoned.session_id}`);
  await expect(page.locator(`[data-expert-identity='${agent.id}']`)).toBeVisible({ timeout: 30000 });
  const session = await request.get(`/api/sessions/${summoned.session_id}`);
  expect((await session.json()).expert_id).toBe(agent.id);
});

test("服务端空目录不补出没有授权的静态专家", async ({ page }) => {
  await page.route("**/api/experts", route => route.fulfill({ json: [] }));
  await page.goto("/agents");
  await expect(page.locator("[data-expert-empty]")).toBeVisible();
  await expect(page.locator("[data-expert-card]")).toHaveCount(0);
});
