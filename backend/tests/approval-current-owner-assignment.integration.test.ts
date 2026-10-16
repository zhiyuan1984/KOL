import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { applyPostgresMigrations } from "../src/postgres/migrations.js";

const isolatedPostgres = Boolean(process.env.TEST_DATABASE_URL);
const AID = "appr_eb5335a2b424";
const TARGET = "usr_org_zhang_huiling";
const ADMIN = "usr_assignment_test_admin";
const SAME_NAME = "usr_assignment_same_name";
const PASSWORD = "assignment-test-password";

let app: Hono;
let adminCookie = "";
let targetCookie = "";
let sameNameCookie = "";

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function call(method: string, url: string, body?: unknown, cookie = adminCookie) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const response = await app.request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  return {
    status: response.status,
    json: raw ? JSON.parse(raw) as Record<string, unknown> : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

async function sessionFor(userId: string): Promise<string> {
  const token = `assignment-test-${userId}`;
  const user = await postgresPool().query<{ id: string }>("SELECT id FROM users WHERE id=$1", [userId]);
  expect(user.rows, `missing session user ${userId}`).toHaveLength(1);
  await postgresPool().query(
    "INSERT INTO auth_sessions (id_hash,user_id,expires_at,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id_hash) DO UPDATE SET user_id=EXCLUDED.user_id,expires_at=EXCLUDED.expires_at,created_at=EXCLUDED.created_at",
    [tokenDigest(token), userId, "2035-01-01T00:00:00.000Z", "2032-03-04T05:06:07.000Z"],
  );
  return `lingong_session=${token}`;
}

async function seedTestAccounts(): Promise<void> {
  const now = "2032-03-04T05:06:07.000Z";
  await postgresPool().query("DROP TRIGGER IF EXISTS reject_assignment_audit ON audit_events");
  await postgresPool().query("DROP FUNCTION IF EXISTS reject_assignment_audit()");
  await postgresPool().query("DELETE FROM approval_role_bindings WHERE user_id=$1 AND approval_role='emp_zhang'", [ADMIN]);
  await postgresPool().query("DELETE FROM users WHERE id='usr_exact_zhang'");
  // parent_test_runner provides one database for this selected file; reset only
  // artifacts owned by this fixture so every assertion starts from version zero.
  await postgresPool().query(
    "DELETE FROM approval_idempotency WHERE approval_id IN ($1,$2)",
    [AID, "appr_other_ticket"],
  );
  await postgresPool().query(
    `DELETE FROM audit_events
      WHERE event_type='approval.current_owner.assigned'
        AND payload::text LIKE $1`,
    [`%\"approval_id\":\"${AID}\"%`],
  );
  await postgresPool().query(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email)
     VALUES ($1,$2,$3,$4,$5,'[]','',1,$6,$6,$2)
     ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,roles=EXCLUDED.roles,active=1,email=EXCLUDED.email,updated_at=EXCLUDED.updated_at`,
    [TARGET, "willa.zhang@amperetime.com", "张慧玲", "not-used-in-session-test", JSON.stringify(["employee", "admin"]), now],
  );
  await postgresPool().query(
    `INSERT INTO organization_people (person_ref,display_name,user_ref,user_id,email,status,source,created_at,updated_at)
     VALUES ('person:zhang_huiling','张慧玲',$1,$1,'willa.zhang@amperetime.com','active','test',$2,$2)
     ON CONFLICT (person_ref) DO UPDATE SET display_name=EXCLUDED.display_name,user_ref=EXCLUDED.user_ref,user_id=EXCLUDED.user_id,email=EXCLUDED.email,status='active',updated_at=EXCLUDED.updated_at`,
    [TARGET, now],
  );
  await postgresPool().query(
    `INSERT INTO approvals
      (id,draft_id,brand,amount_usd,status,chain,current_index,uses_left,fingerprint,need_manual_band,wecom_card_id,created_at,chain_id,kind,payload,title,submitted_by,version,updated_at)
     VALUES ($1,'','LT',0,'pending','["emp_zhang"]',0,1,'objects-owner-assignment',0,'card_objects_owner',$2,$1,'ontology_change',$3,'本体变更审批：对象注册表','jeffrey',0,$2)
     ON CONFLICT (id) DO UPDATE SET status='pending',chain=EXCLUDED.chain,current_index=0,uses_left=1,kind='ontology_change',payload=EXCLUDED.payload,version=0,updated_at=EXCLUDED.updated_at`,
    [AID, now, JSON.stringify({
      scope: "objects",
      scope_label: "对象注册表",
      summary: "新增主数据导入批次对象 C15，支撑 master-data 导入链路",
      change_ref: "4788ff93fdb6a773ede6a87be78ab7259c7502d1",
      target_digest: "sha256:ad078e6b45389c6580a1a70a275e4920bf73a6451317f766174a777e1feb7854",
      base_version: "objects:v1@git:b5bd14cbf52ef575a4e7f7bd8ad30849f33a934a",
      requester_name: "黄启友",
      steps: [{ employee_id: "emp_zhang", name: "张总", role: "CEO" }],
    })],
  );
  await postgresPool().query(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email)
     VALUES ($1,$2,$3,$4,$5,'[]','',1,$6,$6,$2)
     ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,roles=EXCLUDED.roles,active=1,email=EXCLUDED.email,updated_at=EXCLUDED.updated_at`,
    [ADMIN, "assignment-admin@example.test", "审批指派管理员", "not-used-in-session-test", JSON.stringify(["employee", "admin"]), now],
  );
  await postgresPool().query(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email)
     VALUES ($1,$2,$3,$4,$5,'[]','',1,$6,$6,$2)
     ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,roles=EXCLUDED.roles,active=1,email=EXCLUDED.email,updated_at=EXCLUDED.updated_at`,
    [SAME_NAME, "same-name@example.test", "张慧玲", "not-used-in-session-test", JSON.stringify(["employee"]), now],
  );
  await postgresPool().query(
    `INSERT INTO approvals
      (id,draft_id,brand,amount_usd,status,chain,current_index,uses_left,fingerprint,need_manual_band,wecom_card_id,created_at,chain_id,kind,payload,title,submitted_by,version,updated_at)
     VALUES ($1,'','LT',0,'pending','["emp_zhang"]',0,1,'other-fingerprint',0,'card_other',$2,'other-chain','ontology_change',$3,'other object approval','tester',0,$2)
     ON CONFLICT (id) DO UPDATE SET status='pending',chain=EXCLUDED.chain,current_index=0,uses_left=1,kind='ontology_change',payload=EXCLUDED.payload,version=0,updated_at=EXCLUDED.updated_at`,
    ["appr_other_ticket", now, JSON.stringify({ scope: "objects", base_version: "objects:v1@test", target_digest: "sha256:other", change_ref: "other", steps: [{ employee_id: "emp_zhang", name: "张总", role: "CEO" }] })],
  );
}

async function currentApproval() {
  const { rows } = await postgresPool().query<{
    status: string; chain: string; payload: string; current_index: number; uses_left: number; version: number;
  }>("SELECT status,chain,payload,current_index,uses_left,version FROM approvals WHERE id=$1", [AID]);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function assign(extra: Record<string, unknown> = {}) {
  return call("POST", `/api/admin/approvals/${AID}/assign-current-owner`, {
    target_user_id: TARGET,
    reason: "用户明确授权张慧玲仅终审此 objects 变更单",
    expected_version: 0,
    idempotency_key: "assignment-current-owner-1",
    ...extra,
  });
}

describe.skipIf(!isolatedPostgres)("approval current-owner assignment (isolated PostgreSQL)", () => {
  beforeEach(async () => {
    // parent_test_runner creates one uniquely named database and drops it in finally.
    // Reuse that native PostgreSQL fixture: this test must never clone a second DB
    // or target the production connection.  Reset only pooled clients before seed.
    await closePostgresPool();
    process.env.CODEX_MODE = "real";
    process.env.AUTH_MODE = "enabled";
    const { resetConn } = await import("../src/db.js");
    await resetConn();
    if (!/^kolnative_resolution_suite_[0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Owned suite database required");
    const migrationClient = await postgresPool().connect();
    try { await applyPostgresMigrations(migrationClient); } finally { migrationClient.release(); }
    await seedTestAccounts();
    const { createApp } = await import("../src/app.js");
    app = await createApp();
    adminCookie = await sessionFor(ADMIN);
    targetCookie = await sessionFor(TARGET);
    sameNameCookie = await sessionFor(SAME_NAME);
  });

  afterEach(async () => {
    delete process.env.AUTH_MODE;
    process.env.CODEX_MODE = "stub";
    await closePostgresPool();
  });

  it("uses a real admin actor to atomically assign only this pending objects ticket, then exposes it only to the canonical user", async () => {
    const before = await currentApproval();
    const otherBefore = await postgresPool().query("SELECT status,chain,payload,current_index,uses_left,version FROM approvals WHERE id='appr_other_ticket'");
    const response = await assign();
    expect(response.status).toBe(200);
    expect(response.json.replayed).toBe(false);
    expect(response.json.can_decide).toBe(false); // Admin wildcard is not an approval decision right.

    const after = await currentApproval();
    const payload = JSON.parse(after.payload) as {
      scope: string; base_version: string; target_digest: string; change_ref: string;
      steps: Array<Record<string, unknown>>; original_node: string; original_step: Record<string, unknown>;
      assignment_history: Array<Record<string, unknown>>;
    };
    expect(JSON.parse(after.chain)).toEqual([`user:${TARGET}`]);
    expect(after.status).toBe("pending");
    expect(after.current_index).toBe(before.current_index);
    expect(after.uses_left).toBe(before.uses_left);
    expect(after.version).toBe(1);
    expect(payload.scope).toBe("objects");
    expect(payload.base_version).toBe("objects:v1@git:b5bd14cbf52ef575a4e7f7bd8ad30849f33a934a");
    expect(payload.target_digest).toBe("sha256:ad078e6b45389c6580a1a70a275e4920bf73a6451317f766174a777e1feb7854");
    expect(payload.change_ref).toBe("4788ff93fdb6a773ede6a87be78ab7259c7502d1");
    expect(payload.original_node).toBe("emp_zhang");
    expect(payload.original_step).toMatchObject({ employee_id: "emp_zhang", name: "张总" });
    expect(payload.steps[0]).toMatchObject({
      employee_id: `user:${TARGET}`, user_id: TARGET, person_ref: "person:zhang_huiling", name: "张慧玲",
      role: "本体变更 objects 单张授权终审人",
    });
    expect(payload.assignment_history).toHaveLength(1);
    expect(payload.assignment_history[0]).toMatchObject({
      from_node: "emp_zhang", target_user_id: TARGET, person_ref: "person:zhang_huiling",
      reason: "用户明确授权张慧玲仅终审此 objects 变更单",
    });

    const targetInbox = await call("GET", "/api/approvals?box=inbox", undefined, targetCookie);
    expect(targetInbox.status).toBe(200);
    expect((targetInbox.json as unknown as Array<{ id: string; can_decide: boolean }>).find((row) => row.id === AID)?.can_decide).toBe(true);
    const sameNameDetail = await call("GET", `/api/approvals/${AID}`, undefined, sameNameCookie);
    expect(sameNameDetail.status).toBe(404);
    const adminDecide = await call("POST", `/api/approvals/${AID}/decide`, {
      decision: "approve", expected_version: 1, idempotency_key: "admin-must-not-decide",
    }, adminCookie);
    expect([403, 404]).toContain(adminDecide.status);

    const otherAfter = await postgresPool().query("SELECT status,chain,payload,current_index,uses_left,version FROM approvals WHERE id='appr_other_ticket'");
    expect(otherAfter.rows).toEqual(otherBefore.rows);
    const audit = await postgresPool().query<{ actor: string; event_type: string; payload: string }>(
      "SELECT actor,event_type,payload FROM audit_events WHERE event_type='approval.current_owner.assigned' ORDER BY id DESC LIMIT 1",
    );
    expect(audit.rows[0]).toMatchObject({ actor: ADMIN, event_type: "approval.current_owner.assigned" });
    expect(JSON.parse(audit.rows[0].payload)).toMatchObject({ approval_id: AID, actor: { user_id: ADMIN }, before: { chain_node: "emp_zhang" }, after: { chain_node: `user:${TARGET}`, status: "pending", uses_left: 1 } });
  });

  it("allows the assigned human to use the existing final decision and replay flow without external writes", async () => {
    expect((await assign()).status).toBe(200);
    const detail = await call("GET", `/api/approvals/${AID}`, undefined, targetCookie);
    expect(detail.status).toBe(200);
    expect(detail.json.current_node).toBe("张慧玲");
    expect(detail.json.allowed_actions).toEqual(["approve", "reject"]);
    const body = { decision: "approve", expected_version: 1, idempotency_key: "human-final-decision" };
    const decision = await call("POST", `/api/approvals/${AID}/decide`, body, targetCookie);
    expect(decision.status).toBe(200);
    expect(decision.json).toMatchObject({ status: "consumed", ontology_change: true, sent: false, stage_changed: false });
    const replay = await call("POST", `/api/approvals/${AID}/decide`, body, targetCookie);
    expect(replay.status).toBe(200);
    expect(replay.json.replayed).toBe(true);
    const row = await currentApproval();
    expect(row.version).toBe(2);
    expect(row.uses_left).toBe(0);
    const denied = await call("GET", `/api/approvals/${AID}`, undefined, sameNameCookie);
    expect(denied.status).toBe(404);
  });

  it("serializes concurrent identical assignments without duplicating a decision, history or audit", async () => {
    const results = await Promise.all([assign(), assign()]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results.map(result => Boolean(result.json.replayed)).sort()).toEqual([false, true]);
    const row = await currentApproval();
    expect(row.status).toBe("pending");
    expect(row.version).toBe(1);
    expect(JSON.parse(row.payload).assignment_history).toHaveLength(1);
    const audits = await postgresPool().query("SELECT id FROM audit_events WHERE event_type='approval.current_owner.assigned'");
    expect(audits.rows).toHaveLength(1);
  });

  it("does not grant any global roles and rejects unauthorized callers or missing assignment gates", async () => {
    const rolesBefore = await postgresPool().query("SELECT * FROM approval_role_bindings ORDER BY user_id,approval_role");
    const forbidden = await call("POST", `/api/admin/approvals/${AID}/assign-current-owner`, {
      target_user_id: TARGET, reason: "not admin", expected_version: 0, idempotency_key: "not-admin",
    }, sameNameCookie);
    expect(forbidden.status).toBe(403);
    for (const missing of ["target_user_id", "reason", "expected_version", "idempotency_key"]) {
      const body: Record<string, unknown> = {
        target_user_id: TARGET, reason: "single-ticket assignment", expected_version: 0, idempotency_key: "missing-field",
      };
      delete body[missing];
      expect((await call("POST", `/api/admin/approvals/${AID}/assign-current-owner`, body)).status).toBe(400);
    }
    expect((await currentApproval()).version).toBe(0);
    expect((await assign()).status).toBe(200);
    const rolesAfter = await postgresPool().query("SELECT * FROM approval_role_bindings ORDER BY user_id,approval_role");
    expect(rolesAfter.rows).toEqual(rolesBefore.rows);
  });

  it("rolls back the row and idempotency receipt when the required audit cannot be written", async () => {
    await postgresPool().query(`CREATE FUNCTION reject_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type='approval.current_owner.assigned' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
    await postgresPool().query("CREATE TRIGGER reject_assignment_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_assignment_audit()");
    const result = await assign();
    expect(result.status).toBe(500);
    const row = await currentApproval();
    expect(row.status).toBe("pending");
    expect(row.version).toBe(0);
    expect(JSON.parse(row.chain)).toEqual(["emp_zhang"]);
    const receipts = await postgresPool().query("SELECT id FROM approval_idempotency WHERE action='assign_current_owner' AND approval_id=$1", [AID]);
    expect(receipts.rows).toHaveLength(0);
  });

  it("replays only an identical idempotency request without duplicating assignment or audit, and rejects a conflicting reuse", async () => {
    expect((await assign()).status).toBe(200);
    const replay = await assign();
    expect(replay.status).toBe(200);
    expect(replay.json.replayed).toBe(true);
    const row = await currentApproval();
    expect(row.version).toBe(1);
    const payload = JSON.parse(row.payload) as { assignment_history: unknown[] };
    expect(payload.assignment_history).toHaveLength(1);
    const auditCount = await postgresPool().query<{ n: string }>("SELECT COUNT(*)::text AS n FROM audit_events WHERE event_type='approval.current_owner.assigned'");
    expect(auditCount.rows[0].n).toBe("1");
    const conflict = await assign({ reason: "不同原因仍复用相同幂等键" });
    expect(conflict.status).toBe(409);
    expect(conflict.json.detail).toMatchObject({ code: "idempotency_key_conflict" });
  });

  it("refuses to seize a legacy node when exact active-user or exact role-binding evidence already resolves it", async () => {
    const now = "2032-03-04T05:06:07.000Z";
    await postgresPool().query(
      `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email)
       VALUES ('usr_exact_zhang','exact-zhang@example.test','张总','test','["employee"]','[]','',1,$1,$1,'exact-zhang@example.test')`,
      [now],
    );
    const resolvedUser = await assign({ idempotency_key: "assignment-resolved-user" });
    expect(resolvedUser.status).toBe(409);
    expect(resolvedUser.json.detail).toMatchObject({ code: "current_node_resolved_to_active_user" });
    expect((await currentApproval()).version).toBe(0);

    await postgresPool().query("UPDATE users SET active=0 WHERE id='usr_exact_zhang'");
    await postgresPool().query(
      "INSERT INTO approval_role_bindings (user_id,approval_role,created_at,valid_from,valid_to) VALUES ($1,'emp_zhang',$2,NULL,NULL)",
      [ADMIN, now],
    );
    const bound = await assign({ idempotency_key: "assignment-resolved-binding" });
    expect(bound.status).toBe(409);
    expect(bound.json.detail).toMatchObject({ code: "current_node_has_active_approval_binding" });
    expect((await currentApproval()).version).toBe(0);
  });

  it("rejects inactive targets, stale versions, non-pending approvals and legacy nodes that already resolve to an active user", async () => {
    await postgresPool().query("UPDATE users SET active=0 WHERE id=$1", [TARGET]);
    const inactive = await assign();
    expect(inactive.status).toBe(400);
    expect(inactive.json.detail).toMatchObject({ code: "target_user_inactive" });
    expect((await currentApproval()).version).toBe(0);

    await postgresPool().query("UPDATE users SET active=1 WHERE id=$1", [TARGET]);
    const stale = await assign({ expected_version: 9, idempotency_key: "assignment-stale" });
    expect(stale.status).toBe(409);
    expect(stale.json.detail).toMatchObject({ code: "stale" });

    await postgresPool().query("UPDATE approvals SET status='consumed' WHERE id=$1", [AID]);
    const nonPending = await assign({ idempotency_key: "assignment-nonpending" });
    expect(nonPending.status).toBe(409);
    expect(nonPending.json.detail).toMatchObject({ code: "approval_not_pending" });
  });
});
