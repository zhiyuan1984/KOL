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
export async function workspaceData(actor:string,tenant?:string,filter?:WorkspaceFilter) {
  return postgresTransaction(async db=>{
    const ctx=await workspaceContext(db,actor,tenant), ids=await owners(db,ctx.people);
    const f=normalizeFilter(filter);
    const base={ids,tenant:ctx.tenant};
    // 主列表：条目与非结构化资料的对齐 UNION，服务端过滤＋分页（A）。
    const {sql:unionSQL,params:unionParams}=buildUnion(base,f,null,e=>e?ROW_COLS:DOC_COLS);
    const total=Number((await db.query(`SELECT COUNT(*) AS c FROM (${unionSQL}) u`,unionParams)).rows[0]?.c || 0);
    const pageCount=Math.max(1,Math.ceil(total/f.pageSize));
    const page=Math.min(Math.max(1,f.page),pageCount);
    const offset=(page-1)*f.pageSize;
    const rows=(await db.query(`SELECT * FROM (${unionSQL}) u ORDER BY u.updated_at DESC,u.id LIMIT $${unionParams.length+1} OFFSET $${unionParams.length+2}`,
      [...unionParams,f.pageSize,offset])).rows.map(listProjection);
    // 筛选 chips 计数：每组跳过自身筛选（DESIGN §8 数字同源），与点选后的列表同口径。
    const facets=await facetCounts(db,base,f);
    // 驾驶舱聚合（不限用户筛选）：状态分布＋各队列计数/最长等待。
    const stats=await workspaceStats(db,base);
    const bases=(await db.query(`SELECT b.*,d.name AS domain_name,d.parent_id AS family_id,f.name AS family_name FROM knowledge_bases b LEFT JOIN knowledge_domains d ON d.id=b.domain_id LEFT JOIN knowledge_domains f ON f.id=d.parent_id
      LEFT JOIN knowledge_publication_bindings binding ON binding.base_id=b.id WHERE binding.tenant IS NULL OR binding.tenant=$1 ORDER BY b.name,b.id`,[ctx.tenant])).rows;
    const domains=(await db.query("SELECT * FROM knowledge_domains ORDER BY sort,name,id")).rows;
    return {tenant:ctx.tenant,rows,total,page,page_size:f.pageSize,page_count:pageCount,facets,stats,bases,domains};
  },{isolation:"REPEATABLE READ"});
}

/* ---------- 服务端列表：过滤 / 分页 / 计数（A） ---------- */

export type WorkspaceFilter={
  page?:number;pageSize?:number;q?:string;
  view?:string;kind?:string;brands?:string[];stages?:string[];
  familyId?:string;domainId?:string;baseId?:string;
  asset?:string;expiring?:boolean;
};
export type NormFilter=Required<Omit<WorkspaceFilter,"q"|"kind"|"familyId"|"domainId"|"baseId"|"asset">>
  & {q:string;kind:string;familyId:string;domainId:string;baseId:string;asset:""|"entry"|"document"};
const VIEW_STATUS_SQL:Record<string,string>={pending:"pending_review",published:"published",draft:"draft",disabled:"archived"};
const SCOPE_NONE="__none__";

export function parseWorkspaceFilter(query:Record<string,string|undefined>):WorkspaceFilter{
  const num=(v:string|undefined,dflt:number,min:number,max:number)=>{
    const n=Math.floor(Number(v));return Number.isFinite(n)?Math.min(max,Math.max(min,n)):dflt;};
  const csv=(v:string|undefined)=>(v||"").split(",").map(s=>s.trim()).filter(Boolean);
  const view=(query.view||"").trim();
  const asset=(query.asset||"").trim();
  return {
    page:num(query.page,1,1,1000000),pageSize:num(query.page_size,20,1,100),
    q:(query.q||"").trim().slice(0,200),
    view:["all","pending","published","draft","disabled"].includes(view)?view:"all",
    kind:(query.kind||"").trim(),
    brands:csv(query.brands),stages:csv(query.stages),
    familyId:(query.family_id||"").trim(),domainId:(query.domain_id||"").trim(),baseId:(query.base_id||"").trim(),
    asset:asset==="entry"||asset==="document"?asset:"",
    expiring:query.expiring==="1",
  };
}
function normalizeFilter(filter?:WorkspaceFilter):NormFilter{
  const f=parseWorkspaceFilter({
    page:String(filter?.page ?? ""),page_size:String(filter?.pageSize ?? ""),
    q:filter?.q,view:filter?.view,kind:filter?.kind,
    brands:(filter?.brands||[]).join(","),stages:(filter?.stages||[]).join(","),
    family_id:filter?.familyId,domain_id:filter?.domainId,base_id:filter?.baseId,
    asset:filter?.asset,expiring:filter?.expiring?"1":"",
  });
  return f as NormFilter;
}
const likeEscape=(s:string)=>s.replace(/[\\%_]/g,m=>"\\"+m);
/** 条目 projected status 的 SQL 复刻（与 entryProjection 同语义）：有在途审批→pending_review，有未发布草稿→draft。 */
const ENTRY_STATUS_SQL=`CASE WHEN k.status<>'archived' AND (k.published_version IS NULL OR k.current_version<>k.published_version)`
  +` THEN CASE WHEN a.review_status IS NOT NULL THEN 'pending_review' ELSE 'draft' END ELSE k.status END`;

/** 某类资产的过滤 WHERE（不含 tenant 基线）。entry=true 走 knowledge，false 走 knowledge_documents。 */
export function filterWhere(f:NormFilter,entry:boolean,from:number):{sql:string;params:any[]}{
  const conds:string[]=[];const params:any[]=[];
  const p=(v:any)=>{params.push(v);return `$${from+params.length-1}`;};
  if(f.view&&f.view!=="all"){
    const s=VIEW_STATUS_SQL[f.view];
    if(s) conds.push(entry?`(${ENTRY_STATUS_SQL} = ${p(s)})`:`(k.status = ${p(s)})`);
  }
  if(f.kind) conds.push(`(k.kind = ${p(f.kind)})`);
  if(f.brands.length) conds.push(`(k.brand IS NULL OR k.brand='' OR k.brand='*' OR k.brand = ANY(${p(f.brands)}::text[]))`);
  if(f.stages.length) conds.push(`(COALESCE(NULLIF(k.stage_codes,''),'[]')::jsonb = '[]'::jsonb OR EXISTS`
    +` (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(k.stage_codes,''),'[]')::jsonb) s WHERE s = ANY(${p(f.stages)}::text[])))`);
  if(f.familyId) conds.push(f.familyId===SCOPE_NONE?`(f.id IS NULL)`:`(f.id = ${p(f.familyId)})`);
  if(f.domainId) conds.push(f.domainId===SCOPE_NONE?`(d.id IS NULL)`:`(d.id = ${p(f.domainId)})`);
  if(f.baseId) conds.push(f.baseId===SCOPE_NONE?`(k.base_id IS NULL)`:`(k.base_id = ${p(f.baseId)})`);
  if(f.expiring) conds.push(entry
    ?`(k.expires_at IS NOT NULL AND k.expires_at<>'' AND k.expires_at::timestamptz <= NOW() + INTERVAL '30 days')`
    // knowledge_documents 无 expires_at 列：资料不参与到期筛选（与旧行为一致）。
    :`(1=0)`);
  const q=f.q.trim();
  if(q){
    // LIKE 默认转义符即反斜杠（PG 标准行为），pattern 中的 %_ 已用 likeEscape 处理。
    const pat=`%${likeEscape(q)}%`;
    conds.push(entry
      ?`(k.title ILIKE ${p(pat)} OR k.body ILIKE ${p(pat)} OR k.created_by ILIKE ${p(pat)})`
      :`(k.title ILIKE ${p(pat)} OR k.filename ILIKE ${p(pat)} OR k.created_by ILIKE ${p(pat)})`);
  }
  return {sql:conds.length?` AND ${conds.join(" AND ")}`:"",params};
}
const ENTRY_LATERAL=`LEFT JOIN LATERAL(SELECT i.status AS review_status FROM knowledge_publication_applications p`
  +` JOIN review_instances i ON i.tenant=p.tenant AND i.id=p.instance_id`
  +` WHERE p.entry_id=k.id AND p.tenant=$2 AND p.status='waiting' ORDER BY p.created_at DESC LIMIT 1) a ON true`;
const CITE_JOIN=`LEFT JOIN (SELECT knowledge_id,COUNT(*) AS c FROM knowledge_citations`
  +` WHERE cited_at<>'' AND cited_at::timestamptz >= NOW() - INTERVAL '30 days' GROUP BY knowledge_id) cc ON cc.knowledge_id=k.id`;
/** 列表对齐列（条目/资料 UNION 用；不含 body/structured 等重字段，列表只走元数据）。 */
export const ROW_COLS=`k.id,'entry' AS asset_type,k.title,k.kind,${ENTRY_STATUS_SQL} AS status,`
  +`k.brand,k.lang,k.base_id,b.name AS base_name,b.kind AS base_kind,`
  +`d.id AS domain_id,d.name AS domain_name,f.id AS family_id,f.name AS family_name,`
  +`k.stage_codes,k.current_version,k.published_version,k.created_by,k.created_at,k.updated_at,`
  +`k.expires_at,k.effective_at,COALESCE(cc.c,0)::int AS cite_count_30d`;
export const DOC_COLS=`k.id,'document' AS asset_type,k.title,'document' AS kind,k.status,`
  +`NULL::text AS brand,NULL::text AS lang,k.base_id,b.name AS base_name,'unstructured' AS base_kind,`
  +`d.id AS domain_id,d.name AS domain_name,f.id AS family_id,f.name AS family_name,`
  +`'[]' AS stage_codes,COALESCE(l.version,1) AS current_version,NULL::int AS published_version,`
  // knowledge_documents 无 expires_at 列：到期治理只针对条目（与旧行为一致）。
  +`k.created_by,k.created_at,k.updated_at,NULL::text AS expires_at,NULL::text AS effective_at,0 AS cite_count_30d`;
const ENTRY_BASE=`FROM knowledge k ${join} ${ENTRY_LATERAL} ${CITE_JOIN}`
  +` WHERE k.created_by=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p WHERE p.entry_id=k.id AND p.tenant<>$2)`;
const DOC_BASE=`FROM knowledge_documents k ${join}`
  +` LEFT JOIN knowledge_document_lineage l ON l.document_id=k.id`
  +` LEFT JOIN knowledge_publication_bindings binding ON binding.base_id=k.base_id`
  +` WHERE k.created_by=ANY($1::text[]) AND (binding.tenant IS NULL OR binding.tenant=$2)`
  +` AND NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p WHERE p.document_id=k.id AND p.tenant<>$2)`;

/** 过滤后的条目/资料 UNION（selectList 由调用方指定对齐列）。skip 跳过某组筛选（facet 计数口径）。 */
export function buildUnion(base:{ids:any[];tenant:string},f:NormFilter,skip:string|null,selectList:(entry:boolean)=>string){
  const ff={...f};
  if(skip==="view")ff.view="all";if(skip==="kind")ff.kind="";if(skip==="brand")ff.brands=[];
  if(skip==="stage")ff.stages=[];if(skip==="family")ff.familyId="";if(skip==="domain")ff.domainId="";
  if(skip==="base")ff.baseId="";if(skip==="asset")ff.asset="";if(skip==="expiring")ff.expiring=false;
  // 注意：q（搜索）不参与 skip，各组计数都在搜索结果集上算，与点选 chip 后的列表同源。
  const parts:string[]=[];const params:any[]=[base.ids,base.tenant];
  if(ff.asset!=="document"){
    const w=filterWhere(ff,true,params.length+1);
    parts.push(`SELECT ${selectList(true)} ${ENTRY_BASE}${w.sql}`);
    params.push(...w.params);
  }
  if(ff.asset!=="entry"){
    const w=filterWhere(ff,false,params.length+1);
    parts.push(`SELECT ${selectList(false)} ${DOC_BASE}${w.sql}`);
    params.push(...w.params);
  }
  return {sql:parts.join(" UNION ALL ")||"SELECT NULL WHERE false",params};
}
/** 列表行后处理：与旧 entryProjection 对齐的轻量投影（重字段已在 SQL 层去掉）。 */
function listProjection(row:Row):Row{
  return {...row,
    current_version:Number(row.current_version||0),
    published_version:row.published_version==null?null:Number(row.published_version),
    stage_codes:parse(row.stage_codes,[]),
    cite_count_30d:Number(row.cite_count_30d||0)};
}
type FacetResult={all:number;values:Record<string,number>;unbranded?:number;empty?:number};
export async function facetCounts(db:PoolClient,base:{ids:any[];tenant:string},f:NormFilter):Promise<Record<string,FacetResult>>{
  const out:Record<string,FacetResult>={};
  const count=async(skip:string|null,select:(entry:boolean)=>string,group:(alias:string)=>string)=>{
    const {sql,params}=buildUnion(base,f,skip,select);
    const rows=(await db.query(`SELECT ${group("u")} AS k,COUNT(*) AS c FROM (${sql}) u GROUP BY 1`,params)).rows;
    const values:Record<string,number>={};
    for(const r of rows)values[String(r.k)]=Number(r.c);
    const all=Object.values(values).reduce((a,b)=>a+b,0);
    return {all,values};
  };
  out.view=await count("view",e=>e?`${ENTRY_STATUS_SQL} AS status`:`k.status AS status`,u=>`${u}.status`);
  out.kind=await count("kind",e=>e?`k.kind AS kind`:`'document' AS kind`,u=>`${u}.kind`);
  const brand=await count("brand",
    e=>e?`CASE WHEN k.brand IS NULL OR k.brand='' OR k.brand='*' THEN '${SCOPE_NONE}' ELSE k.brand END AS brand`:`'${SCOPE_NONE}' AS brand`,
    u=>`${u}.brand`);
  out.brand={all:brand.all,values:Object.fromEntries(Object.entries(brand.values).filter(([k])=>k!==SCOPE_NONE)),unbranded:brand.values[SCOPE_NONE]||0};
  out.family=await count("family",()=>"COALESCE(f.id,'"+SCOPE_NONE+"') AS family_id",u=>`${u}.family_id`);
  out.domain=await count("domain",()=>"COALESCE(d.id,'"+SCOPE_NONE+"') AS domain_id",u=>`${u}.domain_id`);
  out.base=await count("base",()=>"COALESCE(k.base_id,'"+SCOPE_NONE+"') AS base_id",u=>`${u}.base_id`);
  // 阶段：一行可属多阶段，un-nest 后按 id 去重计数；空阶段单独计数（ chips 语义：空阶段计入每个 stage chip）。
  {
    const {sql,params}=buildUnion(base,f,"stage",
      e=>e?`k.id,COALESCE(NULLIF(k.stage_codes,''),'[]') AS stage_codes`:`k.id,'[]' AS stage_codes`);
    const rows=(await db.query(`SELECT s AS k,COUNT(DISTINCT u.id) AS c FROM (${sql}) u`
      +` CROSS JOIN LATERAL jsonb_array_elements_text(u.stage_codes::jsonb) s GROUP BY 1`,params)).rows;
    const values:Record<string,number>={};
    for(const r of rows)values[String(r.k)]=Number(r.c);
    const empty=Number((await db.query(`SELECT COUNT(*) AS c FROM (${sql}) u`
      +` WHERE COALESCE(NULLIF(u.stage_codes,''),'[]')::jsonb='[]'::jsonb`,params)).rows[0]?.c||0);
    const all=Number((await db.query(`SELECT COUNT(*) AS c FROM (${sql}) u`,params)).rows[0]?.c||0);
    out.stage={all,values,empty};
  }
  return out;
}
export async function workspaceStats(db:PoolClient,base:{ids:any[];tenant:string}){
  const f:NormFilter={...parseWorkspaceFilter({}) as NormFilter,page:1,pageSize:20,q:"",kind:"",familyId:"",domainId:"",baseId:"",asset:"",view:"all",brands:[],stages:[],expiring:false};
  const {sql:u,params}=buildUnion(base,f,null,e=>e?ENTRY_STATUS_SQL:"k.status");
  const statusRows=(await db.query(`SELECT u.status AS k,COUNT(*) AS c FROM (${u}) u GROUP BY 1`,params)).rows;
  const status:Record<string,number>={};
  for(const r of statusRows)status[String(r.k)]=Number(r.c);
  const pendingReview=await db.query(
    `SELECT COUNT(*) AS c,MIN(k.updated_at) AS oldest FROM knowledge k ${ENTRY_LATERAL}`
    +` WHERE k.created_by=ANY($1::text[]) AND a.review_status IS NOT NULL`
    +` AND k.status<>'archived' AND (k.published_version IS NULL OR k.current_version<>k.published_version)`
    +` AND NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p WHERE p.entry_id=k.id AND p.tenant<>$2)`,[base.ids,base.tenant]);
  const pendingDocs=await db.query(
    `SELECT COUNT(*) AS c,MIN(k.updated_at) AS oldest FROM knowledge_documents k`
    +` LEFT JOIN knowledge_publication_bindings binding ON binding.base_id=k.base_id`
    +` WHERE k.created_by=ANY($1::text[]) AND (binding.tenant IS NULL OR binding.tenant=$2) AND k.status='pending_review'`
    +` AND NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p WHERE p.document_id=k.id AND p.tenant<>$2)`,[base.ids,base.tenant]);
  // 到期只针对条目：knowledge_documents 无 expires_at 列（与旧行为一致）。
  const expiring=await db.query(
    `SELECT COUNT(*) AS c,MIN(k.expires_at) AS nearest FROM knowledge k`
    +` WHERE k.created_by=ANY($1::text[]) AND k.expires_at IS NOT NULL AND k.expires_at<>''`
    +` AND k.expires_at::timestamptz <= NOW() + INTERVAL '30 days'`
    +` AND NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p WHERE p.entry_id=k.id AND p.tenant<>$2)`,[base.ids,base.tenant]);
  const waitDays=(oldest:any)=>oldest?Math.max(0,Math.ceil((Date.now()-new Date(String(oldest)).getTime())/86400000)):0;
  return {
    status,
    pending_review:{count:Number(pendingReview.rows[0]?.c||0),max_wait_days:waitDays(pendingReview.rows[0]?.oldest)},
    pending_documents:{count:Number(pendingDocs.rows[0]?.c||0),max_wait_days:waitDays(pendingDocs.rows[0]?.oldest)},
    expiring:{count:Number(expiring.rows[0]?.c||0),nearest:expiring.rows[0]?.nearest||null},
  };
}

/* ---------- 批量续期 / 归档（C） ---------- */

export type BatchItem={id:string;asset:"entry"|"document"};
export async function batchWorkspaceItems(actor:string,tenant:string|undefined,items:BatchItem[],action:"renew"|"archive",expiresAt?:string){
  return postgresTransaction(async db=>{
    const ctx=await workspaceContext(db,actor,tenant);
    const ids=await owners(db,ctx.people);
    const stamp=now();
    const results:{id:string;ok:boolean;error?:string}[]=[];
    for(const item of items.slice(0,200)){
      try{
        if(item.asset==="document"){
          const row=(await db.query(`SELECT k.id FROM knowledge_documents k`
            +` LEFT JOIN knowledge_publication_bindings binding ON binding.base_id=k.base_id`
            +` WHERE k.id=$1 AND k.created_by=ANY($2::text[]) AND (binding.tenant IS NULL OR binding.tenant=$3)`,
            [item.id,ids,ctx.tenant])).rows[0];
          if(!row)fail(404,"资料不存在或不在当前组织范围");
          if(action==="renew"){
            // knowledge_documents 无 expires_at 列：资料不支持续期（与旧行为一致）。
            fail(400,"非结构化资料不支持设置到期时间");
          }else{
            const frozen=(await db.query(`SELECT 1 FROM knowledge_publication_applications WHERE document_id=$1 AND status='waiting'`,[item.id])).rowCount;
            if(frozen)fail(409,"审批进行中，不能归档");
            await db.query(`UPDATE knowledge_documents SET status='archived',updated_at=$2 WHERE id=$1`,[item.id,stamp]);
          }
        }else{
          await authorizeEntry(db,actor,tenant,item.id);
          if(action==="renew"){
            if(!expiresAt)fail(400,"续期需要 expires_at");
            await db.query(`UPDATE knowledge SET expires_at=$2,updated_at=$3 WHERE id=$1`,[item.id,expiresAt,stamp]);
          }else{
            const row=(await db.query(`SELECT published_version FROM knowledge WHERE id=$1`,[item.id])).rows[0];
            if(!row||row.published_version==null)fail(409,"仅发布过的知识可归档");
            const frozen=(await db.query(`SELECT 1 FROM knowledge_publication_applications WHERE entry_id=$1 AND status='waiting'`,[item.id])).rowCount;
            if(frozen)fail(409,"审批进行中，不能归档");
            await db.query(`UPDATE knowledge SET status='archived',updated_at=$2 WHERE id=$1`,[item.id,stamp]);
          }
        }
        results.push({id:item.id,ok:true});
      }catch(e){results.push({id:item.id,ok:false,error:e instanceof Error?e.message:"操作失败"});}
    }
    return {results};
  });
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
