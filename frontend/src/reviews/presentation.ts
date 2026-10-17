import type { InstanceView } from "./api";
import { formatReviewValue } from "./formatReviewValue";

export function reviewAmount(i: InstanceView) {
  const fields = i.definition.fields.filter(f => f.type === "money");
  if (fields.length === 1) return formatReviewValue(i.values[fields[0].id]);
  return fields.length ? fields.map(f => `${f.label}：${formatReviewValue(i.values[f.id])}`).join("；") : "—";
}
export function reviewDeadline(i: InstanceView, now = Date.now()) {
  const deadlines = i.tasks.filter(t => t.status === "pending" && (t.round || 1) === (i.round || 1) && t.dueAt && Number.isFinite(Date.parse(t.dueAt)))
    .map(t => Date.parse(t.dueAt!));
  if (!deadlines.length) return { text: ["approved", "rejected", "withdrawn"].includes(i.status) ? "已结束" : "未设时限", overdue: false };
  const remaining = Math.min(...deadlines) - now;
  const minutes = Math.max(1, Math.ceil(Math.abs(remaining) / 60000));
  return { text: `${remaining < 0 ? "已超时" : "剩余"} ${minutes >= 60 ? `${Math.ceil(minutes / 60)} 小时` : `${minutes} 分钟`}`, overdue: remaining < 0 };
}
