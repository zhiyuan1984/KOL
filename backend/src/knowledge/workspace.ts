import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { postgresReviewContext } from "../approval/review-postgres-access.js";
import { postgresTransaction } from "../postgres/pool.js";
import { HttpFail } from "../host/errors.js";
import { knowledgeKindSpec } from "../knowledge-kinds.js";

type Row = Record<string, any>;
const parse = (value: any, fallback: any) => { if(value == null || value === "") return fallback; return typeof value === "string" ? JSON.parse(value) : value; };
const now = () => new Date().toISOString();
const fail = (status: number, message: string): never => { throw new HttpFail(status,{message}); };
export async function workspaceContext(db: PoolClient, actor: string, tenant?: string) {
  const ctx=await postgresReviewContext(db,actor,tenant);
  if(!ctx.admin) fail(403,"需要知识管理权限");
  return ctx;
}
async function owners(db: PoolClient, people: {id:string}[]) {
  const ids=people.map(p=>p.id);
  const rows=(await db.query("SELECT id,username FROM users WHERE id=ANY($1::text[])",[ids])).rows;
  return [...new Set(rows.flatMap(r=>[r.id,r.username]))];
}
export async function authorizeEntry(db: PoolClient, actor:string, tenant:string|undefined,id:string) {
  const ctx=await workspaceContext(db,actor,tenant);
  const ownerIds=await owners(db,ctx.people);
  const row=(await db.query("SELECT created_by FROM knowledge WHERE id=$1 AND created_by=ANY($2::text[])",[id,ownerIds])).rows[0];
  if(!row) fail(404,"知识不存在或不在当前组织范围");
  const bound=(await db.query("SELECT tenant FROM knowledge_publication_applications WHERE entry_id=$1 ORDER BY created_at LIMIT 1",[id])).rows[0];
  if(bound && bound.tenant!==ctx.tenant) fail(404,"知识不在当前组织范围");
  return ctx;
}
const join = `LEFT JOIN knowledge_bases b ON b.id=k.base_id LEFT JOIN knowledge_domains d ON d.id=b.domain_id LEFT JOIN knowledge_domains f ON f.id=d.parent_id`;
function entryProjection(row:Row):Row {
  const version=Number(row.current_version), effective=Number(row.published_version)||null;
  const draft=row.status!=="archived" && version!==effective;
  return {...row, current_version:version,published_version:effective, status:draft ? (row.review_status ? "pending_review":"draft"):row.status,
    stage_codes:parse(row.stage_codes,[]),placeholders:parse(row.placeholders,[]),structured:parse(row.structured,{}),
    publication_label:row.review_status ? ({approved:"审批通过 · 等待发布",reviewing:"审批中",blocked:"审批受阻",awaiting_amendment:"待补充材料",rejected:"已驳回",withdrawn:"已撤回"} as Row)[row.review_status] : undefined};
}
export async function workspaceData(actor:string,tenant?:string) {
  return postgresTransaction(async db=>{
    const ctx=await workspaceContext(db,actor,tenant), ids=await owners(db,ctx.people);
    const rows=(await db.query(`SELECT k.*,b.name AS base_name,b.kind AS base_kind,d.id AS domain_id,d.name AS domain_name,f.id AS family_id,f.name AS family_name,
      a.review_status FROM knowledge k ${join}
      LEFT JOIN LATERAL(SELECT i.status AS review_status FROM knowledge_publication_applications p JOIN review_instances i ON i.tenant=p.tenant AND i.id=p.instance_id
        WHERE p.entry_id=k.id AND p.tenant=$2 AND p.status='waiting' ORDER BY p.created_at DESC LIMIT 1) a ON true
      WHERE k.created_by=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p WHERE p.entry_id=k.id AND p.tenant<>$2)
      ORDER BY k.updated_at DESC,k.id`,[ids,ctx.tenant])).rows.map(entryProjection);
    const documents=(await db.query(`SELECT k.*, 'document' AS asset_type, b.name AS base_name,d.id AS domain_id,d.name AS domain_name,f.id AS family_id,f.name AS family_name,
      COALESCE(l.version,1) AS current_version, a.review_status,a.release_status,
      lp.review_status AS legacy_review_status,lp.publication_status AS legacy_publication_status
      FROM knowledge_documents k ${join}
      LEFT JOIN knowledge_document_lineage l ON l.document_id=k.id
      LEFT JOIN knowledge_publication_bindings binding ON binding.base_id=k.base_id
      LEFT JOIN knowledge_publications lp ON lp.document_id=k.id
      LEFT JOIN LATERAL(SELECT i.status AS review_status,p.status AS release_status FROM knowledge_publication_applications p JOIN review_instances i ON i.tenant=p.tenant AND i.id=p.instance_id
        WHERE p.document_id=k.id AND p.tenant=$2 ORDER BY p.created_at DESC LIMIT 1) a ON true
      WHERE k.created_by=ANY($1::text[]) AND (binding.tenant IS NULL OR binding.tenant=$2)
      AND NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p WHERE p.document_id=k.id AND p.tenant<>$2)
      ORDER BY k.updated_at DESC,k.id`,[ids,ctx.tenant])).rows.map(r=>({...r,kind:"document",body:"",current_version:Number(r.current_version),
        publication_label: ({approved:"审批通过 · 等待发布",reviewing:"审批中",blocked:"审批受阻",awaiting_amendment:"待补充材料",rejected:"已驳回",withdrawn:"已撤回",failed:"发布失败",published:"已发布"} as Row)[r.release_status && r.release_status!=="waiting" ? r.release_status:r.review_status || (r.legacy_publication_status==="published" ? "published":r.legacy_review_status)]}));
    const bases=(await db.query(`SELECT b.*,d.name AS domain_name,d.parent_id AS family_id,f.name AS family_name FROM knowledge_bases b LEFT JOIN knowledge_domains d ON d.id=b.domain_id LEFT JOIN knowledge_domains f ON f.id=d.parent_id
      LEFT JOIN knowledge_publication_bindings binding ON binding.base_id=b.id WHERE binding.tenant IS NULL OR binding.tenant=$1 ORDER BY b.name,b.id`,[ctx.tenant])).rows;
    const domains=(await db.query("SELECT * FROM knowledge_domains ORDER BY sort,name,id")).rows;
    return {tenant:ctx.tenant,rows:[...rows,...documents],bases,domains};
  },{isolation:"REPEATABLE READ"});
}
const snapshotFields=["title","body","subject","body_en","placeholders","stage_codes","skill_id","brand","lang","kind","status","tags","in_market","effective_at","expires_at","structured","source_body","base_id"];
export async function writeEntryVersion(db:PoolClient,row:Row,actor:string,note:string) {
  const columns=["id","knowledge_id","version",...snapshotFields,"created_by","created_at","note"];
  const values=[randomUUID(),row.id,row.current_version,...snapshotFields.map(f=>row[f] ?? null),actor,now(),note];
  await db.query(`INSERT INTO knowledge_versions(${columns.join(",")}) VALUES(${values.map((_,i)=>`$${i+1}`).join(",")})`,values);
}
export async function entryMaterial(db:PoolClient,id:string):Promise<any> {
  const row=(await db.query("SELECT k.*,b.status AS base_status FROM knowledge k JOIN knowledge_bases b ON b.id=k.base_id WHERE k.id=$1 FOR UPDATE OF k",[id])).rows[0];
  if(!row || row.base_status!=="active" || row.status==="archived" || Number(row.current_version)===Number(row.published_version)) fail(409,"当前知识没有可提交的有效草稿");
  const content={title:row.title,body:row.body,kind:row.kind,structured:parse(row.structured,{})};
  const snapshot={assetType:"entry",entryId:id,title:row.title,filename:row.title,version:Number(row.current_version),updatedAt:row.updated_at,
    expectedPublishedVersion:row.published_version==null ? null:Number(row.published_version),content,
    fields:Object.fromEntries(snapshotFields.map(key=>[key,row[key]]))};
  return {doc:row,bytes:Buffer.from(JSON.stringify(snapshot)),snapshot,fingerprint:createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")};
}
export async function publishEntry(db:PoolClient,id:string,actor:string,snapshot:Row) {
  const row=(await db.query("SELECT * FROM knowledge WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if((row.published_version==null?null:Number(row.published_version))!==snapshot.expectedPublishedVersion) fail(409,"生效版本已变化，请重新申请");
  const stamp=now();
  await db.query("UPDATE knowledge SET status='published',published_version=current_version,approved_by=$2,approved_at=$3 WHERE id=$1",[id,actor,stamp]);
  await writeEntryVersion(db,{...row,status:"published"},actor,"approve");
}
export async function entryDetail(actor:string,tenant:string|undefined,id:string) {
  return postgresTransaction(async db=>{
    await authorizeEntry(db,actor,tenant,id);
    const row=(await db.query(`SELECT k.*,b.name AS base_name,b.kind AS base_kind,d.id AS domain_id,d.name AS domain_name,f.id AS family_id,f.name AS family_name,
      (SELECT i.status FROM knowledge_publication_applications p JOIN review_instances i ON i.tenant=p.tenant AND i.id=p.instance_id WHERE p.entry_id=k.id AND p.status='waiting' ORDER BY p.created_at DESC LIMIT 1) AS review_status
      FROM knowledge k ${join} WHERE k.id=$1`,[id])).rows[0];
    const versions=(await db.query("SELECT * FROM knowledge_versions WHERE knowledge_id=$1 ORDER BY version DESC,created_at DESC,id",[id])).rows;
    const grants=(await db.query("SELECT scope,scope_id FROM knowledge_grants WHERE knowledge_id=$1",[id])).rows;
    const refs=(await db.query("SELECT DISTINCT skill_id FROM knowledge_bindings WHERE enabled=1 AND (selector::jsonb->'ids') ? $1",[id])).rows;
    const frozen=(await db.query("SELECT 1 FROM knowledge_publication_applications WHERE entry_id=$1 AND status='waiting'",[id])).rowCount;
    const historical=(await db.query("SELECT 1 FROM knowledge_publication_applications WHERE entry_id=$1",[id])).rowCount;
    const projected=entryProjection(row);
    return {row:projected,versions,grants,refs:refs.map(r=>r.skill_id),actions:{edit:projected.status==="draft" && !frozen,revision:projected.status==="published" && !frozen,archive:Boolean(row.published_version) && !frozen,delete:projected.status==="draft" && !row.published_version && !historical,submit:projected.status==="draft" && !frozen}};
  });
}
export async function removeEntryDraft(actor:string,tenant:string|undefined,id:string,expectedRevision:string) {
  return postgresTransaction(async db=>{
    await authorizeEntry(db,actor,tenant,id);
    const row=(await db.query("SELECT * FROM knowledge WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if(row.updated_at!==expectedRevision)fail(409,"知识已变化，请重新确认当前草稿");
    if(row.published_version || row.status!=="draft")fail(409,"只能删除从未发布的草稿");
    if((await db.query("SELECT 1 FROM knowledge_publication_applications WHERE entry_id=$1",[id])).rowCount)fail(409,"已有审批记录的知识须保留记录，不能删除");
    await db.query("DELETE FROM knowledge_versions WHERE knowledge_id=$1",[id]);
    await db.query("DELETE FROM knowledge_grants WHERE knowledge_id=$1",[id]);
    await db.query("DELETE FROM knowledge WHERE id=$1",[id]);
    const receipt={id:randomUUID(),knowledgeId:id,version:Number(row.current_version),status:"deleted",at:now()};
    await db.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,'knowledge.draft.deleted',$3)",[receipt.at,actor,JSON.stringify(receipt)]);
    return receipt;
  });
}
function validate(input:Row,prev:Row|undefined,base:Row) {
  const kind=String(input.kind ?? prev?.kind ?? "policy"), spec=knowledgeKindSpec(kind);
  if(!spec || !spec.baseKind.includes(base.kind)) fail(422,"知识类型与知识库不兼容");
  const structured={...parse(prev?.structured,{}),...(input.structured || {})};
  const issues: {path:string;message:string}[]=[];
  if(!String(input.title ?? prev?.title ?? "").trim()) issues.push({path:"title",message:"请填写标题"});
  for(const field of spec!.fields) {
    const v=structured[field.key];
    if(field.required && (v==null || v==="" || (Array.isArray(v)&&!v.length))) issues.push({path:`structured:${field.key}`,message:`请填写${field.label}`});
    if(v!=null && (field.type==="string_list" ? !Array.isArray(v)||v.some((x:unknown)=>typeof x!=="string"):typeof v!=="string")) issues.push({path:`structured:${field.key}`,message:`${field.label}格式不正确`});
  }
  if(issues.length) throw new HttpFail(422,{message:"请修正知识字段",issues});
  return {kind,structured};
}
export async function saveEntry(actor:string,tenant:string|undefined,id:string|undefined,input:Row) {
  return postgresTransaction(async db=>{
    const ctx=await workspaceContext(db,actor,tenant);
    let prev:Row|undefined;
    if(id) {
      await authorizeEntry(db,actor,ctx.tenant,id);
      prev=(await db.query("SELECT * FROM knowledge WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if(!input.expectedRevision || input.expectedRevision!==prev!.updated_at) fail(409,"内容已变化，请保留输入并刷新后重试");
      if(Number(prev!.current_version)===Number(prev!.published_version)||prev!.status==="archived") fail(409,"请先创建新版本草稿");
      if((await db.query("SELECT 1 FROM knowledge_publication_applications WHERE entry_id=$1 AND status='waiting'",[id])).rowCount) fail(409,"本次审批材料已冻结，请创建新版本草稿");
    }
    const base=(await db.query("SELECT b.* FROM knowledge_bases b LEFT JOIN knowledge_publication_bindings p ON p.base_id=b.id WHERE b.id=$1 AND b.status='active' AND (p.tenant IS NULL OR p.tenant=$2)",[input.base_id || prev?.base_id,ctx.tenant])).rows[0];
    if(!base) fail(422,"请选择当前组织可写入的知识库");
    const model=validate(input,prev,base), stamp=now();
    const row:Row={...prev,id:id || `kb_${randomUUID()}`,title:String(input.title ?? prev?.title).trim(),body:String(input.body ?? prev?.body ?? ""),
      kind:model.kind,structured:JSON.stringify(model.structured),base_id:base.id,status:prev?.published_version ? "published":"draft",current_version:Number(prev?.current_version || 1),
      published_version:prev?.published_version ?? null,created_by:prev?.created_by || actor,created_at:prev?.created_at || stamp,updated_at:stamp,
      brand:input.brand ?? prev?.brand ?? "*",lang:input.lang ?? prev?.lang ?? "en",tags:input.tags ?? prev?.tags ?? "",in_market:prev?.in_market ?? 1,
      skill_id:input.skill_id ?? prev?.skill_id ?? "",source_body:prev?.source_body ?? input.body ?? "",
      subject:model.structured.subject ?? prev?.subject ?? "",body_en:model.structured.body_en ?? prev?.body_en ?? "",
      placeholders:JSON.stringify(model.structured.placeholders ?? parse(prev?.placeholders,[])),stage_codes:JSON.stringify(input.stage_codes ?? parse(prev?.stage_codes,[])),
      effective_at:prev?.effective_at ?? null,expires_at:prev?.expires_at ?? null};
    const columns=["title","body","tags","kind","skill_id","brand","lang","subject","body_en","placeholders","stage_codes","status","current_version","published_version","created_by","created_at","updated_at","base_id","source_body","structured","in_market","effective_at","expires_at"];
    if(id) await db.query(`UPDATE knowledge SET ${columns.map((c,i)=>`${c}=$${i+2}`).join(",")} WHERE id=$1`,[id,...columns.map(c=>row[c])]);
    else await db.query(`INSERT INTO knowledge(id,${columns.join(",")}) VALUES(${[row.id,...columns.map(c=>row[c])].map((_,i)=>`$${i+1}`).join(",")})`,[row.id,...columns.map(c=>row[c])]);
    await writeEntryVersion(db,row,actor,id?"save draft":"create");
    await db.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,'knowledge.draft.saved',$3)",[stamp,actor,JSON.stringify({knowledge_id:row.id,version:row.current_version,tenant:ctx.tenant})]);
    return entryProjection(row);
  });
}
export async function reviseEntry(actor:string,tenant:string|undefined,id:string,expectedRevision:string,fromVersion?:number) {
  return postgresTransaction(async db=>{
    await authorizeEntry(db,actor,tenant,id);
    const row=(await db.query("SELECT * FROM knowledge WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if(row.updated_at!==expectedRevision) fail(409,"内容已变化，请刷新后创建草稿");
    const frozen=(await db.query("SELECT 1 FROM knowledge_publication_applications WHERE entry_id=$1 AND status='waiting'",[id])).rowCount;
    // A frozen application owns its material. A separate object is used so it
    // cannot be mutated by the new draft; ordinary published revisions retain identity.
    if(frozen) fail(409,"当前审批尚未结束，请先按原流程撤回或完成审批，再创建新版本");
    const prior=fromVersion ? (await db.query("SELECT * FROM knowledge_versions WHERE knowledge_id=$1 AND version=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[id,fromVersion])).rows[0]:undefined;
    if(fromVersion && !prior)fail(404,"历史版本不存在");
    const stamp=now(),next:Row={...row,...(prior?Object.fromEntries(snapshotFields.filter(f=>f!=="status").map(f=>[f,prior[f] ?? row[f]])):{}),current_version:Number(row.current_version)+1,updated_at:stamp,status:row.published_version?"published":"draft"};
    const columns=[...snapshotFields.filter(f=>f!=="status"),"status","current_version","updated_at"];
    await db.query(`UPDATE knowledge SET ${columns.map((f,i)=>`${f}=$${i+2}`).join(",")} WHERE id=$1`,[id,...columns.map(f=>next[f])]);
    await writeEntryVersion(db,{...next,status:"draft"},actor,prior?`rollback from v${fromVersion}`:"revision");
    return entryProjection(next);
  });
}
