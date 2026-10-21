import { asyncFlatMap } from "../async-collections.js";
import { knowledgeTaxonomyMutations } from "./knowledge-taxonomy.js";
import { publicationLabels } from "../knowledge-publication/service.js";
import { documentUploadBodyLimit } from "../knowledge/document-upload-limits.js";

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config.js";
import { startDocument, publishedDocumentSourceFile } from "../host/knowledge-documents.js";
import { authDisabled, scopedUser } from "../auth.js";
import { assertRuntimeSkill } from "../runtime/execution.js";
import { hasDocumentTool, documentDependencies } from "../runtime/document-knowledge.js";
import { runtimeKnowledgeManifest,saveScope } from '../knowledge/scopes.js';
import { requireAdmin, requireSkill,isAdmin } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import type {Row} from '../types.js';
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import { effectiveSkillTemplate as skillTemplate } from "../host/skill-sop.js";
import {
  archiveDocument,
  cancelDocument,
  deleteDocument,
  documentIndexHealth,
  documentPreviewFile,
  documentSourceFile,
  getDocumentDetail,
  listDocuments,
  publishDocument,
  reprocessDocument,
  retryDocument,
  searchDocuments,
  uploadDocument,
} from "../host/knowledge-documents.js";
import {
  adminList,
  adminAssets,
  approveKnowledge,
  archiveKnowledge,
  cite,
  composerItems,
  createBase,
  createDomain,
  createKnowledge,
  deprecate,
  favorite,
  listBases,
  listDomains,
  publicKnowledgeTaxonomy,
  deprecateStats,
  mapDeprecateReason,
  editKnowledge,
  extractFromRaw,
  hardDeleteKnowledge,
  knowledgeRow,
  listExtractJobs,
  listMarket,
  listProposals,
  listPublishedForOps,
  listRaw,
  listVersions,
  proposeEvolve,
  publicKnowledge,
  employeeKnowledge,
  questionTemplates,
  reviewProposal,
  reviewQueue,
  storeUploadRaw,
  transferBrand,
  uncite,
  unfavorite,
  deleteBinding,
  getKnowledgeVersion,
  grantsForKnowledge,
  handleFeedback,
  listBindings,
  listFeedback,
  resolvePreview,
  rollbackKnowledge,
  saveBinding,
  setKnowledgeGrants,
  undeprecate,
} from "../host/knowledge.js";
import type { Json } from "../types.js";
import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import { readKnowledgeBusinessTaxonomy } from '../knowledge/business-taxonomy.js';
import { publicationContext, publicationState, bindPublication, preparePublication, checkPublication,
  knowledgeReviewMaterial, knowledgeReviewTrial, retryPublication, publishApprovedDocument, createDocumentRevision,replaceDraftDocument } from "../knowledge/publication.js";

export const knowledge = new Hono();
knowledge.route("/", knowledgeTaxonomyMutations);
knowledge.use("/admin/knowledge/documents", documentUploadBodyLimit);
knowledge.use("/admin/knowledge/documents/:id/draft-file", documentUploadBodyLimit);

knowledge.use("/admin/knowledge/documents/*",async(c,next)=>{
  requireAdmin();
  const id=c.req.path.split("/documents/")[1]?.split("/")[0];
  if(id){
    const bound=(await postgresQuery(`SELECT d.id,b.tenant,p.review_status FROM knowledge_documents d
      LEFT JOIN knowledge_publication_bindings b ON b.base_id=d.base_id
      LEFT JOIN knowledge_publications p ON p.document_id=d.id WHERE d.id=$1`,[id]))[0];
    // A removed resource must retain the existing 404 contract.  Scope is only
    // evaluated after an actual document is found, so a foreign existing record
    // still receives its authorization denial rather than looking deleted.
    if(!bound) throw new HttpFail(404,"资料不存在");
    if(bound.tenant && (await publicationContext(c.req.header("X-Review-Company"))).tenant!==bound.tenant)
      throw new HttpFail(403,"资料不在当前组织范围");
    const native=(await postgresQuery("SELECT 1 FROM knowledge_publication_applications WHERE document_id=$1",[id]))[0];
    if(native && (c.req.method==="DELETE" || c.req.path.endsWith("/reprocess"))) throw new HttpFail(409,"本版本已有审批留痕，请创建新版本草稿");
    if((c.req.method==="DELETE" || c.req.path.endsWith("/reprocess")) && bound.review_status)
      throw new HttpFail(409,{code:"knowledge_document_frozen",message:"本版本已有有效审批，不能删除或重新加工；请创建新版本草稿。"});
  }
  await next();
});

knowledge.post("/approvals/v2/instances/:id/knowledge/trial",async c=>{
  const body=await c.req.json();
  const result=await knowledgeReviewTrial(c.req.param("id"),body.query,(await publicationContext(c.req.header("X-Review-Company"))));
  return c.json(result);
});

knowledge.get("/admin/knowledge/documents/:id/publication", async c =>
  c.json(await publicationState(c.req.param("id"),(await publicationContext(c.req.header("X-Review-Company"))))));
knowledge.put("/admin/knowledge/bases/:id/publication-flow", async c => {
  const b = await c.req.json();
  return c.json(await bindPublication(c.req.param("id"),b.template_id,b.expected_version,(await publicationContext(c.req.header("X-Review-Company")))));
});
knowledge.post("/admin/knowledge/documents/:id/review-check",async c=>{
  const body=await c.req.json();
  return c.json(await checkPublication(c.req.param("id"),body.note,(await publicationContext(c.req.header("X-Review-Company"))),body.values));
});
knowledge.post("/admin/knowledge/documents/:id/review-prepare", async c => {
  const b = await c.req.json();
  return c.json(await preparePublication(c.req.param("id"),b.note,(await publicationContext(c.req.header("X-Review-Company"))),b.values));
});
knowledge.post("/admin/knowledge/documents/:id/publication-retry", async c =>
  c.json(await retryPublication(c.req.param("id"),(await publicationContext(c.req.header("X-Review-Company"))))));
knowledge.post("/admin/knowledge/documents/:id/publication-execute", async c =>
  c.json(await publishApprovedDocument(c.req.param("id"),(await publicationContext(c.req.header("X-Review-Company"))))));
knowledge.post("/admin/knowledge/documents/:id/revision", async c =>
  c.json(await createDocumentRevision(c.req.param("id"),(await publicationContext(c.req.header("X-Review-Company")))),201));
knowledge.put("/admin/knowledge/documents/:id/draft-file",async c=>{
  requireAdmin();const b=await c.req.parseBody(),file=b.file;
  if(!file || typeof file==="string" || Array.isArray(file)) throw new HttpFail(422,"请选择资料原件");
  return c.json(await replaceDraftDocument(c.req.param("id"),{name:file.name,bytes:Buffer.from(await file.arrayBuffer())},String(b.updated_at || ""),(await publicationContext(c.req.header("X-Review-Company")))));
});
knowledge.get("/approvals/v2/instances/:id/knowledge", async c => {
  const {source_path,file_mime,...material} = await knowledgeReviewMaterial(c.req.param("id"),(await publicationContext(c.req.header("X-Review-Company"))));
  return c.json(material);
});
knowledge.get("/approvals/v2/instances/:id/knowledge/file", async c => {
  const material = await knowledgeReviewMaterial(c.req.param("id"),(await publicationContext(c.req.query("company"))));
  const file = path.isAbsolute(material.source_path) ? material.source_path : path.join(dataDir(),material.source_path);
  c.header("Content-Type",material.file_mime); c.header("X-Content-Type-Options","nosniff");
  c.header("Cache-Control","private, no-store"); c.header("Content-Security-Policy","sandbox");
  c.header("Content-Disposition",`inline; filename*=UTF-8''${encodeURIComponent(material.filename)}`);
  return c.body(new Uint8Array(fs.readFileSync(file)));
});

// Skill templates are the knowledge module's read-only projection of published
// manifests, not mail bodies or another independently editable execution source.
knowledge.get("/knowledge/skill-templates", async (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json((await asyncFlatMap((await taskDefinitions()), async (definition) => {
    if (!definition.employee_visible) return [];
    try {
      requireSkill(definition.id);
      return [(await skillTemplate(definition))];
    } catch (error) {
      if (error instanceof HttpFail && error.status === 403) return [];
      throw error;
    }
  })));
});
knowledge.get("/knowledge/skill-templates/:skillId", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const definition = (await taskDefinition(c.req.param("skillId")));
  if (!definition || !definition.employee_visible) throw new HttpFail(404, "skill template not found");
  requireSkill(definition.id);
  return c.json((await skillTemplate(definition)));
});

knowledge.get("/knowledge/composer", async (c) => c.json((await composerItems())));
knowledge.get("/knowledge/market", async (c) => c.json((await listMarket())));
knowledge.get("/knowledge/question-templates", async (c) => c.json((await questionTemplates())));
knowledge.get("/knowledge/taxonomy", async (c) => c.json((await publicKnowledgeTaxonomy())));
knowledge.get("/knowledge/business-taxonomy", async (c) => {
  const includeArchived = c.req.query("admin") === "1";
  if (includeArchived) requireAdmin();
  else if (!scopedUser() && !authDisabled()) throw new HttpFail(401, "authentication required");
  c.header("Cache-Control", "private, no-store");
  return c.json(await postgresTransaction(db => readKnowledgeBusinessTaxonomy(db, { activeOnly: !includeArchived })));
});
knowledge.get("/knowledge/:id/versions", async (c) => c.json((await listVersions(c.req.param("id")))));
knowledge.get("/knowledge/:id", async (c) => {
  const row = (await knowledgeRow(c.req.param("id")));
  if (String(row.status) !== "published") {
    requireAdmin();
  }
  return c.json(isAdmin()?(await publicKnowledge(row)):(await employeeKnowledge(row)));
});
knowledge.get("/knowledge", async (c) => {
  const num = (value: string | undefined): number | undefined => {
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return c.json((await listPublishedForOps({
    q: c.req.query("q"),
    kind: c.req.query("kind"),
    stage: c.req.query("stage"),
    brand: c.req.query("brand"),
    base: c.req.query("base"),
    domain: c.req.query("domain"),
    family: c.req.query("family"),
    limit: num(c.req.query("limit")),
    offset: num(c.req.query("offset")),
  })));
});

knowledge.post("/knowledge/:id/cite", async (c) => c.json((await cite(c.req.param("id")))));
knowledge.delete("/knowledge/:id/cite", async (c) => c.json((await uncite(c.req.param("id")))));
knowledge.post("/knowledge/:id/favorite", async (c) => c.json((await favorite(c.req.param("id")))));
knowledge.delete("/knowledge/:id/favorite", async (c) => c.json((await unfavorite(c.req.param("id")))));
knowledge.post("/knowledge/:id/deprecate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  return c.json((await deprecate(
    c.req.param("id"),
    mapDeprecateReason(String(body.reason || "")),
    String(body.note || body.reason_note || ""),
  )));
});
knowledge.delete("/knowledge/:id/deprecate", async (c) => c.json((await undeprecate(c.req.param("id")))));

knowledge.get("/admin/knowledge/raw", async (c) => c.json((await listRaw())));
knowledge.get("/admin/knowledge/extract-jobs", async (c) => c.json((await listExtractJobs())));
knowledge.get("/admin/knowledge/review", async (c) => c.json(await reviewQueue()));
knowledge.get("/admin/knowledge/deprecate-stats", async (c) => c.json((await deprecateStats())));
knowledge.get("/admin/knowledge/proposals", async (c) => c.json((await listProposals())));

// 知识分层（主题域族 → 主题域 → 知识库）；分类只做业务归类，不承载权限。
knowledge.get("/admin/knowledge/domains", async (c) => c.json({ domains: (await listDomains()) }));
knowledge.post("/admin/knowledge/domains", async (c) => c.json((await createDomain((await c.req.json()) as Json)), 201));
knowledge.get("/admin/knowledge/bases", async (c) => c.json({
  bases: await listBases({ domain_id: c.req.query("domain_id"), kind: c.req.query("kind") }),
}));
knowledge.post("/admin/knowledge/bases", async (c) => c.json((await createBase((await c.req.json()) as Json)), 201));

// 非结构化资料（P1，2026-10-02）：上传 → 规整 → 索引 → 待审 → 发布 → 试算。
// 设计 docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md §10。
knowledge.get("/admin/knowledge/documents", async (c) => {
  const documents=(await listDocuments({ base: c.req.query("base"), status: c.req.query("status") }));
  const user=scopedUser();
  const labels=process.env.DATABASE_URL && user ? await publicationLabels(user.id) : new Map<string,string>();
  return c.json({documents:documents.map(document=>({...document,publication_label:document.status==='pending_review'?(labels.get(String(document.id)) || '解析完成 · 待提交审批'):undefined}))});
});
knowledge.post("/admin/knowledge/documents", async (c) => {
  requireAdmin();
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string" || Array.isArray(file)) throw new HttpFail(400, "file required");
  const baseId = String(body.base_id || "");
  const ctx = (await publicationContext(c.req.header("X-Review-Company")));
  // Bases do not have separate personnel grants. Reuse existing organization
  // evidence from their publication binding/scopes before saving any new bytes.
  const tenants = await postgresQuery(`SELECT tenant FROM knowledge_publication_bindings WHERE base_id=$1
    UNION SELECT s.tenant FROM knowledge_document_scopes s JOIN knowledge_documents d ON d.id=s.document_id WHERE d.base_id=$1
    UNION SELECT p.tenant FROM knowledge_publication_applications p JOIN knowledge_documents d ON d.id=p.document_id WHERE d.base_id=$1`, [baseId]);
  if (tenants.some(row => row.tenant !== ctx.tenant)) {
    throw new HttpFail(403, { code: "knowledge_base_scope_forbidden", message: "知识库不在当前组织范围" });
  }
  const scopeFlow = body.scope_flow === "true";
  const explanation = String(body.explanation || "").trim();
  if (scopeFlow && explanation.length > 4000) throw new HttpFail(422, { code: "knowledge_scope_invalid", message: "资料用途解释最多 4000 字" });
  const buf = Buffer.from(await (file as File).arrayBuffer());
  const result=(await uploadDocument(
    { name: (file as File).name || "upload.pdf", type: (file as File).type || "", buf },
    baseId,
    undefined,
    { draft: body.draft === "true" },
  ));
  // Explicit use of the new scope flow; older upload clients keep their existing contract.
  if(scopeFlow)await saveScope(ctx.actor,ctx.tenant,String((result.document as Row).id),{expectedRevision:0,explanation});
  return c.json(result,201);
});
knowledge.get("/admin/knowledge/documents/:id", async (c) => c.json((await getDocumentDetail(c.req.param("id")))));
knowledge.get("/admin/knowledge/documents/:id/preview", async (c) => {
  const ref = (await documentPreviewFile(c.req.param("id")));
  c.header("Content-Type", ref.mime);
  c.header("Cache-Control", "private, no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(ref.name)}`);
  return c.body(new Uint8Array(fs.readFileSync(ref.path)));
});
knowledge.get("/admin/knowledge/documents/:id/file", async (c) => {
  const ref = (await documentSourceFile(c.req.param("id")));
  c.header("Content-Type", ref.mime || "application/pdf");
  c.header("Content-Disposition", `${ref.mime.includes("presentationml") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(ref.name)}`);
  return c.body(new Uint8Array(fs.readFileSync(ref.path)));
});
knowledge.get("/knowledge/documents/:id/file", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const skillId = String(c.req.query("skill_id") || "");
  (await assertRuntimeSkill({ agentId: String(c.req.query("agent_id") || ""), skillId, userId: user.id, runId: "document-source" }));
  if (!(await hasDocumentTool(skillId))) throw new HttpFail(403, "文档查询技能未启用");
  const manifest=await runtimeKnowledgeManifest(skillId,user.id);
  if(!manifest.bases.some(base=>base.documents.some(doc=>doc.id===c.req.param('id')))) throw new HttpFail(403,'资料不在当前技能的有效版本范围内');
  const ref = (await publishedDocumentSourceFile(c.req.param("id"), (await documentDependencies(skillId)).map((base) => String(base.id))));
  c.header("Content-Type", "application/pdf");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, no-store");
  c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(ref.name)}`);
  return c.body(new Uint8Array(fs.readFileSync(ref.path)));
});
knowledge.post("/admin/knowledge/documents/:id/retry", async (c) => c.json((await retryDocument(c.req.param("id")))));
knowledge.post("/admin/knowledge/documents/:id/start", async (c) => c.json((await startDocument(c.req.param("id")))));
knowledge.post("/admin/knowledge/documents/:id/cancel", async (c) => c.json((await cancelDocument(c.req.param("id")))));
knowledge.post("/admin/knowledge/documents/:id/reprocess", async (c) => c.json((await reprocessDocument(c.req.param("id")))));
knowledge.post("/admin/knowledge/documents/:id/publish", async (c) => c.json((await publishDocument(c.req.param("id")))));
knowledge.post("/admin/knowledge/documents/:id/archive", async (c) => c.json((await archiveDocument(c.req.param("id")))));
knowledge.delete("/admin/knowledge/documents/:id", async (c) => {
  requireAdmin();
  if (process.env.DATABASE_URL && (await postgresQuery("SELECT instance_id FROM knowledge_publications WHERE document_id=$1 UNION ALL SELECT instance_id FROM knowledge_publication_applications WHERE document_id=$1 LIMIT 1", [c.req.param("id")])).length) {
    throw new HttpFail(409, "该资料已有审批留痕，请归档并保留审批原件与记录");
  }
  return c.json((await deleteDocument(c.req.param("id"))));
});
knowledge.post("/admin/knowledge/search", async (c) => {
  const result=await searchDocuments((await c.req.json()) as Json);
  return c.json(result);
});
knowledge.get("/admin/knowledge/index-health", async (c) => c.json(await documentIndexHealth()));

knowledge.get("/admin/knowledge", async (c) => {
  const num = (value: string | undefined): number | undefined => {
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return c.json((await adminList({
    q: c.req.query("q"),
    kind: c.req.query("kind"),
    status: c.req.query("status"),
    base: c.req.query("base"),
    domain: c.req.query("domain"),
    family: c.req.query("family"),
    limit: num(c.req.query("limit")),
    offset: num(c.req.query("offset")),
  })));
});
knowledge.get("/admin/knowledge/assets", async (c) => c.json((await adminAssets())));
knowledge.get("/admin/knowledge/feedback", async (c) => c.json((await listFeedback())));
knowledge.get("/admin/knowledge/bindings", async (c) => c.json(await listBindings()));
knowledge.post("/admin/knowledge/bindings", async (c) => c.json(await saveBinding((await c.req.json()) as Json)));
knowledge.patch("/admin/knowledge/bindings/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  return c.json(await saveBinding({ ...body, id: c.req.param("id") }));
});
knowledge.delete("/admin/knowledge/bindings/:id", async (c) => c.json(await deleteBinding(c.req.param("id"))));
knowledge.post("/admin/knowledge/resolve-preview", async (c) => c.json((await resolvePreview((await c.req.json()) as Json))));
knowledge.get("/admin/knowledge/:id/versions/:v", async (c) => c.json((await getKnowledgeVersion(c.req.param("id"), Number(c.req.param("v"))))));
knowledge.get("/admin/knowledge/:id/grants", async (c) => c.json((await grantsForKnowledge(c.req.param("id")))));
knowledge.put("/admin/knowledge/:id/grants", async (c) => c.json((await setKnowledgeGrants(c.req.param("id"), (await c.req.json()) as Json))));
knowledge.post("/admin/knowledge/:id/rollback", async (c) => {
  const body = (await c.req.json()) as { version?: number };
  return c.json((await rollbackKnowledge(c.req.param("id"), Number(body.version))));
});
knowledge.post("/admin/knowledge/:id/feedback-handle", async (c) => {
  const body = (await c.req.json()) as { user_id?: string; action?: string; note?: string };
  return c.json((await handleFeedback(
    c.req.param("id"),
    String(body.user_id || ""),
    String(body.action || "") as "to_revision" | "archive" | "ignore",
    String(body.note || ""),
  )));
});

knowledge.post("/admin/knowledge/upload", async (c) => {
  requireAdmin();
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") throw new HttpFail(400, "file required");
  const buf = Buffer.from(await (file as File).arrayBuffer());
  return c.json(await storeUploadRaw({
    name: (file as File).name || "upload.bin",
    type: (file as File).type || "application/octet-stream",
    buf,
  }));
});
knowledge.post("/admin/knowledge/extract/:raw_id", async (c) => c.json((await extractFromRaw(c.req.param("raw_id")))));
knowledge.post("/admin/knowledge/evolve/propose", async (c) => {
  const body = (await c.req.json()) as Json;
  return c.json((await proposeEvolve(body)));
});
knowledge.post("/admin/knowledge/evolve/:id/review", async (c) => {
  const body = (await c.req.json()) as { action?: string; reject_reason?: string };
  const action = body.action === "reject" ? "reject" : "approve";
  return c.json((await reviewProposal(c.req.param("id"), action, String(body.reject_reason || ""))));
});
knowledge.post("/admin/knowledge/:id/transfer", async (c) => {
  const body = (await c.req.json()) as { to_brand?: string };
  return c.json(await transferBrand(c.req.param("id"), String(body.to_brand || "")));
});
knowledge.post("/admin/knowledge/:id/approve", () => { throw new HttpFail(409,"请从当前知识提交审批，审批通过后独立发布"); });
knowledge.post("/admin/knowledge/:id/archive", async (c) => c.json((await archiveKnowledge(c.req.param("id")))));
knowledge.post("/admin/knowledge", async (c) => { const b=await c.req.json(); if(b.status && b.status!=="draft") throw new HttpFail(422,"新建只能保存草稿"); return c.json((await createKnowledge({...b,status:"draft"})),201); });
knowledge.put("/admin/knowledge/:id", async (c) => c.json((await editKnowledge(c.req.param("id"), (await c.req.json()) as { title: string; body: string }))));
knowledge.delete("/admin/knowledge/:id", async (c) => c.json((await hardDeleteKnowledge(c.req.param("id")))));
