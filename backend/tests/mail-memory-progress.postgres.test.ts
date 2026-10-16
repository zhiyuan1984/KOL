import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { applyPostgresMigrations } from "../src/postgres/migrations.js";
import {
  advanceNativeMailMemoryProgress,
  readNativeChunkCheckpoint,
  readNativeMailMemoryProgress,
  writeNativeChunkCheckpoint,
} from "../src/postgres/mail-memory-progress-repository.js";
import { mailBodyFingerprint } from "../src/postgres/mail-memory-repository.js";

const syntheticModel = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/host/mail-summary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/host/mail-summary.js")>();
  return { ...actual, remoteMailAnalysisEnabled: () => true, summarizeWithCodexAppServer: async () => ["真实 PG 合成摘要"] };
});
vi.mock("../src/starrykol/translate-zh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/starrykol/translate-zh.js")>();
  return {
    ...actual,
    translateMailBodyZhResumable: async () => {
      syntheticModel.calls += 1;
      return { text: "这是由合成模型返回的可用中文翻译。", source: "codex_memory" };
    },
  };
});

const box = "progress-fairness@example.test";
const at = "2026-10-16T00:00:00.000Z";

async function migrate049(): Promise<void> {
  const client = await postgresPool().connect();
  try { await applyPostgresMigrations(client, { only: "20261016_049_mail_memory_progress" }); }
  finally { client.release(); }
}

async function insertMail(id: string, mailbox = box, body = "This synthetic English body needs translation and summary."): Promise<void> {
  const db = postgresPool();
  await db.query(
    `INSERT INTO kol_mail_threads(id,conversation_id,subject,mailbox,peer_email,created_at,updated_at,last_at)
     VALUES($1,$2,'progress',$3,$4,$5,$5,$5)`, ["thread_" + id, "conversation_" + id, mailbox, `${id}@peer.test`, at],
  );
  await db.query(
    `INSERT INTO kol_mail_items(id,thread_id,conversation_id,provider_message_id,direction,subject,body_text,occurred_at,created_at)
     VALUES($1,$2,$3,$4,'inbound','progress',$5,$6,$6)`, [id, "thread_" + id, "conversation_" + id, "provider_" + id, body, at],
  );
}

beforeEach(async () => {
  await freshTestDatabase();
  await migrate049();
  syntheticModel.calls = 0;
});
afterEach(async () => { await closePostgresPool(); });

describe("邮件记忆持久公平进度（真实 PostgreSQL；合成模型明确标注）", () => {
  it("在持续正文积压下按 items -> threads -> persons 的持久轮转推进，不重扫全部 phase", async () => {
    for (let index = 0; index < 40; index += 1) await insertMail(`backlog_${String(index).padStart(2, "0")}`);
    const { runMailMemoryIncrement } = await import("../src/host/mail-memory-job.js");
    const first = await runMailMemoryIncrement(box);
    const afterFirst = await readNativeMailMemoryProgress(box);
    const second = await runMailMemoryIncrement(box);

    // A budgeted run alternates phase turns but is no longer artificially capped
    // at one mail.  Continued item backlog cannot starve digest/person work.
    expect(first).toMatchObject({ phase: "items" });
    expect((first.translated || 0) + (first.source_chinese || 0)).toBeGreaterThan(1);
    expect((first.digested || 0) + (first.persons || 0)).toBeGreaterThan(0);
    expect(["items", "threads", "persons"]).toContain(first.next_phase);
    expect(["items", "threads", "persons"]).toContain(afterFirst.next_phase);
    expect(second.scanned).toBeGreaterThan(0);
    expect(first.remaining_candidates?.items).toBeGreaterThanOrEqual(0);
    expect(syntheticModel.calls).toBeGreaterThan(0);
  });

  it("分片 checkpoint 只在当前 item、当前 mailbox 与完整原文指纹都一致时跨连接恢复", async () => {
    const body = `${"English Unicode 😀 source segment. ".repeat(500)}tail`;
    await insertMail("chunk_item", box, body);
    const fingerprint = mailBodyFingerprint(body);
    expect(await writeNativeChunkCheckpoint({
      itemId: "chunk_item", mailbox: box, sourceFingerprint: fingerprint, chunkCount: 4,
      completedChunks: ["第一段真实中文"],
    })).toBe(true);
    expect(await writeNativeChunkCheckpoint({
      itemId: "chunk_item", mailbox: box, sourceFingerprint: fingerprint, chunkCount: 4,
      completedChunks: ["第一段真实中文", "第二段真实中文"], expectedCompletedChunks: ["第一段真实中文"],
    })).toBe(true);
    await closePostgresPool(); // new connection/process-equivalent repository recovery
    expect(await readNativeChunkCheckpoint({ itemId: "chunk_item", mailbox: box, sourceFingerprint: fingerprint }))
      .toMatchObject({ completed_chunks: ["第一段真实中文", "第二段真实中文"], chunk_count: 4 });

    await postgresPool().query("UPDATE kol_mail_items SET body_text=$1 WHERE id='chunk_item'", [body + " changed"]);
    expect(await readNativeChunkCheckpoint({ itemId: "chunk_item", mailbox: box, sourceFingerprint: fingerprint })).toBeNull();
    expect(await readNativeChunkCheckpoint({ itemId: "chunk_item", mailbox: "other@example.test", sourceFingerprint: fingerprint })).toBeNull();
    const correctedFingerprint = mailBodyFingerprint(body + " changed");
    expect(await writeNativeChunkCheckpoint({
      itemId: "chunk_item", mailbox: box, sourceFingerprint: correctedFingerprint, chunkCount: 5,
      completedChunks: ["修正原文后的第一片中文"], expectedCompletedChunks: [],
    })).toBe(true);
    expect(await readNativeChunkCheckpoint({ itemId: "chunk_item", mailbox: box, sourceFingerprint: correctedFingerprint }))
      .toMatchObject({ completed_chunks: ["修正原文后的第一片中文"], chunk_count: 5 });
  });

  it("中文来源仅记录 source_zh；混合文本仍进入模型，短英文的真实短中文不因八字阈值失败", async () => {
    await insertMail("zh_source", box, "这是最新失败项，只有中文正文，不应重复翻译。");
    await insertMail("mixed_source", box, "这是中文说明，但 please send rate card 仍是实质英文。");
    const { runMailMemoryIncrement } = await import("../src/host/mail-memory-job.js");
    await runMailMemoryIncrement(box); // zh_source (lexical first)
    await runMailMemoryIncrement(box); // thread
    await runMailMemoryIncrement(box); // person
    await runMailMemoryIncrement(box); // mixed_source
    const rows = await postgresPool().query<{ id: string; translation_source: string; translation_zh: string | null }>(
      "SELECT id,translation_source,translation_zh FROM kol_mail_items WHERE id IN ('zh_source','mixed_source') ORDER BY id",
    );
    expect(rows.rows.find((row) => row.id === "zh_source")).toMatchObject({ translation_source: "source_zh", translation_zh: null });
    expect(rows.rows.find((row) => row.id === "mixed_source")).toMatchObject({ translation_source: "codex_memory" });
  });

  it("阶段推进函数保留正在让出预算的 item cursor，并在下轮转到 threads", () => {
    const initial = { mailbox: box, next_phase: "items" as const, item_cursor: "item_a", thread_cursor: "", person_cursor: "" };
    expect(advanceNativeMailMemoryProgress(initial, "items")).toMatchObject({ next_phase: "threads", item_cursor: "item_a" });
  });

  it("全量 fresh thread/person 在一个有界 cycle 后退出，remaining 不是总人数", async () => {
    for (let index = 0; index < 25; index += 1) await insertMail(`fresh_${String(index).padStart(2, "0")}`);
    const { runMailMemoryIncrement } = await import("../src/host/mail-memory-job.js");
    // Fill all derived state through the regular fair worker first.
    for (let run = 0; run < 8; run += 1) await runMailMemoryIncrement(box);
    const callsBefore = syntheticModel.calls;
    const fresh = await runMailMemoryIncrement(box);
    expect(fresh.remaining_candidates).toMatchObject({ threads: 0, persons: 0 });
    expect(fresh.scanned).toBeLessThanOrEqual(1);
    expect(syntheticModel.calls).toBe(callsBefore);
  });

});
