/** KOL 线索 / 合作项目页面共享：标签、格式化。阶段码以基本法为准。 */
import { MAIN_STAGE_TABS, SHORT_STAGE_LABEL } from "../kolStages";

export const LEAD_STAGE_LABELS: Record<string, string> = {
  pending_contact: "待建联", contacting: "建联中", price_negotiating: "报价谈判",
  sample_pending: "样品待发", intent_pending: "意向待定", rejected: "已拒绝", converted: "已转化",
};
export const LEAD_STAGE_ORDER = [
  "pending_contact", "contacting", "price_negotiating",
  "sample_pending", "intent_pending", "rejected", "converted",
];
export const LEAD_SOURCES: Array<{ value: string; label: string }> = [
  { value: "ai_discovery", label: "AI发现" }, { value: "crawler", label: "爬虫" },
  { value: "manual", label: "手动" }, { value: "channel", label: "渠道" },
  { value: "referral", label: "转介绍" },
];
export const LEAD_SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.label]),
);
export const COOP_TYPE_LABELS: Record<string, string> = {
  short_video: "短视频", live: "直播", graphic: "图文", custom: "定制",
};
export const EXCEPTION_KIND_LABELS: Record<string, string> = {
  PAUSED: "暂缓", DISPUTED: "争议", LOST: "流失", REJECTED: "拒绝", CANCELLED: "取消",
};
export const COOP_EVENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "coop.contract_requested", label: "请求合同" },
  { value: "kol.sample_shipment_requested", label: "申请寄样" },
  { value: "kol.sample_reship_requested", label: "申请补寄" },
  { value: "kol.script_submitted", label: "脚本已提交" },
  { value: "kol.script_revision_requested", label: "要求改稿" },
  { value: "kol.schedule_change_requested", label: "排期变更申请" },
  { value: "kol.production_deadline_near", label: "临近交付期" },
  { value: "kol.production_delayed", label: "拍摄延期" },
  { value: "kol.deliverable_submitted", label: "交付物已提交" },
  { value: "kol.publish_scheduled", label: "已排期发布" },
  { value: "kol.publish_verified", label: "发布已核验" },
  { value: "kol.settlement_due", label: "结算到期" },
  { value: "kol.invoice_received", label: "收到发票" },
  { value: "kol.sentiment_negative", label: "负面舆情" },
  { value: "kol.violation_detected", label: "违规检测" },
  { value: "kol.dispute_raised", label: "纠纷发起" },
  { value: "kol.settlement_completed", label: "结算完成" },
];

/** 合作阶段展示标签：正式码 → 短标签；exception 显示异常种类。 */
export function coopStageLabel(code: string, exceptionKind?: string | null): string {
  if (code === "exception") {
    const kind = exceptionKind && EXCEPTION_KIND_LABELS[exceptionKind] ? EXCEPTION_KIND_LABELS[exceptionKind] : "";
    return kind ? `异常·${kind}` : "异常";
  }
  return SHORT_STAGE_LABEL[code] || code;
}
export function coopStageFullLabel(code: string): string {
  if (code === "exception") return "异常";
  return MAIN_STAGE_TABS.find((t) => t.code === code)?.label || code;
}

const WO_STATUS_LABELS: Record<string, string> = {
  proposed: "待确认", pending_assignment: "待分派", assigned: "已分派", accepted: "已受理",
  in_progress: "处理中", waiting_external: "等待外部", waiting_approval: "等待确认",
  ready_for_acceptance: "待验收", completed: "已完成", cancelled: "已取消", needs_review: "待复核",
};
export function workOrderStatusLabel(status: string): string {
  return WO_STATUS_LABELS[status] || status;
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function formatFollowers(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return String(n);
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    const parsed = JSON.parse(String(error)) as { detail?: unknown };
    if (parsed && typeof parsed.detail === "object" && parsed.detail !== null) {
      const d = parsed.detail as { code?: string };
      if (d.code) return d.code;
    }
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch { /* ignore */ }
  return "请求失败，请稍后重试";
}
