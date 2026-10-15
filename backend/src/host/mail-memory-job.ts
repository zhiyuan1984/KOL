/**
 * Mail memory increment job: source-backed local-memory enrichment only.
 * The cron path never sends mail or updates a formal stage. Model calls happen
 * outside database transactions; each accepted source-version write and its
 * durable run checkpoint commit on the same PostgreSQL transaction client.
 */
import * as postgresPoolModule from "../postgres/pool.js";
import { postgresTransaction } from "../postgres/pool.js";
import { safeEmployeeId } from "./starry-bind.js";
import { acquireMailMemoryIncrementLock } from "./mail-memory-run-lock.js";
import {
  checkpointNativeMemoryRun,
  createNativeMemoryRun,
  findNativeMailItem,
  findNativeMailThread,
  finishNativeMemoryRun,
  finishNativeMemoryRunWithAudit,
  listNativeConversationItems,
  listNativeMemoryItems,
  listNativeMemoryThreads,
  listNativePersonItems,
  listNativePersonKeys,
  listNativeThreadItems,
  mailBodyFingerprint,
  mailMemorySourceFingerprint,
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
  /** 已创建的 PostgreSQL 原生运行；锁竞争在创建前返回，故保持 undefined。 */
  native_run_id?: string;
  /** Any accepted local-memory/attempt write, including body_analysis or pending state. */
  persisted?: number;
  body_analyzed?: number;
  source_changed?: number;
  skipped?: number;
  provider_failed?: boolean;
  completion_scope?: "bounded_increment_batch" | "budget_exhausted" | "provider_failed" | "skipped_lock_contended";
  remaining_work?: boolean | "unknown";
  budget_exhausted?: boolean;
  error?: string;
};

const inflight = new Map<string, Promise<MailMemoryStats>>();
type OnDemandMemory = NativeOnDemandMemory;
const nowIso = (): string => new Date().toISOString();
const EMPTY_STATS = (): MailMemoryStats => ({
  scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 0,
  persisted: 0, body_analyzed: 0, source_changed: 0, skipped: 0,
});

/** Soft wall-clock budget. It is checked before work starts, never used to abort an in-flight model request. */
function incrementBudgetMs(): number {
  const configured = Number(process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS || 240_000);
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 240_000;
}

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

function onDemandFingerprint(rows: Row[]): string { return mailMemorySourceFingerprint(rows); }

/** Clean text is model input only; CAS always retains the stored canonical bytes. */
function mailBodyOf(row: Row): string {
  const direct = [row.body_text, row.body, row.text, row.content, row.snippet]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .find(Boolean);
  if (direct) return direct;
  const html = typeof row.body_html === "string" ? row.body_html : "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalMailBodyOf(row: Row): string {
  const bodyText = typeof row.body_text === "string" ? row.body_text : "";
  if (bodyText.trim()) return bodyText;
  const direct = [row.body, row.text, row.content, row.snippet]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return direct || "";
}

function bodyFingerprint(body: string): string { return mailBodyFingerprint(body); }
function isRemoteSummary(source: string): boolean { return ["codex_memory", "luna", "openai", "starry_mcp"].includes(String(source || "")); }
function isRemoteDigest(source: string): boolean { return ["codex_memory", "luna"].includes(String(source || "")); }
function isTrustedTranslation(source: string): boolean { return ["codex_memory", "luna", "starry_mcp"].includes(String(source || "")); }

function itemTranslationNeeded(row: Row): boolean {
  const body = String(row.body_text ?? "");
  if (!body.trim()) return false;
  const hasTranslation = Boolean(String(row.translation_zh || "").trim()) && isTrustedTranslation(String(row.translation_source || ""));
  return !hasTranslation || String(row.memory_fingerprint || "") !== bodyFingerprint(body);
}

function itemSummaryNeeded(row: Row): boolean {
  const body = String(row.body_text ?? "");
  if (!body.trim()) return false;
  const hasSummary = Boolean(String(row.summary || row.summary_zh || "").trim()) && isRemoteSummary(String(row.summary_source || ""));
  return !hasSummary || String(row.memory_fingerprint || "") !== bodyFingerprint(body);
}

function threadFingerprint(rows: Row[]): string { return mailMemorySourceFingerprint(rows); }

export async function readPersonDigest(mailbox: string, peerEmail: string): Promise<ThreadDigest | null> {
  const row = await readNativePersonMemory(mailbox, peerEmail);
  if (!row) return null;
  return {
    text: String(row.digest_text || ""), source: String(row.digest_source || ""), mail_count: Number(row.mail_count || 0), fingerprint: String(row.digest_fingerprint || ""),
    ...(row.generated_at ? { generated_at: String(row.generated_at) } : {}), ...(row.error ? { error: String(row.error) } : {}),
  };
}

/** Cron's digest phases deliberately use only the real Codex app-server helper. */
async function digestWithRemote(rows: Row[]): Promise<{ text?: string; source?: "codex_memory"; error?: string }> {
  if (!remoteMailAnalysisEnabled() || !rows.length) return { error: "disabled" };
  const summaries = await summarizeWithCodexAppServer(rows);
  if (summaries && summaries.some(Boolean)) return { text: summaries.filter(Boolean).join("；"), source: "codex_memory" };
  return { error: "unavailable" };
}

type ItemOutcome = {
  translationZh?: string; translationSource?: string; summary?: string; summaryZh?: string; summarySource?: string; source: string; error?: string;
  translated: boolean; summarized: boolean; bodyAnalyzed: boolean; providerUnavailable: boolean; budgetExhausted: boolean;
};

function sourceLineage(...sources: Array<string | undefined>): string {
  const unique = [...new Set(sources.map((source) => String(source || "").trim()).filter(Boolean))];
  return unique.join("+") || "analysis_failed";
}

/** Does model I/O only; its result is persisted later in a SQL-only transaction. */
async function prepareItemMemory(row: Row, budgetExceeded: () => boolean): Promise<ItemOutcome> {
  const body = String(row.body_text ?? "");
  const needTranslation = itemTranslationNeeded(row);
  const needSummary = itemSummaryNeeded(row);
  let translationZh: string | undefined;
  let translationSource: string | undefined;
  let summary: string | undefined;
  let summarySource: string | undefined;
  let error = "";
  let translated = false;
  let summarized = false;
  let bodyAnalyzed = false;
  let budgetExhausted = false;

  if (needTranslation) {
    try {
      const result = await translateMailBodyZh(body);
      if (result) { translationZh = result.text; translationSource = result.source; translated = true; }
      else { translationSource = "pending"; error = "translation_provider_unavailable"; }
    } catch (err) {
      translationSource = "pending";
      error = err instanceof Error ? err.message : String(err);
    }
  }

  if (needSummary) {
    if (budgetExceeded()) {
      budgetExhausted = true;
    } else {
      try {
        const summaries = await summarizeWithCodexAppServer([{ id: row.id, body, subject: row.subject, direction: row.direction }]);
        const summaryText = summaries?.[0]?.trim();
        if (summaryText) { summary = summaryText; summarySource = "codex_memory"; summarized = true; }
        else {
          summary = analyzeMailBody({ body, direction: row.direction });
          summarySource = "body_analysis";
          bodyAnalyzed = Boolean(summary);
          error = error || "summary_provider_unavailable";
        }
      } catch (err) {
        summary = analyzeMailBody({ body, direction: row.direction });
        summarySource = "body_analysis";
        bodyAnalyzed = Boolean(summary);
        error = error || (err instanceof Error ? err.message : String(err));
      }
    }
  }

  const modelSucceeded = translated || summarized;
  return {
    translationZh, translationSource, summary, summaryZh: summary, summarySource,
    source: sourceLineage(translationSource, summarySource), error: error || undefined,
    translated, summarized, bodyAnalyzed, providerUnavailable: Boolean(error) && !modelSucceeded,
    budgetExhausted,
  };
}

async function persistItemOutcome(runId: string, row: Row, body: string, outcome: ItemOutcome, stats: MailMemoryStats): Promise<{ persisted: boolean; sourceChanged: boolean }> {
  const before = { ...stats };
  const result = await postgresTransaction(async () => {
    const applied = await writeNativeItemMemoryIfFresh({
      itemId: String(row.id), body, translationZh: outcome.translationZh, translationSource: outcome.translationSource,
      summary: outcome.summary, summaryZh: outcome.summaryZh, summarySource: outcome.summarySource, source: outcome.source, error: outcome.error || null,
    });
    if (!applied) return { applied: false, next: before };
    const next: MailMemoryStats = {
      ...before,
      translated: before.translated + (outcome.translated ? 1 : 0), summarized: before.summarized + (outcome.summarized ? 1 : 0),
      errors: before.errors + (outcome.error ? 1 : 0), persisted: (before.persisted || 0) + 1,
      body_analyzed: (before.body_analyzed || 0) + (outcome.bodyAnalyzed ? 1 : 0),
    };
    await checkpointNativeMemoryRun(runId, next);
    return { applied: true, next };
  });
  if (result.applied) Object.assign(stats, result.next);
  else {
    stats.source_changed = (stats.source_changed || 0) + 1;
    if (outcome.error) stats.errors += 1;
  }
  return { persisted: result.applied, sourceChanged: !result.applied };
}

type DigestOutcome = { persisted: boolean; generated: boolean; bodyAnalyzed: boolean; providerUnavailable: boolean };

async function persistThreadDigestOutcome(runId: string, thread: Row, sourceRows: Row[], digest: ThreadDigest, generated: boolean, providerUnavailable: boolean, stats: MailMemoryStats): Promise<DigestOutcome> {
  const before = { ...stats };
  const result = await postgresTransaction(async (client) => {
    // No model/network call is made in this transaction. Re-read the complete
    // source on this physical client before accepting its derived digest.
    const current = await listNativeThreadItems(String(thread.id), client);
    if (threadFingerprint(current) !== threadFingerprint(sourceRows)) return { applied: false, next: before };
    const applied = await writeNativeThreadDigest(String(thread.id), { text: digest.text, source: digest.source, fingerprint: digest.fingerprint, error: digest.error, failedAt: digest.failed_at, mailCount: digest.mail_count }, client);
    if (!applied) return { applied: false, next: before };
    const next: MailMemoryStats = {
      ...before, digested: before.digested + (generated ? 1 : 0), errors: before.errors + (generated ? 0 : 1),
      persisted: (before.persisted || 0) + 1, body_analyzed: (before.body_analyzed || 0) + (generated ? 0 : 1),
    };
    await checkpointNativeMemoryRun(runId, next, client);
    return { applied: true, next };
  });
  if (result.applied) Object.assign(stats, result.next);
  else { stats.source_changed = (stats.source_changed || 0) + 1; if (!generated) stats.errors += 1; }
  return { persisted: result.applied, generated: generated && result.applied, bodyAnalyzed: !generated && result.applied, providerUnavailable };
}

async function ensureThreadDigest(thread: Row, runId: string, stats: MailMemoryStats): Promise<DigestOutcome | null> {
  const sourceRows = await listNativeThreadItems(String(thread.id));
  const items = sourceRows.map((item) => ({ ...item, body: String(item.body_text || item.body || item.snippet || ""), snippet: String(item.snippet || item.body_text || "") }));
  if (!items.some((item) => String(item.body || "").trim())) return null;
  const stored: ThreadDigest = { text: String(thread.digest_text || ""), source: String(thread.digest_source || ""), mail_count: Number(thread.digest_mail_count || 0), fingerprint: String(thread.digest_fingerprint || ""), ...(thread.digest_error ? { error: String(thread.digest_error) } : {}), ...(thread.digest_failed_at ? { failed_at: String(thread.digest_failed_at) } : {}) };
  const fingerprint = threadFingerprint(sourceRows);
  if (stored.fingerprint === fingerprint && isRemoteDigest(stored.source) && stored.text) return null;
  const remote = await digestWithRemote(items);
  const generated = Boolean(remote.text);
  const digest: ThreadDigest = generated
    ? { text: remote.text!, source: "codex_memory", mail_count: items.filter((item) => String(item.body || "").trim()).length, fingerprint }
    : { text: threadDigestOf(items, stored).text, source: "analysis_failed", mail_count: items.filter((item) => String(item.body || "").trim()).length, fingerprint, error: remote.error || "unavailable", failed_at: nowIso() };
  return persistThreadDigestOutcome(runId, thread, sourceRows, digest, generated, !generated, stats);
}

async function ensurePersonDigest(mailbox: string, peerEmail: string, runId: string, stats: MailMemoryStats): Promise<DigestOutcome | null> {
  const sourceRows = await listNativePersonItems(mailbox, peerEmail);
  const bodies = sourceRows.map((item) => ({ ...item, body: String(item.body_text || "") })).filter((item) => item.body.trim());
  if (!bodies.length) return null;
  const storedRow = await readNativePersonMemory(mailbox, peerEmail);
  const stored: ThreadDigest | null = storedRow ? { text: String(storedRow.digest_text || ""), source: String(storedRow.digest_source || ""), mail_count: Number(storedRow.mail_count || 0), fingerprint: String(storedRow.digest_fingerprint || ""), ...(storedRow.error ? { error: String(storedRow.error) } : {}) } : null;
  const fingerprint = threadFingerprint(sourceRows);
  if (stored && stored.fingerprint === fingerprint && isRemoteDigest(stored.source) && stored.text) return null;
  const remote = await digestWithRemote(bodies);
  const generated = Boolean(remote.text);
  const digest: ThreadDigest = generated
    ? { text: remote.text!, source: "codex_memory", mail_count: bodies.length, fingerprint, generated_at: nowIso() }
    : { text: threadDigestOf(bodies, stored).text, source: "analysis_failed", mail_count: bodies.length, fingerprint, generated_at: nowIso(), error: remote.error || "unavailable", failed_at: nowIso() };
  const before = { ...stats };
  const result = await postgresTransaction(async (client) => {
    // The peer selection and every source member are rechecked in this SQL-only
    // transaction; SERIALIZABLE retry therefore repeats no model I/O.
    const current = await listNativePersonItems(mailbox, peerEmail, client);
    if (threadFingerprint(current) !== threadFingerprint(sourceRows)) return { applied: false, next: before };
    await writeNativePersonMemory({ id: `pmm_${Buffer.from(`${mailbox}:${peerEmail}`).toString("base64url")}`, mailbox, peerEmail, text: digest.text, source: digest.source, fingerprint: digest.fingerprint, mailCount: digest.mail_count, generatedAt: digest.generated_at, error: digest.error || null }, client);
    const next: MailMemoryStats = {
      ...before, persons: before.persons + (generated ? 1 : 0), errors: before.errors + (generated ? 0 : 1),
      persisted: (before.persisted || 0) + 1, body_analyzed: (before.body_analyzed || 0) + (generated ? 0 : 1),
    };
    await checkpointNativeMemoryRun(runId, next, client);
    return { applied: true, next };
  });
  if (result.applied) Object.assign(stats, result.next);
  else { stats.source_changed = (stats.source_changed || 0) + 1; if (!generated) stats.errors += 1; }
  return { persisted: result.applied, generated: generated && result.applied, bodyAnalyzed: !generated && result.applied, providerUnavailable: !generated };
}
export async function markPendingMailMemory(mailbox?: string): Promise<void> {
  if (!remoteMailAnalysisEnabled()) return;
  await markNativeMailMemoryPending(mailbox);
}

export async function runMailMemoryIncrement(mailbox?: string): Promise<MailMemoryStats> {
  const stats = EMPTY_STATS();
  const lock = await acquireMailMemoryIncrementLock();
  if (!lock) {
    return { ...stats, skipped: 1, completion_scope: "skipped_lock_contended", remaining_work: "unknown" };
  }
  let runId = "";
  try {
    runId = await createNativeMemoryRun(mailbox || "*");
    stats.native_run_id = runId;
    if (!remoteMailAnalysisEnabled()) {
      stats.errors = 1; stats.provider_failed = true; stats.error = "mail_memory_provider_disabled";
      stats.completion_scope = "provider_failed"; stats.remaining_work = true;
      await finishNativeMemoryRunWithAudit(runId, { ...stats, status: "failed" }, "mail_memory.increment", { mailbox: mailbox || "*", repository: "postgresql_native", ...stats });
      return stats;
    }
    const startedAt = Date.now();
    const budgetExceeded = (): boolean => Date.now() - startedAt >= incrementBudgetMs();
    let stop = false;
    const items = await listNativeMemoryItems({ mailbox, limit: 5000, pendingOnly: true });
    for (const row of items) {
      if (budgetExceeded()) { stats.budget_exhausted = true; stop = true; break; }
      stats.scanned += 1;
      const body = String(row.body_text ?? "");
      const outcome = await prepareItemMemory(row, budgetExceeded);
      await persistItemOutcome(runId, row, body, outcome, stats);
      if (outcome.budgetExhausted) { stats.budget_exhausted = true; stop = true; break; }
      if (outcome.providerUnavailable) { stats.provider_failed = true; stats.error = "mail_memory_provider_unavailable"; stop = true; break; }
    }
    if (!stop) {
      for (const thread of await listNativeMemoryThreads(mailbox)) {
        if (budgetExceeded()) { stats.budget_exhausted = true; stop = true; break; }
        const outcome = await ensureThreadDigest(thread, runId, stats);
        if (outcome?.providerUnavailable) { stats.provider_failed = true; stats.error = "mail_memory_provider_unavailable"; stop = true; break; }
      }
    }
    if (!stop) {
      for (const peer of await listNativePersonKeys(mailbox)) {
        if (budgetExceeded()) { stats.budget_exhausted = true; stop = true; break; }
        const outcome = await ensurePersonDigest(peer.mailbox, peer.peer_email, runId, stats);
        if (outcome?.providerUnavailable) { stats.provider_failed = true; stats.error = "mail_memory_provider_unavailable"; stop = true; break; }
      }
    }
    const pendingItems = await listNativeMemoryItems({ mailbox, limit: 1, pendingOnly: true });
    stats.remaining_work = Boolean(stats.provider_failed || stats.budget_exhausted || pendingItems.length || stats.source_changed);
    stats.completion_scope = stats.provider_failed ? "provider_failed" : stats.budget_exhausted ? "budget_exhausted" : "bounded_increment_batch";
    await finishNativeMemoryRunWithAudit(runId, { ...stats, status: stats.errors ? "failed" : "succeeded" }, "mail_memory.increment", {
      mailbox: mailbox || "*", repository: "postgresql_native", ...stats,
    });
    return stats;
  } catch (err) {
    stats.errors += 1; stats.error = err instanceof Error ? err.message : String(err);
    if (runId) {
      // The atomic finish+audit failed or an earlier DB operation failed. Mark
      // the owned run failed without claiming the increment audit was written.
      try { await finishNativeMemoryRun(runId, { ...stats, status: "failed", error: stats.error }); } catch { /* preserve original failure */ }
    }
    throw err;
  } finally {
    await lock.release();
  }
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

/** Failure receipt and audit are one SQL-only transaction on the captured actor context. */
async function persistOnDemandFailure(input: { actorId: string; memoryKey: string; value: OnDemandMemory; eventType: string; payload: Json }): Promise<void> {
  await postgresTransaction(async (client) => {
    await writeNativeOnDemandMemory(input.actorId, input.memoryKey, input.value, client);
    await writeNativeMailMemoryAudit(input.eventType, input.payload, client);
  });
}

/** Execute the employee-facing mail_summary Skill for one selected conversation. */
export async function triggerMailSummarySkill(mailbox: string, conversationId: string): Promise<MailMemoryStats> {
  const actorId = await onDemandActorId();
  const key = `skill:mail_summary:${actorId}:${mailbox}:${conversationId}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const memoryKey = onDemandKey("summary", mailbox, conversationId);
  const promise = (async (): Promise<MailMemoryStats> => {
    let subject = "";
    try {
      const thread = await findNativeMailThread(mailbox, conversationId);
      if (!thread) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "未找到对应的邮件主题或会话已失效" };
      subject = String(thread.subject || "");
      const sourceRows = (await listNativeConversationItems(conversationId, mailbox)).filter((item) => Boolean(mailBodyOf(item)));
      if (!sourceRows.length) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "选中的邮件主题没有可用正文（已检查 body_text、body、text、content、snippet 和 body_html）" };
      const fingerprint = onDemandFingerprint(sourceRows);
      const previous = await readNativeOnDemandMemory(actorId, memoryKey);
      if (previous?.status === "已完成" && previous.fingerprint === fingerprint) {
        return { scanned: sourceRows.length, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 0 };
      }
      // Keep the canonical stored body out of the cleaned model text so the raw
      // body bytes remain available for the later CAS.
      const modelRows = sourceRows.map((row): Row => ({ ...row, body: mailBodyOf(row), existing_digest: previous?.text || "" }));
      const result = await generateMailConversationDigest(modelRows);
      const text = String(result.text || "").trim();
      if (!text) throw new Error(`Codex/Luna 摘要链路未返回结果：${result.error || "unavailable"}`);
      const completedAt = nowIso();
      const persisted = await postgresTransaction(async (client) => {
        const current = (await listNativeConversationItems(conversationId, mailbox, client)).filter((item) => Boolean(mailBodyOf(item)));
        if (onDemandFingerprint(current) !== fingerprint) return false;
        const applied = await writeNativeThreadDigest(String(thread.id), { text, source: result.source || "codex_memory", mailCount: sourceRows.length, fingerprint }, client);
        if (!applied) return false;
        await writeNativeOnDemandMemory(actorId, memoryKey, {
          status: "已完成", mailbox, subject, conversation_id: conversationId, text, fingerprint, completed_at: completedAt,
        }, client);
        return true;
      });
      if (!persisted) throw new Error("mail_memory_source_changed");
      return { scanned: sourceRows.length, translated: 0, summarized: 1, digested: 1, persons: 0, errors: 0 };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // A failure must never leave an actor-specific completion without its audit.
      try {
        await persistOnDemandFailure({
          actorId, memoryKey,
          value: { status: "未开始", mailbox, subject, conversation_id: conversationId, text: "", fingerprint: "", error },
          eventType: "mail_skill.summary_failed", payload: { mailbox, conversation_id: conversationId, error },
        });
      } catch {
        // The failed atomic receipt leaves neither cache nor audit durable.
      }
      return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error };
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Execute the employee-facing mail_translate Skill for one selected message. */
export async function triggerMailTranslateSkill(mailbox: string, messageId: string): Promise<MailMemoryStats> {
  const actorId = await onDemandActorId();
  const key = `skill:mail_translate:${actorId}:${mailbox}:${messageId}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async (): Promise<MailMemoryStats> => {
    let memoryKey = onDemandKey("translation", mailbox, "", messageId);
    let subject = "";
    let conversationId = "";
    try {
      const row = await findNativeMailItem(mailbox, messageId);
      const body = row ? mailBodyOf(row) : "";
      const canonicalBody = row ? canonicalMailBodyOf(row) : "";
      if (!row) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "未找到选中的邮件，可能是邮件 ID 已变化" };
      if (!body || !canonicalBody) return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error: "选中的邮件没有可用正文（已检查 body_text、body、text、content、snippet 和 body_html）" };
      const thread = row.thread_id ? await findNativeMailThread(mailbox, String(row.thread_id)) : undefined;
      conversationId = String(row.conversation_id || thread?.conversation_id || "");
      subject = String(row.subject || thread?.subject || "");
      memoryKey = onDemandKey("translation", mailbox, conversationId, String(row.id));
      const fingerprint = onDemandFingerprint([row]);
      const previous = await readNativeOnDemandMemory(actorId, memoryKey);
      if (previous?.status === "已完成" && previous.fingerprint === fingerprint) {
        return { scanned: 1, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 0 };
      }
      const result = await translateMailBodyZhWithCodexLuna(body);
      const text = String(result?.text || "").trim();
      if (!text) throw new Error("Codex/Luna 翻译链路未返回可用译文");
      const completedAt = nowIso();
      const persisted = await postgresTransaction(async (client) => {
        const current = await findNativeMailItem(mailbox, String(row.id), client);
        if (!current || onDemandFingerprint([current]) !== fingerprint) return false;
        // The write CAS receives exact body_text bytes, never mailBodyOf(...).trim().
        const applied = await writeNativeItemMemoryIfFresh({ itemId: String(row.id), body: canonicalBody, translationZh: text, translationSource: result?.source || "codex_memory", source: result?.source || "codex_memory" }, client);
        if (!applied) return false;
        await writeNativeOnDemandMemory(actorId, memoryKey, {
          status: "已完成", mailbox, subject, conversation_id: conversationId, message_id: String(row.id), text, fingerprint, completed_at: completedAt,
        }, client);
        return true;
      });
      if (!persisted) throw new Error("mail_memory_source_changed");
      return { scanned: 1, translated: 1, summarized: 0, digested: 0, persons: 0, errors: 0 };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      try {
        await persistOnDemandFailure({
          actorId, memoryKey,
          value: { status: "未开始", mailbox, subject, conversation_id: conversationId, message_id: messageId, text: "", fingerprint: "", error },
          eventType: "mail_skill.translate_failed", payload: { mailbox, message_id: messageId, error },
        });
      } catch {
        // The failed atomic receipt leaves neither cache nor audit durable.
      }
      return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1, error };
    }
  })().finally(() => inflight.delete(key));
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
