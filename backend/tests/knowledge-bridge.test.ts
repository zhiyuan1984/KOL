import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bridgeMode, runBridge } from "../src/knowledge-bridge.js";

describe("knowledge bridge stub index evidence", () => {
  const previousMode = process.env.KNOWLEDGE_ENGINE_MODE;
  const temporary: string[] = [];

  beforeEach(() => {
    process.env.KNOWLEDGE_ENGINE_MODE = "stub";
  });

  afterEach(async () => {
    if (previousMode === undefined) delete process.env.KNOWLEDGE_ENGINE_MODE;
    else process.env.KNOWLEDGE_ENGINE_MODE = previousMode;
    await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
  });

  async function fixture(): Promise<{ root: string; document: string; library: string; normalized: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-bridge-stub-"));
    temporary.push(root);
    const document = path.join(root, "uploaded-document");
    const library = path.join(root, "library");
    const normalized = path.join(document, "normalized.pdf");
    await fs.mkdir(document, { recursive: true });
    return { root, document, library, normalized };
  }

  it("writes canonical scope pages from the existing extracted upload artifact", async () => {
    const { document, library, normalized } = await fixture();
    await fs.writeFile(normalized, "%PDF-1.4\nnormalized upload bytes\n%%EOF\n");
    const extracted = "# 电池规格\n\n## 第 1 页\n\n额定容量为 100Ah。\n\n## 第 2 页\n\n循环寿命与温度条件见本页。\n";
    await fs.writeFile(path.join(document, "extracted.md"), extracted);

    const indexed = await runBridge({ cmd: "index", args: ["--input", normalized, "--library", library] });
    expect(indexed).toMatchObject({ ok: true, pages: 2 });
    const docId = String(indexed.doc_id);
    const pages = JSON.parse(await fs.readFile(path.join(library, "docs", docId, "pages.json"), "utf8"));
    expect(pages).toEqual([
      { page_index: 1, text: "额定容量为 100Ah。" },
      { page_index: 2, text: "循环寿命与温度条件见本页。" },
    ]);
    const index = JSON.parse(await fs.readFile(path.join(library, ".stub-index.json"), "utf8"));
    expect(index).toEqual([{ doc_id: docId, name: "normalized.pdf", pages: 2, path: normalized }]);
  });

  it("keeps an ordinary normalized upload's existing text as its one stub page", async () => {
    const { library, normalized } = await fixture();
    const uploadedText = "%PDF-1.4\n正常上传页文本：额定电压 48V。\n%%EOF\n";
    await fs.writeFile(normalized, uploadedText);

    const indexed = await runBridge({ cmd: "index", args: ["--input", normalized, "--library", library] });
    expect(indexed).toMatchObject({ ok: true, pages: 1 });
    const pages = JSON.parse(await fs.readFile(path.join(library, "docs", String(indexed.doc_id), "pages.json"), "utf8"));
    expect(pages).toEqual([{ page_index: 1, text: uploadedText }]);
  });

  it("refuses a missing normalized original instead of emitting index or page evidence", async () => {
    const { library, root } = await fixture();
    const missing = path.join(root, "missing", "normalized.pdf");

    await expect(runBridge({ cmd: "index", args: ["--input", missing, "--library", library] }))
      .resolves.toMatchObject({ ok: false, code: "knowledge_index_input_missing" });
    await expect(fs.stat(path.join(library, ".stub-index.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(library, "docs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps real mode outside the stub-only evidence branch", () => {
    process.env.KNOWLEDGE_ENGINE_MODE = "real";
    expect(bridgeMode()).toBe("real");
  });
});
