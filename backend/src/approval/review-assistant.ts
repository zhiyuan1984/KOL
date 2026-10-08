import type { SqliteConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { reviewContextForActor } from "./review-access.js";
import { ReviewService } from "./review-service.js";
import type { Json } from "../types.js";

export function reviewAssistantContext(db: SqliteConn, actor: string, company?: string) {
  const ctx = reviewContextForActor(db, actor, company);
  return { company: ctx.tenant, actor: ctx.actor, templates: new ReviewService(db, ctx).templates().filter(t => !t.definition.subjectType),
    people: ctx.people.map(p => ({ id: p.id, name: p.name })), rule: "只能形成 R2 申请草稿；审批路径和候选范围由服务端决定。不能代人审批或自动提交。" };
}

export function saveAssistantReviewDraft(db: SqliteConn, actor: string, item: Json, creationKey: string, company?: string) {
  const ctx = reviewContextForActor(db, actor, company);
  const s = new ReviewService(db, ctx);
  const template = s.templates().find(t => t.id === item.template_id && t.version === item.template_version && !t.definition.subjectType);
  if (!template) throw new HttpFail(409, "匹配的审批流程不可用或已更新，请重新选择已发布流程。");
  if (typeof item.values_json !== "string" || item.values_json.length > 200000) throw new HttpFail(422, "申请草稿材料格式错误");
  let values: Record<string, unknown>;
  try { values = JSON.parse(item.values_json); } catch { throw new HttpFail(422, "申请草稿材料必须是 JSON 对象"); }
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new HttpFail(422, "申请草稿材料必须是对象");
  if (typeof item.title !== "string") throw new HttpFail(422, "申请草稿标题格式错误");
  const draft = s.saveDraft({ templateId: template.id, templateVersion: template.version, title: item.title, values, creationKey });
  return { draft, company: ctx.tenant };
}
