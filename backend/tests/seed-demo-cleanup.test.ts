import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { resetDemoRuntimeState, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";
let tmp: string;
beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-native-seed-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  await resetConn();
});
afterEach(async () => { await resetConn(); fs.rmSync(tmp, { recursive: true, force: true }); });
async function fixtureWithLifecycle(): Promise<string> {
  const row = (await getConn().query("SELECT id FROM tickets ORDER BY id LIMIT 1")).rows[0];
  expect(row).toBeTruthy();
  const id = String(row.id);
  await getConn().query("UPDATE task_events SET event_class='lifecycle' WHERE work_item_id=$1 AND event_type NOT IN ('task.completed','task.failed')", [id]);
  expect(Number((await getConn().query("SELECT count(*) AS n FROM task_events WHERE work_item_id=$1 AND event_class='lifecycle'", [id])).rows[0].n)).toBeGreaterThan(0);
  return id;
}
describe("native bootstrap and immutable lifecycle facts", () => {
  it("never erases existing tickets or lifecycle evidence during bootstrap", async () => {
    await seedAll(); await seedWorkbenchFixtures();
    const id = await fixtureWithLifecycle();
    const before = (await getConn().query("SELECT id FROM tickets ORDER BY id")).rows;
    const evidence = (await getConn().query("SELECT id,event_type,event_class FROM task_events WHERE work_item_id=$1 ORDER BY id", [id])).rows;
    await expect(seedAll()).resolves.toBeUndefined();
    expect((await getConn().query("SELECT id FROM tickets ORDER BY id")).rows).toEqual(before);
    expect((await getConn().query("SELECT id,event_type,event_class FROM task_events WHERE work_item_id=$1 ORDER BY id", [id])).rows).toEqual(evidence);
  });
  it("resets only disposable fixtures without removing the immutable lifecycle trigger", async () => {
    await seedAll(); await seedWorkbenchFixtures(); await fixtureWithLifecycle();
    await expect(resetDemoRuntimeState()).resolves.toBeUndefined();
    expect(Number((await getConn().query("SELECT count(*) AS n FROM tickets")).rows[0].n)).toBe(0);
    expect(Number((await getConn().query("SELECT count(*) AS n FROM task_events")).rows[0].n)).toBe(0);
    await seedWorkbenchFixtures(); const id = await fixtureWithLifecycle();
    await expect(getConn().query("DELETE FROM task_events WHERE work_item_id=$1 AND event_class='lifecycle'", [id])).rejects.toThrow(/immutable/);
  });
  it("rejects resets when the explicit test prefix does not own the current database", async () => {
    const prefix = process.env.TEST_DB_PREFIX;
    process.env.TEST_DB_PREFIX = "unrelated_native_test";
    try { await expect(resetDemoRuntimeState()).rejects.toThrow(/outside the isolated test database prefix/); }
    finally { if (prefix === undefined) delete process.env.TEST_DB_PREFIX; else process.env.TEST_DB_PREFIX = prefix; }
  });
});
