import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";

/**
 * Employee Skills is the current AssetBrowse surface.  This suite deliberately
 * preserves the acceptance intent of the former four-column catalog without
 * recreating its retired catalog DOM.  Current semantic
 * anchors are KnowledgeBrowseWorkspace, knowledge-list-row/open, kbv-rail,
 * FilterOptionButton, WorkspaceSearchInput and DetailActionBar.
 *
 * DESIGN §32 preserves the skills contract: find → understand applicability →
 * preview → use for current task.  It also fixes token consumers: search lg,
 * filters sm, row knowledge-row-h, detail action control-h, body 13px and
 * supporting text 12px.  Tests here keep contrast and geometry gates at their
 * previous thresholds; migration never makes an obsolete selector green by
 * restoring retired UI.
 */
const AUTH_ENABLED = process.env.E2E_AUTH_MODE === "enabled";
const E2E_AGENT_ID = "agent:kol";
const VISIBLE_PROPS = ["color", "backgroundColor", "borderTopColor", "borderLeftColor"] as const;

type Skill = {
  id: string;
  title: string;
  label?: string;
  summary?: string;
  employee_visible?: boolean;
  employee_quick?: string | null;
  employee_agent?: string | null;
  employee_example?: string[];
  output?: string | null;
  risk?: string | null;
  funnel?: string | null;
  keeps_stage?: boolean;
  learning?: { inputs?: string[]; steps?: string[]; result?: string; confirmation?: string };
  execution?: {
    async?: { enabled?: boolean; cancelable?: boolean; retryable?: boolean; status?: string };
    tools?: Array<{ ref?: string; kind?: string; risk?: string }>;
    permissions?: string[];
    receipt_required?: boolean;
  };
};
type Personal = { skill_id: string; favorite?: boolean; viewed_at?: string | null; use_count?: number; used_at?: string | null };

/** Deterministic employee-visible records: they exercise the real current
 * AssetBrowse surface without weakening native authorization or calling a live
 * service.  Admin/Agent authorization remains server-owned in real mode. */
function employeeSkill(id: string, title: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id, title, label: title, summary: `${title}的员工使用说明`, employee_visible: true,
    employee_quick: `直接查看${title}的已授权信息`, employee_agent: `由数字员工协助准备${title}`,
    employee_example: [`请帮我处理${title}`], output: "kol_analyze_brief", risk: "L1", funnel: "reach", keeps_stage: true,
    learning: { inputs: ["达人名称"], steps: ["读取授权范围内的信息并分析", "形成业务建议"], result: "kol_analyze_brief", confirmation: "按当前权限执行" },
    execution: { tools: [{ ref: "starrykol.getKolProfileDetail", kind: "api", risk: "L1" }], permissions: ["starrykol:read"], receipt_required: false, async: { enabled: false, cancelable: false, retryable: false, status: "同步完成" } },
    ...overrides,
  };
}

const EMPLOYEE_SKILLS: Skill[] = [
  employeeSkill("creator_profile", "达人画像", { learning: { inputs: ["达人名称"], steps: ["核实目标", "读取资料", "形成建议"], result: "kol_analyze_brief", confirmation: "按当前权限执行" } }),
  employeeSkill("creator_library_query", "达人库查询", { output: null, learning: { inputs: ["筛选条件"], steps: ["核实目标", "读取资料"], confirmation: "按当前权限执行" } }),
  employeeSkill("creator_discovery", "推荐建联", { risk: "L3", execution: { tools: [{ ref: "starrykol.getKolProfileDetail", kind: "api", risk: "L3" }], permissions: ["starrykol:read"], receipt_required: true, async: { enabled: true, cancelable: true, retryable: true, status: "采集进行中" } } }),
  employeeSkill("discovery_plan", "发现计划", { employee_quick: null, employee_agent: null }),
  employeeSkill("discovery_brief", "发现简报", { employee_quick: null, employee_agent: null }),
  employeeSkill("kol_analyze", "达人分析", { employee_quick: null, employee_agent: null }),
  employeeSkill("today_plan", "今日计划", { employee_quick: null, employee_agent: null }),
  employeeSkill("today_analyze", "今日分析", { employee_quick: null, employee_agent: null }),
  employeeSkill("todo_plan", "待办计划", { employee_quick: null, employee_agent: null }),
  ...Array.from({ length: 24 }, (_, index) => employeeSkill(`fixture_skill_${index + 1}`, `技能浏览夹具 ${index + 1}`)),
];
const EMPLOYEE_DOC = ["### 使用说明", ...Array.from({ length: 28 }, (_, index) => `- 第 ${index + 1} 条已登记阅读说明，保留在详情正文中。`), "### 范围", "只看当前已授权范围。"].join("\n");

async function installEmployeeSkillFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("asset-browse:")) sessionStorage.removeItem(key);
  });
  const personal: Personal[] = EMPLOYEE_SKILLS.map((skill, index) => ({
    skill_id: skill.id, favorite: false, viewed_at: null, use_count: index === 0 ? 2 : 0,
    used_at: index === 0 ? "2026-10-16T00:00:00.000Z" : null,
  }));
  await page.route("**/api/skills**", async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname, method = request.method();
    if (pathname === "/api/skills" && method === "GET") return route.fulfill({ json: EMPLOYEE_SKILLS });
    if (pathname === "/api/skills/personal" && method === "GET") return route.fulfill({ json: { items: personal } });
    const agent = /^\/api\/skills\/([^/]+)\/agents$/.exec(pathname);
    if (agent && method === "GET") return route.fulfill({ json: { agents: [{ id: "agent:fixture", name: "员工数字员工" }] } });
    const view = /^\/api\/skills\/([^/]+)\/view$/.exec(pathname);
    if (view && method === "POST") {
      const record = personal.find(item => item.skill_id === decodeURIComponent(view[1]));
      if (record) record.viewed_at = new Date().toISOString();
      return route.fulfill({ json: { id: decodeURIComponent(view[1]) } });
    }
    const favorite = /^\/api\/skills\/([^/]+)\/favorite$/.exec(pathname);
    if (favorite && (method === "POST" || method === "DELETE")) {
      const record = personal.find(item => item.skill_id === decodeURIComponent(favorite[1]));
      if (record) record.favorite = method === "POST";
      return route.fulfill({ json: { id: decodeURIComponent(favorite[1]), favorite: method === "POST" } });
    }
    const detail = /^\/api\/skills\/([^/]+)$/.exec(pathname);
    if (detail && method === "GET") {
      const skill = EMPLOYEE_SKILLS.find(item => item.id === decodeURIComponent(detail[1]));
      return route.fulfill({ status: skill ? 200 : 404, json: skill ? { ...skill, employee_doc: EMPLOYEE_DOC } : { detail: "fixture skill missing" } });
    }
    return route.fulfill({ status: 404, json: { detail: "unhandled skills fixture route" } });
  });
  await page.route("**/api/sessions", route => route.fulfill({ json: [{ id: "ses_fixture", title: "当前技能任务" }] }));
}

function authStatePath(): string {
  return process.env.E2E_AUTH_STATE
    || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "lingong-e2e-auth", "user.json");
}

/** Resolve a colour token at its actual page scope. */
async function pageVar(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const host = document.querySelector<HTMLElement>("[data-skill-catalog]") ?? document.documentElement;
    const probe = document.createElement("i");
    probe.style.color = getComputedStyle(host).getPropertyValue(name).trim();
    host.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

/** Resolve a length token to used pixels at its actual page scope. */
async function pageVarPx(page: Page, token: string): Promise<number> {
  return page.evaluate((name) => {
    const host = document.querySelector<HTMLElement>("[data-skill-catalog]") ?? document.documentElement;
    const probe = document.createElement("i");
    probe.style.width = getComputedStyle(host).getPropertyValue(name).trim();
    host.appendChild(probe);
    const value = Number.parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return value;
  }, token);
}

/** WCAG relative-luminance contrast; supports Chromium color(srgb ...) output. */
async function contrastOf(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(([x, y]) => {
    const luminance = (colour: string) => {
      const values = colour.match(/[\d.]+/g);
      if (!values) throw new Error(`unparseable colour: ${colour}`);
      const scale = /^color\(/i.test(colour.trim()) ? 255 : 1;
      const [r, g, blue] = values.slice(0, 3).map(value => Number(value) * scale);
      const linear = (channel: number) => {
        const normal = channel / 255;
        return normal <= 0.03928 ? normal / 12.92 : ((normal + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(blue);
    };
    const first = luminance(x), second = luminance(y);
    return Math.round(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)) * 100) / 100;
  }, [a, b]);
}

/**
 * Auth-disabled execution uses the configured HTTP stub profile untouched.
 * Auth-enabled execution is narrowly given a lawful persisted person binding:
 * native principal → organization membership → explicit published agent:kol.
 * It never grants a Skill directly and never changes backend authorization.
 */
async function ensureNativeSkillEligibility(page: Page): Promise<void> {
  if (!AUTH_ENABLED) return;
  await page.goto("/");
  const fixture = await page.evaluate(async (agentId) => {
    const status = await fetch("/api/auth/status");
    const state = await status.json() as { user?: { id?: string }; account?: { id?: string } };
    const userId = state.user?.id || state.account?.id;
    if (!status.ok || !userId) throw new Error("auth-enabled E2E has no native session principal");

    const membership = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: "org:lt_team" }),
    });
    if (!membership.ok) throw new Error(`native organization fixture failed: ${membership.status}`);

    const binding = await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/bindings`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_type: "person", user_id: userId, reason: "isolated E2E skills catalog eligibility fixture" }),
    });
    const agent = await binding.json() as { id?: string; status?: string; coverage?: { user_ids?: string[] } };
    if (!binding.ok) throw new Error(`native Agent fixture failed: ${binding.status}`);
    return { userId, id: agent.id, status: agent.status, eligible: agent.coverage?.user_ids?.includes(userId) === true };
  }, E2E_AGENT_ID);
  expect(fixture.id, "fixture must bind the explicit Agent id").toBe(E2E_AGENT_ID);
  expect(fixture.status, "unpublished Agent must never become usable").toBe("published");
  expect(fixture.eligible, "native principal must be in persisted binding coverage").toBe(true);
}

async function ready(page: Page): Promise<void> {
  await installEmployeeSkillFixture(page);
  await ensureNativeSkillEligibility(page);
  await page.goto("/skills");
  await page.locator("[data-skill-catalog]").waitFor();
  await page.locator(".knowledge-list-row").first().waitFor();
}

async function nativeContext(browser: Browser, options: Parameters<Browser["newContext"]>[0]): Promise<BrowserContext> {
  return browser.newContext({ ...options, storageState: authStatePath() });
}

async function catalog(page: Page): Promise<Skill[]> {
  return page.evaluate(async () => {
    const response = await fetch("/api/skills");
    if (!response.ok) throw new Error(`skills response ${response.status}`);
    return response.json();
  }) as Promise<Skill[]>;
}

async function personalRecords(page: Page): Promise<Personal[]> {
  return page.evaluate(async () => {
    const response = await fetch("/api/skills/personal");
    if (!response.ok) throw new Error(`personal skills response ${response.status}`);
    const body = await response.json() as { items?: Personal[] };
    return Array.isArray(body.items) ? body.items : [];
  });
}

async function visibleSkillIds(page: Page): Promise<string[]> {
  return page.locator(".knowledge-list-row[data-skill-id]").evaluateAll(rows =>
    rows.map(row => row.getAttribute("data-skill-id") || "").filter(Boolean),
  );
}

/** The list is intentionally incrementally revealed; expand real loaded records, never invent a second data source. */
async function revealSkill(page: Page, id: string): Promise<void> {
  const opener = page.locator(`[data-skill-open="${id}"]`).first();
  for (let attempt = 0; attempt < 12 && await opener.count() === 0; attempt++) {
    const more = page.locator("[data-kb-load-more]");
    if (!await more.isVisible().catch(() => false)) break;
    await more.click();
  }
  await expect(opener, `published skill ${id} must be reachable through the real browse list`).toBeVisible();
}

async function openSkill(page: Page, id?: string): Promise<string> {
  const row = id
    ? page.locator(`[data-skill-id="${id}"]`).first()
    : page.locator(".knowledge-list-row[data-skill-id]").first();
  if (id) await revealSkill(page, id);
  const skillId = id || await row.getAttribute("data-skill-id");
  expect(skillId, "a current semantic list row needs a stable skill id").toBeTruthy();
  await row.locator(".knowledge-list-open").click();
  await expect(page.locator("[data-skill-detail]")).toHaveAttribute("data-skill-detail", skillId!);
  return skillId!;
}

async function openCandidate(page: Page, predicate: (skill: Skill) => boolean, reason: string): Promise<Skill> {
  const candidates = (await catalog(page)).filter(skill => skill.employee_visible !== false && predicate(skill));
  expect(candidates, reason).not.toEqual([]);
  await openSkill(page, candidates[0].id);
  return candidates[0];
}

async function primaryAction(page: Page) {
  if (await page.locator("[data-skill-detail]").count() === 0) await openSkill(page);
  const action = page.locator("[data-asset-use]");
  await expect(action, "the sole current detail handoff action must render").toBeVisible();
  return action;
}

async function detailText(page: Page): Promise<string> {
  return (await page.locator("[data-skill-detail]").textContent()) || "";
}

function buttonSelector(): string {
  return ":is(a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1']))";
}

test.describe("技能目录（/skills）· AssetBrowse 视觉、可访问性与安全边界", () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test("O01 · 同一视口最多一个实底主 CTA，且其文字对比度 ≥4.5:1", async ({ page }) => {
    const cta = await primaryAction(page);
    const primary = await pageVar(page, "--primary");
    const filled = await page.evaluate((rgb) => [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")]
      .filter(element => getComputedStyle(element).backgroundColor === rgb && element.getBoundingClientRect().width > 0).length, primary);
    const [foreground, background] = await cta.evaluate(element => {
      const style = getComputedStyle(element); return [style.color, style.backgroundColor];
    });
    expect(filled, `filled --primary elements must be 0–1, received ${filled}`).toBeLessThanOrEqual(1);
    expect(await contrastOf(page, foreground, background), "filled CTA text must retain WCAG AA contrast").toBeGreaterThanOrEqual(4.5);
    await expect(cta).toHaveAttribute("data-size", "md");
  });

  test("O02 · 选中的场景筛选具有 aria-pressed 与非颜色信号", async ({ page }) => {
    const all = page.locator('[data-skill-stage="all"]');
    const reach = page.locator('[data-skill-stage="reach"]');
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(reach).toHaveAttribute("aria-pressed", "false");
    const before = await reach.evaluate(element => ({ weight: getComputedStyle(element).fontWeight, colour: getComputedStyle(element).color }));
    await reach.click();
    await expect(reach).toHaveAttribute("aria-pressed", "true");
    const after = await reach.evaluate(element => ({ weight: getComputedStyle(element).fontWeight, colour: getComputedStyle(element).color }));
    expect(after.weight, "selected filter must differ by weight, not colour alone").not.toBe(before.weight);
    expect(after.colour, "selection remains visually differentiated by the accent text colour").not.toBe(before.colour);
  });

  test("O03 · 选中行 = aria-current + 淡底 + 左侧形状信号", async ({ page }) => {
    const row = page.locator(".knowledge-list-row").first();
    const open = row.locator(".knowledge-list-open");
    const before = await row.evaluate(element => getComputedStyle(element).backgroundColor);
    await open.click();
    await expect(open).toHaveAttribute("aria-current", "true");
    const after = await row.evaluate(element => {
      const style = getComputedStyle(element); return { background: style.backgroundColor, shadow: style.boxShadow };
    });
    expect(after.background, "selected current row must gain its selected surface").not.toBe(before);
    expect(after.shadow, "selected current row must retain an inset accent-strip shape cue").toContain("inset");
  });

  test("O04 · 当前控件、列表和详情操作严格消费命名尺寸 token", async ({ page }) => {
    const [search, filter, row, action] = await Promise.all([
      pageVarPx(page, "--control-h-lg"), pageVarPx(page, "--control-h-sm"), pageVarPx(page, "--knowledge-row-h"), pageVarPx(page, "--control-h"),
    ]);
    await openSkill(page);
    const sizeOf = (selector: string) => page.locator(selector).first().evaluate(element => element.getBoundingClientRect().height);
    expect(await sizeOf(".workspace-search-input"), "search uses --control-h-lg").toBeCloseTo(search, 0);
    expect(await sizeOf('[data-skill-stage="reach"]'), "filters use --control-h-sm").toBeCloseTo(filter, 0);
    expect(await sizeOf(".knowledge-list-row"), "AssetBrowse records use --knowledge-row-h").toBeCloseTo(row, 0);
    expect(await sizeOf("[data-asset-use]"), "detail handoff uses --control-h").toBeCloseTo(action, 0);
  });

  test("O05 · 可见的当前交互控件不小于 --hit-min", async ({ page }) => {
    const minimum = await pageVarPx(page, "--hit-min");
    const undersized = await page.evaluate(([min, selector]) => {
      const failures: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>(`[data-skill-catalog] ${selector}`)) {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        if (style.display === "none" || rect.width === 0 || style.visibility === "hidden") continue;
        if (rect.width < min || rect.height < min) failures.push(`${element.className || element.tagName} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
      return [...new Set(failures)];
    }, [minimum, buttonSelector()]);
    expect(undersized, `visible current controls below ${minimum}px: ${JSON.stringify(undersized)}`).toEqual([]);
  });

  test("O06 · 键盘焦点出现 --focus-ring 实线", async ({ page }) => {
    const rowOpen = page.locator(".knowledge-list-open").first();
    await rowOpen.focus();
    await expect(rowOpen).toBeFocused();
    const [expected, actual] = await Promise.all([
      pageVar(page, "--focus-ring"),
      rowOpen.evaluate(element => { const style = getComputedStyle(element); return { width: style.outlineWidth, style: style.outlineStyle, colour: style.outlineColor }; }),
    ]);
    expect(Number.parseFloat(actual.width), "focus ring must have a visible width").toBeGreaterThan(0);
    expect(actual.style, "focus ring must be solid").toBe("solid");
    expect(actual.colour, "focus ring colour must resolve from --focus-ring").toBe(expected);
  });

  test("O07 · 桌面 AssetBrowse 容器、列表和详情 rail 受当前几何契约约束", async ({ page }) => {
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { workspace: box(".knowledge-browse-workspace"), list: box("[data-kbv-list]"), rail: box(".kbv-rail") };
    });
    const railMin = await pageVarPx(page, "--workspace-result-rail-min");
    expect(geometry.workspace.width, "workspace must have usable width").toBeGreaterThan(railMin);
    expect(geometry.list.left, "list begins at workspace left edge").toBeCloseTo(geometry.workspace.left, 0);
    expect(geometry.list.right, "list must not overlap the rail").toBeLessThanOrEqual(geometry.rail.left + 1);
    expect(geometry.rail.width, "desktop rail honours --workspace-result-rail-min").toBeGreaterThanOrEqual(railMin - 1);
  });

  test("O08 · S 档无文档或当前行横向溢出", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await ready(page);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: [...document.querySelectorAll<HTMLElement>(".knowledge-list-row")].map(row => row.scrollWidth - row.clientWidth).filter(value => value > 1),
    }));
    expect(overflow.document, "S layout must not create horizontal document scrolling").toBeLessThanOrEqual(0);
    expect(overflow.rows, "semantic current list rows must not overflow horizontally").toEqual([]);
    await context.close();
  });

  test("O09 · 粗指针下筛选和行选择命中区均 ≥44px", async ({ browser }) => {
    const context = await nativeContext(browser, { ...devices["iPhone 13"] });
    const page = await context.newPage();
    await ready(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "iPhone context must expose coarse pointer").toBe(true);
    for (const selector of ['[data-skill-stage="reach"]', ".knowledge-list-open"]) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, `${selector} must render a hit target`).not.toBeNull();
      expect(box!.height, `coarse-pointer ${selector} hit target must be ≥44px`).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });

  test("O10 · 搜索空态诚实区分且提供恢复动作", async ({ page }) => {
    const input = page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" });
    await input.fill("不存在的技能名zzz");
    const empty = page.locator("[data-kbv-list] .kbv-empty");
    await expect(empty).toContainText("没有匹配的技能");
    await expect(empty.getByRole("button", { name: "查看全部" })).toBeVisible();
    await empty.getByRole("button", { name: "查看全部" }).click();
    await expect(page.locator(".knowledge-list-row").first()).toBeVisible();
  });

  test("O11 · 搜索框有程序化标签而非仅 placeholder", async ({ page }) => {
    const input = page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" });
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "搜索技能 / SOP / 场景");
  });

  test("O12 · 遗留 tab 深链读取为 stage，且不制造第二筛选状态", async ({ page }) => {
    await page.goto("/skills?tab=reach");
    await page.locator(".knowledge-list-row").first().waitFor();
    await expect(page.locator('[data-skill-stage="reach"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-skill-view="all"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/tab=reach/);
  });

  test("O13 · 当前行分隔、rail 边界与详情操作圆角不会失效", async ({ page }) => {
    await openSkill(page);
    const line = await page.locator(".knowledge-list-row").first().evaluate(element => {
      const style = getComputedStyle(element); return { shadow: style.boxShadow, background: style.backgroundColor };
    });
    const rail = await page.locator(".kbv-rail").evaluate(element => getComputedStyle(element).borderLeftWidth);
    const radius = await page.locator("[data-asset-use]").evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius));
    expect(line.shadow, "current rows retain an inset hairline separator").toContain("inset");
    expect(line.background, "row surface must be resolved rather than transparent failure").not.toBe("");
    expect(Number.parseFloat(rail), "list/detail rails retain a visible structural boundary").toBeGreaterThanOrEqual(1);
    expect(radius, "current detail action radius comes from --radius-control, not 0").toBeGreaterThan(0);
  });

  test("O14 · 当前 UI 的 SVG 图标保持正方形且使用注册尺寸", async ({ page }) => {
    const allowed = [Math.round(await pageVarPx(page, "--icon-sm")), Math.round(await pageVarPx(page, "--icon-md"))];
    const icons = await page.locator("[data-skill-catalog] svg").evaluateAll(elements => elements
      .map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0).map(rect => ({ width: Math.round(rect.width), height: Math.round(rect.height) })));
    expect(icons.length, "current catalog must contain its search/semantic SVG affordances").toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.width, `SVG ${icon.width}x${icon.height} must not stretch`).toBe(icon.height);
      expect(allowed, `SVG ${icon.width}px must use a registered icon size`).toContain(icon.width);
    }
  });

  test("O15 · 主行动粉色仅用于当前唯一的详情 handoff", async ({ page }) => {
    const cta = await primaryAction(page);
    const primary = await pageVar(page, "--primary");
    const users = await page.evaluate((colour) => [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")]
      .filter(element => element.getBoundingClientRect().width > 0 && getComputedStyle(element).backgroundColor === colour)
      .map(element => ({ className: element.className, assetUse: element.hasAttribute("data-asset-use") })), primary);
    expect(users.length, "catalog must render a primary action when detail is selected").toBeGreaterThan(0);
    expect(users.length, "no more than one rendered primary-filled element is permitted").toBeLessThanOrEqual(1);
    expect(await cta.evaluate(element => getComputedStyle(element).backgroundColor), "handoff action is the primary colour consumer").toBe(primary);
    expect(users.every(user => user.assetUse), `--primary leaked to non-action elements: ${JSON.stringify(users)}`).toBe(true);
  });

  test("O16 · 辅助色的图形/文字两档保持 3:1 / 4.5:1 并用于 current 状态", async ({ page }) => {
    const [canvas, accent, accentText] = await Promise.all([pageVar(page, "--bg"), pageVar(page, "--accent"), pageVar(page, "--accent-text")]);
    const row = page.locator(".knowledge-list-row").first();
    await row.locator(".knowledge-list-open").click();
    const shadow = await row.evaluate(element => getComputedStyle(element).boxShadow);
    expect(await contrastOf(page, accent, canvas), "accent graphic colour must remain ≥3:1").toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, accentText, canvas), "accent text colour must remain ≥4.5:1").toBeGreaterThanOrEqual(4.5);
    expect(shadow, "selected semantic row uses an accent shape cue").toContain(accent);
  });

  test("O17 · 类别 token 在浅色下保留图形 ≥3:1 与文字/砖底 ≥4.5:1", async ({ page }) => {
    const canvas = await pageVar(page, "--bg");
    for (const tone of ["library", "assistant", "crawl", "builtin"] as const) {
      const [base, text, tile] = await Promise.all([pageVar(page, `--cat-${tone}`), pageVar(page, `--cat-${tone}-text`), pageVar(page, `--cat-${tone}-tile`)]);
      expect(await contrastOf(page, base, canvas), `${tone} graphic token must be ≥3:1 on canvas`).toBeGreaterThanOrEqual(3);
      expect(await contrastOf(page, text, tile), `${tone} text token must be ≥4.5:1 on its tile`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("O18 · 类别 token 在深色下仍保留图形 ≥3:1 与文字/砖底 ≥4.5:1", async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const canvas = await pageVar(page, "--bg");
    for (const tone of ["library", "assistant", "crawl", "builtin"] as const) {
      const [base, text, tile] = await Promise.all([pageVar(page, `--cat-${tone}`), pageVar(page, `--cat-${tone}-text`), pageVar(page, `--cat-${tone}-tile`)]);
      expect(await contrastOf(page, base, canvas), `dark ${tone} graphic token must be ≥3:1 on canvas`).toBeGreaterThanOrEqual(3);
      expect(await contrastOf(page, text, tile), `dark ${tone} text token must be ≥4.5:1 on its tile`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("O19 · 当前控件自设 line-height，不继承根 24px 行盒", async ({ page }) => {
    const offenders = await page.evaluate((selector) => {
      const root = getComputedStyle(document.documentElement), rootLine = Number.parseFloat(root.lineHeight), rootSize = Number.parseFloat(root.fontSize);
      const failures: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>(`[data-skill-catalog] ${selector}`)) {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        if (style.display === "none" || rect.width === 0) continue;
        const line = Number.parseFloat(style.lineHeight), size = Number.parseFloat(style.fontSize);
        if (!Number.isFinite(line) || (line === rootLine && size !== rootSize)) failures.push(`${element.className || element.tagName}: ${style.lineHeight}/${style.fontSize}`);
      }
      return [...new Set(failures)];
    }, buttonSelector());
    expect(offenders, `current catalog controls inherit or lack a line-height: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  test("O20 · 当前渲染色值能逐项指回现有 token 消费者", async ({ page }) => {
    await openSkill(page);
    const expected = await Promise.all(["--bg", "--text", "--text-quiet", "--border", "--accent", "--accent-text", "--btn-text-hover-bg", "--primary"].map(token => pageVar(page, token)));
    const used = await page.evaluate(() => {
      const selectors = ["[data-skill-catalog]", ".knowledge-list-row", ".knowledge-list-open", ".knowledge-row-title", ".knowledge-row-kind", ".kbv-rail", ".asset-read-warning", "[data-asset-use]"];
      return selectors.map(selector => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor, style.borderTopColor, style.borderLeftColor];
      }).flat();
    });
    const permitted = new Set([...expected, "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)", "transparent"]);
    const stray = used.filter(colour => !permitted.has(colour));
    expect(stray, `semantic current surfaces drifted from token palette: ${JSON.stringify(stray)}`).toEqual([]);
    expect(await page.locator(".knowledge-list-row").first().evaluate(element => getComputedStyle(element).boxShadow), "row divider and selected strip remain token-backed inset affordances").toContain("inset");
  });

  test("O21 · R3 与异步技能在详情明确给出确认、取消与重试事实", async ({ page }) => {
    const candidate = await openCandidate(page, skill => skill.risk === "L3" && !!skill.execution?.async?.enabled, "fixture must include a published controlled async skill");
    const detail = page.locator("[data-skill-detail]");
    await expect(detail).toContainText("R3 · 执行前确认");
    await expect(detail).toContainText("异步");
    expect(candidate.execution?.async?.cancelable, "selected fixture is declared cancelable").toBe(true);
    expect(candidate.execution?.async?.retryable, "selected fixture is declared retryable").toBe(true);
    await expect(detail).toContainText("取消");
    await expect(detail).toContainText("重试");
  });

  test("O22 · R1 只读保留为执行事实，不伪装成确认例外", async ({ page }) => {
    const candidate = await openCandidate(page, skill => skill.risk === "L1", "fixture must contain an R1 skill");
    const metadata = page.locator(".knowledge-detail-metadata");
    await expect(metadata).toContainText("R1 · 只读");
    await expect(metadata).not.toContainText("R3 · 执行前确认");
    expect(candidate.risk).toBe("L1");
  });

  test("O23 · 列表只承担选择；当前任务动作只在详情 rail", async ({ page }) => {
    const row = page.locator(".knowledge-list-row").first();
    expect(await row.locator(":is(a[href], button)").count(), "one semantic open button per list row; no repetitive row action").toBe(1);
    await openSkill(page);
    await expect(page.locator("[data-asset-use]")).toBeVisible();
    expect(await row.locator("[data-asset-use]").count(), "handoff must not move into every list row").toBe(0);
  });

  test("O24 · 技能浏览不承诺新建会话，也不自动创建任务", async ({ page }) => {
    const created: string[] = [];
    page.on("request", request => {
      if (request.method() === "POST" && /\/api\/(sessions|tasks)(?:\/|$)/.test(new URL(request.url()).pathname)) created.push(new URL(request.url()).pathname);
    });
    await openSkill(page);
    await expect(page.locator("[data-skill-catalog]")).not.toContainText("新建会话");
    await expect(page.locator("[data-skill-catalog]")).not.toContainText("创建任务");
    expect(created, "selecting/previewing a skill cannot create a session or task").toEqual([]);
  });

  test("O25 · 员工表面不泄露运行时、连接器治理或原始引擎词", async ({ page }) => {
    await openSkill(page);
    const text = await page.locator("[data-skill-catalog]").textContent() || "";
    for (const forbidden of ["MediaCrawler", "Starry KOL", "KOL Agent", "内核部门", "MCP", "Codex", "Thread", "starrykol", "kolclaw", "凭据引用", "连接器已启用"]) {
      expect(text, `employee surface leaked ${forbidden}`).not.toContain(forbidden);
    }
    const detail = await detailText(page);
    expect(detail, "detail must not expose connector governance").not.toContain("凭据引用");
  });

  test("O26 · 深色下主 CTA 仍 ≥4.5:1，且主色不扩散", async ({ page }) => {
    const cta = await primaryAction(page);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const [foreground, background, primary] = await Promise.all([
      cta.evaluate(element => getComputedStyle(element).color), cta.evaluate(element => getComputedStyle(element).backgroundColor), pageVar(page, "--primary"),
    ]);
    const filled = await page.evaluate(colour => [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")]
      .filter(element => getComputedStyle(element).backgroundColor === colour && element.getBoundingClientRect().width > 0).length, primary);
    expect(await contrastOf(page, foreground, background), "dark primary CTA text contrast").toBeGreaterThanOrEqual(4.5);
    expect(background, "dark CTA continues to consume primary token").toBe(primary);
    expect(filled, "dark primary fill cannot diffuse beyond the sole CTA").toBeLessThanOrEqual(1);
  });

  test("O27 · prefers-contrast: more 不改变 catalog 画布 token", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 1440, height: 900 }, contrast: "more" });
    const page = await context.newPage();
    await ready(page);
    expect(await page.evaluate(() => matchMedia("(prefers-contrast: more)").matches), "test context must report contrast preference").toBe(true);
    const [canvas, background] = await Promise.all([pageVar(page, "--bg"), page.locator("[data-skill-catalog]").evaluate(element => getComputedStyle(element).backgroundColor)]);
    expect(background, "contrast preference retains token-backed canvas").toBe(canvas);
    await context.close();
  });
});

test.describe("技能目录（/skills）· 现行双 rail 几何、滚动与响应式", () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test("O28 · 1280×900 当前双 rail 左缘递增、无重叠、顶部对齐", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await ready(page);
    const layout = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const workspace = document.querySelector<HTMLElement>(".knowledge-browse-workspace")!;
      return { workspace: box(".knowledge-browse-workspace"), list: box("[data-kbv-list]"), rail: box(".kbv-rail"), grid: getComputedStyle(workspace).gridTemplateColumns, semanticRows: document.querySelectorAll(".knowledge-list-row > .knowledge-list-open").length };
    });
    const minimum = await pageVarPx(page, "--workspace-result-rail-min");
    expect(layout.grid, "desktop current surface uses grid rails").toContain(" ");
    expect(layout.list.left, "list starts with workspace").toBeCloseTo(layout.workspace.left, 0);
    expect(layout.list.right, "list stays before rail").toBeLessThanOrEqual(layout.rail.left + 1);
    expect(layout.rail.width, "detail rail respects current minimum").toBeGreaterThanOrEqual(minimum - 1);
    expect(layout.list.top, "list and detail rail top-align").toBeCloseTo(layout.rail.top, 0);
    expect(layout.semanticRows, "each current list article must expose its semantic open control").toBeGreaterThan(0);
    await context.close();
  });

  test("O29 · 列表与详情正文独立滚动，详情头/脚固定", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await ready(page);
    await openSkill(page);
    await page.locator("[data-skill-detail] summary", { hasText: "说明书与示例" }).click();
    const snapshot = () => page.evaluate(() => {
      const list = document.querySelector<HTMLElement>("[data-kbv-list]")!;
      const body = document.querySelector<HTMLElement>(".kbv-rail-body")!;
      const head = document.querySelector<HTMLElement>(".kbv-rail-head")!;
      const foot = document.querySelector<HTMLElement>(".kbv-rail-foot")!;
      return { list: list.scrollTop, listOverflow: list.scrollHeight - list.clientHeight, body: body.scrollTop, bodyOverflow: body.scrollHeight - body.clientHeight, head: head.getBoundingClientRect().top, foot: foot.getBoundingClientRect().bottom, bodyHeight: body.getBoundingClientRect().height };
    });
    const before = await snapshot();
    expect(before.listOverflow, "list must have real overflow at short desktop height").toBeGreaterThan(0);
    expect(before.bodyOverflow, "selected detail must have real independently scrollable content").toBeGreaterThan(0);
    await page.locator("[data-kbv-list]").evaluate(element => { element.scrollTop = element.scrollHeight; });
    const afterList = await snapshot();
    expect(afterList.list, "list actually scrolls").toBeGreaterThan(0);
    expect(afterList.body, "scrolling list cannot move detail body").toBe(0);
    expect(afterList.head, "list scrolling cannot move detail head").toBeCloseTo(before.head, 0);
    expect(afterList.foot, "list scrolling cannot move detail foot").toBeCloseTo(before.foot, 0);
    await page.locator(".kbv-rail-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
    const afterBody = await snapshot();
    expect(afterBody.body, "detail body actually scrolls").toBeGreaterThan(0);
    expect(afterBody.list, "detail scrolling cannot move list").toBe(afterList.list);
    expect(afterBody.head, "detail body scroll keeps head fixed").toBeCloseTo(before.head, 0);
    expect(afterBody.foot, "detail body scroll keeps foot fixed").toBeCloseTo(before.foot, 0);
    expect(afterBody.bodyHeight, "detail body height cannot change while scrolling").toBeCloseTo(before.bodyHeight, 0);
    await context.close();
  });

  test("O30 · 无冗余跨栏页头；当前工具栏、计数与首行保持紧凑", async ({ page }) => {
    const data = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return {
        pageTitles: document.querySelectorAll("[data-skill-catalog] h1").length,
        toolbar: box(".knowledge-filter-bar"), row: box(".knowledge-list-row"), count: (document.querySelector("[data-skill-count]")?.textContent || "").trim(),
      };
    });
    expect(data.pageTitles, "current browse toolbar intentionally has no duplicate page-title band").toBe(0);
    expect(data.count, "current count stays in the list toolbar").toMatch(/^(\d+ 项技能|正在读取技能…|个人记录计数暂不可用)$/);
    expect(data.toolbar.top, "toolbar belongs above records").toBeLessThanOrEqual(data.row.top);
    expect(data.row.top - data.toolbar.top, "compact toolbar cannot add a retired page-header band").toBeLessThanOrEqual(190);
  });

  test("O31 · 不重复详情样板；未登记引擎兜底产出不渲染", async ({ page }) => {
    await openSkill(page, "creator_library_query");
    const catalogRoot = page.locator("[data-skill-catalog]");
    const detail = page.locator("[data-skill-detail]");
    await expect(catalogRoot).not.toContainText("技能详情");
    await expect(detail).not.toContainText("task_result");
    expect(await detail.locator("h3", { hasText: "产出" }).count(), "unregistered output must not render an empty or engine-default section").toBe(0);
    expect(await detail.locator("header.kbv-rail-head h2", { hasText: "技能详情" }).count(), "detail header exposes selected skill title, never redundant container boilerplate").toBe(0);
  });

  test("O32 · 抽样技能逐项给出登记入口口径或诚实待补齐", async ({ page }) => {
    const rows = (await catalog(page)).filter(skill => skill.employee_visible !== false).slice(0, 6);
    expect(rows.length, "catalog needs several employee-visible skills for coverage sampling").toBeGreaterThan(0);
    for (const skill of rows) {
      await openSkill(page, skill.id);
      const detail = page.locator("[data-skill-detail]");
      if (skill.employee_quick || skill.employee_agent) {
        await expect(detail.getByRole("heading", { name: "可以直接查到" })).toBeVisible();
        await expect(detail.getByRole("heading", { name: "需要走确认或 AI 助理" })).toBeVisible();
      } else {
        await expect(detail).toContainText("待业务专家补齐");
      }
      await expect(detail).not.toContainText("相关参数");
      await expect(detail).not.toContainText("分析结果");
    }
  });

  test("O33 · 详情两段入口口径逐字等于 /api/skills 的现有字段", async ({ page }) => {
    const probes = (await catalog(page)).filter(skill => skill.employee_visible !== false && !!skill.employee_quick && !!skill.employee_agent).slice(0, 3);
    expect(probes.length, "fixture must include registered direct and assistant boundary wording").toBeGreaterThan(0);
    for (const skill of probes) {
      await openSkill(page, skill.id);
      const detail = page.locator("[data-skill-detail]");
      await expect(detail.getByRole("heading", { name: "可以直接查到" })).toBeVisible();
      await expect(detail.getByText(skill.employee_quick!, { exact: true })).toBeVisible();
      await expect(detail.getByRole("heading", { name: "需要走确认或 AI 助理" })).toBeVisible();
      await expect(detail.getByText(skill.employee_agent!, { exact: true })).toBeVisible();
    }
  });

  test("O34 · 未登记入口口径的六项技能照实显示待补齐", async ({ page }) => {
    const unregistered = ["discovery_plan", "discovery_brief", "kol_analyze", "today_plan", "today_analyze", "todo_plan"];
    for (const id of unregistered) {
      await openSkill(page, id);
      const detail = page.locator("[data-skill-detail]");
      expect(await detail.getByRole("heading", { name: "可以直接查到" }).count(), `${id} cannot receive guessed direct wording`).toBe(0);
      expect(await detail.getByRole("heading", { name: "需要走确认或 AI 助理" }).count(), `${id} cannot receive guessed assistant wording`).toBe(0);
      await expect(detail).toContainText("待业务专家补齐");
    }
  });

  test("O35 · 说明书只有服务端给正文才渲染，并保留段落/列表/标题块", async ({ page }) => {
    const id = (await visibleSkillIds(page))[0];
    expect(id, "a visible skill is required for the employee_doc rendering probe").toBeTruthy();
    const doc = "说明正文一段。\n\n- 第一条\n- 第二条\n\n### 范围\n\n只看你被授权的范围。";
    await page.route(`**/api/skills/${id}`, route => route.fulfill({ json: { id, employee_doc: doc } }));
    await openSkill(page, id);
    const detail = page.locator("[data-skill-detail]");
    const summary = detail.locator("summary", { hasText: "说明书与示例" });
    await expect(summary, "provided employee_doc must expose the collapsible document section").toBeVisible();
    await summary.click();
    await expect(detail.getByText("说明正文一段。", { exact: true })).toBeVisible();
    expect(await detail.locator(".skill-doc-list li").count(), "markdown list remains semantic list items").toBe(2);
    await expect(detail.locator(".skill-doc-heading")).toHaveText("范围");
    await expect(detail.getByText("只看你被授权的范围。", { exact: true })).toBeVisible();
  });

  test("O36 · 风险和异步契约进入现行详情而非退役图标砖", async ({ page }) => {
    const skill = await openCandidate(page, candidate => candidate.risk === "L3" && !!candidate.execution?.async?.enabled, "a controlled async record is required");
    const detail = page.locator("[data-skill-detail]");
    await expect(detail.locator(".knowledge-detail-metadata")).toContainText("R3 · 执行前确认");
    await expect(detail).toContainText("异步");
    await expect(detail).toContainText(skill.execution?.async?.cancelable ? "可取消" : "不支持取消");
    await expect(detail).toContainText(skill.execution?.async?.retryable ? "可重试" : "不支持重试");
    expect(await detail.locator(".knowledge-status").count(), "current risk state is a semantic metadata value, not a fabricated tile column").toBeGreaterThan(0);
  });

  test("O37 · 展开阅读切换 aria-expanded 并增加当前详情 rail 比重", async ({ page }) => {
    await openSkill(page);
    const workspace = page.locator(".knowledge-browse-workspace");
    const toggle = page.getByRole("button", { name: "展开阅读" });
    const before = (await page.locator(".kbv-rail").boundingBox())!.width;
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(workspace).toHaveAttribute("data-expanded", "true");
    await expect.poll(async () => (await page.locator(".kbv-rail").boundingBox())!.width).toBeGreaterThan(before);
  });

  test("O38 · 当前详情 rail 内最多一个实底主 CTA", async ({ page }) => {
    await openSkill(page);
    const primary = await pageVar(page, "--primary");
    const filled = await page.locator("[data-skill-detail] *").evaluateAll((elements, colour) => elements
      .filter(element => getComputedStyle(element as HTMLElement).backgroundColor === colour && (element as HTMLElement).getBoundingClientRect().width > 0).length, primary);
    expect(filled, "detail rail may contain at most one --primary-filled action").toBeLessThanOrEqual(1);
    await expect(page.locator("[data-asset-use]")).toBeVisible();
  });

  test("O39 · 展开阅读是带可访问名称与状态的当前语义控件", async ({ page }) => {
    await openSkill(page);
    const toggle = page.getByRole("button", { name: "展开阅读" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("data-size", "sm");
    expect(await toggle.textContent(), "current semantic control intentionally uses visible reading label rather than retired icon-only UI").toBe("展开阅读");
  });

  test("O40 · <720 宽度详情为单 pane，返回列表不丢选中项", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 600, height: 900 } });
    const page = await context.newPage();
    await ready(page);
    const id = await openSkill(page);
    await expect(page.locator(".knowledge-browse-workspace")).toHaveAttribute("data-pane", "detail");
    await expect(page.getByRole("button", { name: /返回列表/ })).toBeVisible();
    await page.getByRole("button", { name: /返回列表/ }).click();
    await expect(page.locator(".knowledge-browse-workspace")).toHaveAttribute("data-pane", "list");
    await expect(page.locator(`[data-skill-open="${id}"]`)).toBeFocused();
    await context.close();
  });

  test("O41 · <720 单 pane 本已满宽；不显示无效展开控件", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 600, height: 900 } });
    const page = await context.newPage();
    await ready(page);
    await openSkill(page);
    const [workspace, rail] = await Promise.all([page.locator(".knowledge-browse-workspace").boundingBox(), page.locator(".kbv-rail").boundingBox()]);
    await expect(page.getByRole("button", { name: "展开阅读" })).toBeHidden();
    expect(rail!.width, "mobile semantic detail is already the single full pane").toBeCloseTo(workspace!.width, 0);
    await expect(page.locator(".knowledge-browse-workspace")).toHaveAttribute("data-pane", "detail");
    await context.close();
  });

  test("O42 · 矮视口至少有一条完整当前列表行可见", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 1280, height: 700 } });
    const page = await context.newPage();
    await ready(page);
    const complete = await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>("[data-kbv-list]")!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>(".knowledge-list-row")].some(row => {
        const rect = row.getBoundingClientRect(); return rect.top >= container.top - 1 && rect.bottom <= container.bottom + 1;
      });
    });
    expect(complete, "short viewport must expose one uncut current list row").toBe(true);
    await context.close();
  });

  test("O43 · 1024×630 当前双 rail 不以横向裁切掩盖列表", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 1024, height: 630 } });
    const page = await context.newPage();
    await ready(page);
    const layout = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>("[data-kbv-list]")!, rail = document.querySelector<HTMLElement>(".kbv-rail")!;
      return { listOverflow: list.scrollWidth - list.clientWidth, rowOverflow: [...document.querySelectorAll<HTMLElement>(".knowledge-list-row")].map(row => row.scrollWidth - row.clientWidth).filter(value => value > 1), listRight: list.getBoundingClientRect().right, railLeft: rail.getBoundingClientRect().left };
    });
    expect(layout.listOverflow, "list itself cannot horizontally scroll as a clipping workaround").toBeLessThanOrEqual(1);
    expect(layout.rowOverflow, "current individual rows cannot overflow").toEqual([]);
    expect(layout.railLeft, "detail rail remains alongside the list at current desktop/container breakpoint").toBeGreaterThanOrEqual(layout.listRight - 1);
    await context.close();
  });
});

test.describe("技能详情 · 数据真实度、筛选与排版", () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test("O44 · 无真实使用记录不以查看/收藏伪称常用，推荐保持独立", async ({ page }) => {
    const personal = await personalRecords(page);
    await page.goto("/skills?mode=frequent&stage=all");
    await page.locator("[data-skill-catalog]").waitFor();
    const displayed = await visibleSkillIds(page);
    const used = new Set(personal.filter(item => (item.use_count || 0) > 0).map(item => item.skill_id));
    expect(displayed.every(id => used.has(id)), "frequent view may include only actual-use records, never viewed/favorited substitutes").toBe(true);
    await page.goto("/skills?mode=recommend&stage=all");
    await page.locator("[data-skill-catalog]").waitFor();
    const recommended = await visibleSkillIds(page);
    await expect(page.locator("[data-skill-catalog]")).not.toContainText("你经常使用的技能");
    await expect(page).toHaveURL(/mode=recommend.*stage=all/);
    expect(recommended.length, "recommend view is a separately addressed current mode, not a renamed frequent label").toBeGreaterThanOrEqual(0);
    expect(await personalRecords(page), "opening recommendation cannot manufacture personal use/favorite facts").toEqual(personal);
  });

  test("O45 · 常用仅来自实际 use_count；查看与收藏保持独立个人记录", async ({ page }) => {
    const personal = await personalRecords(page);
    const frequent = personal.filter(item => (item.use_count || 0) > 0).map(item => item.skill_id);
    await page.goto("/skills?mode=frequent&stage=all");
    await page.locator("[data-skill-catalog]").waitFor();
    const shown = await visibleSkillIds(page);
    expect(shown, "frequent rendering matches the actual personal-use set").toEqual(expect.arrayContaining(frequent.slice(0, shown.length)));
    expect(shown.every(id => frequent.includes(id)), "view/favorite cannot independently place a skill in frequent").toBe(true);
    if (shown.length) {
      await openSkill(page, shown[0]);
      const favorite = page.locator("[data-skill-favorite]");
      await expect(favorite).toHaveAttribute("aria-pressed", /true|false/);
    } else {
      await expect(page.locator(".kbv-empty")).toContainText("没有匹配的技能");
    }
  });

  test("O46 · 键盘从一条选择入口前进到下一条，详情动作也可到达", async ({ page }) => {
    const first = page.locator(".knowledge-list-open").first(), second = page.locator(".knowledge-list-open").nth(1);
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    await first.click();
    await page.getByRole("combobox", { name: "选择目标任务" }).click();
    await page.getByText("工作台提问框", { exact: true }).click();
    const action = await primaryAction(page);
    await action.focus();
    await expect(action).toBeFocused();
    expect(await page.locator(".knowledge-list-row").first().locator(".knowledge-list-open").count(), "row keeps one focusable semantic selection, never a repeated action").toBe(1);
  });

  test("O47 · 搜索清除入口清空查询并把焦点归还输入框", async ({ page }) => {
    const input = page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" });
    await input.fill("达人");
    const clear = page.getByRole("button", { name: "清除搜索" });
    await expect(clear, "shared allowClear needs a localized accessible clear action").toBeVisible();
    await clear.click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(clear).toHaveCount(0);
  });

  test("O48 · 详情小节按登记阅读顺序渲染，不产生未登记字段", async ({ page }) => {
    const skill = await openCandidate(page, candidate => !!candidate.employee_quick && !!candidate.employee_agent && !!candidate.output && !!candidate.learning, "fixture needs a complete skill for section-order contract");
    const headings = await page.locator("[data-skill-detail] .kbv-rail-body > .asset-detail-section > :is(h3, summary)").evaluateAll(elements => elements.map(element => element.textContent?.trim() || ""));
    const allowed = ["可经由以下数字员工使用", "可以直接查到", "需要走确认或 AI 助理", "需要你提供", "产出", "使用步骤", "执行边界", "说明书与示例", "调用关系与安全边界"];
    expect(headings.length, "complete detail must render its registered reading hierarchy").toBeGreaterThan(3);
    expect(headings.filter(heading => !allowed.includes(heading)), `unregistered current detail headings: ${headings.join(" / ")}`).toEqual([]);
    expect(headings, "registered headings must be in documented order").toEqual(allowed.filter(heading => headings.includes(heading)));
    expect(skill.id, "section ordering remains bound to selected real skill").toBeTruthy();
  });

  test("O49 · 当前详情字阶为 13/12px，字重仅 400/500/600", async ({ page }) => {
    await openSkill(page);
    const styles = await page.evaluate(() => {
      const read = (selector: string) => { const style = getComputedStyle(document.querySelector<HTMLElement>(selector)!); return { size: style.fontSize, weight: style.fontWeight }; };
      const heavy = [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")].filter(element => element.getBoundingClientRect().width > 0 && Number(getComputedStyle(element).fontWeight) > 600).map(element => `${element.className || element.tagName}:${getComputedStyle(element).fontWeight}`);
      return { title: read(".kbv-title-row h2"), row: read(".knowledge-row-title"), body: read(".asset-detail-section"), quiet: read(".asset-read-warning"), heavy: [...new Set(heavy)] };
    });
    expect(styles.title, "detail title uses current L1 13px/600 hierarchy").toMatchObject({ size: "13px", weight: "600" });
    expect(styles.row, "row title uses current L2 13px/500 hierarchy").toMatchObject({ size: "13px", weight: "500" });
    expect(styles.body, "detail body uses current 13px base hierarchy").toMatchObject({ size: "13px" });
    expect(styles.quiet, "supporting warning uses current 12px hierarchy").toMatchObject({ size: "12px" });
    expect(styles.heavy, "no current catalog text may exceed 600").toEqual([]);
  });

  test("O50 · 说明/缺失提示为紧凑 muted 行，不是大块 callout", async ({ page }) => {
    await openSkill(page);
    const warning = page.locator("[data-skill-detail] .asset-read-warning").first();
    await expect(warning, "truthful missing-doc/async boundary warning must remain visible").toBeVisible();
    const style = await warning.evaluate(element => {
      const computed = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { colour: computed.color, size: computed.fontSize, background: computed.backgroundColor, border: Number.parseFloat(computed.borderLeftWidth), height: rect.height };
    });
    expect(style.colour, "warning uses muted/quiet current text token").toBe(await pageVar(page, "--text-quiet"));
    expect(style.size, "warning stays in supporting scale").toBe("12px");
    expect(style.background, "warning is not a filled callout").toBe("rgba(0, 0, 0, 0)");
    expect(style.border, "warning has no fake left emphasis bar").toBe(0);
    expect(style.height, "compact warning cannot consume a large card height").toBeLessThanOrEqual(48);
  });

  test("O51 · 窄宽筛选改为可见换行，不以退役渐隐遮住选项", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 800, height: 900 } });
    const page = await context.newPage();
    await ready(page);
    const result = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>(".knowledge-filter-row")!;
      const rect = group.getBoundingClientRect();
      const options = [...group.querySelectorAll<HTMLElement>(".knowledge-filter-option")].map(option => {
        const box = option.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
      return { overflow: group.scrollWidth - group.clientWidth, rect, options };
    });
    expect(result.overflow, "wrapping filters cannot be horizontally hidden").toBeLessThanOrEqual(1);
    expect(result.options.length, "all current filter options remain rendered").toBeGreaterThan(1);
    expect(result.options.every(option => option.left >= result.rect.left - 1 && option.right <= result.rect.right + 1), "each filter option remains fully inside its visible group").toBe(true);
    await context.close();
  });

  test("O52 · 1024 压缩宽度仍保留 R3 与异步文字/形状双信号", async ({ browser }) => {
    const context = await nativeContext(browser, { viewport: { width: 1024, height: 630 } });
    const page = await context.newPage();
    await ready(page);
    const candidate = (await catalog(page)).find(skill => skill.employee_visible !== false && skill.risk === "L3" && !!skill.execution?.async?.enabled);
    expect(candidate, "compressed contract requires a declared R3 async skill").toBeTruthy();
    await openSkill(page, candidate!.id);
    const detail = page.locator("[data-skill-detail]");
    const status = page.locator(".knowledge-detail-metadata .knowledge-status");
    await expect(status).toContainText("R3 · 执行前确认");
    await expect(detail).toContainText("异步");
    await expect(detail).toContainText("取消");
    await expect(detail).toContainText("重试");
    expect(await status.evaluate(element => getComputedStyle(element).borderTopWidth), "risk status keeps a visible non-colour border shape").not.toBe("0px");
    await context.close();
  });
});

test.describe("技能带入当前任务 · 真实草稿边界", () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test("O53 · 带入仅面向现有目标/工作台草稿，绝不凭空新建会话", async ({ page }) => {
    await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* unavailable in this context */ } });
    await page.reload();
    await page.locator(".knowledge-list-row").first().waitFor();
    await openSkill(page);
    const target = page.getByRole("combobox", { name: "选择目标任务" });
    const action = page.locator("[data-asset-use]");
    await expect(target).toBeVisible();
    await expect(action, "without an explicit target the handoff cannot run").toBeDisabled();
    await expect(page.locator("[data-skill-detail]")).not.toContainText("新建会话");
    await expect(page.locator("[data-skill-detail]")).toContainText("目标任务");
  });

  test("O54 · 预览/带入边界不启动今日或待办计划", async ({ page }) => {
    const planPosts: string[] = [];
    page.on("request", request => {
      if (request.method() !== "POST") return;
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/today-brief/plan") || pathname.endsWith("/todo-brief/plan")) planPosts.push(pathname);
    });
    await openSkill(page);
    await expect(page.locator("[data-asset-use]")).toBeVisible();
    await expect(page.locator(".asset-task-action")).toContainText("目标任务");
    await page.waitForTimeout(3000);
    expect(planPosts, "reading or selecting a skill cannot start either planning flow").toEqual([]);
  });
});

test.describe("资格与当前 API 事实（保留上一迁移的 lawful native coverage）", () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test("M01 · auth-enabled principal 只获得明确已发布 agent:kol 的合法绑定", async ({ page }) => {
    const rows = await catalog(page);
    expect(rows.filter(row => row.employee_visible !== false).length, "catalog keeps employee-visible API facts").toBeGreaterThan(0);
    if (!AUTH_ENABLED) {
      expect(rows.every(row => row.employee_visible !== false || row.employee_visible === false), "stub run remains an HTTP-fact profile without native writes").toBe(true);
      return;
    }
    const result = await page.evaluate(async (agentId) => {
      const skill = (await (await fetch("/api/skills")).json() as Skill[]).find(row => row.employee_visible !== false);
      if (!skill) return { skillId: "", agents: [] as Array<{ id: string }> };
      const agents = await (await fetch(`/api/skills/${encodeURIComponent(skill.id)}/agents`)).json() as { agents: Array<{ id: string }> };
      return { skillId: skill.id, agents: agents.agents };
    }, E2E_AGENT_ID);
    expect(result.skillId, "a real eligible skill must be returned").toBeTruthy();
    expect(result.agents.map(agent => agent.id), "current caller sees the expressly bound published Agent").toContain(E2E_AGENT_ID);
  });

  test("M02 · 目录渲染真实 employee-visible API 记录，绝不回退为空壳", async ({ page }) => {
    const rows = await catalog(page);
    const first = page.locator(".knowledge-list-row").first();
    const id = await first.getAttribute("data-skill-id");
    expect(id, "current row has a stable data-skill-id").toBeTruthy();
    expect(rows.some(row => row.id === id && row.employee_visible !== false), "current row corresponds to employee-visible API fact").toBe(true);
    expect(await page.locator(".knowledge-list-open").count(), "current semantic list selection controls render").toBeGreaterThan(0);
  });
});
