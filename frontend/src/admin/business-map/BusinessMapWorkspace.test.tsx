import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import BusinessMapWorkspace from "./BusinessMapWorkspace";
import { getBusinessMapCatalog, getBusinessMapRecords, recordsUrl } from "./api";
import { companyOptions, detailFields, filterCatalog, formatSourceTime, parseIndexList, sourceStatus } from "./model";
import type { BusinessMapCatalog, BusinessMapRecords } from "./types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const catalog: BusinessMapCatalog = {
  context: { companyId: "company-alpha", companies: [{ id: "company-alpha", name: "示例公司" }], admin: true },
  groups: [{
    id: "organization", name: "组织架构", path: ["人力资源", "组织管理", "组织设计", "组织架构"],
    entities: [{ code: "org-unit", name: "组织单元", columns: [{ key: "name", label: "单元名称" }], sources: [{ id: "platform", label: "平台组织", available: true }] }],
  }],
};
const records: BusinessMapRecords = {
  companyId: "company-alpha", entityCode: "org-unit", source: "platform", sourceLabel: "平台组织", status: "ready", note: "", observedAt: null,
  total: 1, page: 1, pageSize: 20,
  records: [{ id: "opaque-record-id", values: { name: "推广部" }, fields: [
    { key: "name", label: "单元名称", value: "推广部", layout: "compact", width: "small" },
    { key: "type", label: "单元类型", value: "部门", layout: "compact", width: "small" },
    { key: "description", label: "资料说明", value: "短说明", layout: "long" },
  ] }],
};

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition did not become true");
}

describe("business-map presentation", () => {
  it("formats collection time for business reading and hides internal company references", () => {
    expect(formatSourceTime("2026-03-08T00:00:00.000Z")).toMatch(/^2026-03-08 \d{2}:\d{2}（北京时间）$/);
    expect(formatSourceTime("2026-10-20 15:38（北京时间）")).toBe("2026-10-20 15:38（北京时间）");
    expect(formatSourceTime("driver_internal_reference")).toBe("时间未提供");
    expect(companyOptions({ ...catalog, context: { ...catalog.context, companies: [{ id: "company:internal", name: "company:internal" }] } })).toEqual([{ id: "company:internal", name: "公司 1" }]);
  });

  it("rejects a catalog or records response whose scope does not match the request", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...catalog, context: { ...catalog.context, companyId: "company-other" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...records, entityCode: "other-entity" }), { status: 200 })));
    await expect(getBusinessMapCatalog("company-alpha")).rejects.toMatchObject({ status: 502, message: "资料暂时无法读取，请重试" });
    await expect(getBusinessMapRecords({ companyId: "company-alpha", entityCode: "org-unit", source: "platform", page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ status: 502, message: "资料暂时无法读取，请重试" });
  });

  it("builds a server query with company scope and separates summary fields", () => {
    expect(recordsUrl({ companyId: "company-alpha", entityCode: "org-unit", source: "platform", page: 2, pageSize: 20, q: "推广", unit: "市场" }))
      .toBe("/api/business-map/records?companyId=company-alpha&entityCode=org-unit&source=platform&page=2&pageSize=20&q=%E6%8E%A8%E5%B9%BF&unit=%E5%B8%82%E5%9C%BA");
    expect(detailFields(records.records[0], new Set(["name"])).map((field) => field.key)).toEqual(["type", "description"]);
    expect(parseIndexList(null)).toEqual(new Set());
  });

  it("keeps four-part catalog matches and distinguishes source states", () => {
    const matches = filterCatalog(catalog.groups, ["组织管理"], "组织单元");
    expect(matches).toHaveLength(1);
    expect(matches[0].group.path).toHaveLength(4);
    expect(matches[0].entities.map((entity) => entity.name)).toEqual(["组织单元"]);
    expect(sourceStatus("not_connected").detail).toBe("该实体的数据尚未接入");
    expect(sourceStatus("not_read").detail).toBe("尚未读取资料");
    expect(sourceStatus("unknown").label).toBe("来源未知");
  });

  it("renders selected records by GET only and does not repeat summary fields in details", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(requestUrl, "http://fixture.local").pathname;
      return new Response(JSON.stringify(path === "/api/business-map/catalog" ? catalog : records), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/admin/business-map?companyId=company-alpha&entity=org-unit&source=platform"]}><BusinessMapWorkspace /></MemoryRouter>);
    });
    await act(async () => { await waitFor(() => !!host.querySelector('[aria-label="展开记录详情"]')); });
    const expand = host.querySelector<HTMLButtonElement>('[aria-label="展开记录详情"]');
    expect(expand).not.toBeNull();
    await act(async () => { expand?.click(); });
    expect(host.querySelectorAll(".business-map-record-detail .business-map-field-label")[0]?.textContent).toBe("单元类型：");
    expect(host.textContent).not.toContain("opaque-record-id");
    expect(fetchMock.mock.calls.every(([, init]) => !init || (init as RequestInit).method === "GET")).toBe(true);
    await act(async () => root.unmount());
    host.remove();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
