import type { PoolClient } from "pg";
import { postgresConnection } from "./pool.js";
import type { Row } from "../types.js";
import { mailMemorySourceFingerprint } from "./mail-memory-repository.js";

export const MAIL_MEMORY_PHASES = ["items", "threads", "persons"] as const;
export type MailMemoryPhase = typeof MAIL_MEMORY_PHASES[number];

export type NativeMailMemoryProgress = {
  mailbox: string;
  next_phase: MailMemoryPhase;
  item_cursor: string;
  thread_cursor: string;
  person_cursor: string;
};

export type NativePersonKey = { mailbox: string; peer_email: string };

function scope(mailbox?: string): string { return String(mailbox || "*").trim() || "*"; }
function phase(value: unknown): MailMemoryPhase {
  return MAIL_MEMORY_PHASES.includes(value as MailMemoryPhase) ? value as MailMemoryPhase : "items";
}
function cursor(value: unknown): string { return String(value || ""); }

export function nextMailMemoryPhase(current: MailMemoryPhase): MailMemoryPhase {
  return MAIL_MEMORY_PHASES[(MAIL_MEMORY_PHASES.indexOf(current) + 1) % MAIL_MEMORY_PHASES.length];
}

/** Durable round-robin state; it is deliberately database-backed, never process-local. */
export async function readNativeMailMemoryProgress(mailbox?: string, client?: PoolClient): Promise<NativeMailMemoryProgress> {
  const mailboxScope = scope(mailbox);
  const db = client || postgresConnection();
  const existing = await db.query<Row>(
    "SELECT mailbox,next_phase,item_cursor,thread_cursor,person_cursor FROM kol_mail_memory_progress WHERE mailbox=$1",
    [mailboxScope],
  );
  const row = existing.rows[0];
  if (row) return {
    mailbox: mailboxScope, next_phase: phase(row.next_phase), item_cursor: cursor(row.item_cursor),
    thread_cursor: cursor(row.thread_cursor), person_cursor: cursor(row.person_cursor),
  };
  await db.query(
    `INSERT INTO kol_mail_memory_progress(mailbox,next_phase,item_cursor,thread_cursor,person_cursor,updated_at)
     VALUES($1,'items','','','',now()) ON CONFLICT(mailbox) DO NOTHING`,
    [mailboxScope],
  );
  return { mailbox: mailboxScope, next_phase: "items", item_cursor: "", thread_cursor: "", person_cursor: "" };
}

export async function writeNativeMailMemoryProgress(progress: NativeMailMemoryProgress, client?: PoolClient): Promise<void> {
  const db = client || postgresConnection();
  await db.query(
    `INSERT INTO kol_mail_memory_progress(mailbox,next_phase,item_cursor,thread_cursor,person_cursor,updated_at)
     VALUES($1,$2,$3,$4,$5,now())
     ON CONFLICT(mailbox) DO UPDATE SET next_phase=EXCLUDED.next_phase,item_cursor=EXCLUDED.item_cursor,
       thread_cursor=EXCLUDED.thread_cursor,person_cursor=EXCLUDED.person_cursor,updated_at=now()`,
    [progress.mailbox, progress.next_phase, progress.item_cursor, progress.thread_cursor, progress.person_cursor],
  );
}

export function advanceNativeMailMemoryProgress(
  progress: NativeMailMemoryProgress,
  current: MailMemoryPhase,
  cursorValue?: string,
): NativeMailMemoryProgress {
  const next = { ...progress, next_phase: nextMailMemoryPhase(current) };
  if (cursorValue !== undefined) {
    if (current === "items") next.item_cursor = cursorValue;
    if (current === "threads") next.thread_cursor = cursorValue;
    if (current === "persons") next.person_cursor = cursorValue;
  }
  return next;
}

function itemPendingClause(): string {
  const fingerprint = "md5(COALESCE(i.body_text,''))";
  return `(
    NOT ((COALESCE(i.translation_source,'')='source_zh' AND COALESCE(i.memory_fingerprint,'')=${fingerprint})
      OR (COALESCE(i.translation_zh,'') <> ''
        AND COALESCE(i.translation_source,'') = ANY(ARRAY['codex_memory','luna','starry_mcp'])
        AND COALESCE(i.memory_fingerprint,'') = ${fingerprint}
        AND COALESCE(i.translation_zh,'') <> COALESCE(i.body_text,'')
        AND COALESCE(i.translation_zh,'') NOT LIKE '%发送仍用英文原文，本段仅内部查看%'))
    OR NOT (COALESCE(i.summary,'') <> '' OR COALESCE(i.summary_zh,'') <> '')
      OR NOT (COALESCE(i.summary_source,'') = ANY(ARRAY['codex_memory','luna','openai','starry_mcp']))
      OR COALESCE(i.memory_fingerprint,'') <> ${fingerprint}
  )`;
}

async function selectOne(sql: string, args: unknown[], client?: PoolClient): Promise<Row | undefined> {
  const result = await (client || postgresConnection()).query<Row>(sql, args);
  return result.rows[0];
}

/** Select one pending item after the persisted PK cursor and wrap once, avoiding a full replay scan. */
export async function nextNativeMemoryItem(mailbox: string | undefined, afterId: string, client?: PoolClient): Promise<Row | undefined> {
  const scoped = Boolean(String(mailbox || "").trim());
  const base = `FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
    WHERE btrim(COALESCE(i.body_text,'')) <> '' ${scoped ? "AND COALESCE(t.mailbox,'')=$1" : ""} AND ${itemPendingClause()}`;
  const params = scoped ? [String(mailbox)] : [] as unknown[];
  if (afterId) {
    const row = await selectOne(`SELECT i.*,t.mailbox,t.peer_email ${base} AND i.id > $${params.length + 1} ORDER BY i.id ASC LIMIT 1`, [...params, afterId], client);
    if (row) return row;
  }
  return selectOne(`SELECT i.*,t.mailbox,t.peer_email ${base} ORDER BY i.id ASC LIMIT 1`, params, client);
}

/** One stable thread candidate per turn; digest freshness is checked by the job against complete source rows. */
export async function nextNativeMemoryThread(mailbox: string | undefined, afterId: string, client?: PoolClient): Promise<Row | undefined> {
  const scoped = Boolean(String(mailbox || "").trim());
  const base = `FROM kol_mail_threads t WHERE 1=1 ${scoped ? "AND COALESCE(t.mailbox,'')=$1" : ""}`;
  const params = scoped ? [String(mailbox)] : [] as unknown[];
  if (afterId) {
    const row = await selectOne(`SELECT t.* ${base} AND t.id > $${params.length + 1} ORDER BY t.id ASC LIMIT 1`, [...params, afterId], client);
    if (row) return row;
  }
  return selectOne(`SELECT t.* ${base} ORDER BY t.id ASC LIMIT 1`, params, client);
}

function decodePersonCursor(value: string): NativePersonKey | null {
  try {
    const parsed = JSON.parse(value) as Partial<NativePersonKey>;
    if (typeof parsed.mailbox === "string" && typeof parsed.peer_email === "string") return { mailbox: parsed.mailbox, peer_email: parsed.peer_email };
  } catch { /* first pass */ }
  return null;
}
export function personCursorOf(value: NativePersonKey): string { return JSON.stringify(value); }

/** One distinct mailbox/peer candidate after a structured cursor; no per-run all-person replay. */
export async function nextNativePersonKey(mailbox: string | undefined, cursorValue: string, client?: PoolClient): Promise<NativePersonKey | undefined> {
  const scoped = String(mailbox || "").trim();
  const cursor = decodePersonCursor(cursorValue);
  const params: unknown[] = [];
  const filters = ["COALESCE(t.mailbox,'') <> ''", "COALESCE(t.peer_email,'') <> ''"];
  if (scoped) { params.push(scoped); filters.push(`t.mailbox=$${params.length}`); }
  if (cursor) {
    params.push(cursor.mailbox, cursor.peer_email.toLowerCase());
    filters.push(`(t.mailbox,lower(t.peer_email)) > ($${params.length - 1},$${params.length})`);
  }
  const query = async (filtersForQuery: string[], args: unknown[]) => {
    const result = await (client || postgresConnection()).query<NativePersonKey>(
      `SELECT DISTINCT t.mailbox,lower(t.peer_email) AS peer_email FROM kol_mail_threads t
       WHERE ${filtersForQuery.join(" AND ")} ORDER BY t.mailbox,lower(t.peer_email) LIMIT 1`, args,
    );
    return result.rows[0];
  };
  const after = await query(filters, params);
  if (after) return after;
  if (!cursor) return undefined;
  const wrapped = ["COALESCE(t.mailbox,'') <> ''", "COALESCE(t.peer_email,'') <> ''"];
  const wrapArgs: unknown[] = [];
  if (scoped) { wrapArgs.push(scoped); wrapped.push(`t.mailbox=$${wrapArgs.length}`); }
  return query(wrapped, wrapArgs);
}

/** Exact pending/stale counts, using the same source-fingerprint algorithm as final CAS.
 * This is intentionally diagnostic work after the bounded model loop; it never labels
 * all threads/persons as remaining merely because they exist. */
export async function nativeMailMemoryRemainingCandidates(mailbox?: string): Promise<{ items: number; threads: number; persons: number }> {
  const scoped = String(mailbox || "").trim();
  const db = postgresConnection();
  const itemSql = `SELECT count(*)::text AS n FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
    WHERE btrim(COALESCE(i.body_text,'')) <> '' ${scoped ? "AND COALESCE(t.mailbox,'')=$1" : ""} AND ${itemPendingClause()}`;
  const itemCount = await db.query<{ n: string }>(itemSql, scoped ? [scoped] : []);
  const threads = await db.query<Row>(`SELECT t.* FROM kol_mail_threads t ${scoped ? "WHERE COALESCE(t.mailbox,'')=$1" : ""} ORDER BY t.id`, scoped ? [scoped] : []);
  let staleThreads = 0;
  for (const thread of threads.rows) {
    const source = await db.query<Row>("SELECT * FROM kol_mail_items WHERE thread_id=$1 ORDER BY occurred_at ASC NULLS LAST,created_at ASC,id ASC", [thread.id]);
    const bodies = source.rows.filter((row) => Boolean(String(row.body_text || row.body || row.snippet || "").trim()));
    if (!bodies.length) continue;
    const fingerprint = mailMemorySourceFingerprint(source.rows);
    if (!(String(thread.digest_text || "").trim() && ["codex_memory", "luna"].includes(String(thread.digest_source || ""))
      && String(thread.digest_fingerprint || "") === fingerprint)) staleThreads += 1;
  }
  const people = await db.query<NativePersonKey>(`SELECT DISTINCT t.mailbox,lower(t.peer_email) AS peer_email FROM kol_mail_threads t
    WHERE COALESCE(t.mailbox,'') <> '' AND COALESCE(t.peer_email,'') <> '' ${scoped ? "AND t.mailbox=$1" : ""} ORDER BY t.mailbox,lower(t.peer_email)`, scoped ? [scoped] : []);
  let stalePersons = 0;
  for (const person of people.rows) {
    const source = await db.query<Row>(`SELECT i.* FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
      WHERE COALESCE(t.mailbox,'')=$1 AND (lower(COALESCE(i.from_addr,''))=$2 OR lower(COALESCE(i.to_addr,''))=$2)
      ORDER BY i.occurred_at ASC NULLS LAST,i.created_at ASC,i.id ASC`, [person.mailbox, person.peer_email]);
    const bodies = source.rows.filter((row) => Boolean(String(row.body_text || "").trim()));
    if (!bodies.length) continue;
    const memory = await db.query<Row>("SELECT * FROM kol_mail_person_memory WHERE lower(mailbox)=lower($1) AND lower(peer_email)=lower($2)", [person.mailbox, person.peer_email]);
    const stored = memory.rows[0];
    if (!(stored && String(stored.digest_text || "").trim() && ["codex_memory", "luna"].includes(String(stored.digest_source || ""))
      && String(stored.digest_fingerprint || "") === mailMemorySourceFingerprint(source.rows))) stalePersons += 1;
  }
  return { items: Number(itemCount.rows[0]?.n || 0), threads: staleThreads, persons: stalePersons };
}

export type NativeChunkCheckpoint = {
  item_id: string;
  mailbox: string;
  source_fingerprint: string;
  chunk_count: number;
  completed_chunks: string[];
  last_error: string;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((part): part is string => typeof part === "string") : [];
}

/** Read only a checkpoint whose actual item, current raw body and current mailbox still match. */
export async function readNativeChunkCheckpoint(input: { itemId: string; mailbox: string; sourceFingerprint: string }, client?: PoolClient): Promise<NativeChunkCheckpoint | null> {
  const result = await (client || postgresConnection()).query<Row>(
    `SELECT p.* FROM kol_mail_memory_chunk_progress p
     JOIN kol_mail_items i ON i.id=p.item_id JOIN kol_mail_threads t ON t.id=i.thread_id
     WHERE p.item_id=$1 AND p.mailbox=$2 AND p.source_fingerprint=$3
       AND md5(COALESCE(i.body_text,''))=$3 AND COALESCE(t.mailbox,'')=$2`,
    [input.itemId, input.mailbox, input.sourceFingerprint],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { item_id: String(row.item_id), mailbox: String(row.mailbox), source_fingerprint: String(row.source_fingerprint),
    chunk_count: Number(row.chunk_count || 0), completed_chunks: stringArray(row.completed_chunks), last_error: String(row.last_error || "") };
}

/** Append exactly one new chunk.  The expected prefix makes updates monotonic and
 * rejects another runner, mailbox, source, or chunk-count rather than replacing it. */
export async function writeNativeChunkCheckpoint(input: {
  itemId: string; mailbox: string; sourceFingerprint: string; chunkCount: number;
  completedChunks: string[]; expectedCompletedChunks?: string[]; error?: string;
}, client?: PoolClient): Promise<boolean> {
  const expected = input.expectedCompletedChunks || [];
  if (input.chunkCount < 1 || input.completedChunks.length !== expected.length + 1) return false;
  const result = await (client || postgresConnection()).query(
    `INSERT INTO kol_mail_memory_chunk_progress(item_id,mailbox,source_fingerprint,chunk_count,completed_chunks,last_error,updated_at)
     SELECT i.id,$2,$3,$4,$5::jsonb,$6,now() FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
      WHERE i.id=$1 AND md5(COALESCE(i.body_text,''))=$3 AND COALESCE(t.mailbox,'')=$2
     ON CONFLICT(item_id) DO UPDATE SET mailbox=EXCLUDED.mailbox,source_fingerprint=EXCLUDED.source_fingerprint,
       chunk_count=EXCLUDED.chunk_count,completed_chunks=EXCLUDED.completed_chunks,last_error=EXCLUDED.last_error,updated_at=now()
      WHERE ((kol_mail_memory_chunk_progress.mailbox=$2 AND kol_mail_memory_chunk_progress.source_fingerprint=$3
        AND kol_mail_memory_chunk_progress.chunk_count=$4 AND kol_mail_memory_chunk_progress.completed_chunks=$7::jsonb)
        OR ((kol_mail_memory_chunk_progress.mailbox<>$2 OR kol_mail_memory_chunk_progress.source_fingerprint<>$3)
          AND $7::jsonb='[]'::jsonb AND jsonb_array_length($5::jsonb)=1))
        AND (SELECT md5(COALESCE(body_text,'')) FROM kol_mail_items WHERE id=kol_mail_memory_chunk_progress.item_id)=$3
     RETURNING item_id`,
    [input.itemId,input.mailbox,input.sourceFingerprint,input.chunkCount,JSON.stringify(input.completedChunks),input.error || "",JSON.stringify(expected)],
  );
  return Boolean(result.rowCount);
}

/** Record an error without replacing a prefix that was accepted by a prior turn. */
export async function recordNativeChunkCheckpointError(input: { itemId: string; mailbox: string; sourceFingerprint: string; error: string }, client?: PoolClient): Promise<void> {
  await (client || postgresConnection()).query(
    `UPDATE kol_mail_memory_chunk_progress p SET last_error=$4,updated_at=now()
       FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
      WHERE p.item_id=$1 AND p.mailbox=$2 AND p.source_fingerprint=$3 AND i.id=p.item_id
        AND md5(COALESCE(i.body_text,''))=$3 AND COALESCE(t.mailbox,'')=$2`,
    [input.itemId,input.mailbox,input.sourceFingerprint,input.error.slice(0,120)],
  );
}

export async function clearNativeChunkCheckpoint(input: { itemId: string; mailbox: string; sourceFingerprint: string }, client?: PoolClient): Promise<void> {
  await (client || postgresConnection()).query(
    `DELETE FROM kol_mail_memory_chunk_progress p USING kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
      WHERE p.item_id=$1 AND p.mailbox=$2 AND p.source_fingerprint=$3 AND i.id=p.item_id
        AND md5(COALESCE(i.body_text,''))=$3 AND COALESCE(t.mailbox,'')=$2`,
    [input.itemId, input.mailbox, input.sourceFingerprint],
  );
}
