// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeScope, ScopeDetail } from "../../../../shared/knowledge-scope";
import AsyncTaskInfo, { projectAsyncTaskState } from "./AsyncTaskInfo";
import DocumentReader from "./DocumentReader";
import KnowledgeScopePanel from "./KnowledgeScopePanel";

const mocks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("../../reviews/api", () => ({ reviewApi: mocks.scope, reviewCompany: () => "company", reviewHeaders: () => ({}) }));

let host: HTMLDivElement;
let root: Root;
const candidate: KnowledgeScope = {
  schema_version: 1,
  summary: "可核对范围",
  entities: [],
  topics: [],
  question_types: ["overview"],
  limitations: [],
  unverified_notes: [],
  evidence: [],
  coverage: { status: "complete", unreadable_pages: [], catalog_completeness: "unknown" },
};

function detail(overrides: Partial<ScopeDetail> = {}) {
  return {
    document_id: "same-name-a",
    revision: 1,
    explanation: "用途 A",
    state: "empty",
    scope: null,
    fingerprint: "",
    job: null,
    handoff: { status: "none" },
    frozen: false,
    actions: { edit: true, generate: false, check: false },
    ...overrides,
  } as ScopeDetail;
}

async function render(element: ReactNode) {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.scope.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("knowledge processing pilot components", () => {
  it("shows a persisted handoff gap only when there is no current scope job", () => {
    expect(projectAsyncTaskState({ handoff: { status: "queued" }, scopeState: "empty" }).title).toBe("索引完成，等待范围提炼交接");
    expect(projectAsyncTaskState({
      handoff: { status: "queued" },
      scopeState: "candidate",
      scopeJob: { id: "scope-new", status: "running", progress: { done: 2, total: 4, unit: "batches" } },
    }).title).toBe("正在依据原文提炼知识范围");
  });

  it("uses only real batch totals and never turns unknown totals into a percentage", async () => {
    await render(<AsyncTaskInfo scopeJob={{ id: "scope", status: "running", progress: { done: 2, total: 4, unit: "batches" } }} />);
    expect(host.textContent).toContain("业务进度：2/4 批次");
    await render(<AsyncTaskInfo scopeJob={{ id: "scope", status: "running", progress: { done: 2, total: null, unit: "batches" } }} />);
    expect(host.textContent).toContain("服务端未提供细分业务进度");
    expect(host.textContent).not.toContain("业务进度：2/0");
  });

  it("keeps uncertain results distinct and makes an unavailable candidate confirmation visibly disabled", async () => {
    await render(<AsyncTaskInfo scopeJob={{ id: "scope", status: "uncertain", error_summary: "回执未确认" }} />);
    expect(host.textContent).toContain("范围提炼结果待核查");
    expect(host.textContent).not.toContain("尚未提炼");

    mocks.scope.mockResolvedValue(detail({ state: "candidate", scope: candidate, actions: { edit: true, generate: false, check: false } }));
    await render(<KnowledgeScopePanel id="candidate" documentStatus="pending_review" onReady={vi.fn()} onChanged={vi.fn()} />);
    const check = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "确认已核对原文范围");
    expect(check).toBeDefined();
    expect(check?.disabled).toBe(true);
    expect(host.textContent).toContain("服务端未提供当前候选的核对确认动作");
  });

  it("does not let a late response for a same-name document overwrite the selected stable ID", async () => {
    let resolveOld: ((value: ScopeDetail) => void) | undefined;
    const oldResponse = new Promise<ScopeDetail>((resolve) => { resolveOld = resolve; });
    mocks.scope.mockImplementation((url: string) => url.includes("same-name-a")
      ? oldResponse
      : Promise.resolve(detail({ document_id: "same-name-b", explanation: "用途 B" })));

    await render(<KnowledgeScopePanel id="same-name-a" documentStatus="pending_review" onReady={vi.fn()} onChanged={vi.fn()} />);
    await render(<KnowledgeScopePanel id="same-name-b" documentStatus="pending_review" onReady={vi.fn()} onChanged={vi.fn()} />);
    await act(async () => { resolveOld?.(detail({ document_id: "same-name-a", explanation: "用途 A（旧回执）" })); await Promise.resolve(); });

    const explanation = host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="资料讲什么"]');
    expect(explanation?.value).toBe("用途 B");
    expect(host.textContent).not.toContain("旧回执");
  });

  it("distinguishes a fidelity preview from extracted text and preserves encoded original links", async () => {
    await render(<DocumentReader id="doc/a?b" title="长资料" mediaType="pptx" artifacts={{ normalize: { mode: "pptx-convert" } }} company="company A&B" textPreview={{ name: "转写", text: "长中文段落\n可阅读文本" }} />);
    const frame = host.querySelector<HTMLDivElement>("[data-pdf-source]");
    expect(frame?.getAttribute("data-pdf-source")).toBe("/api/admin/knowledge/documents/doc%2Fa%3Fb/preview?company=company+A%26B");
    expect(host.textContent).toContain("若阅读区空白或浏览器不支持 PDF");
    const openPreview = Array.from(host.querySelectorAll<HTMLAnchorElement>("a")).find((link) => link.textContent?.includes("在新窗口打开"));
    expect(openPreview?.getAttribute("href")).toContain("/preview?company=company+A%26B");

    const textTab = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).find((tab) => tab.textContent?.includes("提取文本"));
    await act(async () => textTab?.click());
    expect(host.textContent).toContain("提取文本");
    expect(host.textContent).toContain("不保留原件页面版式");
    expect(textTab?.getAttribute("aria-selected")).toBe("true");
  });
  it("does not declare indexing complete merely because first-processing intent is pending", () => {
    const titles = { draft: "原件草稿已保存，尚未解析", uploaded: "资料已提交，等待加工服务接管", normalizing: "正在规整原件", indexing: "正在建立资料索引" };
    for (const [documentStatus, title] of Object.entries(titles)) {
      expect(projectAsyncTaskState({ documentStatus, handoff: { status: "pending" }, scopeState: "empty" }).title).toBe(title);
    }
  });
  it("never borrows previous indexing completion as current scope progress", async () => {
    await render(<AsyncTaskInfo scopeJob={{ id: "new-scope", status: "running" }} documentJob={{ id: "old-index", kind: "index", progress_done: 1, progress_total: 1 }} />);
    expect(host.textContent).toContain("服务端未提供细分业务进度");
    expect(host.textContent).not.toContain("业务进度：1/1");
  });
  it("keeps stale checked scope from enabling approval while new generation is unsettled", async () => {
    const ready = vi.fn();
    mocks.scope.mockResolvedValue(detail({ state: "checked", scope: candidate, job: { id: "new-job", status: "running", progress: { done: 0, total: 4, unit: "batches" } } }));
    await render(<KnowledgeScopePanel id="checked" documentStatus="pending_review" onReady={ready} onChanged={vi.fn()} />);
    expect(ready).toHaveBeenLastCalledWith(false);
  });
});
