import { publicationLabels } from "../knowledge-publication/service.js";

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config.js";
import { startDocument, publishedDocumentSourceFile } from "../host/knowledge-documents.js";
import { maintainAdminQaContext } from "../host/knowledge-qa.js";
import { scopedUser } from "../auth.js";
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
  editBase,
  editDomain,
  listBases,
  listDomains,
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
import { postgresQuery } from "../postgres/pool.js";
import { publicationContext, publicationState, bindPublication, preparePublication, checkPublication,
  knowledgeReviewMaterial, knowledgeReviewTrial, retryPublication, publishApprovedDocument, createDocumentRevision,replaceDraftDocument } from "../knowledge/publication.js";

export const knowledge = new Hono();

knowledge.use("/admin/knowledge/documents/*",async(c,next)=>{
  requireAdmin();
  const id=c.req.path.split("/documents/")[1]?.split("/")[0];
  if(id){
    const bound=(await postgresQuery(`SELECT b.tenant,p.review_status FROM knowledge_documents d
      LEFT JOIN knowledge_publication_bindings b ON b.base_id=d.base_id
      LEFT JOIN knowledge_publications p ON p.document_id=d.id WHERE d.id=$1`,[id]))[0];
    if(bound?.tenant && publicationContext(c.req.header("X-Review-Company")).tenant!==bound.tenant)
      throw new HttpFail(404,"资料不存在或不在当前组织范围");
    const native=(await postgresQuery("SELECT 1 FROM knowledge_publication_applications WHERE document_id=$1",[id]))[0];
    if(native && (c.req.method==="DELETE" || c.req.path.endsWith("/reprocess"))) throw new HttpFail(409,"本版本已有审批留痕，请创建新版本草稿");
    if((c.req.method==="DELETE" || c.req.path.endsWith("/reprocess")) && bound?.review_status)
      throw new HttpFail(409,{code:"knowledge_document_frozen",message:"本版本已有有效审批，不能删除或重新加工；请创建新版本草稿。"});
  }
  await next();
});

knowledge.post("/approvals/v2/instances/:id/knowledge/trial",async c=>{
  const body=await c.req.json();
  return c.json(await knowledgeReviewTrial(c.req.param("id"),body.query,publicationContext(c.req.header("X-Review-Company"))));
});

knowledge.get("/admin/knowledge/documents/:id/publication", async c =>
  c.json(await publicationState(c.req.param("id"),publicationContext(c.req.header("X-Review-Company")))));
knowledge.put("/admin/knowledge/bases/:id/publication-flow", async c => {
  const b = await c.req.json();
  return c.json(await bindPublication(c.req.param("id"),b.template_id,b.expected_version,publicationContext(c.req.header("X-Review-Company"))));
});
knowledge.post("/admin/knowledge/documents/:id/review-check",async c=>{
  const body=await c.req.json();
  return c.json(await checkPublication(c.req.param("id"),body.note,publicationContext(c.req.header("X-Review-Company")),body.values));
});
knowledge.post("/admin/knowledge/documents/:id/review-prepare", async c => {
  const b = await c.req.json();
  return c.json(await preparePublication(c.req.param("id"),b.note,publicationContext(c.req.header("X-Review-Company")),b.values));
});
knowledge.post("/admin/knowledge/documents/:id/publication-retry", async c =>
  c.json(await retryPublication(c.req.param("id"),publicationContext(c.req.header("X-Review-Company")))));
knowledge.post("/admin/knowledge/documents/:id/publication-execute", async c =>
  c.json(await publishApprovedDocument(c.req.param("id"),publicationContext(c.req.header("X-Review-Company")))));
knowledge.post("/admin/knowledge/documents/:id/revision", async c =>
  c.json(await createDocumentRevision(c.req.param("id"),publicationContext(c.req.header("X-Review-Company"))),201));
knowledge.put("/admin/knowledge/documents/:id/draft-file",async c=>{
  requireAdmin();const b=await c.req.parseBody(),file=b.file;
  if(!file || typeof file==="string" || Array.isArray(file)) throw new HttpFail(422,"请选择PDF原件");
  return c.json(await replaceDraftDocument(c.req.param("id"),{name:file.name,bytes:Buffer.from(await file.arrayBuffer())},String(b.updated_at || ""),publicationContext(c.req.header("X-Review-Company"))));
});
knowledge.get("/approvals/v2/instances/:id/knowledge", async c => {
  const {source_path,...material} = await knowledgeReviewMaterial(c.req.param("id"),publicationContext(c.req.header("X-Review-Company")));
  return c.json(material);
});
knowledge.get("/approvals/v2/instances/:id/knowledge/file", async c => {
  const material = await knowledgeReviewMaterial(c.req.param("id"),publicationContext(c.req.query("company")));
  const file = path.isAbsolute(material.source_path) ? material.source_path : path.join(dataDir(),material.source_path);
  c.header("Content-Type","application/pdf"); c.header("X-Content-Type-Options","nosniff");
  c.header("Cache-Control","private, no-store");
  return c.body(new Uint8Array(fs.readFileSync(file)));
});

// Skill templates are the knowledge module's read-only projection of published
// manifests, not mail bodies or another independently editable execution source.
knowledge.get("/knowledge/skill-templates", (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json(taskDefinitions().flatMap((definition) => {
    if (!definition.employee_visible) return [];
    try {
      requireSkill(definition.id);
      return [skillTemplate(definition)];
    } catch (error) {
      if (error instanceof HttpFail && error.status === 403) return [];
      throw error;
    }
  }));
});
knowledge.get("/knowledge/skill-templates/:skillId", (c) => {
  c.header("Cache-Control", "private, no-store");
  const definition = taskDefinition(c.req.param("skillId"));
  if (!definition || !definition.employee_visible) throw new HttpFail(404, "skill template not found");
  requireSkill(definition.id);
  return c.json(skillTemplate(definition));
});

knowledge.get("/knowledge/composer", (c) => c.json(composerItems()));
knowledge.get("/knowledge/market", (c) => c.json(listMarket()));
knowledge.get("/knowledge/question-templates", (c) => c.json(questionTemplates()));
knowledge.get("/knowledge/:id/versions", (c) => c.json(listVersions(c.req.param("id"))));
knowledge.get("/knowledge/:id", (c) => {
  const row = knowledgeRow(c.req.param("id"));
  if (String(row.status) !== "published") {
    requireAdmin();
  }
  return c.json(isAdmin()?publicKnowledge(row):employeeKnowledge(row));
});
knowledge.get("/knowledge", (c) => {
  const num = (value: string | undefined): number | undefined => {
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return c.json(listPublishedForOps({
    q: c.req.query("q"),
    kind: c.req.query("kind"),
    stage: c.req.query("stage"),
    brand: c.req.query("brand"),
    base: c.req.query("base"),
    domain: c.req.query("domain"),
    family: c.req.query("family"),
    limit: num(c.req.query("limit")),
    offset: num(c.req.query("offset")),
  }));
});

knowledge.post("/knowledge/:id/cite", (c) => c.json(cite(c.req.param("id"))));
knowledge.delete("/knowledge/:id/cite", (c) => c.json(uncite(c.req.param("id"))));
knowledge.post("/knowledge/:id/favorite", (c) => c.json(favorite(c.req.param("id"))));
knowledge.delete("/knowledge/:id/favorite", (c) => c.json(unfavorite(c.req.param("id"))));
knowledge.post("/knowledge/:id/deprecate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  return c.json(deprecate(
    c.req.param("id"),
    mapDeprecateReason(String(body.reason || "")),
    String(body.note || body.reason_note || ""),
  ));
});
knowledge.delete("/knowledge/:id/deprecate", (c) => c.json(undeprecate(c.req.param("id"))));

knowledge.get("/admin/knowledge/raw", (c) => c.json(listRaw()));
knowledge.get("/admin/knowledge/extract-jobs", (c) => c.json(listExtractJobs()));
knowledge.get("/admin/knowledge/review", (c) => c.json(reviewQueue()));
knowledge.get("/admin/knowledge/deprecate-stats", (c) => c.json(deprecateStats()));
knowledge.get("/admin/knowledge/proposals", (c) => c.json(listProposals()));

// 知识分层（主题域族 → 主题域 → 知识库）；分类只做业务归类，不承载权限。
knowledge.get("/admin/knowledge/domains", (c) => c.json({ domains: listDomains() }));
knowledge.post("/admin/knowledge/domains", async (c) => c.json(createDomain((await c.req.json()) as Json), 201));
knowledge.put("/admin/knowledge/domains/:id", async (c) => c.json(editDomain(c.req.param("id"), (await c.req.json()) as Json)));
knowledge.get("/admin/knowledge/bases", (c) => c.json({
  bases: listBases({ domain_id: c.req.query("domain_id"), kind: c.req.query("kind") }),
}));
knowledge.post("/admin/knowledge/bases", async (c) => c.json(createBase((await c.req.json()) as Json), 201));
knowledge.put("/admin/knowledge/bases/:id", async (c) => c.json(editBase(c.req.param("id"), (await c.req.json()) as Json)));

// 非结构化资料（P1，2026-10-02）：上传 → 规整 → 索引 → 待审 → 发布 → 试算。
// 设计 docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md §10。
knowledge.get("/admin/knowledge/documents", async (c) => {
  const documents=listDocuments({ base: c.req.query("base"), status: c.req.query("status") });
  const user=scopedUser();
  const labels=process.env.DATABASE_URL && user ? await publicationLabels(user.id) : new Map<string,string>();
  return c.json({documents:documents.map(document=>({...document,publication_label:document.status==='pending_review'?(labels.get(String(document.id)) || '解析完成 · 待提交审批'):undefined}))});
});
knowledge.post("/admin/knowledge/documents", async (c) => {
  requireAdmin();
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") throw new HttpFail(400, "file required");
  const buf = Buffer.from(await (file as File).arrayBuffer());
  const result=uploadDocument(
    { name: (file as File).name || "upload.pdf", type: (file as File).type || "", buf },
    String(body.base_id || ""),
    undefined,
    { draft: body.draft === "true" },
  );
  // Explicit use of the new scope flow; older upload clients keep their existing contract.
  if(body.scope_flow==='true')await saveScope(scopedUser()!.id,c.req.header('X-Review-Company'),String((result.document as Row).id),{expectedRevision:0,explanation:String(body.explanation || '')});
  return c.json(result,201);
});
knowledge.get("/admin/knowledge/documents/:id", (c) => c.json(getDocumentDetail(c.req.param("id"))));
knowledge.get("/admin/knowledge/documents/:id/file", (c) => {
  const ref = documentSourceFile(c.req.param("id"));
  c.header("Content-Type", ref.mime || "application/pdf");
  c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(ref.name)}`);
  return c.body(new Uint8Array(fs.readFileSync(ref.path)));
});
knowledge.get("/knowledge/documents/:id/file", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const skillId = String(c.req.query("skill_id") || "");
  assertRuntimeSkill({ agentId: String(c.req.query("agent_id") || ""), skillId, userId: user.id, runId: "document-source" });
  if (!hasDocumentTool(skillId)) throw new HttpFail(403, "文档查询技能未启用");
  const manifest=await runtimeKnowledgeManifest(skillId,user.id);
  if(!manifest.bases.some(base=>base.documents.some(doc=>doc.id===c.req.param('id')))) throw new HttpFail(403,'资料不在当前技能的有效版本范围内');
  const ref = publishedDocumentSourceFile(c.req.param("id"), documentDependencies(skillId).map((base) => String(base.id)));
  c.header("Content-Type", "application/pdf");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, no-store");
  c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(ref.name)}`);
  return c.body(new Uint8Array(fs.readFileSync(ref.path)));
});
knowledge.post("/admin/knowledge/documents/:id/retry", (c) => c.json(retryDocument(c.req.param("id"))));
knowledge.post("/admin/knowledge/documents/:id/start", (c) => c.json(startDocument(c.req.param("id"))));
knowledge.post("/admin/knowledge/documents/:id/cancel", (c) => c.json(cancelDocument(c.req.param("id"))));
knowledge.post("/admin/knowledge/documents/:id/reprocess", (c) => c.json(reprocessDocument(c.req.param("id"))));
knowledge.post("/admin/knowledge/documents/:id/publish", (c) => c.json(publishDocument(c.req.param("id"))));
knowledge.post("/admin/knowledge/documents/:id/archive", (c) => c.json(archiveDocument(c.req.param("id"))));
knowledge.delete("/admin/knowledge/documents/:id", async (c) => {
  requireAdmin();
  if (process.env.DATABASE_URL && (await postgresQuery("SELECT instance_id FROM knowledge_publications WHERE document_id=$1 UNION ALL SELECT instance_id FROM knowledge_publication_applications WHERE document_id=$1 LIMIT 1", [c.req.param("id")])).length) {
    throw new HttpFail(409, "该资料已有审批留痕，请归档并保留审批原件与记录");
  }
  return c.json(deleteDocument(c.req.param("id")));
});
knowledge.post("/admin/knowledge/search", async (c) => {
  requireAdmin();
  const body = await c.req.json().catch(() => { throw new HttpFail(400, "试算请求必须是有效 JSON"); });
  return c.json(await searchDocuments(body as Json, c.req.header("X-Review-Company")));
});
knowledge.post("/admin/knowledge/qa-context", async (c) => {
  requireAdmin();
  c.header("Cache-Control", "private, no-store");
  const body = await c.req.json().catch(() => { throw new HttpFail(400, "上下文维护请求必须是有效 JSON"); });
  return c.json(await maintainAdminQaContext(body, c.req.header("X-Review-Company")));
});
knowledge.get("/admin/knowledge/index-health", async (c) => c.json(await documentIndexHealth()));

knowledge.get("/admin/knowledge", (c) => {
  const num = (value: string | undefined): number | undefined => {
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return c.json(adminList({
    q: c.req.query("q"),
    kind: c.req.query("kind"),
    status: c.req.query("status"),
    base: c.req.query("base"),
    domain: c.req.query("domain"),
    family: c.req.query("family"),
    limit: num(c.req.query("limit")),
    offset: num(c.req.query("offset")),
  }));
});
knowledge.get("/admin/knowledge/assets", (c) => c.json(adminAssets()));
knowledge.get("/admin/knowledge/feedback", (c) => c.json(listFeedback()));
knowledge.get("/admin/knowledge/bindings", (c) => c.json(listBindings()));
knowledge.post("/admin/knowledge/bindings", async (c) => c.json(saveBinding((await c.req.json()) as Json)));
knowledge.patch("/admin/knowledge/bindings/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  return c.json(saveBinding({ ...body, id: c.req.param("id") }));
});
knowledge.delete("/admin/knowledge/bindings/:id", (c) => c.json(deleteBinding(c.req.param("id"))));
knowledge.post("/admin/knowledge/resolve-preview", async (c) => c.json(resolvePreview((await c.req.json()) as Json)));
knowledge.get("/admin/knowledge/:id/versions/:v", (c) => c.json(getKnowledgeVersion(c.req.param("id"), Number(c.req.param("v")))));
knowledge.get("/admin/knowledge/:id/grants", (c) => c.json(grantsForKnowledge(c.req.param("id"))));
knowledge.put("/admin/knowledge/:id/grants", async (c) => c.json(setKnowledgeGrants(c.req.param("id"), (await c.req.json()) as Json)));
knowledge.post("/admin/knowledge/:id/rollback", async (c) => {
  const body = (await c.req.json()) as { version?: number };
  return c.json(rollbackKnowledge(c.req.param("id"), Number(body.version)));
});
knowledge.post("/admin/knowledge/:id/feedback-handle", async (c) => {
  const body = (await c.req.json()) as { user_id?: string; action?: string; note?: string };
  return c.json(handleFeedback(
    c.req.param("id"),
    String(body.user_id || ""),
    String(body.action || "") as "to_revision" | "archive" | "ignore",
    String(body.note || ""),
  ));
});

knowledge.post("/admin/knowledge/upload", async (c) => {
  requireAdmin();
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") throw new HttpFail(400, "file required");
  const buf = Buffer.from(await (file as File).arrayBuffer());
  return c.json(storeUploadRaw({
    name: (file as File).name || "upload.bin",
    type: (file as File).type || "application/octet-stream",
    buf,
  }));
});
knowledge.post("/admin/knowledge/extract/:raw_id", (c) => c.json(extractFromRaw(c.req.param("raw_id"))));
knowledge.post("/admin/knowledge/evolve/propose", async (c) => {
  const body = (await c.req.json()) as Json;
  return c.json(proposeEvolve(body));
});
knowledge.post("/admin/knowledge/evolve/:id/review", async (c) => {
  const body = (await c.req.json()) as { action?: string; reject_reason?: string };
  const action = body.action === "reject" ? "reject" : "approve";
  return c.json(reviewProposal(c.req.param("id"), action, String(body.reject_reason || "")));
});
knowledge.post("/admin/knowledge/:id/transfer", async (c) => {
  const body = (await c.req.json()) as { to_brand?: string };
  return c.json(transferBrand(c.req.param("id"), String(body.to_brand || "")));
});
knowledge.post("/admin/knowledge/:id/approve", () => { throw new HttpFail(409,"请从当前知识提交审批，审批通过后独立发布"); });
knowledge.post("/admin/knowledge/:id/archive", (c) => c.json(archiveKnowledge(c.req.param("id"))));
knowledge.post("/admin/knowledge", async (c) => { const b=await c.req.json(); if(b.status && b.status!=="draft") throw new HttpFail(422,"新建只能保存草稿"); return c.json(createKnowledge({...b,status:"draft"}),201); });
knowledge.put("/admin/knowledge/:id", async (c) => c.json(editKnowledge(c.req.param("id"), (await c.req.json()) as { title: string; body: string })));
knowledge.delete("/admin/knowledge/:id", (c) => c.json(hardDeleteKnowledge(c.req.param("id"))));
