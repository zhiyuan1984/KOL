import { describe, expect, it } from "vitest";
import { originalDocumentPage } from "../src/knowledge/document-pages.js";
describe("document original page mapping", () => {
  it.each(["scanned-ocr", "pptx-ocr"])("maps %s reflow pages to original slides", mode => {
    const normalization = { mode, pages: 2, page_map: { "1": 1, "2": 1, "3": 2 } };
    expect(originalDocumentPage(normalization, 2)).toBe(1);
    expect(originalDocumentPage(normalization, 3)).toBe(2);
    expect(() => originalDocumentPage(normalization, 4)).toThrow();
  });
  it("maps direct PPTX pages and rejects outside-slide citations", () => {
    const normalization = { mode: "pptx-convert", pages: 2, page_map: { "1": 1, "2": 2, "3": 3 } };
    expect(originalDocumentPage(normalization, 2)).toBe(2);
    expect(() => originalDocumentPage(normalization, 3)).toThrow();
  });
  it("keeps ordinary PDF page numbering and rejects invalid pages", () => {
    expect(originalDocumentPage({ mode: "text-passthrough" }, 5)).toBe(5);
    expect(() => originalDocumentPage(undefined, 0)).toThrow();
  });
});
