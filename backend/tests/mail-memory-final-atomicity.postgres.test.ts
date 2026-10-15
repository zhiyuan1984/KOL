import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { withScopedUser, type AppUser } from "../src/auth.js";
import {
  runMailMemoryIncrement,
  triggerMailSummarySkill,
  triggerMailTranslateSkill,
} from "../src/host/mail-memory-job.js";
import {
  listNativeThreadItems,
  mailMemorySourceFingerprint,
  readNativeOnDemandMemory,
} from "../src/postgres/mail-memory-repository.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
import { setIntentLlmFetch } from "../src/tasks/openai-intent.js";

/**
 * 非真实模型证据：cron 摘要函数被明确的合成夹具替换。它可暂停在
 * “模型进行中”，使测试在真实 PostgreSQL 的 CAS 写入前改变来源。
 */
const syntheticCronModel = vi.hoisted(() => ({
  summarize: async (_rows: unknown[]): Promise<string[] | null> => ["合成 cron 摘要"],
}));

vi.mock("../src/host/mail-summary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/host/mail-summary.js")>();
  return {
    ...actual,
    summarizeWithCodexAppServer: async (rows: unknown[]) => syntheticCronModel.summarize(rows),
  };
});

const box = "atomic-memory@example.test";
const actor = (id: string): AppUser => ({
  id,
  username: id,
  name: id,
  handle: id,
  roles: ["employee"],
  role: "employee",
  brands: [],
  site: "",
  manager_user_id: null,
  active: true,
  exam_passed: true,
  exam_todo_count: 0,
  exam_module: "测试",
});

const response = (payload: Record<string, string>): Response => new Response(
  JSON.stringify({ output_text: JSON.stringify(payload) }),
  { status: 200, headers: { "Content-Type": "application/json" } },
);

async function insertMail(input: {
  id: string;
  body: string;
  peer?: string;
  subject?: string;
  direction?: "inbound" | "outbound";
  trustedItemMemory?: boolean;
}): Promise<{ threadId: string; conversationId: string }> {
  const db = postgresPool();
  const threadId = `thread_${input.id}`;
  const conversationId = `conversation_${input.id}`;
  const at = "2026-10-01T00:00:00.000Z";
  const trusted = Boolean(input.trustedItemMemory);
  const fingerprint = trusted
    ? createHash("md5").update(input.body).digest("hex")
    : "";
  await db.query(
    `INSERT INTO kol_mail_threads(id,conversation_id,subject,mailbox,peer_email,created_at,updated_at,last_at)
     VALUES($1,$2,$3,$4,$5,$6,$6,$6)`,
    [threadId, conversationId, input.subject || "原子性主题", box, input.peer ?? "peer@example.test", at],
  );
  await db.query(
    `INSERT INTO kol_mail_items(id,thread_id,conversation_id,provider_message_id,direction,from_addr,to_addr,subject,body_text,occurred_at,created_at,
      translation_zh,translation_source,summary,summary_zh,summary_source,memory_fingerprint)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$13,$14,$15)`,
    [
      input.id,
      threadId,
      conversationId,
      `provider_${input.id}`,
      input.direction || "inbound",
      input.peer ?? "peer@example.test",
      box,
      input.subject || "原子性主题",
      input.body,
      at,
      trusted ? "可信中文译文" : "",
      trusted ? "codex_memory" : "",
      trusted ? "可信邮件摘要" : "",
      trusted ? "codex_memory" : "",
      fingerprint,
    ],
  );
  return { threadId, conversationId };
}

async function readThread(threadId: string): Promise<{ digest_text: string; digest_source: string; digest_fingerprint: string }> {
  const result = await postgresPool().query<{ digest_text: string; digest_source: string; digest_fingerprint: string }>(
    "SELECT digest_text,digest_source,digest_fingerprint FROM kol_mail_threads WHERE id=$1",
    [threadId],
  );
  return result.rows[0] || { digest_text: "", digest_source: "", digest_fingerprint: "" };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

beforeEach(async () => {
  await freshTestDatabase();
  process.env.CODEX_MODE = "stub";
  process.env.INTENT_LLM_MODE = "real";
  process.env.OPENAI_API_KEY = "sk-synthetic-mail-memory";
  process.env.OPENAI_BASE_URL = "https://example.invalid/v1";
  syntheticCronModel.summarize = async () => ["合成 cron 摘要"];
  setIntentLlmFetch();
});

afterEach(async () => {
  setIntentLlmFetch();
  delete process.env.CODEX_MODE;
  delete process.env.INTENT_LLM_MODE;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  await closePostgresPool();
});

describe("邮件记忆最终原子性（真实 PostgreSQL；显式合成模型夹具）", () => {
  it("按需翻译保留带前后空白的原始 body_text 作为 MD5 CAS 输入", async () => {
    const raw = "  原始邮件正文，前后空白必须参与 CAS。  \n";
    const { conversationId } = await insertMail({ id: "raw_whitespace", body: raw });
    setIntentLlmFetch(async () => response({ zh: "这是一段足够长度的合成中文翻译文本。" }));

    const stats = await withScopedUser(actor("actor_raw"), () => triggerMailTranslateSkill(box, "raw_whitespace"));
    expect(stats).toMatchObject({ translated: 1, errors: 0 });
    const saved = await postgresPool().query<{ body_fingerprint: string; translation_zh: string }>(
      "SELECT body_fingerprint,translation_zh FROM kol_mail_items WHERE id=$1",
      ["raw_whitespace"],
    );
    expect(saved.rows[0]).toMatchObject({
      body_fingerprint: createHash("md5").update(raw).digest("hex"),
      translation_zh: "这是一段足够长度的合成中文翻译文本。",
    });
    expect(await readNativeOnDemandMemory("actor_raw", `mail_translation_memory:${box}:${conversationId}:raw_whitespace`))
      .toMatchObject({ status: "已完成" });
  });

  it("模型期间来源变化时不完成共享摘要或 actor cache，旧摘要也不会冒充新完成", async () => {
    const { threadId, conversationId } = await insertMail({ id: "summary_cas", body: "模型开始时的正文" });
    await postgresPool().query(
      "UPDATE kol_mail_threads SET digest_text='可用旧摘要',digest_source='codex_memory',digest_fingerprint='旧来源' WHERE id=$1",
      [threadId],
    );
    setIntentLlmFetch(async () => {
      await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id=$2", ["模型期间被改写的新正文", "summary_cas"]);
      return response({ digest: "不应持久化的合成新摘要" });
    });

    const stats = await withScopedUser(actor("actor_cas"), () => triggerMailSummarySkill(box, conversationId));
    expect(stats).toMatchObject({ errors: 1, error: "mail_memory_source_changed" });
    expect(await readThread(threadId)).toMatchObject({ digest_text: "可用旧摘要", digest_fingerprint: "旧来源" });
    expect(await readNativeOnDemandMemory("actor_cas", `mail_summary_memory:${box}:${conversationId}:`))
      .toMatchObject({ status: "未开始", text: "", error: "mail_memory_source_changed" });
    const audit = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE event_type='mail_skill.summary_failed'",
    );
    expect(audit.rows[0]?.n).toBe("1");
  });

  it("同一会话的不同 actor 不复用 in-flight Promise，两个 actor 都获得自己的完成 cache", async () => {
    const { conversationId } = await insertMail({ id: "actors", body: "两名员工都请求同一个会话摘要" });
    let modelCalls = 0;
    setIntentLlmFetch(async () => {
      modelCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return response({ digest: "两个 actor 可安全共享的合成摘要" });
    });

    const [one, two] = await Promise.all([
      withScopedUser(actor("actor_one"), () => triggerMailSummarySkill(box, conversationId)),
      withScopedUser(actor("actor_two"), () => triggerMailSummarySkill(box, conversationId)),
    ]);
    expect(one).toMatchObject({ summarized: 1, errors: 0 });
    expect(two).toMatchObject({ summarized: 1, errors: 0 });
    expect(modelCalls).toBe(2);
    const key = `mail_summary_memory:${box}:${conversationId}:`;
    expect(await readNativeOnDemandMemory("actor_one", key)).toMatchObject({ status: "已完成" });
    expect(await readNativeOnDemandMemory("actor_two", key)).toMatchObject({ status: "已完成" });
  });

  it("cache 触发器失败时共享摘要与 actor cache 同一事务回滚，失败 cache 与 audit 也不半写", async () => {
    const { threadId, conversationId } = await insertMail({ id: "cache_trigger", body: "缓存触发器失败的正文" });
    await postgresPool().query(
      `CREATE FUNCTION fail_mail_memory_cache() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'synthetic cache failure'; END $$`,
    );
    await postgresPool().query(
      "CREATE TRIGGER fail_mail_memory_cache BEFORE INSERT OR UPDATE ON kol_mail_memory_cache FOR EACH ROW EXECUTE FUNCTION fail_mail_memory_cache()",
    );
    setIntentLlmFetch(async () => response({ digest: "不能提交的合成摘要" }));

    const stats = await withScopedUser(actor("actor_cache_fail"), () => triggerMailSummarySkill(box, conversationId));
    expect(stats.errors).toBe(1);
    expect(await readThread(threadId)).toMatchObject({ digest_text: null, digest_source: null });
    expect(await readNativeOnDemandMemory("actor_cache_fail", `mail_summary_memory:${box}:${conversationId}:`)).toBeNull();
    const audit = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE event_type='mail_skill.summary_failed'",
    );
    expect(audit.rows[0]?.n).toBe("0");
  });

  it("audit 触发器失败时失败 cache 与 audit 同一事务回滚", async () => {
    const { conversationId } = await insertMail({ id: "audit_trigger", body: "失败回执需要完整回滚" });
    await postgresPool().query(
      `CREATE FUNCTION fail_mail_memory_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN IF NEW.event_type = 'mail_skill.summary_failed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await postgresPool().query(
      "CREATE TRIGGER fail_mail_memory_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_mail_memory_audit()",
    );
    setIntentLlmFetch(async () => response({ digest: "" }));

    const stats = await withScopedUser(actor("actor_audit_fail"), () => triggerMailSummarySkill(box, conversationId));
    expect(stats.errors).toBe(1);
    expect(await readNativeOnDemandMemory("actor_audit_fail", `mail_summary_memory:${box}:${conversationId}:`)).toBeNull();
    const audit = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE event_type='mail_skill.summary_failed'",
    );
    expect(audit.rows[0]?.n).toBe("0");
  });

  it("cron thread 模型期间来源变化时不计 generated，并保留 remaining_work", async () => {
    const { threadId } = await insertMail({ id: "cron_thread", body: "cron 线程的初始正文", peer: "", trustedItemMemory: true });
    const started = deferred();
    const release = deferred();
    syntheticCronModel.summarize = async () => {
      started.resolve();
      await release.promise;
      return ["合成线程摘要"];
    };
    process.env.CODEX_MODE = "real";

    const running = runMailMemoryIncrement(box);
    await started.promise;
    await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id=$2", ["cron 线程的已变更正文", "cron_thread"]);
    release.resolve();
    const stats = await running;
    expect(stats).toMatchObject({ digested: 0, source_changed: 1, remaining_work: true });
    expect(await readThread(threadId)).toMatchObject({ digest_text: null, digest_source: null });
  });

  it("cron person 模型期间来源变化时不计 generated，并保留旧来源摘要", async () => {
    const { threadId } = await insertMail({ id: "cron_person", body: "cron 人员摘要的初始正文", trustedItemMemory: true });
    const sourceRows = await listNativeThreadItems(threadId);
    const sourceFingerprint = mailMemorySourceFingerprint(sourceRows);
    await postgresPool().query(
      "UPDATE kol_mail_threads SET digest_text=$1,digest_source='codex_memory',digest_fingerprint=$2 WHERE id=$3",
      ["当前线程已是可信摘要", sourceFingerprint, threadId],
    );
    const started = deferred();
    const release = deferred();
    syntheticCronModel.summarize = async () => {
      started.resolve();
      await release.promise;
      return ["合成人员摘要"];
    };
    process.env.CODEX_MODE = "real";

    const running = runMailMemoryIncrement(box);
    await started.promise;
    await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id=$2", ["cron 人员摘要的已变更正文", "cron_person"]);
    release.resolve();
    const stats = await running;
    expect(stats).toMatchObject({ persons: 0, source_changed: 1, remaining_work: true });
    const person = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM kol_mail_person_memory WHERE mailbox=$1 AND peer_email=$2",
      [box, "peer@example.test"],
    );
    expect(person.rows[0]?.n).toBe("0");
    expect(await readThread(threadId)).toMatchObject({ digest_text: "当前线程已是可信摘要", digest_fingerprint: sourceFingerprint });
  });
});
