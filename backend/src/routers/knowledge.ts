import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import {
  adminList,
  adminAssets,
  approveKnowledge,
  archiveKnowledge,
  cite,
  composerItems,
  createKnowledge,
  deprecate,
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

knowledge.get("/knowledge/composer", (c) => c.json(composerItems()));
knowledge.get("/knowledge/market", (c) => c.json(listMarket()));
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
knowledge.get("/admin/knowledge", (c) => c.json(adminList()));
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
