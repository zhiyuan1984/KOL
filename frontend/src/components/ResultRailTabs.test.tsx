import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultRailTabs from "./ResultRailTabs";

describe("result rail tabs", () => {
  it("exposes one tablist with the selected result tab", () => {
    const html = renderToStaticMarkup(createElement(ResultRailTabs, {
      tabs: [{ id: "result", label: "结果" }, { id: "status", label: "状态过程" }],
      active: "result",
      onChange: () => undefined,
    }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="结果栏视图"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-rail-tab="result"');
    expect(html).toContain('data-rail-tab="status"');
    expect(html).toContain('aria-controls="rail-panel-result"');
  });

  it("keeps the debug tab out of the normal tab set", () => {
    const html = renderToStaticMarkup(createElement(ResultRailTabs, {
      tabs: [{ id: "result", label: "结果" }, { id: "status", label: "状态过程" }],
      active: "status",
      onChange: () => undefined,
    }));
    expect(html).not.toContain('data-rail-tab="debug"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-rail-tab="status"');
  });

  it("renders a result count badge without turning it into the tab name", () => {
    const html = renderToStaticMarkup(createElement(ResultRailTabs, {
      tabs: [{ id: "result", label: "结果", badge: 2 }, { id: "status", label: "状态过程" }],
      active: "result",
      onChange: () => undefined,
    }));
    expect(html).toContain('aria-label="2 项"');
    expect(html).toContain(">结果<em");
  });
});
