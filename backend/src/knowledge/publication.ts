import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireAdmin, scopedUser } from "../auth.js";
import { dataDir } from "../config.js";
import { getConn } from "../db.js";
import { reviewContextForActor } from "../approval/review-access.js";
import { ReviewService, type ReviewContext } from "../approval/review-service.js";
import { reviewIntake } from "../approval/review-rollout.js";
import { postgresPool, postgresQuery, postgresTransaction } from "../postgres/pool.js";
import { HttpFail } from "../host/errors.js";
import { registerExecutionHandler } from "../execution-jobs/handlers.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import type { ReviewCommand } from "../../../shared/review.js";
import { ensureOrganizationTree } from "../runtime/organization-tree.js";
import { queryDocuments } from "../host/knowledge-documents.js";

type Row = Record<string, any>;
const fail = (code: string, message: string, status = 409): never => { throw new HttpFail(status, { code, message }); };
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const decode = (value: unknown): Row => typeof value === "string" ? JSON.parse(value) : (value || {}) as Row;
const stamp = () => new Date().toISOString();
const publicationAudit=(client:PoolClient,actor:string,event:string,payload:Row)=>
  client.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)",[stamp(),actor,event,JSON.stringify(payload)]);

/** Reuse the existing authority for organization/roles, never invent reviewers. */
export function publicationContext(company?: string): ReviewContext {
  const user = scopedUser();
  if (!user) fail("authentication_required", "请登录", 401);
  ensureOrganizationTree();
  return reviewContextForActor(getConn(), user!.id, company);
}
async function document(id: string, tenant: string, client?: PoolClient) {
  const rows = await (client || postgresPool()).query(
    `SELECT d.*,b.status AS base_status,b.name AS base_name,k.tenant AS bound_tenant,
      l.root_id,l.version AS document_version,l.expected_active_id,
      (SELECT jsonb_build_object('revision',s.revision,'explanation',s.explanation,'state',s.state,'scope',s.scope,'fingerprint',s.fingerprint) FROM knowledge_document_scopes s WHERE s.document_id=d.id) AS knowledge_scope
      FROM knowledge_documents d JOIN knowledge_bases b ON b.id=d.base_id
      LEFT JOIN knowledge_publication_bindings k ON k.base_id=d.base_id
      LEFT JOIN knowledge_document_lineage l ON l.document_id=d.id WHERE d.id=$1`, [id]);
  const row = rows.rows[0];
  if (!row || (row.bound_tenant && row.bound_tenant !== tenant)) fail("knowledge_document_unavailable", "资料不存在或不在当前组织范围", 404);
  return row;
}

/** Verify actual files; a completed job or zero-valued metadata is not enough. */
export function publicationSnapshot(doc: Row) {
  if(doc.knowledge_scope && !['checked','published'].includes(doc.knowledge_scope.state)) fail('knowledge_scope_not_checked','请先核对文档知识范围再提交审批');
  const artifacts = decode(doc.artifacts), index = artifacts.index;
  if (!index?.doc_id || !/^[\w-]+$/.test(index.doc_id)) fail("knowledge_not_indexed", "资料尚未完成索引");
  const resolve = (p: string) => path.isAbsolute(p) ? p : path.join(dataDir(), p);
  const source = resolve(doc.source_path), library = resolve(index.library);
  const files: { path: string; hash: string }[] = [];
  const read = (file: string) => {
    if (!fs.existsSync(file)) fail("knowledge_artifact_missing", "原件或索引产物缺失，请创建新版本重新解析");
    const bytes = fs.readFileSync(file); files.push({ path: file, hash: digest(bytes) }); return bytes;
  };
  read(source);
  if (artifacts.normalize?.normalized_path) read(resolve(artifacts.normalize.normalized_path));
  let pages = 0;
  if (process.env.NODE_ENV === "test" && process.env.KNOWLEDGE_ENGINE_MODE === "stub") {
    // Test-only engine fixture; never accepted by the production publication worker.
    const entries = JSON.parse(fs.readFileSync(path.join(library, ".stub-index.json"),"utf8"));
    pages = Number(entries.find((entry: Row) => entry.doc_id === index.doc_id)?.pages || 0);
  } else {
    const engine = JSON.parse(read(path.join(library, `${index.doc_id}.tree.json`)).toString());
    const pageRows = JSON.parse(read(path.join(library, "docs", index.doc_id, "pages.json")).toString());
    read(path.join(library, "docs", index.doc_id, "tree.json"));
    if (engine.status !== "completed" || engine.retrieval_ready !== true || !Array.isArray(pageRows))
      fail("knowledge_not_ready", "索引尚未达到可检索状态");
    pages = pageRows.length;
  }
  if (pages < 1) fail("knowledge_pages_missing", "索引没有可验证的页面");
  return { document_id: doc.id, base_id: doc.base_id, title: doc.title, updated_at: doc.updated_at,
    artifacts: doc.artifacts, source_path: doc.source_path, files, pages,
    engine_version: index.engine_version || "unknown", root_id: doc.root_id || doc.id,
    document_version: Number(doc.document_version || 1), expected_active_id: doc.expected_active_id || null,
    ...(doc.knowledge_scope?{knowledge_scope:doc.knowledge_scope}:{}) };
}

function verifySnapshot(snapshot: Row, doc: Row) {
  if(snapshot.knowledge_scope && snapshot.knowledge_scope.fingerprint!==doc.knowledge_scope?.fingerprint)
    fail('knowledge_scope_changed','知识范围版本已变化，请重新提交审批');
  if (doc.base_id !== snapshot.base_id || doc.title !== snapshot.title || doc.source_path !== snapshot.source_path
    || doc.artifacts !== snapshot.artifacts || doc.base_status !== "active")
    fail("knowledge_material_changed", "资料或知识库已变化，需要重新申请");
  for (const file of snapshot.files) {
    if (!fs.existsSync(file.path) || digest(fs.readFileSync(file.path)) !== file.hash)
      fail("knowledge_material_changed", "原件或解析产物已变化，需要重新申请");
  }
}

export async function publicationState(id: string, ctx: ReviewContext) {
  requireAdmin();
  const doc = await document(id, ctx.tenant);
  const binding = (await postgresQuery(`SELECT b.*,t.published_version,COALESCE(l.enabled,1) AS enabled,
    v.definition FROM knowledge_publication_bindings b JOIN review_templates t ON t.tenant=b.tenant AND t.id=b.template_id
    LEFT JOIN review_template_lifecycle l ON l.tenant=b.tenant AND l.template_id=b.template_id
    LEFT JOIN review_versions v ON v.tenant=b.tenant AND v.template_id=b.template_id AND v.version=t.published_version
    WHERE b.base_id=$1 AND b.tenant=$2`, [doc.base_id,ctx.tenant]))[0];
  const pub = (await postgresQuery(`SELECT p.*,j.status AS job_status,j.attempts,j.error_summary
    FROM knowledge_publications p LEFT JOIN execution_jobs j ON j.id='knowledge-publish:' || p.tenant || ':' || p.instance_id
    WHERE p.document_id=$1 AND p.tenant=$2`, [id,ctx.tenant]))[0];
  if(pub?.review_status==="approved" && pub.publication_status!=="published") {
    if(["uncertain","cancelled"].includes(pub.job_status)) pub.publication_status="blocked";
    else if(pub.job_status==="failed") pub.publication_status="failed";
    else if(pub.job_status==="running") pub.publication_status="publishing";
  }
  let label = doc.status === "pending_review" ? "待提交审批" : doc.status === "published" ? "已发布（历史记录）" : undefined;
  const intake = reviewIntake(ctx.tenant);
  let blocking = !binding ? "尚未配置知识发布审批流程" : !binding.published_version ? "审批流程尚未发布"
    : binding.enabled !== 1 ? "审批流程已停用" : !intake.allowed ? intake.reason : "";
  if (doc.base_status !== "active") blocking = "知识库已归档";
  if (pub) {
    label = ({ reviewing:"审批中",blocked:"审批受阻",awaiting_amendment:"待补充说明",rejected:"已驳回",withdrawn:"已撤回",approved:"已批准·等待发布" } as Row)[pub.review_status];
    if (pub.review_status === "approved") label = ({queued:"已批准·等待发布",publishing:"已批准·发布中",published:"已发布",failed:"已批准·发布失败",blocked:"已批准·发布受阻"} as Row)[pub.publication_status] || label;
  }
  if (doc.status === "archived") label = "已停用";
  const actions: string[] = [];
  if (doc.status === "pending_review" && (!pub || ["rejected","withdrawn"].includes(pub.review_status)) && !blocking) actions.push("submit");
  if (pub) actions.push("view_review");
  if (pub?.review_status === "approved" && pub.publication_status === "queued" && pub.job_status === "queued" && doc.base_status === "active") actions.push("publish_approved");
  if (pub?.review_status === "approved" && ["failed","blocked"].includes(pub.publication_status) && ["failed","uncertain"].includes(pub.job_status) && doc.base_status === "active") actions.push("retry_publication");
  if (["published","archived"].includes(doc.status) || pub) actions.push("create_revision");
  const process = ({pending_review:"ready",published:"ready",archived:"ready",uploaded:"queued"} as Row)[doc.status] || doc.status;
  return { document_id:id,tenant:ctx.tenant,base_id:doc.base_id,label,processing_status:process,
    review_status:pub?.review_status || (["published","archived"].includes(doc.status) ? "legacy" : "not_submitted"),publication_status:doc.status === "archived" ? "archived" : pub?.publication_status || (doc.status === "published" ? "published" : "unpublished"),
    version:doc.document_version || 1,binding:binding ? {template_id:binding.template_id,version:binding.version,name:decode(binding.definition).name} : null,
    blocking_reason:blocking,allowed_actions:actions,instance_id:pub?.instance_id || null,error:pub?.error || pub?.error_summary || null,
    receipt:pub?.receipt || null,attempts:pub?.attempts || 0,
    fields:binding ? (decode(binding.definition).fields || []).filter((field: Row) => !["knowledge_request","publication_note"].includes(field.id)) : [] };
}

export async function bindPublication(baseId: string, templateId: string, expectedVersion: number, ctx: ReviewContext) {
  requireAdmin();
  if (!ctx.admin) fail("knowledge_flow_management_required", "需要当前组织的流程管理资格",403);
  return postgresTransaction(async client => {
    const base = (await client.query("SELECT id,status FROM knowledge_bases WHERE id=$1 FOR UPDATE", [baseId])).rows[0];
    if (!base || base.status !== "active") fail("knowledge_base_unavailable", "知识库不存在或已归档");
    const old = (await client.query("SELECT * FROM knowledge_publication_bindings WHERE base_id=$1",[baseId])).rows[0];
    if (old && old.tenant !== ctx.tenant) fail("knowledge_base_unavailable", "知识库不在当前组织范围",403);
    if ((old?.version || 0) !== expectedVersion) fail("knowledge_binding_changed", "流程绑定已变化，请刷新");
    const t = (await client.query(`SELECT v.definition FROM review_templates t JOIN review_versions v
      ON v.tenant=t.tenant AND v.template_id=t.id AND v.version=t.published_version
      LEFT JOIN review_template_lifecycle l ON l.tenant=t.tenant AND l.template_id=t.id
      WHERE t.tenant=$1 AND t.id=$2 AND COALESCE(l.enabled,1)=1`,[ctx.tenant,templateId])).rows[0];
    if (!t || decode(t.definition).subjectType !== "knowledge_publication") fail("knowledge_flow_unavailable", "请选择当前组织已发布且启用的知识发布流程");
    await client.query(`INSERT INTO knowledge_publication_bindings(base_id,tenant,template_id,version,updated_by,updated_at)
      VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(base_id) DO UPDATE SET template_id=$3,version=knowledge_publication_bindings.version+1,updated_by=$4,updated_at=$5`,[baseId,ctx.tenant,templateId,ctx.actor,stamp()]);
    await publicationAudit(client,ctx.actor,"knowledge.publication.bind",{base_id:baseId,tenant:ctx.tenant,template_id:templateId,version:expectedVersion+1});
    return {bound:true};
  });
}

async function publicationCommand(id: string, note: string, ctx: ReviewContext, extraValues: unknown = {}) {
  requireAdmin();
  if (typeof note !== "string" || !note.trim() || note.length > 2000) fail("knowledge_note_required", "请填写发布说明，最多2000字",422);
  const state = await publicationState(id,ctx);
  if (!state.allowed_actions.includes("submit")) fail("knowledge_cannot_submit",state.blocking_reason || "当前资料已有申请或尚未准备好");
  const doc = await document(id,ctx.tenant), snapshot = publicationSnapshot(doc), token = randomUUID();
  const binding = (await postgresQuery(`SELECT b.*,t.published_version FROM knowledge_publication_bindings b
    JOIN review_templates t ON t.tenant=b.tenant AND t.id=b.template_id WHERE b.base_id=$1 AND b.tenant=$2`,[doc.base_id,ctx.tenant]))[0];
  if (!extraValues || typeof extraValues !== "object" || Array.isArray(extraValues)) fail("knowledge_fields_invalid", "自定义字段格式错误",422);
  const values = {...extraValues as Record<string, unknown>,knowledge_request:token,publication_note:note.trim()};
  const command: ReviewCommand = {action:"submit",templateId:binding.template_id,templateVersion:binding.published_version,title:`知识发布：${doc.title}`.slice(0,200),values};
  return {command,doc,snapshot,token,binding,values};
}
export async function checkPublication(id:string,note:string,ctx:ReviewContext,extraValues:unknown={}) {
  try {
    const {command}=await publicationCommand(id,note,ctx,extraValues);
    const summary=new ReviewService(getConn(),ctx).preview(command);
    return {allowed:true,reason:"",reviewers:summary.reviewers || []};
  } catch(error) {
    if(!(error instanceof HttpFail)) throw error;
    const detail=error.detail;
    return {allowed:false,reason:typeof detail==='string'?detail:String((detail as Row)?.message || error.message),reviewers:[]};
  }
}
export async function preparePublication(id:string,note:string,ctx:ReviewContext,extraValues:unknown={}) {
  const {command,doc,snapshot,token,binding,values}=await publicationCommand(id,note,ctx,extraValues);
  // Existing review service owns confirmation/organization parsing. The native
  // trigger performs the atomic object association inside its submit transaction.
  const prepared = new ReviewService(getConn(),ctx).prepare(command);
  await postgresQuery(`INSERT INTO knowledge_publication_requests(id,tenant,document_id,actor,template_id,template_version,binding_version,snapshot,review_values,expires_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[token,ctx.tenant,id,ctx.actor,binding.template_id,binding.published_version,binding.version,JSON.stringify(snapshot),JSON.stringify(values),prepared.expiresAt,stamp()]);
  return {...prepared,command,material:{title:doc.title,base_name:doc.base_name,pages:snapshot.pages,version:snapshot.document_version},
    summary:{...prepared.summary,consequence:"审批通过后将自动发布此版本，供获准使用该知识库的技能检索；不会自动重跑原咨询任务。"}};
}

/** Guard both the knowledge entry and the generic review command entry. */
export async function guardKnowledgeReview(command: ReviewCommand, ctx: ReviewContext) {
  if (!command || typeof command !== "object") return;
  let req: Row | undefined;
  if (command.action === "submit") {
    const t = (await postgresQuery("SELECT definition FROM review_versions WHERE tenant=$1 AND template_id=$2 AND version=$3",[ctx.tenant,command.templateId,command.templateVersion]))[0];
    if (decode(t?.definition).subjectType !== "knowledge_publication") return;
    requireAdmin();
    req = (await postgresQuery("SELECT * FROM knowledge_publication_requests WHERE id=$1 AND tenant=$2 AND actor=$3",[command.values.knowledge_request,ctx.tenant,ctx.actor]))[0];
    if (!req) fail("knowledge_request_required", "请从知识资料详情预检并提交审批",422);
  } else if ("instanceId" in command) {
    req = (await postgresQuery(`SELECT r.* FROM knowledge_publication_requests r JOIN review_participants p
      ON p.tenant=r.tenant AND p.instance_id=r.instance_id WHERE r.tenant=$1 AND r.instance_id=$2 AND p.user_id=$3`,[ctx.tenant,command.instanceId,ctx.actor]))[0];
    if (!req || ["withdraw","reject","request_amendment","transfer","countersign"].includes(command.action)) return;
  }
  if (req) verifySnapshot(decode(req.snapshot),await document(req.document_id,ctx.tenant));
}

export async function knowledgeReviewMaterial(instanceId: string,ctx: ReviewContext) {
  const req = (await postgresQuery(`SELECT r.snapshot,r.document_id,p.publication_status,p.error,p.receipt
    FROM knowledge_publication_requests r JOIN review_participants m ON m.tenant=r.tenant AND m.instance_id=r.instance_id
    LEFT JOIN knowledge_publications p ON p.tenant=r.tenant AND p.instance_id=r.instance_id
    WHERE r.tenant=$1 AND r.instance_id=$2 AND m.user_id=$3`,[ctx.tenant,instanceId,ctx.actor]))[0];
  if (!req) fail("knowledge_review_unavailable", "资料不存在或不可见",404);
  const snapshot = decode(req.snapshot);
  verifySnapshot(snapshot,await document(req.document_id,ctx.tenant));
  return {title:snapshot.title,base_id:snapshot.base_id,pages:snapshot.pages,version:snapshot.document_version,
    publication_status:req.publication_status || "unpublished",error:req.error,receipt:req.receipt,source_path:snapshot.source_path,document_id:req.document_id,
    knowledge_scope:snapshot.knowledge_scope || null,
    management_url:ctx.admin ? `/admin/knowledge?document=${encodeURIComponent(req.document_id)}&reviewCompany=${encodeURIComponent(ctx.tenant)}` : null};
}

export async function knowledgeReviewTrial(instanceId:string,query:string,ctx:ReviewContext) {
  if(typeof query!=="string" || !query.trim() || query.length>2000) fail("knowledge_query_required","请输入试算问题，最多2000字",422);
  const material=await knowledgeReviewMaterial(instanceId,ctx);
  const result=await queryDocuments({query,base_id:material.base_id,doc_ids:[material.document_id],include_pending:true},ctx.actor);
  await knowledgeReviewMaterial(instanceId,reviewContextForActor(getConn(),ctx.actor,ctx.tenant));
  return {...result,citations:Array.isArray(result.citations) ? result.citations.map((citation:Row)=>({...citation,
    source_url:`/api/approvals/v2/instances/${encodeURIComponent(instanceId)}/knowledge/file?company=${encodeURIComponent(ctx.tenant)}#page=${citation.page}`})):[],
    scope:"本次审批版本试算，未发布内容不进入员工问答"};
}

export async function publishApprovedKnowledge(job: ClaimedExecutionJob, checkpoint: () => Promise<void>) {
  const payload = decode(job.payload_json);
  try {
    await checkpoint();
    const current = reviewContextForActor(getConn(),String(job.actor_ref),String(job.tenant_ref));
    if (!current.admin) fail("knowledge_publication_authority_revoked", "发起人的知识治理资格已失效",403);
    return await postgresTransaction(async client => {
      const row = (await client.query(`SELECT p.*,r.snapshot FROM knowledge_publications p JOIN knowledge_publication_requests r ON r.id=p.request_id
        WHERE p.document_id=$1 AND p.tenant=$2 AND p.instance_id=$3 AND p.request_id=$4 FOR UPDATE OF p`,[payload.document_id,job.tenant_ref,payload.instance_id,payload.request_id])).rows[0];
      if (!row || row.review_status !== "approved") fail("knowledge_approval_invalid", "批准记录不匹配");
      if (row.publication_status === "published") return row.receipt;
      const snapshot = decode(row.snapshot), doc = await document(row.document_id,String(job.tenant_ref),client);
      await client.query("SELECT id FROM knowledge_documents WHERE id=$1 FOR UPDATE",[snapshot.root_id]);
      verifySnapshot(snapshot,doc);
      if (doc.status !== "pending_review") fail("knowledge_version_changed", "待发布资料状态已变化");
      const active = (await client.query(`SELECT d.id FROM knowledge_documents d LEFT JOIN knowledge_document_lineage l ON l.document_id=d.id
        WHERE (d.id=$1 OR l.root_id=$1) AND d.status='published' FOR UPDATE OF d`,[snapshot.root_id])).rows;
      if ((active[0]?.id || null) !== snapshot.expected_active_id) fail("knowledge_active_version_changed", "生效版本已变化，请重新申请");
      const lease = (await client.query("SELECT id FROM execution_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_until>$3 FOR UPDATE",[job.id,job.worker_id,stamp()])).rows[0];
      if (!lease) fail("knowledge_execution_lease_lost", "发布作业租约已失效");
      await client.query("UPDATE knowledge_publications SET publication_status='publishing',error=NULL WHERE document_id=$1",[doc.id]);
      await client.query("SELECT set_config('knowledge.publication_request',$1,true)",[row.request_id]);
      const time = stamp();
      if (active.length) await client.query("UPDATE knowledge_documents SET status='archived',updated_at=$2 WHERE id=$1",[active[0].id,time]);
      await client.query("UPDATE knowledge_documents SET status='published',published_by=$2,published_at=$3,updated_at=$3 WHERE id=$1",[doc.id,current.actor,time]);
      const receipt = {document_id:doc.id,instance_id:row.instance_id,request_id:row.request_id,published_at:time,version:snapshot.document_version,replaced_document_id:active[0]?.id || null};
      await client.query("UPDATE knowledge_publications SET publication_status='published',receipt=$2,error=NULL,updated_at=$3 WHERE document_id=$1",[doc.id,JSON.stringify(receipt),time]);
      await client.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,'knowledge.document.publish',$3)",[time,current.actor,JSON.stringify(receipt)]);
      await client.query(`INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at)
        VALUES($1,$2,$3,$4,'knowledge.published',$5,$6,$7)`,[randomUUID(),job.tenant_ref,row.instance_id,current.actor,snapshot.document_version,JSON.stringify(receipt),time]);
      return receipt;
    });
  } catch (error) {
    await postgresQuery(`UPDATE knowledge_publications SET publication_status=$4,error=$5,updated_at=$6
      WHERE document_id=$1 AND tenant=$2 AND instance_id=$3 AND publication_status<>'published'`,[payload.document_id,job.tenant_ref,payload.instance_id,
      error instanceof HttpFail ? "blocked" : "failed",error instanceof Error ? error.message : "发布失败",stamp()]);
    throw error;
  }
}
registerExecutionHandler("knowledge.publish",publishApprovedKnowledge);

/** Execute the existing approved job now, using the same lease and receipt as the worker. */
export async function publishApprovedDocument(id:string,ctx:ReviewContext) {
  requireAdmin();
  if (!ctx.admin) fail("knowledge_publication_forbidden", "没有当前组织的知识发布权限",403);
  const state=await publicationState(id,ctx);
  if (state.publication_status === "published") return {publication_status:"published",receipt:state.receipt};
  if (!state.allowed_actions.includes("publish_approved")) fail("knowledge_publication_not_publishable", "当前版本未获批准或发布任务正在执行，请刷新状态");
  const { processExecutionJobById } = await import("../execution-jobs/dispatcher.js");
  const result=await processExecutionJobById(`knowledge-publish:${ctx.tenant}:${state.instance_id}`,`knowledge-publish-now:${randomUUID()}`);
  const current=await publicationState(id,ctx);
  if (current.publication_status === "published") return {publication_status:"published",receipt:current.receipt};
  if (result?.outcome === "failed") fail("knowledge_publication_failed",current.error || "发布失败，请核对原因后重试");
  fail("knowledge_publication_busy", "发布任务正在执行，请刷新状态");
}

export async function retryPublication(id:string,ctx:ReviewContext) {
  requireAdmin();
  const state = await publicationState(id,ctx);
  if (!state.allowed_actions.includes("retry_publication")) fail("knowledge_publication_not_retryable", "当前资料不可重试发布");
  return postgresTransaction(async client => {
    const jobId = `knowledge-publish:${ctx.tenant}:${state.instance_id}`, time=stamp();
    const changed = await client.query(`UPDATE execution_jobs SET status='queued',attempts=0,error_code=NULL,error_summary=NULL,
      terminal_at=NULL,lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL,updated_at=$2
      WHERE id=$1 AND status IN ('failed','uncertain') RETURNING id`,[jobId,time]);
    if (!changed.rowCount) fail("knowledge_publication_busy", "发布作业仍在执行或等待自动重试，请刷新");
    await client.query("UPDATE knowledge_publications SET publication_status='queued',error=NULL,updated_at=$2 WHERE document_id=$1",[id,time]);
    const eventId=randomUUID();
    await client.query(`INSERT INTO execution_outbox(id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,status,available_at,created_at,updated_at)
      VALUES($1,$2,'execution.ready','knowledge',$3,$4,$1,'pending',$5,$5,$5)`,[eventId,jobId,id,JSON.stringify({execution_job_id:jobId}),time]);
    await publicationAudit(client,ctx.actor,"knowledge.publication.retry",{document_id:id,instance_id:state.instance_id,execution_job_id:jobId,event_id:eventId});
    return {queued:true,execution_job_id:jobId};
  });
}

export async function replaceDraftDocument(id:string,file:{name:string;bytes:Buffer},updatedAt:string,ctx:ReviewContext) {
  requireAdmin();
  if(!file.name.toLowerCase().endsWith(".pdf") || !file.bytes.subarray(0,1024).includes(Buffer.from("%PDF-")))
    fail("knowledge_invalid_pdf","请选择有效的PDF原件",422);
  if(file.bytes.length>Number(process.env.KNOWLEDGE_DOC_MAX_BYTES || 536870912)) fail("knowledge_document_too_large","文件超过知识资料大小限制",413);
  return postgresTransaction(async client=>{
    await client.query("SELECT id FROM knowledge_documents WHERE id=$1 FOR UPDATE",[id]);
    const doc=await document(id,ctx.tenant,client);
    if(doc.status!=="draft" || doc.updated_at!==updatedAt) fail("knowledge_draft_changed","仅可替换当前未解析草稿，请刷新");
    const source=path.isAbsolute(doc.source_path) ? doc.source_path : path.join(dataDir(),doc.source_path);
    const filePath=path.join(path.dirname(source),`source-${randomUUID()}.pdf`);
    fs.writeFileSync(filePath,file.bytes);
    try{
      await client.query("UPDATE knowledge_documents SET source_path=$2,filename=$3,title=$4,size_bytes=$5,updated_at=$6 WHERE id=$1",
        [id,filePath,path.basename(file.name),path.basename(file.name).replace(/\.pdf$/i,""),file.bytes.length,stamp()]);
      await publicationAudit(client,ctx.actor,"knowledge.document.draft.replace",{document_id:id,filename:path.basename(file.name),sha256:digest(file.bytes)});
      return {saved:true};
    }catch(error){fs.rmSync(filePath,{force:true});throw error;}
  });
}

export async function createDocumentRevision(id:string,ctx:ReviewContext) {
  requireAdmin();
  return postgresTransaction(async client => {
    const old = await document(id,ctx.tenant,client), root=old.root_id || old.id;
    await client.query("SELECT id FROM knowledge_documents WHERE id=$1 FOR UPDATE",[root]);
    const max = (await client.query("SELECT COALESCE(MAX(version),1) AS version FROM knowledge_document_lineage WHERE root_id=$1",[root])).rows[0];
    const active=(await client.query(`SELECT d.id FROM knowledge_documents d LEFT JOIN knowledge_document_lineage l ON l.document_id=d.id
      WHERE (d.id=$1 OR l.root_id=$1) AND d.status='published'`,[root])).rows[0];
    const next=`kdoc_${randomUUID()}`, source=path.isAbsolute(old.source_path) ? old.source_path : path.join(dataDir(),old.source_path);
    const folder=path.join(path.dirname(path.dirname(source)),next), newSource=path.join(folder,"source.pdf");
    fs.mkdirSync(folder,{recursive:true});fs.copyFileSync(source,newSource);
    try {
      const time=stamp();
      await client.query(`INSERT INTO knowledge_documents(id,base_id,title,filename,media_type,mime,size_bytes,source_path,status,retry_count,created_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,'pdf','application/pdf',$5,$6,'draft',0,$7,$8,$8)`,[next,old.base_id,old.title,old.filename,old.size_bytes,newSource,ctx.actor,time]);
      await client.query("INSERT INTO knowledge_document_lineage(document_id,root_id,version,expected_active_id) VALUES($1,$2,$3,$4)",[next,root,Number(max.version)+1,active?.id || null]);
      const explanation=old.knowledge_scope?.explanation || '';
      await client.query("INSERT INTO knowledge_document_scopes(document_id,tenant,explanation,fingerprint,updated_at) VALUES($1,$2,$3,$4,$5)",[next,ctx.tenant,explanation,digest(Buffer.from(explanation)),time]);
      await publicationAudit(client,ctx.actor,"knowledge.document.revision",{document_id:next,root_id:root,version:Number(max.version)+1,from_document_id:id});
      return {document_id:next,version:Number(max.version)+1};
    } catch(error) { fs.rmSync(folder,{recursive:true,force:true}); throw error; }
  });
}
