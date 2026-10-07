import type { AdminWorkReport, WorkReportPeriod } from "../api";

/**
 * 管理端工作战报的纯呈现逻辑。
 * 只做排序、文案与格式化；不定义口径、不改业务规则（CONST-04）。
 */

export type Intervention = {
  ticket_id: string;
  title: string;
  status: string;
  owner_name: string | null;
  owner_user_id: string;
  due_at: string | null;
  occurred_at: string;
  ticket_kind: string;
};

const TERMINAL_STATUSES = new Set(["failed", "cancelled", "completed"]);

/** 逾期判定：有截止时间、未终态、且已超过当前时间。 */
export function isOverdue(dueAt: string | null | undefined, status: string, nowMs: number): boolean {
  if (!dueAt || TERMINAL_STATUSES.has(status)) return false;
  const due = new Date(dueAt).getTime();
  return Number.isFinite(due) && due < nowMs;
}

/**
 * 干预优先级（纯呈现排序，不改变业务语义）：
 * 等审批（需管理者本人确认）> 已逾期（需立即催办）> 失败（需复盘）> 等待处理 > 已取消
 */
export function interventionRank(status: string, overdue: boolean): number {
  if (status === "waiting_approval") return 0;
  if (overdue) return 1;
  if (status === "failed") return 2;
  if (status === "waiting") return 3;
  return 4;
}

export function sortInterventions(items: Intervention[], nowMs: number): Intervention[] {
  return [...items].sort((left, right) => {
    const rank = interventionRank(left.status, isOverdue(left.due_at, left.status, nowMs))
      - interventionRank(right.status, isOverdue(right.due_at, right.status, nowMs));
    if (rank !== 0) return rank;
    const leftDue = left.due_at || "";
    const rightDue = right.due_at || "";
    if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
    return left.ticket_id < right.ticket_id ? -1 : 1;
  });
}

export type DeltaTone = "up" | "down" | "flat";

/** 环比：返回 null 表示无上期数据可比，不渲染 delta。 */
export function formatDelta(current: number, previous: number | null | undefined): { text: string; tone: DeltaTone } | null {
  if (previous == null || !Number.isFinite(previous)) return null;
  const diff = current - previous;
  if (diff > 0) return { text: `▲+${diff}`, tone: "up" };
  if (diff < 0) return { text: `▼${diff}`, tone: "down" };
  return { text: "持平", tone: "flat" };
}

export function overdueLabel(dueAt: string, nowMs: number): string {
  const diffMs = nowMs - new Date(dueAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "已逾期";
  const days = Math.floor(diffMs / 86400000);
  if (days >= 1) return `已逾期 ${days} 天`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `已逾期 ${hours} 小时`;
  return "已逾期";
}

/** 验收证据 key-value 渲染：嵌套对象单行截断，超长截断，不直接打印 raw JSON。 */
export function flattenEvidence(evidence: Record<string, unknown> | null | undefined): Array<{ key: string; value: string }> {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  return Object.entries(evidence).map(([key, raw]) => {
    let value: string;
    if (raw == null) value = "—";
    else if (typeof raw === "object") {
      const json = JSON.stringify(raw);
      value = json.length > 120 ? `${json.slice(0, 120)}…` : json;
    } else {
      value = String(raw);
    }
    if (value.length > 160) value = `${value.slice(0, 160)}…`;
    return { key, value };
  });
}

export function periodLabel(period: WorkReportPeriod): string {
  return period === "week" ? "本周" : period === "month" ? "本月" : "今日";
}

/** 窗口标签：day → "10月8日"；week/month → "10月5日～10月11日"。
 *  不依赖中文 ICU：用 en-CA 取目标时区的数字年月日再手动组装。 */
export function periodWindowLabel(window: { period: string; start: string; end: string }, timezone: string): string {
  const formatDay = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "numeric", day: "numeric" })
        .formatToParts(date)
        .reduce((result, part) => ({ ...result, [part.type]: part.value }), {} as Record<string, string>);
      return `${Number(parts.month)}月${Number(parts.day)}日`;
    } catch {
      return "";
    }
  };
  if (window.period === "day") return formatDay(window.start);
  const endInclusive = new Date(new Date(window.end).getTime() - 1).toISOString();
  return `${formatDay(window.start)}～${formatDay(endInclusive)}`;
}

/** 复制战报摘要的纯文本（R1 只读，供晨会/群同步）。 */
export function buildSummaryText(report: AdminWorkReport, cutoffLabel: string): string {
  const summary = report.summary;
  const delta = formatDelta(summary.accepted, summary.previous_accepted);
  const blockers = report.process.blockers;
  const now = Date.now();
  const queue = blockers.filter((item) => item.status !== "cancelled");
  const approvals = queue.filter((item) => item.status === "waiting_approval").length;
  const overdue = queue.filter((item) => isOverdue(item.due_at, item.status, now)).length;
  const failed = queue.filter((item) => item.status === "failed").length;
  const waiting = queue.filter((item) => item.status === "waiting" && !isOverdue(item.due_at, item.status, now)).length;
  const deltaText = delta == null || delta.tone === "flat" ? "与上期持平" : `较上期${delta.text}`;
  const lines = [
    `【工作战报】${report.period.date}（${periodLabel(report.period.period)}）`,
    `验收 ${summary.accepted}（${deltaText}）· 处理中 ${summary.processing} · 等待 ${summary.waiting} · 失败/取消 ${summary.exception}`,
  ];
  if (queue.length > 0) {
    lines.push(`需处理 ${queue.length} 项：等审批 ${approvals} · 已逾期 ${overdue} · 失败 ${failed} · 等待中 ${waiting}`);
  }
  lines.push(`截至 ${cutoffLabel} · 口径：验收以验收事实计，一张工单一次；库存为当前时点`);
  return lines.join("\n");
}
