// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBaseRow, KnowledgeDomainRow } from "../../api";
import CatalogView from "./CatalogView";
const mocks = vi.hoisted(() => ({ adminKnowledgeDomains: vi.fn(), adminKnowledgeBases: vi.fn(), adminKnowledgeDomainCreate: vi.fn(), adminKnowledgeBaseCreate: vi.fn(), adminKnowledgeDomainUpdate: vi.fn(), adminKnowledgeBaseUpdate: vi.fn(), adminKnowledgeDomainDelete: vi.fn(), adminKnowledgeBaseDelete: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks }));
let root: Root;
let host: HTMLDivElement;
let domains: KnowledgeDomainRow[];
let bases: KnowledgeBaseRow[];
const notify = vi.fn(); const fail = vi.fn();
const stamp = "2026-10-08T12:00:00.000Z";
const query = <T extends Element = HTMLElement>(selector: string): T => { const node = document.querySelector<T>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; };
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === text)!;
const click = async (node: Element) => { await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const fill = async (selector: string, value: string) => { const node = query<HTMLInputElement>(selector); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); };
const submit = async (selector: string) => { await act(async () => { query(selector).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
const mount = async () => { await act(async () => { root.render(<MemoryRouter><CatalogView notify={notify} fail={fail} /></MemoryRouter>); }); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } })) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  domains = [
    { id: "family-a", name: "产品与解决方案", code: "products", level: "family", parent_id: null, status: "active", updated_at: stamp },
    { id: "domain-a", name: "电池产品", code: "battery", level: "domain", parent_id: "family-a", status: "active", updated_at: stamp },
    { id: "domain-empty", name: "待规划域", code: "empty", level: "domain", parent_id: "family-a", status: "active", updated_at: stamp },
  ];
  bases = [{ id: "base-a", name: "磷酸铁锂资料", code: "lifepo4", domain_id: "domain-a", kind: "structured", status: "active", updated_at: stamp, version: 3, entries: 0 }];
  mocks.adminKnowledgeDomains.mockImplementation(async () => ({ domains: domains.map(row => ({ ...row })) }));
  mocks.adminKnowledgeBases.mockImplementation(async () => ({ bases: bases.map(row => ({ ...row })) }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("CatalogView actual Ant Collapse interactions", () => {
  it("starts expanded without a form, selects independently from the arrow, and keeps the base detail route", async () => {
    await mount(); expect(query(".ant-collapse")).toBeTruthy(); expect(query('[data-admin-kb-base="base-a"]')).toBeTruthy(); expect(document.querySelector("[data-admin-kb-family-form]")).toBeNull();
    await click(query('[data-admin-kb-family="family-a"]')); expect(query('[data-admin-kb-selected="family:family-a"]')).toBeTruthy(); expect(query('[data-admin-kb-base="base-a"]')).toBeTruthy();
    const switcher = query('[data-admin-kb-family="family-a"]').closest(".ant-collapse-header")!.querySelector(".ant-collapse-expand-icon")!;
    await click(switcher); expect(document.querySelector('[data-admin-kb-base="base-a"]')).toBeNull();
    await click(switcher); await click(query('[data-admin-kb-base="base-a"]')); expect(query<HTMLAnchorElement>(".kbplanning-detail a").getAttribute("href")).toBe("/admin/knowledge/bases/base-a");
  });
  it("searches a leaf while retaining its family/domain path and restores the tree", async () => {
    await mount(); await fill("[data-admin-kb-catalog-search]", "LIFEPO4");
    expect(query('[data-admin-kb-family="family-a"]')).toBeTruthy(); expect(query('[data-admin-kb-domain="domain-a"]')).toBeTruthy(); expect(query('[data-admin-kb-base="base-a"]')).toBeTruthy(); expect(document.querySelector('[data-admin-kb-domain="domain-empty"]')).toBeNull();
    await fill("[data-admin-kb-catalog-search]", "不存在"); expect(document.body.textContent).toContain("没有匹配的节点"); await click(button("清空搜索")); expect(query('[data-admin-kb-domain="domain-empty"]')).toBeTruthy();
  });
  it("opens child forms with the selected parent and cancels without a mutation", async () => {
    await mount(); await click(query('[data-admin-kb-family="family-a"]')); await click(query("[data-admin-kb-create-domain]")); expect(query<HTMLSelectElement>("[data-admin-kb-domain-parent]").value).toBe("family-a");
    await click(button("取消")); expect(document.querySelector("[role=dialog]")).toBeNull();
    await click(query('[data-admin-kb-domain="domain-a"]')); await click(query("[data-admin-kb-create-base]")); expect(query<HTMLSelectElement>("[data-admin-kb-base-domain]").value).toBe("domain-a");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); expect(document.querySelector("[role=dialog]")).toBeNull(); expect(mocks.adminKnowledgeDomainCreate).not.toHaveBeenCalled(); expect(mocks.adminKnowledgeBaseCreate).not.toHaveBeenCalled();
  });
  it("guards repeated create submissions, refreshes and selects the created node", async () => {
    const request = deferred<{ domain: KnowledgeDomainRow }>(); mocks.adminKnowledgeDomainCreate.mockReturnValue(request.promise);
    await mount(); await click(query("[data-admin-kb-create-family]")); await fill('[data-admin-kb-family-form] input[name="name"]', "品牌增长");
    await submit("[data-admin-kb-family-form]"); await submit("[data-admin-kb-family-form]"); expect(mocks.adminKnowledgeDomainCreate).toHaveBeenCalledTimes(1); expect(mocks.adminKnowledgeDomainCreate).toHaveBeenCalledWith({ name: "品牌增长", level: "family", note: undefined }); expect(button("取消").disabled).toBe(true); expect(query<HTMLInputElement>('[data-admin-kb-family-form] input[name="name"]').closest("fieldset")!.disabled).toBe(true);
    const created: KnowledgeDomainRow = { ...domains[0], id: "family-new", name: "品牌增长", code: "growth" }; domains.push(created); await act(async () => request.resolve({ domain: created }));
    expect(document.querySelector("[role=dialog]")).toBeNull(); expect(query('[data-admin-kb-selected="family:family-new"]')).toBeTruthy(); expect(notify).toHaveBeenCalledWith("业务族已创建。");
  });
  it("requires R3 archive confirmation and submits exactly once with both versions", async () => {
    await mount(); await click(query('[data-admin-kb-base="base-a"]')); await click(query("[data-admin-kb-archive-node]")); expect(query('[data-risk="R3"]')).toBeTruthy(); expect(mocks.adminKnowledgeBaseUpdate).not.toHaveBeenCalled();
    await click(query("[data-admin-confirm-cancel]")); expect(mocks.adminKnowledgeBaseUpdate).not.toHaveBeenCalled();
    const request = deferred<{ base: KnowledgeBaseRow }>(); mocks.adminKnowledgeBaseUpdate.mockReturnValue(request.promise);
    await click(query("[data-admin-kb-archive-node]")); await click(query("[data-admin-confirm-ok]")); await click(query("[data-admin-confirm-ok]"));
    expect(mocks.adminKnowledgeBaseUpdate).toHaveBeenCalledTimes(1); expect(mocks.adminKnowledgeBaseUpdate).toHaveBeenCalledWith("base-a", { status: "archived", confirmed: true, expected_updated_at: stamp, expected_version: 3 }); expect(query<HTMLButtonElement>("[data-admin-confirm-cancel]").disabled).toBe(true);
    bases[0] = { ...bases[0], status: "archived", version: 4 }; await act(async () => request.resolve({ base: bases[0] })); expect(query("[data-admin-kb-restore-node]")).toBeTruthy(); expect(notify).toHaveBeenCalledWith("知识库「磷酸铁锂资料」已归档。");
  });
  it("keeps a blocked delete intact and invalidates confirmation until reload", async () => {
    mocks.adminKnowledgeBaseDelete.mockRejectedValue(Object.assign(new Error("知识库仍被技能引用"), { status: 409 }));
    await mount(); await click(query('[data-admin-kb-base="base-a"]')); await click(query("[data-admin-kb-delete-node]")); await click(query("[data-admin-confirm-ok]"));
    expect(mocks.adminKnowledgeBaseDelete).toHaveBeenCalledWith("base-a", stamp); expect(query('[data-admin-kb-base="base-a"]')).toBeTruthy(); expect(query<HTMLButtonElement>("[data-admin-confirm-ok]").disabled).toBe(true); expect(document.body.textContent).toContain("知识库仍被技能引用");
    await click(button("重新读取并核对")); expect(document.querySelector("[role=dialog]")).toBeNull(); expect(mocks.adminKnowledgeBaseDelete).toHaveBeenCalledTimes(1); expect(notify).not.toHaveBeenCalled();
  });
  it("preserves stale edit drafts until explicit reload, then sends the new timestamp", async () => {
    mocks.adminKnowledgeDomainUpdate.mockRejectedValueOnce(Object.assign(new Error("版本冲突"), { status: 409 })).mockResolvedValueOnce({ domain: {} });
    await mount(); await click(query('[data-admin-kb-domain="domain-a"]')); await click(query("[data-admin-kb-edit-node]")); await fill('[data-admin-kb-domain-form] input[name="name"]', "我的改名"); await submit("[data-admin-kb-domain-form]");
    expect(query<HTMLInputElement>('[data-admin-kb-domain-form] input[name="name"]').value).toBe("我的改名"); expect(query<HTMLButtonElement>("[data-admin-kb-domain-submit]").disabled).toBe(true);
    domains[1] = { ...domains[1], name: "其他人的改名", updated_at: "2026-10-08T13:00:00.000Z" }; await click(button("重新读取并核对"));
    expect(query<HTMLInputElement>('[data-admin-kb-domain-form] input[name="name"]').value).toBe("我的改名"); expect(document.body.textContent).toContain("当前记录：其他人的改名"); await submit("[data-admin-kb-domain-form]");
    expect(mocks.adminKnowledgeDomainUpdate).toHaveBeenLastCalledWith("domain-a", { name: "我的改名", note: "", expected_updated_at: "2026-10-08T13:00:00.000Z" });
  });
  it("does not report uncertain writes as success or permit blind repeated creation", async () => {
    mocks.adminKnowledgeDomainCreate.mockRejectedValue(Object.assign(new Error("超时"), { status: 0 })); await mount(); await click(query("[data-admin-kb-create-family]")); await fill('[data-admin-kb-family-form] input[name="name"]', "增长"); await submit("[data-admin-kb-family-form]");
    expect(document.body.textContent).toContain("是否保存尚未确认"); expect(notify).not.toHaveBeenCalled(); await click(button("重新读取并核对")); expect(query<HTMLButtonElement>("[data-admin-kb-family-submit]").disabled).toBe(true); await submit("[data-admin-kb-family-form]"); expect(mocks.adminKnowledgeDomainCreate).toHaveBeenCalledTimes(1);
  });
  it("does not relabel successful writes when the subsequent refresh fails", async () => {
    mocks.adminKnowledgeBaseUpdate.mockResolvedValue({ base: {} }); await mount(); await click(query('[data-admin-kb-base="base-a"]')); await click(query("[data-admin-kb-archive-node]")); mocks.adminKnowledgeDomains.mockRejectedValueOnce(new Error("读取失败")); await click(query("[data-admin-confirm-ok]"));
    expect(notify).toHaveBeenCalledWith("知识库「磷酸铁锂资料」已归档。"); expect(document.body.textContent).toContain("目录刷新失败，以下为上次读取结果"); expect(query<HTMLButtonElement>("[data-admin-kb-archive-node]").disabled).toBe(true); expect(fail).not.toHaveBeenCalled();
  });
  it("renders separate accessible buttons for selection and expansion on the real Collapse", async () => {
    await mount();
    const family = query<HTMLButtonElement>('[data-admin-kb-family="family-a"]');
    expect(family.tagName).toBe("BUTTON");
    expect(family.getAttribute("aria-pressed")).toBe("false");
    await click(family);
    expect(family.getAttribute("aria-pressed")).toBe("true");
    const toggle = family.closest(".ant-collapse-header")!.querySelector('[role="button"]')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(query('[data-admin-kb-selected="family:family-a"]')).toBeTruthy();
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
  it("removes the redundant heading and bulk controls and locates creation below the list", async () => {
    await mount();
    expect(document.querySelector(".kbplanning-head")).toBeNull();
    expect(button("展开全部")).toBeUndefined();
    expect(button("收起全部")).toBeUndefined();
    expect(query(".kbplanning-search .anticon-search")).toBeTruthy();
    expect(query(".kbplanning-footer [data-admin-kb-create-family]")).toBeTruthy();
  });
  it("makes codes readonly and leaves generation to the server for all create levels", async () => {
    await mount();
    for (const [entry, form] of [["[data-admin-kb-create-family]", "family"], ["[data-admin-kb-create-domain]", "domain"], ["[data-admin-kb-create-base]", "base"]]) {
      if (form === "domain") await click(query('[data-admin-kb-family="family-a"]'));
      if (form === "base") await click(query('[data-admin-kb-domain="domain-a"]'));
      await click(query(entry));
      const code = query<HTMLInputElement>(`[data-admin-kb-${form}-form] input[name="code"]`);
      expect(code.readOnly).toBe(true); expect(code.required).toBe(false);
      expect(code.placeholder).toBe("保存时自动生成");
      await click(button("取消"));
    }
    expect(mocks.adminKnowledgeDomainCreate).not.toHaveBeenCalled();
    expect(mocks.adminKnowledgeBaseCreate).not.toHaveBeenCalled();
  });
  it("preserves the unknown-write reload guard after the dialog is dismissed", async () => {
    mocks.adminKnowledgeBaseUpdate.mockRejectedValue(Object.assign(new Error("Bad Gateway"), { status: 502 }));
    await mount(); await click(query('[data-admin-kb-base="base-a"]')); await click(query("[data-admin-kb-archive-node]")); await click(query("[data-admin-confirm-ok]"));
    await click(query("[data-admin-confirm-cancel]"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(query<HTMLButtonElement>("[data-admin-kb-archive-node]").disabled).toBe(true);
    expect(query<HTMLButtonElement>("[data-admin-kb-create-family]").disabled).toBe(true);
    await click(button("重新读取并核对"));
    expect(query<HTMLButtonElement>("[data-admin-kb-archive-node]").disabled).toBe(false);
    expect(mocks.adminKnowledgeBaseUpdate).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
  it("refuses editing a domain without its version timestamp", async () => {
    delete domains[1].updated_at;
    await mount(); await click(query('[data-admin-kb-domain="domain-a"]')); await click(query("[data-admin-kb-edit-node]")); await fill('[data-admin-kb-domain-form] input[name="name"]', "新名称"); await submit("[data-admin-kb-domain-form]");
    expect(mocks.adminKnowledgeDomainUpdate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("缺少当前版本时间");
    expect(query<HTMLButtonElement>("[data-admin-kb-domain-submit]").disabled).toBe(true);
  });

  it("reveals a newly created base under an otherwise collapsed parent", async () => {
    await mount();
    await click(query('[data-admin-kb-domain="domain-a"]'));
    const switcher = query('[data-admin-kb-domain="domain-a"]').closest(".ant-collapse-header")!.querySelector(".ant-collapse-expand-icon")!;
    await click(switcher);
    expect(document.querySelector('[data-admin-kb-base="base-a"]')).toBeNull();
    const created: KnowledgeBaseRow = { ...bases[0], id: "base-new", name: "新建产品资料", code: "new-product" };
    mocks.adminKnowledgeBaseCreate.mockImplementation(async () => { bases.push(created); return { base: created }; });
    await click(query("[data-admin-kb-create-base]"));
    await fill('[data-admin-kb-base-form] input[name="name"]', created.name);
    await submit("[data-admin-kb-base-form]");
    expect(mocks.adminKnowledgeBaseCreate).toHaveBeenCalledWith({ name: created.name, domain_id: "domain-a", kind: "structured", description: "" });
    expect(query('[data-admin-kb-base="base-new"]')).toBeTruthy();
    expect(query('[data-admin-kb-selected="base:base-new"]')).toBeTruthy();
  });

});
