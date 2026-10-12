// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type KnowledgeBaseRow } from "../../api";
import UploadDialog from "./UploadDialog";

vi.mock("../../reviews/api", () => ({ reviewCompany: () => "company" }));
const base = { id: "base", name: "资料库", family_id: "family", family_name: "业务族", domain_id: "domain", domain_name: "业务域", kind: "unstructured", status: "active" } as KnowledgeBaseRow;
let container: HTMLDivElement;
let root: Root;
let onDirty: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  onDirty = vi.fn();
  act(() => root.render(<UploadDialog open inline bases={[base]} onClose={vi.fn()} onCreated={vi.fn()} onDirty={onDirty} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function add(files: File[]) {
  const input = container.querySelector<HTMLInputElement>("[data-kbv-upload-pick]")!;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function chooseBase() { act(() => container.querySelector<HTMLButtonElement>('[data-kb-scope-base="base"]')!.click()); }
function explain(input: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("knowledge upload queue", () => {
  it("accepts PPTX and sends the original file for server conversion", async () => {
    const file = new File(["deck"], "华为战略管理.PPTX");
    const upload = vi.spyOn(api, "adminKnowledgeDocumentUpload").mockResolvedValue({ document: { id: "pptx" } } as never);
    add([file]); chooseBase();
    expect(container.querySelector<HTMLInputElement>("[data-kbv-upload-pick]")?.accept).toContain(".pptx");
    expect(container.querySelector("[data-kbv-upload-queue]")?.textContent).toContain("PPTX 演示文稿");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click());
    expect(upload.mock.calls[0][1]).toBe(file);
  });
  it("rejects legacy PPT with an actionable save-as message", () => {
    add([new File(["deck"], "华为战略管理.ppt")]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("另存为 PPTX");
    expect(container.querySelector("[data-kbv-upload-queue]")).toBeNull();
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });
  it("keeps explanations independent for distinct same-name files", async () => {
    const first = new File(["first"], "资料.pdf", { lastModified: 1 });
    const second = new File(["second file"], "资料.pdf", { lastModified: 2 });
    const upload = vi.spyOn(api, "adminKnowledgeDocumentUpload").mockResolvedValue({ document: { id: "saved" } } as never);
    add([first, second]); chooseBase();
    explain(container.querySelectorAll<HTMLTextAreaElement>(".kbv-file-row textarea")[0], "第一份的用途");
    expect(container.querySelectorAll<HTMLTextAreaElement>(".kbv-file-row textarea")[1].value).toBe("");
    explain(container.querySelectorAll<HTMLTextAreaElement>(".kbv-file-row textarea")[1], "第二份的用途");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click());
    expect(upload.mock.calls.map(call => call[4])).toEqual(["第一份的用途", "第二份的用途"]);
  });
  it("locks category selection during upload and does not re-upload already saved files on retry", async () => {
    const first = new File(["first"], "第一份.pdf");
    const second = new File(["second"], "第二份.pdf");
    let finish!: (value: never) => void;
    const upload = vi.spyOn(api, "adminKnowledgeDocumentUpload")
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockRejectedValueOnce(Object.assign(new Error("请求格式不正确"), { status: 422 }))
      .mockResolvedValueOnce({ document: { id: "second" } } as never);
    add([first, second]); chooseBase();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click());
    expect([...container.querySelectorAll<HTMLButtonElement>("[data-kb-scope-picker] button")].every(button => button.disabled)).toBe(true);
    await act(async () => finish({ document: { id: "first" } } as never));
    expect(container.querySelectorAll(".kbv-file-row")).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已保存 1 份");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click());
    expect(upload.mock.calls.map(call => call[1])).toEqual([first, second, second]);
  });
  it.each([0, 500, 502])("blocks blind retry when upload outcome is unknown (%s)", async status => {
    const upload = vi.spyOn(api, "adminKnowledgeDocumentUpload").mockRejectedValueOnce(Object.assign(new Error("连接中断"), { status }));
    add([new File(["pdf"], "资料.pdf")]); chooseBase();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("上传结果尚未确认");
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("剩余文件可重试");
    const submit = container.querySelector<HTMLButtonElement>("[data-kbv-upload-submit]")!;
    expect(submit.disabled).toBe(true);
    act(() => submit.click());
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("clears dirty state when the last queued file is removed", () => {
    add([new File(["pdf"], "资料.pdf")]);
    expect(onDirty).toHaveBeenLastCalledWith(true);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="移除 资料.pdf"]')!.click());
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });
});
