import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendTaskEvent, upsertTaskEvent } from "../src/task-events.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";

const OWNER = "task-events-native-owner";
const OTHER = "task-events-native-other";

async function seed(id: string, owner = OWNER): Promise<string> {
  const now = new Date().toISOString();
  const run = `run-${id}`;
  await postgresPool().query(
    `INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at)
       VALUES ($1,$2,'manual_ticket',$3,'manual','running','normal','manual_ticket','default','{}','{}',1,$4,$4)`,
    [id, owner, id, now],
  );
  await postgresPool().query(
    `INSERT INTO task_runs (id,work_item_id,session_id,status,input,entities,created_at)
       VALUES ($1,$2,NULL,'running','{}','{}',$3)`,
    [run, id, now],
  );
  return run;
}

describe("native PostgreSQL task events", () => {
  beforeEach(async () => { await freshTestDatabase(); });
  afterEach(async () => { await closePostgresPool(); });

  it("serializes concurrent appends into gap-free per-ticket sequence facts", async () => {
    const run = await seed("evt-native-main");
    const events = await Promise.all(Array.from({ length: 20 }, async (_, index) =>
      (await appendTaskEvent("evt-native-main", run, "run.progress", `步骤 ${index}`, "running", `trace-${index}`)),
    ));
    expect(events.every(Boolean)).toBe(true);
    const rows = await postgresPool().query<{ sequence: number; event_type: string }>(
      "SELECT sequence,event_type FROM task_events WHERE work_item_id=$1 ORDER BY sequence",
      ["evt-native-main"],
    );
    expect(rows.rows.map((row) => Number(row.sequence))).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(rows.rows.every((row) => row.event_type === "run.progress")).toBe(true);
  });

  it("rejects a run belonging to another ticket without emitting a cross-task fact", async () => {
    await seed("evt-native-main", OWNER);
    const otherRun = await seed("evt-native-other", OTHER);
    await expect(appendTaskEvent("evt-native-main", otherRun, "run.progress", "越权运行", "running")).resolves.toBeNull();
    const count = await postgresPool().query<{ n: string }>("SELECT COUNT(*)::text AS n FROM task_events WHERE work_item_id=$1", ["evt-native-main"]);
    expect(count.rows[0]?.n).toBe("0");
  });

  it("makes a trace item-key idempotent under two workers while lifecycle facts remain immutable", async () => {
    const run = await seed("evt-native-main");
    const [first, second] = await Promise.all([
      (await upsertTaskEvent("evt-native-main", run, "phase:analysis", "run.progress", "分析", "running", "first")),
      (await upsertTaskEvent("evt-native-main", run, "phase:analysis", "run.progress", "分析完成", "running", "second")),
    ]);
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBe(first?.id);
    const rows = await postgresPool().query<{ n: string; status: string; safe_summary: string }>(
      "SELECT COUNT(*)::text AS n,MAX(status) AS status,MAX(safe_summary) AS safe_summary FROM task_events WHERE work_item_id=$1 AND item_key=$2",
      ["evt-native-main", "phase:analysis"],
    );
    expect(rows.rows[0]).toMatchObject({ n: "1", status: "running" });
    await expect(upsertTaskEvent("evt-native-main", run, "phase:analysis", "task.updated", "不可改", "running")).rejects.toThrow("not a mutable run trace");
  });
});
