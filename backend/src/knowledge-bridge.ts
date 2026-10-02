/**
 * 知识侧车桥（PageIndex 本地）：Node 只通过 stdout 单行 JSON 契约调用侧车，
 * 不直接接触 PageIndex SDK（便于锁版本、隔离升级）。契约见
 * docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md §7.2。
 * KNOLEDGE_ENGINE_MODE=stub 时使用 Node 内夹具：全部测试不依赖 Python。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpFail } from "./host/errors.js";
import type { Json } from "./types.js";

const BRIDGE_SCRIPT = fileURLToPath(new URL("../tools/pageindex-bridge/bridge.py", import.meta.url));

export function bridgeMode(): "stub" | "real" {
  return String(process.env.KNOWLEDGE_ENGINE_MODE || "").trim().toLowerCase() === "stub" ? "stub" : "real";
}

export function indexModel(): string {
  return String(process.env.KNOWLEDGE_INDEX_MODEL || "gpt-5.6-luna");
}

export function chatModel(): string {
  return String(process.env.KNOWLEDGE_CHAT_MODEL || "gpt-5.6-sol");
}

export function mediaModel(): string {
  return String(process.env.KNOWLEDGE_MEDIA_MODEL || "gpt-5.6-sol");
}

export type BridgeOutcome = Json & { ok: boolean; code?: string; message?: string };

type BridgeCall = { cmd: string; args: string[]; timeoutMs?: number; signal?: AbortSignal; cwd?: string };

function argValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || "") : "";
}

function argValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] != null) out.push(String(args[index + 1]));
  }
  return out;
}

/** 侧车调用：spawn → stdout 单行 JSON；超时/取消杀进程；进程级失败映射稳定错误码。 */
export async function runBridge(call: BridgeCall): Promise<BridgeOutcome> {
  if (bridgeMode() === "stub") return await runStub(call);
  const python = String(process.env.KNOWLEDGE_PAGEINDEX_PYTHON || "python");
  const timeoutMs = call.timeoutMs || 30 * 60_000;
  return await new Promise<BridgeOutcome>((resolve, reject) => {
    let settled = false;
    const child = spawn(python, [BRIDGE_SCRIPT, call.cmd, ...call.args], {
      cwd: call.cwd || path.dirname(BRIDGE_SCRIPT),
      env: process.env,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new HttpFail(504, { code: "knowledge_index_timeout", message: "知识侧车超时" })));
    }, timeoutMs);
    const onAbort = () => {
      child.kill();
      finish(() => reject(new HttpFail(409, { code: "knowledge_job_cancelled", message: "作业已取消" })));
    };
    call.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => { out += String(chunk); });
    child.stderr.on("data", (chunk) => { err += String(chunk); });
    child.on("error", () => {
      clearTimeout(timer);
      finish(() => reject(new HttpFail(503, { code: "knowledge_index_unavailable", message: "找不到 Python 或知识侧车不可用" })));
    });
    child.on("close", (codeExit) => {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", onAbort);
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      let parsed: BridgeOutcome | null = null;
      try {
        parsed = line ? (JSON.parse(line) as BridgeOutcome) : null;
      } catch {
        parsed = null;
      }
      if (parsed) {
        finish(() => resolve(parsed));
        return;
      }
      finish(() => reject(new HttpFail(503, {
        code: "knowledge_index_unavailable",
        message: `知识侧车异常退出（${codeExit}）${err.trim() ? `：${err.trim().slice(0, 200)}` : ""}`,
      })));
    });
  });
}

/* ---- stub 夹具（KNOWLEDGE_ENGINE_MODE=stub） ---- */

type StubLibraryEntry = { doc_id: string; name: string; pages: number; path: string };

function stubDelayMs(): number {
  const raw = Number(process.env.KNOWLEDGE_STUB_NORMALIZE_MS || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function stubLibraryPath(library: string): string {
  return path.join(library, ".stub-index.json");
}

function readStubLibrary(library: string): StubLibraryEntry[] {
  try {
    return JSON.parse(fs.readFileSync(stubLibraryPath(library), "utf8")) as StubLibraryEntry[];
  } catch {
    return [];
  }
}

function writeStubLibrary(library: string, rows: StubLibraryEntry[]): void {
  fs.mkdirSync(library, { recursive: true });
  fs.writeFileSync(stubLibraryPath(library), `${JSON.stringify(rows, null, 2)}\n`);
}

async function runStub(call: BridgeCall): Promise<BridgeOutcome> {
  await new Promise((resolve) => setTimeout(resolve, stubDelayMs()));
  if (call.cmd === "ping") return { ok: true, python: "stub", pageindex: "stub" };
  if (call.cmd === "index") {
    const input = argValue(call.args, "--input");
    const library = argValue(call.args, "--library");
    const name = path.basename(input);
    const bytes = fs.existsSync(input) ? fs.readFileSync(input) : Buffer.alloc(0);
    if (bytes.includes("STUB_FAIL_INDEX_ONCE")) {
      const marker = path.join(library, `.stub-fail-once-${Buffer.from(name, "utf8").toString("hex")}`);
      if (!fs.existsSync(marker)) {
        fs.mkdirSync(library, { recursive: true });
        fs.writeFileSync(marker, "1");
        return { ok: false, code: "knowledge_index_failed", message: "stub：索引失败一次（测试标记）" };
      }
    } else if (bytes.includes("STUB_FAIL_INDEX")) {
      return { ok: false, code: "knowledge_index_failed", message: "stub：索引失败（测试标记）" };
    }
    let hash = 0;
    for (const ch of `${name}:${Date.now()}:${Math.random()}`) hash = (hash * 31 + ch.charCodeAt(0)) % 0xffffffff;
    const docId = `pi_stub_${hash.toString(16)}`;
    const entries = readStubLibrary(library).filter((entry) => entry.path !== input);
    entries.push({ doc_id: docId, name, pages: 1, path: input });
    writeStubLibrary(library, entries);
    return { ok: true, doc_id: docId, pages: 1, elapsed_ms: 1 };
  }
  if (call.cmd === "ask") {
    const library = argValue(call.args, "--library");
    const question = argValue(call.args, "--question");
    const docArgs = argValues(call.args, "--doc-id");
    const entries = readStubLibrary(library);
    const chosen = docArgs.length ? entries.filter((entry) => docArgs.includes(entry.doc_id)) : entries;
    if (!chosen.length) return { ok: false, code: "knowledge_ask_failed", message: "该库还没有可检索的资料" };
    return {
      ok: true,
      answer: `stub 试算答案：${question}`,
      citations: chosen.map((entry) => ({ document: entry.name, doc_id: entry.doc_id, page: 1 })),
    };
  }
  if (call.cmd === "make-pdf") {
    const out = argValue(call.args, "--out");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from("%PDF-1.4\n% stub normalized pdf\n%%EOF\n", "utf8"));
    return { ok: true };
  }
  if (call.cmd === "remove") {
    const library = argValue(call.args, "--library");
    const docId = argValue(call.args, "--doc-id");
    writeStubLibrary(library, readStubLibrary(library).filter((entry) => entry.doc_id !== docId));
    return { ok: true };
  }
  return { ok: false, code: "knowledge_index_unavailable", message: `stub 不支持命令 ${call.cmd}` };
}
