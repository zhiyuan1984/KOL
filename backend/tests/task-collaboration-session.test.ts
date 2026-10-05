import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { freshTestDatabase } from "./support/pg.js";
import { postgresPool } from "../src/postgres/pool.js";
import { createTaskRootPostgres } from "../src/ticket-domain/task-work-orders.js";
import { syncWorkbenchTicketPrincipal } from "../src/ticket-domain/auth.js";
import { openTaskCollaborationSession, authorizedTaskSession, taskSessionHarnessEvidence, listTaskCollaborationSessions } from "../src/ticket-domain/task-collaboration-session.js";
import { resetConn } from "../src/db.js";
import { enterprise } from "../src/routers/enterprise.js";
import { withScopedUser, type AppUser } from "../src/auth.js";
import { host } from "../src/host/api.js";
import { HttpFail } from "../src/host/errors.js";

let taskId: string;
const actor: AppUser = {id:"workspace-owner",username:"workspace-owner",name:"Workspace Owner",handle:"fixture",roles:["employee"],role:"employee",
  brands:["fixture-brand"],site:"",manager_user_id:null,active:true,exam_passed:true,exam_todo_count:0,exam_module:"fixture"};
beforeEach(async()=>{
  await freshTestDatabase();
  resetConn();
  await syncWorkbenchTicketPrincipal({...actor});
  await syncWorkbenchTicketPrincipal({...actor,id:"workspace-other",username:"workspace-other"});
  const db=postgresPool();
  await db.query(`INSERT INTO users(id,username,name,password_hash,brands,roles,created_at,updated_at) VALUES ($1,$1,'Fixture','isolated','["fixture-brand"]','["employee"]',now(),now())`,[actor.id]);
  taskId=(await createTaskRootPostgres(actor.id,{title:"Original formal task",goal:"Explain current blockers",idempotency_key:"workspace-native-task"})).task_id;
  await db.query(`INSERT INTO work_order_templates(id,template_code,version,title,status,automation_level,created_by) VALUES ('workspace-template','workspace-template',1,'Fixture','published','A1',$1)`,[actor.id]);
  await db.query(`INSERT INTO work_orders(id,task_id,template_id,template_code,template_version,status,title,automation_level,created_by)
    VALUES ('workspace-order',$1,'workspace-template','workspace-template',1,'proposed','Original work order','A1',$2)`,[taskId,actor.id]);
});

describe("native Task workspace and fixed harness evidence",()=>{
  it("retries concurrent principal refreshes without duplicate claims events or retaining revoked identity",async()=>{
    const updated = { ...actor, name: "Concurrent updated owner" };
    await Promise.all(Array.from({length:8},()=>syncWorkbenchTicketPrincipal(updated)));
    const db=postgresPool();
    expect((await db.query("SELECT count(*)::int AS n FROM workbench_principal_binding_events WHERE principal_id=$1 AND event_type='claims_refreshed'",[actor.id])).rows[0].n).toBe(1);
    await Promise.all(Array.from({length:8},()=>syncWorkbenchTicketPrincipal({...updated,active:false})));
    expect((await db.query("SELECT active FROM ticket_accounts WHERE id=$1",[actor.id])).rows[0].active).toBe(false);
    await expect(openTaskCollaborationSession(actor.id,taskId)).rejects.toBeInstanceOf(HttpFail);
    expect((await db.query("SELECT count(*)::int AS n FROM workbench_principal_binding_events WHERE principal_id=$1 AND event_type='deactivated'",[actor.id])).rows[0].n).toBe(1);
  });
  it("concurrent opens recover one session and the original task without starting a model",async()=>{
    const opened=await Promise.all(Array.from({length:4},()=>openTaskCollaborationSession(actor.id,taskId)));
    expect(new Set(opened.map(item=>item.id)).size).toBe(1);
    expect(opened.filter(item=>!item.replayed)).toHaveLength(1);
    expect(opened.every(item=>item.task_id===taskId && item.calls_model===false)).toBe(true);
    const db=postgresPool();
    expect((await db.query("SELECT count(*)::int n FROM tickets WHERE profile='task-root'")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int n FROM workers")).rows[0].n).toBe(0);
    expect(await authorizedTaskSession(actor.id,opened[0].id)).toMatchObject({task_id:taskId});
    expect(await authorizedTaskSession(actor.id,"unrelated-session")).toBeNull();
  });
  it("provides authoritative ids, goal, blockers and stable versions; detects parent and order changes",async()=>{
    const session=await openTaskCollaborationSession(actor.id,taskId);
    const before=await taskSessionHarnessEvidence(actor.id,session.id);
    expect(before).toMatchObject({risk:"L1",calls_model:false,task:{id:taskId,goal:"Explain current blockers"},work_orders:[{id:"workspace-order",data_version:1}],gates:[{blockers:["dependency_rule_not_published"]}]});
    expect((await taskSessionHarnessEvidence(actor.id,session.id))!.version).toBe(before!.version);
    await postgresPool().query("UPDATE work_orders SET data_version=data_version+1 WHERE id='workspace-order'");
    const changed=await taskSessionHarnessEvidence(actor.id,session.id);
    expect(changed!.version).not.toBe(before!.version);
    await postgresPool().query("UPDATE tickets SET data_version=data_version+1,content='Changed goal' WHERE id=$1",[taskId]);
    expect((await taskSessionHarnessEvidence(actor.id,session.id))!.version).not.toBe(changed!.version);
  });
  it("does not reuse another employee's workspace and revokes evidence on ownership or brand change",async()=>{
    const session=await openTaskCollaborationSession(actor.id,taskId),db=postgresPool();
    await expect(authorizedTaskSession("workspace-other",session.id)).rejects.toMatchObject({status:404});
    await expect(openTaskCollaborationSession("workspace-other",taskId)).rejects.toMatchObject({status:404});
    await db.query(`INSERT INTO collaborations(id,handle,display_name,brand,email,mailbox_from,lifecycle_id,conversation_id,stage_code)
      VALUES ('workspace-col','fixture','Fixture','fixture-brand','','','','','OUTREACHING')`);
    await db.query("UPDATE tickets SET collaboration_id='workspace-col' WHERE id=$1",[taskId]);
    expect(await taskSessionHarnessEvidence(actor.id,session.id)).not.toBeNull();
    await db.query("UPDATE users SET brands='[]' WHERE id=$1",[actor.id]);
    await expect(authorizedTaskSession(actor.id,session.id)).rejects.toMatchObject({status:404});
    await expect(taskSessionHarnessEvidence(actor.id,session.id)).rejects.toMatchObject({status:404});
    await db.query("UPDATE tickets SET owner_user_id='workspace-other' WHERE id=$1",[taskId]);
    await expect(openTaskCollaborationSession(actor.id,taskId)).rejects.toMatchObject({status:404});
  });
  it("retains explicit recovery instead of recreating an archived or disabled workspace",async()=>{
    const session=await openTaskCollaborationSession(actor.id,taskId);
    await postgresPool().query("UPDATE sessions SET archived_at=$2 WHERE id=$1",[session.id,new Date().toISOString()]);
    await expect(openTaskCollaborationSession(actor.id,taskId)).rejects.toMatchObject({status:409});
    await expect(authorizedTaskSession(actor.id,session.id)).rejects.toMatchObject({status:404});
    expect((await postgresPool().query("SELECT count(*)::int n FROM task_collaboration_sessions")).rows[0].n).toBe(1);
  });
  it("protects existing session reads and message writes after native Task scope is revoked",async()=>{
    const session=await openTaskCollaborationSession(actor.id,taskId), app=new Hono();
    app.onError((error,c)=>error instanceof HttpFail?c.json({detail:error.detail},error.status as 404):c.json({detail:"unexpected"},500));
    app.route("/",host);
    await postgresPool().query("UPDATE tickets SET owner_user_id='workspace-other' WHERE id=$1",[taskId]);
    for (const [path,method] of [[`/sessions/${session.id}`,"GET"],[`/sessions/${session.id}/messages`,"POST"],[`/sessions/${session.id}/events`,"GET"]]) {
      const response=await withScopedUser(actor,()=>app.request(path,{method,headers:{"Content-Type":"application/json"},body:method==="POST"?JSON.stringify({text:"do not run",intent:"kol_analyze"}):undefined}));
      expect(response.status).toBe(404);
    }
    expect((await postgresPool().query("SELECT count(*)::int n FROM messages WHERE session_id=$1",[session.id])).rows[0].n).toBe(0);
  });
  it("does not widen Task authority through sidebar, exports or a share token",async()=>{
    const session=await openTaskCollaborationSession(actor.id,taskId),app=new Hono();
    app.onError((error,c)=>error instanceof HttpFail?c.json({detail:error.detail},error.status as 404):c.json({detail:"unexpected"},500));
    app.route("/",enterprise);app.route("/",host);
    expect(await listTaskCollaborationSessions(actor.id,false)).toHaveLength(1);
    const shared=await withScopedUser(actor,()=>app.request(`/sessions/${session.id}/share`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}));
    expect(shared.status).toBe(201);
    const token=(await shared.json()).token;
    await postgresPool().query("UPDATE tickets SET owner_user_id='workspace-other' WHERE id=$1",[taskId]);
    expect(await listTaskCollaborationSessions(actor.id,true)).toHaveLength(0);
    for(const url of [`/sessions/${session.id}/export`,`/shared/${token}`]) {
      expect((await withScopedUser(actor,()=>app.request(url))).status).toBe(404);
    }
  });
  it("rejects other skills and formal session actions; explicit unarchive recovers the same workspace",async()=>{
    const session=await openTaskCollaborationSession(actor.id,taskId),app=new Hono();
    app.onError((error,c)=>error instanceof HttpFail?c.json({detail:error.detail},error.status as 404):c.json({detail:"unexpected"},500));
    app.route("/",enterprise);app.route("/",host);
    for(const suffix of ["confirm-stage","compose-preview","messages"]) {
      const response=await withScopedUser(actor,()=>app.request(`/sessions/${session.id}/${suffix}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({intent:"email_compose",text:"do not send"})}));
      expect(response.status).toBe(409);
    }
    expect((await postgresPool().query("SELECT count(*)::int n FROM messages WHERE session_id=$1",[session.id])).rows[0].n).toBe(0);
    await postgresPool().query("UPDATE sessions SET archived_at=$2 WHERE id=$1",[session.id,new Date().toISOString()]);
    const restored=await withScopedUser(actor,()=>app.request(`/sessions/${session.id}/unarchive`,{method:"POST"}));
    expect(restored.status).toBe(200);
    expect(await openTaskCollaborationSession(actor.id,taskId)).toMatchObject({id:session.id,replayed:true});
  });
});
