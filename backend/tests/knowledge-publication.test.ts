import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach,afterEach,describe,it,expect } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { getConn,resetConn,txImmediate } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { ensureDemoAdmin,tokenDigest } from "../src/auth.js";
import { ensureOrganizationTree } from "../src/runtime/organization-tree.js";
import { reviewContextForActor } from "../src/approval/review-access.js";
import { ReviewService } from "../src/approval/review-service.js";
import { knowledgeReviewDefinition, type ReviewCommand } from "../../shared/review.js";
import { validateDefinition } from "../src/approval/review-engine.js";
import { uploadDocument,getDocumentDetail,startDocument,publishDocument,queryDocuments,deleteDocument } from "../src/host/knowledge-documents.js";
import { publicationState,bindPublication,preparePublication,checkPublication,guardKnowledgeReview,createDocumentRevision,
  replaceDraftDocument,knowledgeReviewMaterial,knowledgeReviewTrial,publicationSnapshot,retryPublication,publishApprovedDocument } from "../src/knowledge/publication.js";
import { postgresQuery } from "../src/postgres/pool.js";
import { processExecutionJobById } from "../src/execution-jobs/dispatcher.js";

let tmp:string;
const ctx=(actor="sriphy")=>reviewContextForActor(getConn(),actor,"company:amperetime");
const command=(actor:string,c:ReviewCommand,key=randomUUID())=>txImmediate(db=>{
  const s=new ReviewService(db,ctx(actor)),p=s.prepare(c);return s.execute(c,p.confirmationId,key);
});
function template(extraFields = [] as ReturnType<typeof knowledgeReviewDefinition>["fields"]){
  const d=knowledgeReviewDefinition();d.nodes.find(n=>n.type==="review")!.assignee={kind:"named",userIds:["knowledge-reviewer"]};
  d.fields.push(...extraFields);
  const t=txImmediate(db=>new ReviewService(db,ctx()).saveTemplate(undefined,undefined,d));
  command("sriphy",{action:"publish",templateId:t.id,expectedVersion:t.version});return t;
}
async function fixture(draft=false){
  const db=getConn(),time=new Date().toISOString(),base=`kb_${randomUUID()}`;
  db.prepare("INSERT INTO knowledge_bases(id,code,name,domain_id,kind,description,status,settings,version,created_at,updated_at) VALUES(?,?,?,'kdom_legacy','unstructured','','active','{}',1,?,?)").run(base,base,"规格库",time,time);
  const response=uploadDocument({name:"规格.pdf",type:"application/pdf",buf:Buffer.from("%PDF-1.4\nproduct specs\n%%EOF")},base,"sriphy",{draft});
  const doc=(response.document as Record<string,any>);
  if(!draft)await waitReady(doc.id);
  return {id:doc.id as string,base};
}
async function waitReady(id:string){
  const until=Date.now()+8000;
  while(Date.now()<until){const d=getDocumentDetail(id).document as Record<string,any>;if(d.status==="pending_review")return d;await new Promise(r=>setTimeout(r,20));}
  throw Error("pipeline timeout");
}
async function submitted(id:string,base:string){
  const t=template();await bindPublication(base,t.id,0,ctx());
  const p=await preparePublication(id,"发布产品规格资料",ctx());
  await guardKnowledgeReview(p.command,ctx());
  const key=randomUUID();
  const receipt=txImmediate(db=>new ReviewService(db,ctx()).execute(p.command,p.confirmationId,key));
  return {p,key,instance:String(receipt.resourceId)};
}
async function approve(instance:string){
  const s=new ReviewService(getConn(),ctx("knowledge-reviewer")),i=s.instance(instance);
  const c:ReviewCommand={action:"approve",instanceId:instance,expectedVersion:i.version,reason:"已核对原文"};
  await guardKnowledgeReview(c,ctx("knowledge-reviewer"));return command("knowledge-reviewer",c);
}
const execute=(instance:string)=>processExecutionJobById(`knowledge-publish:company:amperetime:${instance}`,"knowledge-test-worker");

beforeEach(async()=>{
  await freshTestDatabase();tmp=fs.mkdtempSync(path.join(os.tmpdir(),"kol-publication-"));
  process.env.LINGONG_DATA=tmp;process.env.CODEX_MODE="stub";process.env.AUTH_MODE="disabled";process.env.KNOWLEDGE_ENGINE_MODE="stub";
  resetConn();seedAll();ensureDemoAdmin();ensureOrganizationTree();
  const db=getConn(),time=new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("sriphy","publication-owner","资料管理员","unused",'["employee","admin"]','[]','',1,time,time);
  db.prepare("UPDATE organization_people SET user_id=? WHERE person_ref='person:yan_chen'").run("sriphy");
  db.prepare("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("knowledge-reviewer","knowledge-reviewer","资料审核人","unused",'["employee"]','[]','',1,time,time);
  db.prepare("UPDATE organization_people SET user_id=? WHERE person_ref='person:ye_guanwang'").run("knowledge-reviewer");
});
afterEach(()=>{resetConn();fs.rmSync(tmp,{recursive:true,force:true});delete process.env.KNOWLEDGE_ENGINE_MODE;});

describe("knowledge publication through real review instances and PostgreSQL outbox",()=>{
  it("preflight uses the real review policy without creating confirmations or applications",async()=>{
    const {id,base}=await fixture();const t=template();await bindPublication(base,t.id,0,ctx());
    const before=(await postgresQuery("SELECT count(*)::int AS n FROM review_confirmations"))[0].n;
    const good=await checkPublication(id,"发布产品规格",ctx());expect(good.allowed).toBe(true);
    expect(good.reviewers.length).toBeGreaterThan(0);
    expect((await postgresQuery("SELECT count(*)::int AS n FROM review_confirmations"))[0].n).toBe(before);
    expect((await postgresQuery("SELECT id FROM knowledge_publication_requests WHERE document_id=$1",[id])).length).toBe(0);
    expect((await checkPublication(id,"",ctx())).allowed).toBe(false);
  });

  it("checks immediate publication authority and approval at the HTTP boundary",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);
    const {createApp}=await import("../src/app.js"),app=createApp();
    for(const actor of ["sriphy","knowledge-reviewer"]){
      getConn().prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
        .run(tokenDigest(`publish-${actor}`),actor,new Date(Date.now()+60000).toISOString(),new Date().toISOString());
    }
    process.env.AUTH_MODE="enabled";
    const url=`/api/admin/knowledge/documents/${f.id}/publication-execute`;
    const send=(actor:string)=>app.request(url,{method:"POST",headers:{Cookie:`lingong_session=publish-${actor}`,"X-Review-Company":"company:amperetime"}});
    expect((await app.request(url,{method:"POST"})).status).toBe(401);
    expect((await send("knowledge-reviewer")).status).toBe(403);
    expect((await send("sriphy")).status).toBe(409);
    await approve(s.instance);
    expect((await send("sriphy")).status).toBe(200);
    expect((await send("sriphy")).status).toBe(200);
    const status=await app.request(`/api/admin/knowledge/documents/${f.id}/publication`,{headers:{Cookie:"lingong_session=publish-sriphy","X-Review-Company":"company:amperetime"}});
    expect(status.status).toBe(200);
    expect((await status.json()).publication_status).toBe("published");
  });
  it("publishes an approved version immediately without parsing again and deduplicates worker delivery",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);
    await expect(publishApprovedDocument(f.id,ctx())).rejects.toMatchObject({status:409});
    await approve(s.instance);
    expect((await publicationState(f.id,ctx())).allowed_actions).toContain("publish_approved");
    const jobs=getDocumentDetail(f.id).jobs;
    await expect(publishApprovedDocument(f.id,ctx("knowledge-reviewer"))).rejects.toMatchObject({status:403});
    const results=await Promise.allSettled([publishApprovedDocument(f.id,ctx()),execute(s.instance)]);
    expect(results.some(r=>r.status==="fulfilled")).toBe(true);
    const state=await publicationState(f.id,ctx());
    expect(state.publication_status).toBe("published");
    expect(state.receipt.document_id).toBe(f.id);
    expect(getDocumentDetail(f.id).jobs).toEqual(jobs);
    expect(await publishApprovedDocument(f.id,ctx())).toMatchObject({publication_status:"published",receipt:state.receipt});
    expect(await execute(s.instance)).toBeNull();
    expect((await knowledgeReviewMaterial(s.instance,ctx())).management_url).toContain(`/admin/knowledge?document=${f.id}`);
    expect((await knowledgeReviewMaterial(s.instance,ctx("knowledge-reviewer"))).management_url).toBeNull();
  });
  it("adds custom fields and preserves them through submission, approval and publication",async()=>{
    const f=await fixture(),t=template([{id:"model",label:"产品型号",type:"text",required:true}]);
    await bindPublication(f.base,t.id,0,ctx());
    const state=await publicationState(f.id,ctx());
    expect(state.fields.map((field:{id:string})=>field.id)).toEqual(["model"]);
    await expect(preparePublication(f.id,"发布规格",ctx())).rejects.toMatchObject({status:422});
    const p=await preparePublication(f.id,"发布规格",ctx(),{model:"LT-100",knowledge_request:"forged",publication_note:"forged"});
    expect(p.command.action).toBe("submit");
    if(p.command.action!=="submit")throw Error("submit expected");
    expect(p.command.values.model).toBe("LT-100");
    expect(p.command.values.knowledge_request).not.toBe("forged");
    expect(p.command.values.publication_note).toBe("发布规格");
    await guardKnowledgeReview(p.command,ctx());
    const receipt=txImmediate(db=>new ReviewService(db,ctx()).execute(p.command,p.confirmationId,randomUUID()));
    const instance=String(receipt.resourceId);
    expect(new ReviewService(getConn(),ctx()).instance(instance).values.model).toBe("LT-100");
    await approve(instance);await execute(instance);
    expect((await publicationState(f.id,ctx())).publication_status).toBe("published");
  });
  it("keeps draft/ready separate and explains missing flow without creating an instance",async()=>{
    const f=await fixture(true);expect((await publicationState(f.id,ctx())).processing_status).toBe("draft");
    await expect(queryDocuments({base_id:f.base,query:"产品"},"employee")).rejects.toMatchObject({detail:{message:expect.stringContaining("未解析草稿")}});
    expect(getDocumentDetail(f.id).jobs).toEqual([]);startDocument(f.id);await waitReady(f.id);
    const s=await publicationState(f.id,ctx());expect(s.review_status).toBe("not_submitted");expect(s.blocking_reason).toContain("尚未配置");
    await expect(queryDocuments({base_id:f.base,query:"产品"},"employee")).rejects.toMatchObject({detail:{message:expect.stringContaining("已解析并建立索引")}});
    await expect(preparePublication(f.id,"发布",ctx())).rejects.toMatchObject({status:409});
    expect((await postgresQuery("SELECT count(*)::int AS n FROM review_instances"))[0].n).toBe(0);
    expect(()=>publishDocument(f.id)).toThrow();
    await expect(postgresQuery("UPDATE knowledge_documents SET status='published' WHERE id=$1",[f.id])).rejects.toMatchObject({code:"23514"});
    await expect(postgresQuery(`INSERT INTO knowledge_documents(id,base_id,title,filename,media_type,mime,size_bytes,source_path,status,retry_count,created_by,created_at,updated_at)
      SELECT 'forged-published',base_id,title,filename,media_type,mime,size_bytes,source_path,'published',0,created_by,created_at,updated_at FROM knowledge_documents WHERE id=$1`,[f.id])).rejects.toMatchObject({code:"23514"});
  });
  it("submits exactly once, creates dispatch atomically on approval and publishes with a receipt",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);
    expect((await publicationState(f.id,ctx())).label).toBe("审批中");
    const replay=txImmediate(db=>new ReviewService(db,ctx()).execute(s.p.command,s.p.confirmationId,s.key));expect(replay.resourceId).toBe(s.instance);
    await expect(preparePublication(f.id,"再次提交",ctx())).rejects.toMatchObject({status:409});
    await approve(s.instance);expect((getDocumentDetail(f.id).document as any).status).toBe("pending_review");
    expect((await postgresQuery("SELECT count(*)::int AS n FROM execution_outbox WHERE aggregate_id=$1",[f.id]))[0].n).toBe(1);
    await postgresQuery("UPDATE execution_jobs SET status='uncertain',error_summary='lease_expired' WHERE id=$1",[`knowledge-publish:company:amperetime:${s.instance}`]);
    expect((await publicationState(f.id,ctx())).allowed_actions).toContain("retry_publication");
    await retryPublication(f.id,ctx());
    expect((await execute(s.instance))?.outcome).toBe("processed");
    const state=await publicationState(f.id,ctx());expect(state.publication_status).toBe("published");expect(state.receipt.document_id).toBe(f.id);
    expect(await execute(s.instance)).toBeNull();
  });
  it("rejects forged generic submissions, changed snapshots and cross-company bindings",async()=>{
    const f=await fixture(),t=template();await bindPublication(f.base,t.id,0,ctx());
    await expect(guardKnowledgeReview({action:"submit",templateId:t.id,templateVersion:1,title:"伪造",values:{knowledge_request:"fake",publication_note:"fake"}},ctx())).rejects.toMatchObject({status:422});
    const p=await preparePublication(f.id,"发布",ctx());
    getConn().prepare("UPDATE knowledge_documents SET title='修改后的资料' WHERE id=?").run(f.id);
    await expect(guardKnowledgeReview(p.command,ctx())).rejects.toMatchObject({detail:{code:"knowledge_material_changed"}});
    await expect(publicationState(f.id,{...ctx(),tenant:"other-company"})).rejects.toMatchObject({status:404});
    await expect(bindPublication(f.base,t.id,1,{...ctx(),tenant:"other-company"})).rejects.toMatchObject({status:403});
  });
  it("rejects confirmation after a binding changes and rolls back the new instance",async()=>{
    const f=await fixture(),t=template();await bindPublication(f.base,t.id,0,ctx());const p=await preparePublication(f.id,"发布",ctx());
    await bindPublication(f.base,t.id,1,ctx());
    expect(()=>txImmediate(db=>new ReviewService(db,ctx()).execute(p.command,p.confirmationId,randomUUID()))).toThrow();
    expect((await postgresQuery("SELECT count(*)::int AS n FROM review_instances"))[0].n).toBe(0);
  });
  it("freezes approved material, blocks tampered files and keeps the decision on retry",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);await approve(s.instance);
    await expect(postgresQuery("UPDATE knowledge_documents SET artifacts='{}' WHERE id=$1",[f.id])).rejects.toMatchObject({code:"23514"});
    const source=(await postgresQuery("SELECT source_path FROM knowledge_documents WHERE id=$1",[f.id]))[0].source_path;
    const file=path.isAbsolute(source)?source:path.join(tmp,source),bytes=fs.readFileSync(file);fs.appendFileSync(file,"tampered");
    expect((await execute(s.instance))?.outcome).toBe("failed");expect((await publicationState(f.id,ctx())).review_status).toBe("approved");
    expect((await publicationState(f.id,ctx())).publication_status).toBe("blocked");
    fs.writeFileSync(file,bytes);
    // High-risk failures remain uncertain until an explicit recovery command.
    await retryPublication(f.id,ctx());expect((await execute(s.instance))?.outcome).toBe("processed");
  });
  it("does not publish rejected or withdrawn requests and allows a new application",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);const i=new ReviewService(getConn(),ctx("knowledge-reviewer")).instance(s.instance);
    command("knowledge-reviewer",{action:"reject",instanceId:i.id,expectedVersion:i.version,reason:"请核实资料"});
    expect((await publicationState(f.id,ctx())).review_status).toBe("rejected");expect(await execute(s.instance)).toBeNull();
    const p=await preparePublication(f.id,"补充核实说明",ctx());const r=txImmediate(db=>new ReviewService(db,ctx()).execute(p.command,p.confirmationId,randomUUID()));
    const next=new ReviewService(getConn(),ctx()).instance(String(r.resourceId));command("sriphy",{action:"withdraw",instanceId:next.id,expectedVersion:next.version,reason:"更新资料"});
    expect((await publicationState(f.id,ctx())).review_status).toBe("withdrawn");
  });
  it("keeps the active version while a new draft is edited and replaces it only after approval",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);await approve(s.instance);await execute(s.instance);
    const revision=await createDocumentRevision(f.id,ctx());expect(revision.version).toBe(2);
    const draft=getDocumentDetail(revision.document_id).document as any;
    await replaceDraftDocument(draft.id,{name:"新版规格.pdf",bytes:Buffer.from("%PDF-1.4\nnew specs\n%%EOF")},draft.updated_at,ctx());
    expect((getDocumentDetail(f.id).document as any).status).toBe("published");
    startDocument(draft.id);await waitReady(draft.id);const p=await preparePublication(draft.id,"发布新版规格",ctx());
    const r=txImmediate(db=>new ReviewService(db,ctx()).execute(p.command,p.confirmationId,randomUUID()));
    await approve(String(r.resourceId));expect((await execute(String(r.resourceId)))?.outcome).toBe("processed");
    expect((getDocumentDetail(f.id).document as any).status).toBe("archived");expect((getDocumentDetail(draft.id).document as any).status).toBe("published");
  });
  it("requires human review and protects the system material field in workflow definitions",()=>{
    const d=knowledgeReviewDefinition();d.nodes=d.nodes.filter(n=>n.type!=="review");expect(validateDefinition(d).length).toBeGreaterThan(0);
    const missing=knowledgeReviewDefinition();missing.fields.shift();expect(validateDefinition(missing).length).toBeGreaterThan(0);
    expect(()=>validateDefinition({...knowledgeReviewDefinition(),fields:[null,null],nodes:[null]})).not.toThrow();
  });
  it("concurrent approved revisions retain exactly one active version and block stale replacement",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);await approve(s.instance);await execute(s.instance);
    const revisions=await Promise.all([createDocumentRevision(f.id,ctx()),createDocumentRevision(f.id,ctx())]);
    expect(revisions.map(r=>r.version).sort()).toEqual([2,3]);
    const instances:string[]=[];
    for(const revision of revisions){
      startDocument(revision.document_id);await waitReady(revision.document_id);
      const p=await preparePublication(revision.document_id,"发布新版本",ctx());
      const receipt=txImmediate(db=>new ReviewService(db,ctx()).execute(p.command,p.confirmationId,randomUUID()));
      const instance=String(receipt.resourceId);await approve(instance);instances.push(instance);
    }
    const results=await Promise.all(instances.map(execute));
    expect(results.map(r=>r?.outcome).sort()).toEqual(["failed","processed"]);
    const states=await Promise.all(revisions.map(r=>publicationState(r.document_id,ctx())));
    expect(states.map(s=>s.publication_status).sort()).toEqual(["blocked","published"]);
    expect(states.find(s=>s.publication_status==="blocked")?.error).toContain("生效版本已变化");
    expect((await postgresQuery("SELECT count(*)::int AS n FROM knowledge_documents WHERE base_id=$1 AND status='published'",[f.base]))[0].n).toBe(1);
    const draft=await createDocumentRevision(f.id,ctx());expect(deleteDocument(draft.document_id).deleted).toBe(true);
  });
  it("a cancelled confirmation leaves no review and does not prevent deleting unsubmitted material",async()=>{
    const f=await fixture(),t=template();await bindPublication(f.base,t.id,0,ctx());await preparePublication(f.id,"稍后提交",ctx());
    expect((await publicationState(f.id,ctx())).review_status).toBe("not_submitted");
    expect(deleteDocument(f.id).deleted).toBe(true);
    expect((await postgresQuery("SELECT count(*)::int AS n FROM knowledge_publication_requests"))[0].n).toBe(0);
  });
  it("reads actual engine pages when stored metadata is zero and refuses unfinished artifacts",async()=>{
    const f=await fixture(),doc=(await postgresQuery("SELECT * FROM knowledge_documents WHERE id=$1",[f.id]))[0];
    const library=path.join(tmp,"actual-pageindex"),engineId="pi-ready";
    fs.mkdirSync(path.join(library,"docs",engineId),{recursive:true});
    fs.writeFileSync(path.join(library,"docs",engineId,"pages.json"),JSON.stringify([{page:1},{page:2}]));
    fs.writeFileSync(path.join(library,"docs",engineId,"tree.json"),"{}");
    const envelope=path.join(library,`${engineId}.tree.json`);
    fs.writeFileSync(envelope,JSON.stringify({status:"completed",retrieval_ready:true}));
    doc.artifacts=JSON.stringify({index:{library,doc_id:engineId,pages:0}});process.env.KNOWLEDGE_ENGINE_MODE="real";
    expect(publicationSnapshot(doc).pages).toBe(2);
    fs.writeFileSync(envelope,JSON.stringify({status:"processing",retrieval_ready:false}));
    expect(()=>publicationSnapshot(doc)).toThrow("索引尚未达到可检索状态");
  });
  it("authorizes frozen PDF and single-document trial through HTTP and closes legacy mutation entries",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);
    const trial=await knowledgeReviewTrial(s.instance,"有什么产品",ctx("knowledge-reviewer"));
    expect((trial.citations as any[])[0]).toMatchObject({document_id:f.id,page:1});
    expect((trial.citations as any[])[0].source_url).toContain(`/instances/${s.instance}/knowledge/file`);
    const {createApp}=await import("../src/app.js"),app=createApp();
    for(const actor of ["sriphy","knowledge-reviewer"]){const token=`session-${actor}`;
      getConn().prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
        .run(tokenDigest(token),actor,new Date(Date.now()+60000).toISOString(),new Date().toISOString());}
    process.env.AUTH_MODE="enabled";
    const headers={Cookie:"lingong_session=session-knowledge-reviewer","X-Review-Company":"company:amperetime"};
    expect((await app.request(`/api/approvals/v2/instances/${s.instance}/knowledge/file`,{headers})).status).toBe(200);
    expect((await app.request(`/api/approvals/v2/instances/${s.instance}/knowledge/file`)).status).toBe(401);
    const response=await app.request(`/api/approvals/v2/instances/${s.instance}/knowledge/trial`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({query:"规格",doc_ids:["foreign"]})});
    expect(response.status).toBe(200);expect((await response.json()).citations[0].document_id).toBe(f.id);
    for(const action of ["reprocess","publish"])
      expect((await app.request(`/api/admin/knowledge/documents/${f.id}/${action}`,{method:"POST",headers:{...headers,Cookie:"lingong_session=session-sriphy"}})).status).toBe(409);
  });
  it("reviewers can read only their frozen version and publication stops when owner authority is revoked",async()=>{
    const f=await fixture(),s=await submitted(f.id,f.base);
    expect((await knowledgeReviewMaterial(s.instance,ctx("knowledge-reviewer"))).pages).toBe(1);
    await expect(knowledgeReviewMaterial(s.instance,{...ctx(),actor:"outsider"})).rejects.toMatchObject({status:404});
    await approve(s.instance);getConn().prepare("UPDATE users SET roles='[\"employee\"]' WHERE id='sriphy'").run();
    expect((await execute(s.instance))?.outcome).toBe("failed");
    expect((await publicationState(f.id,ctx())).publication_status).toBe("blocked");
  });
});
