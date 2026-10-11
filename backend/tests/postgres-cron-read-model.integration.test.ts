import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { pgCreateCronJob, pgCronJobById, pgCronPublicJobSummary, pgListCronJobs } from "../src/cron/postgres-store.js";
import { cronPublicReadFields } from "../src/cron/public-read-model.js";
import type { TicketPrincipal } from "../src/ticket-domain/auth.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;
const actor: TicketPrincipal = { id: "cron-read-fixture", username: "cron-read-fixture", name: "读模型测试", email: null, roles: [], active: true };

describePostgres("native PostgreSQL employee cron summary", () => {
  afterAll(async () => { await closePostgresPool(); });
  it("returns the active state and real last-terminal receipt in a single job read without exposing full receipt", async () => {
    const id = `cron_read_${randomUUID()}`;
    const pool = postgresPool();
    try {
      await pgCreateCronJob({ id, job_key: id, title: "隔离读模型测试", owner_account_id: actor.id, execute_as: actor.id, capability_expert_id: "expert:kol", handler_key: "discovery-search", scope: { applies: "self" }, condition: {}, cron_expr: "0 8 * * *", timezone: "Asia/Shanghai", status: "published", retry_policy: { max_attempts: 1 }, takeover_policy: {}, next_run_at: "2031-01-01T00:00:00Z" });
      await pool.query(`INSERT INTO cron_runs (id,job_id,trigger,status,scheduled_for,started_at,finished_at,receipt_json,created_at) VALUES ($1,$2,'manual','succeeded',$3,$3,$4,$5,$3)`, [`${id}_done`, id, "2030-12-30T00:00:00Z", "2030-12-30T00:01:00Z", JSON.stringify({ handler_key: "discovery-search", crawl_job_id: "isolated-crawl-receipt", note: "private receipt body" })]);
      await pool.query(`INSERT INTO cron_runs (id,job_id,trigger,status,scheduled_for,created_at) VALUES ($1,$2,'manual','running',$3,$3)`, [`${id}_active`, id, "2030-12-31T00:00:00Z"]);
      await pool.query(`UPDATE cron_jobs SET last_terminal_status='succeeded' WHERE id=$1`, [id]);
      for (const row of [await pgCronJobById(id), (await pgListCronJobs()).find(job => job.id === id)]) {
        expect(row).toBeTruthy();
        expect(row).toMatchObject({ active_run_status: "running", last_terminal_status: "succeeded" });
        const summary = { ...pgCronPublicJobSummary(row!), ...cronPublicReadFields(row!, actor) };
        expect(summary).toMatchObject({ last_result_label: "已入队", allowed_actions: { pause: true, run_now: false }, execution_capability: { ready: true } });
        expect(JSON.stringify(summary)).not.toContain("private receipt body");
        expect(summary).not.toHaveProperty("last_result_receipt_json");
      }
    } finally { await pool.query("DELETE FROM cron_runs WHERE job_id=$1", [id]); await pool.query("DELETE FROM cron_jobs WHERE id=$1", [id]); }
  });
  it("reads a malformed historical receipt without inventing queue success", async () => {
    expect(cronPublicReadFields({ id: "historic", execute_as: actor.id, owner_account_id: actor.id, handler_key: "discovery-search", condition_json: "{}", status: "published", last_terminal_status: "succeeded", last_result_receipt_json: "invalid-json" }, actor)).toMatchObject({ last_result_label: "待核对回执" });
  });
});
