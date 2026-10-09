// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeDocumentDetail } from "../../api";
import IngestDocumentDetails, { documentWorkspaceUrl, sameNameDocuments } from "./IngestDocumentDetails";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(query => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const detail: KnowledgeDocumentDetail = {
  document: { id: "video/id", base_id: "battery", title: "资料标题", filename: "演示视频.mp4", media_type: "video", size_bytes: 2048, status: "pending_review", retry_count: 0, created_at: "2026-10-09T01:00:00Z", updated_at: "2026-10-09T01:00:00Z" },
  base: { id: "battery", name: "电池", domain_name: "产品管理", family_name: "产品与解决方案", kind: "unstructured", status: "active" },
  jobs: [{ id: "job", document_id: "video/id", kind: "index", status: "done", progress_done: 1, progress_total: 1, attempt: 1, created_at: "2026-10-09T01:00:00Z" }],
  text_preview: { name: "preview", text: "不应混入资料详情的加工结果" },
};
describe("compact ingest document details", () => {
  it("shows file information without jobs, preview or approval form", () => {
    act(() => root.render(<MemoryRouter><IngestDocumentDetails detail={detail} documents={[]} company="company a" onOpen={vi.fn()} /></MemoryRouter>));
    expect(container.textContent).toContain("演示视频.mp4");
    expect(container.textContent).toContain("视频 · 2.0 KB");
    expect(container.textContent).toContain("产品与解决方案 / 产品管理 / 电池");
    expect(container.textContent).not.toContain("不应混入资料详情的加工结果");
    expect(container.querySelector("pre, [data-knowledge-publication], [data-admin-kb-job]")).toBeNull();
    const source = container.querySelector<HTMLAnchorElement>("[data-admin-kb-doc-open]")!;
    expect(source.getAttribute("href")).toBe("/api/admin/knowledge/documents/video%2Fid/file?company=company%20a");
    expect(source.target).toBe("_blank");
    const workspace = new URL(container.querySelector<HTMLAnchorElement>("[data-admin-kb-doc-workspace]")!.href);
    expect(workspace.searchParams.get("assetId")).toBe("video/id");
    expect(workspace.searchParams.get("reviewCompany")).toBe("company a");
  });
  it("deduplicates identical IDs only and keeps same-name independent records", () => {
    const one = { ...detail.document, id: "one", status: "failed" };
    const two = { ...detail.document, id: "two" };
    const otherBase = { ...detail.document, id: "other", base_id: "other" };
    const documents = [detail.document, one, one, two, otherBase];
    expect(sameNameDocuments(detail.document, documents).map(doc => doc.id)).toEqual(["one", "two"]);
    const onOpen = vi.fn();
    act(() => root.render(<MemoryRouter><IngestDocumentDetails detail={detail} documents={documents} company="" onOpen={onOpen} /></MemoryRouter>));
    expect(container.querySelectorAll("[data-admin-kb-related-document]")).toHaveLength(2);
    expect(container.textContent).toContain("独立记录，未确认版本关系");
    act(() => container.querySelector<HTMLButtonElement>('[data-admin-kb-related-document="one"] button')!.click());
    expect(onOpen).toHaveBeenCalledWith("one");
  });
  it("retains exact original names and encodes workspace identifiers without side effects", () => {
    const filename = "media-generation-2f62595e-7dd3-4b9b-a013-715f5af3569e.mp4";
    act(() => root.render(<MemoryRouter><IngestDocumentDetails detail={{ ...detail, document: { ...detail.document, filename } }} documents={[]} company="" onOpen={vi.fn()} /></MemoryRouter>));
    expect(container.querySelector(".kbingest-full-name")?.textContent).toBe(filename);
    const url = new URL(documentWorkspaceUrl("id/a?b", "company"), "https://example.test");
    expect(url.pathname).toBe("/admin/knowledge");
    expect(url.searchParams.get("assetId")).toBe("id/a?b");
    expect(url.searchParams.get("mode")).toBe("detail");
  });
});
