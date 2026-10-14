import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postgresDb, resetDatabase } from "../src/postgres/access.js";
import { resetDemoRuntimeState, runLegacyDemoCleanup, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";
let tmp: string;
beforeEach(async () => {
  if (process.env.TEST_DATABASE_URL)
    await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-seed-cleanup-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  (await resetDatabase());
});
afterEach(async () => {
  (await resetDatabase());
  fs.rmSync(tmp, { recursive: true, force: true });
});
/** 跨进程重开后，回填会把夹具的 task.created 等事件判为 lifecycle（不可删）。 */
async function freezeFixtureEvents(workItemId: string): Promise<void> {
  (await postgresDb().execute("UPDATE task_events SET event_class='lifecycle' WHERE work_item_id=$1 AND event_type NOT IN ('task.completed','task.failed')", workItemId));
}
describe("demo cleanup vs immutable lifecycle task events", () => {
  it("bootstrap cleanup skips tickets that carry lifecycle evidence", async () => {
    (await seedAll());
    (await seedWorkbenchFixtures());
    const conn = postgresDb();
    (await freezeFixtureEvents("tsk_home_xiaomei_mail"));
    await expect(runLegacyDemoCleanup()).resolves.toBeUndefined();
      // 生命周期证据不可删（含 tickets 级联）：该演示任务保留；其余照旧清掉。
    expect((await conn.one("SELECT id FROM tickets WHERE id=$1", "tsk_home_xiaomei_mail"))).toBeTruthy();
    const kept = (await conn.one("SELECT COUNT(*) AS c FROM task_events WHERE work_item_id=$1", "tsk_home_xiaomei_mail")) as {
      c: number;
    };
      expect(kept.c).toBeGreaterThan(0);
    expect((await conn.one("SELECT id FROM tickets WHERE id=$1", "tsk_home_mum_nudge"))).toBeUndefined();
  });
  it("demo reset wipes task events and restores the immutable trigger", async () => {
    (await seedAll());
    (await seedWorkbenchFixtures());
    const conn = postgresDb();
    (await freezeFixtureEvents("tsk_home_xiaomei_mail"));
    await expect((async () => (await resetDemoRuntimeState()))().then(() => true)).resolves.toBe(true);
    expect((await conn.one("SELECT COUNT(*) AS c FROM task_events"))).toEqual({ c: 0 });
    expect((await conn.one("SELECT COUNT(*) AS c FROM tickets"))).toEqual({ c: 0 });
    (await seedWorkbenchFixtures());
    (await freezeFixtureEvents("tsk_home_xiaomei_mail"));
    await expect((async () => (await conn.execute("DELETE FROM task_events WHERE work_item_id=$1 AND event_class='lifecycle'", "tsk_home_xiaomei_mail")))()).rejects.toThrow(/immutable/);
  });
});
