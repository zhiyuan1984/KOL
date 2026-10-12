import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import AdmZip from "adm-zip";
import { convertPptx, validatePptx } from "../src/knowledge/pptx.js";
const fixture = new URL("./fixtures/pptx/strategy-2.pptx", import.meta.url);
let dir: string;
const oldBin = process.env.KNOWLEDGE_LIBREOFFICE_BIN, oldTimeout = process.env.KNOWLEDGE_PPTX_TIMEOUT_MS;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "pptx-test-")); });
afterEach(async () => {
  if (oldBin === undefined) delete process.env.KNOWLEDGE_LIBREOFFICE_BIN; else process.env.KNOWLEDGE_LIBREOFFICE_BIN = oldBin;
  if (oldTimeout === undefined) delete process.env.KNOWLEDGE_PPTX_TIMEOUT_MS; else process.env.KNOWLEDGE_PPTX_TIMEOUT_MS = oldTimeout;
  await fs.rm(dir, { recursive: true, force: true });
});
describe("PPTX validation", () => {
  it("accepts standard OOXML and counts hidden slides", async () => expect(validatePptx(await fs.readFile(fixture))).toBe(2));
  it("accepts safe relative OPC targets with non-numeric slide part names", async () => {
    const zip = new AdmZip(await fs.readFile(fixture));
    zip.addFile("ppt/slides/strategy.xml", zip.readFile("ppt/slides/slide1.xml")!);
    zip.deleteFile("ppt/slides/slide1.xml");
    zip.updateFile("ppt/_rels/presentation.xml.rels", Buffer.from(zip.readAsText("ppt/_rels/presentation.xml.rels").replace("slides/slide1.xml", "./slides/strategy.xml")));
    expect(validatePptx(zip.toBuffer())).toBe(2);
  });
  it("rejects renamed PDF bytes and arbitrary ZIP containers", () => {
    expect(() => validatePptx(Buffer.from("%PDF-1.4"))).toThrow();
    const zip = new AdmZip(); zip.addFile("sample.txt", Buffer.from("text"));
    expect(() => validatePptx(zip.toBuffer())).toThrow();
  });
  it.each(["macro", "external-media", "doctype", "missing-slide"])("rejects unsafe or corrupt %s", async kind => {
    const zip = new AdmZip(await fs.readFile(fixture));
    if (kind === "macro") zip.addFile("ppt/vbaProject.bin", Buffer.from("macro"));
    if (kind === "external-media") zip.addFile("ppt/slides/_rels/unsafe.rels", Buffer.from('<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="http://localhost/private"/></Relationships>'));
    if (kind === "doctype") zip.updateFile("ppt/presentation.xml", Buffer.from('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x/>'));
    if (kind === "missing-slide") zip.deleteFile("ppt/slides/slide2.xml");
    expect(() => validatePptx(zip.toBuffer())).toThrow();
  });
});
describe("PPTX conversion failure contracts", () => {
  it("reports missing converter and removes temporary files", async () => {
    process.env.KNOWLEDGE_LIBREOFFICE_BIN = path.join(dir, "missing");
    await expect(convertPptx(fixture.pathname, path.join(dir, "out.pdf"), new AbortController().signal)).rejects.toMatchObject({ detail: { code: "knowledge_pptx_converter_unavailable" } });
    expect(await fs.readdir(dir)).toEqual([]);
  });
  it("rejects cancellation before starting conversion", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(convertPptx(fixture.pathname, path.join(dir, "out.pdf"), controller.signal)).rejects.toMatchObject({ detail: { code: "knowledge_job_cancelled" } });
    expect(await fs.readdir(dir)).toEqual([]);
  });
  it.each(["timeout", "cancel"])("kills a running converter on %s and cleans scratch files", async kind => {
    const binary = path.join(dir, "slow-converter"); await fs.writeFile(binary, "#!/bin/sh\nsleep 60\n"); await fs.chmod(binary, 0o700);
    process.env.KNOWLEDGE_LIBREOFFICE_BIN = binary;
    process.env.KNOWLEDGE_PPTX_TIMEOUT_MS = kind === "timeout" ? "100" : "5000";
    const controller = new AbortController();
    const timer = kind === "cancel" ? setTimeout(() => controller.abort(), 100) : undefined;
    await expect(convertPptx(fixture.pathname, path.join(dir, "out.pdf"), controller.signal)).rejects.toMatchObject({ detail: { code: kind === "timeout" ? "knowledge_pptx_convert_timeout" : "knowledge_job_cancelled" } });
    if (timer) clearTimeout(timer);
    expect(await fs.readdir(dir)).toEqual(["slow-converter"]);
  });
});
describe.skipIf(process.env.TEST_PPTX_CONVERSION !== "1")("real LibreOffice conversion", () => {
  it.each([2, 116])("converts %s slides including the hidden slide without losing order", async pages => {
    const input = new URL(`./fixtures/pptx/strategy-${pages}.pptx`, import.meta.url).pathname;
    const output = path.join(dir, "out.pdf");
    const result = await convertPptx(input, output, new AbortController().signal);
    expect(result.pages).toBe(pages); expect(result.page_map[String(pages)]).toBe(pages);
    expect(result.text).toContain("Strategy slide 2"); expect(result.text).toContain(`Strategy slide ${pages}`);
    expect(execFileSync("pdfinfo", [output], { encoding: "utf8" })).toMatch(new RegExp(`Pages:\\s+${pages}`));
    expect(result.text.indexOf("Strategy slide 1")).toBeLessThan(result.text.indexOf("Strategy slide 2"));
    expect((await fs.readFile(input)).subarray(0, 2).toString()).toBe("PK");
    expect(await fs.readdir(dir)).toEqual(["out.pdf"]);
  }, 60000);
});
