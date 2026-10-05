import { beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { postgresPool, postgresTransaction } from "../src/postgres/pool.js";
import { createTaskRootPostgres, taskWorkOrderAggregate, taskWorkOrderDashboard } from "../src/ticket-domain/task-work-orders.js";
import { publishWorkOrderTemplate } from "../src/ticket-domain/work-order-template-governance.js";
import { syncWorkbenchTicketPrincipal } from "../src/ticket-domain/auth.js";
import { collaborationContentHash, parseCollaborationPolicy, readTaskCollaborationContext, workOrderCollaborationGate } from "../src/ticket-domain/collaboration-context.js";
import { advanceWorkOrderStageForDecision } from "../src/ticket-domain/work-order-stage-executor.js";

let taskId: string;
const policy = { schema: "work-order-collaboration.v1", action_id: "work_order.advance_stage",
  prerequisites: [{ template_code: "fixture_prior", template_version: 1 }],
  review: { company_id: "fixture-company", template_id: "fixture-review", template_version: 1, fields: {
    collaboration_id: "col", work_order_id: "wo", action_id: "action", artifact_id: "artifact", artifact_version: "version", content_hash: "hash" } } };
const material = { text: "Isolated approval material" };
const hash = collaborationContentHash(material);
const values = { col: "fixture-col", wo: "fixture-next", action: "work_order.advance_stage", artifact: "fixture-artifact", version: 1, hash };
const payload = (status = "approved", round = 1, v: unknown = values) => JSON.stringify({ status, round, values: v });

beforeEach(async () => {
  await freshTestDatabase();
  const db = postgresPool(), now = new Date().toISOString();
  await db.query(`INSERT INTO users(id,username,name,password_hash,brands,created_at,updated_at)
    VALUES ('fixture-actor','fixture-actor','Fixture Actor','isolated-test-only','["fixture-brand"]',$1,$1)`, [now]);
  await syncWorkbenchTicketPrincipal({ id: "fixture-actor", username: "fixture-actor", name: "Fixture Actor", roles: ["employee"], active: true });
  await db.query(`INSERT INTO organization_units(id,company_id,display_name,type,level,created_at,updated_at) VALUES ('fixture-unit','fixture-company','Fixture Unit','department',1,$1,$1)`, [now]);
  await db.query(`INSERT INTO organization_people(person_ref,display_name,user_id,created_at,updated_at) VALUES ('fixture-person','Fixture Actor','fixture-actor',$1,$1)`, [now]);
  await db.query(`INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,created_at,updated_at) VALUES ('fixture-member','fixture-person','fixture-company','fixture-unit',$1,$1)`, [now]);
  await db.query(`INSERT INTO collaborations(id,handle,display_name,brand,email,mailbox_from,lifecycle_id,conversation_id,stage_code)
    VALUES ('fixture-col','fixture','Fixture','fixture-brand','','','','','OUTREACHING')`);
  taskId = (await createTaskRootPostgres("fixture-actor", { title: "Isolated dependency task", idempotency_key: "fixture-create-task" })).task_id;
  await db.query("UPDATE tickets SET collaboration_id='fixture-col' WHERE id=$1", [taskId]);
  await db.query(`INSERT INTO task_artifacts(id,work_item_id,artifact_type,version,payload,created_at) VALUES ('fixture-artifact',$1,'brief',1,$2,$3)`, [taskId, JSON.stringify(material), now]);
  await db.query(`INSERT INTO work_order_templates(id,template_code,version,title,status,automation_level,fill_policy_json,created_by)
    VALUES ('fixture-prior-template','fixture_prior',1,'Prior','published','A1','{}','fixture-actor'),
      ('fixture-next-template','fixture_next',1,'Next','published','A3',$1,'fixture-actor')`, [JSON.stringify({ collaboration_dependencies: policy })]);
  await db.query(`INSERT INTO work_orders(id,task_id,template_id,template_code,template_version,status,title,automation_level,created_by,payload_json,stage_code)
    VALUES ('fixture-prior',$1,'fixture-prior-template','fixture_prior',1,'completed','Prior','A1','fixture-actor','{}',NULL),
      ('fixture-next',$1,'fixture-next-template','fixture_next',1,'in_progress','Next','A3','fixture-actor',$2,'OUTREACHING')`,
    [taskId, JSON.stringify({ collaboration_context: { company_id: "fixture-company", collaboration_id: "fixture-col", artifact_id: "fixture-artifact",
      artifact_version: 1, content_hash: hash, review_instance_id: "fixture-instance", prerequisite_work_order_ids: ["fixture-prior"] } })]);
  const definition = JSON.stringify({ fields: Object.values(policy.review.fields).map(id => ({ id, type: "text" })) });
  await db.query(`INSERT INTO review_templates(tenant,id,version,published_version,definition,updated_at) VALUES ('fixture-company','fixture-review',1,1,$1,$2)`, [definition, now]);
  await db.query(`INSERT INTO review_versions(tenant,template_id,version,definition,published_by,published_at) VALUES ('fixture-company','fixture-review',1,$1,'fixture-actor',$2)`, [definition, now]);
  await postgresTransaction(async client => {
    await client.query(`INSERT INTO review_instances(tenant,id,template_id,template_version,version,requester,status,payload,updated_at)
      VALUES ('fixture-company','fixture-instance','fixture-review',1,1,'fixture-actor','approved',$1,$2)`, [payload(), now]);
    await client.query(`INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at)
      VALUES ('fixture-event','fixture-company','fixture-instance','fixture-actor','approve',1,'{}',$1)`, [now]);
  });
  await db.query(`INSERT INTO review_participants(tenant,instance_id,user_id) VALUES ('fixture-company','fixture-instance','fixture-actor')`);
});

async function gate() { return workOrderCollaborationGate(postgresPool(), "fixture-actor", "fixture-next"); }
async function decision() {
  const current = await gate();
  return (await postgresPool().query(`INSERT INTO work_order_decisions(task_id,work_order_id,source_event_id,template_code,template_version,decision_mode,outcome,status,input_hash,input_json,judgment_json,actor_ref,idempotency_key)
    VALUES ($1,'fixture-next','fixture-source','fixture_next',1,'shadow','advance_stage','recorded','fixture-hash',$2,'{}','fixture-actor','fixture-decision') RETURNING id`,
    [taskId, JSON.stringify({ work_order: { id: "fixture-next", data_version: 1, stage_code: "OUTREACHING" }, collaboration_gate: current })])).rows[0].id;
}

describe("native collaboration dependency and source-event boundaries", () => {
  it("matches only exact approval action, cooperation and immutable content basis", async () => {
    expect(await gate()).toMatchObject({ allowed: true, configured: true, review: { status: "approved", version: 1, round: 1 } });
    const db = postgresPool();
    await db.query("UPDATE task_artifacts SET payload=$1 WHERE id='fixture-artifact'", [JSON.stringify({ text: "Different material of same length" })]);
    expect((await gate()).blockers).toContain("artifact_version_conflict");
    expect((await db.query("SELECT status FROM tickets WHERE id=$1", [taskId])).rows[0].status).toBe("open");
  });
  it("refuses reopened prerequisites and retains the skipped executor receipt", async () => {
    const id = await decision();
    await postgresPool().query("UPDATE work_orders SET status='in_progress',data_version=data_version+1 WHERE id='fixture-prior'");
    const result = await advanceWorkOrderStageForDecision("fixture-actor", id, { idempotency_key: "fixture-execute-reopened" });
    expect(result.attempt).toMatchObject({ status: "skipped", reason_code: "collaboration_dependencies_blocked", receipt: { blockers: ["prerequisite_not_completed"] } });
    expect((await advanceWorkOrderStageForDecision("fixture-actor", id, { idempotency_key: "fixture-execute-reopened" })).replayed).toBe(true);
    expect((await postgresPool().query("SELECT count(*)::int n FROM work_order_execution_attempts")).rows[0].n).toBe(1);
  });
  it("rejects stale queued versions even when a prerequisite is completed again", async () => {
    const id = await decision();
    await postgresPool().query("UPDATE work_orders SET data_version=data_version+1 WHERE id='fixture-prior'");
    const result = await advanceWorkOrderStageForDecision("fixture-actor", id, { idempotency_key: "fixture-execute-stale" });
    expect(result.attempt.reason_code).toBe("collaboration_dependency_version_conflict");
  });
  it("rejects withdrawn, rejected and resubmitted rounds without reusing old approval", async () => {
    const original = (await gate()).version;
    for (const status of ["withdrawn", "rejected", "reviewing"]) {
      await postgresPool().query("UPDATE review_instances SET status=$1,version=version+1,payload=$2 WHERE id='fixture-instance'", [status, payload(status, 2)]);
      const current = await gate();
      expect(current.allowed).toBe(false); expect(current.blockers).toContain("review_not_approved"); expect(current.version).not.toBe(original);
    }
  });
  it("hides another cooperation's approval and events, and rechecks brand revocation", async () => {
    await postgresPool().query("UPDATE review_instances SET payload=$1,version=version+1 WHERE id='fixture-instance'", [payload("approved", 1, { ...values, col: "another-brand-same-kol" })]);
    let context = await readTaskCollaborationContext("fixture-actor", taskId);
    expect(context.gates.find(g => g.work_order_id === "fixture-next")?.review).toBeNull();
    expect(context.events.some(e => e.source_type === "review")).toBe(false);
    await postgresPool().query("UPDATE users SET brands='[]' WHERE id='fixture-actor'");
    expect((await gate()).blockers).toContain("collaboration_not_available");
    await expect(readTaskCollaborationContext("fixture-actor", taskId)).rejects.toMatchObject({ status: 404 });
  });
  it("revokes review visibility when company membership or participation ends", async () => {
    await postgresPool().query("UPDATE organization_memberships SET status='ended' WHERE id='fixture-member'");
    expect((await gate()).review).toBeNull();
    expect((await gate()).blockers).toContain("review_not_available");
  });
  it("persists actual before/after and actor in the same review transaction, with rollback", async () => {
    const db = postgresPool();
    await expect(postgresTransaction(async client => {
      await client.query("UPDATE review_instances SET status='withdrawn',version=2,payload=$1 WHERE id='fixture-instance'", [payload("withdrawn")]);
      throw new Error("fixture rollback");
    })).rejects.toThrow("fixture rollback");
    expect((await db.query("SELECT count(*)::int n FROM collaboration_source_events WHERE source_type='review'")).rows[0].n).toBe(1);
    await postgresTransaction(async client => {
      await client.query("UPDATE review_instances SET status='withdrawn',version=2,payload=$1 WHERE id='fixture-instance'", [payload("withdrawn")]);
      await client.query(`INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at) VALUES ('withdraw-event','fixture-company','fixture-instance','fixture-actor','withdraw',2,'{}',$1)`, [new Date().toISOString()]);
    });
    const changed = (await db.query("SELECT * FROM collaboration_source_events WHERE source_type='review' ORDER BY sequence DESC LIMIT 1")).rows[0];
    expect(changed).toMatchObject({ actor_id: "fixture-actor", event_type: "review.withdraw", before_state: { status: "approved", version: 1 }, after_state: { status: "withdrawn", version: 2 } });
    const first = await readTaskCollaborationContext("fixture-actor", taskId);
    expect((await readTaskCollaborationContext("fixture-actor", taskId, first.cursor)).events).toEqual([]);
  });
  it("does not infer dependencies for undeclared templates or bypass active identity", async () => {
    const read = await readTaskCollaborationContext("fixture-actor", taskId);
    expect(read.gates.find(g => g.work_order_id === "fixture-prior")).toMatchObject({ configured: false, allowed: false });
    await postgresPool().query("UPDATE ticket_accounts SET active=false WHERE id='fixture-actor'");
    await expect(readTaskCollaborationContext("fixture-actor", taskId)).rejects.toMatchObject({ status: 404 });
  });
  it("keeps detail and dashboard in the same current brand scope including administrators", async () => {
    expect((await taskWorkOrderDashboard("fixture-actor", true)).summary.tasks.total).toBe(1);
    await postgresPool().query("UPDATE users SET brands='[]',roles='[\"admin\"]' WHERE id='fixture-actor'");
    await expect(taskWorkOrderAggregate("fixture-actor", taskId, true)).rejects.toMatchObject({ status: 404 });
    expect((await taskWorkOrderDashboard("fixture-actor", true)).summary.tasks.total).toBe(0);
  });
  it("rejects publication referencing an unpublished prerequisite", async () => {
    const invalid = { ...policy, prerequisites: [{ template_code: "missing_template", template_version: 1 }] };
    await postgresPool().query(`UPDATE work_order_templates SET status='draft',fill_policy_json=$1,automation_level='A0',acceptance_criteria_json='["fixture criterion"]'
      WHERE id='fixture-next-template'`, [JSON.stringify({ collaboration_dependencies: invalid })]);
    await expect(publishWorkOrderTemplate("fixture-actor", "fixture-next-template", { expected_version: 1, idempotency_key: "fixture-publish-invalid" }))
      .rejects.toMatchObject({ status: 422, detail: { code: "collaboration_prerequisite_not_published" } });
  });
  it("preserves immutable source events and rejects an unversioned authority overwrite", async () => {
    const db = postgresPool();
    await expect(db.query("UPDATE collaboration_source_events SET event_type='fixture-fake'")).rejects.toThrow("immutable");
    await expect(db.query("UPDATE work_orders SET status='in_progress' WHERE id='fixture-prior'")).rejects.toThrow("newer data_version");
    expect((await db.query("SELECT status FROM work_orders WHERE id='fixture-prior'")).rows[0].status).toBe("completed");
  });
  it("holds approval authority and permission rows stable until the execution transaction commits", async () => {
    const holder = await postgresPool().connect(), competitor = await postgresPool().connect();
    try {
      await holder.query("BEGIN");
      expect((await workOrderCollaborationGate(holder,"fixture-actor","fixture-next")).allowed).toBe(true);
      for (const sql of [
        "UPDATE organization_memberships SET status='ended' WHERE id='fixture-member'",
        "DELETE FROM review_participants WHERE instance_id='fixture-instance'",
        "INSERT INTO review_template_lifecycle(tenant,template_id,version,enabled) VALUES ('fixture-company','fixture-review',1,0)",
      ]) {
        await competitor.query("BEGIN");
        await competitor.query("SET LOCAL lock_timeout='150ms'");
        await expect(competitor.query(sql)).rejects.toMatchObject({ code: "55P03" });
        await competitor.query("ROLLBACK");
      }
      await holder.query("COMMIT");
      await competitor.query("UPDATE organization_memberships SET status='ended' WHERE id='fixture-member'");
      expect((await gate()).blockers).toContain("review_not_available");
    } finally {
      await holder.query("ROLLBACK"); await competitor.query("ROLLBACK"); holder.release(); competitor.release();
    }
  });
  it("rejects duplicate approval-field mappings and malformed published dependency rules", () => {
    expect(() => parseCollaborationPolicy({ collaboration_dependencies: { ...policy, action_id: "send_email" } })).toThrow();
    expect(() => parseCollaborationPolicy({ collaboration_dependencies: { ...policy, review: { ...policy.review, fields: { ...policy.review.fields, artifact_id: "col" } } } })).toThrow();
    expect(collaborationContentHash({ b: 2, a: 1 })).toBe(collaborationContentHash({ a: 1, b: 2 }));
  });
});
