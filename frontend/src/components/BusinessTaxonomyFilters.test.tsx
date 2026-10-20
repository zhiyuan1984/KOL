// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import BusinessTaxonomyFilters from "./BusinessTaxonomyFilters";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
afterEach(() => act(() => root.render(null)));
it("shows ontology zero-count topics, discloses more and retains selected off-fold values", () => {
  const onFamily = vi.fn();
  const props = { familyOptions: [1,2,3,4,5].map(id => ({ id: `B0${id}`, name: `业务族${id}`, count: 0 })), domainOptions: [], baseOptions: [],
    familyId: "B05", domainId: "", baseId: "", onFamily, onDomain: vi.fn(), onBase: vi.fn(), familyTotal: 0, domainTotal: 0, baseTotal: 0 };
  act(() => root.render(<BusinessTaxonomyFilters {...props} />));
  expect(element.querySelector('[data-kb-scope-family="B01"]')).not.toBeNull();
  expect(element.querySelector('[data-kb-scope-family="B04"]')).toBeNull();
  expect(element.querySelector('[data-kb-scope-family="B05"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(element.textContent).toContain("业务主题");
  act(() => element.querySelector<HTMLButtonElement>('[aria-label="展开业务族"]')!.click());
  expect(element.querySelector('[data-kb-scope-family="B04"]')).not.toBeNull();
  act(() => element.querySelector<HTMLButtonElement>('[data-kb-scope-family="B04"]')!.click());
  expect(onFamily).toHaveBeenCalledWith("B04");
});
