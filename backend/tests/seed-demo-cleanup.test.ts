import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseEngine, getConn, resetConn } from "../src/db.js";
import { resetDemoRuntimeState, runLegacyDemoCleanup, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;

beforeEach(async () => {
  if (process.env.TEST_DATABASE_URL) await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-seed-cleanup-"));
  process.env.LINGONG_DB = path.join(tmp, "seed.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 跨进程重开后，回填会把夹具的 task.created 等事件判为 lifecycle（不可删）。 */
function freezeFixtureEvents(workItemId: string): void {
  getConn().prepare(
    "UPDATE task_events SET event_class='lifecycle' WHERE work_item_id=? AND event_type NOT IN ('task.completed','task.failed')",
  ).run(workItemId);
}

describe("demo cleanup vs immutable lifecycle task events", () => {
  it("bootstrap cleanup skips tickets that carry lifecycle evidence", () => {
    seedAll();
    seedWorkbenchFixtures();
    const conn = getConn();
    freezeFixtureEvents("tsk_home_xiaomei_mail");

    expect(() => runLegacyDemoCleanup()).not.toThrow();
    if (databaseEngine() === "sqlite") {
      // 生命周期证据不可删（含 tickets 级联）：该演示任务保留；其余照旧清掉。
      expect(conn.prepare("SELECT id FROM tickets WHERE id=?").get("tsk_home_xiaomei_mail")).toBeTruthy();
      const kept = conn.prepare("SELECT COUNT(*) AS c FROM task_events WHERE work_item_id=?").get("tsk_home_xiaomei_mail") as { c: number };
      expect(kept.c).toBeGreaterThan(0);
      expect(conn.prepare("SELECT id FROM tickets WHERE id=?").get("tsk_home_mum_nudge")).toBeUndefined();
    }
  });

  it("demo reset wipes task events and restores the immutable trigger", () => {
    seedAll();
    seedWorkbenchFixtures();
    const conn = getConn();
    freezeFixtureEvents("tsk_home_xiaomei_mail");

    expect(() => resetDemoRuntimeState()).not.toThrow();
    expect(conn.prepare("SELECT COUNT(*) AS c FROM task_events").get()).toEqual({ c: 0 });
    expect(conn.prepare("SELECT COUNT(*) AS c FROM tickets").get()).toEqual({ c: 0 });

    seedWorkbenchFixtures();
    freezeFixtureEvents("tsk_home_xiaomei_mail");
    expect(() => conn.prepare("DELETE FROM task_events WHERE work_item_id=? AND event_class='lifecycle'").run("tsk_home_xiaomei_mail"))
      .toThrow(/immutable/);
  });
});
