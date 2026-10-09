// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRef, useState } from "react";
import { describe, expect, it, afterEach } from "vitest";
import type { InputRef } from "antd";
import WorkspaceSearchInput from "./WorkspaceSearchInput";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

describe("WorkspaceSearchInput", () => {
  it("keeps the native controlled change-event contract and clears the query", () => {
    function ControlledSearch() {
      const [query, setQuery] = useState("initial");
      return <WorkspaceSearchInput aria-label="搜索测试" value={query} onChange={(event) => setQuery(event.target.value)} />;
    }

    const container = mount(<ControlledSearch />);
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("initial");

    act(() => input?.dispatchEvent(new Event("input", { bubbles: true })));
    // React's controlled input follows the DOM setter used below, matching native input callers.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "updated");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input?.value).toBe("updated");

    const clear = container.querySelector<HTMLElement>(".ant-input-clear-icon");
    act(() => clear?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(input?.value).toBe("");
  });

  it("forwards InputRef plus data and aria attributes to the underlying input", () => {
    const ref = createRef<InputRef>();
    const container = mount(<WorkspaceSearchInput ref={ref} data-search-probe="workspace" aria-describedby="search-help" aria-label="搜索测试" value="" onChange={() => {}} />);
    const input = container.querySelector<HTMLInputElement>("input");

    expect(ref.current?.input).toBe(input);
    expect(input?.dataset.searchProbe).toBe("workspace");
    expect(input?.getAttribute("aria-describedby")).toBe("search-help");
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(input);
  });
});
