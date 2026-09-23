/**
 * Mail memory increment job: zero-model read path.
 * Triggered by sync completion and by the `mail_memory_increment` cron job.
 * Scans local mail items/threads, fills missing/outdated translations,
 * per-message summaries and conversation/person digests, and writes back
 * memory columns only. Never sends mail, never writes formal stage.
 */
import crypto from "node:crypto";
import { audit, getConn, nowIso } from "../db.js";
import type { Json, Row } from "../types.js";
import {
  itemsForConversation,
  markItemMemoryPending,
  persistItemMemory,
  persistThreadDigest,
} from "./mail-memory.js";
import {
  analyzeMailBody,
  remoteMailAnalysisEnabled,
  summarizeWithCodexAppServer,
  threadDigestOf,
  type ThreadDigest,
} from "./mail-summary.js";
import { translateMailBodyZh } from "../starrykol/translate-zh.js";

export type MailMemoryStats = {
  scanned: number;
  translated: number;
  summarized: number;
  digested: number;
  persons: number;
  errors: number;
};

const inflight = new Map<string, Promise<MailMemoryStats>>();

function bodyFingerprint(body: string): string {
  return crypto.createHash("sha256").update(String(body || "")).digest("hex").slice(0, 32);
}

function isRemoteSummary(source: string): boolean {
  return ["codex_memory", "luna", "starry_mcp"].includes(String(source || ""));
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
  return rows
    .map((r) => [
      String(r.id || ""),
      String(r.occurred_at || ""),
      String(r.body_text || "").length,
    ].join(":"))
    .join("|");
}

function personDigestKey(mailbox: string, peerEmail: string): string {
  return `mail_person_digest:${mailbox}:${peerEmail}`;
}

export function readPersonDigest(mailbox: string, peerEmail: string): ThreadDigest | null {
  const raw = getConn()
    .prepare("SELECT value FROM app_state WHERE key=?")
    .get(personDigestKey(mailbox, peerEmail)) as { value: string } | undefined;
  if (!raw?.value) return null;
  try {
    const parsed = JSON.parse(raw.value) as ThreadDigest;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      text: String(parsed.text || ""),
      source: String(parsed.source || ""),
      mail_count: Number(parsed.mail_count || 0),
      fingerprint: String(parsed.fingerprint || ""),
      ...(parsed.generated_at ? { generated_at: String(parsed.generated_at) } : {}),
      ...(parsed.error ? { error: String(parsed.error) } : {}),
      ...(parsed.failed_at ? { failed_at: String(parsed.failed_at) } : {}),
    };
  } catch {
    return null;
  }
}

function writePersonDigest(mailbox: string, peerEmail: string, digest: ThreadDigest): void {
  getConn()
    .prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)")
    .run(personDigestKey(mailbox, peerEmail), JSON.stringify(digest));
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
  const updates: Parameters<typeof persistItemMemory>[1] = {
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

  persistItemMemory(String(row.id), updates);
  return { translated, summarized, error };
}

async function ensureThreadDigest(thread: Row): Promise<boolean> {
  const conversationId = String(thread.conversation_id || "");
  const mailbox = String(thread.mailbox || "");
  if (!conversationId) return false;
  const items = itemsForConversation(conversationId, mailbox || undefined).map((item) => ({
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
  persistThreadDigest(String(thread.id), digest);
  return remote.text ? true : false;
}

async function ensurePersonDigest(mailbox: string, peerEmail: string): Promise<boolean> {
  const normalizedPeer = peerEmail.toLowerCase();
  const items = getConn()
    .prepare(
      `SELECT i.* FROM kol_mail_items i
       JOIN kol_mail_threads t ON t.id = i.thread_id
       WHERE IFNULL(t.mailbox,'')=? AND (lower(i.from_addr)=? OR lower(i.to_addr)=?)
       ORDER BY i.occurred_at ASC, i.created_at ASC`,
    )
    .all(mailbox, normalizedPeer, normalizedPeer) as Row[];
  const bodies = items
    .map((item) => ({ ...item, body: String(item.body_text || "").trim() }))
    .filter((item) => item.body);
  if (!bodies.length) return false;
  const stored = readPersonDigest(mailbox, peerEmail);
  const fingerprint = threadFingerprint(bodies);
  if (stored && stored.fingerprint === fingerprint && isRemoteDigest(stored.source)) return false;
  const remote = await digestWithRemote(bodies);
  const digest: ThreadDigest = remote.text
    ? {
      text: remote.text,
      source: remote.source || "codex_memory",
      mail_count: bodies.length,
      fingerprint,
      generated_at: nowIso(),
    }
    : {
      text: threadDigestOf(bodies, stored).text,
      source: "analysis_failed",
      mail_count: bodies.length,
      fingerprint,
      generated_at: nowIso(),
      error: remote.error || "unavailable",
      failed_at: nowIso(),
    };
  writePersonDigest(mailbox, peerEmail, digest);
  return remote.text ? true : false;
}

export function markPendingMailMemory(mailbox?: string): void {
  if (!remoteMailAnalysisEnabled()) return;
  const boxClause = mailbox ? "AND IFNULL(t.mailbox,'')=?" : "";
  const args = mailbox ? [mailbox] : [];
  const db = getConn();
  const items = db.prepare(
    `SELECT i.id FROM kol_mail_items i
     JOIN kol_mail_threads t ON t.id = i.thread_id
     WHERE IFNULL(i.body_text,'') != '' ${boxClause}
       AND (i.translation_zh IS NULL OR i.translation_zh = '')
       AND IFNULL(i.memory_source,'') != 'pending'`,
  ).all(...args) as { id: string }[];
  for (const item of items) markItemMemoryPending(item.id);
}

export async function runMailMemoryIncrement(mailbox?: string): Promise<MailMemoryStats> {
  const stats: MailMemoryStats = {
    scanned: 0,
    translated: 0,
    summarized: 0,
    digested: 0,
    persons: 0,
    errors: 0,
  };
  if (!remoteMailAnalysisEnabled()) return stats;

  const boxClause = mailbox ? "AND IFNULL(t.mailbox,'')=?" : "";
  const args = mailbox ? [mailbox] : [];
  const db = getConn();

  const items = db.prepare(
    `SELECT i.* FROM kol_mail_items i
     JOIN kol_mail_threads t ON t.id = i.thread_id
     WHERE IFNULL(i.body_text,'') != '' ${boxClause}
     ORDER BY i.occurred_at DESC`,
  ).all(...args) as Row[];

  for (const row of items) {
    stats.scanned += 1;
    const result = await ensureItemMemory(row);
    if (result.translated) stats.translated += 1;
    if (result.summarized) stats.summarized += 1;
    if (result.error) stats.errors += 1;
  }

  const threads = db.prepare(
    `SELECT * FROM kol_mail_threads WHERE 1=1 ${mailbox ? "AND mailbox=?" : ""}`,
  ).all(...args) as Row[];
  for (const thread of threads) {
    try {
      const updated = await ensureThreadDigest(thread);
      if (updated) stats.digested += 1;
    } catch (err) {
      stats.errors += 1;
      audit("host", "mail_memory.thread_digest_failed", {
        thread_id: thread.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const peers = db.prepare(
    `SELECT DISTINCT t.mailbox, t.peer_email FROM kol_mail_threads t
     WHERE IFNULL(t.peer_email,'') != '' ${mailbox ? "AND t.mailbox=?" : ""}`,
  ).all(...args) as { mailbox: string; peer_email: string }[];
  for (const { mailbox: box, peer_email: peer } of peers) {
    try {
      const updated = await ensurePersonDigest(box, peer);
      if (updated) stats.persons += 1;
    } catch (err) {
      stats.errors += 1;
      audit("host", "mail_memory.person_digest_failed", {
        mailbox: box,
        peer_email: peer,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  audit("host", "mail_memory.increment", { mailbox: mailbox || "*", ...stats });
  return stats;
}

export function triggerMailMemoryIncrement(mailbox?: string): void {
  const key = mailbox || "*";
  if (inflight.has(key)) return;
  const promise = runMailMemoryIncrement(mailbox)
    .catch((err) => {
      audit("host", "mail_memory.increment_failed", {
        mailbox: mailbox || "*",
        error: err instanceof Error ? err.message : String(err),
      });
      return { scanned: 0, translated: 0, summarized: 0, digested: 0, persons: 0, errors: 1 };
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
}

export function pendingMailMemoryIncrement(mailbox?: string): boolean {
  return inflight.has(mailbox || "*");
}
