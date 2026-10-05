import { reviewIntake } from "../approval/review-rollout.js";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import {
  reviewContextForActor,
  reviewCompaniesForActor,
} from "../approval/review-access.js";
import { scopedUser } from "../auth.js";
import { getConn, txImmediate, type SqliteConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { ensureOrganizationTree } from "../runtime/organization-tree.js";
import {
  ReviewService,
  type ReviewContext,
} from "../approval/review-service.js";
import { validateDefinition } from "../approval/review-engine.js";
import { guardKnowledgeReview } from "../knowledge/publication.js";

export function reviewContext(
  db: SqliteConn,
  selectedTenant?: string,
): ReviewContext {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "请登录后使用通用评审");
  return reviewContextForActor(db, user.id, selectedTenant);
}
export const reviews = new Hono();
reviews.use("/approvals/v2/*", async (_c, next) => {
  ensureOrganizationTree();
  await next();
});
reviews.use("/admin/approval-types/v2/*", async (_c, next) => {
  ensureOrganizationTree();
  await next();
});
const service = (tenant?: string, db = getConn()) =>
  new ReviewService(db, reviewContext(db, tenant));
function reviewTx<T>(action: (db: SqliteConn) => T): T {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return txImmediate(action);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if(code==="23514" && error instanceof Error && error.message.startsWith("knowledge_"))
        throw new HttpFail(409,{code:error.message,message:"知识资料、流程绑定或审批状态已变化，请返回资料详情重新检查。"});
      if (!["40001", "40P01", "23505", "SQLITE_BUSY"].includes(code || ""))
        throw error;
    }
  }
  throw new HttpFail(409, "评审状态正在变化，请重试原操作以查询幂等回执");
}
async function body(c: { req: { text: () => Promise<string> } }) {
  const raw = await c.req.text();
  if (raw.length > 250000) throw new HttpFail(413, "评审请求过大");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new HttpFail(400, "无效 JSON 对象");
  }
}
reviews.get("/approvals/v2/instance-page", (c) =>
  c.json(
    service(c.req.header("X-Review-Company")).instancePage({
      cursor: c.req.query("cursor"),
      q: c.req.query("q"),
      filter: c.req.query("filter"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    }),
  ),
);
reviews.get("/approvals/v2/drafts/:id/upgrade", (c) =>
  c.json(
    service(c.req.header("X-Review-Company")).draftUpgrade(c.req.param("id")),
  ),
);
reviews.post("/approvals/v2/drafts/:id/upgrade", async (c) => {
  const b = await body(c);
  return c.json(
    reviewTx((db) =>
      service(c.req.header("X-Review-Company"), db).upgradeDraft(
        c.req.param("id"),
        b.expectedVersion,
        b.targetVersion,
      ),
    ),
  );
});
reviews.get("/admin/approval-types/v2/templates/:id/diff", (c) =>
  c.json(
    service(c.req.header("X-Review-Company")).publishDiff(c.req.param("id")),
  ),
);
reviews.post(
  "/approvals/v2/attachments",
  bodyLimit({ maxSize: 3 * 1024 * 1024 }),
  async (c) => {
    const s = service(c.req.header("X-Review-Company")),
      b = await c.req.parseBody(),
      file = b.file;
    if (!file || typeof file === "string" || Array.isArray(file))
      throw new HttpFail(422, "请选择文件");
    const bytes = Buffer.from(await file.arrayBuffer());
    return c.json(
      reviewTx((db) =>
        new ReviewService(db, s.ctx).uploadAttachment(file.name, bytes),
      ),
    );
  },
);
reviews.get("/approvals/v2/attachments/:id", (c) => {
  const a = service(
    c.req.header("X-Review-Company") || c.req.query("company"),
  ).attachment(c.req.param("id"), c.req.query("instanceId"));
  if (c.req.query("metadata") === "1")
    return c.json({ id: a.id, name: a.name, size: a.size, sha256: a.sha256 });
  c.header("Content-Type", "application/octet-stream");
  c.header(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", "sandbox");
  return c.body(new Uint8Array(a.content));
});
reviews.get("/approvals/v2/companies", (c) => {
  const actor = scopedUser();
  if (!actor) throw new HttpFail(401, "请登录");
  return c.json(reviewCompaniesForActor(getConn(), actor.id));
});
reviews.get("/approvals/v2/drafts", (c) =>
  c.json(service(c.req.header("X-Review-Company")).drafts()),
);
reviews.post("/approvals/v2/drafts", async (c) => {
  const b = await body(c);
  return c.json(
    reviewTx((db) =>
      service(c.req.header("X-Review-Company"), db).saveDraft(b),
    ),
  );
});
reviews.get("/approvals/v2/context", (c) => {
  const s = service(c.req.header("X-Review-Company"));
  return c.json({
    ...s.ctx,
    intake: reviewIntake(s.ctx.tenant),
    capabilities: {
      fields: [
        "text",
        "textarea",
        "number",
        "decimal",
        "money",
        "date",
        "select",
        "multiselect",
        "attachment",
      ],
      nodes: [
        "start",
        "review",
        "condition",
        "end",
        "cc",
        "consult",
        "handler",
      ],
      modes: ["single", "all", "any", "sequential"],
      assignees: ["named", "manager", "role"],
      externalExecution: false,
      attachments: true,
      timeoutEscalation: true,
      transfer: true,
      countersign: true,
      amendments: true,
      notifications: "in_app",
      conditionGroups: ["all", "any", "not"],
      templateLifecycle: true,
    },
  });
});
reviews.get("/approvals/v2/templates", (c) =>
  c.json(service(c.req.header("X-Review-Company")).templates()),
);
reviews.get("/approvals/v2/instances", (c) => {
  const s = service(c.req.header("X-Review-Company"));
  return c.json(s.instances().map((i) => s.project(i)));
});
reviews.get("/approvals/v2/instances/:id", (c) => {
  const s = service(c.req.header("X-Review-Company")),
    i = s.instance(c.req.param("id"));
  return c.json({
    ...s.project(i),
    events: s.events(i.id),
    revisions: s.revisions(i.id),
  });
});
reviews.get("/approvals/v2/notifications", (c) =>
  c.json(service(c.req.header("X-Review-Company")).notifications()),
);
reviews.post("/approvals/v2/notifications/:id/read", (c) =>
  c.json(
    reviewTx((db) =>
      service(c.req.header("X-Review-Company"), db).readNotification(
        c.req.param("id"),
      ),
    ),
  ),
);
reviews.post("/approvals/v2/prepare", async (c) => {
  const b = await body(c);
  await guardKnowledgeReview(b, reviewContext(getConn(), c.req.header("X-Review-Company")));
  return c.json(
    reviewTx((db) => service(c.req.header("X-Review-Company"), db).prepare(b)),
  );
});
reviews.post("/approvals/v2/commands", async (c) => {
  const b = await body(c);
  await guardKnowledgeReview(b.command, reviewContext(getConn(), c.req.header("X-Review-Company")));
  return c.json(
    reviewTx((db) =>
      service(c.req.header("X-Review-Company"), db).execute(
        b.command,
        b.confirmationId,
        b.idempotencyKey,
      ),
    ),
  );
});
reviews.get("/admin/approval-types/v2/templates", (c) =>
  c.json(service(c.req.header("X-Review-Company")).templates(true)),
);
reviews.post("/admin/approval-types/v2/templates", async (c) => {
  const b = await body(c);
  return c.json(
    reviewTx((db) =>
      service(c.req.header("X-Review-Company"), db).saveTemplate(
        undefined,
        undefined,
        b.definition,
      ),
    ),
  );
});
reviews.put("/admin/approval-types/v2/templates/:id", async (c) => {
  const b = await body(c);
  return c.json(
    reviewTx((db) =>
      service(c.req.header("X-Review-Company"), db).saveTemplate(
        c.req.param("id"),
        b.expectedVersion,
        b.definition,
      ),
    ),
  );
});
reviews.post("/admin/approval-types/v2/validate", async (c) => {
  const s = service(c.req.header("X-Review-Company"));
  s.templates(true);
  const definition = (await body(c)).definition;
  s.checkOrganization(definition);
  return c.json({ issues: validateDefinition(definition) });
});
reviews.post("/admin/approval-types/v2/simulate", async (c) => {
  const b = await body(c);
  return c.json(
    service(c.req.header("X-Review-Company")).simulate(
      b.definition,
      b.values,
      b.requester,
    ),
  );
});
