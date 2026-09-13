/**
 * Codex memory for KOL thread mail. Real mode must call Codex app-server
 * (then Luna) on the letter body. Stub only writes a deterministic analysis
 * so tests stay offline. Never persist a greeting rule as Codex success.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConn, nowIso, tx } from "../db.js";
import { codexMode, mailAnalysisTimeout, mailDigestFailRetryMs } from "../config.js";
import {
  codexRecognizeThreadConfig,
  extractRemoteIntentText,
  intentLlmApiKey,
  intentLlmFetch,
  intentLlmFetchOverridden,
  intentLlmMode,
  intentLlmModel,
} from "../tasks/openai-intent.js";
import { itemsForCollaboration } from "../starrykol/mail-sync.js";
import { CodexAppServer } from "../worker/codex.js";
import type { Json } from "../types.js";

const REMOTE_SOURCES = new Set(["codex_memory", "luna"]);
const RULE_GREETING = /^(去信|来信)寒暄跟进，尚未落到报价、档期或明确兴趣。$/;

export function digestMailBody(row: Json): string {
  const body = String(row.body || row.snippet || "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

function bodyEvidence(body: string): string {
  const cleaned = body.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const hit = cleaned.match(/would love to collaborate|interested|有兴趣|想合作|报价|rate card|thank you.{0,24}/i);
  if (hit && hit.index != null) {
    const start = Math.max(0, hit.index - 8);
    return cleaned.slice(start, start + 48).trim();
  }
  return cleaned.length > 36 ? `${cleaned.slice(0, 36)}…` : cleaned;
}

/** Deterministic body analysis. Used in stub and as the real-mode fallback. */
export function analyzeMailBody(row: Json): string {
  const body = String(row.body || row.snippet || "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const outbound = String(row.direction) === "outbound";
  const dir = outbound ? "去信" : "来信";
  const evidence = bodyEvidence(body);
  const lower = body.toLowerCase();
  const thanksOnly = /thank you for your email|谢谢|感谢/.test(lower)
    && !/interest|collaborat|有兴趣|想合作/.test(lower);
  if (thanksOnly) {
    return outbound
      ? `${dir}致谢，未提出新的合作条款。摘录：${evidence}`
      : `${dir}致谢，单独感谢不能当作有兴趣。摘录：${evidence}`;
  }
  if (/interested|would love to collaborate|有兴趣|想合作|乐意合作/.test(lower)) {
    return outbound
      ? `${dir}表达合作意愿。摘录：${evidence}`
      : `${dir}明确表示有兴趣合作。摘录：${evidence}`;
  }
  if (/rate card|quote|报价|usd\s*\d|\$\s*\d/.test(lower)) {
    return `${dir}涉及报价或费用，需人核对后才能记状态。摘录：${evidence}`;
  }
  if (/i hope (you.re|this message)|reach out|doing well|great spirits|wanted to/.test(lower)) {
    return `${dir}寒暄跟进，尚未落到报价、档期或明确兴趣。`;
  }
  return `${dir}要点：${evidence}`;
}

function isGreetingDump(text: string): boolean {
  return /^(Hi|Hello|Hey)\b/i.test(text.trim());
}

function isRuleGreetingFallback(text: string): boolean {
  return RULE_GREETING.test(text.trim());
}

function trustedRemoteSummary(row: Json): string {
  const source = String(row.summary_source || "");
  const stored = String(row.summary || row.summary_zh || "").trim();
  if (!stored || !REMOTE_SOURCES.has(source)) return "";
  if (isGreetingDump(stored) || isRuleGreetingFallback(stored)) return "";
  return stored;
}

export function mailSummaryOf(row: Json): string {
  return trustedRemoteSummary(row) || analyzeMailBody(row) || String(row.summary || row.summary_zh || "").trim() || digestMailBody(row);
}

export function analyzeThreadDigest(rows: Json[]): string {
  const listed = rows.filter((row) => String(row.body || row.snippet || "").trim());
  if (!listed.length) return "";
  const bits = listed.map((row) => {
    const point = analyzeMailBody(row).replace(/摘录：.*$/, "").trim();
    const evidence = bodyEvidence(String(row.body || row.snippet || ""));
    return evidence && !point.includes(evidence) ? `${point}（${evidence}）` : point;
  }).filter(Boolean);
  return `本会话共 ${listed.length} 封往来。${bits.join("；")}。`;
}

export type ThreadDigest = {
  text: string;
  source: string;
  mail_count: number;
  fingerprint: string;
  error?: string;
  attempted?: string[];
  failed_at?: string;
};

function threadFingerprint(rows: Json[]): string {
  return rows.map((row) => [
    String(row.id || ""),
    String(row.occurred_at || ""),
    String(row.body || row.snippet || "").length,
  ].join(":")).join("|");
}

function digestStateKey(collaborationId: string): string {
  return `mail_digest:${collaborationId}`;
}

export function readThreadDigest(collaborationId: string): ThreadDigest | null {
  if (!collaborationId) return null;
  const row = getConn().prepare("SELECT value FROM app_state WHERE key=?").get(digestStateKey(collaborationId)) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as ThreadDigest;
    if (!parsed || typeof parsed !== "object") return null;
    const attempted = Array.isArray(parsed.attempted)
      ? parsed.attempted.map((item) => String(item || "").trim()).filter(Boolean)
      : (parsed.attempted ? [String(parsed.attempted).trim()].filter(Boolean) : []);
    return {
      text: String(parsed.text || "").trim(),
      source: String(parsed.source || ""),
      mail_count: Number(parsed.mail_count || 0),
      fingerprint: String(parsed.fingerprint || ""),
      ...(parsed.error ? { error: String(parsed.error) } : {}),
      ...(attempted.length ? { attempted } : {}),
      ...(parsed.failed_at ? { failed_at: String(parsed.failed_at) } : {}),
    };
  } catch {
    return null;
  }
}

function writeThreadDigest(collaborationId: string, digest: ThreadDigest): void {
  tx((db) => {
    db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run(
      digestStateKey(collaborationId),
      JSON.stringify(digest),
    );
  });
}

function trustedThreadDigest(digest: ThreadDigest | null): string {
  if (!digest?.text) return "";
  if (!REMOTE_SOURCES.has(digest.source)) return "";
  if (isGreetingDump(digest.text) || isRuleGreetingFallback(digest.text)) return "";
  return digest.text;
}

function stickyFailFields(stored?: ThreadDigest | null): Pick<ThreadDigest, "error" | "attempted" | "failed_at"> {
  if (!stored) return {};
  return {
    ...(stored.error ? { error: stored.error } : {}),
    ...(stored.attempted?.length ? { attempted: stored.attempted } : {}),
    ...(stored.failed_at ? { failed_at: stored.failed_at } : {}),
  };
}

/** Legacy records without failed_at are treated as expired so already-stuck employees recover. */
export function stickyFailReady(stored: ThreadDigest | null | undefined, nowMs = Date.now()): boolean {
  if (!stored || stored.source !== "analysis_failed") return true;
  const failedAt = Date.parse(String(stored.failed_at || ""));
  if (!Number.isFinite(failedAt)) return true;
  return nowMs - failedAt >= mailDigestFailRetryMs();
}

export function threadDigestOf(rows: Json[], stored?: ThreadDigest | null): ThreadDigest {
  const fingerprint = threadFingerprint(rows);
  const trusted = stored && stored.fingerprint === fingerprint ? trustedThreadDigest(stored) : "";
  const text = trusted || analyzeThreadDigest(rows);
  const failed = Boolean(!trusted && stored && stored.fingerprint === fingerprint && stored.source === "analysis_failed");
  return {
    text,
    source: trusted
      ? String(stored?.source || "codex_memory")
      : (failed ? "analysis_failed" : "body_analysis"),
    mail_count: rows.filter((row) => String(row.body || row.snippet || "").trim()).length,
    fingerprint,
    ...(failed ? stickyFailFields(stored) : {}),
  };
}

export function needsRemoteThreadDigest(rows: Json[], stored: ThreadDigest | null | undefined, opts?: { retryFailed?: boolean }): boolean {
  if (!rows.some((row) => String(row.body || row.snippet || "").trim())) return false;
  if (!remoteMailAnalysisEnabled()) return false;
  const fingerprint = threadFingerprint(rows);
  if (stored && stored.fingerprint === fingerprint && trustedThreadDigest(stored)) return false;
  if (stored && stored.fingerprint === fingerprint && stored.source === "analysis_failed" && !opts?.retryFailed && !stickyFailReady(stored)) {
    return false;
  }
  return true;
}

export function remoteMailAnalysisEnabled(): boolean {
  if (intentLlmMode() === "real") return true;
  return codexMode() !== "stub";
}

export function needsRemoteMailSummary(row: Json, opts?: { retryFailed?: boolean }): boolean {
  if (!String(row.body || row.snippet || "").trim()) return false;
  if (!remoteMailAnalysisEnabled()) return false;
  if (trustedRemoteSummary(row)) return false;
  if (String(row.summary_source || "") === "analysis_failed" && !opts?.retryFailed) return false;
  return true;
}

function parsePayload(raw: string): Json {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Json : {};
  } catch {
    return {};
  }
}

function mailOccurredMs(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mailHistoryKey(row: Json): string {
  return [
    String(row.conversation_id || ""),
    String(row.provider_message_id || ""),
    String(row.occurred_at || ""),
    String(row.subject || ""),
    String(row.direction || ""),
  ].join("|");
}

export function mailHistoryRows(collaborationId: string): Json[] {
  if (!collaborationId) return [];
  const session = getConn().prepare(
    "SELECT id FROM sessions WHERE collaboration_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1",
  ).get(collaborationId) as { id: string } | undefined;
  const fromCards: Json[] = [];
  if (session?.id) {
    const cards = getConn().prepare(
      "SELECT id, payload, created_at FROM messages WHERE session_id=? AND kind='kol_mail_card'",
    ).all(session.id) as { id: string; payload: string; created_at: string }[];
    for (const card of cards) {
      const payload = parsePayload(card.payload);
      const inbound = String(payload.direction || "inbound") !== "outbound";
      const body = String(payload.body || payload.snippet || "").trim();
      const row = {
        id: card.id,
        conversation_id: String(payload.conversation_id || ""),
        provider_message_id: String(payload.provider_message_id || ""),
        subject: String(payload.subject || "").trim() || "无主题",
        direction: inbound ? "inbound" : "outbound",
        body,
        snippet: String(payload.snippet || payload.body || "").slice(0, 160),
        unread: inbound,
        occurred_at: String(payload.occurred_at || card.created_at || ""),
        summary: String(payload.summary || ""),
        summary_zh: String(payload.summary_zh || ""),
        summary_source: String(payload.summary_source || ""),
      };
      fromCards.push({ ...row, summary: mailSummaryOf(row) });
    }
  }
  const source = fromCards.length
    ? fromCards
    : itemsForCollaboration(collaborationId).map((item) => {
      const body = String(item.body || item.snippet || "").trim();
      const row = {
        id: String(item.id || ""),
        conversation_id: String(item.conversation_id || ""),
        provider_message_id: String(item.provider_message_id || ""),
        subject: String(item.subject || "").trim() || "无主题",
        direction: String(item.direction || "inbound") === "outbound" ? "outbound" : "inbound",
        body,
        snippet: String(item.snippet || ""),
        unread: Boolean(Number(item.unread || 0)),
        occurred_at: String(item.occurred_at || item.created_at || ""),
        summary: String(item.summary || ""),
        summary_zh: String(item.summary_zh || ""),
        summary_source: String(item.summary_source || ""),
      };
      return { ...row, summary: mailSummaryOf(row) };
    });
  const seen = new Set<string>();
  return source
    .filter((row) => {
      const key = mailHistoryKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => mailOccurredMs(right.occurred_at) - mailOccurredMs(left.occurred_at));
}

function writeCardSummary(cardId: string, summary: string, source: string): void {
  const row = getConn().prepare("SELECT payload FROM messages WHERE id=?").get(cardId) as { payload: string } | undefined;
  if (!row) return;
  const payload = parsePayload(row.payload);
  if (String(payload.summary_zh || payload.summary || "").trim() === summary
    && String(payload.summary_source || "") === source) return;
  payload.summary_zh = summary;
  payload.summary = summary;
  payload.summary_source = source;
  tx((db) => {
    db.prepare("UPDATE messages SET payload=? WHERE id=?").run(JSON.stringify(payload), cardId);
  });
}

function persistCard(row: Json, summary: string, source: string): void {
  row.summary = summary;
  row.summary_zh = summary;
  row.summary_source = source;
  if (row.id && String(row.id).startsWith("msg")) writeCardSummary(String(row.id), summary, source);
}

function listedMailBodies(rows: Json[]): string {
  return rows.map((row, index) => (
    `${index + 1}. id=${row.id || index} ${String(row.direction) === "outbound" ? "去信" : "来信"} 主题:${row.subject || "无主题"}\n${String(row.body || row.snippet || "")}`
  )).join("\n\n");
}

function mailAnalysisPrompt(rows: Json[]): string {
  return [
    "你是灵工 Codex 记忆。根据每封往来正文写一句中文分析：意图、事实、是否有兴趣/报价/寒暄。",
    "每封信必须根据该封正文写，两封不同正文不能写成同一句。",
    "不要复述开头问候，不要截断原文当摘要，不编造邮箱，不改阶段。",
    "返回 JSON {\"summaries\":[\"...\"]}，顺序与输入一致。",
    "",
    listedMailBodies(rows),
  ].join("\n");
}

function threadDigestPrompt(rows: Json[]): string {
  return [
    "你是灵工 Codex 记忆。阅读该会话全部往来正文，写成一段中文摘要。",
    "写清来去信顺序、是否有兴趣/报价/档期、目前卡在哪。合成一段话，不要分条列表。",
    "不要复述开头问候，不要截断原文当摘要，不编造邮箱，不改阶段。",
    "返回 JSON {\"digest\":\"...\"}。",
    "",
    listedMailBodies(rows),
  ].join("\n");
}

function parseDigest(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { digest?: unknown; summaries?: unknown };
      const digest = String(parsed.digest || "").trim();
      if (digest) return digest;
      if (Array.isArray(parsed.summaries)) {
        const joined = parsed.summaries.map((item) => String(item || "").trim()).filter(Boolean).join("");
        if (joined) return joined;
      }
    } catch {
      /* fall through */
    }
  }
  const cleaned = text.replace(/```(?:json)?|```/g, "").trim();
  return cleaned && !cleaned.startsWith("{") ? cleaned : null;
}

function parseSummaries(text: string, expected: number): string[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { summaries?: unknown };
      const summaries = Array.isArray(parsed.summaries)
        ? parsed.summaries.map((item) => String(item || "").trim())
        : [];
      if (summaries.some(Boolean)) {
        while (summaries.length < expected) summaries.push("");
        return summaries.slice(0, expected);
      }
    } catch {
      /* fall through */
    }
  }
  const numbered = [...text.matchAll(/^\s*\d+[\.\)、]\s*(.+)$/gm)].map((m) => m[1].trim());
  if (numbered.filter(Boolean).length) {
    while (numbered.length < expected) numbered.push("");
    return numbered.slice(0, expected);
  }
  return null;
}

const summarySchema = {
  type: "object",
  properties: {
    summaries: { type: "array", items: { type: "string" } },
  },
  required: ["summaries"],
  additionalProperties: false,
};

const digestSchema = {
  type: "object",
  properties: {
    digest: { type: "string" },
  },
  required: ["digest"],
  additionalProperties: false,
};

function redactMailLog(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer ***")
    .replace(/\bOPENAI_API_KEY\s*=\s*\S+/gi, "OPENAI_API_KEY=***");
}

function classifyMailDigestError(err: unknown, fallback = "unavailable"): string {
  if (typeof err === "string" && /^(timeout|no-key|greeting_reject|parse|HTTP \d+)$/.test(err)) return err;
  const name = err instanceof Error ? err.name : "";
  const text = err instanceof Error ? err.message : String(err || fallback);
  if (name === "AbortError" || /aborted|timeout/i.test(text)) return "timeout";
  const http = text.match(/\bHTTP\s+(\d{3})\b/i);
  if (http) return `HTTP ${http[1]}`;
  if (/\bno[-_ ]?key\b|\bapi key\b/i.test(text)) return "no-key";
  const cleaned = redactMailLog(text).replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 160) || fallback;
}

function noteFailure(where: string, err: unknown, collaborationId = ""): void {
  const text = classifyMailDigestError(err);
  const col = collaborationId ? ` col=${collaborationId}` : "";
  process.stderr.write(`[mail-summary]${col} ${where}: ${text}\n`);
}

type RemoteDigestAttempt = {
  text?: string;
  error?: string;
};

type RemoteDigestResult = {
  text?: string;
  source?: "codex_memory" | "luna";
  error?: string;
  attempted: string[];
};

async function summarizeWithCodexAppServer(rows: Json[]): Promise<string[] | null> {
  let cwd = "";
  let rpc: CodexAppServer | null = null;
  try {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mail-memory-"));
    rpc = new CodexAppServer(mailAnalysisTimeout());
    await rpc.handshake();
    await rpc.requireAuth();
    const started = await rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
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
      input: [{ type: "text", text: mailAnalysisPrompt(rows) }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      summary: "concise",
      effort: "low",
      outputSchema: summarySchema,
    });
    const completed = await rpc.waitTurn(mailAnalysisTimeout());
    const extras = completed.turn && typeof completed.turn === "object"
      ? JSON.stringify((completed.turn as { output?: unknown }).output || {})
      : "";
    const parsed = parseSummaries([...rpc.agentTexts, extras].join("\n"), rows.length);
    if (!parsed) noteFailure("codex parse", "no summaries in app-server output");
    return parsed;
  } catch (err) {
    noteFailure("codex app-server", err);
    return null;
  } finally {
    rpc?.close();
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function summarizeWithLuna(rows: Json[]): Promise<string[] | null> {
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
        instructions: "你是灵工 Codex 记忆。根据往来正文各写一句中文分析。不要复述问候，不编造邮箱，不改阶段。",
        input: mailAnalysisPrompt(rows),
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "mail_summaries",
            strict: false,
            schema: summarySchema,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      noteFailure("luna", `HTTP ${response.status}`);
      return null;
    }
    const parsed = parseSummaries(extractRemoteIntentText(await response.json()), rows.length);
    if (!parsed) noteFailure("luna parse", "no summaries in response");
    return parsed;
  } catch (err) {
    noteFailure("luna", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type RemoteBatch = { texts: string[]; source: "codex_memory" | "luna" };

function usableRemoteText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || isGreetingDump(trimmed) || isRuleGreetingFallback(trimmed)) return "";
  return trimmed;
}

async function summarizeWithCodex(rows: Json[]): Promise<RemoteBatch | null> {
  if (!remoteMailAnalysisEnabled()) return null;
  if (intentLlmFetchOverridden()) {
    const luna = await summarizeWithLuna(rows);
    return luna ? { texts: luna, source: "luna" } : null;
  }
  const fromCodex = await summarizeWithCodexAppServer(rows);
  if (fromCodex) return { texts: fromCodex, source: "codex_memory" };
  const fromLuna = await summarizeWithLuna(rows);
  if (fromLuna) return { texts: fromLuna, source: "luna" };
  return null;
}

async function digestWithLuna(rows: Json[], collaborationId = ""): Promise<RemoteDigestAttempt> {
  const key = intentLlmApiKey();
  if (!key) {
    noteFailure("luna digest", "no-key", collaborationId);
    return { error: "no-key" };
  }
  // Luna gpt-5.6-luna is not on public api.openai.com. Without OPENAI_BASE_URL,
  // a public sk-proj key hits api.openai.com and returns HTTP 401.
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
        instructions: "你是灵工 Codex 记忆。把全部往来正文写成一段中文摘要。不要复述问候，不编造邮箱，不改阶段。",
        input: threadDigestPrompt(rows),
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "mail_digest",
            strict: false,
            schema: digestSchema,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = `HTTP ${response.status}`;
      noteFailure("luna digest", error, collaborationId);
      return { error };
    }
    const parsed = parseDigest(extractRemoteIntentText(await response.json()));
    if (!parsed) {
      noteFailure("luna digest parse", "parse", collaborationId);
      return { error: "parse" };
    }
    return { text: parsed };
  } catch (err) {
    const error = classifyMailDigestError(err);
    noteFailure("luna digest", error, collaborationId);
    return { error };
  } finally {
    clearTimeout(timer);
  }
}

async function digestWithCodexAppServer(rows: Json[], collaborationId = ""): Promise<RemoteDigestAttempt> {
  let cwd = "";
  let rpc: CodexAppServer | null = null;
  try {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mail-digest-"));
    rpc = new CodexAppServer(mailAnalysisTimeout());
    await rpc.handshake();
    await rpc.requireAuth();
    const started = await rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: codexRecognizeThreadConfig(),
    });
    const thread = (started.thread as { id?: string } | undefined) || started;
    const threadId = String((thread as { id?: string }).id || "");
    if (!threadId) {
      noteFailure("codex digest thread/start", "missing thread id", collaborationId);
      return { error: "missing_thread" };
    }
    await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: threadDigestPrompt(rows) }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      summary: "concise",
      effort: "low",
      outputSchema: digestSchema,
    });
    const completed = await rpc.waitTurn(mailAnalysisTimeout());
    const extras = completed.turn && typeof completed.turn === "object"
      ? JSON.stringify((completed.turn as { output?: unknown }).output || {})
      : "";
    const parsed = parseDigest([...rpc.agentTexts, extras].join("\n"));
    if (!parsed) {
      noteFailure("codex digest parse", "parse", collaborationId);
      return { error: "parse" };
    }
    return { text: parsed };
  } catch (err) {
    const error = classifyMailDigestError(err);
    noteFailure("codex digest", error, collaborationId);
    return { error };
  } finally {
    rpc?.close();
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function digestWithRemote(rows: Json[], collaborationId = ""): Promise<RemoteDigestResult> {
  if (!remoteMailAnalysisEnabled()) return { error: "disabled", attempted: [] };
  if (intentLlmFetchOverridden()) {
    const luna = await digestWithLuna(rows, collaborationId);
    return luna.text
      ? { text: luna.text, source: "luna", attempted: ["luna"] }
      : { error: luna.error || "unavailable", attempted: ["luna"] };
  }
  const attempted: string[] = [];
  const fromCodex = await digestWithCodexAppServer(rows, collaborationId);
  attempted.push("codex_memory");
  if (fromCodex.text) return { text: fromCodex.text, source: "codex_memory", attempted };
  const fromLuna = await digestWithLuna(rows, collaborationId);
  attempted.push("luna");
  if (fromLuna.text) return { text: fromLuna.text, source: "luna", attempted };
  return { error: fromLuna.error || fromCodex.error || "unavailable", attempted };
}

export async function ensureCodexThreadDigest(
  collaborationId: string,
  rows?: Json[],
  opts?: { retryFailed?: boolean },
): Promise<ThreadDigest> {
  const listed = rows?.length ? rows : mailHistoryRows(collaborationId);
  const stored = readThreadDigest(collaborationId);
  if (!needsRemoteThreadDigest(listed, stored, opts)) {
    return threadDigestOf(listed, stored);
  }
  const remote = await digestWithRemote(listed, collaborationId);
  const fingerprint = threadFingerprint(listed);
  const remoteText = remote.text ? usableRemoteText(remote.text) : "";
  const digest: ThreadDigest = remoteText && remote.source
    ? {
      text: remoteText,
      source: remote.source,
      mail_count: listed.filter((row) => String(row.body || row.snippet || "").trim()).length,
      fingerprint,
    }
    : {
      text: analyzeThreadDigest(listed),
      source: "analysis_failed",
      mail_count: listed.filter((row) => String(row.body || row.snippet || "").trim()).length,
      fingerprint,
      error: remoteText ? undefined : (remote.text ? "greeting_reject" : (remote.error || "unavailable")),
      attempted: remote.attempted,
      failed_at: nowIso(),
    };
  if (digest.source === "analysis_failed") {
    noteFailure("analysis_failed", digest.error || "unavailable", collaborationId);
  }
  writeThreadDigest(collaborationId, digest);
  return digest;
}

export async function ensureCodexMailSummaries(
  collaborationId: string,
  rows?: Json[],
  opts?: { retryFailed?: boolean },
): Promise<Json[]> {
  const listed = rows?.length ? rows : mailHistoryRows(collaborationId);
  const digest = await ensureCodexThreadDigest(collaborationId, listed, opts);
  return listed.map((row) => ({
    ...row,
    summary: digest.text || mailSummaryOf(row),
    summary_source: digest.source || "body_analysis",
  }));
}

export function summarizeMailHistorySync(rows: Json[]): Json[] {
  return rows.map((row) => {
    const summary = mailSummaryOf(row);
    const source = String(row.summary_source || "body_analysis");
    return {
      ...row,
      summary,
      summary_source: REMOTE_SOURCES.has(source) ? source : "body_analysis",
    };
  });
}

export function mailMemoryLines(rows: Json[]): string[] {
  return rows.slice(0, 8).map((row) => {
    const dir = String(row.direction) === "outbound" ? "去信" : "来信";
    const summary = mailSummaryOf(row);
    return summary
      ? `${dir} · ${row.subject || "无主题"}：${summary}`
      : `${dir} · ${row.subject || "无主题"}`;
  });
}
