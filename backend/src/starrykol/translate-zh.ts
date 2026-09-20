/**
 * 草稿「一键翻译中文（内部）」：真正写成中文对照，不得把英文原稿加个中文标题交差。
 * 顺序：可用缓存 → Starry MCP translateEmailToChinese → Codex → Luna → 确定性中文转述。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mailAnalysisTimeout } from "../config.js";
import { remoteMailAnalysisEnabled } from "../host/mail-summary.js";
import {
  extractRemoteIntentText,
  intentLlmApiKey,
  intentLlmFetch,
  intentLlmFetchOverridden,
  intentLlmModel,
} from "../tasks/openai-intent.js";
import type { Json } from "../types.js";
import { CodexAppServer } from "../worker/codex.js";

export const INTERNAL_ZH_HEADER = "【内部中文译稿 · 不会进入 SMTP】";

const PHRASE_ZH: Array<[RegExp, string]> = [
  [/^hi\b[\s,]*/i, "你好，"],
  [/^hello\b[\s,]*/i, "你好，"],
  [/^dear\b[\s,]*/i, "您好，"],
  [/\bthank you\b/gi, "谢谢"],
  [/\bthanks\b/gi, "谢谢"],
  [/we would love to collaborate[^.!]*/gi, "我们很希望能合作"],
  [/just a follow-?up[^.!]*/gi, "这是一封跟进邮件"],
  [/following up on (?:the )?([^.]+)/gi, "现跟进 $1"],
  [/following up/gi, "现跟进"],
  [/collaboration opportunity with/gi, "合作邀约："],
  [/\bcollaboration\b/gi, "合作"],
  [/please send the rate card/gi, "请发报价单"],
  [/i am interested/gi, "我有兴趣"],
  [/looking forward to[^.!]*/gi, "期待后续进展"],
  [/best regards[,!.]?/gi, "此致"],
  [/^best[,!.]?$/gi, "此致，"],
];

function cjkCount(text: string): number {
  return (String(text || "").match(/[\u4e00-\u9fff]/g) || []).length;
}

export function stripInternalZhHeader(text: string): string {
  return String(text || "").replace(/^【内部中文译稿[^\n]*】\s*/u, "").trim();
}

export function isUsableInternalZh(zh: string, english: string): boolean {
  const stripped = stripInternalZhHeader(zh);
  if (cjkCount(stripped) < 8) return false;
  const en = String(english || "").trim().replace(/\s+/g, " ");
  if (!en) return true;
  const zhNorm = stripped.replace(/\s+/g, " ");
  if (zhNorm === en) return false;
  if (en.length >= 12 && stripped.includes(String(english || "").trim()) && cjkCount(stripped) < Math.max(8, en.length / 3)) {
    return false;
  }
  return true;
}

function translateLine(line: string): string {
  let out = line.trim();
  if (!out) return "";
  for (const [pattern, zh] of PHRASE_ZH) {
    out = out.replace(pattern, zh);
  }
  out = out.replace(/[,:;]+$/g, "。").replace(/\s{2,}/g, " ").trim();
  if (cjkCount(out) >= Math.max(2, Math.min(8, out.length / 4))) return out;
  return `内部转述：这是英文草稿里的合作跟进内容。`;
}

export function stubInternalZh(english: string): string {
  const lines = String(english || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const body = (lines.length ? lines.map(translateLine) : ["这封英文草稿还没有正文。"]).join("\n\n");
  return `${INTERNAL_ZH_HEADER}\n\n${body}\n\n发送仍用英文原文，本段仅内部查看。`;
}

export function ensureInternalZhHeader(zh: string): string {
  const text = String(zh || "").trim();
  if (!text) return "";
  if (text.startsWith("【内部中文译稿")) return text;
  return `${INTERNAL_ZH_HEADER}\n\n${text}`;
}

function noteFailure(where: string, err: unknown): void {
  const text = err instanceof Error ? err.message : String(err || "unknown");
  process.stderr.write(`[draft-translate] ${where}: ${text}\n`);
}

const zhSchema = {
  type: "object",
  properties: { zh: { type: "string" } },
  required: ["zh"],
  additionalProperties: false,
};

/** First balanced `{...}` object at or after `from`, ignoring braces inside strings. */
function firstJsonObject(text: string, from: number): { start: number; end: number } | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i };
    }
  }
  return null;
}

/** A model answer that still looks like a schema envelope is not a translation. */
function looksLikeZhEnvelope(text: string): boolean {
  return /"\s*(zh|text|translation)\s*"\s*:/.test(String(text || ""));
}

function zhFieldOf(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Json;
    return String(parsed.zh || parsed.text || parsed.translation || "").trim();
  } catch {
    return "";
  }
}

export function parseTranslatedZh(text: string, english: string): string | null {
  // The model may answer with several objects (`{...}\n{}`) or trailing prose, so
  // walk the balanced objects instead of slicing from the first brace to the last.
  let cursor = 0;
  for (let guard = 0; guard < 5; guard += 1) {
    const span = firstJsonObject(text, cursor);
    if (!span) break;
    cursor = span.end + 1;
    const zh = zhFieldOf(text.slice(span.start, span.end + 1));
    if (isUsableInternalZh(zh, english)) return ensureInternalZhHeader(zh);
  }
  const raw = text.trim();
  if (looksLikeZhEnvelope(raw)) return null;
  return isUsableInternalZh(raw, english) ? ensureInternalZhHeader(raw) : null;
}

/** Repair a translation already stored in the DB: unwrap the JSON envelope, or null to translate again. */
export function repairStoredZh(stored: string, english: string): string | null {
  const text = String(stored || "").trim();
  if (!text) return null;
  if (!looksLikeZhEnvelope(text)) return text;
  return parseTranslatedZh(text, english);
}

async function translateWithCodex(english: string): Promise<string | null> {
  let cwd = "";
  let rpc: CodexAppServer | null = null;
  try {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-draft-zh-"));
    rpc = new CodexAppServer(mailAnalysisTimeout());
    await rpc.handshake();
    await rpc.requireAuth();
    const started = await rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { mcp_servers: {}, model: intentLlmModel() },
    });
    const thread = (started.thread as { id?: string } | undefined) || started;
    const threadId = String((thread as { id?: string }).id || "");
    if (!threadId) {
      noteFailure("codex thread/start", "missing thread id");
      return null;
    }
    await rpc.request("turn/start", {
      threadId,
      input: [{
        type: "text",
        text: [
          "把下面这封英文合作邮件译成给运营看的中文对照。不要编造，不要改阶段。",
          "这是内部稿，不会进入 SMTP。返回 JSON {\"zh\":\"中文全文\"}。",
          "",
          english,
        ].join("\n"),
      }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      summary: "concise",
      effort: "low",
      outputSchema: zhSchema,
    });
    const completed = await rpc.waitTurn(mailAnalysisTimeout());
    const extras = completed.turn && typeof completed.turn === "object"
      ? JSON.stringify((completed.turn as { output?: unknown }).output || {})
      : "";
    return parseTranslatedZh([...rpc.agentTexts, extras].join("\n"), english);
  } catch (err) {
    noteFailure("codex app-server", err);
    return null;
  } finally {
    rpc?.close();
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function translateWithLuna(english: string): Promise<string | null> {
  const key = intentLlmApiKey();
  if (!key) return null;
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), mailAnalysisTimeout() * 1000);
  try {
    const response = await intentLlmFetch()(`${base}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: intentLlmModel(),
        instructions: "把英文合作邮件译成中文内部对照。不编造，不改阶段，不进 SMTP。",
        input: english,
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "draft_internal_zh",
            strict: false,
            schema: zhSchema,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      noteFailure("luna", `HTTP ${response.status}`);
      return null;
    }
    return parseTranslatedZh(extractRemoteIntentText(await response.json()), english);
  } catch (err) {
    noteFailure("luna", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithMcp(english: string): Promise<string | null> {
  try {
    const { callStarryKolTool } = await import("./service.js");
    const result = await callStarryKolTool("translateEmailToChinese", { text: english });
    const zh = String(result.text || result.zh || result.translation || "").trim();
    return isUsableInternalZh(zh, english) ? ensureInternalZhHeader(zh) : null;
  } catch (err) {
    noteFailure("mcp", err);
    return null;
  }
}

export function isStubInternalZh(zh: string): boolean {
  return String(zh || "").includes("发送仍用英文原文，本段仅内部查看");
}

/**
 * 收件邮件正文的中文翻译：MCP → Codex → Luna，无确定性回退。
 * 拿不到可用译文时返回 null，由调用方标记 translation_source='pending'。
 */
export async function translateMailBodyZh(body: string): Promise<{ text: string; source: string } | null> {
  const source = String(body || "").trim();
  if (!source) return null;
  const fromMcp = await translateWithMcp(source);
  if (fromMcp && !isStubInternalZh(fromMcp)) return { text: stripInternalZhHeader(fromMcp), source: "starry_mcp" };
  if (!remoteMailAnalysisEnabled()) return null;
  if (!intentLlmFetchOverridden()) {
    const fromCodex = await translateWithCodex(source);
    if (fromCodex) return { text: stripInternalZhHeader(fromCodex), source: "codex_memory" };
  }
  const fromLuna = await translateWithLuna(source);
  if (fromLuna) return { text: stripInternalZhHeader(fromLuna), source: "luna" };
  return null;
}

export async function translateDraftInternal(english: string, cached = ""): Promise<string> {
  const source = String(english || "").trim();
  const skipCache = remoteMailAnalysisEnabled() && isStubInternalZh(cached);
  if (!skipCache && isUsableInternalZh(cached, source)) return ensureInternalZhHeader(cached);
  if (!source) return stubInternalZh("");
  const fromMcp = await translateWithMcp(source);
  if (fromMcp && !isStubInternalZh(fromMcp)) return fromMcp;
  if (remoteMailAnalysisEnabled() && !intentLlmFetchOverridden()) {
    const fromCodex = await translateWithCodex(source);
    if (fromCodex) return fromCodex;
  }
  if (remoteMailAnalysisEnabled()) {
    const fromLuna = await translateWithLuna(source);
    if (fromLuna) return fromLuna;
  }
  return fromMcp || stubInternalZh(source);
}
