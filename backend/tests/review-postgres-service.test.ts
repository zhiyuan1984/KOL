import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { closePostgresPool, postgresPool, postgresTransaction } from "../src/postgres/pool.js";
import { PostgresReviewService } from "../src/approval/review-postgres-service.js";
import { checkedReviewSource, collaborationReviewSource } from "../src/approval/review-source.js";
import { emptyReviewDefinition, type ReviewCommand } from "../../shared/review.js";
import type { ReviewContext } from "../src/approval/review-context.js";

const migration = fs.readFileSync(path.resolve(import.meta.dirname, "../migrations/032_review_postgres.sql"), "utf8");
const people = [
  { id: "admin", name: "管理员", managerIds: ["reviewer"] },
  { id: "employee", name: "员工", managerIds: ["reviewer"] },
  { id: "reviewer", name: "评审人", managerIds: [] },
];
const context = (actor: string): ReviewContext => ({ tenant: "company", actor, admin: actor === "admin", people });
async function service<T>(actor: string, fn: (s: PostgresReviewService) => Promise<T>) {
  return postgresTransaction(async (client) => fn(new PostgresReviewService(client, context(actor), "2026-10-04T00:00:00.000Z")));
}
async function run(actor: string, command: ReviewCommand, key: string) {
  return service(actor, async (s) => {
    const prepared = await s.prepare(command);
    return s.execute(command, prepared.confirmationId, key);
  });
}

beforeEach(async () => {
  await freshTestDatabase();
  await postgresPool().query(migration);
  process.env.REVIEW_V2_NEW_REQUESTS = "enabled";
});
afterEach(async () => {
  delete process.env.REVIEW_V2_NEW_REQUESTS;
  await closePostgresPool();
});

describe("PostgresReviewService", () => {
  it("uses one native PostgreSQL transaction for confirmation, state mutation, idempotency and timeout queueing", async () => {
    const definition = emptyReviewDefinition();
    definition.nodes[1].timeoutHours = 1;
    definition.nodes[1].operations = { timeout: { action: "remind" } };
    const template = await service("admin", (s) => s.saveTemplate(undefined, undefined, definition));
    await run("admin", { action: "publish", templateId: template.id, expectedVersion: 1 }, "native-publish-key");
    const submit: ReviewCommand = { action: "submit", templateId: template.id, templateVersion: 1, title: "原生事务申请", values: {} };
    const receipt = await run("employee", submit, "native-submit-key");
    expect((await service("employee", (s) => s.instance(receipt.resourceId))).status).toBe("reviewing");
    expect(await run("employee", submit, "native-submit-key")).toEqual(receipt);
    const [command, jobs] = await Promise.all([
      postgresPool().query("SELECT receipt FROM review_commands WHERE tenant=$1 AND actor=$2 AND idempotency_key=$3", ["company", "employee", "native-submit-key"]),
      postgresPool().query("SELECT * FROM execution_jobs WHERE idempotency_key LIKE $1", ["review-timeout:company:%"]),
    ]);
    expect(command.rowCount).toBe(1);
    expect(jobs.rowCount).toBe(1);
    await expect(run("reviewer", { action: "approve", instanceId: receipt.resourceId, expectedVersion: 99, reason: "" }, "stale-cas-key")).rejects.toMatchObject({ status: 409 });
  });

  it("rolls back confirmation consumption, frozen instance, event and timeout enqueue when the final durable write fails", async () => {
    const definition = emptyReviewDefinition();
    definition.nodes[1].timeoutHours = 1;
    definition.nodes[1].operations = { timeout: { action: "remind" } };
    const template = await service("admin", (s) => s.saveTemplate(undefined, undefined, definition));
    await run("admin", { action: "publish", templateId: template.id, expectedVersion: 1 }, "rollback-publish-key");
    const submit: ReviewCommand = { action: "submit", templateId: template.id, templateVersion: 1, title: "故障回滚审批", values: {} };
    const prepared = await service("employee", (s) => s.prepare(submit));
    const key = "native-forced-rollback-key";
    await postgresPool().query(`
      CREATE OR REPLACE FUNCTION review_fail_command_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced review command failure' USING ERRCODE = 'P0001'; END;
      $$;
      CREATE TRIGGER review_fail_command_insert_trigger
      BEFORE INSERT ON review_commands
      FOR EACH ROW WHEN (NEW.idempotency_key = '${key}')
      EXECUTE FUNCTION review_fail_command_insert();
    `);
    try {
      await expect(service("employee", (s) => s.execute(submit, prepared.confirmationId, key))).rejects.toThrow("forced review command failure");
    } finally {
      await postgresPool().query("DROP TRIGGER IF EXISTS review_fail_command_insert_trigger ON review_commands; DROP FUNCTION IF EXISTS review_fail_command_insert();");
    }
    const [instances, events, jobs, commands, confirmation] = await Promise.all([
      postgresPool().query("SELECT count(*)::int AS count FROM review_instances WHERE tenant=$1", ["company"]),
      postgresPool().query("SELECT count(*)::int AS count FROM review_events WHERE tenant=$1 AND action='submit'", ["company"]),
      postgresPool().query("SELECT count(*)::int AS count FROM execution_jobs WHERE idempotency_key LIKE $1", ["review-timeout:company:%"]),
      postgresPool().query("SELECT count(*)::int AS count FROM review_commands WHERE tenant=$1 AND actor=$2 AND idempotency_key=$3", ["company", "employee", key]),
      postgresPool().query<{ consumed: number }>("SELECT consumed FROM review_confirmations WHERE id=$1", [prepared.confirmationId]),
    ]);
    expect(instances.rows[0].count).toBe(0);
    expect(events.rows[0].count).toBe(0);
    expect(jobs.rows[0].count).toBe(0);
    expect(commands.rows[0].count).toBe(0);
    expect(confirmation.rows[0]?.consumed).toBe(0);
  });

  it("freezes a PostgreSQL-scoped collaboration source and rejects changed or out-of-brand material", async () => {
    await postgresPool().query(
      "INSERT INTO users(id,username,name,password_hash,roles,brands,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,$7),($8,$9,$10,$4,$5,$11,1,$7,$7)",
      ["source-employee", "source-employee", "来源员工", "unused", "[\"employee\"]", "[\"source-brand\"]", "2026-10-04T00:00:00.000Z", "source-outsider", "source-outsider", "外部员工", "[\"other-brand\"]"],
    );
    await postgresPool().query(
      "INSERT INTO collaborations(id,handle,display_name,brand,email,mailbox_from,lifecycle_id,conversation_id,stage_code,notes) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)",
      ["source-collaboration", "source-handle", "来源对象", "source-brand", "source@example.invalid", "source-lifecycle", "source-conversation", "S01", "冻结前材料"],
    );
    const source = await postgresTransaction((client) => collaborationReviewSource(client, "source-employee", "source-collaboration"));
    expect(source.snapshot.notes).toBe("冻结前材料");
    await expect(postgresTransaction((client) => collaborationReviewSource(client, "source-outsider", "source-collaboration"))).rejects.toMatchObject({ status: 404 });
    await postgresPool().query("UPDATE collaborations SET notes=$1 WHERE id=$2", ["材料已变化", "source-collaboration"]);
    await expect(postgresTransaction((client) => checkedReviewSource(client, "source-employee", source))).rejects.toMatchObject({ status: 409 });
  });
});
