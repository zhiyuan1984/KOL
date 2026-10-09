// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import LibraryPane from "./LibraryPane";
import type { KbAssetRow } from "./shared";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const documentRow = (id: string, title: string): KbAssetRow => ({ id, title, body: "", asset_type: "document", kind: "document", status: "pending_review" });
function render(rows: KbAssetRow[], callbacks = { onSelect: vi.fn(), onToggleSelect: vi.fn() }) {
  act(() => root.render(<LibraryPane rows={rows} totalCount={rows.length} page={1} pageCount={1} selectedId=""
    loading={false} onPrevious={() => {}} onNext={() => {}} selection={[]} {...callbacks} />));
  return callbacks;
}

describe("visible knowledge list refinement", () => {
  it("shows name/type headers and never labels every document as PDF", () => {
    render([documentRow("video", "采访素材"), { id: "entry", title: "合作口径", body: "", kind: "policy" }]);
    expect([...container.querySelectorAll('[data-kbv-list-columns] span')].map(x => x.textContent)).toEqual(["知识名称", "类型"]);
    expect(container.querySelector('[data-kbv-record="video"] .knowledge-row-kind')?.textContent).toBe("文档资料");
    expect(container.querySelector('[data-kbv-record="entry"] .knowledge-row-kind')?.textContent).toBe("口径");
    expect(container.textContent).not.toContain("PDF 文档");
  });
  it("preserves the entire long title and a differentiating tail without changing identity", () => {
    const title = "media-generation-长文件名-".repeat(5) + "-unique-ending-one";
    const { onSelect, onToggleSelect } = render([documentRow("one", title), documentRow("two", title)]);
    const first = container.querySelector<HTMLButtonElement>('[data-kbv-record="one"]')!;
    expect(first.querySelector('.knowledge-row-title')?.textContent).toBe(title);
    expect(first.querySelector('.knowledge-row-title')?.getAttribute("title")).toBe(title);
    expect(first.querySelector('.knowledge-title-tail')?.textContent).toBe(Array.from(title).slice(-12).join(""));
    expect(container.querySelectorAll('[data-kbv-record]')).toHaveLength(2);
    act(() => first.click()); expect(onSelect).toHaveBeenCalledWith("one");
    const check = container.querySelector<HTMLInputElement>('[data-kbv-record-wrap="two"] input')!;
    act(() => check.click()); expect(onToggleSelect).toHaveBeenCalledWith("two");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it("retains the compact single title for short entries and hides headers in empty state", () => {
    render([{ id: "entry", title: "首次建联", body: "", kind: "mail_template" }]);
    expect(container.querySelector('.knowledge-title-tail')).toBeNull();
    render([]);
    expect(container.querySelector('[data-kbv-list-columns]')).toBeNull();
    expect(container.querySelector('[data-kbv-empty]')).not.toBeNull();
  });
});
