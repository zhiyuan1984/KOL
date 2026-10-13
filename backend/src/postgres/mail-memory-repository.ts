import { createHash } from "node:crypto";
import { postgresPool, postgresTransaction } from "./pool.js";
import type { Json, Row } from "../types.js";

export const NATIVE_MAIL_MEMORY_VERSION = "mail-memory-v1-pg-native";
function text(value: unknown): string { return String(value ?? "").trim(); }
export function mailBodyFingerprint(body: unknown): string { return createHash("md5").update(text(body)).digest("hex"); }

export async function listNativeMemoryItems(input: { mailbox?: string; limit?: number; cursor?: string } = {}): Promise<Row[]> {
  const mailbox = text(input.mailbox);
  const limit = Math.max(1, Math.min(5000, Math.floor(input.limit || 5000)));
  const params: unknown[] = [];
  const clauses = ["COALESCE(i.body_text,'') <> ''"];
  if (mailbox) { params.push(mailbox); clauses.push(`COALESCE(t.mailbox,'')=$${params.length}`); }
  if (input.cursor) { params.push(input.cursor); clauses.push(`NULLIF(i.occurred_at,'')::timestamptz < $${params.length}::timestamptz`); }
  params.push(limit);
  const result = await postgresPool().query<Row>(
    `SELECT i.*, t.mailbox, t.peer_email FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
      WHERE ${clauses.join(" AND ")} ORDER BY i.occurred_at DESC NULLS LAST, i.created_at DESC, i.id DESC LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

export async function listNativeMemoryThreads(mailbox?: string): Promise<Row[]> {
  const result = mailbox
    ? await postgresPool().query<Row>("SELECT * FROM kol_mail_threads WHERE mailbox=$1 ORDER BY last_at DESC NULLS LAST, updated_at DESC, id", [mailbox])
    : await postgresPool().query<Row>("SELECT * FROM kol_mail_threads ORDER BY last_at DESC NULLS LAST, updated_at DESC, id");
  return result.rows;
}

export async function listNativeThreadItems(threadId: string): Promise<Row[]> {
  if (!threadId) return [];
  const result = await postgresPool().query<Row>("SELECT * FROM kol_mail_items WHERE thread_id=$1 ORDER BY occurred_at ASC NULLS LAST, created_at ASC, id ASC", [threadId]);
  return result.rows;
}

export async function listNativePersonKeys(mailbox?: string): Promise<Array<{ mailbox: string; peer_email: string }>> {
  const params: unknown[] = [];
  const clause = mailbox ? `AND t.mailbox=$${params.push(mailbox)}` : "";
  const result = await postgresPool().query<{ mailbox: string; peer_email: string }>(
    `SELECT DISTINCT t.mailbox, lower(t.peer_email) AS peer_email FROM kol_mail_threads t
      WHERE COALESCE(t.mailbox,'') <> '' AND COALESCE(t.peer_email,'') <> '' ${clause}
      ORDER BY t.mailbox, lower(t.peer_email)`, params,
  );
  return result.rows;
}

export async function listNativePersonItems(mailbox: string, peerEmail: string): Promise<Row[]> {
  const result = await postgresPool().query<Row>(
    `SELECT i.* FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
      WHERE COALESCE(t.mailbox,'')=$1 AND (lower(COALESCE(i.from_addr,''))=$2 OR lower(COALESCE(i.to_addr,''))=$2)
      ORDER BY i.occurred_at ASC NULLS LAST, i.created_at ASC, i.id ASC`, [mailbox, peerEmail.toLowerCase()],
  );
  return result.rows;
}

export async function writeNativeItemMemoryIfFresh(input: {
  itemId: string; body: string; translationZh?: string; translationSource?: string;
  summary?: string; summaryZh?: string; summarySource?: string; source?: string; error?: string | null;
}): Promise<boolean> {
  const fingerprint = mailBodyFingerprint(input.body);
  const result = await postgresPool().query(
    `UPDATE kol_mail_items SET body_fingerprint=$1, translation_zh=COALESCE($2,translation_zh),
       translation_source=COALESCE($3,translation_source), summary=COALESCE($4,summary), summary_zh=COALESCE($5,summary_zh),
       summary_source=COALESCE($6,summary_source), memory_source=COALESCE($7,memory_source), memory_fingerprint=$1,
       memory_generated_at=now()::text, memory_generated_at_ts=now(), memory_attempts=COALESCE(memory_attempts,0)+1,
       memory_error=$8, memory_next_retry_at=NULL WHERE id=$9 AND md5(COALESCE(body_text,''))=$1`,
    [fingerprint, input.translationZh ?? null, input.translationSource ?? null, input.summary ?? null, input.summaryZh ?? null,
      input.summarySource ?? null, input.source ?? NATIVE_MAIL_MEMORY_VERSION, input.error ?? null, input.itemId],
  );
  return Boolean(result.rowCount);
}

export async function writeNativeThreadDigest(threadId: string, digest: { text?: string; source?: string; fingerprint?: string; error?: string; failedAt?: string; mailCount?: number }): Promise<boolean> {
  if (!threadId) return false;
  const result = await postgresPool().query(
    `UPDATE kol_mail_threads SET digest_text=$1,digest_source=$2,digest_fingerprint=$3,digest_error=$4,
       digest_failed_at=$5,digest_mail_count=$6,digest_generated_at_ts=now(),updated_at=now()::text WHERE id=$7`,
    [String(digest.text || ""), String(digest.source || ""), String(digest.fingerprint || ""), digest.error ? String(digest.error) : "",
      digest.failedAt || null, Number(digest.mailCount || 0), threadId],
  );
  return Boolean(result.rowCount);
}

export async function readNativePersonMemory(mailbox: string, peerEmail: string): Promise<Row | undefined> {
  const result = await postgresPool().query<Row>("SELECT * FROM kol_mail_person_memory WHERE lower(mailbox)=lower($1) AND lower(peer_email)=lower($2)", [mailbox, peerEmail]);
  return result.rows[0];
}

export async function writeNativePersonMemory(input: { id: string; companyId?: string; mailbox: string; peerEmail: string; text: string; source: string; fingerprint: string; mailCount: number; generatedAt?: string; error?: string | null }): Promise<void> {
  await postgresTransaction(async (client) => {
    await client.query(
      `INSERT INTO kol_mail_person_memory(id,company_id,mailbox,peer_email,digest_text,digest_source,digest_fingerprint,mail_count,generated_at,error,attempts,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,now()),$10,1,now())
       ON CONFLICT(mailbox,peer_email) DO UPDATE SET digest_text=EXCLUDED.digest_text,digest_source=EXCLUDED.digest_source,
       digest_fingerprint=EXCLUDED.digest_fingerprint,mail_count=EXCLUDED.mail_count,generated_at=EXCLUDED.generated_at,
       error=EXCLUDED.error,attempts=kol_mail_person_memory.attempts+1,updated_at=now()`,
      [input.id, input.companyId || "", input.mailbox, input.peerEmail.toLowerCase(), input.text, input.source, input.fingerprint,
        input.mailCount, input.generatedAt || null, input.error || null],
    );
  });
}

export async function createNativeMemoryRun(mailbox = "*"): Promise<string> {
  const id = `mmrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await postgresPool().query("INSERT INTO kol_mail_memory_runs(id,mailbox,status) VALUES($1,$2,'running')", [id, mailbox]);
  return id;
}
export async function finishNativeMemoryRun(id: string, stats: { scanned: number; translated: number; summarized: number; digested: number; persons: number; errors: number; status?: "succeeded" | "failed"; error?: string }): Promise<void> {
  await postgresPool().query(`UPDATE kol_mail_memory_runs SET status=$2,scanned=$3,translated=$4,summarized=$5,digested=$6,persons=$7,errors=$8,finished_at=now(),error=$9 WHERE id=$1`,
    [id, stats.status || "succeeded", stats.scanned, stats.translated, stats.summarized, stats.digested, stats.persons, stats.errors, stats.error || null]);
}
export async function nativeMailMemoryParity(mailbox?: string): Promise<Json> {
  const args = mailbox ? [mailbox] : [];
  const clause = mailbox ? "WHERE mailbox=$1" : "";
  const result = await postgresPool().query<{ threads: string; items: string; memories: string }>(
    `SELECT (SELECT COUNT(*)::text FROM kol_mail_threads ${clause}) AS threads,
            (SELECT COUNT(*)::text FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id ${mailbox ? "WHERE t.mailbox=$1" : ""}) AS items,
            (SELECT COUNT(*)::text FROM kol_mail_person_memory ${clause}) AS memories`, args);
  return { repository: "postgresql_native", version: NATIVE_MAIL_MEMORY_VERSION, mailbox: mailbox || "*", ...result.rows[0] };
}
