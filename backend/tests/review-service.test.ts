import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { freshTestDatabase } from "./support/pg.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import {
  ReviewService,
  type ReviewContext,
} from "../src/approval/review-service.js";
import {
  emptyReviewDefinition,
  type ReviewCommand,
} from "../../shared/review.js";
let db: PoolClient;
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
const transaction = async <T>(f: () => Promise<T>): Promise<T> => {
  await db.query("BEGIN");
  try {
    const result = await f();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
};
const run = async (
  actor: string,
  command: ReviewCommand,
  key: string = crypto.randomUUID(),
) =>
  (await transaction(async () => {
    const s = service(actor),
      p = (await s.prepare(command));
    return s.execute(command, p.confirmationId, key);
  }));
async function published() {
  const t = (await transaction(async () =>
    (service().saveTemplate(undefined, undefined, emptyReviewDefinition())),
  ));
  (await run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 }));
  return t;
}
async function submitted() {
  const t = (await published());
  return run("employee", {
    action: "submit",
    templateId: t.id,
    templateVersion: 1,
    title: "合作方案评审",
    values: {},
  });
}
beforeEach(async () => {
  await freshTestDatabase();
  db = await postgresPool().connect();
});
afterEach(async () => {
  db.release();
  await closePostgresPool();
});
describe("transactional generic review service", () => {
  it("persists placeholders as drafts but rejects them at the confirmed publish boundary", async () => {
    const definition = emptyReviewDefinition();
    definition.nodes[1].name = "新评审节点";
    const draft = (await transaction(async () => (service().saveTemplate(undefined, undefined, definition))));
    (await expect((async () => (service().prepare({ action: "publish", templateId: draft.id, expectedVersion: 1 })))()).rejects.toThrow("流程校验未通过"));
    expect((await service().templates(true)).find(t => t.id === draft.id)?.publishedVersion).toBeNull();
  });
  it("drains existing work while blocking new submissions and preserves original receipts", async () => {
    const oldMode = process.env.REVIEW_V2_NEW_REQUESTS,
      oldCompanies = process.env.REVIEW_V2_COMPANIES;
    try {
      process.env.REVIEW_V2_NEW_REQUESTS = "enabled";
      delete process.env.REVIEW_V2_COMPANIES;
      const t = (await published()),
        command: ReviewCommand = {
          action: "submit",
          templateId: t.id,
          templateVersion: 1,
          title: "排空验证",
          values: {},
        };
      const r = (await run("employee", command, "drain-submit"));
      process.env.REVIEW_V2_NEW_REQUESTS = "drain";
      (await expect((async () => (service("employee").prepare(command)))()).rejects.toThrow());
      expect(
        (await transaction(async () =>
          (await service("employee").execute(command, "consumed", "drain-submit")),
        )),
      ).toEqual(r);
      (await run("reviewer", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "",
      }));
      expect((await service("employee").instance(r.resourceId)).status).toBe(
        "approved",
      );
      process.env.REVIEW_V2_NEW_REQUESTS = "enabled";
      process.env.REVIEW_V2_COMPANIES = "other";
      (await expect((async () => (service("employee").prepare(command)))()).rejects.toThrow());
      process.env.REVIEW_V2_COMPANIES = "company";
      expect((await service("employee").prepare(command)).confirmationId).toBeTruthy();
    } finally {
      if (oldMode === undefined) delete process.env.REVIEW_V2_NEW_REQUESTS;
      else process.env.REVIEW_V2_NEW_REQUESTS = oldMode;
      if (oldCompanies === undefined) delete process.env.REVIEW_V2_COMPANIES;
      else process.env.REVIEW_V2_COMPANIES = oldCompanies;
    }
  });
  it("previews and copies compatible draft fields without destroying old material", async () => {
    const d = emptyReviewDefinition();
    d.fields = [
      { id: "keep", label: "保留", type: "text", required: true },
      { id: "removed", label: "删除字段", type: "text", required: false },
      { id: "changed", label: "改型", type: "text", required: false },
    ];
    const t = (await service().saveTemplate(undefined, undefined, d));
    (await run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 }));
    const old = (await service("employee").saveDraft({
      templateId: t.id,
      templateVersion: 1,
      title: "旧材料",
      values: { keep: "保留文本", removed: "不能丢", changed: "原文本" },
    }));
    d.fields = d.fields.filter((f) => f.id !== "removed");
    d.fields[1].type = "number";
    d.fields.push({ id: "new", label: "新增", type: "text", required: true });
    (await service().saveTemplate(t.id, 1, d));
    (await run("admin", { action: "publish", templateId: t.id, expectedVersion: 2 }));
    const preview = (await service("employee").draftUpgrade(old.id));
    expect(preview.values).toEqual({ keep: "保留文本" });
    expect(preview.omitted).toHaveLength(2);
    expect(preview.issues.length).toBeGreaterThan(0);
    (await expect((async () => (service("reviewer").draftUpgrade(old.id)))()).rejects.toThrow());
    (await expect((async () => (service("employee").upgradeDraft(old.id, 99, 2)))()).rejects.toThrow());
    (await expect((async () => (service("employee").upgradeDraft(old.id, 1, 1)))()).rejects.toThrow());
    const copy = (await service("employee").upgradeDraft(old.id, 1, 2));
    expect(copy.id).not.toBe(old.id);
    expect(
      (await service("employee")
        .drafts())
        .find((d) => d.id === old.id)?.values,
    ).toEqual(old.values);
    expect((await service().publishDiff(t.id)).changes).toEqual([]);
    (await expect((async () => (service("employee").publishDiff(t.id)))()).rejects.toThrow());
  });
  it("paginates within current participation and filters title and actionable tasks", async () => {
    for (let n = 0; n < 4; n++) {
      const t = (await published());
      (await run("employee", {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "内容 " + n,
        values: {},
      }));
    }
    const a = (await service("reviewer").instancePage({ filter: "todo", limit: 2 })),
      b = (await service("reviewer").instancePage({
        filter: "todo",
        limit: 2,
        cursor: a.nextCursor!,
      }));
    expect(a.items).toHaveLength(2);
    expect(b.items).toHaveLength(2);
    expect(b.nextCursor).toBeNull();
    expect(new Set([...a.items, ...b.items].map((i) => i.id)).size).toBe(4);
    (await db.query("UPDATE review_instances SET updated_at=$1, version=version+1",["2099-01-01T00:00:00Z"]));
    expect(
      (await service("reviewer")
        .instancePage({ filter: "todo", limit: 2, cursor: a.nextCursor! }))
        .items.map((i) => i.id),
    ).toEqual(b.items.map((i) => i.id));
    expect((await service("extra").instancePage({ q: "内容" })).items).toEqual([]);
    expect((await service("employee").instancePage({ filter: "todo" })).items).toEqual(
      [],
    );
    expect(
      (await service("employee").instancePage({ filter: "mine", q: "内容 3" })).items,
    ).toHaveLength(1);
    (await expect((async () => (service().instancePage({ cursor: "invalid" })))()).rejects.toThrow());
  });
  it("freezes attachment bytes and shares them only through scoped review participation", async () => {
    const file = (await service("employee").uploadAttachment(
      "../稿件.txt",
      Buffer.from("原稿"),
    ));
    const d = emptyReviewDefinition();
    d.fields = [
      { id: "files", label: "材料", type: "attachment", required: true },
    ];
    const t = (await service().saveTemplate(undefined, undefined, d));
    (await run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 }));
    const submit: ReviewCommand = {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "附件评审",
      values: { files: [file.id] },
    };
    (await expect((async () => (service("reviewer").prepare(submit)))()).rejects.toThrow());
    (await expect((async () => (service("reviewer").attachment(file.id)))()).rejects.toThrow());
    const r = (await run("employee", submit));
    expect(
      (await service("reviewer").attachment(file.id, r.resourceId)).content.toString(),
    ).toBe("原稿");
    (await expect((async () => (service("extra").attachment(file.id, r.resourceId)))()).rejects.toThrow());
    (await expect((async () => (service("employee", "other").attachment(file.id)))()).rejects.toThrow());
    const other = (await service("employee").uploadAttachment(
      "另稿.txt",
      Buffer.from("另稿"),
    ));
    (await expect((async () =>
      (service("reviewer").attachment(other.id, r.resourceId)))()).rejects.toThrow());
    (await db.query("UPDATE review_attachments SET content_base64=$1 WHERE id=$2",[Buffer.from("篡改").toString("base64"),file.id]));
    (await expect((async () =>
      (service("reviewer").attachment(file.id, r.resourceId)))()).rejects.toThrow());
    (await expect((async () =>
      (service("employee").uploadAttachment(
        "big",
        Buffer.alloc(2 * 1024 * 1024 + 1),
      )))()).rejects.toThrow());
  });
  it("publishing a revised disabled template does not enable it or mutate the old version", async () => {
    const t = (await published());
    (await run("admin", {
      action: "disable",
      templateId: t.id,
      expectedVersion: 1,
      expectedLifecycleVersion: 0,
    }));
    const d = emptyReviewDefinition();
    d.name = "新标题";
    (await service().saveTemplate(t.id, 1, d));
    (await run("admin", { action: "publish", templateId: t.id, expectedVersion: 2 }));
    expect((await service("employee").templates())).toEqual([]);
    expect((await service().templates(true))[0]).toMatchObject({
      enabled: false,
      version: 2,
      publishedVersion: 2,
      lifecycleVersion: 1,
    });
    expect(
      JSON.parse(
        (
          (await db.query("SELECT definition FROM review_versions WHERE tenant=$1 AND template_id=$2 AND version=1",["company",t.id])).rows[0] as { definition: string }
        ).definition,
      ).name,
    ).toBe("新评审流程");
    (await run("admin", {
      action: "enable",
      templateId: t.id,
      expectedVersion: 2,
      expectedLifecycleVersion: 1,
    }));
    expect((await service("employee").templates())[0].definition.name).toBe("新标题");
  });
  it("disables only new submissions, preserves active work and requires fresh confirmation after reopening", async () => {
    const t = (await published());
    const submit: ReviewCommand = {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "业务申请",
      values: {},
    };
    const old = (await service("employee").prepare(submit));
    const r = (await run("employee", submit));
    (await expect((async () =>
      (service("employee").prepare({
        action: "disable",
        templateId: t.id,
        expectedVersion: 1,
        expectedLifecycleVersion: 0,
      })))()).rejects.toThrow());
    const disable: ReviewCommand = {
      action: "disable",
      templateId: t.id,
      expectedVersion: 1,
      expectedLifecycleVersion: 0,
    };
    const receipt = (await run("admin", disable, "disable-test"));
    expect((await service("employee").templates())).toHaveLength(0);
    expect((await service().templates(true))[0].enabled).toBe(false);
    (await expect((async () => (service("employee").prepare(submit)))()).rejects.toThrow());
    (await run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "",
    }));
    expect((await service("employee").instance(r.resourceId)).status).toBe("approved");
    (await run("admin", {
      action: "enable",
      templateId: t.id,
      expectedVersion: 1,
      expectedLifecycleVersion: 1,
    }));
    expect((await service("employee").templates())).toHaveLength(1);
    (await expect((async () =>
      (await transaction(async () =>
        (await service("employee").execute(submit, old.confirmationId, "old-submit")),
      )))()).rejects.toThrow());
    expect(
      (await transaction(async () =>
        (await service().execute(disable, "already-used", "disable-test")),
      )),
    ).toEqual(receipt);
    (await expect((async () => (service().prepare(disable)))()).rejects.toThrow());
  });
  it("separates copy recipients, consultation and handling from review decisions", async () => {
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
    const t = (await service().saveTemplate(undefined, undefined, d));
    (await run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 }));
    const r = (await run("employee", {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "通用流程",
      values: {},
    }));
    expect(
      service("extra").actions((await service("extra").instance(r.resourceId))),
    ).toEqual([]);
    expect((await service("extra").notifications())).toHaveLength(1);
    (await run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "",
    }));
    expect(
      service("extra").actions((await service("extra").instance(r.resourceId))),
    ).toEqual(["complete"]);
    (await expect((async () =>
      (service("extra").prepare({
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 2,
        reason: "越权",
      })))()).rejects.toThrow());
    (await expect((async () =>
      (service("extra").prepare({
        action: "complete",
        instanceId: r.resourceId,
        expectedVersion: 2,
        reason: "",
      })))()).rejects.toThrow());
    (await run("extra", {
      action: "complete",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "已提供专业意见",
    }));
    (await run("employee", {
      action: "complete",
      instanceId: r.resourceId,
      expectedVersion: 3,
      reason: "办理完毕",
    }));
    const i = (await service("employee").instance(r.resourceId));
    expect(i.status).toBe("approved");
    expect(i.tasks.map((t) => t.status)).toEqual([
      "completed",
      "approved",
      "completed",
      "completed",
    ]);
  });
  async function advanced(mode: "single" | "all" | "sequential" = "single") {
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
    const t = (await service().saveTemplate(undefined, undefined, d));
    (await run("admin", { action: "publish", templateId: t.id, expectedVersion: 1 }));
    return run("employee", {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: "多阶段内容",
      values: { content: "初稿", reference: "fixed" },
    });
  }
  it("transfers responsibility without granting the old reviewer a vote", async () => {
    const r = (await advanced());
    (await run("reviewer", {
      action: "transfer",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "职责移交",
      targetUserId: "admin",
    }));
    expect(
      service("reviewer").actions((await service("reviewer").instance(r.resourceId))),
    ).not.toContain("approve");
    (await run("admin", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "接任通过",
    }));
    const i = (await service("employee").instance(r.resourceId));
    expect(i.status).toBe("approved");
    expect(i.tasks[0].status).toBe("transferred");
  });
  it("rejects transfer to self, requester and an unconfigured person", async () => {
    const r = (await advanced());
    for (const targetUserId of ["employee", "reviewer", "missing"])
      (await expect((async () =>
        (service("reviewer").prepare({
          action: "transfer",
          instanceId: r.resourceId,
          expectedVersion: 1,
          reason: "移交",
          targetUserId,
        })))()).rejects.toThrow());
  });
  it("retains old decisions but restarts every reviewer for new material", async () => {
    const r = (await advanced("all"));
    (await run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "同意初稿",
    }));
    (await run("admin", {
      action: "request_amendment",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "补充说明",
    }));
    expect((await service("employee").instance(r.resourceId)).status).toBe(
      "awaiting_amendment",
    );
    (await expect((async () =>
      (service("employee").prepare({
        action: "resubmit",
        instanceId: r.resourceId,
        expectedVersion: 3,
        reason: "修改",
        values: { content: "二稿", reference: "changed" },
      })))()).rejects.toThrow());
    (await run("employee", {
      action: "resubmit",
      instanceId: r.resourceId,
      expectedVersion: 3,
      reason: "补齐内容",
      values: { content: "二稿", reference: "fixed" },
    }));
    let i = (await service("employee").instance(r.resourceId));
    expect(i.round).toBe(2);
    expect(
      i.tasks.filter((t) => t.round === 1 && t.status === "approved"),
    ).toHaveLength(1);
    expect(
      i.tasks.filter((t) => t.round === 2 && t.status === "pending"),
    ).toHaveLength(2);
    (await run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 4,
      reason: "同意二稿",
    }));
    i = (await service("employee").instance(r.resourceId));
    expect(i.status).toBe("reviewing");
    expect(
      (await service("employee")
        .revisions(i.id))
        .map((r) => typeof r.values === "object" && r.values !== null && "content" in r.values ? r.values.content : undefined),
    ).toEqual(["初稿", "二稿"]);
  });
  it("withdraws suspended tasks and keeps immutable revisions", async () => {
    const r = (await advanced());
    (await run("reviewer", {
      action: "request_amendment",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "补充",
    }));
    (await run("employee", {
      action: "withdraw",
      instanceId: r.resourceId,
      expectedVersion: 2,
      reason: "不再申请",
    }));
    expect((await service("employee").instance(r.resourceId)).tasks[0].status).toBe(
      "cancelled",
    );
    expect((await service("employee").revisions(r.resourceId))).toHaveLength(1);
  });
  it("requires all countersigned reviewers and inserts sequential countersign after the caller", async () => {
    for (const mode of ["all", "sequential"] as const) {
      const r = (await advanced(mode));
      (await run("reviewer", {
        action: "countersign",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "请专业复核",
        targetUserId: "extra",
      }));
      if (mode === "sequential")
        (await expect((async () =>
          (service("extra").prepare({
            action: "approve",
            instanceId: r.resourceId,
            expectedVersion: 2,
            reason: "",
          })))()).rejects.toThrow());
      (await run("reviewer", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 2,
        reason: "",
      }));
      expect(
        service("extra").actions((await service("extra").instance(r.resourceId))),
      ).toContain("approve");
      (await run("extra", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 3,
        reason: "",
      }));
      expect((await service("employee").instance(r.resourceId)).status).toBe(
        "reviewing",
      );
      (await run("admin", {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 4,
        reason: "",
      }));
      expect((await service("employee").instance(r.resourceId)).status).toBe(
        "approved",
      );
    }
  });
  it("makes real in-app notifications visible only to their recipient", async () => {
    const r = (await advanced());
    const notices = (await service("reviewer").notifications()) as { id: string }[];
    expect(notices).toHaveLength(1);
    expect((await service("employee").notifications())).toEqual([]);
    (await expect((async () => (service("employee").readNotification(notices[0].id)))()).rejects.toThrow());
    expect((await service("reviewer").readNotification(notices[0].id)).id).toBe(
      notices[0].id,
    );
  });
  it("resolves published roles without falling back to a manager", async () => {
    const d = emptyReviewDefinition();
    d.nodes[1].assignee = { kind: "role", role: "content-reviewer" };
    (await expect((async () => {
      const t = (await service().saveTemplate(undefined, undefined, d));
      (await service().prepare({
        action: "publish",
        templateId: t.id,
        expectedVersion: 1,
      }));
    })()).rejects.toThrow());
    const context = {
      ...ctx(),
      people: people.map((p) => ({
        ...p,
        roles: p.id === "reviewer" ? ["content-reviewer"] : [],
      })),
    };
    const admin = new ReviewService(db, context, "2026-10-04T00:00:00.000Z");
    const t = (await admin.saveTemplate(undefined, undefined, d)),
      command: ReviewCommand = {
        action: "publish",
        templateId: t.id,
        expectedVersion: 1,
      };
    (await transaction(async () => {
      const p = (await admin.prepare(command));
      (await admin.execute(command, p.confirmationId, "role-publish"));
    }));
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
    const r = (await transaction(async () => {
      const p = (await employee.prepare(submit));
      return employee.execute(submit, p.confirmationId, "role-submit");
    }));
    expect((await employee.instance(r.resourceId)).tasks[0].userId).toBe("reviewer");
  });
  it("removes the owned draft atomically when it becomes an instance", async () => {
    const t = (await published()),
      s = service("employee"),
      d = (await s.saveDraft({
        templateId: t.id,
        templateVersion: 1,
        title: "草稿",
        values: {},
      }));
    (await run("employee", {
      action: "submit",
      templateId: t.id,
      templateVersion: 1,
      title: d.title,
      values: d.values,
      draft: { id: d.id, version: d.version },
    }));
    expect((await s.drafts())).toEqual([]);
    expect((await s.instances())).toHaveLength(1);
  });
  it("publishes, starts and completes an actual non-expense review", async () => {
    const r = (await submitted());
    expect((await service("reviewer").instances())).toHaveLength(1);
    (await run("reviewer", {
      action: "approve",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "内容完整",
    }));
    expect((await service("employee").instance(r.resourceId)).status).toBe("approved");
    expect(
      (await service("employee")
        .events(r.resourceId))
        .map((e) => e.action),
    ).toEqual(["submit", "approve"]);
  });
  it("isolates tenants and restricts instances even from administrators", async () => {
    const r = (await submitted());
    expect((await service("employee", "other").instances())).toEqual([]);
    (await expect((async () => (service("employee", "other").instance(r.resourceId)))()).rejects.toThrow());
    (await expect((async () => (service().instance(r.resourceId)))()).rejects.toThrow());
    expect((await service().instances())).toEqual([]);
  });
  it("requires current admin permission to publish or edit", async () => {
    (await expect((async () =>
      (service("employee").saveTemplate(
        undefined,
        undefined,
        emptyReviewDefinition(),
      )))()).rejects.toThrow());
    const t = (await published());
    (await expect((async () =>
      (service("employee").prepare({
        action: "publish",
        templateId: t.id,
        expectedVersion: 1,
      })))()).rejects.toThrow());
  });
  it("keeps published definitions and active instances immutable when draft is edited", async () => {
    const r = (await submitted()),
      i = (await service("employee").instance(r.resourceId)),
      t = (await service().templates(true))[0];
    const changed = structuredClone(t.definition);
    changed.name = "新流程";
    (await transaction(async () => (service().saveTemplate(t.id, 1, changed))));
    expect((await service("employee").templates())[0].definition.name).not.toBe(
      "新流程",
    );
    expect((await service("employee").instance(i.id)).definition).toEqual(i.definition);
    (await expect((async () =>
      (transaction(async () => (await service().saveTemplate(t.id, 1, changed)))))()).rejects.toThrow());
  });
  it("rejects forged or changed confirmation payloads", async () => {
    const t = (await published()),
      command: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "初始",
        values: {},
      };
    const p = (await transaction(async () => (service("employee").prepare(command))));
    (await expect((async () =>
      (await transaction(async () =>
        (await service("employee").execute(
          { ...command, title: "偷换" },
          p.confirmationId,
          "changed-key",
        )),
      )))()).rejects.toThrow());
    expect((await service("employee").instances())).toEqual([]);
  });
  it("does not permit token theft by another actor", async () => {
    const t = (await published()),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      };
    const p = (await service("employee").prepare(c));
    (await expect((async () =>
      (await transaction(async () =>
        (await service("admin").execute(c, p.confirmationId, "stolen-token")),
      )))()).rejects.toThrow());
  });
  it("replays receipts after expiry, and rejects reuse with changed commands", async () => {
    const t = (await published()),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = (await service("employee").prepare(c));
    const r = (await transaction(async () =>
      (await service("employee").execute(c, p.confirmationId, "stable-key")),
    ));
    expect(
      (await transaction(async () =>
        (await service("employee", "company", "2026-10-05T00:00:00.000Z").execute(
          c,
          p.confirmationId,
          "stable-key",
        )),
      )),
    ).toEqual(r);
    expect((await service("employee").instances())).toHaveLength(1);
    (await expect((async () =>
      (await transaction(async () =>
        (await service("employee").execute(
          { ...c, title: "替换" },
          p.confirmationId,
          "stable-key",
        )),
      )))()).rejects.toThrow());
  });
  it("rejects expired unused tokens without consuming them", async () => {
    const t = (await published()),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = (await service("employee").prepare(c));
    (await expect((async () =>
      (await transaction(async () =>
        (await service("employee", "company", "2026-10-05T00:00:00.000Z").execute(
          c,
          p.confirmationId,
          "expired-key",
        )),
      )))()).rejects.toThrow());
    expect((await service("employee").instances())).toHaveLength(0);
  });
  it("invalidates confirmation after authoritative organization changes", async () => {
    const t = (await published()),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = (await service("employee").prepare(c));
    const changed = new ReviewService(
      db,
      {
        ...ctx("employee"),
        people: [...people, { id: "new", name: "新人", managerIds: [] }],
      },
      "2026-10-04T00:00:00.000Z",
    );
    (await expect((async () =>
      (await transaction(async () => (await changed.execute(c, p.confirmationId, "org-change")))))()).rejects.toThrow());
  });
  it("stale decision cannot double advance", async () => {
    const r = (await submitted()),
      c: ReviewCommand = {
        action: "approve",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "",
      };
    const a = (await service("reviewer").prepare(c)),
      b = (await service("reviewer").prepare(c));
    (await transaction(async () =>
      (await service("reviewer").execute(c, a.confirmationId, "decision-a")),
    ));
    (await expect((async () =>
      (await transaction(async () =>
        (await service("reviewer").execute(c, b.confirmationId, "decision-b")),
      )))()).rejects.toThrow());
    expect((await service("employee").instance(r.resourceId)).version).toBe(2);
  });
  it("requires reason and ownership for withdraw", async () => {
    const r = (await submitted());
    (await expect((async () =>
      (service("reviewer").prepare({
        action: "withdraw",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "撤回",
      })))()).rejects.toThrow());
    (await expect((async () =>
      (service("employee").prepare({
        action: "withdraw",
        instanceId: r.resourceId,
        expectedVersion: 1,
        reason: "",
      })))()).rejects.toThrow());
    (await run("employee", {
      action: "withdraw",
      instanceId: r.resourceId,
      expectedVersion: 1,
      reason: "修改材料",
    }));
    expect((await service("reviewer").instance(r.resourceId)).tasks[0].status).toBe(
      "cancelled",
    );
  });
  it("rolls back instance, token, event and receipt together on storage failure", async () => {
    const t = (await published()),
      c: ReviewCommand = {
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: {},
      },
      p = (await service("employee").prepare(c));
    await db.query(`
      CREATE OR REPLACE FUNCTION review_fail_command_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.idempotency_key = 'rollback-key' THEN
          RAISE EXCEPTION 'injected' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER review_fail_command_insert_trigger
      BEFORE INSERT ON review_commands
      FOR EACH ROW EXECUTE FUNCTION review_fail_command_insert();
    `);
    try {
      await expect(transaction(async () =>
        service("employee").execute(c, p.confirmationId, "rollback-key"),
      )).rejects.toThrow("injected");
    } finally {
      await db.query("DROP TRIGGER IF EXISTS review_fail_command_insert_trigger ON review_commands; DROP FUNCTION IF EXISTS review_fail_command_insert();");
    }
    expect(await service("employee").instances()).toEqual([]);
    expect(
      (
        (await db.query("SELECT consumed FROM review_confirmations WHERE id=$1",[p.confirmationId])).rows[0] as { consumed: number }
      ).consumed,
    ).toBe(0);
  });
  it("applies schema before any mutation, with no amount override", async () => {
    const t = (await published());
    (await expect((async () =>
      (service("employee").prepare({
        action: "submit",
        templateId: t.id,
        templateVersion: 1,
        title: "申请",
        values: { amount_cny: 0 },
      })))()).rejects.toThrow());
  });
});
