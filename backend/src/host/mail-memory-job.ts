/**
 * Mail memory increment job: zero-model read path.
 * Triggered by sync completion and by the `mail_memory_increment` cron job.
 * Scans local mail items/threads, fills missing/outdated translations,
 * per-message summaries and conversation/person digests, and writes back
 * memory columns only. Never sends mail, never writes formal stage.
 */
import crypto from "node:crypto";
import * as postgresPoolModule from "../postgres/pool.js";
import { safeEmployeeId } from "./starry-bind.js";
import {
  createNativeMemoryRun,
  findNativeMailItem,
  findNativeMailThread,
  finishNativeMemoryRun,
  listNativeConversationItems,
  listNativeMemoryItems,
  listNativeMemoryThreads,
  listNativePersonItems,
  listNativePersonKeys,
  listNativeThreadItems,
  mailBodyFingerprint,
  markNativeMailMemoryPending,
  readNativeOnDemandMemory,
  readNativePersonMemory,
  writeNativeItemMemoryIfFresh,
  writeNativeMailMemoryAudit,
  writeNativeOnDemandMemory,
  writeNativePersonMemory,
  writeNativeThreadDigest,
  type NativeOnDemandMemory,
} from "../postgres/mail-memory-repository.js";
import type { Json, Row } from "../types.js";
import {
  analyzeMailBody,
  generateMailConversationDigest,
  remoteMailAnalysisEnabled,
  summarizeWithCodexAppServer,
  threadDigestOf,
  type ThreadDigest,
} from "./mail-summary.js";
import { translateMailBodyZh, translateMailBodyZhWithCodexLuna } from "../starrykol/translate-zh.js";

export type MailMemoryStats = {
  scanned: number;
  translated: number;
  summarized: number;
  digested: number;
  persons: number;
  errors: number;
  error?: string;
};

const inflight = new Map<string, Promise<MailMemoryStats>>();

type OnDemandMemory = NativeOnDemandMemory;
const nowIso = (): string => new Date().toISOString();

async function onDemandActorId(): Promise<Awaited<string>> {
  const actorId = String((await safeEmployeeId()) || "").trim();
  if (!actorId) throw new Error("mail_memory_actor_required");
  return actorId;
}

function onDemandKey(kind: "summary" | "translation", mailbox: string, conversationId: string, messageId = ""): string {
  return `mail_${kind}_memory:${mailbox}:${conversationId}:${messageId}`;
}

export async function readOnDemandMemory(key: string): Promise<OnDemandMemory | null> {
  return readNativeOnDemandMemory((await onDemandActorId()), key);
}

export async function writeOnDemandMemory(key: string, value: OnDemandMemory): Promise<void> {
  await writeNativeOnDemandMemory((await onDemandActorId()), key, value);
}

function onDemandFingerprint(rows: Row[]): string {
  return crypto.createHash("sha256").update(rows.map((row) => [row.id, row.occurred_at, row.body_text].join("\n")).join("\n---\n")).digest("hex").slice(0, 32);
}

function mailBodyOf(row: Row): string {
  const direct = [row.body_text, row.body, row.text, row.content, row.snippet]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .find(Boolean);
  if (direct) return direct;
  const html = typeof row.body_html === "string" ? row.body_html : "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function bodyFingerprint(body: string): string {
  return mailBodyFingerprint(body);
}

function isRemoteSummary(source: string): boolean {
  return ["codex_memory", "luna", "openai", "starry_mcp"].includes(String(source || ""));
}

function isRemoteDigest(source: string): boolean {
  return ["codex_memory", "luna"].includes(String(source || ""));
}

function itemTranslationNeeded(row: Row): boolean {
  const body = String(row.body_text || "").trim();
  if (!body) return false;
  const hasTranslation = Boolean(String(row.translation_zh || "").trim());
  const fp = bodyFingerprint(body);
  return !hasTranslation || String(row.memory_fingerprint || "") !== fp;
}

function itemSummaryNeeded(row: Row): boolean {
  const body = String(row.body_text || "").trim();
  if (!body) return false;
  const hasSummary = Boolean(String(row.summary || row.summary_zh || "").trim())
    && isRemoteSummary(String(row.summary_source || ""));
  const fp = bodyFingerprint(body);
  return !hasSummary || String(row.memory_fingerprint || "") !== fp;
}

function threadFingerprint(rows: Row[]): string {
  // Content fingerprints, not body lengths: a same-length correction must invalidate the digest.
  return crypto.createHash("sha256").update(rows.map((row) => [
    String(row.id || ""),
    String(row.occurred_at || ""),
    mailBodyFingerprint(row.body_text || row.body || row.snippet || ""),
  ].join(":")).join("|")).digest("hex");
}

function personDigestKey(mailbox: string, peerEmail: string): string {
  return `mail_person_digest:${mailbox}:${peerEmail}`;
}

export async function readPersonDigest(mailbox: string, peerEmail: string): Promise<ThreadDigest | null> {
  const row = await readNativePersonMemory(mailbox, peerEmail);
  if (!row) return null;
  return {
    text: String(row.digest_text || ""),
    source: String(row.digest_source || ""),
    mail_count: Number(row.mail_count || 0),
    fingerprint: String(row.digest_fingerprint || ""),
    ...(row.generated_at ? { generated_at: String(row.generated_at) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
  };
}

async function digestWithRemote(rows: Row[]): Promise<{ text?: string; source?: string; error?: string }> {
  if (!remoteMailAnalysisEnabled() || !rows.length) return { error: "disabled" };
  // Reuse the single-message summarizer for a block of bodies: it returns one
  // summary per row. For a conversation/person digest we synthesize from them.
  const summaries = await summarizeWithCodexAppServer(rows);
  if (summaries && summaries.some(Boolean)) {
    const text = summaries.filter(Boolean).join("；");
    return { text, source: "codex_memory" };
  }
  return { error: "unavailable" };
}

async function ensureItemMemory(row: Row): Promise<{ translated: boolean; summarized: boolean; error: boolean }> {
  const body = String(row.body_text || "").trim();
  const fp = bodyFingerprint(body);
  const needTranslation = itemTranslationNeeded(row);
  const needSummary = itemSummaryNeeded(row);
  let translated = false;
  let summarized = false;
  let error = false;
  const updates: { fingerprint: string; generated_at: string; attempts: number; translation_zh?: string; translation_source?: string; summary?: string; summary_zh?: string; summary_source?: string; source?: string; error?: string } = {
    fingerprint: fp,
    generated_at: nowIso(),
    attempts: Number(row.memory_attempts || 0) + 1,
  };

  if (needTranslation) {
    try {
      const result = await translateMailBodyZh(body);
      if (result) {
        updates.translation_zh = result.text;
        updates.translation_source = result.source;
        translated = true;
      } else {
        updates.translation_source = "pending";
        error = true;
      }
    } catch (err) {
      updates.translation_source = "pending";
      updates.error = err instanceof Error ? err.message : String(err);
      error = true;
    }
  }

  if (needSummary) {
    try {
      const summaries = await summarizeWithCodexAppServer([{
        id: row.id,
        body,
        subject: row.subject,
        direction: row.direction,
      }]);
      const text = summaries?.[0]?.trim();
      if (text) {
        updates.summary = text;
        updates.summary_zh = text;
        updates.summary_source = "codex_memory";
        summarized = true;
      } else {
        const fallback = analyzeMailBody({ body, direction: row.direction });
        updates.summary = fallback;
        updates.summary_zh = fallback;
        updates.summary_source = "body_analysis";
        error = true;
      }
    } catch (err) {
      const fallback = analyzeMailBody({ body, direction: row.direction });
      updates.summary = fallback;
      updates.summary_zh = fallback;
      updates.summary_source = "body_analysis";
      updates.error = err instanceof Error ? err.message : String(err);
      error = true;
    }
  }

  if (error && !translated && !summarized) {
    updates.source = "analysis_failed";
  } else if (needTranslation || needSummary) {
    updates.source = translated || summarized ? "codex_memory" : String(row.memory_source || "");
  }

  await writeNativeItemMemoryIfFresh({ itemId: String(row.id), body, translationZh: updates.translation_zh, translationSource: updates.translation_source, summary: updates.summary, summaryZh: updates.summary_zh, summarySource: updates.summary_source, source: updates.source, error: updates.error || null });
  return { translated, summarized, error };
}

async function ensureItemTranslation(row: Row): Promise<{ translated: boolean; error: boolean }> {
  const body = String(row.body_text || "").trim();
  if (!body) return { translated: false, error: true };
  const updates: { fingerprint: string; generated_at: string; attempts: number; translation_zh?: string; translation_source?: string; summary?: string; summary_zh?: string; summary_source?: string; source?: string; error?: string } = {
    fingerprint: bodyFingerprint(body),
    generated_at: nowIso(),
    attempts: Number(row.memory_attempts || 0) + 1,
  };
  try {
    const result = await translateMailBodyZh(body);
    if (!result) {
      updates.translation_source = "pending";
      updates.source = "analysis_failed";
      await writeNativeItemMemoryIfFresh({ itemId: String(row.id), body, translationSource: updates.translation_source, source: updates.source, error: updates.error || null });
      return { translated: false, error: true };
    }
    updates.translation_zh = result.text;
    updates.translation_source = result.source;
    updates.source = result.source;
    await writeNativeItemMemoryIfFresh({ itemId: String(row.id), body, translationZh: updates.translation_zh, translationSource: updates.translation_source, source: updates.source, error: updates.error || null });
    return { translated: true, error: false };
  } catch (err) {
    updates.translation_source = "pending";
    updates.source = "analysis_failed";
    updates.error = err instanceof Error ? err.message : String(err);
    await writeNativeItemMemoryIfFresh({ itemId: String(row.id), body, translationZh: updates.translation_zh, translationSource: updates.translation_source, source: updates.source, error: updates.error || null });
    return { translated: false, error: true };
  }
}

async function ensureThreadDigest(thread: Row): Promise<boolean> {
  const conversationId = String(thread.conversation_id || "");
  const mailbox = String(thread.mailbox || "");
  if (!conversationId) return false;
  const items = (await listNativeThreadItems(String(thread.id))).map((item) => ({
    ...item,
    body: String(item.body_text || item.body || item.snippet || ""),
    snippet: String(item.snippet || item.body_text || ""),
  }));
  if (!items.some((item) => String(item.body || "").trim())) return false;
  const stored: ThreadDigest = {
    text: String(thread.digest_text || ""),
    source: String(thread.digest_source || ""),
    mail_count: Number(thread.digest_mail_count || 0),
    fingerprint: String(thread.digest_fingerprint || ""),
    ...(thread.digest_error ? { error: String(thread.digest_error) } : {}),
    ...(thread.digest_failed_at ? { failed_at: String(thread.digest_failed_at) } : {}),
  };
  const fingerprint = threadFingerprint(items);
  const trusted = stored.fingerprint === fingerprint && isRemoteDigest(stored.source) ? stored.text : "";
  if (trusted) return false;
  const remote = await digestWithRemote(items);
  const digest: ThreadDigest = remote.text
    ? {
      text: remote.text,
      source: remote.source || "codex_memory",
      mail_count: items.filter((item) => String(item.body || "").trim()).length,
      fingerprint,
    }
    : {
      text: threadDigestOf(items, stored).text,
      source: "analysis_failed",
      mail_count: items.filter((item) => String(item.body || "").trim()).length,
      fingerprint,
      error: remote.error || "unavailable",
      failed_at: nowIso(),
    };
  await writeNativeThreadDigest(String(thread.id), { text: digest.text, source: digest.source, fingerprint: digest.fingerprint, error: digest.error, failedAt: digest.failed_at, mailCount: digest.mail_count });
  return remote.text ? true : false;
}

async function ensurePersonDigest(mailbox: string, peerEmail: string): Promise<boolean> {
  const items = await listNativePersonItems(mailbox, peerEmail);
  const bodies = items.map((item) => ({ ...item, body: String(item.body_text || "").trim() })).filter((item) => item.body);
  if (!bodies.length) return false;
  const storedRow = await readNativePersonMemory(mailbox, peerEmail);
  const stored: ThreadDigest | null = storedRow ? { text: String(storedRow.digest_text || ""), source: String(storedRow.digest_source || ""), mail_count: Number(storedRow.mail_count || 0), fingerprint: String(storedRow.digest_fingerprint || ""), ...(storedRow.error ? { error: String(storedRow.error) } : {}), ...(storedRow.generated_at ? { generated_at: String(storedRow.generated_at) } : {}) } : null;
  const fingerprint = threadFingerprint(bodies);
  if (stored && stored.fingerprint === fingerprint && isRemoteDigest(stored.source)) return false;
  const remote = await digestWithRemote(bodies);
  const digest: ThreadDigest = remote.text
    ? { text: remote.text, source: remote.source || "codex_memory", mail_count: bodies.length, fingerprint, generated_at: nowIso() }
    : { text: threadDigestOf(bodies, stored).text, source: "analysis_failed", mail_count: bodies.length, fingerprint, generated_at: nowIso(), error: remote.error || "unavailable", failed_at: nowIso() };
  await writeNativePersonMemory({ id: `pmm_${Buffer.from(`${mailbox}:${peerEmail}`).toString("base64url")}`, mailbox, peerEmail, text: digest.text, source: digest.source, fingerprint: digest.fingerprint, mailCount: digest.mail_count, generatedAt: digest.generated_at, error: digest.error || null });
  return remote.text ? true : false;
}
export async function markPendingMailMemory(mailbox?: string): Promise<void> {
  if (!remoteMailAnalysisEnabled()) return;
  await markNativeMailMemoryPending(mailbox);
}

export async function runMailMemoryIncrement(mailbox?: string): Promise<MailMemoryStats> {
  const stats: MailMemoryStats = { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 0 };
  if (!remoteMailAnalysisEnabled()) return stats;
  const runId = await createNativeMemoryRun(mailbox || "*");
  try {
    const items = await listNativeMemoryItems({ mailbox, limit: 5000 });
    for (const row of items) { stats.scanned += 1; const result = await ensureItemMemory(row); if (result.translated) stats.translated += 1; if (result.summarized) stats.summarized += 1; if (result.error) stats.errors += 1; }
    const threads = await listNativeMemoryThreads(mailbox);
    for (const thread of threads) { try { if (await ensureThreadDigest(thread)) stats.digested += 1; } catch (err) { stats.errors += 1; await writeNativeMailMemoryAudit("mail_memory.thread_digest_failed", { thread_id: thread.id, error: err instanceof Error ? err.message : String(err) }); } }
    const peers = await listNativePersonKeys(mailbox);
    for (const peer of peers) { try { if (await ensurePersonDigest(peer.mailbox, peer.peer_email)) stats.persons += 1; } catch (err) { stats.errors += 1; await writeNativeMailMemoryAudit("mail_memory.person_digest_failed", { mailbox: peer.mailbox, peer_email: peer.peer_email, error: err instanceof Error ? err.message : String(err) }); } }
    await finishNativeMemoryRun(runId, { ...stats, status: stats.errors ? "failed" : "succeeded" });
  } catch (err) {
    stats.errors += 1; stats.error = err instanceof Error ? err.message : String(err);
    await finishNativeMemoryRun(runId, { ...stats, status: "failed", error: stats.error });
    throw err;
  }
  await writeNativeMailMemoryAudit("mail_memory.increment", { mailbox: mailbox || "*", repository: "postgresql_native", ...stats });
  return stats;
}
export async function triggerMailMemoryIncrement(mailbox?: string): Promise<Awaited<void>> {
  const key = mailbox || "*";
  if (inflight.has(key)) return;
  const promise = (runMailMemoryIncrement(mailbox)
    .catch(async (err) => {
      // This is detached background work. A second database failure while
      // reporting the first must not reject an unobserved promise or stop the
      // API process. Use the asynchronous pool so audit waits do not freeze
      // employee requests on the synchronous connection.
      try {
        await postgresPoolModule.postgresQuery(
          "INSERT INTO audit_events (ts,actor,event_type,payload) VALUES ($1,$2,$3,$4)",
          [nowIso(), "host", "mail_memory.increment_failed", JSON.stringify({
            mailbox: mailbox || "*",
            error: err instanceof Error ? err.message : String(err),
          })],
        );
      } catch {
        console.error("[mail-memory] increment failed; failure audit unavailable");
      }
      return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1 };
    })
    .finally(() => inflight.delete(key)));
  inflight.set(key, promise);
}

/** Execute the employee-facing mail_summary Skill for one selected conversation. */
export async function triggerMailSummarySkill(mailbox: string, conversationId: string): Promise<MailMemoryStats> {
  const key = `skill:mail_summary:${mailbox}:${conversationId}`;
  const existing = (await inflight.get(key));
  if (existing) return existing;
  const promise = ((async (): Promise<MailMemoryStats> => {
    const thread = await findNativeMailThread(mailbox, conversationId);
    if (!thread) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "未找到对应的邮件主题或会话已失效" };
    const items = await listNativeConversationItems(conversationId, mailbox);
    const rows = items.map((item): Row => ({ ...item, body_text: mailBodyOf(item) })).filter((item) => item.body_text);
    if (!rows.length) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "选中的邮件主题没有可用正文（已检查 body_text、body、text、content、snippet 和 body_html）" };
    const fingerprint = onDemandFingerprint(rows);
    const memoryKey = onDemandKey("summary", mailbox, conversationId);
    const previous = await readOnDemandMemory(memoryKey);
    if (previous?.status === "已完成" && previous.fingerprint === fingerprint) {
      return { scanned: rows.length, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 0 };
    }
    const result = await generateMailConversationDigest(rows.map((row) => ({
      ...row,
      body: row.body_text || "",
      existing_digest: previous?.text || "",
    })));
    const text = String(result.text || "").trim();
    if (!text) throw new Error(`Codex/Luna 摘要链路未返回结果：${result.error || "unavailable"}`);
    const completedAt = nowIso();
    await writeNativeThreadDigest(String(thread.id), {
      text, source: result.source || "codex_memory", mailCount: rows.length, fingerprint,
    });
    await writeOnDemandMemory(memoryKey, {
      status: "已完成", mailbox, subject: String(thread.subject || ""), conversation_id: conversationId,
      text, fingerprint, completed_at: completedAt,
    });
    return { scanned: rows.length, translated: 0, summarized: 1, digested: 1, persons: 0, errors: 0 };
  })()
    .catch(async (err) => {
      const thread = await findNativeMailThread(mailbox, conversationId);
      await writeOnDemandMemory(onDemandKey("summary", mailbox, conversationId), {
        status: "未开始", mailbox, subject: String(thread?.subject || ""), conversation_id: conversationId,
        text: "", fingerprint: "", error: err instanceof Error ? err.message : String(err),
      });
      await writeNativeMailMemoryAudit("mail_skill.summary_failed", { mailbox, conversation_id: conversationId, error: err instanceof Error ? err.message : String(err) });
      return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: err instanceof Error ? err.message : String(err) };
    })
    .finally(() => inflight.delete(key)));
  inflight.set(key, promise);
  return promise;
}

/** Execute the employee-facing mail_translate Skill for one selected message. */
export async function triggerMailTranslateSkill(mailbox: string, messageId: string): Promise<MailMemoryStats> {
  const key = `skill:mail_translate:${mailbox}:${messageId}`;
  const existing = (await inflight.get(key));
  if (existing) return existing;
  const promise = ((async (): Promise<MailMemoryStats> => {
    const row = await findNativeMailItem(mailbox, messageId);
    const body = row ? mailBodyOf(row) : "";
    if (!row) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "未找到选中的邮件，可能是邮件 ID 已变化" };
    if (!body) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "选中的邮件没有可用正文（已检查 body_text、body、text、content、snippet 和 body_html）" };
    const thread = row.thread_id ? await findNativeMailThread(mailbox, String(row.thread_id)) : undefined;
    const conversationId = String(row.conversation_id || thread?.conversation_id || "");
    const memoryKey = onDemandKey("translation", mailbox, conversationId, String(row.id));
    const fingerprint = bodyFingerprint(body);
    const previous = await readOnDemandMemory(memoryKey);
    if (previous?.status === "已完成" && previous.fingerprint === fingerprint) {
      return { scanned: 1, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 0 };
    }
    const result = await translateMailBodyZhWithCodexLuna(body);
    const text = String(result?.text || "").trim();
    if (!text) throw new Error("Codex/Luna 翻译链路未返回可用译文");
    const completedAt = nowIso();
    await writeNativeItemMemoryIfFresh({ itemId: String(row.id), body, translationZh: text, translationSource: result?.source || "codex_memory", source: result?.source || "codex_memory" });
    await writeOnDemandMemory(memoryKey, {
      status: "已完成", mailbox, subject: String(row.subject || thread?.subject || ""),
      conversation_id: conversationId, message_id: String(row.id), text, fingerprint, completed_at: completedAt,
    });
    return { scanned: 1, translated: 1, summarized: 0, digested: 0, persons: 0, errors: 0 };
  })()
    .catch(async (err) => {
      const row = await findNativeMailItem(mailbox, messageId);
      await writeOnDemandMemory(onDemandKey("translation", mailbox, String(row?.conversation_id || ""), String(row?.id || messageId)), {
        status: "未开始", mailbox, subject: String(row?.subject || ""), conversation_id: String(row?.conversation_id || ""),
        message_id: String(row?.id || messageId), text: "", fingerprint: "", error: err instanceof Error ? err.message : String(err),
      });
      await writeNativeMailMemoryAudit("mail_skill.translate_failed", { mailbox, message_id: messageId, error: err instanceof Error ? err.message : String(err) });
      return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: err instanceof Error ? err.message : String(err) };
    })
    .finally(() => inflight.delete(key)));
  inflight.set(key, promise);
  return promise;
}

export function pendingMailMemoryIncrement(mailbox?: string): boolean {
  return inflight.has(mailbox || "*");
}

/** Detached mail-memory work never rejects outward, but test and process
 * shutdown paths still need a deterministic point at which it has settled. */
export async function waitForMailMemoryBackground(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight.values()]);
}
