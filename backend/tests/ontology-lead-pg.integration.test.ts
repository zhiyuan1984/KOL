import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { syncWorkbenchTicketPrincipal } from "../src/ticket-domain/auth.js";
import { createTaskRootPostgres } from "../src/ticket-domain/task-work-orders.js";
import { recordVerifiedWorkOrderEvent } from "../src/ticket-domain/work-order-verified-event.js";
import { kolLeadEvents, kolLeadAutomationStatus, updateKolLead } from "../src/ticket-domain/kol-leads.js";

const configured = Boolean(process.env.TEST_DATABASE_URL);
const suite = configured ? describe : describe.skip;
suite("ontology lead native PostgreSQL integration", () => {
  let actorId: string;
  let taskId: string;
  beforeEach(async () => {
    await closePostgresPool();
    await freshTestDatabase();
    const actor = await syncWorkbenchTicketPrincipal({ id: "ontology-owner", username: "ontology-owner", name: "Ontology Owner", roles: ["employee"], active: true });
    actorId = actor.id;
    const task = await createTaskRootPostgres(actor.id, { title: "隔离测试线索目标", idempotency_key: "ontology-task-0001" });
    taskId = task.task_id;
    await postgresPool().query(`INSERT INTO kol_leads (id,platform,account_handle,display_name,source,owner_principal_id,followup_task_id)
      VALUES ('ontology-lead-1','youtube','ontology-test','隔离测试线索','manual',$1,$2)`, [actorId, taskId]);
  });
  afterAll(async () => { await closePostgresPool(); });

  it("mirrors a verified lead event atomically with real object identity and deduplicates replay/timeline", async () => {
    const input = { event_type: "lead.reply_received", source_system: "fixture-verifier", source_event_id: "source-reply-1", source_version: "v1",
      occurred_at: new Date().toISOString(), summary: "隔离测试回复证据", evidence_ref: "fixture:reply:1", evidence: { message_id: "fixture-message-1" },
      payload: { lead_id: "ontology-lead-1", task_id: "untrusted-task", verified_event_id: "untrusted-id" }, idempotency_key: "ontology-event-0001" };
    const first = await recordVerifiedWorkOrderEvent(actorId, taskId, input);
    const replay = await recordVerifiedWorkOrderEvent(actorId, taskId, input);
    expect(replay.event.id).toBe(first.event.id);
    expect(replay.event.replayed).toBe(true);
    const rows = await postgresPool().query("SELECT object_type,object_id,payload::jsonb AS payload,actor_id FROM business_events WHERE idempotency_key=$1", ["woe-be:ontology-event-0001"]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ object_type: "creator_candidate", object_id: "ontology-lead-1", actor_id: actorId,
      payload: { task_id: taskId, verified_event_id: first.event.id } });
    const timeline = await kolLeadEvents(actorId, false, "ontology-lead-1");
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]).toMatchObject({ event_type: "lead.reply_received", verified: true });
    await expect(kolLeadEvents("other-employee", false, "ontology-lead-1")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a forged business-object identity and rolls back the verified event", async () => {
    await expect(recordVerifiedWorkOrderEvent(actorId, taskId, { event_type: "lead.reply_received", source_system: "fixture-verifier", source_event_id: "forged-1",
      occurred_at: new Date().toISOString(), summary: "隔离测试伪造对象", evidence_ref: "fixture:forged:1", evidence: { message_id: "fixture-message-1" },
      payload: { lead_id: "another-lead" }, idempotency_key: "ontology-forged-0001" })).rejects.toMatchObject({ status: 422 });
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM work_order_verified_events")).rows[0].n).toBe(0);
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM business_events")).rows[0].n).toBe(0);
  });

  it("falls back to an honest task association when no typed business identity exists", async () => {
    await recordVerifiedWorkOrderEvent(actorId, taskId, { event_type: "deadline.quote", source_system: "fixture-verifier", source_event_id: "deadline-1",
      occurred_at: new Date().toISOString(), summary: "隔离测试期限", evidence_ref: "fixture:deadline:1", evidence: { verified: true }, payload: {}, idempotency_key: "ontology-deadline-0001" });
    const row = (await postgresPool().query("SELECT object_type,object_id,payload::jsonb AS payload FROM business_events")).rows[0];
    expect(row).toMatchObject({ object_type: "follow_task", object_id: taskId, payload: { catalog_object_type: "quote" } });
  });

  it("records stage and archive in the same PG transaction with an auditable actor", async () => {
    await updateKolLead(actorId, false, "ontology-lead-1", { lead_stage: "contacting", confirmed: true, expected_version: 1 });
    await updateKolLead(actorId, false, "ontology-lead-1", { is_archived: true, archived_reason: "隔离测试归档", confirmed: true, expected_version: 2 });
    const rows = await postgresPool().query("SELECT event_type,actor_id,payload::jsonb AS payload FROM business_events ORDER BY created_at");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ event_type: "lead.stage_changed", actor_id: actorId, payload: { from_stage: "pending_contact", to_stage: "contacting" } });
    expect(rows.rows[1]).toMatchObject({ event_type: "lead.archived", actor_id: actorId, payload: { archived_reason: "隔离测试归档" } });
    const timeline = await kolLeadEvents(actorId, false, "ontology-lead-1");
    expect(timeline.events).toHaveLength(2);
  });

  it("rejects unconfirmed or stale mutations without writing an event", async () => {
    await expect(updateKolLead(actorId, false, "ontology-lead-1", { lead_stage: "contacting" })).rejects.toMatchObject({ status: 422 });
    await expect(updateKolLead(actorId, false, "ontology-lead-1", { lead_stage: "contacting", confirmed: true, expected_version: 9 })).rejects.toMatchObject({ status: 409 });
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM business_events")).rows[0].n).toBe(0);
  });

  it("reads published lead-created automation without claiming a draft is enabled", async () => {
    expect(await kolLeadAutomationStatus()).toEqual({ configured: false, template: null });
    await postgresPool().query(`INSERT INTO work_order_templates (id,template_code,version,title,status,automation_level,trigger_event_types,created_by)
      VALUES ('ontology-first-contact','kol_first_contact',1,'隔离建联模板','draft','A1','["lead.created"]',$1)`, [actorId]);
    expect((await kolLeadAutomationStatus()).configured).toBe(false);
    await postgresPool().query("UPDATE work_order_templates SET status='published' WHERE id='ontology-first-contact'");
    expect(await kolLeadAutomationStatus()).toMatchObject({ configured: true, template: { code: "kol_first_contact", status: "published" } });
  });
});
