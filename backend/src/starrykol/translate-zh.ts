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
  codexRecognizeThreadConfig,
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

export type MailSourceLanguage = {
  kind: "empty" | "source_zh" | "needs_model";
  cjk_count: number;
  ascii_letters: number;
  reason: "empty" | "source_chinese" | "mixed_substantive_english" | "non_chinese";
};

/**
 * `source_zh` is intentionally narrow: every non-space character must be Han,
 * a number, or Unicode punctuation.  A single untranslated Latin word (URL,
 * model number, "deal", or "OK") keeps the source on the model path.
 */
export function classifyMailSourceLanguage(text: string): MailSourceLanguage {
  const source = String(text || "");
  const cjk = cjkCount(source);
  const ascii = (source.match(/[A-Za-z]/g) || []).length;
  if (!source.trim()) return { kind: "empty", cjk_count: cjk, ascii_letters: ascii, reason: "empty" };
  const chineseOnly = /^[\p{Script=Han}\p{N}\p{P}\p{Z}\p{M}\r\n]+$/u.test(source);
  if (cjk > 0 && chineseOnly) return { kind: "source_zh", cjk_count: cjk, ascii_letters: ascii, reason: "source_chinese" };
  return { kind: "needs_model", cjk_count: cjk, ascii_letters: ascii, reason: cjk > 0 ? "mixed_substantive_english" : "non_chinese" };
}

/** A short all-English greeting may legitimately translate to two Han chars.
 * All normal/long mail retains the historical >=8 Han quality floor. */
export function isUsableInternalZh(zh: string, english: string): boolean {
  const stripped = stripInternalZhHeader(zh);
  if (!stripped || stripped === INTERNAL_ZH_HEADER || isStubInternalZh(stripped)) return false;
  const source = String(english || "").trim();
  const normalizedSource = source.replace(/\s+/g, " ");
  const normalizedZh = stripped.replace(/\s+/g, " ");
  if (normalizedSource && normalizedZh === normalizedSource) return false;
  // Preserve legitimate names/brands/URLs; a single shared English token is not
  // an echoed sentence.  Whole-source echoes and consecutive source clauses are
  // rejected even if wrapped in a Chinese prefix or reformatted punctuation.
  const sourceWords = normalizedSource.match(/[A-Za-z]{2,}/g) || [];
  if (source.length >= 12 && normalizedZh.includes(normalizedSource)) return false;
  const outputWords = (normalizedZh.match(/[A-Za-z]{2,}/g) || []).map(word => word.toLowerCase()).join(" ");
  for (let index = 0; index + 4 <= sourceWords.length; index += 1) {
    const clause = sourceWords.slice(index, index + 4).map(word => word.toLowerCase()).join(" ");
    if (outputWords.includes(clause)) return false;
  }
  const shortEnglish = Array.from(normalizedSource).length <= 12
    && /^[A-Za-z\s,.!?'"-]+$/.test(normalizedSource) && sourceWords.length > 0;
  const floor = shortEnglish ? 2 : 8;
  return cjkCount(stripped) >= floor;
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

/** Keep known-good normal mail bodies on the one-turn path; only exceptional long bodies are split. */
export const CODEX_TRANSLATION_CHUNK_THRESHOLD = 12_000;
export const CODEX_TRANSLATION_CHUNK_MAX_CHARS = 4_000;

/**
 * Splits on Unicode code points, preferring existing whitespace at the boundary.
 * Each code point is present exactly once: joining the result reconstructs `text`.
 */
export function splitLongTextForCodex(text: string, maxChars = CODEX_TRANSLATION_CHUNK_MAX_CHARS): string[] {
  const source = String(text || "");
  if (!source) return [];
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer");
  const points = Array.from(source);
  if (points.length <= maxChars) return [source];
  const chunks: string[] = [];
  for (let start = 0; start < points.length;) {
    const limit = Math.min(start + maxChars, points.length);
    let end = limit;
    if (limit < points.length) {
      for (let cursor = limit; cursor > start; cursor -= 1) {
        if (/\s/u.test(points[cursor - 1])) {
          end = cursor;
          break;
        }
      }
    }
    chunks.push(points.slice(start, end).join(""));
    start = end;
  }
  return chunks;
}

async function translateWithCodexOne(english: string): Promise<string | null> {
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
      // Codex must use CODEX_MODEL / CLI default; gpt-5.6-luna is Responses-only.
      config: codexRecognizeThreadConfig(),
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

/** Progress received from the PG-native mail job for a single long Codex source. */
export type CodexLongTextProgress = {
  completedChunks?: string[];
  shouldYield?: () => boolean;
  checkpoint?: (input: { index: number; chunkCount: number; translation: string }) => Promise<boolean>;
};
export type CodexTranslationAttempt = {
  text?: string;
  yielded?: boolean;
  sourceChanged?: boolean;
  error?: string;
  /** Actual source chunk count; callers never infer it from stale checkpoint state. */
  chunkCount?: number;
};

/**
 * The existing one-turn path remains untouched for normal mail.  A long path
 * can resume with durable caller-owned checkpoints; it never returns a prefix.
 */
export async function translateWithCodexChunksResumable(
  english: string,
  translateChunk: (chunk: string) => Promise<string | null>,
  progress: CodexLongTextProgress = {},
): Promise<CodexTranslationAttempt> {
  const source = String(english || "");
  if (!source) return { error: "empty_source", chunkCount: 0 };
  const chunks = Array.from(source).length > CODEX_TRANSLATION_CHUNK_THRESHOLD
    ? splitLongTextForCodex(source) : [source];
  const completed = [...(progress.completedChunks || [])];
  if (completed.length > chunks.length || completed.some((part, index) => !isUsableInternalZh(part, chunks[index]))) {
    return { error: "invalid_chunk_checkpoint", chunkCount: chunks.length };
  }
  for (let index = completed.length; index < chunks.length; index += 1) {
    if (progress.shouldYield?.()) return { yielded: true, chunkCount: chunks.length };
    const zh = await translateChunk(chunks[index]);
    if (!zh || !isUsableInternalZh(zh, chunks[index]) || isStubInternalZh(zh)) return { error: "codex_chunk_unavailable", chunkCount: chunks.length };
    const normalized = stripInternalZhHeader(zh);
    completed.push(normalized);
    if (progress.checkpoint && !(await progress.checkpoint({ index, chunkCount: chunks.length, translation: normalized }))) {
      return { sourceChanged: true, chunkCount: chunks.length };
    }
  }
  const joined = completed.join("\n\n");
  return isUsableInternalZh(joined, source) ? { text: ensureInternalZhHeader(joined), chunkCount: chunks.length } : { error: "merged_translation_unusable", chunkCount: chunks.length };
}

/** Backward-compatible complete-only helper used by unit contracts and draft paths. */
export async function translateWithCodexChunks(
  english: string,
  translateChunk: (chunk: string) => Promise<string | null>,
): Promise<string | null> {
  return (await translateWithCodexChunksResumable(english, translateChunk)).text || null;
}

async function translateWithCodex(english: string, progress?: CodexLongTextProgress): Promise<CodexTranslationAttempt> {
  return translateWithCodexChunksResumable(english, translateWithCodexOne, progress);
}

/** Mail-body provider order stays MCP -> Codex -> Luna; a budget yield is not a provider failure. */
export async function translateMailBodyZhResumable(
  body: string,
  progress?: CodexLongTextProgress,
): Promise<{ text?: string; source?: string; yielded?: boolean; sourceChanged?: boolean; error?: string }> {
  const source = String(body || "");
  if (!source.trim()) return { error: "empty_source" };
  const fromMcp = await translateWithMcp(source);
  if (fromMcp && !isStubInternalZh(fromMcp)) return { text: stripInternalZhHeader(fromMcp), source: "starry_mcp" };
  if (!remoteMailAnalysisEnabled()) return { error: "provider_disabled" };
  let codexError = "";
  if (!intentLlmFetchOverridden()) {
    const codex = await translateWithCodex(source, progress);
    if (codex.text) return { text: stripInternalZhHeader(codex.text), source: "codex_memory" };
    if (codex.yielded || codex.sourceChanged) return codex;
    codexError = String(codex.error || "");
  }
  const fromLuna = await translateWithLuna(source);
  if (fromLuna) return { text: stripInternalZhHeader(fromLuna), source: "luna" };
  // Preserve the bounded Codex/quality diagnostic.  It is safe metadata, never
  // body text, and avoids misreporting a chunk-quality failure as generic outage.
  return { error: codexError || "translation_provider_unavailable" };
}

async function translateWithLuna(english: string): Promise<string | null> {
  // gpt-5.6-luna is not a public api.openai.com model. In real mode an
  // explicit custom base is required; a test-only fetch override remains local.
  if (!intentLlmFetchOverridden() && !String(process.env.OPENAI_BASE_URL || "").trim()) {
    noteFailure("luna", "OPENAI_BASE_URL is not configured");
    return null;
  }
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

const MCP_TRANSLATION_TEXT_FIELDS = [
  "zh", "translation", "translatedText", "translated_text", "translatedBody", "translated_body",
  "translatedContent", "translated_content", "body", "content", "text", "value",
] as const;
const MCP_TRANSLATION_ENVELOPE_FIELDS = ["data", "result", "payload", "translationResult"] as const;

function mcpResultExplicitlyFailed(value: Json): boolean {
  if (value.isError === true || value.success === false || value.ok === false || value.failed === true) return true;
  if (value.error || value.error_code || value.errorCode || value.needs_input === true) return true;
  const status = String(value.status || "").trim().toLowerCase();
  return status === "error" || status === "failed" || status === "failure";
}

/**
 * Starry's managed client has already normalized MCP content blocks, but the translation
 * endpoint can still return a business envelope (for example `data`, `result`, or a JSON
 * string). Extract only recognized translation leaves; never promote an error/status payload
 * or an echoed English request into a completed Chinese translation.
 */
function mcpTranslationCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") return mcpTranslationCandidates(parsed, depth + 1);
    } catch {
      // A non-JSON string is a possible text leaf below.
    }
    return [text];
  }
  if (Array.isArray(value)) return value.flatMap((item) => mcpTranslationCandidates(item, depth + 1));
  if (typeof value !== "object") return [];
  const result = value as Json;
  if (mcpResultExplicitlyFailed(result)) return [];
  const candidates: string[] = [];
  for (const field of MCP_TRANSLATION_TEXT_FIELDS) {
    const text = result[field];
    if (typeof text === "string") candidates.push(...mcpTranslationCandidates(text, depth + 1));
  }
  for (const field of MCP_TRANSLATION_ENVELOPE_FIELDS) {
    candidates.push(...mcpTranslationCandidates(result[field], depth + 1));
  }
  return candidates;
}

/** Exported for contract tests: unwrap an actual managed-MCP result only if it contains usable Chinese. */
export function unwrapMcpTranslatedZh(result: Json, english: string): string | null {
  if (mcpResultExplicitlyFailed(result)) return null;
  for (const candidate of mcpTranslationCandidates(result)) {
    const zh = parseTranslatedZh(candidate, english);
    if (zh) return zh;
  }
  return null;
}

async function translateWithMcp(english: string): Promise<string | null> {
  if (!String(english || "").trim()) return null;
  try {
    const { callStarryKolTool } = await import("./service.js");
    // LIVE schema proves requestJson is the only permitted top-level argument. Keep
    // the existing text member inside its opaque TranslationRequest until its DTO is
    // supplied by Starry; do not invent title/body fields from the human description.
    const result = await callStarryKolTool("translateEmailToChinese", {
      requestJson: JSON.stringify({ text: english }),
    });
    return unwrapMcpTranslatedZh(result, english);
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
  const result = await translateMailBodyZhResumable(body);
  return result.text && result.source ? { text: result.text, source: result.source } : null;
}

/** On-demand mail skill path: deliberately use the established Codex → Luna chain. */
export async function translateMailBodyZhWithCodexLuna(body: string): Promise<{ text: string; source: string } | null> {
  const source = String(body || "").trim();
  if (!source || !remoteMailAnalysisEnabled()) return null;
  if (!intentLlmFetchOverridden()) {
    const fromCodex = await translateWithCodex(source);
    if (fromCodex.text) return { text: stripInternalZhHeader(fromCodex.text), source: "codex_memory" };
  }
  const fromLuna = await translateWithLuna(source);
  if (fromLuna) return { text: stripInternalZhHeader(fromLuna), source: "luna" };
  const fromMcp = await translateWithMcp(source);
  if (fromMcp && !isStubInternalZh(fromMcp)) return { text: stripInternalZhHeader(fromMcp), source: "starry_mcp" };
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
    if (fromCodex.text) return fromCodex.text;
  }
  if (remoteMailAnalysisEnabled()) {
    const fromLuna = await translateWithLuna(source);
    if (fromLuna) return fromLuna;
  }
  return fromMcp || stubInternalZh(source);
}
