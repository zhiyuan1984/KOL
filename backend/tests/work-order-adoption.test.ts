import { beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { postgresPool } from "../src/postgres/pool.js";
import { syncWorkbenchTicketPrincipal, withTicketPrincipal } from "../src/ticket-domain/auth.js";
import { tickets } from "../src/routers/tickets.js";
import { createTaskRootPostgres, taskWorkOrderAggregate } from "../src/ticket-domain/task-work-orders.js";
import { readWorkOrderSuggestions } from "../src/ticket-domain/work-order-adoption.js";
import { executeWorkOrderDecision } from "../src/ticket-domain/work-order-executor.js";

let taskId: string;
beforeEach(async () => {
  await freshTestDatabase();
  await syncWorkbenchTicketPrincipal({ id: "adopt-actor", username: "adopt-actor", name: "Adoption Owner", roles: ["employee"], active: true });
  await syncWorkbenchTicketPrincipal({ id: "other-actor", username: "other-actor", name: "Other Actor", roles: ["admin"], active: true });
  taskId = (await createTaskRootPostgres("adopt-actor", { title: "Isolated adoption task", idempotency_key: "adoption-fixture-task" })).task_id;
  const db = postgresPool();
  await db.query(`INSERT INTO work_order_templates(id,template_code,version,title,status,automation_level,created_by)
    VALUES ('adopt-template','adopt-template',1,'Fixture proposal','published','A1','adopt-actor')`);
  await db.query(`INSERT INTO work_order_automation_releases(template_id,automation_level,status,minimum_confidence,enabled_by,reason)
    VALUES ('adopt-template','A1','enabled',0.8,'adopt-actor','Isolated fixture')`);
  await event("adopt-event");
});
async function event(id: string) {
  await postgresPool().query(`INSERT INTO work_order_verified_events(id,task_id,source_system,source_event_id,source_version,event_type,occurred_at,summary,evidence_ref,evidence_json,verified_by,verified_at,idempotency_key)
    VALUES ($1,$2,'isolated-fixture',$1,'v1','quote_due',now(),'Actual verified fixture evidence','fixture:evidence','{}','adopt-actor',now(),$1)`, [id, taskId]);
}
async function decision(key: string, source = "adopt-event", outcome = "create") {
  return (await postgresPool().query(`INSERT INTO work_order_decisions(task_id,source_event_id,template_code,template_version,decision_mode,outcome,status,input_hash,input_json,confidence,actor_ref,idempotency_key)
    VALUES ($1,$2,'adopt-template',1,'shadow',$3,'recorded','fixture-hash',$4,0.95,'adopt-actor',$5) RETURNING id`,
    [taskId, source, outcome, JSON.stringify({ source_event: { id: source, summary: "Untrusted shadow text" } }), key])).rows[0].id;
}
async function proposal(id: string) { return (await readWorkOrderSuggestions("adopt-actor", taskId)).suggestions.find(item => item.decision_id === id)!; }
async function adopt(id: string, key: string, target?: string) {
  const basis = await proposal(id);
  return executeWorkOrderDecision("adopt-actor", id, { idempotency_key: key }, {
    confirmed: true, basis_version: basis.version, action: target ? "merge" : "create", target_id: target,
  });
}

describe("human adoption shares the native materialization boundary", () => {
  it("exposes read-only suggestions and routes an explicit employee command through the shared executor", async () => {
    const id = await decision("fixture-http-decision");
    const actor = await syncWorkbenchTicketPrincipal({id:"adopt-actor",username:"adopt-actor",name:"Adoption Owner",roles:["employee"],active:true});
    const read = await withTicketPrincipal(actor,()=>tickets.request(`/task-work-orders/${taskId}/suggestions`));
    expect(read.status).toBe(200);
    const data = await read.json();
    expect(data.calls_model).toBe(false);
    const request = () => tickets.request(`/task-work-orders/decisions/${id}/adopt`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":"http-adoption-confirm-key"},
      body:JSON.stringify({confirmed:true,basis_version:data.suggestions[0].version,action:"create",mode:"automatic"})});
    const result = await withTicketPrincipal(actor,request);
    expect(result.status).toBe(201);
    expect((await result.json()).attempt.execution_mode).toBe("human_adoption");
    const admin = await syncWorkbenchTicketPrincipal({id:"other-actor",username:"other-actor",name:"Other Actor",roles:["admin"],active:true});
    expect((await withTicketPrincipal(admin,request)).status).toBe(404);
  });
  it("keeps proposals non-formal, requires confirmation and uses verified evidence with a durable replay", async () => {
    const id = await decision("fixture-decision-1"), basis = await proposal(id);
    expect(basis.actions).toEqual(["create"]);
    expect((await postgresPool().query("SELECT count(*)::int n FROM work_orders")).rows[0].n).toBe(0);
    await expect(executeWorkOrderDecision("adopt-actor",id,{idempotency_key:"adoption-create-key"},{basis_version:basis.version,action:"create"})).rejects.toMatchObject({ status: 422 });
    const result = await adopt(id, "adoption-create-key");
    expect(result.attempt).toMatchObject({ status: "created", execution_mode: "human_adoption" });
    expect((await postgresPool().query("SELECT summary_json FROM work_order_basis_refs")).rows[0].summary_json.summary).toBe("Actual verified fixture evidence");
    const replay = await executeWorkOrderDecision("adopt-actor",id,{idempotency_key:"adoption-create-key"},{confirmed:true,basis_version:basis.version,action:"create"});
    expect(replay.replayed).toBe(true);
    expect(replay.work_order!.id).toBe(result.work_order!.id);
    expect((await postgresPool().query("SELECT status FROM tickets WHERE id=$1",[taskId])).rows[0].status).toBe("open");
  });
  it("deduplicates concurrent distinct decisions and automatic versus human execution for one source", async () => {
    const one = await decision("fixture-decision-1"), two = await decision("fixture-decision-2"), basis = await proposal(one);
    const results = await Promise.allSettled([
      executeWorkOrderDecision("adopt-actor",one,{idempotency_key:"adoption-human-key"},{confirmed:true,basis_version:basis.version,action:"create"}),
      executeWorkOrderDecision("adopt-actor",two,{idempotency_key:"adoption-worker-key"}),
    ]);
    expect(results.some(result => result.status === "fulfilled" && result.value.attempt.status === "created")).toBe(true);
    const db = postgresPool();
    expect((await db.query("SELECT count(*)::int n FROM work_orders")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int n FROM work_order_outbox")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int n FROM work_order_assignments")).rows[0].n).toBe(0);
  });
  it("offers existing work orders first and merges only evidence with one receipt and outbox event", async () => {
    const first = await adopt(await decision("fixture-first"), "adoption-first-key");
    await event("second-event");
    const id = await decision("fixture-second", "second-event", "merge_open_order"), basis = await proposal(id);
    expect(basis.actions).toEqual(["merge"]);
    expect(basis.candidates[0].id).toBe(first.work_order!.id);
    const result = await adopt(id,"adoption-merge-key",first.work_order!.id);
    expect(result.attempt).toMatchObject({ status: "merged", receipt: { effect: "evidence_merged", assignment_created: false } });
    expect(result.work_order).toMatchObject({ id: first.work_order!.id, status: "proposed", data_version: 2 });
    expect((await postgresPool().query("SELECT count(*)::int n FROM work_orders")).rows[0].n).toBe(1);
    expect((await postgresPool().query("SELECT count(*)::int n FROM work_order_basis_refs")).rows[0].n).toBe(2);
    expect((await postgresPool().query("SELECT count(*)::int n FROM work_order_stage_events")).rows[0].n).toBe(1);
    expect((await postgresPool().query("SELECT event_type FROM work_order_outbox ORDER BY created_at DESC")).rows[0].event_type).toBe("work_order.evidence_merged");
    expect((await taskWorkOrderAggregate("adopt-actor",taskId,false)).work_orders[0].latest_decision!.id).toBe(id);
  });
  it("rejects changed parent or merge versions, disabled rules and missing authoritative events", async () => {
    const id = await decision("fixture-decision-1"), basis = await proposal(id);
    await postgresPool().query("UPDATE tickets SET data_version=data_version+1 WHERE id=$1",[taskId]);
    await expect(executeWorkOrderDecision("adopt-actor",id,{idempotency_key:"adoption-stale-key"},{confirmed:true,basis_version:basis.version,action:"create"})).rejects.toMatchObject({ status:409 });
    await postgresPool().query("UPDATE work_order_automation_releases SET status='disabled' WHERE template_id='adopt-template'");
    expect((await proposal(id)).blockers).toContain("automation_release_disabled");
    const missing = await decision("fixture-missing-source","unknown-event");
    expect((await proposal(missing)).blockers).toContain("verified_event_missing");
    expect((await postgresPool().query("SELECT count(*)::int n FROM work_orders")).rows[0].n).toBe(0);
  });
  it("rechecks current ownership even on replay, prevents admin bypass and binds confirmation identity", async () => {
    const id = await decision("fixture-decision-1"), basis = await proposal(id);
    await adopt(id,"adoption-create-key");
    await expect(executeWorkOrderDecision("other-actor",id,{idempotency_key:"adoption-create-key"},{confirmed:true,basis_version:basis.version,action:"create"})).rejects.toMatchObject({ status:404 });
    await expect(executeWorkOrderDecision("adopt-actor",id,{idempotency_key:"adoption-create-key"},{confirmed:true,basis_version:basis.version,action:"merge"})).rejects.toMatchObject({ status:409 });
    await postgresPool().query("UPDATE ticket_accounts SET active=false WHERE id='adopt-actor'");
    await expect(readWorkOrderSuggestions("adopt-actor",taskId)).rejects.toMatchObject({ status:404 });
    await expect(executeWorkOrderDecision("adopt-actor",id,{idempotency_key:"adoption-create-key"},{confirmed:true,basis_version:basis.version,action:"create"})).rejects.toMatchObject({ status:404 });
  });
  it("serializes two human confirmations and a Worker into one A2 creation and assignment", async () => {
    const db = postgresPool();
    await db.query("UPDATE work_order_templates SET automation_level='A2',routing_policy_code='task_owner' WHERE id='adopt-template'");
    await db.query("UPDATE work_order_automation_releases SET automation_level='A2',routing_policy_code='task_owner' WHERE template_id='adopt-template'");
    const ids = [];
    for (let i=0;i<3;i++) ids.push((await db.query(`INSERT INTO work_order_decisions(task_id,source_event_id,template_code,template_version,routing_policy_code,decision_mode,outcome,status,input_hash,input_json,confidence,actor_ref,idempotency_key)
      VALUES ($1,'adopt-event','adopt-template',1,'task_owner','shadow','create','recorded','fixture','{}',0.95,'adopt-actor',$2) RETURNING id`,[taskId,`concurrent-decision-${i}`])).rows[0].id);
    const bases = await readWorkOrderSuggestions("adopt-actor",taskId);
    const results = await Promise.allSettled(ids.map((id,index) => executeWorkOrderDecision("adopt-actor",id,{idempotency_key:`concurrent-adoption-${index}`},index<2
      ? {confirmed:true,basis_version:bases.suggestions.find(item=>item.decision_id===id)!.version,action:"create"} : undefined)));
    expect(results.filter(result=>result.status==="fulfilled" && result.value.attempt.status==="created")).toHaveLength(1);
    expect((await db.query("SELECT count(*)::int n FROM work_orders")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int n FROM work_order_assignments WHERE status='active'")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int n FROM work_order_outbox")).rows[0].n).toBe(1);
  });
  it("requires a fresh confirmation after merge target changes and clears suggestions on brand revocation", async () => {
    const first = await adopt(await decision("fixture-first"),"adoption-first-key");
    await event("second-event");
    const id = await decision("fixture-second","second-event","merge_open_order"), basis = await proposal(id), db = postgresPool();
    await db.query("UPDATE work_orders SET data_version=data_version+1 WHERE id=$1",[first.work_order!.id]);
    await expect(executeWorkOrderDecision("adopt-actor",id,{idempotency_key:"adoption-stale-merge"},{confirmed:true,basis_version:basis.version,action:"merge",target_id:first.work_order!.id})).rejects.toMatchObject({status:409});
    await db.query(`INSERT INTO users(id,username,name,password_hash,brands,created_at,updated_at) VALUES ('adopt-actor','adopt-actor','Fixture','isolated','["adopt-brand"]',now(),now())`);
    await db.query(`INSERT INTO collaborations(id,handle,display_name,brand,email,mailbox_from,lifecycle_id,conversation_id,stage_code) VALUES ('adopt-col','fixture','Fixture','adopt-brand','','','','','OUTREACHING')`);
    await db.query("UPDATE tickets SET collaboration_id='adopt-col',data_version=data_version+1 WHERE id=$1",[taskId]);
    const current = await proposal(id);
    await db.query("UPDATE users SET brands='[]' WHERE id='adopt-actor'");
    await expect(readWorkOrderSuggestions("adopt-actor",taskId)).rejects.toMatchObject({status:404});
    await expect(executeWorkOrderDecision("adopt-actor",id,{idempotency_key:"adoption-revoked-merge"},{confirmed:true,basis_version:current.version,action:"merge",target_id:first.work_order!.id})).rejects.toMatchObject({status:404});
    expect((await db.query("SELECT count(*)::int n FROM work_order_basis_refs")).rows[0].n).toBe(1);
  });
});
