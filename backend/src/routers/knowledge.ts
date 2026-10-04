import { Hono } from "hono";
import fs from "node:fs";
import { startDocument, publishedDocumentSourceFile } from "../host/knowledge-documents.js";
import { scopedUser } from "../auth.js";
import { assertRuntimeSkill } from "../runtime/execution.js";
import { hasDocumentTool, documentDependencies } from "../runtime/document-knowledge.js";
import { requireAdmin, requireSkill } from "../auth.js";
import { HttpFail } from "../host/errors.js";
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
  questionTemplates,
  reviewProposal,
  reviewQueue,
  storeUploadRaw,
  transferBrand,
  uncite,
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

export const knowledge = new Hono();

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
  return c.json(publicKnowledge(row));
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
knowledge.get("/admin/knowledge/documents", (c) => c.json({
  documents: listDocuments({ base: c.req.query("base"), status: c.req.query("status") }),
}));
knowledge.post("/admin/knowledge/documents", async (c) => {
  requireAdmin();
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") throw new HttpFail(400, "file required");
  const buf = Buffer.from(await (file as File).arrayBuffer());
  return c.json(uploadDocument(
    { name: (file as File).name || "upload.pdf", type: (file as File).type || "", buf },
    String(body.base_id || ""),
    undefined,
    { draft: body.draft === "true" },
  ), 201);
});
knowledge.get("/admin/knowledge/documents/:id", (c) => c.json(getDocumentDetail(c.req.param("id"))));
knowledge.get("/admin/knowledge/documents/:id/file", (c) => {
  const ref = documentSourceFile(c.req.param("id"));
  c.header("Content-Type", ref.mime || "application/pdf");
  c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(ref.name)}`);
  return c.body(new Uint8Array(fs.readFileSync(ref.path)));
});
knowledge.get("/knowledge/documents/:id/file", (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const skillId = String(c.req.query("skill_id") || "");
  assertRuntimeSkill({ agentId: String(c.req.query("agent_id") || ""), skillId, userId: user.id, runId: "document-source" });
  if (!hasDocumentTool(skillId)) throw new HttpFail(403, "文档查询技能未启用");
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
knowledge.delete("/admin/knowledge/documents/:id", (c) => c.json(deleteDocument(c.req.param("id"))));
knowledge.post("/admin/knowledge/search", async (c) => c.json(await searchDocuments((await c.req.json()) as Json)));
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
knowledge.post("/admin/knowledge/:id/approve", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const expected = body.expected_version == null ? null : Number(body.expected_version);
  return c.json(approveKnowledge(c.req.param("id"), expected));
});
knowledge.post("/admin/knowledge/:id/archive", (c) => c.json(archiveKnowledge(c.req.param("id"))));
knowledge.post("/admin/knowledge", async (c) => c.json(createKnowledge((await c.req.json()) as { title: string; body: string }), 201));
knowledge.put("/admin/knowledge/:id", async (c) => c.json(editKnowledge(c.req.param("id"), (await c.req.json()) as { title: string; body: string })));
knowledge.delete("/admin/knowledge/:id", (c) => c.json(hardDeleteKnowledge(c.req.param("id"))));
