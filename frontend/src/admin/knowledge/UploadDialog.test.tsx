// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UploadDialog from "./UploadDialog";
import { api, type KnowledgeBaseRow } from "../../api";
vi.mock("../../api", () => ({ api: { adminKnowledgeDocumentUpload: vi.fn() } }));
vi.mock("../../reviews/api", () => ({ reviewCompany: () => "company" }));
let container: HTMLDivElement, root: Root;
const upload = vi.mocked(api.adminKnowledgeDocumentUpload);
const bases = [
  { id: "base", name: "电池", kind: "unstructured", status: "active", family_id: "family", family_name: "产品", domain_id: "domain", domain_name: "产品管理" },
  { id: "structured", name: "不可上传", kind: "structured", status: "active" },
  { id: "archived", name: "停用库", kind: "unstructured", status: "archived" },
] as KnowledgeBaseRow[];
let onCreated: ReturnType<typeof vi.fn>, onClose: ReturnType<typeof vi.fn>, onDirty: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(query => ({ matches: false, media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  onCreated = vi.fn(); onClose = vi.fn(); onDirty = vi.fn();
  act(() => root.render(<UploadDialog inline open bases={bases} onClose={onClose} onCreated={onCreated} onDirty={onDirty} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const click = (selector: string) => act(() => container.querySelector<HTMLButtonElement>(selector)!.click());
function pick(files: File[]) {
  const input = container.querySelector<HTMLInputElement>("[data-kbv-upload-pick]")!;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function explain(value: string) {
  const input = container.querySelector<HTMLTextAreaElement>("[data-kbv-upload-explanation]")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const file = (name: string, text = "资料") => new File([text], name, { lastModified: 1 });
describe("annotated upload form", () => {
  it("shares six selection axes and accepts formats without offering invalid bases", () => {
    expect(container.querySelectorAll("[data-kbv-upload-scope] .kbv-scope-row")).toHaveLength(3);
    for (const axis of ["brand", "stage", "kind"]) expect(container.querySelector(`[data-kb-filter="${axis}"]`)).not.toBeNull();
    for (const code of ["LT", "PQ", "RO", "TB"]) expect(container.querySelector(`[data-kb-filter="brand"] [data-kb-filter-value="${code}"]`)).not.toBeNull();
    expect(container.querySelector('[data-kb-scope-base="structured"]')).toBeNull();
    expect(container.querySelector('[data-kb-scope-base="archived"]')).toBeNull();
    expect(container.textContent).not.toContain("支持批量选择或拖入文件");
    expect(container.querySelector('.ant-btn-text[aria-label="关闭"]')).not.toBeNull();
    const accept = container.querySelector<HTMLInputElement>("[data-kbv-upload-pick]")!.accept;
    for (const ext of ["pdf", "png", "md", "txt", "mp4", "avi"]) expect(accept.split(",")).toContain(`.${ext}`);
  });
  it("rejects unsupported, empty and duplicate files while keeping valid batch files", () => {
    const good = file("资料.PDF");
    pick([good, good, file("不可解析.exe"), file("空.txt", "")]);
    expect(container.querySelectorAll(".kbv-file-row")).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已在列表中");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("格式暂不支持");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("空文件");
  });
  it("persists selected brands and stages for every actual file even when the queue is filtered", async () => {
    upload.mockResolvedValue({ document: { id: "created" } } as never);
    const pdf = file("资料.PDF"), md = file("说明.md"); pick([pdf, md]); explain("本批用途");
    click('[data-kb-scope-base="base"]'); click('[data-kb-filter="brand"] [data-kb-filter-value="LT"]'); click('[data-kb-filter="brand"] [data-kb-filter-value="TB"]');
    click('[data-kb-filter="stage"] [data-kb-filter-value="INITIAL_CONTACT"]'); click('[data-kb-file-type="pdf"]');
    expect(container.querySelectorAll(".kbv-file-row")).toHaveLength(1);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click(); });
    expect(upload).toHaveBeenCalledTimes(2);
    for (const [index, actual] of [pdf, md].entries()) expect(upload.mock.calls[index]).toEqual(["base", actual, false, undefined, "本批用途", "company", { brands: ["LT", "TB"], stages: ["INITIAL_CONTACT"] }]);
    expect(onCreated).toHaveBeenCalledWith("created"); expect(onDirty).toHaveBeenLastCalledWith(false);
  });
  it("retains only the remaining files after partial failure and freezes controls while uploading", async () => {
    let resolve!: (value: any) => void;
    upload.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockRejectedValueOnce(new Error("解析接口失败"));
    pick([file("一.txt"), file("二.avi")]); click('[data-kb-scope-base="base"]');
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click(); });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-kb-filter="brand"] button')!.disabled).toBe(true);
    expect(container.querySelector<HTMLFieldSetElement>(".knowledge-stage-chips")!.disabled).toBe(true);
    await act(async () => { resolve({ document: { id: "one" } }); });
    expect(container.querySelectorAll(".kbv-file-row")).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已保存 1 份");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("剩余文件可重试");
    expect(onCreated).not.toHaveBeenCalled();
    upload.mockResolvedValueOnce({ document: { id: "two" } } as never);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click(); });
    expect(upload.mock.calls.map(call => call[1].name)).toEqual(["一.txt", "二.avi", "二.avi"]);
    expect(onCreated).toHaveBeenCalledWith("two");
  });
  it("drag and drop adds files and scope changes clear child choices", () => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file("拖入.txt")] } });
    act(() => container.querySelector("[data-kbv-upload-drop]")!.dispatchEvent(event));
    expect(container.querySelectorAll(".kbv-file-row")).toHaveLength(1);
    click('[data-kb-scope-base="base"]'); click('[data-kb-scope-family="family"]');
    expect(container.querySelector('[data-kb-scope-base=""]')?.getAttribute("aria-pressed")).toBe("true");
  });
  it("does not render an inline form after close", () => {
    act(() => root.render(<UploadDialog inline open={false} bases={bases} onClose={onClose} onCreated={onCreated} />));
    expect(container.querySelector('[data-kbv-upload-dialog]')).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });
  it("does not mark a rejected-only or unchanged selection dirty", () => {
    pick([file("非法.exe"), file("空.txt", "")]);
    click('[data-kb-filter="brand"] [data-kb-filter-value=""]');
    click('[data-kb-filter="stage"] [data-kb-filter-value=""]');
    click('[data-kb-scope-family=""]');
    expect(onDirty).not.toHaveBeenCalled();
  });
  it("keeps explanations separate for valid same-name files", async () => {
    const first = file("同名.txt", "第一份"), second = file("同名.txt", "第二份资料");
    pick([first, second]); click('[data-kb-scope-base="base"]');
    const inputs = [...container.querySelectorAll<HTMLTextAreaElement>('.kbv-file-row textarea')];
    for (const [index, input] of inputs.entries()) act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, `独立解释${index + 1}`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    upload.mockResolvedValue({ document: { id: "created" } } as never);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click(); });
    expect(upload.mock.calls.map(call => call[4])).toEqual(["独立解释1", "独立解释2"]);
  });
});
