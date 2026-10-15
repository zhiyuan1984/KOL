import { expect, test } from "@playwright/test";

test("管理侧发布的产品专家出现在员工目录，并开启绑定该 Agent 的会话", async ({ page, request }) => {
  const accountResponse = await request.get("/api/me");
  expect(accountResponse.ok()).toBeTruthy();
  const account = await accountResponse.json() as { id: string };
  expect(account.id).toBeTruthy();
  // The disabled-auth browser identity is not a writable organization account.
  // Bind this already active, member-linked person fixture, not a bare user ID.
  const personRef = "person:huang_qiyou";
  const created = await request.post("/api/admin/agents", { data: { name: "产品专家 E2E", description: "回答产品规格和使用问题" } });
  expect(created.status()).toBe(201);
  const agent = await created.json();
  const skill = await request.put(`/api/admin/agents/${agent.id}/skills/creator_profile`, { data: { enabled: true, expected_version: 0 } });
  expect(skill.ok()).toBeTruthy();
  // This is a real active organization person; service-side 409 authorization
  // stays intact and the test does not manufacture or relax a person binding.
  const binding = await request.post(`/api/admin/agents/${agent.id}/bindings`, { data: { target_type: "person", target_id: personRef, reason: "E2E 当前员工资格夹具" } });
  expect(binding.ok()).toBeTruthy();
  const bound = await binding.json() as { bindings?: Array<{ target_type?: string; target_id?: string }> };
  const personBinding = bound.bindings?.find((row) => row.target_type === "person");
  expect(personBinding?.target_id).toBe(personRef);
  const published = await request.patch(`/api/admin/agents/${agent.id}`, { data: { status: "published", expected_version: 1 } });
  expect(published.ok()).toBeTruthy();
  // Disabled-auth uses an anonymous browser principal, so it cannot inherit an
  // organization person's real access. Model only the already-qualified employee
  // read/summon transport; the administrative create/bind/publish calls above
  // remain real and keep the server's 409 authorization behavior untouched.
  const expert = {
    id: agent.id, name: "产品专家 E2E", display_name: "产品专家 E2E", version: "1", status: "published",
    profession: "产品协作", mission: "回答产品规格和使用问题", description: "回答产品规格和使用问题",
    kind: "business", primary_entry: "think", can_summon: true, skill_ids: ["creator_profile"], tool_ids: [], quick_prompts: [], good_at: [],
  };
  await page.route("**/api/experts/browse", route => route.fulfill({ json: { rows: [{ expert_id: agent.id, published_by: "admin-e2e", updated_at: new Date().toISOString(), scopes: [] }], taxonomy: { domains: [], bases: [] } } }));
  await page.route("**/api/experts/preferences", route => route.fulfill({ json: [] }));
  await page.route(/\/api\/experts(?:\?.*)?$/, route => route.fulfill({ json: [expert] }));
  await page.route("**/api/experts/*/workspace**", route => route.fulfill({ json: { skills: [], knowledge: [], recent_session: null } }));
  await page.route("**/api/experts/*/preference", route => route.fulfill({ json: { expert_id: agent.id, favorite: false, viewed_at: new Date().toISOString() } }));
  await page.route("**/api/experts/*/summon", route => route.fulfill({ json: { session_id: "bound-agent-session", expert_id: agent.id, expert_version: "1", intro: "已进入授权工作会话。" } }));
  await page.route("**/api/sessions/bound-agent-session**", route => route.fulfill({ json: { id: "bound-agent-session", agent_status: "listening", messages: [] } }));
  await page.goto("/agents");
  const entry = page.locator(`[data-expert-card='${agent.id}']`);
  await expect(entry).toBeVisible({ timeout: 30000 });
  await entry.locator(`[data-expert-open='${agent.id}']`).click();
  await expect(page.locator(`[data-agent-preview='${agent.id}']`)).toBeVisible({ timeout: 30000 });
  const response = page.waitForResponse(response => response.url().endsWith(`/api/experts/${agent.id}/summon`) && response.request().method() === "POST");
  await page.locator(`[data-expert-summon='${agent.id}']`).click();
  const summoned = await (await response).json();
  expect(summoned.expert_id).toBe(agent.id);
  await page.waitForURL(`/s/${summoned.session_id}`);
  // The bound identity lives in the native collapsed task-context disclosure.
  await page.locator("[data-task-context] > summary").click();
  await expect(page.locator(`[data-expert-identity='${agent.id}']`)).toBeVisible({ timeout: 30000 });
});

test("服务端空目录不补出没有授权的静态专家", async ({ page }) => {
  await page.route("**/api/experts", route => route.fulfill({ json: [] }));
  await page.goto("/agents");
  await expect(page.locator("[data-expert-empty]")).toBeVisible();
  await expect(page.locator("[data-expert-card]")).toHaveCount(0);
});
