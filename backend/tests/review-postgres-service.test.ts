import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { closePostgresPool, postgresPool, postgresTransaction } from "../src/postgres/pool.js";
import { PostgresReviewService } from "../src/approval/review-postgres-service.js";
import { emptyReviewDefinition, type ReviewCommand } from "../../shared/review.js";
import type { ReviewContext } from "../src/approval/review-service.js";

const migration = fs.readFileSync(path.resolve(import.meta.dirname, "../migrations/032_review_postgres.sql"), "utf8");
const people = [
  { id: "admin", name: "管理员", managerIds: ["reviewer"] },
  { id: "employee", name: "员工", managerIds: ["reviewer"] },
  { id: "reviewer", name: "评审人", managerIds: [] },
];
const context = (actor: string): ReviewContext => ({ tenant: "company", actor, admin: actor === "admin", people });
async function service<T>(actor: string, fn: (s: PostgresReviewService) => Promise<T>) {
  return postgresTransaction(async client => fn(new PostgresReviewService(client, context(actor), "2026-10-04T00:00:00.000Z")));
}
async function run(actor: string, command: ReviewCommand, key: string) {
  return service(actor, async s => {
    const p = await s.prepare(command);
    return s.execute(command, p.confirmationId, key);
  });
}

beforeEach(async () => {
  await freshTestDatabase();
  await postgresPool().query(migration);
  process.env.REVIEW_V2_NEW_REQUESTS = "enabled";
});
afterEach(async () => { delete process.env.REVIEW_V2_NEW_REQUESTS; await closePostgresPool(); });

describe("PostgresReviewService", () => {
  it("uses one native PostgreSQL transaction for confirmation, state mutation, idempotency and timeout queueing", async () => {
    const definition = emptyReviewDefinition();
    definition.nodes[1].timeoutHours = 1;
    definition.nodes[1].operations = { timeout: { action: "remind" } };
    const template = await service("admin", s => s.saveTemplate(undefined, undefined, definition));
    await run("admin", { action: "publish", templateId: template.id, expectedVersion: 1 }, "native-publish-key");
    const submit: ReviewCommand = { action: "submit", templateId: template.id, templateVersion: 1, title: "原生事务申请", values: {} };
    const receipt = await run("employee", submit, "native-submit-key");
    expect((await service("employee", s => s.instance(receipt.resourceId))).status).toBe("reviewing");
    expect(await run("employee", submit, "native-submit-key")).toEqual(receipt);
    const [command, jobs] = await Promise.all([
      postgresPool().query("SELECT receipt FROM review_commands WHERE tenant=$1 AND actor=$2 AND idempotency_key=$3", ["company", "employee", "native-submit-key"]),
      postgresPool().query("SELECT * FROM execution_jobs WHERE idempotency_key LIKE $1", ["review-timeout:company:%"]),
    ]);
    expect(command.rowCount).toBe(1);
    expect(jobs.rowCount).toBe(1);
    await expect(run("reviewer", { action: "approve", instanceId: receipt.resourceId, expectedVersion: 99, reason: "" }, "stale-cas-key")).rejects.toMatchObject({ status: 409 });
  });
});
