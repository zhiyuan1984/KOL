import { expect, test, type Page } from "@playwright/test";
import type { AdminLeadFunnelResponse, AdminProjectDeliveryResponse } from "../src/api";

type SeenRequest = { path: string; search: URLSearchParams };

const leadFixture = {
  kpis: { total: 0, active: 0, new_this_week: 0, converted_this_month: 0, avg_stay_days: null, stuck_count: 0, conversion_rate: null },
  funnel: [], stuck: [], loss: [], audit: [], rules: { first_contact_template: null, converted_lock: { enabled: true, note: "示例锁定规则" } },
  request_id: "fixture", as_of: "2026-10-21T00:00:00.000Z",
} satisfies AdminLeadFunnelResponse;
const deliveryFixture = {
  kpis: { active: 0, exception_count: 0, overdue_count: 0, pending_acceptance: 0, completed_this_week: 0, on_time_rate: null },
  exceptions: [], stage_distribution: [], overdue: [], pending_acceptance: [], request_id: "fixture", as_of: "2026-10-21T00:00:00.000Z",
} satisfies AdminProjectDeliveryResponse;

const organizationEntities = ["组织单元", "成员关系", "职责分配", "组织", "部门", "组织层级关系"];
const catalog = {
  context: { companyId: "company-alpha", companies: [{ id: "company-alpha", name: "示例公司" }, { id: "company-beta", name: "第二公司" }], admin: true },
  groups: [
    {
      id: "object-organization", name: "组织架构", path: ["人力资源", "组织管理", "组织设计", "组织架构"],
      entities: [
        { code: "org-unit", name: "组织单元", columns: [{ key: "name", label: "单元名称" }, { key: "parent", label: "上级单元" }, { key: "owner", label: "负责人" }, { key: "status", label: "资料状态" }], sources: [{ id: "platform", label: "平台组织", available: true }, { id: "wecom", label: "企业微信资料", available: true }] },
        { code: "member-relation", name: "成员关系", columns: [{ key: "member", label: "成员" }, { key: "unit", label: "组织单元" }, { key: "status", label: "资料状态" }], sources: [{ id: "platform", label: "平台组织", available: true }, { id: "wecom", label: "企业微信资料", available: true }] },
        { code: "responsibility", name: "职责分配", columns: [{ key: "role", label: "职责" }], sources: [{ id: "wecom", label: "企业微信资料", available: false }] },
        { code: "organization", name: "组织", columns: [{ key: "name", label: "组织名称" }], sources: [{ id: "platform", label: "平台组织", available: true }] },
        { code: "department", name: "部门", columns: [{ key: "name", label: "部门名称" }], sources: [{ id: "platform", label: "平台组织", available: true }] },
        { code: "hierarchy", name: "组织层级关系", columns: [{ key: "relation", label: "层级关系" }], sources: [{ id: "platform", label: "平台组织", available: true }] },
      ],
    },
    {
      id: "object-kol", name: "合作管理", path: ["营销", "KOL 营销", "达人合作", "合作管理"],
      entities: [{ code: "cooperation", name: "合作项目", columns: [{ key: "title", label: "项目" }], sources: [{ id: "platform", label: "平台组织", available: true }] }],
    },
  ],
};

const longDescription = "本页用于核对组织归属与成员资料，历史通讯录记录需要保留来源语义并在当前数据范围中供管理员阅读。".repeat(8);
function recordsFor(search: URLSearchParams) {
  const source = search.get("source") || "platform";
  const entityCode = search.get("entityCode") || "";
  if (entityCode === "responsibility") return { companyId: "company-alpha", entityCode, source, sourceLabel: "企业微信资料", status: "not_connected", note: "", observedAt: null, records: [], total: null, page: 1, pageSize: 20 };
  if (entityCode !== "org-unit") return { companyId: "company-alpha", entityCode, source, sourceLabel: "平台组织", status: "ready", note: "", observedAt: null, records: [], total: 0, page: 1, pageSize: 20 };
  return {
    companyId: "company-alpha", entityCode, source, sourceLabel: source === "wecom" ? "企业微信资料" : "平台组织", status: "ready",
    note: source === "wecom" ? "仅供核对来源资料" : "", observedAt: source === "wecom" ? "2026-10-20 15:38（北京时间）" : null,
    page: Number(search.get("page") || 1), pageSize: Number(search.get("pageSize") || 20), total: 2,
    records: [
      { id: "rec_org_internal_001", values: { name: "推广部", parent: "业务运营中心", owner: "示例负责人", status: "待核对" }, fields: [
        { key: "name", label: "单元名称", value: "推广部", layout: "compact", width: "small" },
        { key: "parent", label: "上级单元", value: "业务运营中心", layout: "compact", width: "medium" },
        { key: "owner", label: "负责人", value: "示例负责人", layout: "compact", width: "small" },
        { key: "type", label: "单元类型", value: "部门", layout: "compact", width: "small" },
        { key: "location", label: "所在地", value: "深圳", layout: "compact", width: "small" },
        { key: "people", label: "人员数量", value: "12 人", layout: "compact", width: "small" },
        { key: "description", label: "资料说明", value: longDescription, layout: "long" },
      ], links: [{ label: "查看成员关系", entityCode: "member-relation", unit: "unit_scope_opaque_test" }] },
      { id: "rec_org_internal_002", values: { name: "市场部", parent: "业务运营中心", owner: "示例负责人", status: "待核对" }, fields: [{ key: "type", label: "单元类型", value: "部门", layout: "compact", width: "small" }, { key: "description", label: "资料说明", value: "短说明不显示无效展开入口", layout: "long" }] },
    ],
  };
}

async function installFixture(page: Page, catalogFixture = catalog): Promise<{ writes: string[]; businessRequests: SeenRequest[]; errors: string[] }> {
  const writes: string[] = [];
  const businessRequests: SeenRequest[] = [];
  const errors: string[] = [];
  const account = { id: "business-map-fixture-user", name: "业务地图测试管理员", roles: ["admin"], available_modes: ["admin", "employee"] };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") { writes.push(url.pathname); return route.fulfill({ status: 409, json: { error: "read_only_fixture" } }); }
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { authenticated: true, account, user: account } });
    if (url.pathname === "/api/me") return route.fulfill({ json: account });
    if (url.pathname === "/api/preferences") return route.fulfill({ json: {} });
    if (url.pathname === "/api/business-map/catalog") {
      businessRequests.push({ path: url.pathname, search: url.searchParams });
      return route.fulfill({ json: catalogFixture });
    }
    if (url.pathname === "/api/business-map/records") {
      businessRequests.push({ path: url.pathname, search: url.searchParams });
      return route.fulfill({ json: recordsFor(url.searchParams) });
    }
    if (url.pathname === "/api/kol/admin/lead-funnel") return route.fulfill({ json: leadFixture });
    if (url.pathname === "/api/kol/admin/project-delivery") return route.fulfill({ json: deliveryFixture });
    return route.fulfill({ status: 404, json: { error: "fixture_unknown_get" } });
  });
  return { writes, businessRequests, errors };
}

async function openOrganizationUnit(page: Page) {
  await page.getByRole("button", { name: "展开组织架构" }).click();
  await page.getByRole("button", { name: "组织单元", exact: true }).click();
  await expect(page.getByRole("heading", { name: "组织单元", exact: true })).toBeVisible();
  await expect(page.getByText("推广部", { exact: true })).toBeVisible();
}

test("business map lists multi-domain objects with four breadcrumbs and all organization entities", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/admin/business-map?companyId=company-alpha");
  await expect(page.locator("[data-business-map-catalog]")).toBeVisible();
  await expect(page.getByTitle("人力资源 / 组织管理 / 组织设计 / 组织架构")).toBeVisible();
  await expect(page.getByTitle("营销 / KOL 营销 / 达人合作 / 合作管理")).toBeVisible();
  await page.getByRole("button", { name: "展开组织架构" }).click();
  for (const entity of organizationEntities) await expect(page.getByRole("button", { name: entity, exact: true })).toBeVisible();
  expect(state.businessRequests.some((request) => request.path === "/api/business-map/catalog" && request.search.get("companyId") === "company-alpha")).toBe(true);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("selected entity renders scoped data, compact fields flow together at 1440 and 1920, and long expansion keeps its record open", async ({ page }, testInfo) => {
  const state = await installFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/business-map?companyId=company-alpha");
  await openOrganizationUnit(page);
  const recordRequest = state.businessRequests.find((request) => request.path === "/api/business-map/records");
  expect(recordRequest?.search.get("companyId")).toBe("company-alpha");
  expect(recordRequest?.search.get("entityCode")).toBe("org-unit");
  expect(recordRequest?.search.get("source")).toBe("platform");
  const expand = page.locator(".business-map-record-row").first().locator(".business-map-record-expand");
  await expand.click();
  const compact = page.locator("[data-business-map-compact-fields] .business-map-compact-field");
  expect(await compact.count()).toBeGreaterThanOrEqual(3);
  const firstBox = await compact.nth(0).boundingBox();
  const secondBox = await compact.nth(1).boundingBox();
  expect(firstBox?.y).toBe(secondBox?.y);
  await page.setViewportSize({ width: 1920, height: 900 });
  const wideFirstBox = await compact.nth(0).boundingBox();
  const wideSecondBox = await compact.nth(1).boundingBox();
  expect(wideFirstBox?.y).toBe(wideSecondBox?.y);
  const layout = await page.locator("[data-business-map-workspace]").evaluate((element) => {
    const main = element.closest("main")!;
    const style = getComputedStyle(main);
    const gutter = Number.parseFloat(getComputedStyle(element).getPropertyValue("--page-gutter")) || 0;
    return { width: element.getBoundingClientRect().width, available: main.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0) - gutter * 2 };
  });
  expect(layout.width).toBeGreaterThanOrEqual(layout.available - 1);
  const longToggle = page.locator("[data-business-map-long-toggle]").first();
  await expect(longToggle).toBeVisible();
  await longToggle.click();
  await expect(longToggle).toHaveText("收起");
  await expect(expand).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("body")).not.toContainText("rec_org_internal_001");
  await page.screenshot({ path: testInfo.outputPath("business-map-detail.png"), fullPage: true });
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("changing source resets record query and folded rows without leaking a prior scope", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/admin/business-map?companyId=company-alpha");
  await openOrganizationUnit(page);
  await page.getByRole("button", { name: "展开记录详情" }).first().click();
  await page.getByLabel("搜索当前实体记录").fill("推广");
  await expect(page).toHaveURL(/q=%E6%8E%A8%E5%B9%BF/);
  await page.getByLabel("数据来源").selectOption("wecom");
  await expect(page).not.toHaveURL(/(?:[?&])q=/);
  await expect(page).not.toHaveURL(/(?:[?&])expanded=/);
  await expect(page.getByText("采集时间：2026-10-20 15:38（北京时间）；历史资料，尚未应用到平台组织")).toBeVisible();
  const wecomRequest = state.businessRequests.filter((request) => request.path === "/api/business-map/records").at(-1);
  expect(wecomRequest?.search.get("source")).toBe("wecom");
  expect(wecomRequest?.search.get("q")).toBeNull();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("related-record navigation applies an opaque organization scope without exposing an editable token", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/admin/business-map?companyId=company-alpha");
  await openOrganizationUnit(page);
  await page.getByRole("button", { name: "展开记录详情" }).first().click();
  await page.getByRole("button", { name: "查看成员关系", exact: true }).click();
  await expect(page.getByText("已限定组织范围")).toBeVisible();
  await expect(page.getByLabel("组织单元筛选")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("unit_scope_opaque_test");
  const linkedRequest = state.businessRequests.filter((request) => request.path === "/api/business-map/records").at(-1);
  expect(linkedRequest?.search.get("entityCode")).toBe("member-relation");
  expect(linkedRequest?.search.get("unit")).toBe("unit_scope_opaque_test");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("narrow width has no body overflow and legacy specialty deep links remain in place", async ({ page }, testInfo) => {
  const state = await installFixture(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/admin/business-map?companyId=company-alpha");
  await openOrganizationUnit(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("business-map-narrow.png"), fullPage: true });
  await page.goto("/admin/lead-funnel");
  await expect(page).toHaveURL(/\/admin\/lead-funnel$/);
  await expect(page.locator("[data-admin-business-map='lead-funnel']")).toBeVisible();
  await expect(page.getByText("暂无停留异常", { exact: true })).toBeVisible();
  await page.goto("/admin/project-delivery");
  await expect(page).toHaveURL(/\/admin\/project-delivery$/);
  await expect(page.locator("[data-admin-business-map='project-delivery']")).toBeVisible();
  await expect(page.getByText("暂无异常项目", { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("a large object catalog scrolls independently and keeps the selected entity records in view", async ({ page }) => {
  const bulkCatalog = { ...catalog, groups: [
    ...Array.from({ length: 120 }, (_, index) => ({ ...catalog.groups[1], id: `object-bulk-${index}`, name: `示例业务对象 ${index}`, path: ["营销", "KOL 营销", "达人合作", `示例业务对象 ${index}`] })),
    catalog.groups[0],
  ] };
  const state = await installFixture(page, bulkCatalog);
  await page.goto("/admin/business-map?companyId=company-alpha");
  const directory = page.locator("[data-business-map-catalog]");
  await expect(directory).toBeVisible();
  const size = await directory.evaluate(element => ({ scroll: element.scrollHeight, height: element.clientHeight, body: document.documentElement.scrollHeight, viewport: window.innerHeight }));
  expect(size.scroll).toBeGreaterThan(size.height);
  expect(size.body).toBeLessThan(size.viewport * 2);
  await directory.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await openOrganizationUnit(page);
  await expect(page.getByRole("heading", { name: "组织单元", exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("business domains support searchable multi-selection and retain both chosen catalogs", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/admin/business-map?companyId=company-alpha");
  await page.getByRole("combobox", { name: "业务域范围" }).click();
  const options = page.locator(".ant-select-dropdown .ant-select-item-option");
  await options.filter({ hasText: "KOL 营销" }).click();
  await expect(page.getByTitle("人力资源 / 组织管理 / 组织设计 / 组织架构")).toHaveCount(0);
  await options.filter({ hasText: "组织管理" }).click();
  await page.getByLabel("搜索业务对象、逻辑实体或目录路径").click();
  await expect(page.getByTitle("人力资源 / 组织管理 / 组织设计 / 组织架构")).toBeVisible();
  await expect(page.getByTitle("营销 / KOL 营销 / 达人合作 / 合作管理")).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("historical organization links retain their original source and opaque unit scope", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/admin/business-map?companyId=company-alpha");
  await openOrganizationUnit(page);
  await page.getByLabel("数据来源").selectOption("wecom");
  await page.getByRole("button", { name: "展开记录详情" }).first().click();
  await page.getByRole("button", { name: "查看成员关系", exact: true }).click();
  await expect(page.getByRole("heading", { name: "成员关系", exact: true })).toBeVisible();
  const linked = state.businessRequests.filter((request) => request.path === "/api/business-map/records").at(-1);
  expect(linked?.search.get("source")).toBe("wecom");
  expect(linked?.search.get("unit")).toBe("unit_scope_opaque_test");
  await expect(page.getByLabel("数据来源")).toHaveValue("wecom");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
