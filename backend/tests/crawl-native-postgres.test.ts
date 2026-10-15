import { afterEach, beforeEach, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { crawlEvents, crawlJob, ingestMediacrawler, restoreActiveCrawlJobs } from "../src/crawl/service.js";

const now = "2026-10-15T00:00:00.000Z";

beforeEach(async () => {
  await freshTestDatabase();
  await postgresPool().query(
    `INSERT INTO tickets (id,owner_user_id,task_type,title,skill,profile,status,created_at,updated_at)
     VALUES ('crawl-native-ticket','owner','discovery','Native crawl recovery','creator_discovery','{}','running',$1,$1)`,
    [now],
  );
  await postgresPool().query(
    `INSERT INTO crawl_jobs
     (id,idempotency_key,owner_user_id,work_item_id,platform,mode,parameters,status,data_version,created_at,updated_at)
     VALUES ('crawl-native-job','native-recovery-key','owner','crawl-native-ticket','youtube','search','{"keywords":"native"}','running',1,$1,$1)`,
    [now],
  );
});
afterEach(async () => { await closePostgresPool(); });

it("在原生 PG 中将无远端回执的活跃作业恢复为失败，并持久化进度事件和任务状态", async () => {
  await restoreActiveCrawlJobs();
  await expect(crawlJob("crawl-native-job")).resolves.toMatchObject({
    id: "crawl-native-job", status: "error", error: "发现未完成，请稍后重试。",
  });
  await expect(crawlEvents("crawl-native-job")).resolves.toEqual([
    expect.objectContaining({ event_type: "error", status: "error" }),
  ]);
  const ticket = (await postgresPool().query("SELECT status,data_version FROM tickets WHERE id=$1", ["crawl-native-ticket"])).rows[0];
  expect(ticket).toMatchObject({ status: "failed", data_version: 2 });
  const taskEvents = await postgresPool().query("SELECT event_type,status FROM task_events WHERE work_item_id=$1 ORDER BY sequence", ["crawl-native-ticket"]);
  expect(taskEvents.rows).toEqual([{ event_type: "crawl.error", status: "error" }]);
});

it("在原生 PG 中以平台稳定编号去重 Webhook 候选，同时保留每次采集快照和审计", async () => {
  const first = await ingestMediacrawler({
    source: "test-webhook",
    task_id: "remote-native-1",
    creators: [{ platform: "youtube", creator_id: "creator-native", nickname: "Native Creator", followers: 1200, recent_views: [10, 20] }],
  });
  const second = await ingestMediacrawler({
    source: "test-webhook",
    task_id: "remote-native-2",
    creators: [{ platform: "youtube", creator_id: "creator-native", nickname: "Native Creator Updated", followers: 2400, recent_views: [30, 40] }],
  });
  expect(first).toMatchObject({ ok: true, accepted: 1, inserted: 1, updated: 0 });
  expect(second).toMatchObject({ ok: true, accepted: 1, inserted: 0, updated: 1 });
  await expect(postgresPool().query("SELECT name,followers FROM claw_creators WHERE platform=$1 AND platform_creator_id=$2", ["youtube", "creator-native"])).resolves.toMatchObject({
    rows: [{ name: "Native Creator Updated", followers: 2400 }],
  });
  await expect(postgresPool().query("SELECT count(*)::int AS count FROM creator_snapshots WHERE platform=$1 AND platform_creator_id=$2", ["youtube", "creator-native"])).resolves.toMatchObject({ rows: [{ count: 2 }] });
  await expect(postgresPool().query("SELECT count(*)::int AS count FROM audit_events WHERE event_type=$1", ["claw.ingest.mediacrawler"])).resolves.toMatchObject({ rows: [{ count: 2 }] });
});
