import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppUser } from "../src/auth.js";
import { withScopedUser } from "../src/auth.js";
import { dispatchClaimedExecutionJob } from "../src/execution-jobs/dispatcher.js";
import { pgClaimExecutionJobById, pgEnqueueExecutionJob } from "../src/execution-jobs/postgres-store.js";
import { authorizeMailSync } from "../src/mail/sync-job.js";
import { operationJobsRouter } from "../src/routers/operation-jobs.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

const ACTOR_ID = "mail-sync-native-actor";
const MAILBOX = "native-mailbox@example.test";
const CREDENTIAL = "cred_native_mail_sync_12345678";

function actor(): AppUser {
  return {
    id: ACTOR_ID, username: ACTOR_ID, name: "Native mail sync actor", handle: ACTOR_ID,
    email: MAILBOX, phone: "", roles: ["employee"], role: "employee", brands: [], site: "",
    manager_user_id: null, active: true, exam_passed: true, exam_todo_count: 0, exam_module: "",
  };
}

async function seedNativeAuthorization(): Promise<void> {
  const now = new Date().toISOString();
  const pool = postgresPool();
  await pool.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email)
     VALUES ($1,$2,$3,'test-only',$4,'[]','',1,$5,$5,$6)`, [ACTOR_ID, ACTOR_ID, "Native mail sync actor", JSON.stringify(["employee"]), now, MAILBOX]);
  await pool.query(`INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at)
     VALUES ('agent:mail-native','Native mail agent','test-only','published',1,$1,$1)`, [now]);
  for (const skill of ["email_conversation_list", "email_conversation_read"]) {
    await pool.query("INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at) VALUES ('agent:mail-native',$1,1,1,$2)", [skill, now]);
  }
  await pool.query(`INSERT INTO organization_people(person_ref,display_name,user_ref,user_id,status,source,created_at,updated_at)
     VALUES ('person:mail-native','Native mail sync actor',$1,$1,'active','test',$2,$2)`, [ACTOR_ID, now]);
  await pool.query(`INSERT INTO agent_bindings
     (id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_at,updated_at)
     VALUES ('binding:mail-native','agent:mail-native','person','person:mail-native','company:test','active',1,1,$1,$1)`, [now]);
  await pool.query(`INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,bearer_token,status,updated_at)
     VALUES ($1,$2,1,$3,'connected',$4)`, [ACTOR_ID, MAILBOX, CREDENTIAL, now]);
}
function conversation(id: string, unread: boolean, at: string): Json {
  return { id, conversationId: id, mailboxEmail: MAILBOX, subject: `Subject ${id}`, unreadCount: unread ? 1 : 0, lastMessageTime: at };
}

beforeEach(async () => {
  await freshTestDatabase();
  await seedNativeAuthorization();
  process.env.NODE_ENV = "test";
});

afterEach(async () => {
  setStarryKolClientFactory();
  await closePostgresPool();
});

describe("durable PostgreSQL mail sync", () => {
  it("retries a safe list read, prioritizes the requested conversation, persists running receipt progress, and completes in postgres-only mode", async () => {
    let firstList = true;
    const reads: string[] = [];
    let releaseBodies: (() => void) | undefined;
    const bodiesGate = new Promise<void>((resolve) => { releaseBodies = resolve; });
    let bodyStarted: (() => void) | undefined;
    const bodyStartedPromise = new Promise<void>((resolve) => { bodyStarted = resolve; });
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        if (name === "pageEmailConversations") {
          if (Number(args.pageNo) === 1 && firstList) {
            firstList = false;
            throw Object.assign(new Error("safe test outage"), { remoteStatus: 500, remoteKind: "unreachable" });
          }
          if (Number(args.pageNo) === 1)
            return { data: { total: 3, pageSize: 2, list: [
            conversation("7301", false, "2026-10-12T00:00:00.000Z"),
            conversation("7302", true, "2026-10-11T00:00:00.000Z"),
          ] } };
          if (Number(args.pageNo) === 2)
            return { data: { total: 3, pageSize: 2, list: [
            conversation("7303", false, "2026-10-13T00:00:00.000Z"),
          ] } };
          return { data: { total: 3, pageSize: 2, list: [] } };
        }
        if (name === "getEmailConversation") {
          const id = String(args.conversationId);
          reads.push(id);
          if (id === "7302")
            bodyStarted?.();
          await bodiesGate;
          return { data: { conversationId: id, subject: `Subject ${id}`, messages: [{
            id: `message-${id}`, direction: "inbound", from: "creator@example.test", body: `Body ${id}`,
            sentAt: "2026-10-12T00:00:00.000Z",
          }] } };
        }
        if (name === "pageMailboxes")
          return { data: { list: [] } };
        return { data: {} };
      },
      async close() { },
    }));
    const queued = await pgEnqueueExecutionJob({
      job_type: "mail.sync", tenant_ref: ACTOR_ID, actor_ref: ACTOR_ID,
      idempotency_key: "mail-sync-native-progress", object_ref: { mailbox: MAILBOX },
      payload: { mailbox: MAILBOX, conversation_id: "7302" }, max_attempts: 3,
    });
    const claimed = await pgClaimExecutionJobById(String(queued.job.id), "mail-native-worker");
    expect(claimed).toBeTruthy();
    const previousMode = process.env.KOL_RUNTIME_MODE;
    process.env.KOL_RUNTIME_MODE = "postgres-only";
    let dispatched: ReturnType<typeof dispatchClaimedExecutionJob> | undefined;
    let dispatchedResult: Awaited<ReturnType<typeof dispatchClaimedExecutionJob>> | undefined;
    try {
      dispatched = dispatchClaimedExecutionJob(claimed!);
      await bodyStartedPromise;
      expect(reads[0]).toBe("7302");
      const running = await postgresPool().query<{
        status: string;
        receipt_json: {
          index: Json;
          body: Json;
        };
      }>("SELECT status,receipt_json::jsonb AS receipt_json FROM execution_jobs WHERE id=$1", [queued.job.id]);
      expect(running.rows[0]).toMatchObject({
        status: "running",
        receipt_json: {
          index: { phase: "persisted", listed: 2, inserted: 2, updated: 0, page_no: 1 },
          body: { phase: "pending", requested: 2, completed: 0, failed: 0, pending: 2 },
        },
      });
    }
    finally {
      releaseBodies?.();
      // Never leave a fixture-held remote request running into afterEach (or a
      // later test) when an assertion above fails.
      if (dispatched)
        dispatchedResult = await dispatched;
      if (previousMode === undefined)
        delete process.env.KOL_RUNTIME_MODE;
      else
        process.env.KOL_RUNTIME_MODE = previousMode;
    }
    expect(dispatchedResult).toMatchObject({ job_type: "mail.sync", handled: true, outcome: "processed" });
    expect(reads).toEqual(["7302", "7301", "7303"]);
    const finished = await postgresPool().query<{
      status: string;
      receipt_json: {
        index: Record<string, unknown>;
        body: Record<string, unknown>;
      };
    }>("SELECT status,receipt_json::jsonb AS receipt_json FROM execution_jobs WHERE id=$1", [queued.job.id]);
    expect(finished.rows[0]).toMatchObject({
      status: "succeeded",
      receipt_json: {
        index: { phase: "completed", listed: 3, inserted: 3, updated: 0, cursor_at: "2026-10-13T00:00:00.000Z", page_no: 2 },
        body: { phase: "completed", requested: 3, completed: 3, failed: 0, pending: 0 },
      },
    });

    const app = operationJobsRouter({ "mail.sync": async (payload) => {
      await authorizeMailSync(String(payload.mailbox || ""));
    } });
    const response = await withScopedUser(actor(), () => app.request(`/jobs/${String(queued.job.id)}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: { progress: {
        index: { listed: 3, cursor_at: "2026-10-13T00:00:00.000Z" },
        body: { requested: 3, completed: 3, failed: 0, pending: 0 },
      } },
    });
  });

  it("records a 401 as a terminal mail-specific failure without a blind retry", async () => {
    let remoteReads = 0;
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "pageEmailConversations") {
          remoteReads += 1;
          throw Object.assign(new Error("authorization expired"), { remoteStatus: 401 });
        }
        if (name === "pageMailboxes")
          return { data: { list: [] } };
        return { data: {} };
      },
      async close() { },
    }));
    const queued = await pgEnqueueExecutionJob({
      job_type: "mail.sync", tenant_ref: ACTOR_ID, actor_ref: ACTOR_ID,
      idempotency_key: "mail-sync-native-401", object_ref: { mailbox: MAILBOX }, payload: { mailbox: MAILBOX }, max_attempts: 3,
    });
    const claimed = await pgClaimExecutionJobById(String(queued.job.id), "mail-native-worker-401");
    const dispatched = await dispatchClaimedExecutionJob(claimed!);
    expect(dispatched).toMatchObject({ job_type: "mail.sync", outcome: "failed" });
    expect(remoteReads).toBe(1);
    const failed = await postgresPool().query<{
      status: string;
      error_code: string;
      attempts: number;
    }>("SELECT status,error_code,attempts FROM execution_jobs WHERE id=$1", [queued.job.id]);
    expect({ ...failed.rows[0], attempts: Number(failed.rows[0].attempts) })
      .toEqual({ status: "failed", error_code: "mail_source_unauthorized", attempts: 1 });
  });

  it("retries a 429 once and retains the source retry-after for the durable scheduler", async () => {
    let remoteReads = 0;
    const retryAfterMs = 10;
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "pageEmailConversations") {
          remoteReads += 1;
          throw Object.assign(new Error("fixture rate limit"), { remoteStatus: 429, remoteRetryAfterMs: retryAfterMs });
        }
        if (name === "pageMailboxes")
          return { data: { list: [] } };
        return { data: {} };
      },
      async close() { },
    }));
    const queued = await pgEnqueueExecutionJob({
      job_type: "mail.sync", tenant_ref: ACTOR_ID, actor_ref: ACTOR_ID,
      idempotency_key: "mail-sync-native-429", object_ref: { mailbox: MAILBOX }, payload: { mailbox: MAILBOX }, max_attempts: 3,
    });
    const claimed = await pgClaimExecutionJobById(String(queued.job.id), "mail-native-worker-429");
    const startedAt = Date.now();
    expect(await dispatchClaimedExecutionJob(claimed!)).toMatchObject({ job_type: "mail.sync", outcome: "failed" });
    expect(remoteReads).toBe(2);
    const retrying = await postgresPool().query<{
      status: string;
      error_code: string;
      attempts: number;
      next_attempt_at: string;
    }>("SELECT status,error_code,attempts,next_attempt_at FROM execution_jobs WHERE id=$1", [queued.job.id]);
    expect({ ...retrying.rows[0], attempts: Number(retrying.rows[0].attempts) })
      .toMatchObject({ status: "retrying", error_code: "mail_source_rate_limited", attempts: 1 });
    expect(Date.parse(String(retrying.rows[0].next_attempt_at))).toBeGreaterThanOrEqual(startedAt + retryAfterMs);
  });

  it("stops body persistence when the mailbox scope is revoked at a body checkpoint", async () => {
    let releaseBody: (() => void) | undefined;
    const bodyGate = new Promise<void>((resolve) => { releaseBody = resolve; });
    let bodyStarted: (() => void) | undefined;
    const bodyStartedPromise = new Promise<void>((resolve) => { bodyStarted = resolve; });
    let remoteReads = 0;
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "pageEmailConversations") {
          return { data: { total: 1, pageSize: 1, list: [conversation("7401", true, "2026-10-12T00:00:00.000Z")] } };
        }
        if (name === "getEmailConversation") {
          remoteReads += 1;
          bodyStarted?.();
          await bodyGate;
          return { data: { conversationId: "7401", messages: [{
            id: "revoked-message", direction: "inbound", body: "must not persist", sentAt: "2026-10-12T00:00:00.000Z",
          }] } };
        }
        if (name === "pageMailboxes")
          return { data: { list: [] } };
        return { data: {} };
      },
      async close() { },
    }));
    const queued = await pgEnqueueExecutionJob({
      job_type: "mail.sync", tenant_ref: ACTOR_ID, actor_ref: ACTOR_ID,
      idempotency_key: "mail-sync-native-revoked", object_ref: { mailbox: MAILBOX }, payload: { mailbox: MAILBOX }, max_attempts: 3,
    });
    const claimed = await pgClaimExecutionJobById(String(queued.job.id), "mail-native-worker-revoked");
    const dispatched = dispatchClaimedExecutionJob(claimed!);
    try {
      await bodyStartedPromise;
      await postgresPool().query("UPDATE user_starry_bindings SET status='expired' WHERE user_id=$1 AND mailbox_email=$2", [ACTOR_ID, MAILBOX]);
    }
    finally {
      releaseBody?.();
    }
    expect(await dispatched).toMatchObject({ job_type: "mail.sync", outcome: "failed" });
    expect(remoteReads).toBe(1);
    const failed = await postgresPool().query<{
      status: string;
      error_code: string;
      attempts: number;
    }>("SELECT status,error_code,attempts FROM execution_jobs WHERE id=$1", [queued.job.id]);
    expect({ ...failed.rows[0], attempts: Number(failed.rows[0].attempts) })
      .toEqual({ status: "failed", error_code: "mailbox_access_denied", attempts: 1 });
    const bodies = await postgresPool().query<{
      n: number;
    }>("SELECT count(*)::int AS n FROM kol_mail_items");
    expect(Number(bodies.rows[0].n)).toBe(0);
  });
});
