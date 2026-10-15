import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resetConn } from "../src/db.js";
import { readOnDemandMemory, runMailMemoryIncrement, triggerMailTranslateSkill } from "../src/host/mail-memory-job.js";
import { acquireMailMemoryIncrementLock } from "../src/host/mail-memory-run-lock.js";
import { CRON_HANDLERS } from "../src/cron/handlers.js";
import { listNativeMemoryItems, mailBodyFingerprint, readNativeOnDemandMemory, writeNativeItemMemoryIfFresh, writeNativeOnDemandMemory } from "../src/postgres/mail-memory-repository.js";
import { applyPostgresMigrations } from "../src/postgres/migrations.js";
import { closePostgresPool, postgresPool, postgresTransaction } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";

const box = "memory-regression@example.test";
const rawFingerprint = (body: string): string => createHash("md5").update(body).digest("hex");

async function insertThreadAndItem(input: {
  id: string;
  body: string;
  attempts?: number;
  occurredAt?: string;
  translation?: string;
  translationSource?: string;
  summary?: string;
  summarySource?: string;
  fingerprint?: string;
}): Promise<void> {
  const db = postgresPool();
  const now = input.occurredAt || "2026-01-01T00:00:00.000Z";
  const threadId = `thr_${input.id}`;
  await db.query(
    `INSERT INTO kol_mail_threads(id,conversation_id,subject,mailbox,peer_email,created_at,updated_at,last_at)
     VALUES($1,$2,'Memory regression',$3,'peer@example.test',$4,$4,$4)`,
    [threadId, `conv_${input.id}`, box, now],
  );
  await db.query(
    `INSERT INTO kol_mail_items(id,thread_id,conversation_id,provider_message_id,direction,subject,body_text,occurred_at,created_at,
      translation_zh,translation_source,summary,summary_zh,summary_source,memory_fingerprint,memory_attempts)
     VALUES($1,$2,$3,$4,'inbound','Memory regression',$5,$6,$6,$7,$8,$9,$9,$10,$11,$12)`,
    [input.id, threadId, `conv_${input.id}`, `provider_${input.id}`, input.body, now,
      input.translation || "", input.translationSource || "", input.summary || "", input.summarySource || "",
      input.fingerprint || "", input.attempts || 0],
  );
}

beforeEach(async () => {
  await freshTestDatabase();
  process.env.CODEX_MODE = "stub";
  process.env.INTENT_LLM_MODE = "stub";
  delete process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS;
});

afterEach(async () => {
  delete process.env.CODEX_MODE;
  delete process.env.INTENT_LLM_MODE;
  delete process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS;
  await resetConn();
  await closePostgresPool();
});

describe("mail-memory incremental remediation (dedicated PostgreSQL)", () => {
  it("creates the actor-scoped cache through the formal 048 manifest and keeps actor caches isolated", async () => {
    const db = postgresPool();
    await db.query("DROP TABLE kol_mail_memory_cache");
    await db.query("DELETE FROM schema_migrations WHERE id=$1", ["20261015_048_mail_memory_cache_native_schema"]);
    await db.query("DELETE FROM app_schema_migrations WHERE id=$1", ["20261015_048_mail_memory_cache_native_schema"]);
    const client = await db.connect();
    try {
      const completed = await applyPostgresMigrations(client, { only: "20261015_048_mail_memory_cache_native_schema" });
      expect(completed).toContain("20261015_048_mail_memory_cache_native_schema");
    } finally {
      client.release();
    }
    expect((await db.query<{ cache: string | null }>("SELECT to_regclass('public.kol_mail_memory_cache') AS cache")).rows[0]?.cache).toBe("kol_mail_memory_cache");
    const value = { status: "已完成" as const, mailbox: box, subject: "cache", conversation_id: "conv_cache", text: "only actor A", fingerprint: "fp" };
    await writeNativeOnDemandMemory("actor_a", "mail_summary_memory:cache", value);
    expect(await readNativeOnDemandMemory("actor_a", "mail_summary_memory:cache")).toMatchObject({ text: "only actor A" });
    expect(await readNativeOnDemandMemory("actor_b", "mail_summary_memory:cache")).toBeNull();
  });

  it("uses raw body bytes for CAS and fairly selects only untrusted pending records", async () => {
    const raw = "  source body with intentional edges  \n";
    await insertThreadAndItem({ id: "cas", body: raw, attempts: 1 });
    expect(mailBodyFingerprint(raw)).toBe(rawFingerprint(raw));
    expect(await writeNativeItemMemoryIfFresh({
      itemId: "cas", body: raw, translationZh: "真实译文", translationSource: "codex_memory",
      summary: "真实摘要", summaryZh: "真实摘要", summarySource: "codex_memory", source: "codex_memory",
    })).toBe(true);
    const saved = await postgresPool().query<{ body_fingerprint: string; memory_attempts: number }>(
      "SELECT body_fingerprint,memory_attempts FROM kol_mail_items WHERE id='cas'",
    );
    expect(saved.rows[0]).toMatchObject({ body_fingerprint: rawFingerprint(raw), memory_attempts: 2 });
    expect(await writeNativeItemMemoryIfFresh({
      itemId: "cas", body: raw.trim(), translationZh: "不应写入", translationSource: "codex_memory",
    })).toBe(false);
    const afterStaleWrite = await postgresPool().query<{ translation_zh: string; memory_attempts: number }>(
      "SELECT translation_zh,memory_attempts FROM kol_mail_items WHERE id='cas'",
    );
    expect(afterStaleWrite.rows[0]).toMatchObject({ translation_zh: "真实译文", memory_attempts: 2 });

    const trustedBody = "trusted source";
    await insertThreadAndItem({
      id: "trusted", body: trustedBody, attempts: 0, translation: "可信译文", translationSource: "codex_memory",
      summary: "可信摘要", summarySource: "codex_memory", fingerprint: mailBodyFingerprint(trustedBody),
    });
    const pendingOldBody = "old pending source";
    await insertThreadAndItem({
      id: "pending_old", body: pendingOldBody, attempts: 0, occurredAt: "2024-01-01T00:00:00.000Z",
      translation: "旧译文不能因 pending 被信任", translationSource: "pending", summary: "可信摘要", summarySource: "codex_memory",
      fingerprint: mailBodyFingerprint(pendingOldBody),
    });
    await insertThreadAndItem({ id: "pending_new", body: "new pending", attempts: 0, occurredAt: "2025-01-01T00:00:00.000Z" });
    await insertThreadAndItem({ id: "pending_retried", body: "retried pending", attempts: 7, occurredAt: "2020-01-01T00:00:00.000Z" });

    const pending = await listNativeMemoryItems({ mailbox: box, pendingOnly: true, limit: 20 });
    const ids = pending.map((row) => String(row.id));
    expect(ids).not.toContain("trusted");
    expect(ids).toContain("pending_old");
    expect(ids.indexOf("pending_old")).toBeLessThan(ids.indexOf("pending_retried"));
    expect(ids.indexOf("pending_new")).toBeLessThan(ids.indexOf("pending_retried"));
  });

  it("uses a real PostgreSQL session advisory lock and never escapes an ambient transaction", async () => {
    const lock = await acquireMailMemoryIncrementLock();
    expect(lock).not.toBeNull();
    const contender = await postgresPool().connect();
    try {
      const result = await contender.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", ["-402819783216001093"]);
      expect(result.rows[0]?.locked).toBe(false);
    } finally {
      contender.release();
    }
    const runsBefore = await postgresPool().query<{ count: string }>("SELECT count(*)::text AS count FROM kol_mail_memory_runs");
    const skipped = await runMailMemoryIncrement(box);
    expect(skipped).toMatchObject({ completion_scope: "skipped_lock_contended", skipped: 1, remaining_work: "unknown", persisted: 0 });
    const runsAfter = await postgresPool().query<{ count: string }>("SELECT count(*)::text AS count FROM kol_mail_memory_runs");
    expect(runsAfter.rows[0]?.count).toBe(runsBefore.rows[0]?.count);
    await lock!.release();
    const reacquired = await acquireMailMemoryIncrementLock();
    expect(reacquired).not.toBeNull();
    await reacquired!.release();
    await expect(postgresTransaction(async () => acquireMailMemoryIncrementLock())).rejects.toThrow("mail_memory_increment_cannot_run_inside_transaction");
  });

  it("returns a bounded, remaining-work receipt before any model call when the soft budget is exhausted", async () => {
    await insertThreadAndItem({ id: "budget_pending", body: "mail queued for later" });
    process.env.CODEX_MODE = "real";
    process.env.INTENT_LLM_MODE = "real";
    process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS = "0";
    const stats = await runMailMemoryIncrement(box);
    expect(stats).toMatchObject({ completion_scope: "budget_exhausted", budget_exhausted: true, remaining_work: true, scanned: 0, errors: 0, persisted: 0 });
    const row = await postgresPool().query<{ translation_zh: string; summary: string }>("SELECT translation_zh,summary FROM kol_mail_items WHERE id='budget_pending'");
    expect(row.rows[0]).toMatchObject({ translation_zh: "", summary: "" });
  });

  it("records an on-demand provider failure as 未开始, never as a completed translation", async () => {
    // No fake model success: both model modes are stub, so this is the real failure-state path on an isolated PG DB.
    await seedAll();
    await seedWorkbenchFixtures();
    await insertThreadAndItem({ id: "ondemand_pending", body: "a selected mail that cannot be translated while provider is disabled" });
    const stats = await triggerMailTranslateSkill(box, "ondemand_pending");
    expect(stats).toMatchObject({ translated: 0, errors: 1 });
    const stored = await readOnDemandMemory(`mail_translation_memory:${box}:conv_ondemand_pending:ondemand_pending`);
    expect(stored).toMatchObject({ status: "未开始", text: "" });
    expect(stored?.completed_at).toBeUndefined();
  });

  it("marks provider-disabled work failed instead of returning a false cron success", async () => {
    await insertThreadAndItem({ id: "disabled_pending", body: "cannot call provider in this test" });
    const result = await CRON_HANDLERS["mail-memory-increment"]({
      job: { condition_json: "{}" }, run: { id: "test_cron_run" }, actor: "system",
    });
    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("mail_memory_increment_failed");
    expect(result.receipt).toMatchObject({ side_effect: "none", provider_failed: true, completion_scope: "provider_failed" });
  });
});
