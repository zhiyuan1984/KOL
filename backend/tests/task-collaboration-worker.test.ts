import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { getConn, resetConn } from "../src/db.js";
import type { Row } from "../src/types.js";
import { seedAll as seed } from "../src/seed.js";
import { seedPublishedAgent, seedRuntimeTestActor } from "./fixtures/runtime-auth.js";
import { withScopedUser, mapUser } from "../src/auth.js";
import { syncWorkbenchTicketPrincipal } from "../src/ticket-domain/auth.js";
import { createTaskRootPostgres } from "../src/ticket-domain/task-work-orders.js";
import { openTaskCollaborationSession } from "../src/ticket-domain/task-collaboration-session.js";
import { postgresPool } from "../src/postgres/pool.js";
import { runWorker } from "../src/worker/runner.js";

let taskId: string, sessionId: string, tmp: string;
const saved: Record<string,string|undefined> = {};
beforeEach(async()=>{
  for (const key of ["CODEX_MODE","AUTH_MODE","CODEX_BIN","LINGONG_DATA","FAKE_CODEX_MODE","FAKE_CODEX_DELAY","FAKE_CODEX_THREAD_START"]) saved[key]=process.env[key];
  await freshTestDatabase();
  resetConn();
  tmp=fs.mkdtempSync(path.join(os.tmpdir(),"tcw-p3-harness-"));
  process.env.LINGONG_DATA=tmp;
  process.env.AUTH_MODE="enabled"; process.env.CODEX_MODE="real";
  process.env.CODEX_BIN=path.resolve("tests/fixtures/fake-codex.mjs");
  process.env.FAKE_CODEX_MODE="task-collaboration-evidence";process.env.FAKE_CODEX_DELAY="500";
  process.env.FAKE_CODEX_THREAD_START=path.join(tmp,"thread.json");
  seed(); seedPublishedAgent("agent:kol"); seedRuntimeTestActor(["kol_analyze"],true);
  const user=mapUser(getConn().prepare("SELECT * FROM users WHERE id='usr_runtime_fixture'").get() as Row);
  await syncWorkbenchTicketPrincipal(user);
  taskId=(await createTaskRootPostgres(user.id,{title:"Native dependency analysis",goal:"Explain actual blockers",idempotency_key:"worker-task-create"})).task_id;
  sessionId=(await openTaskCollaborationSession(user.id,taskId)).id;
});
afterEach(()=>{for(const [key,value] of Object.entries(saved)) {if(value===undefined) delete process.env[key];else process.env[key]=value;} });
function execute() {
  const user=mapUser(getConn().prepare("SELECT * FROM users WHERE id='usr_runtime_fixture'").get() as Row);
  return withScopedUser(user,()=>Promise.resolve(runWorker(sessionId,"kol_analyze","Explain the bound task")));
}
describe("fixed native Task evidence in the existing app-server protocol",()=>{
  it("passes actual Task evidence to one turn with no mounted tools or formal task writes",async()=>{
    const result=await execute();
    expect(result.status).toBe("done");
    expect(result.items[0]).toMatchObject({task_context_id:taskId,task_context_stale:false});
    expect(result.items[0].summary).toContain(taskId);
    expect(result.items[0].summary).toContain(result.items[0].task_context_version);
    const thread=JSON.parse(fs.readFileSync(path.join(tmp,"thread.json"),"utf8"));
    expect(thread.config.mcp_servers).toEqual({});
    expect(result.contract_log).toContainEqual({method:"task/context",params:{task_id:taskId,version:result.items[0].task_context_version,risk:"L1",mounted_tools:0}});
    expect((await postgresPool().query("SELECT status FROM tickets WHERE id=$1",[taskId])).rows[0].status).toBe("open");
  });
  it("marks changed source basis as stale and suppresses a result after Task revocation",async()=>{
    const run=execute();
    // The protocol fixture writes this only after thread/start: evidence was
    // already captured, and the delayed turn has not completed yet.
    for(let i=0;i<100&&!fs.existsSync(path.join(tmp,"thread.json"));i++) await new Promise(resolve=>setTimeout(resolve,20));
    expect(fs.existsSync(path.join(tmp,"thread.json"))).toBe(true);
    await postgresPool().query("UPDATE tickets SET data_version=data_version+1 WHERE id=$1",[taskId]);
    expect((await run).items[0].task_context_stale).toBe(true);
    fs.unlinkSync(path.join(tmp,"thread.json"));
    const revoked=execute();
    for(let i=0;i<100&&!fs.existsSync(path.join(tmp,"thread.json"));i++) await new Promise(resolve=>setTimeout(resolve,20));
    await postgresPool().query("UPDATE ticket_accounts SET active=false WHERE id='usr_runtime_fixture'");
    await expect(revoked).rejects.toThrow("任务访问权限已变化");
  });
});
