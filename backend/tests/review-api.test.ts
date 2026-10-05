import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authMiddleware } from "../src/auth.js";
import { getConn, resetConn, txImmediate } from "../src/db.js";
import { ReviewService } from "../src/approval/review-service.js";
import { reviewContextForActor } from "../src/approval/review-access.js";
import { processExecutionJobById } from "../src/execution-jobs/dispatcher.js";
import { ensureOrganizationTree } from "../src/runtime/organization-tree.js";
import { reviews } from "../src/routers/reviews.js";
import { approvals } from "../src/routers/approvals.js";
import { HttpFail } from "../src/host/errors.js";
import { emptyReviewDefinition } from "../../shared/review.js";
import { freshTestDatabase } from "./support/pg.js";

let app: Hono, tmp: string;
const original = {
  AUTH_MODE: process.env.AUTH_MODE,
  LINGONG_DB: process.env.LINGONG_DB,
  LINGONG_DATA: process.env.LINGONG_DATA,
};
function req(
  actor: string | undefined,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return app.request(`http://localhost/api${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(actor ? { cookie: `lingong_session=test-${actor}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-api-"));
  Object.assign(process.env, {
    AUTH_MODE: "enabled",
    LINGONG_DB: path.join(tmp, "db.sqlite"),
    LINGONG_DATA: tmp,
  });
  if (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)
    await freshTestDatabase();
  const db = resetConn();
  ensureOrganizationTree();
  for (const company of ["review-test-a", "review-test-b"])
    db.prepare(
      "INSERT INTO organization_units(id,company_id,display_name,type,level,head_person_ref,status,org_version,created_at,updated_at) VALUES(?,?,?,?,1,?,'active',1,?,?)",
    ).run(
      company,
      company,
      company,
      "department",
      `review-person:reviewer`,
      "now",
      "now",
    );
  for (const id of ["admin", "employee", "reviewer", "outsider"]) {
    db.prepare(
      "INSERT INTO users(id,username,name,password_hash,roles,brands,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)",
    ).run(
      `review-${id}`,
      `review-${id}`,
      id,
      "test-unused",
      JSON.stringify(id === "admin" ? ["admin"] : ["employee"]),
      "[]",
      "now",
      "now",
    );
    db.prepare(
      "INSERT INTO organization_people(person_ref,display_name,user_id,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)",
    ).run(`review-person:${id}`, id, `review-${id}`, "now", "now");
    const company = id === "outsider" ? "review-test-b" : "review-test-a";
    db.prepare(
      "INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at) VALUES(?,?,?,?,'primary','active',?,?)",
    ).run(
      `review-membership:${id}`,
      `review-person:${id}`,
      company,
      company,
      "now",
      "now",
    );
    db.prepare(
      "INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    ).run(
      createHash("sha256").update(`test-${id}`).digest("hex"),
      `review-${id}`,
      "2099-01-01T00:00:00.000Z",
      "now",
    );
  }
  app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api", reviews);
  app.route("/api", approvals);
  app.onError((e, c) =>
    c.json(
      { detail: e instanceof HttpFail ? e.detail : e.message },
      (e instanceof HttpFail ? e.status : 500) as 400,
    ),
  );
});
afterEach(() => {
  getConn().close();
  for (const [key, value] of Object.entries(original))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  if (
    path.basename(tmp).startsWith("review-api-") &&
    path.dirname(tmp) === os.tmpdir()
  )
    fs.rmSync(tmp, { recursive: true, force: true });
});
async function publish(definition = emptyReviewDefinition()) {
  const created = await req("admin", "/admin/approval-types/v2/templates", {
    definition,
  });
  expect(created.status).toBe(200);
  const t = await created.json();
  const command = { action: "publish", templateId: t.id, expectedVersion: 1 };
  const p = await (await req("admin", "/approvals/v2/prepare", command)).json();
  expect(
    (
      await req("admin", "/approvals/v2/commands", {
        command,
        confirmationId: p.confirmationId,
        idempotencyKey: "publish-template",
      })
    ).status,
  ).toBe(200);
  return t;
}
describe("review API with actual session authentication and organization storage", () => {
  it("checks static people and operation candidates before publication, with stable issue targets", async () => {
    const definition = emptyReviewDefinition();
    definition.nodes[1].assignee = { kind: "named", userIds: ["review-outsider"] };
    let response = await req("admin", "/admin/approval-types/v2/validate", { definition });
    expect(response.status).toBe(200);
    expect((await response.json()).issues).toEqual(expect.arrayContaining([expect.objectContaining({ target: expect.objectContaining({ step: "flow", id: "review" }) })]));
    definition.nodes[1].assignee = { kind: "named", userIds: ["review-reviewer"] };
    definition.nodes[1].operations = { transfer: { candidates: { kind: "named", userIds: ["review-outsider"] }, deadline: "preserve" } };
    response = await req("admin", "/admin/approval-types/v2/validate", { definition });
    expect((await response.json()).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "nodes.review.operations" })]));
    delete definition.nodes[1].operations;
    expect((await (await req("admin", "/admin/approval-types/v2/validate", { definition })).json()).issues).toEqual([]);
  });
  it("replays a lost create response without another draft, and compares content rather than version numbers", async () => {
    const definition = emptyReviewDefinition(), creationKey = "review-editor-create-key-001";
    const saved = await (await req("admin", "/admin/approval-types/v2/templates", { definition, creationKey })).json();
    const repeated = await (await req("admin", "/admin/approval-types/v2/templates", { definition, creationKey })).json();
    expect(repeated.id).toBe(saved.id);
    expect(repeated.version).toBe(1);
    expect((await req("admin", "/admin/approval-types/v2/templates", { definition: { ...definition, name: "changed" }, creationKey })).status).toBe(409);
    const service = new ReviewService(getConn(), reviewContextForActor(getConn(), "review-admin"));
    txImmediate(() => { const command = { action: "publish" as const, templateId: saved.id, expectedVersion: 1 }; const prepared = service.prepare(command); service.execute(command, prepared.confirmationId, "review-content-diff-publish"); });
    txImmediate(() => service.saveTemplate(saved.id, 1, definition));
    expect(service.templates(true).find(t => t.id === saved.id)).toMatchObject({ version: 2, publishedVersion: 1, hasUnpublishedChanges: false });
  });
  it("returns both branch outcomes and complete read-only trial traces including cc and waiting duties", async () => {
    const definition = emptyReviewDefinition();
    definition.fields = [{ id: "content", label: "内容", type: "text", required: true }];
    definition.nodes[0].next = "branch";
    definition.nodes[1].next = "cc";
    definition.nodes.push(
      { id: "branch", name: "条件", type: "condition", condition: { field: "content", op: "eq", value: "A" }, next: "review", otherwise: "review" },
      ...(["cc", "consult", "handler"] as const).map((type, index, types) => ({ id: type, name: type, type, next: types[index+1] || "end", assignee: { kind: "named" as const, userIds: ["review-reviewer"] }, mode: "single" as const })),
    );
    const counts = () => ["review_instances", "review_notifications", "review_events"].map(table => (getConn().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    const before = counts();
    for (const [content, branch] of [["A", "matched"], ["B", "otherwise"]]) {
      const response = await req("admin", "/admin/approval-types/v2/simulate", { definition, values: { content }, requester: "review-employee" });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.trace.map((x: { nodeId: string }) => x.nodeId)).toEqual(["start", "branch", "review", "cc", "consult", "handler", "end"]);
      expect(result.trace[1]).toMatchObject({ branch, inputs: { content } });
      expect(result.trace[3]).toMatchObject({ userIds: ["review-reviewer"], type: "cc" });
    }
    expect(counts()).toEqual(before);
  });
  it("supports the real authority shape with no company unit and four organization levels", async () => {
    department("institute", "review-test-a", 1);
    department("digital", "institute", 2);
    department("product", "digital", 3);
    department("ai", "product", 4);
    getConn().prepare("UPDATE organization_units SET parent_id=NULL WHERE id='institute'").run();
    getConn().prepare("DELETE FROM organization_units WHERE id='review-test-a'").run();
    getConn().prepare("UPDATE organization_memberships SET org_unit_id='ai' WHERE id='review-membership:admin'").run();
    const response = await req("admin", "/approvals/v2/context");
    expect(response.status).toBe(200);
    const context = await response.json();
    expect(context.organization.defaultUnitId).toBe("ai");
    expect(context.organization.units.find((unit: {id:string}) => unit.id === "institute").parentId).toBe("review-test-a");
    expect(context.organization.units.map((unit: {id:string}) => unit.id)).toEqual(expect.arrayContaining(["institute","digital","product","ai"]));
    const definition = {...emptyReviewDefinition(), organizationUnitId:"ai"};
    expect((await req("admin", "/admin/approval-types/v2/templates", {definition})).status).toBe(200);
    expect((await req("outsider", "/approvals/v2/context", undefined, {"X-Review-Company":"review-test-a"})).status).toBe(403);
  });
  function department(id: string, parent: string, level: number, status = "active") {
    getConn().prepare("INSERT INTO organization_units(id,company_id,display_name,type,parent_id,level,status,org_version,created_at,updated_at) VALUES(?,?,?,'department',?,?,?,1,'now','now')")
      .run(id, "review-test-a", id, parent, level, status);
  }
  it("returns the actual primary organization path and excludes foreign, archived and orphan departments", async () => {
    department("center", "review-test-a", 2);
    department("department", "center", 3);
    department("group", "department", 4);
    department("archived", "review-test-a", 2, "archived");
    department("archived-child", "archived", 3);
    department("orphan", "missing", 2);
    getConn().prepare("UPDATE organization_memberships SET org_unit_id='group' WHERE id='review-membership:admin'").run();
    getConn().prepare("INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at) VALUES('collab','review-person:admin','review-test-b','review-test-b','collaborative','active','now','now')").run();
    const response = await req("admin", "/approvals/v2/context");
    expect(response.status).toBe(200);
    const context = await response.json();
    expect(context.tenant).toBe("review-test-a");
    expect(context.organization.defaultUnitId).toBe("group");
    expect(context.organization.units.map((unit: { id: string }) => unit.id).sort()).toEqual(["center", "department", "group", "review-test-a"]);
    expect((await req("outsider", "/approvals/v2/context", undefined, { "X-Review-Company": "review-test-a" })).status).toBe(403);
  });
  it("does not guess a primary department when multiple organization memberships are primary", async () => {
    department("center", "review-test-a", 2);
    getConn().prepare("INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at) VALUES('primary-extra','review-person:admin','review-test-a','center','primary','active','now','now')").run();
    const context = await (await req("admin", "/approvals/v2/context")).json();
    expect(context.organization.defaultUnitId).toBeUndefined();
  });
  it("persists draft organization ownership and rejects a foreign or archived organization", async () => {
    department("center", "review-test-a", 2);
    const definition = { ...emptyReviewDefinition(), organizationUnitId: "center", name: "" };
    const saved = await req("admin", "/admin/approval-types/v2/templates", { definition });
    expect(saved.status).toBe(200);
    const template = await saved.json();
    const rows = await (await req("admin", "/admin/approval-types/v2/templates")).json();
    expect(rows.find((row: { id: string }) => row.id === template.id).definition.organizationUnitId).toBe("center");
    expect((await req("admin", "/admin/approval-types/v2/templates", { definition: { ...definition, organizationUnitId: "review-test-b" } })).status).toBe(422);
    getConn().prepare("UPDATE organization_units SET status='archived' WHERE id='center'").run();
    expect((await req("admin", "/admin/approval-types/v2/templates", { definition })).status).toBe(422);
  });
  it("rechecks organization status before a confirmed publish and preserves legacy drafts", async () => {
    department("center", "review-test-a", 2);
    const definition = { ...emptyReviewDefinition(), organizationUnitId: "center" };
    const template = await (await req("admin", "/admin/approval-types/v2/templates", { definition })).json();
    const command = { action: "publish", templateId: template.id, expectedVersion: template.version };
    const prepared = await req("admin", "/approvals/v2/prepare", command);
    expect(prepared.status).toBe(200);
    const confirmation = await prepared.json();
    getConn().prepare("UPDATE organization_units SET status='archived' WHERE id='center'").run();
    const check = await req("admin", "/admin/approval-types/v2/validate", { definition });
    expect(check.status).toBe(200);
    expect((await check.json()).issues).toContainEqual(expect.objectContaining({ path: "organizationUnitId", target: expect.objectContaining({ step: "basic", property: "organizationUnitId" }) }));
    expect((await req("admin", "/approvals/v2/commands", { command, confirmationId: confirmation.confirmationId, idempotencyKey: "archived-org" })).status).toBe(422);
    const rows = await (await req("admin", "/admin/approval-types/v2/templates")).json();
    expect(rows.find((row: { id: string }) => row.id === template.id).publishedVersion).toBeNull();
    expect((await req("admin", "/admin/approval-types/v2/templates", { definition: emptyReviewDefinition() })).status).toBe(200);
  });
  it("persists exact monetary material through confirmed HTTP commands", async () => {
    const definition = emptyReviewDefinition();
    definition.fields = [
      {
        id: "budget",
        label: "预算",
        type: "money",
        required: true,
        numeric: { precision: 22, scale: 2 },
        currencies: ["CNY"],
        currencySource: "测试制度 v1",
      },
    ];
    const template = await publish(definition);
    const values = {
      budget: { amount: "9007199254740993.01", currency: "CNY" },
    };
    const command = {
      action: "submit",
      templateId: template.id,
      templateVersion: 1,
      title: "精确预算",
      values,
    };
    const invalid = await req("employee", "/approvals/v2/prepare", {
      ...command,
      values: { budget: { amount: 9007199254740993.01, currency: "CNY" } },
    });
    expect(invalid.status).toBe(422);
    const prepared = await req("employee", "/approvals/v2/prepare", command);
    expect(prepared.status).toBe(200);
    const confirmation = await prepared.json();
    const executed = await req("employee", "/approvals/v2/commands", {
      command,
      confirmationId: confirmation.confirmationId,
      idempotencyKey: "money-http-submit",
    });
    expect(executed.status).toBe(200);
    const receipt = await executed.json();
    const instance = await (
      await req("employee", `/approvals/v2/instances/${receipt.resourceId}`)
    ).json();
    expect(instance.values).toEqual(values);
    expect(instance.revisions[0].values).toEqual(values);
  });

  it("lists only effective company memberships, defaults to the unique primary company and checks explicit scope", async () => {
    getConn()
      .prepare(
        "INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at) VALUES(?,?,?,?,'collaborative','active',?,?)",
      )
      .run(
        "review-extra-company",
        "review-person:employee",
        "review-test-b",
        "review-test-b",
        "now",
        "now",
      );
    const companies = await (
      await req("employee", "/approvals/v2/companies")
    ).json();
    expect(companies.map((c: { id: string }) => c.id)).toEqual([
      "review-test-a",
      "review-test-b",
    ]);
    const defaultContext = await req("employee", "/approvals/v2/context");
    expect(defaultContext.status).toBe(200);
    expect((await defaultContext.json()).tenant).toBe("review-test-a");
    expect(
      (
        await req("employee", "/approvals/v2/context", undefined, {
          "X-Review-Company": "review-test-b",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req("employee", "/approvals/v2/context", undefined, {
          "X-Review-Company": "other",
        })
      ).status,
    ).toBe(403);
  });
  it("stores actual uploaded bytes and prevents another employee from downloading them", async () => {
    const body = new FormData();
    body.set(
      "file",
      new File(["真实文件内容"], "材料.txt", { type: "text/plain" }),
    );
    const uploaded = await app.request(
      "http://localhost/api/approvals/v2/attachments",
      {
        method: "POST",
        headers: { cookie: "lingong_session=test-employee" },
        body,
      },
    );
    expect(uploaded.status).toBe(200);
    const file = await uploaded.json();
    const download = await req(
      "employee",
      `/approvals/v2/attachments/${file.id}`,
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("真实文件内容");
    expect(download.headers.get("content-disposition")).toContain(
      "attachment;",
    );
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(
      (await req("reviewer", `/approvals/v2/attachments/${file.id}`)).status,
    ).toBe(404);
    expect(
      (await req("employee", "/approvals/v2/instance-page?limit=0")).status,
    ).toBe(422);
  });
  it("enforces template lifecycle permissions and prevents submission after disable through real HTTP commands", async () => {
    const t = await publish();
    const command = {
      action: "disable",
      templateId: t.id,
      expectedVersion: 1,
      expectedLifecycleVersion: 0,
    };
    expect(
      (await req("employee", "/approvals/v2/prepare", command)).status,
    ).toBe(403);
    const p = await (
      await req("admin", "/approvals/v2/prepare", command)
    ).json();
    expect(
      (
        await req("admin", "/approvals/v2/commands", {
          command,
          confirmationId: p.confirmationId,
          idempotencyKey: "disable-http",
        })
      ).status,
    ).toBe(200);
    expect(
      await (await req("employee", "/approvals/v2/templates")).json(),
    ).toEqual([]);
    expect(
      (
        await req("employee", "/approvals/v2/prepare", {
          action: "submit",
          templateId: t.id,
          templateVersion: 1,
          title: "已停用",
          values: {},
        })
      ).status,
    ).toBe(409);
  });
  function overdue(action: "remind" | "transfer" = "remind") {
    const now = new Date(Date.now() - 3 * 3600000).toISOString(),
      db = getConn();
    const admin = new ReviewService(
      db,
      reviewContextForActor(db, "review-admin", "review-test-a"),
      now,
    );
    const employee = new ReviewService(
      db,
      reviewContextForActor(db, "review-employee", "review-test-a"),
      now,
    );
    return txImmediate(() => {
      const d = emptyReviewDefinition();
      d.nodes[1].timeoutHours = 1;
      d.nodes[1].operations = {
        timeout:
          action === "remind"
            ? { action }
            : {
                action,
                candidates: { kind: "named", userIds: ["review-admin"] },
                deadline: "reset",
              },
      };
      const t = admin.saveTemplate(undefined, undefined, d),
        pub = {
          action: "publish" as const,
          templateId: t.id,
          expectedVersion: 1,
        };
      admin.execute(pub, admin.prepare(pub).confirmationId, "timeout-publish");
      const submit = {
        action: "submit" as const,
        templateId: t.id,
        templateVersion: 1,
        title: "超时验证",
        values: {},
      };
      const r = employee.execute(
        submit,
        employee.prepare(submit).confirmationId,
        "timeout-submit",
      );
      const job = db
        .prepare(
          "SELECT id FROM execution_jobs WHERE job_type='review.timeout'",
        )
        .get() as { id: string };
      return { r, job, employee };
    });
  }
  it("dispatches an overdue reminder with real durable outbox and an atomic receipt", async () => {
    const { r, job } = overdue();
    expect(
      (
        getConn()
          .prepare("SELECT count(*) AS n FROM execution_outbox WHERE job_id=?")
          .get(job.id) as { n: number }
      ).n,
    ).toBe(1);
    expect(
      (await processExecutionJobById(job.id, "review-test-worker"))?.outcome,
    ).toBe("processed");
    expect(await processExecutionJobById(job.id, "second-worker")).toBeNull();
    const notices = await (
      await req("reviewer", "/approvals/v2/notifications")
    ).json();
    expect(
      notices.some((n: { message: string }) => n.message.includes("超时")),
    ).toBe(true);
    const detail = await (
      await req("employee", `/approvals/v2/instances/${r.resourceId}`)
    ).json();
    expect(detail.status).toBe("reviewing");
    expect(
      detail.events.filter(
        (e: { action: string }) => e.action === "timeout.reminded",
      ),
    ).toHaveLength(1);
  });
  it("automatically transfers only to the published qualified target", async () => {
    const { r, job } = overdue("transfer");
    expect(
      (await processExecutionJobById(job.id, "review-test-worker"))?.outcome,
    ).toBe("processed");
    const detail = await (
      await req("admin", `/approvals/v2/instances/${r.resourceId}`)
    ).json();
    expect(detail.allowedActions).toContain("approve");
    expect(detail.tasks[0].status).toBe("transferred");
    expect(detail.tasks[1].userId).toBe("review-admin");
  });
  it("ignores an old timeout after withdrawal", async () => {
    const { r, job, employee } = overdue();
    txImmediate(() => {
      const c = {
        action: "withdraw" as const,
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "取消",
      };
      employee.execute(
        c,
        employee.prepare(c).confirmationId,
        "timeout-withdraw",
      );
    });
    await processExecutionJobById(job.id, "review-test-worker");
    const result = getConn()
      .prepare("SELECT receipt_json FROM execution_jobs WHERE id=?")
      .get(job.id) as { receipt_json: string };
    expect(JSON.parse(result.receipt_json).status).toBe("skipped");
  });
  it("records needs-takeover instead of granting a revoked target", async () => {
    const { r, job } = overdue("transfer");
    getConn()
      .prepare("UPDATE users SET active=0 WHERE id=?")
      .run("review-admin");
    await processExecutionJobById(job.id, "review-test-worker");
    const detail = await (
      await req("employee", `/approvals/v2/instances/${r.resourceId}`)
    ).json();
    expect(detail.tasks).toHaveLength(1);
    expect(detail.blockedReason).toContain("超时升级");
  });
  it("does not disclose legacy notification cards outside the viewer's approvals", async () => {
    getConn()
      .prepare(
        "INSERT INTO wecom_cards(id,approval_id,title,body,status,payload,ts) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "private-card",
        "private-approval",
        "私有审批",
        "不可泄露的内容",
        "pending",
        "{}",
        "2026-10-04T00:00:00Z",
      );
    const result = await req("employee", "/wecom/cards");
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual([]);
  });
  it("rejects unauthenticated requests and cross-origin writes", async () => {
    expect((await req(undefined, "/approvals/v2/context")).status).toBe(401);
    expect(
      (
        await req(
          "admin",
          "/admin/approval-types/v2/templates",
          { definition: emptyReviewDefinition() },
          { origin: "https://attacker.invalid" },
        )
      ).status,
    ).toBe(403);
  });
  it("uses authoritative company scope and has no name/default-person fallback", async () => {
    expect(
      (
        await req("employee", "/approvals/v2/context", undefined, {
          "X-Review-Company": "review-test-b",
        })
      ).status,
    ).toBe(403);
    getConn()
      .prepare("UPDATE organization_memberships SET status='ended' WHERE id=?")
      .run("review-membership:employee");
    expect((await req("employee", "/approvals/v2/context")).status).toBe(403);
  });
  it("supports an authenticated end-to-end publish, submit and approve", async () => {
    const t = await publish();
    expect(
      await (await req("outsider", "/approvals/v2/templates")).json(),
    ).toEqual([]);
    const command = {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "内容评审",
      values: {},
    };
    const p = await (
      await req("employee", "/approvals/v2/prepare", command)
    ).json();
    const submitted = await req("employee", "/approvals/v2/commands", {
      command,
      confirmationId: p.confirmationId,
      idempotencyKey: "submit-instance",
    });
    expect(submitted.status).toBe(200);
    const r = await submitted.json();
    expect(
      (await req("admin", `/approvals/v2/instances/${r.resourceId}`)).status,
    ).toBe(404);
    expect(
      (await req("outsider", `/approvals/v2/instances/${r.resourceId}`)).status,
    ).toBe(404);
    const decision = {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "通过",
    };
    const confirm = await (
      await req("reviewer", "/approvals/v2/prepare", decision)
    ).json();
    expect(
      (
        await req("reviewer", "/approvals/v2/commands", {
          command: decision,
          confirmationId: confirm.confirmationId,
          idempotencyKey: "approve-instance",
        })
      ).status,
    ).toBe(200);
    const detail = await (
      await req("employee", `/approvals/v2/instances/${r.resourceId}`)
    ).json();
    expect(detail.status).toBe("approved");
    expect(detail.events).toHaveLength(2);
  });
  it("denies disabled users even with an unexpired session", async () => {
    getConn()
      .prepare("UPDATE users SET active=0 WHERE id=?")
      .run("review-employee");
    expect((await req("employee", "/approvals/v2/context")).status).toBe(401);
  });
  it("persists only the actor’s drafts and checks versions", async () => {
    const t = await publish(),
      input = {
        templateId: t.id,
        templateVersion: 1,
        title: "未完成",
        values: {},
      };
    const saved = await (
      await req("employee", "/approvals/v2/drafts", input)
    ).json();
    expect(
      await (await req("reviewer", "/approvals/v2/drafts")).json(),
    ).toEqual([]);
    expect(
      (
        await req("reviewer", "/approvals/v2/drafts", {
          ...input,
          id: saved.id,
          version: saved.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req("employee", "/approvals/v2/drafts", {
          ...input,
          id: saved.id,
          version: 999,
        })
      ).status,
    ).toBe(409);
  });
  it("rejects malformed commands without a server error", async () => {
    expect((await req("employee", "/approvals/v2/commands", {})).status).toBe(
      422,
    );
    expect((await req("employee", "/approvals/v2/prepare", null)).status).toBe(
      400,
    );
  });
});
