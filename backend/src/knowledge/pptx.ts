import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { HttpFail } from "../host/errors.js";
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const fail = (code: string, message: string, status = 400): never => { throw new HttpFail(status, { code, message }); };
function slidePart(target: string): string {
  if (/\\|[?#]|^[a-z][a-z\d+.-]*:/i.test(target))
    throw new Error();
  const decoded = decodeURIComponent(target);
  const part = path.posix.normalize(decoded.startsWith("/") ? decoded.slice(1) : `ppt/${decoded}`);
  if (!part.startsWith("ppt/slides/") || !part.endsWith(".xml"))
    throw new Error();
  return part;
}
/** Inspect the container, never extract ZIP entries into the filesystem. */
export function validatePptx(bytes: Buffer): number {
  try {
    if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])))
      throw new Error();
    const zip = new AdmZip(bytes), entries = zip.getEntries();
    if (entries.length > 20000 || entries.reduce((n, e) => n + e.header.size, 0) > 536870912)
      throw new Error();
    if (new Set(entries.map(e => e.entryName)).size !== entries.length)
      throw new Error();
    if (entries.some(e => e.header.flags & 1 || /vbaProject\.bin$/i.test(e.entryName)))
      throw new Error();
    const xml = (name: string) => {
      const entry = zip.getEntry(name);
      if (!entry || entry.header.size > 4 * 1024 * 1024)
        throw new Error();
      const text = entry.getData().toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(text))
        throw new Error();
      return text;
    };
    if (!xml("[Content_Types].xml").includes("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"))
      throw new Error();
    const presentation = xml("ppt/presentation.xml"), rels = xml("ppt/_rels/presentation.xml.rels");
    const slideIds = [...presentation.matchAll(/<(?:\w+:)?sldId\s[^>]*\br:id=["']([^"']+)["']/g)].map(m => m[1]);
    if (!slideIds.length || slideIds.length > 2000 || new Set(slideIds).size !== slideIds.length)
      throw new Error();
    for (const id of slideIds) {
      const rel = [...rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].find(m => new RegExp(`\\bId=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(m[0]))?.[0];
      const target = rel?.match(/\bTarget=["']([^"']+)["']/)?.[1];
      if (!target || !rel || !/\bType=["'][^"']*\/slide["']/.test(rel))
        throw new Error();
      xml(slidePart(target));
    }
    // Ordinary hyperlinks are inert; linked images/media must not trigger server-side downloads.
    for (const entry of entries.filter(e => e.entryName.endsWith(".rels"))) {
      const relationships = xml(entry.entryName);
      for (const match of relationships.matchAll(/<Relationship\b[^>]*>/g)) {
        if (/TargetMode=["']External["']/i.test(match[0]) && !/\/hyperlink["']/.test(match[0]))
          throw new Error();
      }
    }
    return slideIds.length;
  }
  catch {
    return fail("knowledge_invalid_pptx", "不是有效的 PPTX，或含加密、宏、超限内容及外部链接媒体；请另存为标准 PPTX 后重试");
  }
}
async function run(command: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<string> {
  if (signal.aborted)
    return fail("knowledge_job_cancelled", "作业已取消", 409);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "", settled = false;
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else
          child.kill("SIGKILL");
      }
      catch { /* already exited */ }
    };
    const finish = (cause?: Error) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (cause)
        reject(cause);
      else
        resolve(output);
    };
    const abort = () => { kill(); /* wait for close before temporary-file cleanup */ };
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted)
      abort();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let outputBytes = 0, outputExceeded = false;
    child.stdout.on("data", b => {
      outputBytes += Buffer.byteLength(b, "utf8");
      if (outputBytes > 16 * 1024 * 1024) {
        outputExceeded = true;
        kill();
      }
      else
        output += b;
    });
    child.stderr.on("data", b => { error = (error + b.toString()).slice(-4096); });
    child.on("error", () => finish(new HttpFail(503, { code: "knowledge_pptx_converter_unavailable", message: "PPTX 转换依赖不可用，请安装 LibreOffice Impress 和 poppler-utils 后重试" })));
    child.on("close", code => {
      if (signal.aborted)
        finish(new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" }));
      else if (timedOut)
        finish(new HttpFail(504, { code: "knowledge_pptx_convert_timeout", message: "PPTX 转换超时，请拆分演示文稿后重试" }));
      else if (outputExceeded)
        finish(new HttpFail(413, { code: "knowledge_pptx_text_too_large", message: "PPTX 提取文本超过 16 MiB，请拆分资料后重试（未截断入库）" }));
      else if (code !== 0)
        finish(new HttpFail(502, { code: "knowledge_pptx_convert_failed", message: `PPTX 转换失败（${code}）：${error.slice(0, 200)}` }));
      else
        finish();
    });
  });
}

export async function convertPptx(input: string, output: string, signal: AbortSignal) {
  const sourceBytes = await fs.readFile(input);
  const pages = validatePptx(sourceBytes);
  const zip = new AdmZip(sourceBytes);
  const presentation = zip.readAsText("ppt/presentation.xml");
  const relationships = zip.readAsText("ppt/_rels/presentation.xml.rels");
  const visualPages = [...presentation.matchAll(/<(?:\w+:)?sldId\s[^>]*\br:id=["']([^"']+)["']/g)].flatMap((slide, i) => {
    const rel = [...relationships.matchAll(/<Relationship\b[^>]*>/g)].find(m => m[0].includes(`Id="${slide[1]}"`) || m[0].includes(`Id='${slide[1]}'`))?.[0];
    const target = rel?.match(/\bTarget=["']([^"']+)["']/)?.[1];
    const xml = target ? zip.readAsText(slidePart(target)) : "";
    return /<(?:\w+:)?pic\b|<(?:\w+:)?chart\b/.test(xml) ? [i + 1] : [];
  });
  const work = await fs.mkdtemp(path.join(path.dirname(output), ".pptx-convert-"));
  try {
    const profile = path.join(work, "profile");
    await fs.mkdir(profile);
    await fs.writeFile(path.join(profile, "registrymodifications.xcu"), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
    const source = path.join(work, "input.pptx");
    await fs.copyFile(input, source);
    const rawTimeout = Number(process.env.KNOWLEDGE_PPTX_TIMEOUT_MS || 300000);
    const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.min(rawTimeout, 1800000) : 300000;
    await run(process.env.KNOWLEDGE_LIBREOFFICE_BIN || "libreoffice", [
      `-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--norestore",
      "--convert-to", 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}', "--outdir", work, source,
    ], signal, timeout);
    const converted = path.join(work, "input.pdf");
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(converted);
    }
    catch {
      return fail("knowledge_pptx_convert_failed", "LibreOffice 未生成 PDF，请检查文件是否损坏或受密码保护", 502);
    }
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")) || !bytes.subarray(-1024).includes(Buffer.from("%%EOF")))
      return fail("knowledge_pptx_convert_failed", "转换结果不是有效 PDF", 502);
    const info = await run("pdfinfo", [converted], signal, 30000);
    if (Number(info.match(/^Pages:\s+(\d+)/m)?.[1]) !== pages)
      return fail("knowledge_pptx_page_mismatch", "转换页数与原幻灯片数量不一致，未提交索引，请检查或拆分资料", 502);
    const text = await run("pdftotext", ["-layout", converted, "-"], signal, 30000);
    if (signal.aborted)
      return fail("knowledge_job_cancelled", "作业已取消", 409);
    await fs.rename(converted, output);
    return { pages, text, visualPages, page_map: Object.fromEntries(Array.from({ length: pages }, (_, i) => [String(i + 1), i + 1])) };
  }
  finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
