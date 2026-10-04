import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteConn } from "../src/db.js";
import { reviewSchema } from "../src/approval/review-schema.js";
import {
  ReviewService,
  type ReviewContext,
} from "../src/approval/review-service.js";
import {
  emptyReviewDefinition,
  type ReviewCommand,
} from "../../shared/review.js";
const Database = createRequire(import.meta.url)("better-sqlite3");
let db: SqliteConn;
const people = [
  { id: "admin", name: "管理员", managerIds: ["reviewer"] },
  { id: "employee", name: "员工", managerIds: ["reviewer"] },
  { id: "reviewer", name: "评审人", managerIds: [] },
  { id: "extra", name: "加签人员", managerIds: [] },
];
const ctx = (actor = "admin", tenant = "company"): ReviewContext => ({
  actor,
  tenant,
  admin: actor === "admin",
  people,
});
const service = (
  actor = "admin",
  tenant = "company",
  now = "2026-10-04T00:00:00.000Z",
) => new ReviewService(db, ctx(actor, tenant), now);
const transaction = <T>(f: () => T) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = f();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
const run = (
  actor: string,
  command: ReviewCommand,
  key: string = crypto.randomUUID(),
) =>
  transaction(() => {
    const s = service(actor),
      p = s.prepare(command);
    return s.execute(command, p.confirmationId, key);
  });
function published() {
  const t = transaction(() =>
    service().saveTemplate(undefined, undefined, emptyReviewDefinition()),
  );
  run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 });
  return t;
}
function submitted() {
  const t = published();
  return run("employee", {
    action: "submit",
    templateId: t.id,
    templateVersion: 1,
    title: "合作方案评审",
    values: {},
  });
}
beforeEach(() => {
  db = new Database(":memory:") as SqliteConn;
  db.exec("PRAGMA foreign_keys=ON");
  reviewSchema.forEach((s) => db.exec(s));
});
afterEach(() => db.close());
describe("transactional generic review service", () => {
  it("drains existing work while blocking new submissions and preserves original receipts", () => {
    const oldMode = process.env.REVIEW_V2_NEW_REQUESTS,
      oldCompanies = process.env.REVIEW_V2_COMPANIES;
    try {
      process.env.REVIEW_V2_NEW_REQUESTS = "enabled";
      delete process.env.REVIEW_V2_COMPANIES;
      const t = published(),
        command: ReviewCommand = {
          action: "submit",
          templateId: t.id,
          templateVersion: 1,
          title: "排空验证",
          values: {},
        };
      const r = run("employee", command, "drain-submit");
      process.env.REVIEW_V2_NEW_REQUESTS = "drain";
      expect(() => service("employee").prepare(command)).toThrow();
      expect(
        transaction(() =>
          service("employee").execute(command, "consumed", "drain-submit"),
        ),
      ).toEqual(r);
      run("reviewer", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "",
      });
      expect(service("employee").instance(r.resourceId).status).toBe(
        "approved",
      );
      process.env.REVIEW_V2_NEW_REQUESTS = "enabled";
      process.env.REVIEW_V2_COMPANIES = "other";
      expect(() => service("employee").prepare(command)).toThrow();
      process.env.REVIEW_V2_COMPANIES = "company";
      expect(service("employee").prepare(command).confirmationId).toBeTruthy();
    } finally {
      if (oldMode === undefined) delete process.env.REVIEW_V2_NEW_REQUESTS;
      else process.env.REVIEW_V2_NEW_REQUESTS = oldMode;
      if (oldCompanies === undefined) delete process.env.REVIEW_V2_COMPANIES;
      else process.env.REVIEW_V2_COMPANIES = oldCompanies;
    }
  });
  it("previews and copies compatible draft fields without destroying old material", () => {
    const d = emptyReviewDefinition();
    d.fields = [
      { id: "keep", label: "保留", type: "text", required: true },
      { id: "removed", label: "删除字段", type: "text", required: false },
      { id: "changed", label: "改型", type: "text", required: false },
    ];
    const t = service().saveTemplate(undefined, undefined, d);
    run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 });
    const old = service("employee").saveDraft({
      templateId: t.id,
      templateVersion: 1,
      title: "旧材料",
      values: { keep: "保留文本", removed: "不能丢", changed: "原文本" },
    });
    d.fields = d.fields.filter((f) => f.id !== "removed");
    d.fields[1].type = "number";
    d.fields.push({ id: "new", label: "新增", type: "text", required: true });
    service().saveTemplate(t.id, 1, d);
    run("admin", { action: "publish", templateId: t.id, expectedVersion: 2 });
    const preview = service("employee").draftUpgrade(old.id);
    expect(preview.values).toEqual({ keep: "保留文本" });
    expect(preview.omitted).toHaveLength(2);
    expect(preview.issues.length).toBeGreaterThan(0);
    expect(() => service("reviewer").draftUpgrade(old.id)).toThrow();
    expect(() => service("employee").upgradeDraft(old.id, 99, 2)).toThrow();
    expect(() => service("employee").upgradeDraft(old.id, 1, 1)).toThrow();
    const copy = service("employee").upgradeDraft(old.id, 1, 2);
    expect(copy.id).not.toBe(old.id);
    expect(
      service("employee")
        .drafts()
        .find((d) => d.id === old.id)?.values,
    ).toEqual(old.values);
    expect(service().publishDiff(t.id).changes).toEqual([]);
    expect(() => service("employee").publishDiff(t.id)).toThrow();
  });
  it("paginates within current participation and filters title and actionable tasks", () => {
    for (let n = 0; n < 4; n++) {
      const t = published();
      run("employee", {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "内容 " + n,
        values: {},
      });
    }
    const a = service("reviewer").instancePage({ filter: "todo", limit: 2 }),
      b = service("reviewer").instancePage({
        filter: "todo",
        limit: 2,
        cursor: a.nextCursor!,
      });
    expect(a.items).toHaveLength(2);
    expect(b.items).toHaveLength(2);
    expect(b.nextCursor).toBeNull();
    expect(new Set([...a.items, ...b.items].map((i) => i.id)).size).toBe(4);
    db.prepare("UPDATE review_instances SET updated_at=?").run(
      "2099-01-01T00:00:00Z",
    );
    expect(
      service("reviewer")
        .instancePage({ filter: "todo", limit: 2, cursor: a.nextCursor! })
        .items.map((i) => i.id),
    ).toEqual(b.items.map((i) => i.id));
    expect(service("extra").instancePage({ q: "内容" }).items).toEqual([]);
    expect(service("employee").instancePage({ filter: "todo" }).items).toEqual(
      [],
    );
    expect(
      service("employee").instancePage({ filter: "mine", q: "内容 3" }).items,
    ).toHaveLength(1);
    expect(() => service().instancePage({ cursor: "invalid" })).toThrow();
  });
  it("freezes attachment bytes and shares them only through scoped review participation", () => {
    const file = service("employee").uploadAttachment(
      "../稿件.txt",
      Buffer.from("原稿"),
    );
    const d = emptyReviewDefinition();
    d.fields = [
      { id: "files", label: "材料", type: "attachment", required: true },
    ];
    const t = service().saveTemplate(undefined, undefined, d);
    run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 });
    const submit: ReviewCommand = {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "附件评审",
      values: { files: [file.id] },
    };
    expect(() => service("reviewer").prepare(submit)).toThrow();
    expect(() => service("reviewer").attachment(file.id)).toThrow();
    const r = run("employee", submit);
    expect(
      service("reviewer").attachment(file.id, r.resourceId).content.toString(),
    ).toBe("原稿");
    expect(() => service("extra").attachment(file.id, r.resourceId)).toThrow();
    expect(() => service("employee", "other").attachment(file.id)).toThrow();
    const other = service("employee").uploadAttachment(
      "另稿.txt",
      Buffer.from("另稿"),
    );
    expect(() =>
      service("reviewer").attachment(other.id, r.resourceId),
    ).toThrow();
    db.prepare("UPDATE review_attachments SET content_base64=? WHERE id=?").run(
      Buffer.from("篡改").toString("base64"),
      file.id,
    );
    expect(() =>
      service("reviewer").attachment(file.id, r.resourceId),
    ).toThrow();
    expect(() =>
      service("employee").uploadAttachment(
        "big",
        Buffer.alloc(2 * 1024 * 1024 + 1),
      ),
    ).toThrow();
  });
  it("publishing a revised disabled template does not enable it or mutate the old version", () => {
    const t = published();
    run("admin", {
      action: "disable",
      templateId: t.id,
      expectedVersion: 1,
      expectedLifecycleVersion: 0,
    });
    const d = emptyReviewDefinition();
    d.name = "新标题";
    service().saveTemplate(t.id, 1, d);
    run("admin", { action: "publish", templateId: t.id, expectedVersion: 2 });
    expect(service("employee").templates()).toEqual([]);
    expect(service().templates(true)[0]).toMatchObject({
      enabled: false,
      version: 2,
      publishedVersion: 2,
      lifecycleVersion: 1,
    });
    expect(
      JSON.parse(
        (
          db
            .prepare(
              "SELECT definition FROM review_versions WHERE tenant=? AND template_id=? AND version=1",
            )
            .get("company", t.id) as { definition: string }
        ).definition,
      ).name,
    ).toBe("新评审流程");
    run("admin", {
      action: "enable",
      templateId: t.id,
      expectedVersion: 2,
      expectedLifecycleVersion: 1,
    });
    expect(service("employee").templates()[0].definition.name).toBe("新标题");
  });
  it("disables only new submissions, preserves active work and requires fresh confirmation after reopening", () => {
    const t = published();
    const submit: ReviewCommand = {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "业务申请",
      values: {},
    };
    const old = service("employee").prepare(submit);
    const r = run("employee", submit);
    expect(() =>
      service("employee").prepare({
        action: "disable",
        templateId: t.id,
        expectedVersion: 1,
        expectedLifecycleVersion: 0,
      }),
    ).toThrow();
    const disable: ReviewCommand = {
      action: "disable",
      templateId: t.id,
      expectedVersion: 1,
      expectedLifecycleVersion: 0,
    };
    const receipt = run("admin", disable, "disable-test");
    expect(service("employee").templates()).toHaveLength(0);
    expect(service().templates(true)[0].enabled).toBe(false);
    expect(() => service("employee").prepare(submit)).toThrow();
    run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "",
    });
    expect(service("employee").instance(r.resourceId).status).toBe("approved");
    run("admin", {
      action: "enable",
      templateId: t.id,
      expectedVersion: 1,
      expectedLifecycleVersion: 1,
    });
    expect(service("employee").templates()).toHaveLength(1);
    expect(() =>
      transaction(() =>
        service("employee").execute(submit, old.confirmationId, "old-submit"),
      ),
    ).toThrow();
    expect(
      transaction(() =>
        service().execute(disable, "already-used", "disable-test"),
      ),
    ).toEqual(receipt);
    expect(() => service().prepare(disable)).toThrow();
  });
  it("separates copy recipients, consultation and handling from review decisions", () => {
    const d = emptyReviewDefinition();
    d.nodes[1].next = "consult";
    d.nodes.splice(1, 0, {
      id: "copy",
      name: "抄送",
      type: "cc",
      mode: "all",
      assignee: { kind: "named", userIds: ["extra"] },
      next: d.nodes[1].id,
    });
    d.nodes[0].next = "copy";
    d.nodes.splice(
      d.nodes.length - 1,
      0,
      {
        id: "consult",
        name: "征询",
        type: "consult",
        mode: "single",
        assignee: { kind: "named", userIds: ["extra"] },
        next: "handle",
      },
      {
        id: "handle",
        name: "办理",
        type: "handler",
        mode: "single",
        assignee: { kind: "named", userIds: ["employee"] },
        next: d.nodes[d.nodes.length - 1].id,
      },
    );
    const t = service().saveTemplate(undefined, undefined, d);
    run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 });
    const r = run("employee", {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "通用流程",
      values: {},
    });
    expect(
      service("extra").actions(service("extra").instance(r.resourceId)),
    ).toEqual([]);
    expect(service("extra").notifications()).toHaveLength(1);
    run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "",
    });
    expect(
      service("extra").actions(service("extra").instance(r.resourceId)),
    ).toEqual(["complete"]);
    expect(() =>
      service("extra").prepare({
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 2,
        reason: "越权",
      }),
    ).toThrow();
    expect(() =>
      service("extra").prepare({
        action: "complete",
        instanceId: r.resourceId,
        expectedVersion: 2,
        reason: "",
      }),
    ).toThrow();
    run("extra", {
      action: "complete",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "已提供专业意见",
    });
    run("employee", {
      action: "complete",
      instanceId: r.resourceId,
      expectedVersion: 3,
      reason: "办理完毕",
    });
    const i = service("employee").instance(r.resourceId);
    expect(i.status).toBe("approved");
    expect(i.tasks.map((t) => t.status)).toEqual([
      "completed",
      "approved",
      "completed",
      "completed",
    ]);
  });
  function advanced(mode: "single" | "all" | "sequential" = "single") {
    const d = emptyReviewDefinition();
    d.fields = [
      { id: "content", label: "内容", type: "text", required: true },
      { id: "reference", label: "不可改引用", type: "text", required: true },
    ];
    Object.assign(d.nodes[1], {
      mode,
      assignee: {
        kind: "named",
        userIds: mode === "single" ? ["reviewer"] : ["reviewer", "admin"],
      },
      operations: {
        transfer: {
          candidates: { kind: "named", userIds: ["admin"] },
          deadline: "preserve",
        },
        ...(mode !== "single"
          ? {
              countersign: {
                candidates: { kind: "named", userIds: ["extra"] },
              },
            }
          : {}),
        amendment: { fields: ["content"], restart: "start" },
      },
    });
    const t = service().saveTemplate(undefined, undefined, d);
    run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 });
    return run("employee", {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "多阶段内容",
      values: { content: "初稿", reference: "fixed" },
    });
  }
  it("transfers responsibility without granting the old reviewer a vote", () => {
    const r = advanced();
    run("reviewer", {
      action: "transfer",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "职责移交",
      targetUserId: "admin",
    });
    expect(
      service("reviewer").actions(service("reviewer").instance(r.resourceId)),
    ).not.toContain("approve");
    run("admin", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "接任通过",
    });
    const i = service("employee").instance(r.resourceId);
    expect(i.status).toBe("approved");
    expect(i.tasks[0].status).toBe("transferred");
  });
  it("rejects transfer to self, requester and an unconfigured person", () => {
    const r = advanced();
    for (const targetUserId of ["employee", "reviewer", "missing"])
      expect(() =>
        service("reviewer").prepare({
          action: "transfer",
          instanceId: r.resourceId,
          expectedVersion: 1,
          reason: "移交",
          targetUserId,
        }),
      ).toThrow();
  });
  it("retains old decisions but restarts every reviewer for new material", () => {
    const r = advanced("all");
    run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "同意初稿",
    });
    run("admin", {
      action: "request_amendment",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "补充说明",
    });
    expect(service("employee").instance(r.resourceId).status).toBe(
      "awaiting_amendment",
    );
    expect(() =>
      service("employee").prepare({
        action: "resubmit",
        instanceId: r.resourceId,
        expectedVersion: 3,
        reason: "修改",
        values: { content: "二稿", reference: "changed" },
      }),
    ).toThrow();
    run("employee", {
      action: "resubmit",
      instanceId: r.resourceId,
      expectedVersion: 3,
      reason: "补齐内容",
      values: { content: "二稿", reference: "fixed" },
    });
    let i = service("employee").instance(r.resourceId);
    expect(i.round).toBe(2);
    expect(
      i.tasks.filter((t) => t.round === 1 && t.status === "approved"),
    ).toHaveLength(1);
    expect(
      i.tasks.filter((t) => t.round === 2 && t.status === "pending"),
    ).toHaveLength(2);
    run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 4,
      reason: "同意二稿",
    });
    i = service("employee").instance(r.resourceId);
    expect(i.status).toBe("reviewing");
    expect(
      service("employee")
        .revisions(i.id)
        .map((r) => r.values.content),
    ).toEqual(["初稿", "二稿"]);
  });
  it("withdraws suspended tasks and keeps immutable revisions", () => {
    const r = advanced();
    run("reviewer", {
      action: "request_amendment",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "补充",
    });
    run("employee", {
      action: "withdraw",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "不再申请",
    });
    expect(service("employee").instance(r.resourceId).tasks[0].status).toBe(
      "cancelled",
    );
    expect(service("employee").revisions(r.resourceId)).toHaveLength(1);
  });
  it("requires all countersigned reviewers and inserts sequential countersign after the caller", () => {
    for (const mode of ["all", "sequential"] as const) {
      const r = advanced(mode);
      run("reviewer", {
        action: "countersign",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "请专业复核",
        targetUserId: "extra",
      });
      if (mode === "sequential")
        expect(() =>
          service("extra").prepare({
            action: "approve",
            instanceId: r.resourceId,
            expectedVersion: 2,
            reason: "",
          }),
        ).toThrow();
      run("reviewer", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 2,
        reason: "",
      });
      expect(
        service("extra").actions(service("extra").instance(r.resourceId)),
      ).toContain("approve");
      run("extra", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 3,
        reason: "",
      });
      expect(service("employee").instance(r.resourceId).status).toBe(
        "reviewing",
      );
      run("admin", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 4,
        reason: "",
      });
      expect(service("employee").instance(r.resourceId).status).toBe(
        "approved",
      );
    }
  });
  it("makes real in-app notifications visible only to their recipient", () => {
    const r = advanced();
    const notices = service("reviewer").notifications() as { id: string }[];
    expect(notices).toHaveLength(1);
    expect(service("employee").notifications()).toEqual([]);
    expect(() => service("employee").readNotification(notices[0].id)).toThrow();
    expect(service("reviewer").readNotification(notices[0].id).id).toBe(
      notices[0].id,
    );
  });
  it("resolves published roles without falling back to a manager", () => {
    const d = emptyReviewDefinition();
    d.nodes[1].assignee = { kind: "role", role: "content-reviewer" };
    expect(() => {
      const t = service().saveTemplate(undefined, undefined, d);
      service().prepare({
        action: "publish",
        templateId: t.id,
        expectedVersion: 1,
      });
    }).toThrow();
    const context = {
      ...ctx(),
      people: people.map((p) => ({
        ...p,
        roles: p.id === "reviewer" ? ["content-reviewer"] : [],
      })),
    };
    const admin = new ReviewService(db, context, "2026-10-04T00:00:00.000Z");
    const t = admin.saveTemplate(undefined, undefined, d),
      command: ReviewCommand = {
        action: "publish",
        templateId: t.id,
        expectedVersion: 1,
      };
    transaction(() => {
      const p = admin.prepare(command);
      admin.execute(command, p.confirmationId, "role-publish");
    });
    const employee = new ReviewService(
      db,
      { ...context, actor: "employee", admin: false },
      "2026-10-04T00:00:00.000Z",
    );
    const submit: ReviewCommand = {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "稿件",
      values: {},
    };
    const r = transaction(() => {
      const p = employee.prepare(submit);
      return employee.execute(submit, p.confirmationId, "role-submit");
    });
    expect(employee.instance(r.resourceId).tasks[0].userId).toBe("reviewer");
  });
  it("removes the owned draft atomically when it becomes an instance", () => {
    const t = published(),
      s = service("employee"),
      d = s.saveDraft({
        templateId: t.id,
        templateVersion: 1,
        title: "草稿",
        values: {},
      });
    run("employee", {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: d.title,
      values: d.values,
      draft: { id: d.id, version: d.version },
    });
    expect(s.drafts()).toEqual([]);
    expect(s.instances()).toHaveLength(1);
  });
  it("publishes, starts and completes an actual non-expense review", () => {
    const r = submitted();
    expect(service("reviewer").instances()).toHaveLength(1);
    run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "内容完整",
    });
    expect(service("employee").instance(r.resourceId).status).toBe("approved");
    expect(
      service("employee")
        .events(r.resourceId)
        .map((e) => e.action),
    ).toEqual(["submit", "approve"]);
  });
  it("isolates tenants and restricts instances even from administrators", () => {
    const r = submitted();
    expect(service("employee", "other").instances()).toEqual([]);
    expect(() => service("employee", "other").instance(r.resourceId)).toThrow();
    expect(() => service().instance(r.resourceId)).toThrow();
    expect(service().instances()).toEqual([]);
  });
  it("requires current admin permission to publish or edit", () => {
    expect(() =>
      service("employee").saveTemplate(
        undefined,
        undefined,
        emptyReviewDefinition(),
      ),
    ).toThrow();
    const t = published();
    expect(() =>
      service("employee").prepare({
        action: "publish",
        templateId: t.id,
        expectedVersion: 1,
      }),
    ).toThrow();
  });
  it("keeps published definitions and active instances immutable when draft is edited", () => {
    const r = submitted(),
      i = service("employee").instance(r.resourceId),
      t = service().templates(true)[0];
    const changed = structuredClone(t.definition);
    changed.name = "新流程";
    transaction(() => service().saveTemplate(t.id, 1, changed));
    expect(service("employee").templates()[0].definition.name).not.toBe(
      "新流程",
    );
    expect(service("employee").instance(i.id).definition).toEqual(i.definition);
    expect(() =>
      transaction(() => service().saveTemplate(t.id, 1, changed)),
    ).toThrow();
  });
  it("rejects forged or changed confirmation payloads", () => {
    const t = published(),
      command: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "初始",
        values: {},
      };
    const p = transaction(() => service("employee").prepare(command));
    expect(() =>
      transaction(() =>
        service("employee").execute(
          { ...command, title: "偷换" },
          p.confirmationId,
          "changed-key",
        ),
      ),
    ).toThrow();
    expect(service("employee").instances()).toEqual([]);
  });
  it("does not permit token theft by another actor", () => {
    const t = published(),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      };
    const p = service("employee").prepare(c);
    expect(() =>
      transaction(() =>
        service("admin").execute(c, p.confirmationId, "stolen-token"),
      ),
    ).toThrow();
  });
  it("replays receipts after expiry, and rejects reuse with changed commands", () => {
    const t = published(),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = service("employee").prepare(c);
    const r = transaction(() =>
      service("employee").execute(c, p.confirmationId, "stable-key"),
    );
    expect(
      transaction(() =>
        service("employee", "company", "2026-10-05T00:00:00.000Z").execute(
          c,
          p.confirmationId,
          "stable-key",
        ),
      ),
    ).toEqual(r);
    expect(service("employee").instances()).toHaveLength(1);
    expect(() =>
      transaction(() =>
        service("employee").execute(
          { ...c, title: "替换" },
          p.confirmationId,
          "stable-key",
        ),
      ),
    ).toThrow();
  });
  it("rejects expired unused tokens without consuming them", () => {
    const t = published(),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = service("employee").prepare(c);
    expect(() =>
      transaction(() =>
        service("employee", "company", "2026-10-05T00:00:00.000Z").execute(
          c,
          p.confirmationId,
          "expired-key",
        ),
      ),
    ).toThrow();
    expect(service("employee").instances()).toHaveLength(0);
  });
  it("invalidates confirmation after authoritative organization changes", () => {
    const t = published(),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = service("employee").prepare(c);
    const changed = new ReviewService(
      db,
      {
        ...ctx("employee"),
        people: [...people, { id: "new", name: "新人", managerIds: [] }],
      },
      "2026-10-04T00:00:00.000Z",
    );
    expect(() =>
      transaction(() => changed.execute(c, p.confirmationId, "org-change")),
    ).toThrow();
  });
  it("stale decision cannot double advance", () => {
    const r = submitted(),
      c: ReviewCommand = {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "",
      };
    const a = service("reviewer").prepare(c),
      b = service("reviewer").prepare(c);
    transaction(() =>
      service("reviewer").execute(c, a.confirmationId, "decision-a"),
    );
    expect(() =>
      transaction(() =>
        service("reviewer").execute(c, b.confirmationId, "decision-b"),
      ),
    ).toThrow();
    expect(service("employee").instance(r.resourceId).version).toBe(2);
  });
  it("requires reason and ownership for withdraw", () => {
    const r = submitted();
    expect(() =>
      service("reviewer").prepare({
        action: "withdraw",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "撤回",
      }),
    ).toThrow();
    expect(() =>
      service("employee").prepare({
        action: "withdraw",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "",
      }),
    ).toThrow();
    run("employee", {
      action: "withdraw",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "修改材料",
    });
    expect(service("reviewer").instance(r.resourceId).tasks[0].status).toBe(
      "cancelled",
    );
  });
  it("rolls back instance, token, event and receipt together on storage failure", () => {
    const t = published(),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = service("employee").prepare(c);
    db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON review_commands BEGIN SELECT RAISE(ABORT,'injected'); END",
    );
    expect(() =>
      transaction(() =>
        service("employee").execute(c, p.confirmationId, "rollback-key"),
      ),
    ).toThrow();
    expect(service("employee").instances()).toEqual([]);
    expect(
      (
        db
          .prepare("SELECT consumed FROM review_confirmations WHERE id=?")
          .get(p.confirmationId) as { consumed: number }
      ).consumed,
    ).toBe(0);
  });
  it("applies schema before any mutation, with no amount override", () => {
    const t = published();
    expect(() =>
      service("employee").prepare({
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: { amount_cny: 0 },
      }),
    ).toThrow();
  });
});
