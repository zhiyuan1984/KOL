import { workspaceData, batchWorkspaceItems, parseWorkspaceFilter, entryDetail, saveEntry, reviseEntry, removeEntryDraft,authorizeEntry } from "../knowledge/workspace.js";
import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { scopedUser } from "../auth.js";
import { requiresKnowledgeEntryAuthorization } from "./knowledge-route-scope.js";
import { HttpFail } from "../host/errors.js";
import { dataDir } from "../config.js";
import { postgresTransaction } from "../postgres/pool.js";
import {
  postgresReviewContext,
  postgresReviewCompanies,
} from "../approval/review-postgres-access.js";
import {
  publicationOptions,
  preparePublication,
  submitPublication,
  publicationProjection,
  checkPublication,
  preparePublicationRecovery,
  recoverPublication,
  adminDocument,
} from "../knowledge-publication/service.js";
export const knowledgePublication = new Hono();
knowledgePublication.use("/admin/knowledge/workspace-v1/*", bodyLimit({maxSize:1000000}));
knowledgePublication.use("/admin/knowledge/entries/:id/publication-v2/*", bodyLimit({maxSize:250000}));
const actor = () => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "请登录");
  return user.id;
};
knowledgePublication.use("/admin/knowledge/documents/:id/*",async(c,next)=>{
  await postgresTransaction(db=>adminDocument(db,actor(),c.req.header("X-Review-Company") || c.req.query("company"),c.req.param("id") || ""));
  await next();
});
knowledgePublication.use("/admin/knowledge/:id/*",async(c,next)=>{
  const id=c.req.param("id") || "";
  if(requiresKnowledgeEntryAuthorization(id))await postgresTransaction(db=>authorizeEntry(db,actor(),c.req.header("X-Review-Company"),id));
  await next();
});
knowledgePublication.use("/admin/knowledge/:id",async(c,next)=>{
  const id=c.req.param("id") || "";
  if(["PUT","DELETE"].includes(c.req.method) && !["documents","bases","domains","bindings"].includes(id))await postgresTransaction(db=>authorizeEntry(db,actor(),c.req.header("X-Review-Company"),id));
  await next();
});
async function body(c: { req: { text: () => Promise<string> } }) {
  try {
    const value = JSON.parse(await c.req.text());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpFail(400, "无效 JSON 对象");
  }
}
knowledgePublication.get("/admin/knowledge/publication-v2/companies", async (c) =>
  c.json(
    await postgresTransaction((db) => postgresReviewCompanies(db, actor())),
  ),
);
knowledgePublication.use(
  "/admin/knowledge/documents/:id/publication-v2/*",
  bodyLimit({ maxSize: 250000 }),
);
knowledgePublication.get(
  "/admin/knowledge/documents/:id/publication-v2",
  async (c) =>
    c.json(
      await publicationOptions(
        actor(),
        c.req.header("X-Review-Company"),
        c.req.param("id"),
      ),
    ),
);
knowledgePublication.post(
  "/admin/knowledge/documents/:id/publication-v2/prepare",
  async (c) =>
    c.json(
      await preparePublication(
        actor(),
        c.req.header("X-Review-Company"),
        c.req.param("id"),
        await body(c),
      ),
    ),
);
knowledgePublication.post(
  "/admin/knowledge/documents/:id/publication-v2/check",
  async (c) =>
    c.json(
      await checkPublication(
        actor(),
        c.req.header("X-Review-Company"),
        c.req.param("id"),
        await body(c),
      ),
    ),
);
knowledgePublication.post(
  "/admin/knowledge/documents/:id/publication-v2/submit",
  async (c) => {
    const b = await body(c);
    return c.json(
      await submitPublication(
        actor(),
        c.req.header("X-Review-Company"),
        c.req.param("id"),
        b.command,
        b.confirmationId,
        b.idempotencyKey,
      ),
    );
  },
);
knowledgePublication.post(
  "/admin/knowledge/documents/:id/publication-v2/recovery/prepare",
  async (c) =>
    c.json(
      await preparePublicationRecovery(
        actor(),
        c.req.header("X-Review-Company"),
        c.req.param("id"),
      ),
    ),
);
knowledgePublication.post(
  "/admin/knowledge/documents/:id/publication-v2/recovery/submit",
  async (c) => {
    const b = await body(c);
    return c.json(
      await recoverPublication(
        actor(),
        c.req.header("X-Review-Company"),
        c.req.param("id"),
        b.confirmationId,
        b.idempotencyKey,
      ),
    );
  },
);
knowledgePublication.get("/admin/knowledge/workspace-v1",async c=>c.json(await workspaceData(actor(),c.req.header("X-Review-Company"),parseWorkspaceFilter(c.req.query()))));
knowledgePublication.post("/admin/knowledge/workspace-v1/batch",async c=>{
  const b=await c.req.json().catch(()=>({})) as {items?:{id:string;asset:"entry"|"document"}[];action?:"renew"|"archive";expires_at?:string};
  if(b.action!=="renew"&&b.action!=="archive")throw new HttpFail(400,"action 仅支持 renew/archive");
  if(!Array.isArray(b.items)||!b.items.length)throw new HttpFail(400,"items 不能为空");
  return c.json(await batchWorkspaceItems(actor(),c.req.header("X-Review-Company"),b.items,b.action,b.expires_at));
});
knowledgePublication.get("/admin/knowledge/documents/:id",async c=>{
  const id=c.req.param("id");
  const result=await postgresTransaction(async db=>{
    await adminDocument(db,actor(),c.req.header("X-Review-Company"),id);
    const document=(await db.query("SELECT d.*,COALESCE(l.version,1) AS current_version FROM knowledge_documents d LEFT JOIN knowledge_document_lineage l ON l.document_id=d.id WHERE d.id=$1",[id])).rows[0];
    const base=(await db.query("SELECT b.*,d.name AS domain_name,f.name AS family_name FROM knowledge_bases b LEFT JOIN knowledge_domains d ON d.id=b.domain_id LEFT JOIN knowledge_domains f ON f.id=d.parent_id WHERE b.id=$1",[document.base_id])).rows[0];
    const jobs=(await db.query("SELECT * FROM knowledge_document_jobs WHERE document_id=$1 ORDER BY created_at DESC,id DESC",[id])).rows;
    const frozen=(await db.query("SELECT 1 FROM knowledge_publication_applications WHERE document_id=$1 AND status='waiting'",[id])).rowCount;
    const actions={edit:document.status==='draft' && !frozen,start:document.status==='draft' && !frozen,retry:['failed','cancelled'].includes(document.status),cancel:['uploaded','normalizing','indexing'].includes(document.status),revision:['pending_review','published','archived'].includes(document.status)};
    return {document:{...document,artifacts:document.artifacts?JSON.parse(document.artifacts):{},latest_job:jobs[0] || null},base,jobs,actions};
  });
  let text_preview=null;
  const root=process.env.KNOWLEDGE_DOCS_DIR || path.join(dataDir(),"knowledge");
  for(const name of ["transcript.md","extracted.md"]){
    const file=path.resolve(root,"bases",result.document.base_id,"documents",id,name);
    if(!file.startsWith(path.resolve(root)+path.sep))throw new HttpFail(404,"资料路径无效");
    try{text_preview={name,text:(await fs.readFile(file,"utf8")).slice(0,20000)};break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  return c.json({...result,text_preview});
});
knowledgePublication.get("/admin/knowledge/workspace-v1/entries/:id",async c=>c.json(await entryDetail(actor(),c.req.header("X-Review-Company"),c.req.param("id"))));
knowledgePublication.post("/admin/knowledge/workspace-v1/entries",async c=>c.json(await saveEntry(actor(),c.req.header("X-Review-Company"),undefined,await body(c)),201));
knowledgePublication.put("/admin/knowledge/workspace-v1/entries/:id",async c=>c.json(await saveEntry(actor(),c.req.header("X-Review-Company"),c.req.param("id"),await body(c))));
knowledgePublication.post("/admin/knowledge/workspace-v1/entries/:id/revision",async c=>c.json(await reviseEntry(actor(),c.req.header("X-Review-Company"),c.req.param("id"),(await body(c)).expectedRevision),201));
knowledgePublication.post("/admin/knowledge/workspace-v1/entries/:id/rollback",async c=>{const b=await body(c);if(!Number.isInteger(b.version)||b.version<1)throw new HttpFail(422,"请选择有效的历史版本");return c.json(await reviseEntry(actor(),c.req.header("X-Review-Company"),c.req.param("id"),b.expectedRevision,b.version),201);});
knowledgePublication.delete("/admin/knowledge/workspace-v1/entries/:id",async c=>c.json(await removeEntryDraft(actor(),c.req.header("X-Review-Company"),c.req.param("id"),(await body(c)).expectedRevision)));
for(const assetType of ["entries","documents"] as const) {
  const ref=(id:string|undefined)=>assetType==="entries" ? `entry:${id || ""}`:id || "";
  const route=`/admin/knowledge/${assetType}/:id/publication-v2`;
  if(assetType==="entries") {
    knowledgePublication.get(route,async c=>c.json(await publicationOptions(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")))));
    knowledgePublication.post(`${route}/check`,async c=>c.json(await checkPublication(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")),await body(c))));
    knowledgePublication.post(`${route}/prepare`,async c=>c.json(await preparePublication(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")),await body(c))));
    knowledgePublication.post(`${route}/submit`,async c=>{const b=await body(c);return c.json(await submitPublication(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")),b.command,b.confirmationId,b.idempotencyKey));});
  }
  knowledgePublication.post(`${route}/publish/prepare`,async c=>c.json(await preparePublicationRecovery(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")),"publish")));
  knowledgePublication.post(`${route}/publish/submit`,async c=>{const b=await body(c);return c.json(await recoverPublication(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")),b.confirmationId,b.idempotencyKey,"publish"));});
  if(assetType==="entries") {
    knowledgePublication.post(`${route}/recovery/prepare`,async c=>c.json(await preparePublicationRecovery(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")))));
    knowledgePublication.post(`${route}/recovery/submit`,async c=>{const b=await body(c);return c.json(await recoverPublication(actor(),c.req.header("X-Review-Company"),ref(c.req.param("id")),b.confirmationId,b.idempotencyKey));});
  }
}
knowledgePublication.get(
  "/approvals/v2/instances/:id/knowledge-source",
  async (c) => {
    const result = await postgresTransaction(async (db) => {
      const ctx = await postgresReviewContext(
        db,
        actor(),
        c.req.header("X-Review-Company") || c.req.query("company"),
      );
      const participant = (
        await db.query(
          "SELECT user_id FROM review_participants WHERE tenant=$1 AND instance_id=$2 AND user_id=$3",
          [ctx.tenant, c.req.param("id"), ctx.actor],
        )
      ).rows[0];
      if (!participant && !ctx.admin)
        throw new HttpFail(403, "仅当前组织的流程参与人可查看审批原件");
      const p = (
        await db.query(
          "SELECT p.snapshot,p.entry_id,d.source_path FROM knowledge_publication_applications p LEFT JOIN knowledge_documents d ON d.id=p.document_id WHERE p.tenant=$1 AND p.instance_id=$2",
          [ctx.tenant, c.req.param("id")],
        )
      ).rows[0];
      if (!p) throw new HttpFail(404, "审批原件不存在");
      const snapshot = JSON.parse(p.snapshot);
      if(p.entry_id) return {bytes:Buffer.from(JSON.stringify(snapshot.content,null,2)),filename:snapshot.title+".json",mime:"application/json"};
      const bytes = await fs.readFile(
        path.isAbsolute(p.source_path)
          ? p.source_path
          : path.join(dataDir(), p.source_path),
      );
      if (
        createHash("sha256").update(bytes).digest("hex") !== snapshot.sourceHash
      )
        throw new HttpFail(409, "原件已变化，不能作为本次审批材料");
      return { bytes, filename: snapshot.filename,mime:"application/pdf" };
    });
    c.header("Content-Type", result.mime);
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "sandbox");
    c.header(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    return c.body(new Uint8Array(result.bytes));
  },
);
export { publicationProjection };
