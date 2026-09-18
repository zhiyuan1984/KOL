import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { ensureSystemCronJobs, jobByKey } from "../src/cron/store.js";
import { enqueueManualRun, tickCronDue } from "../src/cron/worker.js";
import { nextRunAt } from "../src/cron/schedule.js";
import { CRON_HANDLERS } from "../src/cron/handlers.js";
import { releaseFollowOwnershipIfEligible } from "../src/gateway/ownership-release.js";

type Json = Record<string, unknown>;
let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

function insertCollab(row: {
  id: string;
  handle: string;
  owner?: string;
  overdue?: number;
  stage?: string;
  days?: number;
  kolUid?: string;
}) {
  getConn().prepare(
    `INSERT OR REPLACE INTO collaborations
     (id,handle,display_name,brand,platform,followers,email,mailbox_from,lifecycle_id,conversation_id,
      stage_code,days_in_stage,notes,overdue,kol_uid)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id, row.handle, row.handle, "LT", "YouTube", "1", "a@example.com", "from@example.com",
    `lc_${row.id}`, `conv_${row.id}`, row.stage || "INITIAL_CONTACT", row.days ?? 16, "", row.overdue ?? 1,
    row.kolUid || row.handle,
  );
  if (row.owner) {
    getConn().prepare("UPDATE collaborations SET owner_name=? WHERE id=?").run(row.owner, row.id);
  }
}

function insertFollow(row: {
  collaborationId: string;
  owner: string;
  lastAt?: string | null;
  kolUid?: string;
}) {
  const now = new Date().toISOString();
  const kolUid = row.kolUid || row.collaborationId.replace(/^col_/, "");
  getConn().prepare(
    `INSERT OR REPLACE INTO kol_profile_index
     (id,company_id,kol_uid,handle,display_name,platform,pool_status,idle,ingest_source,ingested_at,public_stage,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(`kpi_${kolUid}`, "company:amperetime", kolUid, kolUid, kolUid, "YouTube",
    "claimed", 0, "test", now, "INITIAL_CONTACT", now, now);
  getConn().prepare(
    `INSERT OR REPLACE INTO kol_follow_index
     (id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,claimed_at,
      last_effective_mail_at,release_due_at,collaboration_id,data_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    `kfi_${row.collaborationId}`, "company:amperetime", kolUid, "LT", row.owner, row.owner, "active", now,
    row.lastAt || null, row.lastAt ? new Date(Date.parse(row.lastAt) + 14 * 86400000).toISOString() : null,
    row.collaborationId, 1, now, now,
  );
}

function insertMail(collaborationId: string, lastAt: string) {
  getConn().prepare(
    `INSERT OR REPLACE INTO kol_mail_threads
     (id,collaboration_id,conversation_id,subject,last_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(`th_${collaborationId}`, collaborationId, `conv_${collaborationId}`, "hi", lastAt, lastAt, lastAt);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-cron-"));
  process.env.LINGONG_DB = path.join(tmp, "cron.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  delete process.env.CRON_TICK_SECRET;
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CRON_TICK_SECRET;
  delete process.env.AUTH_MODE;
});

describe("cron jobs P0/P1", () => {
  it("seeds four system jobs and keeps discovery disabled", () => {
    ensureSystemCronJobs();
    const keys = getConn().prepare("SELECT job_key, status, execute_as, owner_account_id FROM cron_jobs ORDER BY job_key")
      .all() as Array<{ job_key: string; status: string; execute_as: string; owner_account_id: string | null }>;
    expect(keys.map((row) => row.job_key)).toEqual([
      "daily-task-snapshot",
      "discovery-search",
      "overdue-scan",
      "ownership-release",
    ]);
    expect(keys.every((row) => row.execute_as === "system" && row.owner_account_id == null)).toBe(true);
    expect(keys.find((row) => row.job_key === "discovery-search")?.status).toBe("disabled");
    expect(keys.filter((row) => row.job_key !== "discovery-search").every((row) => row.status === "published")).toBe(true);
  });

  it("lists jobs and overdue-scan view without creating a session", async () => {
    insertCollab({ id: "col_over", handle: "latekol", overdue: 1, days: 11 });
    const listed = await request("GET", "/api/cron/jobs");
    expect(listed.status).toBe(200);
    const jobs = listed.body.jobs as Json[];
    expect(jobs.some((job) => job.job_key === "overdue-scan")).toBe(true);
    const before = (getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    const risks = await request("GET", "/api/cron/risks");
    expect(risks.status).toBe(200);
    expect(String(risks.body.p0)).toBe("失联与延期扫描");
    expect(JSON.stringify(risks.body)).not.toMatch(/T8/);
    expect((risks.body.items as Json[]).some((row) => row.handle === "latekol")).toBe(true);
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(before);
  });

  it("manual overdue-scan returns only run_id and writes a read receipt", async () => {
    insertCollab({ id: "col_over", handle: "latekol", overdue: 1, days: 19 });
    const beforeSessions = (getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    const started = await request("POST", "/api/cron/jobs/overdue-scan/run");
    expect(started.status).toBe(200);
    expect(Object.keys(started.body)).toEqual(["run_id"]);
    expect(started.body.session_id).toBeUndefined();
    const run = await request("GET", `/api/cron/runs/${started.body.run_id}`);
    expect(run.status).toBe(200);
    const payload = (run.body.run as Json);
    expect(payload.session_id).toBeNull();
    expect(payload.status).toBe("succeeded");
    const receipt = payload.receipt as Json;
    expect(receipt.created_session).toBe(false);
    expect(receipt.handler_key).toBe("overdue-scan");
    expect((receipt.items as Json[]).some((row) => row.handle === "latekol")).toBe(true);
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(beforeSessions);
  });

  it("compat risk-scan no longer inserts a session", async () => {
    const before = (getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    const scan = await request("POST", "/api/cron/risk-scan");
    expect(scan.status).toBe(200);
    expect(scan.body.run_id).toBeTruthy();
    expect(scan.body.session_id).toBeUndefined();
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(before);
  });

  it("enforces one successful enqueue per job_id + scheduled_for", () => {
    const job = jobByKey("overdue-scan");
    expect(job).toBeTruthy();
    const slot = "2026-09-16T08:00:00.000Z";
    const first = enqueueManualRun(String(job?.id), slot);
    const second = enqueueManualRun(String(job?.id), slot);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.run_id).toBe(first.run_id);
    const n = (getConn().prepare("SELECT COUNT(*) AS n FROM cron_runs WHERE job_id=? AND scheduled_for=?")
      .get(job?.id, slot) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("tickCronDue claims a due published job via BEGIN IMMEDIATE and does not create a session", () => {
    insertCollab({ id: "col_over", handle: "duekol", overdue: 1 });
    const job = jobByKey("overdue-scan");
    getConn().prepare("UPDATE cron_jobs SET next_run_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z", job?.id);
    const before = (getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    const tick = tickCronDue(new Date("2026-09-16T01:00:00.000Z"));
    expect(tick.claimed.length).toBeGreaterThan(0);
    const run = getConn().prepare("SELECT * FROM cron_runs WHERE id=?").get(tick.claimed[0]) as {
      status: string;
      session_id: string | null;
      trigger: string;
    };
    expect(run.trigger).toBe("schedule");
    expect(["succeeded", "skipped"]).toContain(run.status);
    expect(run.session_id).toBeNull();
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(before);
  });

  it("daily-task-snapshot is read-only and buckets greet/follow/quote/negotiate", async () => {
    insertCollab({ id: "col_greet", handle: "g1", overdue: 0, stage: "INITIAL_CONTACT", days: 2 });
    insertCollab({ id: "col_follow", handle: "f1", overdue: 0, stage: "INTERESTED", days: 3 });
    insertCollab({ id: "col_quote", handle: "q1", overdue: 0, stage: "QUOTE_PENDING", days: 1 });
    insertCollab({ id: "col_neg", handle: "n1", overdue: 0, stage: "NEGOTIATING", days: 1 });
    const started = await request("POST", "/api/cron/jobs/daily-task-snapshot/run");
    const run = await request("GET", `/api/cron/runs/${started.body.run_id}`);
    const receipt = (run.body.run as Json).receipt as Json;
    const counts = receipt.counts as Record<string, number>;
    expect(receipt.created_session).toBe(false);
    expect(receipt.side_effect).toBe("read");
    expect(counts.greet).toBeGreaterThan(0);
    expect(counts.follow).toBeGreaterThan(0);
    expect(counts.quote).toBeGreaterThan(0);
    expect(counts.negotiate).toBeGreaterThan(0);
  });

  it("ownership-release skips missing correspondence and renewed/reassigned relationships", async () => {
    insertCollab({ id: "col_gap", handle: "gap", owner: "甲", overdue: 0, days: 20, kolUid: "gap" });
    insertFollow({ collaborationId: "col_gap", owner: "甲", lastAt: null, kolUid: "gap" });
    insertCollab({ id: "col_new", handle: "fresh", owner: "乙", overdue: 0, days: 20, kolUid: "fresh" });
    const freshAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    insertMail("col_new", freshAt);
    insertFollow({ collaborationId: "col_new", owner: "乙", lastAt: freshAt, kolUid: "fresh" });
    insertCollab({ id: "col_old", handle: "stale", owner: "丙", overdue: 0, days: 20, kolUid: "stale" });
    const staleAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    insertMail("col_old", staleAt);
    insertFollow({ collaborationId: "col_old", owner: "丙", lastAt: staleAt, kolUid: "stale" });
    const started = await request("POST", "/api/cron/jobs/ownership-release/run");
    const run = await request("GET", `/api/cron/runs/${started.body.run_id}`);
    const receipt = (run.body.run as Json).receipt as Json;
    const skipped = receipt.skipped as Array<{ collaboration_id: string; follow_id?: string; reason: string }>;
    const released = receipt.released as Array<{ collaboration_id: string; owner_before: string }>;
    expect(skipped.some((row) => (row.collaboration_id === "col_gap" || row.follow_id === "kfi_col_gap") && row.reason === "correspondence_incomplete")).toBe(true);
    expect(skipped.some((row) => (row.collaboration_id === "col_new" || row.follow_id === "kfi_col_new") && row.reason === "renewed")).toBe(true);
    expect(released.some((row) => (row.collaboration_id === "col_old" || row.owner_before === "丙"))).toBe(true);
    expect((getConn().prepare("SELECT owner_name FROM collaborations WHERE id='col_old'").get() as { owner_name: string | null }).owner_name).toBeNull();
    expect((getConn().prepare("SELECT owner_name, stage_code FROM collaborations WHERE id='col_new'").get() as {
      owner_name: string;
      stage_code: string;
    })).toMatchObject({ owner_name: "乙", stage_code: "INITIAL_CONTACT" });
    expect((getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_old'").get() as { stage_code: string }).stage_code).toBe("INITIAL_CONTACT");
  });

  it("ownership-release re-read skips if the owner changed before the write", () => {
    insertCollab({ id: "col_race", handle: "race", owner: "旧人", overdue: 0, days: 20, kolUid: "race" });
    const lastAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    insertMail("col_race", lastAt);
    insertFollow({ collaborationId: "col_race", owner: "旧人", lastAt, kolUid: "race" });
    getConn().prepare("UPDATE collaborations SET owner_name=? WHERE id=?").run("新人", "col_race");
    getConn().prepare("UPDATE kol_follow_index SET employee_id=?, employee_name=? WHERE id=?").run("新人", "新人", "kfi_col_race");
    const decision = releaseFollowOwnershipIfEligible({
      db: getConn(),
      followId: "kfi_col_race",
      collaborationId: "col_race",
      expectedOwner: "旧人",
      expectedLastAt: lastAt,
      actor: "system",
    });
    expect(decision).toMatchObject({ action: "skip", reason: "reassigned" });
    expect((getConn().prepare("SELECT owner_name FROM collaborations WHERE id='col_race'").get() as { owner_name: string }).owner_name).toBe("新人");
  });

  it("discovery-search stays disabled and does not fake a run", async () => {
    const run = await request("POST", "/api/cron/jobs/discovery-search/run");
    expect(run.status).toBe(409);
    expect((run.body.detail as Json)?.code || run.body.code).toBeTruthy();
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates").get() as { n: number }).n).toBe(0);
  });

  it("pause/resume and frequency change bump published_rev on in-scope jobs", async () => {
    const paused = await request("PATCH", "/api/cron/jobs/overdue-scan", { status: "paused" });
    expect(paused.status).toBe(200);
    expect((paused.body.job as Json).status).toBe("paused");
    const freq = await request("PATCH", "/api/cron/jobs/overdue-scan", { cron_expr: "30 9 * * *" });
    expect((freq.body.job as Json).published_rev).toBe(2);
    expect((freq.body.job as Json).cron_expr).toBe("30 9 * * *");
    const legal = await request("PATCH", "/api/cron/jobs/overdue-scan", { handler_key: "daily-task-snapshot" });
    expect(legal.status).toBe(403);
  });

  it("internal tick accepts CRON_TICK_SECRET and rejects employees when auth is on", async () => {
    process.env.CRON_TICK_SECRET = "tick-secret-value";
    getConn().prepare("UPDATE cron_jobs SET next_run_at=? WHERE job_key='overdue-scan'")
      .run("2020-01-01T00:00:00.000Z");
    const ok = await request("POST", "/api/cron/internal/tick", {}, { "x-cron-tick-secret": "tick-secret-value" });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.claimed)).toBeGreaterThanOrEqual(0);
    process.env.AUTH_MODE = "enabled";
    process.env.CODEX_MODE = "real";
    const denied = await request("POST", "/api/cron/internal/tick");
    expect(denied.status).toBe(403);
  });

  it("computes a future next_run_at from a daily cron expression", () => {
    const next = nextRunAt("0 8 * * *", "Asia/Shanghai", new Date("2026-09-16T01:00:00.000Z"));
    expect(next.getTime()).toBeGreaterThan(Date.parse("2026-09-16T01:00:00.000Z"));
  });

  it("handler registry is an explicit map and does not import write side-effects", () => {
    expect(Object.keys(CRON_HANDLERS).sort()).toEqual([
      "daily-task-snapshot",
      "discovery-search",
      "overdue-scan",
      "ownership-release",
    ]);
    const source = fs.readFileSync(path.join(process.cwd(), "src/cron/handlers.ts"), "utf8");
    expect(source).not.toMatch(/sendDraft|confirmStarryStage|createWorkApproval|followCandidate|contact_decrypt/);
    expect(source).not.toMatch(/INSERT INTO sessions/);
  });
});
