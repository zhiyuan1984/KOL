import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { scopedUser } from "../auth.js";
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
} from "../knowledge-publication/service.js";
export const knowledgePublication = new Hono();
const actor = () => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "请登录");
  return user.id;
};
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
knowledgePublication.get("/admin/knowledge/publication/companies", async (c) =>
  c.json(
    await postgresTransaction((db) => postgresReviewCompanies(db, actor())),
  ),
);
knowledgePublication.use(
  "/admin/knowledge/documents/:id/publication/*",
  bodyLimit({ maxSize: 250000 }),
);
knowledgePublication.get(
  "/admin/knowledge/documents/:id/publication",
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
  "/admin/knowledge/documents/:id/publication/prepare",
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
  "/admin/knowledge/documents/:id/publication/check",
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
  "/admin/knowledge/documents/:id/publication/submit",
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
  "/admin/knowledge/documents/:id/publication/recovery/prepare",
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
  "/admin/knowledge/documents/:id/publication/recovery/submit",
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
          "SELECT p.snapshot,d.source_path FROM knowledge_publications p JOIN knowledge_documents d ON d.id=p.document_id WHERE p.tenant=$1 AND p.instance_id=$2",
          [ctx.tenant, c.req.param("id")],
        )
      ).rows[0];
      if (!p) throw new HttpFail(404, "审批原件不存在");
      const snapshot = JSON.parse(p.snapshot);
      const bytes = await fs.readFile(
        path.isAbsolute(p.source_path)
          ? p.source_path
          : path.join(dataDir(), p.source_path),
      );
      if (
        createHash("sha256").update(bytes).digest("hex") !== snapshot.sourceHash
      )
        throw new HttpFail(409, "原件已变化，不能作为本次审批材料");
      return { bytes, filename: snapshot.filename };
    });
    c.header("Content-Type", "application/pdf");
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
