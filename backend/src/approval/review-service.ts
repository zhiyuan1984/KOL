import { reviewResolver } from "./review-resolver.js";
import { reviewIntake } from "./review-rollout.js";
import { definitionDiff } from "./review-diff.js";
import { createHash, randomUUID } from "node:crypto";
import type { SqliteConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import type {
  ReviewCommand,
  ReviewDefinition,
  ReviewDraft,
  ReviewInstance,
  ReviewNode,
  ReviewTemplate,
  ReviewTask,
  ReviewOrganizationContext,
  ReviewIssue,
  ReviewTraceStep,
} from "../../../shared/review.js";
import {
  REVIEW_ACTIONS,
  currentTasks,
  normalizeTasks,
  taskPolicy,
  applyReviewOperation,
  reassignTask,
} from "./review-operations.js";
import { enqueueExecutionJob } from "../execution-jobs/store.js";
import {
  advanceReview,
  decideReview,
  validateDefinition,
  validatePublicationNames,
  validateValues,
} from "./review-engine.js";

export type ReviewContext = {
  organization?: ReviewOrganizationContext;
  tenant: string;
  actor: string;
  admin: boolean;
  people: {
    id: string;
    name: string;
    managerIds: string[];
    roles?: string[];
  }[];
};
type Row = Record<string, any>;
const fail = (status: number, message: string): never => {
  throw new HttpFail(status, { message });
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Row)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export class ReviewService {
  constructor(
    private db: SqliteConn,
    readonly ctx: ReviewContext,
    private now = new Date().toISOString(),
  ) {}
  private admin() {
    if (!this.ctx.admin) fail(403, "需要流程管理权限");
  }
  uploadAttachment(name: string, content: Buffer) {
    if (!content.length || content.length > 2 * 1024 * 1024)
      fail(413, "附件须为 1 字节至 2 MiB");
    const used = this.db
      .prepare(
        "SELECT COALESCE(SUM(size_bytes),0) AS total FROM review_attachments WHERE tenant=? AND actor=?",
      )
      .get(this.ctx.tenant, this.ctx.actor) as Row;
    if (Number(used.total) + content.length > 100 * 1024 * 1024)
      fail(
        413,
        "当前组织的个人评审附件空间已达 100 MiB，请联系管理员处理保留策略",
      );
    const id = randomUUID(),
      safe =
        name.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 180) || "attachment";
    const digest = createHash("sha256").update(content).digest("hex");
    this.db
      .prepare(
        "INSERT INTO review_attachments(tenant,id,actor,name,size_bytes,sha256,content_base64,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        this.ctx.tenant,
        id,
        this.ctx.actor,
        safe,
        content.length,
        digest,
        content.toString("base64"),
        this.now,
      );
    return { id, name: safe, size: content.length, sha256: digest };
  }
  attachment(id: string, instanceId?: string) {
    if (instanceId) {
      this.instance(instanceId);
      if (
        !this.db
          .prepare(
            "SELECT attachment_id FROM review_attachment_refs WHERE tenant=? AND instance_id=? AND attachment_id=?",
          )
          .get(this.ctx.tenant, instanceId, id)
      )
        fail(404, "附件不属于此评审");
    }
    const row = this.db
      .prepare(
        `SELECT * FROM review_attachments WHERE tenant=? AND id=? ${instanceId ? "" : "AND actor=?"}`,
      )
      .get(this.ctx.tenant, id, ...(instanceId ? [] : [this.ctx.actor])) as
      | Row
      | undefined;
    if (!row) fail(404, "附件不存在或不可见");
    const content = Buffer.from(row!.content_base64, "base64");
    if (createHash("sha256").update(content).digest("hex") !== row!.sha256)
      fail(409, "附件完整性检查失败");
    return {
      id,
      name: String(row!.name),
      size: Number(row!.size_bytes),
      sha256: String(row!.sha256),
      content,
    };
  }
  private attachmentIds(
    d: ReviewDefinition,
    values: Record<string, unknown>,
  ): string[] {
    return [
      ...new Set(
        d.fields
          .filter((f) => f.type === "attachment")
          .flatMap((f) =>
            Array.isArray(values[f.id]) ? (values[f.id] as string[]) : [],
          ),
      ),
    ];
  }
  private checkAttachments(
    d: ReviewDefinition,
    values: Record<string, unknown>,
  ) {
    for (const id of this.attachmentIds(d, values)) this.attachment(id);
  }
  drafts(): ReviewDraft[] {
    return (
      this.db
        .prepare(
          "SELECT payload FROM review_drafts WHERE tenant=? AND actor=? ORDER BY updated_at DESC LIMIT 100",
        )
        .all(this.ctx.tenant, this.ctx.actor) as Row[]
    ).map((r) => JSON.parse(r.payload));
  }
  draftUpgrade(id: string) {
    const row = this.db
      .prepare(
        "SELECT payload FROM review_drafts WHERE tenant=? AND actor=? AND id=?",
      )
      .get(this.ctx.tenant, this.ctx.actor, id) as Row | undefined;
    if (!row) fail(404, "草稿不存在");
    const source = JSON.parse(row!.payload) as ReviewDraft;
    const t = this.template(source.templateId);
    if (!t.published_version || t.enabled !== 1)
      fail(409, "流程未发布或已停用，原草稿仍保留");
    const old = this.definition(source.templateId, source.templateVersion),
      current = this.definition(source.templateId, t.published_version);
    const values: Record<string, unknown> = {},
      omitted: {
        field: string;
        label: string;
        value: unknown;
        reason: string;
      }[] = [];
    for (const [id, value] of Object.entries(source.values)) {
      const a = old.fields.find((f) => f.id === id),
        b = current.fields.find((f) => f.id === id);
      if (
        a &&
        b &&
        a.type === b.type &&
        !validateValues(
          { ...current, fields: [{ ...b, required: false }] },
          { [id]: value },
        ).length
      )
        values[id] = value;
      else
        omitted.push({
          field: id,
          label: a?.label || id,
          value,
          reason: !b ? "字段已删除" : "类型或选项已变化",
        });
    }
    return {
      source,
      templateVersion: t.published_version,
      values,
      omitted,
      changes: definitionDiff(old, current),
      issues: validateValues(current, values),
    };
  }
  upgradeDraft(id: string, expectedVersion: number, targetVersion: number) {
    const preview = this.draftUpgrade(id);
    if (
      preview.source.version !== expectedVersion ||
      preview.templateVersion !== targetVersion
    )
      fail(409, "草稿或流程已变化，请重新查看升级预览");
    // Copy rather than overwrite: omitted material remains accessible in the original draft.
    return this.saveDraft({
      templateId: preview.source.templateId,
      templateVersion: targetVersion,
      title: preview.source.title,
      values: preview.values,
    });
  }
  publishDiff(id: string) {
    this.admin();
    const t = this.template(id);
    return {
      version: t.version,
      publishedVersion: t.published_version,
      changes: definitionDiff(
        t.published_version
          ? this.definition(id, t.published_version)
          : undefined,
        JSON.parse(t.definition),
      ),
    };
  }
  saveDraft(input: {
    id?: string;
    version?: number;
    templateId: string;
    templateVersion: number;
    title: string;
    values: Record<string, unknown>;
  }): ReviewDraft {
    const d = this.definition(input.templateId, input.templateVersion);
    const issues = validateValues(
      { ...d, fields: d.fields.map((f) => ({ ...f, required: false })) },
      input.values,
    );
    if (typeof input.title !== "string" || input.title.length > 200)
      issues.push({ path: "title", message: "标题最多 200 字" });
    if (issues.length)
      throw new HttpFail(422, { message: "草稿数据格式错误", issues });
    this.checkAttachments(d, input.values);
    const draft: ReviewDraft = {
      id: input.id || randomUUID(),
      version: (input.id ? input.version || 0 : 0) + 1,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      title: input.title,
      values: input.values,
      updatedAt: this.now,
    };
    if (input.id) {
      if (
        this.db
          .prepare(
            "UPDATE review_drafts SET version=?,payload=?,updated_at=? WHERE tenant=? AND id=? AND actor=? AND version=?",
          )
          .run(
            draft.version,
            JSON.stringify(draft),
            this.now,
            this.ctx.tenant,
            input.id,
            this.ctx.actor,
            input.version,
          ).changes !== 1
      )
        fail(409, "草稿已变化或不可见，请重新加载");
    } else
      this.db
        .prepare(
          "INSERT INTO review_drafts(tenant,id,actor,version,payload,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          this.ctx.tenant,
          draft.id,
          this.ctx.actor,
          draft.version,
          JSON.stringify(draft),
          this.now,
        );
    return draft;
  }
  private resolve = (node: ReviewNode, requester: string, task?: ReviewTask) => reviewResolver(this.ctx)(node, requester, task);
  templates(admin = false): ReviewTemplate[] {
    if (admin) this.admin();
    const rows = this.db
      .prepare(
        admin
          ? "SELECT t.*, published.definition AS published_definition, COALESCE(l.enabled,1) AS enabled, COALESCE(l.version,0) AS lifecycle_version FROM review_templates t LEFT JOIN review_template_lifecycle l ON l.tenant=t.tenant AND l.template_id=t.id LEFT JOIN review_versions published ON published.tenant=t.tenant AND published.template_id=t.id AND published.version=t.published_version WHERE t.tenant=? ORDER BY t.updated_at DESC"
          : "SELECT t.id,v.version,v.definition,t.updated_at,t.published_version,COALESCE(l.enabled,1) AS enabled,COALESCE(l.version,0) AS lifecycle_version FROM review_templates t JOIN review_versions v ON v.tenant=t.tenant AND v.template_id=t.id AND v.version=t.published_version LEFT JOIN review_template_lifecycle l ON l.tenant=t.tenant AND l.template_id=t.id WHERE t.tenant=? AND COALESCE(l.enabled,1)=1 ORDER BY t.updated_at DESC",
      )
      .all(this.ctx.tenant) as Row[];
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      publishedVersion: r.published_version,
      ...(admin ? { hasUnpublishedChanges: !r.published_version || definitionDiff(r.published_definition ? JSON.parse(r.published_definition) : this.definition(r.id, r.published_version), JSON.parse(r.definition)).length > 0 } : {}),
      enabled: r.enabled === 1,
      lifecycleVersion: r.lifecycle_version,
      definition: JSON.parse(r.definition),
      updatedAt: r.updated_at,
    }));
  }
  saveTemplate(
    id: string | undefined,
    expectedVersion: number | undefined,
    definition: ReviewDefinition,
    creationKey?: string,
  ): ReviewTemplate {
    this.admin();
    this.checkOrganization(definition);
    // Incomplete graph is a valid draft, malformed data isn't. Publication performs full validation.
    if (
      !definition ||
      definition.schema !== "review.definition.v1" ||
      typeof definition.name !== "string" ||
      typeof definition.description !== "string" ||
      !Array.isArray(definition.fields) ||
      !Array.isArray(definition.nodes) ||
      definition.fields.some(
        (f) =>
          !f ||
          typeof f.id !== "string" ||
          typeof f.label !== "string" ||
          typeof f.type !== "string" ||
          (f.options !== undefined &&
            (!Array.isArray(f.options) ||
              f.options.some((o) => typeof o !== "string"))),
      ) ||
      definition.nodes.some(
        (n) =>
          !n ||
          typeof n.id !== "string" ||
          typeof n.name !== "string" ||
          typeof n.type !== "string" ||
          (n.assignee?.kind === "named" && !Array.isArray(n.assignee.userIds)),
      ) ||
      definition.fields.length > 100 ||
      definition.nodes.length > 100 ||
      JSON.stringify(definition).length > 200000
    )
      fail(422, "草稿契约格式错误或超出大小限制");
    if (id) {
      if (!Number.isInteger(expectedVersion)) fail(422, "缺少草稿版本");
      const result = this.db
        .prepare(
          "UPDATE review_templates SET version=version+1,definition=?,updated_at=? WHERE tenant=? AND id=? AND version=?",
        )
        .run(
          JSON.stringify(definition),
          this.now,
          this.ctx.tenant,
          id,
          expectedVersion,
        );
      if (result.changes !== 1) fail(409, "草稿已变化，请重新加载");
    } else {
      if (creationKey !== undefined && !/^[a-zA-Z0-9-]{16,80}$/.test(creationKey)) fail(422, "无效的草稿创建请求标识");
      id = creationKey ? hash({ tenant: this.ctx.tenant, actor: this.ctx.actor, creationKey }).slice(0, 32) : randomUUID();
      const existing = this.templates(true).find(t => t.id === id);
      if (existing) {
        if (canonical(existing.definition) !== canonical(definition)) fail(409, "此创建请求已保存其他内容，请恢复原草稿后修改");
        return existing;
      }
      this.db
        .prepare(
          "INSERT INTO review_templates(tenant,id,version,definition,updated_at) VALUES(?,?,1,?,?)",
        )
        .run(this.ctx.tenant, id, JSON.stringify(definition), this.now);
    }
    const result = this.templates(true).find((t) => t.id === id)!;
    this.event(id, "draft.saved", result.version, { name: definition.name });
    return result;
  }
  private template(id: string) {
    const r = this.db
      .prepare(
        "SELECT t.*,COALESCE(l.enabled,1) AS enabled,COALESCE(l.version,0) AS lifecycle_version FROM review_templates t LEFT JOIN review_template_lifecycle l ON l.tenant=t.tenant AND l.template_id=t.id WHERE t.tenant=? AND t.id=?",
      )
      .get(this.ctx.tenant, id) as Row | undefined;
    return r || fail(404, "流程不存在");
  }
  checkOrganization(definition: ReviewDefinition) {
    if (definition?.organizationUnitId !== undefined &&
      (typeof definition.organizationUnitId !== "string" ||
       !this.ctx.organization?.units.some(unit => unit.id === definition.organizationUnitId)))
      fail(422, "流程归属组织不存在、已归档或不属于当前公司，请重新选择");
  }
  private definition(id: string, version: number): ReviewDefinition {
    const r = this.db
      .prepare(
        "SELECT definition FROM review_versions WHERE tenant=? AND template_id=? AND version=?",
      )
      .get(this.ctx.tenant, id, version) as Row | undefined;
    return r ? JSON.parse(r.definition) : fail(404, "已发布版本不存在");
  }
  instances(): ReviewInstance[] {
    return (
      this.db
        .prepare(
          "SELECT i.payload FROM review_instances i JOIN review_participants p ON p.tenant=i.tenant AND p.instance_id=i.id WHERE i.tenant=? AND p.user_id=? ORDER BY i.updated_at DESC LIMIT 200",
        )
        .all(this.ctx.tenant, this.ctx.actor) as Row[]
    ).map((r) => JSON.parse(r.payload));
  }
  instancePage(input: {
    cursor?: string;
    q?: string;
    filter?: string;
    limit?: number;
  }) {
    const limit = input.limit ?? 30,
      q = (input.q || "").trim().toLocaleLowerCase(),
      filter = input.filter || "all";
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      q.length > 120 ||
      !["all", "mine", "todo"].includes(filter)
    )
      fail(422, "列表参数无效");
    let cursor: { createdAt: string; id: string } | undefined;
    if (input.cursor) {
      try {
        if (input.cursor.length > 1000) throw Error();
        cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
        if (
          !cursor ||
          typeof cursor.id !== "string" ||
          typeof cursor.createdAt !== "string"
        )
          throw Error();
      } catch {
        fail(422, "分页游标无效");
      }
    }
    const items: ReturnType<ReviewService["project"]>[] = [],
      encode = () =>
        cursor
          ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
          : null;
    let scanned = 0;
    while (scanned < 2000) {
      const rows = this.db
        .prepare(
          `SELECT i.id,e.created_at,i.payload FROM review_instances i JOIN review_participants p ON p.tenant=i.tenant AND p.instance_id=i.id JOIN review_events e ON e.tenant=i.tenant AND e.resource_id=i.id AND e.action='submit' WHERE i.tenant=? AND p.user_id=? ${cursor ? "AND (e.created_at<? OR (e.created_at=? AND i.id<?))" : ""} ORDER BY e.created_at DESC,i.id DESC LIMIT 200`,
        )
        .all(
          this.ctx.tenant,
          this.ctx.actor,
          ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        ) as Row[];
      if (!rows.length) return { items, nextCursor: null };
      for (const row of rows) {
        const i = normalizeTasks(JSON.parse(row.payload)),
          actions = this.actions(i);
        const matches =
          (!q ||
            i.title.toLocaleLowerCase().includes(q) ||
            i.definition.name.toLocaleLowerCase().includes(q)) &&
          (filter === "all" ||
            (filter === "mine" && i.requester === this.ctx.actor) ||
            (filter === "todo" &&
              actions.some((a) =>
                ["approve", "complete", "resubmit"].includes(a),
              )));
        if (matches && items.length === limit)
          return { items, nextCursor: encode() };
        cursor = { id: row.id, createdAt: row.created_at };
        scanned++;
        if (matches) items.push(this.project(i));
      }
      if (rows.length < 200) return { items, nextCursor: null };
    }
    return { items, nextCursor: encode() };
  }
  badgeCount() {
    const rows = this.db.prepare(
      "SELECT i.payload FROM review_instances i JOIN review_participants p ON p.tenant=i.tenant AND p.instance_id=i.id WHERE i.tenant=? AND p.user_id=?",
    ).all(this.ctx.tenant, this.ctx.actor) as Row[];
    return rows.reduce((count, row) => {
      const instance = normalizeTasks(JSON.parse(row.payload));
      return count + (this.actions(instance).some((action) => ["approve", "complete", "resubmit"].includes(action)) ? 1 : 0);
    }, 0);
  }
  instance(id: string): ReviewInstance {
    const row = this.db
      .prepare(
        "SELECT i.payload FROM review_instances i JOIN review_participants p ON p.tenant=i.tenant AND p.instance_id=i.id WHERE i.tenant=? AND i.id=? AND p.user_id=?",
      )
      .get(this.ctx.tenant, id, this.ctx.actor) as Row | undefined;
    return row
      ? normalizeTasks(JSON.parse(row.payload))
      : fail(404, "评审不存在或不在当前数据范围");
  }
  actions(i: ReviewInstance): string[] {
    const actions: string[] = [];
    if (
      i.requester === this.ctx.actor &&
      ["reviewing", "blocked", "awaiting_amendment"].includes(i.status)
    )
      actions.push("withdraw");
    if (i.status === "blocked" && i.requester === this.ctx.actor)
      actions.push("retry");
    const node = i.definition.nodes.find((n) => n.id === i.currentNode);
    const task = currentTasks(i).find(
      (t) => t.userId === this.ctx.actor && t.status === "pending",
    );
    if (i.status === "awaiting_amendment" && i.requester === this.ctx.actor)
      actions.push("resubmit");
    if (
      i.status === "reviewing" &&
      node &&
      task &&
      this.resolve(node, i.requester, task).includes(this.ctx.actor) &&
      (node.type !== "review" || i.requester !== this.ctx.actor) &&
      i.tasks.some(
        (t) =>
          t.nodeId === i.currentNode &&
          t.userId === this.ctx.actor &&
          t.status === "pending",
      )
    ) {
      if (node.type === "review") actions.push("approve", "reject");
      else if (["consult", "handler"].includes(node.type))
        actions.push("complete");
      if (node.operations?.transfer) actions.push("transfer");
      if (
        node.operations?.countersign &&
        ["all", "sequential"].includes(node.mode!)
      )
        actions.push("countersign");
      if (node.operations?.amendment) actions.push("request_amendment");
    }
    return actions;
  }
  project(i: ReviewInstance) {
    const node = i.definition.nodes.find((n) => n.id === i.currentNode);
    const changed =
      i.status === "reviewing" &&
      i.tasks.some(
        (t) =>
          t.nodeId === i.currentNode &&
          ["pending", "waiting"].includes(t.status) &&
          !(node ? this.resolve(node, i.requester, t) : []).includes(t.userId),
      );
    return {
      ...i,
      allowedActions: this.actions(i),
      candidates: {
        transfer: this.candidates(i, "transfer"),
        countersign: this.candidates(i, "countersign"),
      },
      blockedReason:
        i.blockedReason ||
        (changed
          ? "原评审人的有效组织关系或角色已变化。请恢复其资格，或由发起人撤回后重新发起。"
          : undefined),
    };
  }
  candidates(i: ReviewInstance, action: "transfer" | "countersign"): string[] {
    const node = i.definition.nodes.find((n) => n.id === i.currentNode);
    const pool = node?.operations?.[action]?.candidates;
    if (!node || !pool) return [];
    const used = new Set(currentTasks(i).map((t) => t.userId));
    return this.resolve({ ...node, assignee: pool }, i.requester).filter(
      (id) => id !== i.requester && !used.has(id),
    );
  }
  revisions(id: string) {
    this.instance(id);
    return (
      this.db
        .prepare(
          "SELECT round,material,actor,created_at FROM review_revisions WHERE tenant=? AND instance_id=? ORDER BY round",
        )
        .all(this.ctx.tenant, id) as Row[]
    ).map((r) => ({
      ...r,
      values: JSON.parse(r.material),
      material: undefined,
    }));
  }
  notifications() {
    return this.db
      .prepare(
        "SELECT n.id,n.instance_id,n.message,n.created_at,n.read_at FROM review_notifications n JOIN review_participants p ON p.tenant=n.tenant AND p.instance_id=n.instance_id AND p.user_id=n.user_id WHERE n.tenant=? AND n.user_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT 100",
      )
      .all(this.ctx.tenant, this.ctx.actor);
  }
  readNotification(id: string) {
    if (
      this.db
        .prepare(
          "UPDATE review_notifications SET read_at=? WHERE id=? AND tenant=? AND user_id=?",
        )
        .run(this.now, id, this.ctx.tenant, this.ctx.actor).changes !== 1
    )
      fail(404, "通知不存在");
    return { id, readAt: this.now };
  }
  private notify(
    i: ReviewInstance,
    user: string,
    key: string,
    message: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO review_notifications(id,tenant,instance_id,user_id,message,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(
        hash({ tenant: this.ctx.tenant, instance: i.id, user, key }),
        this.ctx.tenant,
        i.id,
        user,
        message,
        this.now,
      );
  }
  private syncEffects(i: ReviewInstance) {
    normalizeTasks(i);
    for (const t of i.tasks.filter((t) => t.duty === "cc"))
      this.notify(i, t.userId, `cc:${t.id}`, "有一项流程抄送给你（无需评审）");
    if (i.status === "reviewing")
      for (const task of currentTasks(i).filter(
        (t) => t.status === "pending",
      )) {
        this.notify(i, task.userId, `task:${task.id}`, "有一项评审等待你处理");
        const node = i.definition.nodes.find((n) => n.id === task.nodeId)!;
        if (task.dueAt && node.operations?.timeout)
          enqueueExecutionJob(
            {
              job_type: "review.timeout",
              tenant_ref: this.ctx.tenant,
              actor_ref: i.requester,
              idempotency_key: `review-timeout:${this.ctx.tenant}:${task.id}:${task.dueAt}`,
              object_ref: { instanceId: i.id },
              rule_id: i.templateId,
              rule_version: String(i.templateVersion),
              risk_level: "low",
              max_attempts: 3,
              next_attempt_at: task.dueAt,
              payload: { instanceId: i.id, taskId: task.id, dueAt: task.dueAt },
              scope_snapshot: {
                tenant: this.ctx.tenant,
                requester: i.requester,
              },
            },
            { db: this.db, now: new Date(this.now) },
          );
      }
    if (i.status !== "reviewing")
      this.notify(
        i,
        i.requester,
        `state:${i.version}`,
        i.status === "awaiting_amendment"
          ? "评审需要你补充材料"
          : i.status === "blocked"
            ? "评审已阻塞，请查看原因"
            : `评审状态已更新：${i.status === "approved" ? "已通过" : i.status === "rejected" ? "已拒绝" : "已撤回"}`,
      );
  }
  /** A durable worker calls this under the original requester's current company scope. */
  timeout(instanceId: string, taskId: string, dueAt: string) {
    const i = this.instance(instanceId),
      task = i.tasks.find((t) => t.id === taskId);
    if (i.requester !== this.ctx.actor) fail(403, "超时作业身份不匹配");
    const previous = this.db
      .prepare(
        "SELECT receipt FROM review_timer_receipts WHERE tenant=? AND task_id=? AND due_at=?",
      )
      .get(this.ctx.tenant, taskId, dueAt) as Row | undefined;
    if (previous) return JSON.parse(previous.receipt);
    if (
      i.status !== "reviewing" ||
      !task ||
      task.status !== "pending" ||
      task.round !== i.round ||
      task.dueAt !== dueAt ||
      dueAt > this.now
    )
      return { status: "skipped", reason: "任务或期限已变化" };
    const node = i.definition.nodes.find((n) => n.id === task.nodeId)!,
      policy = node.operations?.timeout;
    if (!policy) return { status: "skipped", reason: "没有已发布超时策略" };
    let status = "reminded";
    if (policy.action === "transfer") {
      const used = new Set(currentTasks(i).map((t) => t.userId));
      const targets = this.resolve(
        { ...node, assignee: policy.candidates },
        i.requester,
      ).filter((id) => id !== i.requester && !used.has(id));
      if (targets.length !== 1 || task.assignmentSource === "timeout") {
        status = "needs_takeover";
        i.blockedReason =
          "超时升级无法解析唯一合格目标，或已升级一次。请由当前评审人处理或按授权转交。";
      } else {
        reassignTask(i, task, targets[0], "timeout", this.now);
        status = "transferred";
      }
    }
    this.notify(
      i,
      task.userId,
      `timeout:${task.id}:${dueAt}`,
      "评审任务已超时，请处理",
    );
    if (status === "needs_takeover")
      this.notify(
        i,
        i.requester,
        `takeover:${task.id}:${dueAt}`,
        i.blockedReason!,
      );
    const version = i.version++;
    i.updatedAt = this.now;
    if (
      this.db
        .prepare(
          "UPDATE review_instances SET version=?,payload=?,updated_at=? WHERE tenant=? AND id=? AND version=?",
        )
        .run(
          i.version,
          JSON.stringify(i),
          this.now,
          this.ctx.tenant,
          i.id,
          version,
        ).changes !== 1
    )
      fail(409, "超时处理版本冲突");
    for (const t of i.tasks)
      this.db
        .prepare(
          "INSERT INTO review_participants(tenant,instance_id,user_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(this.ctx.tenant, i.id, t.userId);
    this.syncEffects(i);
    this.event(i.id, `timeout.${status}`, i.version, {
      taskId,
      dueAt,
      policyVersion: i.templateVersion,
    });
    const receipt = { status, instanceId: i.id, version: i.version };
    this.db
      .prepare(
        "INSERT INTO review_timer_receipts(tenant,task_id,due_at,receipt) VALUES(?,?,?,?)",
      )
      .run(this.ctx.tenant, taskId, dueAt, JSON.stringify(receipt));
    return receipt;
  }
  events(id: string) {
    this.instance(id);
    return (
      this.db
        .prepare(
          "SELECT id,actor,action,version,detail,created_at FROM review_events WHERE tenant=? AND resource_id=? ORDER BY version,created_at,id",
        )
        .all(this.ctx.tenant, id) as Row[]
    ).map((r) => ({
      id: String(r.id),
      actor: String(r.actor),
      action: String(r.action),
      version: Number(r.version),
      created_at: String(r.created_at),
      detail: JSON.parse(r.detail),
    }));
  }
  configurationIssues(d: ReviewDefinition): ReviewIssue[] {
    this.admin();
    const issues = [...validateDefinition(d), ...validatePublicationNames(d)];
    if (issues.length) return this.locateIssues(d, issues);
    try { this.checkOrganization(d); }
    catch (error) {
      if (!(error instanceof HttpFail) || error.status !== 422) throw error;
      issues.push({ path: "organizationUnitId", message: "流程归属组织已不可用，请重新选择有效组织。" });
    }
      for (const n of d.nodes || [])
        if (
          ["review", "cc", "consult", "handler"].includes(n?.type) &&
          ["named", "role"].includes(n.assignee?.kind || "")
        ) {
          const ids = this.resolve(n, this.ctx.actor);
          if (!ids.length || (n.mode === "single" && ids.length !== 1))
            issues.push({
              path: `nodes.${n.id}.assignee`,
              message: "评审人为空、不在有效组织内，或单人节点解析到多人",
            });
        }
      for (const n of d.nodes)
        if (n.type === "review")
          for (const policy of [
            n.operations?.transfer,
            n.operations?.countersign,
            n.operations?.timeout?.action === "transfer"
              ? n.operations.timeout
              : undefined,
          ]) {
            if (
              policy &&
              policy.candidates.kind !== "manager" &&
              !this.resolve(
                { ...n, assignee: policy.candidates },
                this.ctx.actor,
              ).length
            )
              issues.push({
                path: `nodes.${n.id}.operations`,
                message: "操作候选人不在有效组织或角色范围",
              });
          }
    return this.locateIssues(d, issues);
  }
  private locateIssues(d: ReviewDefinition, issues: ReviewIssue[]): ReviewIssue[] {
    return issues.map(issue => {
      const [group, ref, ...property] = issue.path.split(".");
      const candidates = group === "nodes" ? d?.nodes : group === "fields" ? d?.fields : [];
      const objects = Array.isArray(candidates) ? candidates : [];
      const object = objects.find(x => x?.id === ref) || (/^\d+$/.test(ref || "") ? objects[Number(ref)] : undefined);
      return { ...issue, target: { step: group === "nodes" ? "flow" as const : group === "fields" ? "form" as const : "basic" as const,
        ...(object ? { id: object.id } : {}), property: property.join(".") || (group === "nodes" || group === "fields" ? undefined : issue.path) } };
    });
  }
  simulate(
    definition: ReviewDefinition,
    values: Record<string, unknown>,
    requester = this.ctx.actor,
  ) {
    this.admin();
    const issues = this.configurationIssues(definition);
    if (!issues.length) issues.push(...validateValues(definition, values));
    if (issues.length) return { issues, status: "invalid", tasks: [], trace: [] };
    if (!this.ctx.people.some((p) => p.id === requester))
      fail(422, "测试发起人不在当前组织");
    const i = this.newInstance(
      "preview",
      0,
      definition,
      values,
      "试运行",
      requester,
    );
    const trace: ReviewTraceStep[] = [];
    advanceReview(
      i,
      definition.nodes.find((n) => n.type === "start")!.id,
      this.resolve,
      this.now,
      trace,
    );
    // Follow the complete route without recording or fabricating real decisions.
    const path: string[] = [];
    for (
      let count = 0;
      count < definition.nodes.length && i.status === "reviewing";
      count++
    ) {
      path.push(i.currentNode);
      advanceReview(
        i,
        definition.nodes.find((n) => n.id === i.currentNode)!.next!,
        this.resolve,
        this.now,
        trace,
      );
    }
    return {
      trace,
      issues,
      status: i.status,
      blockedReason: i.blockedReason,
      path,
      tasks: i.tasks,
    };
  }
  private check(command: ReviewCommand) {
    if (
      !command ||
      typeof command !== "object" ||
      !REVIEW_ACTIONS.includes(command.action)
    )
      fail(422, "未知评审命令");
    if (command.action === "enable" || command.action === "disable") {
      this.admin();
      const t = this.template(command.templateId);
      if (
        t.version !== command.expectedVersion ||
        t.lifecycle_version !== command.expectedLifecycleVersion
      )
        fail(409, "流程状态已变化，请刷新后确认");
      if (!t.published_version) fail(409, "须先发布流程");
      if ((t.enabled === 1) === (command.action === "enable"))
        fail(409, "流程已经处于目标状态");
      return {
        name: JSON.parse(t.definition).name,
        version: t.version,
        consequence:
          command.action === "disable"
            ? "停用后不能发起新申请；已有申请、任务和历史记录保留并继续处理。"
            : "恢复使用当前已发布版本接收新申请；不自动发布草稿。",
      };
    }
    if (command.action === "publish") {
      this.admin();
      const t = this.template(command.templateId);
      if (t.version !== command.expectedVersion)
        fail(409, "草稿已变化，请重新校验");
      if (t.published_version === t.version) fail(409, "此版本已发布");
      const d = JSON.parse(t.definition) as ReviewDefinition,
        issues = this.configurationIssues(d);
      if (issues.length)
        throw new HttpFail(422, { message: "流程校验未通过", issues });
      return {
        name: d.name,
        version: t.version,
        scope: `公司：${this.ctx.organization?.units.find(unit => unit.id === this.ctx.tenant)?.name || this.ctx.tenant}；流程创建归属：${this.ctx.organization?.units.find(unit => unit.id === d.organizationUnitId)?.name || "公司范围"}`,
        configuration: `${d.fields.length} 个表单字段；${d.nodes.filter(node => !["start", "end"].includes(node.type)).length} 个处理节点`,
        consequence:
          t.enabled === 1
            ? "该版本将用于后续新申请；已发起评审保持原版本。"
            : "发布后仍保持停用，启用后才能发起新申请；已有评审保持原版本。",
        evidence: hash(d),
      };
    }
    if (command.action === "submit") {
      const intake = reviewIntake(this.ctx.tenant);
      if (!intake.allowed) fail(409, intake.reason);
      if (command.draft) {
        const row = this.db
          .prepare(
            "SELECT version FROM review_drafts WHERE tenant=? AND id=? AND actor=?",
          )
          .get(this.ctx.tenant, command.draft.id, this.ctx.actor) as
          | Row
          | undefined;
        if (!row || row.version !== command.draft.version)
          fail(409, "个人草稿已变化，请重新加载");
      }
      const t = this.template(command.templateId);
      if (t.enabled !== 1) fail(409, "流程已停用，不能发起新申请");
      if (command.templateVersion !== t.published_version)
        fail(409, "流程已更新，请重新填写并确认");
      const d = this.definition(command.templateId, command.templateVersion);
      const issues = validateValues(d, command.values);
      if (!issues.length) this.checkAttachments(d, command.values);
      if (
        typeof command.title !== "string" ||
        !command.title.trim() ||
        command.title.length > 200
      )
        issues.push({ path: "title", message: "标题必填，最多 200 字" });
      if (issues.length)
        throw new HttpFail(422, { message: "请修正表单", issues });
      const preview = this.newInstance(
        command.templateId,
        command.templateVersion,
        d,
        command.values,
        command.title,
        this.ctx.actor,
      );
      advanceReview(
        preview,
        d.nodes.find((n) => n.type === "start")!.id,
        this.resolve,
        this.now,
      );
      if (preview.status === "blocked") fail(422, preview.blockedReason!);
      return {
        name: command.title,
        version: command.templateVersion,
        consequence:
          d.subjectType === "knowledge_publication"
            ? "提交后冻结此资料版本；审批通过后将自动发布到指定知识库，供获准使用该库的技能检索。"
            : "提交后材料冻结，评审人可查看本申请。评审通过不会自动触发外发或业务阶段变更。",
        reviewers: preview.tasks.map((t) => t.userId),
        evidence: hash(d),
      };
    }
    const i = this.instance(command.instanceId);
    if (i.version !== command.expectedVersion)
      fail(409, "单据状态已变化，请刷新后重新确认");
    if (!this.actions(i).includes(command.action))
      fail(403, "当前身份或单据状态不允许此操作");
    if (
      typeof command.reason !== "string" ||
      command.reason.length > 2000 ||
      ([
        "reject",
        "withdraw",
        "transfer",
        "countersign",
        "request_amendment",
        "resubmit",
        "complete",
      ].includes(command.action) &&
        !command.reason.trim())
    )
      fail(422, "拒绝或撤回须填写原因，最多 2000 字");
    if (
      (command.action === "transfer" || command.action === "countersign") &&
      !this.candidates(i, command.action).includes(command.targetUserId)
    )
      fail(403, "目标不在已发布策略的有效候选范围，或已参与本节点");
    if (command.action === "resubmit") {
      const issues = validateValues(i.definition, command.values);
      if (!issues.length) this.checkAttachments(i.definition, command.values);
      if (issues.length)
        throw new HttpFail(422, { message: "补充材料校验失败", issues });
      for (const f of i.definition.fields)
        if (
          !i.amendment?.fields.includes(f.id) &&
          canonical(i.values[f.id]) !== canonical(command.values[f.id])
        )
          fail(422, `不允许修改字段 ${f.label}`);
    }
    return {
      name: i.title,
      version: i.version,
      actionLabel: command.action === "complete"
        ? i.definition.nodes.find((node) => node.id === i.currentNode)?.type === "consult"
          ? "提交意见"
          : "完成办理"
        : undefined,
      consequence:
        command.action === "approve" && i.definition.subjectType === "knowledge_publication"
          ? "本次批准将留痕；全部审核通过后系统会自动发布被冻结的资料版本。发布结果另有回执。"
          : command.action === "transfer"
          ? `当前任务将转交给 ${this.ctx.people.find((p) => p.id === command.targetUserId)?.name || command.targetUserId}，原任务保留转交记录。`
          : command.action === "countersign"
            ? `新增 ${this.ctx.people.find((p) => p.id === command.targetUserId)?.name || command.targetUserId} 的必要评审任务，不替代当前人员的决定。`
            : command.action === "request_amendment"
              ? "本轮未决任务暂停，发起人只能修改模板允许的字段。"
              : command.action === "resubmit"
                ? "将创建新的材料版本并从开始完整重审；旧轮次的同意不覆盖本次材料。"
                : command.action === "withdraw"
                  ? "撤回会关闭未完成的评审任务；需要修改时可重新发起。"
                  : command.action === "retry"
                    ? "使用原发布版本和原材料重新解析阻塞节点。"
                    : "本次意见将留痕，并按已发布规则推进评审。",
      evidence: hash(i),
    };
  }
  private evidence(command: ReviewCommand) {
    return hash({
      command,
      templateState:
        "templateId" in command
          ? (() => {
              const t = this.template(command.templateId);
              return {
                version: t.version,
                published: t.published_version,
                lifecycle: t.lifecycle_version,
                enabled: t.enabled,
              };
            })()
          : undefined,
      people: this.ctx.people
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => ({
          id: p.id,
          managerIds: [...p.managerIds].sort(),
          roles: [...(p.roles || [])].sort(),
        })),
    });
  }
  /** Read-only validation for document preflight; creates no confirmation or request. */
  preview(command: ReviewCommand) { return this.check(command); }
  prepare(command: ReviewCommand) {
    const summary = this.check(command),
      id = randomUUID(),
      expiresAt = new Date(Date.parse(this.now) + 5 * 60000).toISOString();
    this.db
      .prepare(
        "INSERT INTO review_confirmations(id,tenant,actor,command_hash,expires_at) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        this.ctx.tenant,
        this.ctx.actor,
        this.evidence(command),
        expiresAt,
      );
    return { confirmationId: id, expiresAt, summary };
  }
  /** Caller owns a serializable transaction. Receipt lookup precedes token expiry checks. */
  execute(command: ReviewCommand, confirmationId: string, key: string) {
    if (
      !command ||
      typeof command !== "object" ||
      !REVIEW_ACTIONS.includes(command.action)
    )
      fail(422, "未知评审命令");
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
      fail(422, "需要有效的幂等键");
    const digest = hash(command);
    const previous = this.db
      .prepare(
        "SELECT command_hash,receipt FROM review_commands WHERE tenant=? AND actor=? AND idempotency_key=?",
      )
      .get(this.ctx.tenant, this.ctx.actor, key) as Row | undefined;
    if (previous) {
      if (previous.command_hash !== digest)
        fail(409, "同一幂等键不能用于不同命令");
      if (
        command.action === "publish" ||
        command.action === "enable" ||
        command.action === "disable"
      ) {
        this.admin();
        this.template(command.templateId);
      } else {
        const receipt = JSON.parse(previous.receipt);
        this.instance(receipt.resourceId);
      }
      return JSON.parse(previous.receipt);
    }
    this.check(command);
    const token = this.db
      .prepare(
        "SELECT * FROM review_confirmations WHERE id=? AND tenant=? AND actor=?",
      )
      .get(confirmationId, this.ctx.tenant, this.ctx.actor) as Row | undefined;
    if (
      !token ||
      token.consumed ||
      token.expires_at <= this.now ||
      token.command_hash !== this.evidence(command)
    )
      fail(409, "确认已失效或组织已变化，请重新确认");
    if (
      this.db
        .prepare(
          "UPDATE review_confirmations SET consumed=1 WHERE id=? AND consumed=0",
        )
        .run(confirmationId).changes !== 1
    )
      fail(409, "确认已被使用");
    let resourceId: string, version: number;
    if (command.action === "enable" || command.action === "disable") {
      resourceId = command.templateId;
      version = command.expectedLifecycleVersion + 1;
      const result = this.db
        .prepare(
          "INSERT INTO review_template_lifecycle(tenant,template_id,version,enabled) VALUES(?,?,?,?) ON CONFLICT(tenant,template_id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled WHERE review_template_lifecycle.version=?",
        )
        .run(
          this.ctx.tenant,
          resourceId,
          version,
          command.action === "enable" ? 1 : 0,
          command.expectedLifecycleVersion,
        );
      if (result.changes !== 1) fail(409, "流程状态版本冲突");
    } else if (command.action === "publish") {
      const t = this.template(command.templateId);
      resourceId = t.id;
      version = t.version;
      this.db
        .prepare(
          "INSERT INTO review_versions(tenant,template_id,version,definition,published_by,published_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          this.ctx.tenant,
          t.id,
          t.version,
          t.definition,
          this.ctx.actor,
          this.now,
        );
      if (
        this.db
          .prepare(
            "UPDATE review_templates SET published_version=? WHERE tenant=? AND id=? AND version=?",
          )
          .run(t.version, this.ctx.tenant, t.id, t.version).changes !== 1
      )
        fail(409, "草稿版本冲突");
    } else {
      let i: ReviewInstance;
      if (command.action === "submit") {
        const d = this.definition(command.templateId, command.templateVersion);
        i = this.newInstance(
          command.templateId,
          command.templateVersion,
          d,
          command.values,
          command.title,
          this.ctx.actor,
        );
        advanceReview(
          i,
          d.nodes.find((n) => n.type === "start")!.id,
          this.resolve,
          this.now,
        );
        this.db
          .prepare(
            "INSERT INTO review_instances(tenant,id,template_id,template_version,version,requester,status,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            this.ctx.tenant,
            i.id,
            i.templateId,
            i.templateVersion,
            i.version,
            i.requester,
            i.status,
            JSON.stringify(i),
            this.now,
          );
        if (
          command.draft &&
          this.db
            .prepare(
              "DELETE FROM review_drafts WHERE tenant=? AND id=? AND actor=? AND version=?",
            )
            .run(
              this.ctx.tenant,
              command.draft.id,
              this.ctx.actor,
              command.draft.version,
            ).changes !== 1
        )
          fail(409, "草稿已变化");
      } else {
        i = this.instance(command.instanceId);
        this.db
          .prepare(
            "INSERT INTO review_revisions(tenant,instance_id,round,material,actor,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .run(
            this.ctx.tenant,
            i.id,
            i.round || 1,
            JSON.stringify(i.values),
            i.requester,
            i.createdAt,
          );
        if (i.status === "reviewing") delete i.blockedReason;
        if (command.action === "withdraw") {
          i.status = "withdrawn";
          i.tasks.forEach((t) => {
            if (["waiting", "pending", "suspended"].includes(t.status))
              t.status = "cancelled";
          });
        } else if (command.action === "retry")
          advanceReview(i, i.currentNode, this.resolve, this.now);
        else if (
          [
            "transfer",
            "countersign",
            "request_amendment",
            "resubmit",
            "complete",
          ].includes(command.action)
        )
          applyReviewOperation(
            i,
            command,
            this.ctx.actor,
            this.resolve,
            this.now,
          );
        else
          decideReview(
            i,
            this.ctx.actor,
            command.action as "approve" | "reject",
            command.reason,
            this.resolve,
            this.now,
          );
        i.version++;
        i.updatedAt = this.now;
        if (
          this.db
            .prepare(
              "UPDATE review_instances SET version=?,status=?,payload=?,updated_at=? WHERE tenant=? AND id=? AND version=?",
            )
            .run(
              i.version,
              i.status,
              JSON.stringify(i),
              this.now,
              this.ctx.tenant,
              i.id,
              command.expectedVersion,
            ).changes !== 1
        )
          fail(409, "评审版本冲突");
      }
      resourceId = i.id;
      version = i.version;
      for (const user of new Set([
        i.requester,
        ...i.tasks.map((t) => t.userId),
      ]))
        this.db
          .prepare(
            "INSERT INTO review_participants(tenant,instance_id,user_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
          )
          .run(this.ctx.tenant, i.id, user);
      for (const id of this.attachmentIds(i.definition, i.values))
        this.db
          .prepare(
            "INSERT INTO review_attachment_refs(tenant,instance_id,round,attachment_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .run(this.ctx.tenant, i.id, i.round || 1, id);
      this.syncEffects(i);
      if (command.action === "submit" || command.action === "resubmit")
        this.db
          .prepare(
            "INSERT INTO review_revisions(tenant,instance_id,round,material,actor,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            this.ctx.tenant,
            i.id,
            i.round || 1,
            JSON.stringify(i.values),
            this.ctx.actor,
            this.now,
          );
    }
    const receipt = {
      id: randomUUID(),
      resourceId,
      version,
      action: command.action,
      recordedAt: this.now,
    };
    this.event(resourceId, command.action, version, {
      receiptId: receipt.id,
      ...("reason" in command ? { reason: command.reason } : {}),
      ...("targetUserId" in command
        ? { targetUserId: command.targetUserId }
        : {}),
    });
    this.db
      .prepare(
        "INSERT INTO review_commands(tenant,actor,idempotency_key,command_hash,receipt,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        this.ctx.tenant,
        this.ctx.actor,
        key,
        digest,
        JSON.stringify(receipt),
        this.now,
      );
    return receipt;
  }
  private newInstance(
    templateId: string,
    templateVersion: number,
    definition: ReviewDefinition,
    values: Record<string, unknown>,
    title: string,
    requester: string,
  ): ReviewInstance {
    return {
      id: randomUUID(),
      templateId,
      templateVersion,
      version: 1,
      round: 1,
      requester,
      title: title.trim(),
      definition,
      values,
      currentNode: "",
      status: "reviewing",
      tasks: [],
      createdAt: this.now,
      updatedAt: this.now,
    };
  }
  private event(id: string, action: string, version: number, detail: unknown) {
    this.db
      .prepare(
        "INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        this.ctx.tenant,
        id,
        this.ctx.actor,
        action,
        version,
        JSON.stringify(detail),
        this.now,
      );
  }
}
