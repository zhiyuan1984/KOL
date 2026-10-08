// @vitest-environment jsdom
import { act, type ComponentProps, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgeBrowseFilters from "./KnowledgeBrowseFilters";
import KnowledgeLifecycleTabs, { knowledgeStage } from "./KnowledgeLifecycleTabs";
import { MAIN_STAGE_TABS } from "../../kolStages";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function props(): ComponentProps<typeof KnowledgeBrowseFilters> {
  const noop = () => undefined;
  return {
    query: "", onQuery: noop, scope: { familyId: "", domainId: "", baseId: "" },
    onFamily: noop, onDomain: noop, onBase: noop,
    familyOptions: [{ value: "", label: "全部", count: 13 }, { value: "legacy", label: "未分类", count: 2 }, { value: "__none__", label: "未归属业务族", count: 1 }],
    domainOptions: [{ value: "", label: "全部", count: 13 }, { value: "product", label: "产品管理", count: 3 }],
    baseOptions: [{ value: "", label: "全部", count: 13 }, { value: "battery", label: "电池", count: 3 }],
    brandOptions: [{ value: "", label: "全部", count: 13 }, { value: "LT", label: "LT", count: 5 }],
    selectedBrands: [], onToggleBrand: noop, onClearBrands: noop,
    stageOptions: [], selectedStages: [], onToggleStage: noop, onClearStages: noop, onStages: noop,
    kindOptions: [{ value: "", label: "全部", count: 13 }, { value: "mail_template", label: "邮件模板", count: 3 }],
    kind: "", onKind: noop, view: "all", onView: noop,
    viewOptions: [
      { value: "all", label: "全部", count: 13 }, { value: "draft", label: "草稿", count: 2 },
      { value: "pending", label: "待审批", count: 6 }, { value: "published", label: "已发布", count: 3 },
      { value: "disabled", label: "已下架", count: 0 },
    ],
  };
}
const click = (selector: string) => act(() => container.querySelector<HTMLButtonElement>(selector)!.click());

describe("compact knowledge filters", () => {
  it("groups taxonomy together and always exposes brand, stage and type", () => {
    act(() => root.render(<KnowledgeBrowseFilters {...props()} />));
    expect(container.querySelectorAll('[data-kb-filter="taxonomy"] .kbv-scope-row')).toHaveLength(3);
    expect(container.querySelectorAll('.knowledge-filter-bar > .knowledge-browse-filter-group')).toHaveLength(4);
    expect(container.querySelector('[data-kb-filter="kind"]')).not.toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain("更多筛选");
    expect(container.querySelector('[data-kb-scope-family="legacy"]')?.textContent).toBe("未分类2");
    expect(container.querySelector('[data-kb-scope-family="__none__"]')?.textContent).toBe("未归属业务族1");
  });

  it("preserves independent brand, type, scope and status callbacks", () => {
    const p = props();
    p.onFamily = vi.fn(); p.onToggleBrand = vi.fn(); p.onClearBrands = vi.fn(); p.onKind = vi.fn(); p.onView = vi.fn();
    act(() => root.render(<KnowledgeBrowseFilters {...p} />));
    click('[data-kb-scope-family="legacy"]');
    click('[data-kb-filter="brand"] [data-kb-filter-value="LT"]');
    click('[data-kb-filter="brand"] [data-kb-filter-value=""]');
    click('[data-kb-kind="mail_template"]');
    click('[data-kbv-view="pending"]');
    expect(p.onFamily).toHaveBeenCalledWith("legacy");
    expect(p.onToggleBrand).toHaveBeenCalledWith("LT");
    expect(p.onClearBrands).toHaveBeenCalledOnce();
    expect(p.onKind).toHaveBeenCalledWith("mail_template");
    expect(p.onView).toHaveBeenCalledWith("pending");
  });

  it("keeps counts server-supplied and excludes unavailable counts without inventing zero", () => {
    const p = props();
    act(() => root.render(<KnowledgeBrowseFilters {...p} />));
    expect([...container.querySelectorAll('[data-kbv-view]')].map(node => node.textContent)).toEqual(["全部13", "草稿2", "待审批6", "已发布3", "已下架0"]);
    expect(container.querySelector('[data-kbv-view="all"]')?.getAttribute("title")).toBe("含 2 条加工中或其他状态资产");
    expect(container.querySelectorAll('[data-kbv-view="pending"]')).toHaveLength(1);
    act(() => root.render(<KnowledgeBrowseFilters {...p} countsReady={false} />));
    expect(container.querySelectorAll('small')).toHaveLength(0);
    expect(container.querySelector('[data-kbv-view="all"]')?.textContent).toBe("全部");
    expect(container.querySelector('[data-kbv-view="all"]')?.getAttribute("title")).toBeNull();
  });

  it("keeps stage multiselection, remove, add, cancel and clear working", () => {
    function Harness() {
      const [selected, onChange] = useState<string[]>([]);
      return <KnowledgeBrowseFilters {...props()} selectedStages={selected} onStages={onChange} />;
    }
    act(() => root.render(<Harness />));
    const first = MAIN_STAGE_TABS[0], second = MAIN_STAGE_TABS[1];
    click(`[data-kb-filter="stage"] [data-kb-filter-value="${first.code}"]`);
    click(`[data-kb-filter="stage"] [data-kb-filter-value="${second.code}"]`);
    expect(container.querySelectorAll('.knowledge-stage-chip [aria-pressed="true"]')).toHaveLength(2);
    click(`[aria-label="移除阶段：${first.label}"]`);
    expect(container.querySelector(`[data-kb-filter="stage"] [data-kb-filter-value="${first.code}"]`)).toBeNull();
    click('[aria-label="添加阶段"]');
    const choice = [...container.querySelectorAll<HTMLButtonElement>('.knowledge-stage-picker button')].find(button => button.textContent === first.label)!;
    act(() => choice.click());
    expect(container.querySelector(`[data-kb-filter="stage"] [data-kb-filter-value="${first.code}"]`)?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.knowledge-stage-picker')).toBeNull();
    click('[aria-label="添加阶段"]');
    act(() => [...container.querySelectorAll<HTMLButtonElement>('.knowledge-stage-picker button')].find(button => button.textContent === "取消")!.click());
    expect(container.querySelector('.knowledge-stage-picker')).toBeNull();
    click('[data-kb-filter="stage"] [data-kb-filter-value=""]');
    expect(container.querySelectorAll('.knowledge-stage-chip [aria-pressed="true"]')).toHaveLength(0);
  });
});

describe("knowledge right navigation", () => {
  it("shows only five workflows and preserves hidden direct-link stage IDs", () => {
    const onChange = vi.fn();
    act(() => root.render(<KnowledgeLifecycleTabs stage="catalog" onChange={onChange} />));
    expect([...container.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(["知识规划", "知识创作", "知识加工", "发布审批", "知识资产"]);
    for (const hidden of ["bindings", "lifecycle", "graph"]) expect(knowledgeStage(hidden)).toBe(hidden);
    expect(knowledgeStage("invalid")).toBe("published");
    click('[data-kb-stage="create"]');
    expect(onChange).toHaveBeenCalledWith("create");
  });

  it("keeps a keyboard entry point without selecting a different hidden-link panel", () => {
    const onChange = vi.fn();
    act(() => root.render(<KnowledgeLifecycleTabs stage="bindings" onChange={onChange} />));
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.filter(tab => tab.tabIndex === 0)).toHaveLength(1);
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs.every(tab => tab.getAttribute("aria-selected") === "false")).toBe(true);
    act(() => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(onChange).toHaveBeenCalledWith("published");
    expect(document.activeElement).toBe(tabs.at(-1));
  });
});
