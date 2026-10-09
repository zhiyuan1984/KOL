// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeAssetsPanel } from "./KnowledgeGovernancePanels";
import type { WsData } from "./shared";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); });

type PanelProps = ComponentProps<typeof KnowledgeAssetsPanel>;

function fixture(): WsData {
  return {
    tenant: "company:fixture",
    rows: [], total: 10, page: 1, page_size: 1, page_count: 10,
    domains: [
      { id: "family-high", name: "高价值业务族", level: "family" },
      { id: "family-low", name: "低价值业务族", level: "family" },
      { id: "family-empty", name: "空业务族", level: "family" },
      { id: "domain-main", name: "主营业务域", level: "domain" },
      { id: "domain-empty", name: "空业务域", level: "domain" },
    ],
    bases: [
      { id: "base-main", name: "主知识库" },
      { id: "base-empty", name: "空知识库" },
    ],
    facets: {
      family: { all: 10, values: { "family-high": 6, "family-low": 2, "family-empty": 0, __none__: 1 } },
      domain: { all: 10, values: { "domain-main": 7, "domain-empty": 0, __none__: 1 } },
      base: { all: 10, values: { "base-main": 8, "base-empty": 0, __none__: 1 } },
    },
    stats: {
      status: { failed: 0 },
      pending_review: { count: 0, max_wait_days: 0 },
      pending_documents: { count: 0, max_wait_days: 0 },
      expiring: { count: 0, nearest: null },
    },
  } as unknown as WsData;
}

function props(data: WsData | null = fixture(), error = ""): PanelProps {
  return {
    data, error, reload: vi.fn(), onPendingDocuments: vi.fn(), onScope: vi.fn(), onExpiring: vi.fn(),
  };
}

function render(panelProps: PanelProps): void {
  act(() => root.render(<MemoryRouter><KnowledgeAssetsPanel {...panelProps} /></MemoryRouter>));
}

const click = (selector: string) => act(() => container.querySelector<HTMLButtonElement>(selector)!.click());

describe("knowledge asset distribution", () => {
  it("hides zero-count categories by default and explicitly expands then collapses them", () => {
    render(props());
    expect(container.querySelector('[data-kb-dist="family:family-empty"]')).toBeNull();
    expect(container.querySelector('[data-kb-dist="family:__none__"]')?.textContent).toContain("未归属业务族");
    expect(container.querySelector('[data-kb-empty-toggle]')?.textContent).toBe("显示空分类");

    click('[data-kb-empty-toggle]');
    expect(container.querySelector('[data-kb-empty-toggle]')?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-kb-dist="family:family-empty"]')?.textContent).toContain("空业务族");

    click('[data-kb-empty-toggle]');
    expect(container.querySelector('[data-kb-empty-toggle]')?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-kb-dist="family:family-empty"]')).toBeNull();
  });

  it("sorts every real category by server count and uses its facet all as the percentage denominator", () => {
    const data = fixture();
    data.facets.family = { all: 20, values: { "family-high": 3, "family-low": 1, "family-empty": 0, __none__: 2 } };
    render(props(data));

    expect([...container.querySelectorAll('[data-kb-dist^="family:"]')].map(node => node.getAttribute("data-kb-dist"))).toEqual([
      "family:family-high", "family:__none__", "family:family-low",
    ]);
    const high = container.querySelector('[data-kb-dist="family:family-high"]')!;
    expect(high.querySelector(".ksr-ratio")?.textContent).toBe("15%");
    expect(high.querySelector(".ksr-bar i")?.getAttribute("style")).toContain("width: 15%");
    expect(high.querySelector(".ksr-name")?.getAttribute("title")).toBe("高价值业务族");
  });

  it("does not convert missing facets or queue statistics into zero, but keeps sparse failed status as a real zero", () => {
    const data = fixture() as unknown as { facets: Record<string, unknown>; stats: Record<string, unknown> };
    data.facets = { domain: fixture().facets.domain };
    data.stats = { status: {}, pending_documents: {}, expiring: {} };
    render(props(data as unknown as WsData));

    expect(container.querySelector('[aria-label="业务族"]')?.textContent).toContain("统计暂不可用");
    expect(container.querySelector('[data-kb-dist^="family:"]')).toBeNull();
    expect(container.querySelector('[data-kb-queue="failed"] .kbadmin-queue-count')?.textContent).toBe("0");
    expect(container.querySelector('[data-kb-queue="documents"] .kbadmin-queue-count')?.textContent).toBe("统计暂不可用");
    expect(container.querySelector('[data-kb-queue="expiry"] .kbadmin-queue-count')?.textContent).toBe("统计暂不可用");

    const missingStatus = fixture() as unknown as { stats: Record<string, unknown> };
    missingStatus.stats = { pending_documents: { count: 0, max_wait_days: 0 }, expiring: { count: 0, nearest: null } };
    render(props(missingStatus as unknown as WsData));
    expect(container.querySelector('[data-kb-queue="failed"] .kbadmin-queue-count')?.textContent).toBe("统计暂不可用");
  });

  it("preserves zero health queues and all three taxonomy drill-down callback signatures", () => {
    const panelProps = props();
    render(panelProps);
    expect(container.querySelectorAll('[data-kb-queue]')).toHaveLength(3);
    expect([...container.querySelectorAll('.kbadmin-queue-count')].map(node => node.textContent)).toEqual(["0", "0", "0"]);

    click('[data-kb-dist="family:family-high"]');
    click('[data-kb-dist="domain:domain-main"]');
    click('[data-kb-dist="base:base-main"]');
    expect(panelProps.onScope).toHaveBeenNthCalledWith(1, "family", "family-high");
    expect(panelProps.onScope).toHaveBeenNthCalledWith(2, "domain", "domain-main");
    expect(panelProps.onScope).toHaveBeenNthCalledWith(3, "base", "base-main");
  });

  it("keeps pending and expiry queue callbacks intact", () => {
    const panelProps = props();
    render(panelProps);
    click('[data-kb-queue="documents"]');
    click('[data-kb-queue="expiry"]');
    expect(panelProps.onPendingDocuments).toHaveBeenCalledOnce();
    expect(panelProps.onExpiring).toHaveBeenCalledOnce();
  });

  it("renders honest loading and error states with a retry", () => {
    const reload = vi.fn();
    render({ ...props(null), reload });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在读取知识资产统计");

    render({ ...props(fixture(), "服务暂不可用"), reload });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("资产统计读取失败：服务暂不可用");
    click("[role=alert] button");
    expect(reload).toHaveBeenCalledOnce();
  });
});
