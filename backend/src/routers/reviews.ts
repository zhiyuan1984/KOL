import { postgresTransaction } from "../postgres/pool.js";
import { postgresReviewCompanies, postgresReviewContext } from "../approval/review-postgres-access.js";
import { PostgresReviewService } from "../approval/review-postgres-service.js";
import { publicationProjection } from "../knowledge-publication/service.js";
import { reviewIntake } from "../approval/review-rollout.js";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { ensureOrganizationTree } from "../runtime/organization-tree.js";
import { guardKnowledgeReview } from "../knowledge/publication.js";
import { reviewStarters } from "../approval/review-starters.js";

export const reviews = new Hono();
reviews.use("/approvals/v2/*", async (_c,next)=>{ await ensureOrganizationTree(); await next(); });
reviews.use("/admin/approval-types/v2/*", async (_c,next)=>{ await ensureOrganizationTree(); await next(); });

async function body(c:{req:{text:()=>Promise<string>}}){const raw=await c.req.text();if(raw.length>250000)throw new HttpFail(413,"评审请求过大");try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error();return parsed;}catch{throw new HttpFail(400,"无效 JSON 对象");}}
async function native<T>(tenant:string|undefined,action:(service:PostgresReviewService)=>Promise<T>|T):Promise<T>{const user=scopedUser();if(!user)throw new HttpFail(401,"请登录后使用通用评审");return postgresTransaction(async db=>(action(new PostgresReviewService(db,await postgresReviewContext(db,user.id,tenant)))));}
async function nativeWithContext<T>(tenant:string|undefined,action:(service:PostgresReviewService)=>Promise<T>|T):Promise<T>{return native(tenant,action);}
function retryable(error:unknown){const code=(error as {code?:string}).code;return ["40001","40P01","23505"].includes(code||"");}
async function mutation<T>(tenant:string|undefined,action:(service:PostgresReviewService)=>Promise<T>):Promise<T>{for(let attempt=0;attempt<3;attempt++){try{return native(tenant,action);}catch(error){if((error as Error).message?.startsWith("knowledge_")&&(error as {code?:string}).code==="23514")throw new HttpFail(409,{code:(error as Error).message,message:"知识资料、流程绑定或审批状态已变化，请返回资料详情重新检查。"});if(!retryable(error)||attempt===2)throw error;}}throw new HttpFail(409,"评审状态正在变化，请重试原操作以查询幂等回执");}
const tenant=(c:any)=>c.req.header("X-Review-Company")||undefined;

reviews.get("/approvals/v2/instance-page",async c=>c.json(await native(tenant(c),async s=>(s.instancePage({cursor:c.req.query("cursor"),q:c.req.query("q"),filter:c.req.query("filter"),limit:c.req.query("limit")?Number(c.req.query("limit")):undefined})))));
reviews.get("/approvals/v2/drafts/:id/upgrade",async c=>c.json(await native(tenant(c),async s=>(s.draftUpgrade(c.req.param("id"))))));
reviews.post("/approvals/v2/drafts/:id/upgrade",async c=>{const b=await body(c);return c.json(await mutation(tenant(c),async s=>(s.upgradeDraft(c.req.param("id"),b.expectedVersion,b.targetVersion))));});
reviews.get("/admin/approval-types/v2/templates/:id/diff",async c=>c.json(await native(tenant(c),async s=>(s.publishDiff(c.req.param("id"))))));
reviews.post("/approvals/v2/attachments",bodyLimit({maxSize:3*1024*1024}),async c=>{const b=await c.req.parseBody(),file=b.file;if(!file||typeof file==="string"||Array.isArray(file))throw new HttpFail(422,"请选择文件");const bytes=Buffer.from(await file.arrayBuffer());return c.json(await mutation(tenant(c),async s=>(s.uploadAttachment(file.name,bytes))));});
reviews.get("/approvals/v2/attachments/:id",async c=>{const a=await native(tenant(c)||c.req.query("company"),async s=>(s.attachment(c.req.param("id"),c.req.query("instanceId"))));if(c.req.query("metadata")==="1")return c.json({id:a.id,name:a.name,size:a.size,sha256:a.sha256});c.header("Content-Type","application/octet-stream");c.header("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`);c.header("X-Content-Type-Options","nosniff");c.header("Cache-Control","no-store");c.header("Content-Security-Policy","sandbox");return c.body(new Uint8Array(a.content));});
reviews.get("/approvals/v2/companies",async c=>{const actor=scopedUser();if(!actor)throw new HttpFail(401,"请登录");return c.json(await postgresTransaction(async db=>(postgresReviewCompanies(db,actor.id))));});
reviews.get("/approvals/v2/drafts",async c=>c.json(await native(tenant(c),async s=>(s.drafts()))));
reviews.post("/approvals/v2/drafts",async c=>{const b=await body(c);return c.json(await mutation(tenant(c),async s=>(s.saveDraft(b))));});
reviews.get("/approvals/v2/context",async c=>{const result=await native(tenant(c),s=>s.ctx);return c.json({...result,intake:reviewIntake(result.tenant),capabilities:{fields:["text","textarea","number","decimal","money","date","select","multiselect","attachment"],nodes:["start","review","condition","end","cc","consult","handler"],modes:["single","all","any","sequential"],assignees:["named","manager","role","requester_choice"],externalExecution:false,attachments:true,timeoutEscalation:true,transfer:true,countersign:true,amendments:true,notifications:"in_app",conditionGroups:["all","any","not"],templateLifecycle:true}});});
reviews.get("/approvals/v2/templates",async c=>c.json(await native(tenant(c),async s=>(s.templates()))));
reviews.get("/approvals/v2/source/collaboration/:id",async c=>c.json(await native(tenant(c),async s=>(s.collaborationSource(c.req.param("id"))))));
reviews.post("/approvals/v2/preview",async c=>{const b=await body(c);return c.json(await nativeWithContext(tenant(c),async s=>{await guardKnowledgeReview(b,s.ctx);return s.submissionPreview(b);}));});
reviews.post("/admin/approval-types/v2/choice-options",async c=>{const b=await body(c);return c.json(await native(tenant(c),s=>s.simulationCandidates(b.definition,b.requester)));});
reviews.get("/approvals/v2/instances",async c=>c.json((await native(tenant(c),async s=>(await s.instances()).map(i=>s.project(i))))));
reviews.get("/approvals/v2/instances/:id",async c=>c.json(await native(tenant(c),async s=>{const i=await s.instance(c.req.param("id"));return {...s.project(i),knowledgePublication:await publicationProjection((s as any).db,s.ctx.tenant,i.id),events:await s.events(i.id),revisions:await s.revisions(i.id)};})));
reviews.get("/approvals/v2/notifications",async c=>c.json(await native(tenant(c),async s=>(s.notifications()))));
reviews.get("/approvals/v2/notifications/inbox",async c=>c.json(await native(tenant(c),async s=>(s.notificationInbox()))));
reviews.post("/approvals/v2/notifications/:id/read",async c=>c.json(await mutation(tenant(c),async s=>(s.readNotification(c.req.param("id"))))));
reviews.post("/approvals/v2/prepare",async c=>{const b=await body(c);const prepared=await mutation(tenant(c),async s=>{await guardKnowledgeReview(b,s.ctx);return s.prepare(b);});if(typeof b.instanceId==="string")await native(tenant(c),async s=>{const i=await s.instance(b.instanceId);if(i.definition.subjectType==="knowledge_publication")prepared.summary.consequence+=" 本申请属于知识发布审批：流程通过后，服务端核对冻结材料与当前授权并自动发布本次资料版本。";});return c.json(prepared);});
reviews.post("/approvals/v2/commands",async c=>{const b=await body(c);return c.json(await mutation(tenant(c),async s=>{await guardKnowledgeReview(b.command,s.ctx);return s.execute(b.command,b.confirmationId,b.idempotencyKey);}));});
reviews.get("/admin/approval-types/v2/templates",async c=>c.json(await native(tenant(c),async s=>(s.templates(true)))));
reviews.get("/admin/approval-types/v2/starters",async c=>{await native(tenant(c),async s=>(s.templates(true)));return c.json(reviewStarters());});
reviews.post("/admin/approval-types/v2/templates/:id/copy",async c=>{const b=await body(c);if(typeof b.creationKey!=="string")throw new HttpFail(422,"缺少复制请求标识");return c.json(await mutation(tenant(c),async s=>(s.copyTemplate(c.req.param("id"),b.expectedVersion,b.source,b.creationKey))));});
reviews.post("/admin/approval-types/v2/templates",async c=>{const b=await body(c);return c.json(await mutation(tenant(c),async s=>(s.saveTemplate(undefined,undefined,b.definition,b.creationKey))));});
reviews.put("/admin/approval-types/v2/templates/:id",async c=>{const b=await body(c);return c.json(await mutation(tenant(c),async s=>(s.saveTemplate(c.req.param("id"),b.expectedVersion,b.definition))));});
reviews.post("/admin/approval-types/v2/validate",async c=>{const b=await body(c);return c.json(await native(tenant(c),async s=>{(await s.templates(true));return {issues:s.configurationIssues(b.definition)};}));});
reviews.post("/admin/approval-types/v2/simulate",async c=>{const b=await body(c);return c.json(await native(tenant(c),s=>s.simulate(b.definition,b.values,b.requester,b.selectedApprovers)));});
