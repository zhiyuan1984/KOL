import { expect, test, type Page } from "@playwright/test";

/**
 * Employee /skills restoration coverage.
 *
 * This suite is deliberately frontend-only: every /api/** request is fulfilled by the
 * fixture below. It neither starts nor certifies backend execution, permissions, or
 * administrative behavior.
 */
type Json = Record<string, unknown>;
type FixtureControl = { calls: Array<{ method: string; path: string }>; writePaths: string[] };

function skill(id: string, title: string, funnel: string, overrides: Partial<Json> = {}): Json {
  return {
    id,
    title,
    label: title,
    in_market: true,
    granted: true,
    employee_visible: true,
    funnel,
    icon: "creator_profile",
    badge: "平台内置",
    starter: `请处理${title}`,
    summary: `${title}的员工说明`,
    output: "kol_analyze_brief",
    keeps_stage: true,
    employee_quick: `直接查看${title}的已授权信息`,
    employee_agent: `由数字员工协助准备${title}`,
    employee_example: [`请帮我处理${title}`],
    source: "bundled",
    origin: "official",
    learning: {
      when_to_use: `需要${title}时`,
      inputs: ["达人名称"],
      steps: ["analyze"],
      result: "kol_analyze_brief",
      side_effects: "none",
      confirmation: "按当前权限执行",
    },
    execution: {
      tools: [{ kind: "api", ref: "starrykol.getKolProfileDetail", risk: "L1" }],
      permissions: ["starrykol:read"],
      async: { enabled: false, status: "同步完成", cancelable: false, retryable: false },
      receipt_required: false,
    },
    ui_template: null,
    ...overrides,
  };
}

// Funnel values intentionally match the current API contract in SkillHub.FUNNEL.
// In particular, biz and sample are separate fixture rows rather than a test-only alias.
const SKILLS: Json[] = [
  skill("creator_discovery", "推荐建联", "reach"),
  skill("intent_follow", "意向跟进", "intent"),
  skill("biz_quote", "报价协商", "biz"),
  skill("sample_ship", "寄样确认", "sample"),
  skill("settle_record", "成交沉淀", "settle"),
  skill("content_publish", "内容发布", "content"),
  skill("exception_scan", "异常扫描", "exception"),
  skill("internal_pipeline", "内部流水线", "reach", { employee_visible: false }),
];

async function installFixture(page: Page): Promise<FixtureControl> {
  const calls: Array<{ method: string; path: string }> = [];
  const writePaths: string[] = [];

  await page.addInitScript(() => {
    localStorage.setItem("skill:usage", JSON.stringify({
      creator_discovery: 2,
      sample_ship: 9,
      exception_scan: 1,
    }));
    localStorage.setItem("skill:recent", JSON.stringify([
      "exception_scan",
      "sample_ship",
      "creator_discovery",
    ]));
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    calls.push({ method, path });

    // The application shell can make these reads before the employee route renders.
    if (path === "/api/auth/status" && method === "GET") {
      return route.fulfill({ json: { authenticated: true, account: { id: "employee-fixture", name: "员工 Fixture", roles: ["employee"], available_modes: ["employee"] } } });
    }
    if (path === "/api/me" && method === "GET") {
      return route.fulfill({ json: { id: "employee-fixture", name: "员工 Fixture", roles: ["employee"], available_modes: ["employee"] } });
    }
    if (method === "GET" && ["/api/sessions", "/api/tasks", "/api/experts", "/api/cron/jobs", "/api/knowledge", "/api/knowledge/composer", "/api/files/recent", "/api/work-orders"].includes(path)) {
      return route.fulfill({ json: [] });
    }
    if (path.includes("preferences") && method === "GET") {
      return route.fulfill({ json: { theme: "light" } });
    }

    if (path === "/api/skills" && method === "GET") {
      return route.fulfill({ json: SKILLS });
    }
    const agentsMatch = /^\/api\/skills\/([^/]+)\/agents$/.exec(path);
    if (agentsMatch && method === "GET") {
      return route.fulfill({ json: { agents: [{ id: "agent-fixture", name: "员工数字员工" }] } });
    }
    const skillMatch = /^\/api\/skills\/([^/]+)$/.exec(path);
    if (skillMatch && method === "GET") {
      const id = decodeURIComponent(skillMatch[1]);
      return route.fulfill({
        json: {
          ...SKILLS.find((item) => item.id === id),
          employee_doc: "### 使用说明\n- 这是隔离说明书第一段\n- 不会发起执行\n### 补充\n仅用于查看渐进披露。",
        },
      });
    }

    // Never continue a request: unknown reads receive an inert structured payload and
    // unknown writes are recorded and rejected, so this test cannot reach a live API.
    if (method !== "GET") {
      writePaths.push(path);
      return route.fulfill({ status: 405, json: { error: "fixture_rejects_writes" } });
    }
    return route.fulfill({ json: {} });
  });

  return { calls, writePaths };
}

function scope(page: Page, kind: "mode" | "stage") {
  return page.locator(`.skill-tabs-list[data-kind="${kind}"]`);
}

async function ready(page: Page, path = "/skills?mode=all&stage=all") {
  await page.goto(path);
  await page.locator("[data-skill-catalog]").waitFor();
  await page.locator(".skill-row").first().waitFor();
}

async function visibleIds(page: Page) {
  return page.locator(".skill-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-skill-id")));
}

async function expectFilters(page: Page, mode: string, stage: string) {
  await expect(scope(page, "mode").getByRole("button", { name: mode })).toHaveAttribute("aria-pressed", "true");
  await expect(scope(page, "stage").getByRole("button", { name: stage })).toHaveAttribute("aria-pressed", "true");
}

test("员工筛选可独立组合使用范围和业务场景，biz/sample 按接口 funnel 分开", async ({ page }) => {
  await installFixture(page);
  await ready(page, "/skills?mode=frequent&stage=sample");

  expect(await scope(page, "mode").getByRole("button").allTextContents())
    .toEqual(["全部", "常用", "最近使用", "推荐"]);
  expect(await scope(page, "stage").getByRole("button").allTextContents())
    .toEqual(["全部场景", "建联", "意向", "报价", "寄样", "成交", "内容发布", "异常"]);
  await expectFilters(page, "常用", "寄样");
  expect(await visibleIds(page)).toEqual(["sample_ship"]);

  // Changing only the usage scope must retain the selected business scene.
  await page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" }).fill("寄样");
  await scope(page, "mode").getByRole("button", { name: "最近使用" }).click();
  await expect(page).toHaveURL(/\/skills\?mode=recent&stage=sample$/);
  await expectFilters(page, "最近使用", "寄样");
  await expect(page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" })).toHaveValue("寄样");
  expect(await visibleIds(page)).toEqual(["sample_ship"]);

  // Changing only the scene retains the selected usage scope.
  await page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" }).fill("");
  await scope(page, "stage").getByRole("button", { name: "异常" }).click();
  await expect(page).toHaveURL(/\/skills\?mode=recent&stage=exception$/);
  await expectFilters(page, "最近使用", "异常");
  expect(await visibleIds(page)).toEqual(["exception_scan"]);

  await page.goto("/skills?mode=all&stage=biz");
  await expectFilters(page, "全部", "报价");
  expect(await visibleIds(page)).toEqual(["biz_quote"]);
  await expect(page.locator('[data-skill-id="sample_ship"]')).toHaveCount(0);
});

test("旧 tab 深链与新 mode+stage 深链均恢复正确的两维状态", async ({ page }) => {
  await installFixture(page);

  await ready(page, "/skills?tab=frequent");
  await expectFilters(page, "常用", "全部场景");

  await page.goto("/skills?tab=sample");
  await expectFilters(page, "全部", "寄样");
  expect(await visibleIds(page)).toEqual(["sample_ship"]);

  await page.goto("/skills?mode=recommend&stage=reach");
  await expectFilters(page, "推荐", "建联");
  expect(await visibleIds(page)).toEqual(["creator_discovery"]);
});

test("筛选写入 URL、浏览器返回恢复组合，所有查看全部链接保留当前 mode", async ({ page }) => {
  await installFixture(page);
  await ready(page);

  await scope(page, "mode").getByRole("button", { name: "常用" }).click();
  await expect(page).toHaveURL(/\/skills\?mode=frequent&stage=all$/);
  await scope(page, "stage").getByRole("button", { name: "寄样" }).click();
  await expect(page).toHaveURL(/\/skills\?mode=frequent&stage=sample$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/skills\?mode=frequent&stage=all$/);
  await expectFilters(page, "常用", "全部场景");

  const viewAllHrefs = await page.locator(".skill-group-more").evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).getAttribute("href") || ""),
  );
  expect(viewAllHrefs.length).toBeGreaterThan(0);
  for (const href of viewAllHrefs) {
    const params = new URL(href, "http://fixture.local").searchParams;
    expect(params.get("mode"), href).toBe("frequent");
    expect(params.get("stage"), href).toMatch(/^(reach|sample|exception)$/);
  }
});

test("员工填入技能只写入提问框草稿，不请求任何执行或写入 API", async ({ page }) => {
  const fixture = await installFixture(page);
  await ready(page);

  await page.locator('[data-skill-id="sample_ship"] .skill-row-name').click();
  await page.getByRole("button", { name: "填入输入框" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/寄样确认/);

  expect(fixture.writePaths).toEqual([]);
  expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
});
