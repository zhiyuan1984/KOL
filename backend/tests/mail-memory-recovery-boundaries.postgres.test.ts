import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { runMailMemoryIncrement } from "../src/host/mail-memory-job.js";
import {
  listNativePersonItems,
  listNativeThreadItems,
  mailBodyFingerprint,
  mailMemorySourceFingerprint,
  readNativeOnDemandMemory,
  writeNativeOnDemandMemory,
  writeNativePersonMemory,
} from "../src/postgres/mail-memory-repository.js";
import {
  readNativeChunkCheckpoint,
  readNativeMailMemoryProgress,
  writeNativeChunkCheckpoint,
  writeNativeMailMemoryProgress,
} from "../src/postgres/mail-memory-progress-repository.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import {
  classifyMailSourceLanguage,
  isUsableInternalZh,
  splitLongTextForCodex,
} from "../src/starrykol/translate-zh.js";
import { freshTestDatabase } from "./support/pg.js";

/**
 * 明确的合成模型夹具：它只给分片返回可验收的中文，不连接真实模型。
 * 关键点是 adapter 仍委派真实的 translateWithCodexChunksResumable，因此
 * Unicode 切片、进度校验、yield 和合并质量门都走生产算法。
 */
const synthetic = vi.hoisted(() => ({
  chunkCalls: [] as Array<{ body: string; index: number; chunk: string }>,
  onChunk: undefined as undefined | ((input: { body: string; index: number; chunk: string }) => Promise<string | null> | string | null),
  summary: async (_rows: unknown[]): Promise<string[] | null> => ["合成 PostgreSQL 摘要"],
}));

vi.mock("../src/host/mail-summary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/host/mail-summary.js")>();
  return {
    ...actual,
    remoteMailAnalysisEnabled: () => true,
    summarizeWithCodexAppServer: async (rows: unknown[]) => synthetic.summary(rows),
  };
});

vi.mock("../src/starrykol/translate-zh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/starrykol/translate-zh.js")>();
  return {
    ...actual,
    translateMailBodyZhResumable: async (body: string, progress?: Parameters<typeof actual.translateMailBodyZhResumable>[1]) => {
      const chunks = actual.splitLongTextForCodex(body);
      const attempt = await actual.translateWithCodexChunksResumable(body, async (chunk) => {
        const index = chunks.indexOf(chunk);
        synthetic.chunkCalls.push({ body, index, chunk });
        return synthetic.onChunk
          ? await synthetic.onChunk({ body, index, chunk })
          : usableChunkZh(index);
      }, progress);
      // The real provider adapter returns a source only on successful completion.
      return attempt.text
        ? { ...attempt, text: actual.stripInternalZhHeader(attempt.text), source: "codex_memory" }
        : attempt;
    },
  };
});

const at = "2026-10-16T00:00:00.000Z";
const fingerprint = (body: string): string => createHash("md5").update(body).digest("hex");

function usableChunkZh(index: number): string {
  return `第${index + 1}片合成中文翻译已经通过真实分块质量检查并保留内部语义。`;
}

/** Each block is intentionally distinct so chunk -> index observations cannot be ambiguous. */
function longUnicodeBody(label: string): string {
  return `  ${Array.from({ length: 5 }, (_, index) => (
    ` ${label}-segment-${index} 😀🧪 ${String.fromCodePoint(0x1f680 + index)} `
      + String.fromCharCode(65 + index).repeat(3_250)
  )).join("\n")}\n  `;
}

function installIndependentClock(initial = 10_000): { set: (value: number) => void } {
  let value = initial;
  vi.spyOn(Date, "now").mockImplementation(() => value);
  return { set: (next) => { value = next; } };
}

async function insertMail(input: {
  id: string;
  mailbox: string;
  body: string;
  peer?: string;
  translation?: string;
  translationSource?: string;
  summary?: string;
  summarySource?: string;
  memoryFingerprint?: string;
}): Promise<{ threadId: string; conversationId: string; peer: string }> {
  const threadId = `thread_${input.id}`;
  const conversationId = `conversation_${input.id}`;
  const peer = input.peer || `${input.id}@peer.test`;
  await postgresPool().query(
    `INSERT INTO kol_mail_threads(id,conversation_id,subject,mailbox,peer_email,created_at,updated_at,last_at)
     VALUES($1,$2,$3,$4,$5,$6,$6,$6)`,
    [threadId, conversationId, `合成主题 ${input.id}`, input.mailbox, peer, at],
  );
  await postgresPool().query(
    `INSERT INTO kol_mail_items(
       id,thread_id,conversation_id,provider_message_id,direction,from_addr,to_addr,subject,body_text,occurred_at,created_at,
       translation_zh,translation_source,summary,summary_zh,summary_source,memory_fingerprint
     ) VALUES($1,$2,$3,$4,'inbound',$5,$6,$7,$8,$9,$9,$10,$11,$12,$12,$13,$14)`,
    [
      input.id, threadId, conversationId, `provider_${input.id}`, peer, input.mailbox, `合成主题 ${input.id}`,
      input.body, at, input.translation || "", input.translationSource || "", input.summary || "",
      input.summarySource || "", input.memoryFingerprint || "",
    ],
  );
  return { threadId, conversationId, peer };
}

async function itemState(id: string): Promise<{
  body_text: string;
  translation_zh: string | null;
  translation_source: string | null;
  memory_fingerprint: string | null;
  memory_attempts: number;
}> {
  const result = await postgresPool().query<{
    body_text: string;
    translation_zh: string | null;
    translation_source: string | null;
    memory_fingerprint: string | null;
    memory_attempts: number;
  }>("SELECT body_text,translation_zh,translation_source,memory_fingerprint,memory_attempts FROM kol_mail_items WHERE id=$1", [id]);
  if (!result.rows[0]) throw new Error(`missing synthetic item ${id}`);
  return result.rows[0];
}

async function runState(runId: string): Promise<{ status: string; translated: number; errors: number }> {
  const result = await postgresPool().query<{ status: string; translated: number; errors: number }>(
    "SELECT status,translated,errors FROM kol_mail_memory_runs WHERE id=$1",
    [runId],
  );
  if (!result.rows[0]) throw new Error(`missing run ${runId}`);
  return result.rows[0];
}

beforeEach(async () => {
  await freshTestDatabase();
  process.env.CODEX_MODE = "stub";
  delete process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS;
  synthetic.chunkCalls.length = 0;
  synthetic.onChunk = undefined;
  synthetic.summary = async () => ["合成 PostgreSQL 摘要"];
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.CODEX_MODE;
  delete process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS;
  synthetic.chunkCalls.length = 0;
  synthetic.onChunk = undefined;
  await closePostgresPool();
});

describe("邮件记忆恢复边界（真实 PostgreSQL；明确合成模型）", () => {
  it("超过 12000 code points 的原文逐片持久化后让出预算；按下一 phase 回来只补缺片，完整 CAS 后才完成", async () => {
    const mailbox = "long-resume@example.test";
    const body = longUnicodeBody("resume");
    const chunks = splitLongTextForCodex(body);
    expect(Array.from(body).length).toBeGreaterThan(12_000);
    expect(chunks.join("")).toBe(body); // exact Unicode/canonical-byte reconstruction, not a trimmed prefix
    expect(body).toMatch(/^  /u);
    expect(body).toMatch(/\n  $/u);
    await insertMail({ id: "long_resume", mailbox, body });

    const clock = installIndependentClock();
    process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS = "10";
    synthetic.onChunk = async ({ index }) => {
      if (index === 0) clock.set(10_020); // no fake timers or production-threshold mutation
      return usableChunkZh(index);
    };

    const yielded = await runMailMemoryIncrement(mailbox);
    expect(yielded).toMatchObject({
      errors: 0,
      translated: 0,
      chunk_yielded: 1,
      budget_exhausted: true,
      completion_scope: "budget_exhausted",
      remaining_work: true,
      next_phase: "threads",
    });
    expect(yielded.native_run_id).toBeTruthy();
    expect(await runState(yielded.native_run_id!)).toMatchObject({ status: "succeeded", translated: 0, errors: 0 });
    expect(await itemState("long_resume")).toMatchObject({
      body_text: body,
      translation_zh: "",
      memory_fingerprint: "",
      memory_attempts: null,
    });
    expect(await readNativeChunkCheckpoint({ itemId: "long_resume", mailbox, sourceFingerprint: fingerprint(body) }))
      .toMatchObject({ chunk_count: chunks.length, completed_chunks: [usableChunkZh(0)] });
    expect(await readNativeMailMemoryProgress(mailbox)).toMatchObject({ next_phase: "threads", item_cursor: "" });

    const callsBeforeResume = synthetic.chunkCalls.length;
    clock.set(20_000);
    synthetic.onChunk = async ({ index }) => usableChunkZh(index);
    const completed = await runMailMemoryIncrement(mailbox);
    const resumeIndexes = synthetic.chunkCalls.slice(callsBeforeResume).map((call) => call.index);
    expect(completed).toMatchObject({ phase: "threads", errors: 0, translated: 1 });
    expect(resumeIndexes).toEqual(chunks.map((_chunk, index) => index).slice(1));

    expect(await itemState("long_resume")).toMatchObject({
      body_text: body,
      translation_source: "codex_memory",
      memory_fingerprint: fingerprint(body),
      memory_attempts: 1,
    });
    expect((await itemState("long_resume")).translation_zh).toContain("第1片合成中文翻译");
    expect(await readNativeChunkCheckpoint({ itemId: "long_resume", mailbox, sourceFingerprint: fingerprint(body) })).toBeNull();
    expect(await readNativeMailMemoryProgress(mailbox)).toMatchObject({ item_cursor: "long_resume" });
    expect(await runState(completed.native_run_id!)).toMatchObject({ status: "succeeded", translated: 1, errors: 0 });
  });

  it("中间分片返回 null 时保留已经提交的真实前缀，下一轮只重试失败/缺失片，失败 run 与 audit 计数一致", async () => {
    const mailbox = "null-chunk@example.test";
    const body = longUnicodeBody("null-middle");
    const chunks = splitLongTextForCodex(body);
    await insertMail({ id: "null_middle", mailbox, body });

    const clock = installIndependentClock(30_000);
    process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS = "10";
    synthetic.onChunk = async ({ index }) => {
      if (index === 1) {
        return null;
      }
      return usableChunkZh(index);
    };
    // Let prepareItemMemory write the null-chunk error and its partial prefix first.
    // The real fallback summary runs after that model result and only then consumes
    // this bounded turn's soft budget, avoiding a fabricated error receipt.
    synthetic.summary = async () => {
      clock.set(30_020);
      return ["null 分片后的合成摘要"];
    };
    const failed = await runMailMemoryIncrement(mailbox);
    expect(failed).toMatchObject({ errors: 1, translated: 0, completion_scope: "budget_exhausted_with_errors" });
    expect(await readNativeChunkCheckpoint({ itemId: "null_middle", mailbox, sourceFingerprint: fingerprint(body) }))
      .toMatchObject({ completed_chunks: [usableChunkZh(0)], last_error: "codex_chunk_unavailable" });
    expect(await itemState("null_middle")).toMatchObject({
      translation_source: "pending",
      memory_fingerprint: fingerprint(body),
      memory_attempts: 1,
    });
    expect(await runState(failed.native_run_id!)).toMatchObject({ status: "failed", translated: 0, errors: 1 });
    const failureAudit = await postgresPool().query<{ errors: number }>(
      "SELECT (payload::jsonb->>'errors')::int AS errors FROM audit_events WHERE event_type='mail_memory.increment' ORDER BY id DESC LIMIT 1",
    );
    expect(failureAudit.rows[0]).toMatchObject({ errors: 1 });

    const callsBeforeRetry = synthetic.chunkCalls.length;
    clock.set(40_000);
    synthetic.onChunk = async ({ index }) => usableChunkZh(index);
    const recovered = await runMailMemoryIncrement(mailbox);
    const retryIndexes = synthetic.chunkCalls.slice(callsBeforeRetry).map((call) => call.index);
    expect(recovered).toMatchObject({ errors: 0, translated: 1 });
    expect(retryIndexes).toEqual(chunks.map((_chunk, index) => index).slice(1));
    expect(await readNativeChunkCheckpoint({ itemId: "null_middle", mailbox, sourceFingerprint: fingerprint(body) })).toBeNull();
    expect(await itemState("null_middle")).toMatchObject({ translation_source: "codex_memory", memory_attempts: 2 });
    expect(await runState(recovered.native_run_id!)).toMatchObject({ status: "succeeded", translated: 1, errors: 0 });
  });

  it("正文空白/邮箱范围变更使旧 checkpoint 与 actor cache 均不可复用；竞争或反向 prefix 不能覆盖；源 CAS 拒绝不计译文", async () => {
    const oldMailbox = "old-scope@example.test";
    const newMailbox = "new-scope@example.test";
    const original = longUnicodeBody("scope-original");
    const rebuilt = `${original} `; // a whitespace-only source correction is still a new version
    const oldChunks = splitLongTextForCodex(original);
    const { conversationId } = await insertMail({ id: "scope_item", mailbox: oldMailbox, body: original });
    const oldFingerprint = fingerprint(original);
    expect(await writeNativeChunkCheckpoint({
      itemId: "scope_item", mailbox: oldMailbox, sourceFingerprint: oldFingerprint, chunkCount: oldChunks.length,
      completedChunks: ["可信旧第零片"], expectedCompletedChunks: [],
    })).toBe(true);
    expect(await writeNativeChunkCheckpoint({
      itemId: "scope_item", mailbox: oldMailbox, sourceFingerprint: oldFingerprint, chunkCount: oldChunks.length,
      completedChunks: ["可信旧第零片", "可信旧第一片"], expectedCompletedChunks: ["可信旧第零片"],
    })).toBe(true);
    // Same-index contender and a stale/reversed first prefix both lose their CAS.
    expect(await writeNativeChunkCheckpoint({
      itemId: "scope_item", mailbox: oldMailbox, sourceFingerprint: oldFingerprint, chunkCount: oldChunks.length,
      completedChunks: ["可信旧第零片", "竞争者第一片"], expectedCompletedChunks: ["可信旧第零片"],
    })).toBe(false);
    expect(await writeNativeChunkCheckpoint({
      itemId: "scope_item", mailbox: oldMailbox, sourceFingerprint: oldFingerprint, chunkCount: oldChunks.length,
      completedChunks: ["反向覆盖前缀"], expectedCompletedChunks: [],
    })).toBe(false);
    expect(await readNativeChunkCheckpoint({ itemId: "scope_item", mailbox: oldMailbox, sourceFingerprint: oldFingerprint }))
      .toMatchObject({ completed_chunks: ["可信旧第零片", "可信旧第一片"] });

    await writeNativeOnDemandMemory("old_actor", `mail_translation_memory:${oldMailbox}:${conversationId}:scope_item`, {
      status: "已完成", mailbox: oldMailbox, subject: "旧 scope", conversation_id: conversationId,
      message_id: "scope_item", text: "旧 actor 的译文", fingerprint: oldFingerprint,
    });
    await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id='scope_item'", [rebuilt]);
    await postgresPool().query("UPDATE kol_mail_threads SET mailbox=$1 WHERE id='thread_scope_item'", [newMailbox]);
    expect(await readNativeChunkCheckpoint({ itemId: "scope_item", mailbox: oldMailbox, sourceFingerprint: oldFingerprint })).toBeNull();
    expect(await readNativeOnDemandMemory("new_actor", `mail_translation_memory:${newMailbox}:${conversationId}:scope_item`)).toBeNull();

    const clock = installIndependentClock(50_000);
    process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS = "10";
    synthetic.onChunk = async ({ index }) => {
      if (index === 0) clock.set(50_020);
      return usableChunkZh(index);
    };
    const rebuiltRun = await runMailMemoryIncrement(newMailbox);
    expect(rebuiltRun).toMatchObject({ translated: 0, errors: 0, chunk_yielded: 1, budget_exhausted: true });
    expect(synthetic.chunkCalls.map((call) => call.index)).toEqual([0]); // rebuilt from chunk zero, never old prefix 2
    expect(await readNativeChunkCheckpoint({ itemId: "scope_item", mailbox: newMailbox, sourceFingerprint: fingerprint(rebuilt) }))
      .toMatchObject({ completed_chunks: [usableChunkZh(0)] });

    const casMailbox = "source-cas@example.test";
    const casBody = longUnicodeBody("source-cas");
    await insertMail({ id: "source_cas", mailbox: casMailbox, body: casBody });
    clock.set(60_000);
    synthetic.chunkCalls.length = 0;
    synthetic.onChunk = async ({ index, body }) => {
      if (index === 0) {
        await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id='source_cas'", [`${body} changed-during-model`]);
        clock.set(60_020);
      }
      return usableChunkZh(index);
    };
    const casRejected = await runMailMemoryIncrement(casMailbox);
    expect(casRejected).toMatchObject({ translated: 0, errors: 0, source_changed: 1, budget_exhausted: true });
    expect(await itemState("source_cas")).toMatchObject({
      translation_zh: "",
      memory_fingerprint: "",
      memory_attempts: null,
    });
  });

  it("最终 item/CAS/clear/progress/run checkpoint 是同一 SQL 事务：checkpoint 故障回滚最终写入但保留独立前缀并可恢复", async () => {
    const mailbox = "atomic-final@example.test";
    const body = longUnicodeBody("atomic-final");
    const chunks = splitLongTextForCodex(body);
    await insertMail({ id: "atomic_item", mailbox, body });

    const clock = installIndependentClock(70_000);
    process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS = "10";
    synthetic.onChunk = async ({ index }) => {
      if (index === 0) clock.set(70_020);
      return usableChunkZh(index);
    };
    await runMailMemoryIncrement(mailbox);
    expect(await readNativeChunkCheckpoint({ itemId: "atomic_item", mailbox, sourceFingerprint: fingerprint(body) }))
      .toMatchObject({ completed_chunks: [usableChunkZh(0)] });

    // Force the next invocation directly back to items so the fault is precisely in final persistence.
    const progress = await readNativeMailMemoryProgress(mailbox);
    await writeNativeMailMemoryProgress({ ...progress, next_phase: "items" });
    const beforeFaultProgress = await readNativeMailMemoryProgress(mailbox);
    await postgresPool().query(
      `CREATE FUNCTION fail_running_memory_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.status='running' THEN RAISE EXCEPTION 'synthetic checkpoint rollback'; END IF;
         RETURN NEW;
       END $$`,
    );
    await postgresPool().query(
      "CREATE TRIGGER fail_running_memory_checkpoint BEFORE UPDATE ON kol_mail_memory_runs FOR EACH ROW EXECUTE FUNCTION fail_running_memory_checkpoint()",
    );

    clock.set(80_000);
    synthetic.chunkCalls.length = 0;
    synthetic.onChunk = async ({ index }) => usableChunkZh(index);
    await expect(runMailMemoryIncrement(mailbox)).rejects.toThrow("synthetic checkpoint rollback");
    // The per-chunk commits happened outside the failed final transaction; final item/cursor writes did not.
    expect(await itemState("atomic_item")).toMatchObject({ translation_zh: "", memory_fingerprint: "", memory_attempts: null });
    expect(await readNativeMailMemoryProgress(mailbox)).toEqual(beforeFaultProgress);
    expect(await readNativeChunkCheckpoint({ itemId: "atomic_item", mailbox, sourceFingerprint: fingerprint(body) }))
      .toMatchObject({ completed_chunks: chunks.map((_chunk, index) => usableChunkZh(index)) });

    await postgresPool().query("DROP TRIGGER fail_running_memory_checkpoint ON kol_mail_memory_runs");
    await postgresPool().query("DROP FUNCTION fail_running_memory_checkpoint()");
    clock.set(90_000);
    synthetic.chunkCalls.length = 0;
    const retried = await runMailMemoryIncrement(mailbox);
    expect(retried).toMatchObject({ errors: 0, translated: 1 });
    expect(synthetic.chunkCalls).toEqual([]); // real resumable algorithm consumes durable completed chunks, not model replays
    expect(await itemState("atomic_item")).toMatchObject({ translation_source: "codex_memory", memory_fingerprint: fingerprint(body), memory_attempts: 1 });
    expect(await readNativeChunkCheckpoint({ itemId: "atomic_item", mailbox, sourceFingerprint: fingerprint(body) })).toBeNull();
  });

  it("finish audit 失败时没有伪造的 succeeded audit event，run 留下真实 failed 状态", async () => {
    await postgresPool().query(
      `CREATE FUNCTION fail_mail_memory_finish_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.event_type='mail_memory.increment' THEN RAISE EXCEPTION 'synthetic finish audit failure'; END IF;
         RETURN NEW;
       END $$`,
    );
    await postgresPool().query(
      "CREATE TRIGGER fail_mail_memory_finish_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_mail_memory_finish_audit()",
    );
    await expect(runMailMemoryIncrement("audit-fault@example.test")).rejects.toThrow("synthetic finish audit failure");
    const runs = await postgresPool().query<{ status: string; errors: number }>(
      "SELECT status,errors FROM kol_mail_memory_runs WHERE mailbox=$1",
      ["audit-fault@example.test"],
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ status: "failed", errors: 1 });
    expect(await postgresPool().query("SELECT 1 FROM audit_events WHERE event_type='mail_memory.increment'")).toMatchObject({ rowCount: 0 });
  });

  it("旧成功 thread/person digest 在 provider 失败时保留文本/指纹并标失败；成员变化 CAS 拒绝在真实 run/audit 留痕", async () => {
    const clock = installIndependentClock(100_000);
    process.env.MAIL_MEMORY_INCREMENT_BUDGET_MS = "10";
    synthetic.summary = async () => {
      clock.set(100_020);
      return null;
    };

    const staleMailbox = "stale-thread@example.test";
    const stale = await insertMail({ id: "stale_thread", mailbox: staleMailbox, body: "Original English source before a correction." });
    const oldThreadFingerprint = mailMemorySourceFingerprint(await listNativeThreadItems(stale.threadId));
    await postgresPool().query(
      "UPDATE kol_mail_threads SET digest_text=$1,digest_source='codex_memory',digest_fingerprint=$2 WHERE id=$3",
      ["可信旧线程摘要", oldThreadFingerprint, stale.threadId],
    );
    await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id=$2", ["Corrected source needs refresh.", "stale_thread"]);
    await writeNativeMailMemoryProgress({ mailbox: staleMailbox, next_phase: "threads", item_cursor: "", thread_cursor: "", person_cursor: "" });
    const staleFailed = await runMailMemoryIncrement(staleMailbox);
    expect(staleFailed).toMatchObject({ errors: 1, provider_failed: true, completion_scope: "provider_failed" });
    const staleThread = await postgresPool().query<{ digest_text: string; digest_source: string; digest_fingerprint: string; digest_error: string }>(
      "SELECT digest_text,digest_source,digest_fingerprint,digest_error FROM kol_mail_threads WHERE id=$1", [stale.threadId],
    );
    expect(staleThread.rows[0]).toMatchObject({
      digest_text: "可信旧线程摘要", digest_source: "codex_memory", digest_fingerprint: oldThreadFingerprint, digest_error: "unavailable",
    });
    expect(await runState(staleFailed.native_run_id!)).toMatchObject({ status: "failed", errors: 1 });

    const changedMailbox = "member-change@example.test";
    const changed = await insertMail({ id: "member_change", mailbox: changedMailbox, body: "Membership version one." });
    const changedOldFingerprint = mailMemorySourceFingerprint(await listNativeThreadItems(changed.threadId));
    await postgresPool().query(
      "UPDATE kol_mail_threads SET digest_text=$1,digest_source='codex_memory',digest_fingerprint=$2 WHERE id=$3",
      ["不可覆盖的旧摘要", changedOldFingerprint, changed.threadId],
    );
    clock.set(110_000);
    synthetic.summary = async () => {
      await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id='member_change'", ["Membership version two changed while provider failed."]);
      clock.set(110_020);
      return null;
    };
    await writeNativeMailMemoryProgress({ mailbox: changedMailbox, next_phase: "threads", item_cursor: "", thread_cursor: "", person_cursor: "" });
    const casFailed = await runMailMemoryIncrement(changedMailbox);
    expect(casFailed).toMatchObject({ errors: 1, source_changed: 1, provider_failed: true });
    expect(await runState(casFailed.native_run_id!)).toMatchObject({ status: "failed", errors: 1 });
    expect((await postgresPool().query<{ digest_text: string; digest_fingerprint: string }>(
      "SELECT digest_text,digest_fingerprint FROM kol_mail_threads WHERE id=$1", [changed.threadId],
    )).rows[0]).toMatchObject({ digest_text: "不可覆盖的旧摘要", digest_fingerprint: changedOldFingerprint });
    const changedAudit = await postgresPool().query<{ errors: number; source_changed: number }>(
      "SELECT (payload::jsonb->>'errors')::int AS errors,(payload::jsonb->>'source_changed')::int AS source_changed FROM audit_events WHERE event_type='mail_memory.increment' AND payload::jsonb->>'mailbox'=$1 ORDER BY id DESC LIMIT 1",
      [changedMailbox],
    );
    expect(changedAudit.rows[0]).toMatchObject({ errors: 1, source_changed: 1 });

    const personMailbox = "stale-person@example.test";
    const person = await insertMail({ id: "stale_person", mailbox: personMailbox, body: "Person digest original source.", peer: "person@peer.test" });
    const oldPersonFingerprint = mailMemorySourceFingerprint(await listNativePersonItems(personMailbox, person.peer));
    await writeNativePersonMemory({
      id: "old_person_memory", mailbox: personMailbox, peerEmail: person.peer,
      text: "可信旧人员摘要", source: "codex_memory", fingerprint: oldPersonFingerprint, mailCount: 1,
    });
    // The current source becomes stale after the prior successful person digest;
    // a failed provider refresh must preserve that old successful content/fingerprint.
    await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id='stale_person'", ["Person digest corrected source requires refresh."]);
    clock.set(120_000);
    synthetic.summary = async () => {
      clock.set(120_020);
      return null;
    };
    await writeNativeMailMemoryProgress({ mailbox: personMailbox, next_phase: "persons", item_cursor: "", thread_cursor: "", person_cursor: "" });
    const personFailed = await runMailMemoryIncrement(personMailbox);
    expect(personFailed).toMatchObject({ errors: 1, provider_failed: true, translated: 0 });
    const storedPerson = await postgresPool().query<{ digest_text: string; digest_source: string; digest_fingerprint: string; error: string }>(
      "SELECT digest_text,digest_source,digest_fingerprint,error FROM kol_mail_person_memory WHERE mailbox=$1 AND peer_email=$2",
      [personMailbox, person.peer],
    );
    expect(storedPerson.rows[0]).toMatchObject({
      digest_text: "可信旧人员摘要", digest_source: "codex_memory", digest_fingerprint: oldPersonFingerprint, error: "unavailable",
    });
    expect(await runState(personFailed.native_run_id!)).toMatchObject({ status: "failed", errors: 1 });
  });

  it("翻译质量边界：保留姓名/品牌/短 URL 合法，中文来源不调模型，混合实质英文调模型，短 Thanks 可译为 谢谢", async () => {
    const sourceWithIdentity = "Hello Alex, visit https://x.co/LiTime today.";
    const zhWithIdentity = "您好，Alex，请访问 https://x.co/LiTime 查看 LiTime 的合作资料。谢谢。";
    expect(isUsableInternalZh(zhWithIdentity, sourceWithIdentity)).toBe(true);
    const longEnglish = "Please review the campaign proposal and confirm the deliverables before Friday morning.";
    expect(isUsableInternalZh(`中文前缀：${longEnglish}`, longEnglish)).toBe(false);
    expect(isUsableInternalZh("谢谢", "Thanks")).toBe(true);
    expect(classifyMailSourceLanguage("这是纯中文正文，标点和数字 2026 均合法。")).toMatchObject({ kind: "source_zh" });
    expect(classifyMailSourceLanguage("这是中文说明，但 please send the rate card 仍是实质英文。")).toMatchObject({ kind: "needs_model" });

    const mailbox = "quality-language@example.test";
    await insertMail({ id: "a_source_zh", mailbox, body: "这是纯中文正文，不能伪装成模型翻译。" });
    await insertMail({ id: "b_mixed_model", mailbox, body: "这是中文说明，但 please send the rate card 仍是实质英文。" });
    synthetic.chunkCalls.length = 0;
    const stats = await runMailMemoryIncrement(mailbox);
    expect(stats).toMatchObject({ errors: 0, source_chinese: 1, translated: 1 });
    const rows = await postgresPool().query<{ id: string; translation_source: string; translation_zh: string | null }>(
      "SELECT id,translation_source,translation_zh FROM kol_mail_items WHERE id IN ('a_source_zh','b_mixed_model') ORDER BY id",
    );
    expect(rows.rows[0]).toMatchObject({ id: "a_source_zh", translation_source: "source_zh", translation_zh: null });
    expect(rows.rows[1]).toMatchObject({ id: "b_mixed_model", translation_source: "codex_memory" });
    expect(synthetic.chunkCalls).toHaveLength(1);
    expect(synthetic.chunkCalls[0]?.body).toContain("please send the rate card");
  });
});
