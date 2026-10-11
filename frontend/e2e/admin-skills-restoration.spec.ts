import { expect, test, type Page } from "@playwright/test";

type SkillFixture = {
  id: string;
  label: string;
  title: string;
  description: string;
  source: string;
  lifecycle: {
    stage: string;
    stage_label: string;
    origin: "official";
    owner: string | null;
    business_stage: string | null;
    tags: string[];
    current_version: number | null;
    test_summary: { total: number; pass_rate: number | null; failing: number; last_run_at: string | null };
  };
};

type FixtureControl = {
  writes: Array<{ method: string; path: string }>;
  publishCalls: number;
  failNextDraftSave: () => void;
};

const stamp = "2026-10-12T00:00:00.000Z";

function skill(id: string, label: string): SkillFixture {
  return {
    id,
    label,
    title: label,
    description: `${label}简介`,
    source: "uploaded",
    lifecycle: {
      stage: "editing",
      stage_label: "编辑配置",
      origin: "official",
      owner: "管理员",
      business_stage: "reach",
      tags: ["回归"],
      current_version: 3,
      test_summary: { total: 1, pass_rate: 100, failing: 0, last_run_at: stamp },
    },
  };
}

/**
 * This is a complete browser-side replacement, not a proxy: every /api/**
 * request is fulfilled locally, unknown reads are inert, and unknown writes
 * are recorded then rejected.  It therefore cannot issue a production call.
 */
async function installSkillFixture(page: Page): Promise<FixtureControl> {
  const skills = [skill("skill_alpha", "技能 Alpha"), skill("skill_beta", "技能 Beta")];
  const bodyById: Record<string, string> = {
    skill_alpha: "Alpha 初始正文",
    skill_beta: "Beta 初始正文",
  };
  const patchById: Record<string, Record<string, unknown>> = {
    skill_alpha: {},
    skill_beta: {},
  };
  const writes: Array<{ method: string; path: string }> = [];
  let publishCalls = 0;
  let failDraftSave = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const jsonBody = (): Record<string, unknown> => {
      try { return JSON.parse(request.postData() || "{}") as Record<string, unknown>; }
      catch { return {}; }
    };

    // Authentication and shell bootstrap are local fixtures too.
    if (method === "GET" && path === "/api/health") return route.fulfill({ json: { runtime_mode: "fixture" } });
    if (method === "GET" && path === "/api/auth/status") {
      return route.fulfill({ json: { authenticated: true, account: { id: "admin-fixture", name: "治理管理员", roles: ["admin"], available_modes: ["admin"] } } });
    }
    if (method === "GET" && path === "/api/me") {
      return route.fulfill({ json: { id: "admin-fixture", name: "治理管理员", roles: ["admin"], available_modes: ["admin"] } });
    }
    if (method === "GET" && ["/api/preferences", "/api/user/preferences"].includes(path)) return route.fulfill({ json: {} });

    if (method === "GET" && path === "/api/admin/skills") return route.fulfill({ json: { skills } });
    if (method === "GET" && path === "/api/admin/runtime/skills/coverage") {
      return route.fulfill({ json: { summary: { skills: 2, live: 0, defined: 2, declared_tools: 0, mounted_tools: 0, pending_tools: 0 }, connectors: [], skills: [] } });
    }
    if (method === "GET" && path === "/api/admin/skills/legacy-grants") {
      return route.fulfill({ json: { deprecated: true, notice: "无残留", count: 0, grants: [] } });
    }

    const detail = /^\/api\/admin\/skills\/([^/]+)\/([^/]+)$/.exec(path);
    if (detail) {
      const [, encodedId, operation] = detail;
      const id = decodeURIComponent(encodedId);
      if (!skills.some((row) => row.id === id)) return route.fulfill({ status: 404, json: { detail: "fixture skill missing" } });
      if (method === "GET" && operation === "sop") {
        return route.fulfill({ json: { id, summary: `${id} 摘要`, body: bodyById[id], updated_at: stamp, edited: false } });
      }
      if (operation === "draft" && method === "GET") return route.fulfill({ json: { id, patch: patchById[id], updated_at: stamp } });
      if (operation === "draft" && method === "PUT") {
        writes.push({ method, path });
        if (failDraftSave) {
          failDraftSave = false;
          return route.fulfill({ status: 500, json: { detail: "fixture 保存失败" } });
        }
        const patch = jsonBody();
        patchById[id] = { ...patchById[id], ...patch };
        if (typeof patch.body === "string") bodyById[id] = patch.body;
        if (typeof patch._sop_body === "string") bodyById[id] = patch._sop_body;
        return route.fulfill({ json: { id, patch: patchById[id], updated_at: stamp } });
      }
      if (method === "GET" && operation === "versions") return route.fulfill({ json: { versions: [{ id: `${id}:v3`, version: 3, status: "published", description: "fixture version" }] } });
      if (method === "POST" && operation === "versions") {
        writes.push({ method, path });
        publishCalls += 1;
        return route.fulfill({ json: { version: 4 } });
      }
      if (method === "GET" && operation === "tests") return route.fulfill({ json: { tests: [], runs: [] } });
      if (method === "GET" && operation === "metrics") return route.fulfill({ json: { calls: 0, success_rate: null, avg_duration_ms: null, alerts: 0, trend: [] } });
      if (method === "GET" && operation === "publish-check") {
        return route.fulfill({ json: { id, risk: "L1", can_publish: false, reasons: ["fixture 不发布"], checks: { tests: { ok: true, detail: "fixture" }, tools: { ok: true, detail: "fixture" }, knowledge: { ok: true, detail: "fixture" }, approval: { ok: true, detail: "fixture" }, owner: { ok: true, detail: "fixture" } } } });
      }
      if (method === "PATCH" && operation === "lifecycle") {
        writes.push({ method, path });
        return route.fulfill({ json: { lifecycle: jsonBody() } });
      }
    }

    // The shell can eagerly read these independent surfaces.  Return legal
    // empty shapes rather than allowing Vite or a browser proxy to continue.
    if (method === "GET" && ["/api/sessions", "/api/tasks", "/api/experts", "/api/skills", "/api/skills/market", "/api/knowledge", "/api/knowledge/market", "/api/knowledge/composer", "/api/files/recent"].includes(path)) {
      return route.fulfill({ json: [] });
    }
    if (method !== "GET") {
      writes.push({ method, path });
      return route.fulfill({ status: 405, json: { detail: `fixture rejects ${method} ${path}` } });
    }
    return route.fulfill({ json: {} });
  });

  return {
    writes,
    get publishCalls() { return publishCalls; },
    failNextDraftSave: () => { failDraftSave = true; },
  };
}

async function openSkills(page: Page) {
  await page.goto("/admin/skills");
  await expect(page.locator("[data-admin-page='skills']")).toBeVisible();
  await expect(page.locator(".skill-v2-row", { hasText: "技能 Alpha" })).toBeVisible();
  await expect(page.getByLabel("技能说明（Markdown）")).toHaveValue("Alpha 初始正文");
}

function discardDialog(page: Page) {
  return page.getByRole("dialog").filter({ hasText: "放弃未保存的修改？" });
}

test("编辑后拒绝切换会保留正文；确认放弃和关闭都走同一保护", async ({ page }) => {
  const fixture = await installSkillFixture(page);
  await openSkills(page);
  const body = page.getByLabel("技能说明（Markdown）");
  const beta = page.locator(".skill-v2-row", { hasText: "技能 Beta" });

  await body.fill("拒绝切换后仍应保留的正文");
  await beta.click();
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page).getByRole("button", { name: "继续编辑" }).click();
  await expect(page.locator("#skill-detail-title").filter({ hasText: "技能 Alpha" })).toBeVisible();
  await expect(body).toHaveValue("拒绝切换后仍应保留的正文");

  await beta.click();
  await discardDialog(page).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.locator("#skill-detail-title").filter({ hasText: "技能 Beta" })).toBeVisible();
  await expect(page.getByLabel("技能说明（Markdown）")).toHaveValue("Beta 初始正文");

  const betaBody = page.getByLabel("技能说明（Markdown）");
  await betaBody.fill("关闭前的未保存正文");
  await page.getByRole("button", { name: "关闭技能详情" }).click();
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page).getByRole("button", { name: "继续编辑" }).click();
  await expect(betaBody).toHaveValue("关闭前的未保存正文");
  await page.getByRole("button", { name: "关闭技能详情" }).click();
  await discardDialog(page).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByText("选择一项技能查看详情。")).toBeVisible();
  expect(fixture.publishCalls).toBe(0);
});

test("保存失败仍受保护，成功保存清除保护；展示元数据也会标脏且保留发布入口", async ({ page }) => {
  const fixture = await installSkillFixture(page);
  await openSkills(page);
  const body = page.getByLabel("技能说明（Markdown）");
  const beta = page.locator(".skill-v2-row", { hasText: "技能 Beta" });

  fixture.failNextDraftSave();
  await body.fill("保存失败仍需保护");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("fixture 保存失败")).toBeVisible();
  await beta.click();
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page).getByRole("button", { name: "继续编辑" }).click();
  await expect(body).toHaveValue("保存失败仍需保护");

  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("技能内容已保存为未发布草稿。")).toBeVisible();
  await beta.click();
  await expect(discardDialog(page)).toHaveCount(0);
  await expect(page.locator("#skill-detail-title").filter({ hasText: "技能 Beta" })).toBeVisible();

  await page.locator("[data-skill-presentation]").getByLabel("来源徽章").fill("待放弃展示元数据");
  await page.locator(".skill-v2-row", { hasText: "技能 Alpha" }).click();
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page).getByRole("button", { name: "继续编辑" }).click();

  await page.getByRole("button", { name: "测试与版本" }).click();
  await expect(page.getByRole("button", { name: "发布草稿并生成版本", exact: true })).toBeVisible();
  expect(fixture.publishCalls).toBe(0);
  expect(fixture.writes.filter((write) => write.path.endsWith("/versions"))).toHaveLength(0);
});

test("运行契约未保存有提示，侧栏离开取消后不重复确认，放弃才能离开", async ({ page }) => {
  const fixture = await installSkillFixture(page);
  await openSkills(page);
  const contract = page.getByLabel("技能参数与运行契约 JSON");
  await contract.fill('{"result_type":"restore_local_edit"}');
  await expect(page.locator('[data-skill-unsaved]')).toHaveText('未保存修改');
  const employees = page.locator('a[href="/admin"]').filter({ hasText: '员工' }).first();
  await employees.click();
  await expect(discardDialog(page)).toHaveCount(1);
  await discardDialog(page).getByRole('button', { name: '继续编辑' }).click();
  await expect(discardDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/skills$/);
  await expect(contract).toHaveValue('{"result_type":"restore_local_edit"}');
  await employees.click();
  await expect(discardDialog(page)).toHaveCount(1);
  await discardDialog(page).getByRole('button', { name: '放弃修改' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(discardDialog(page)).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});
