// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgeHome from "./KnowledgeHome";

const fixture = vi.hoisted(() => ({ loading: false, error: "", data: {
  tenant: "fixture", rows: [], total: 13, page: 1, page_size: 20, page_count: 1,
  facets: {
    view: { all: 13, values: { draft: 2, pending_review: 6, published: 3, archived: 0, indexing: 2 } },
    family: { all: 13, values: { legacy: 2, __none__: 1 } },
    domain: { all: 13, values: { "legacy-domain": 2, __none__: 1 } },
    base: { all: 13, values: { "legacy-base": 2, __none__: 1 } },
    kind: { all: 13, values: { mail_template: 3 } }, brand: { all: 13, values: {} }, stage: { all: 13, values: {}, empty: 13 },
  },
  domains: [{ id: "legacy", level: "family", name: "未分类" }, { id: "legacy-domain", level: "domain", name: "未分类", parent_id: "legacy" }],
  bases: [{ id: "legacy-base", domain_id: "legacy-domain", family_id: "legacy", name: "未分类" }],
  stats: { status: { published: 91 } },
} }));
vi.mock("./shared", async importOriginal => ({ ...await importOriginal<typeof import("./shared")>(), useKbData: () => ({ ...fixture, reload: () => undefined }) }));
vi.mock("../../components/AuthGate", () => ({ useAccount: () => ({ account: { id: "fixture-admin" } }) }));
vi.mock("./KnowledgeGovernancePanels", () => ({ KnowledgeAssetsPanel: () => null, KnowledgeGraphPanel: () => null }));
vi.mock("./CatalogView", () => ({ default: () => null }));
vi.mock("./BaseView", () => ({ default: () => null }));
vi.mock("./IngestView", () => ({ default: () => null }));
vi.mock("./BindingsView", () => ({ default: () => null }));
vi.mock("./ReviewView", () => ({ default: () => null }));
vi.mock("./EntryEditor", () => ({ default: () => null }));
vi.mock("./WorkspaceEntry", () => ({ default: () => null }));
vi.mock("./UploadDialog", () => ({ default: () => null }));
vi.mock("./DocumentRail", () => ({ default: () => null }));

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); fixture.loading = false; fixture.error = "";
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); router.dispose(); container.remove(); });
function render(path = "/admin/knowledge") {
  router = createMemoryRouter([{ path: "*", element: <KnowledgeHome /> }], { initialEntries: [path] });
  act(() => root.render(<RouterProvider router={router} />));
}

describe("knowledge host filter projection", () => {
  it("projects the exact lifecycle order from filtered facets rather than global asset statistics", () => {
    render();
    expect([...container.querySelectorAll("[data-kbv-view]")].map(node => node.textContent)).toEqual(["全部13", "草稿2", "待审批6", "已发布3", "已下架0"]);
    expect(container.querySelectorAll('[data-kbv-view="pending"]')).toHaveLength(1);
  });

  it("distinguishes real unclassified nodes from missing foreign keys in every scope dimension", () => {
    render();
    for (const [axis, id, label] of [["family", "legacy", "业务族"], ["domain", "legacy-domain", "业务域"], ["base", "legacy-base", "知识库"]]) {
      expect(container.querySelector(`[data-kb-scope-${axis}="${id}"]`)?.textContent).toBe("未分类2");
      expect(container.querySelector(`[data-kb-scope-${axis}="__none__"]`)?.textContent).toBe(`未归属${label}1`);
    }
  });

  it.each(["loading", "error"])("does not display stale lifecycle counts during %s", state => {
    fixture.loading = state === "loading"; fixture.error = state === "error" ? "统计读取失败" : "";
    render();
    expect(container.querySelectorAll('[data-kbv-view] small')).toHaveLength(0);
    expect(container.querySelector('[data-kbv-view="all"]')?.textContent).toBe("全部");
  });

  it("preserves a hidden legacy stage and names its panel without a nonexistent tab reference", () => {
    render("/admin/knowledge?stage=bindings");
    expect(router.state.location.search).toBe("?stage=bindings");
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-label")).toBe("查询技能");
    expect(panel.getAttribute("aria-labelledby")).toBeNull();
    expect(container.querySelector('[data-knowledge-right]')?.getAttribute("data-kb-active-stage")).toBe("bindings");
    expect(container.querySelectorAll('[data-kb-lifecycle-tabs] [aria-selected="true"]')).toHaveLength(0);
  });
});
