import { HttpFail } from "../host/errors.js";
import { postgresTransaction } from "../postgres/pool.js";
import { postgresReviewContext } from "./review-postgres-access.js";
import { PostgresReviewService } from "./review-postgres-service.js";
import type { Json } from "../types.js";

/** PostgreSQL-only assistant surface.  It intentionally accepts no legacy connection. */
export async function reviewAssistantContext(actor: string, company?: string) {
  return postgresTransaction(async db => {
    const ctx = await postgresReviewContext(db, actor, company);
    const templates = await new PostgresReviewService(db, ctx).templates();
    return { company: ctx.tenant, actor: ctx.actor,
      templates: templates.filter(t => !t.definition.subjectType),
      people: ctx.people.map(p => ({ id: p.id, name: p.name })),
      rule: "只能形成 R2 申请草稿；审批路径和候选范围由服务端决定。不能代人审批或自动提交。" };
  });
}

/** Saves only a draft, in the same native PostgreSQL transaction as validation. */
export async function saveAssistantReviewDraft(actor: string, item: Json, creationKey: string, company?: string) {
  return postgresTransaction(async db => {
    const ctx = await postgresReviewContext(db, actor, company);
    const s = new PostgresReviewService(db, ctx);
    const templates = await s.templates();
    const template = templates.find(t => t.id === item.template_id && t.version === item.template_version && !t.definition.subjectType);
    if (!template) throw new HttpFail(409, "匹配的审批流程不可用或已更新，请重新选择已发布流程。");
    if (typeof item.values_json !== "string" || item.values_json.length > 200000) throw new HttpFail(422, "申请草稿材料格式错误");
    let values: Record<string, unknown>;
    try { values = JSON.parse(item.values_json); } catch { throw new HttpFail(422, "申请草稿材料必须是 JSON 对象"); }
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new HttpFail(422, "申请草稿材料必须是对象");
    if (typeof item.title !== "string") throw new HttpFail(422, "申请草稿标题格式错误");
    const draft = await s.saveDraft({ templateId: template.id, templateVersion: template.version, title: item.title, values, creationKey });
    return { draft, company: ctx.tenant };
  });
}
