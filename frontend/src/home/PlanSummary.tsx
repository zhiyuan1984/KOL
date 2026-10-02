import type { TodayBrief } from "../api";
import type { PlanSnapshotInfo } from "./todayPlan";

function isPolicySection(section: { title?: string; body?: string }): boolean {
  const blob = `${section.title || ""}${section.body || ""}`;
  return /原则|缺一条就整轮|关闭的任务不会再出现/.test(blob);
}

function statOf(brief: TodayBrief | null | undefined, key: string): number {
  const value = Number(brief?.stats?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 计划摘要（今日/待办共用）— a light summary, not a card. The actionable line
 * lives on the task row (`data-today-todo-act`), so this never renders a
 * business button. The label is scope copy so the todo pane never says 今日.
 */
export default function PlanSummary({ brief, label = "今日计划摘要", snapshot }: {
  brief?: TodayBrief | null;
  label?: string;
  snapshot?: PlanSnapshotInfo;
}) {
  const sections = (Array.isArray(brief?.sections) ? brief.sections : []).filter((section) => !isPolicySection(section));
  const lead = String(brief?.lead || "").trim();
  const note = String(sections[0]?.body || "").trim();
  if (!brief || (!lead && !note)) return null;
  const tasks = statOf(brief, "unfinished");
  const anomalies = statOf(brief, "failed_runs") + statOf(brief, "discovery_anomalies");
  const rawStageCounts = brief.stage_counts || brief.stats?.stage_counts;
  const stageCounts = rawStageCounts && typeof rawStageCounts === "object" ? rawStageCounts : null;
  const stageText = stageCounts ? [
    `待打招呼 ${Number(stageCounts.greet || 0)}`,
    `待跟进 ${Number(stageCounts.follow || 0)}`,
    `待报价 ${Number(stageCounts.quote || 0)}`,
    `谈判中 ${Number(stageCounts.negotiate || 0)}`,
  ].join(" · ") : "";
  const stats = [
    tasks ? `${tasks} 项任务` : "",
    anomalies ? `${anomalies} 项异常需优先处理` : "",
    stageText,
  ].filter(Boolean).join(" · ");

  return (
    <section className="today-plan-summary" data-today-brief>
      <span className="today-plan-summary-label">{label}</span>
      {lead ? <p className="today-plan-summary-lead" data-today-lead>{lead}</p> : null}
      {note ? <p className="today-plan-summary-note" data-today-sections>{note}</p> : null}
      {stats ? <p className="today-plan-summary-stats">{stats}</p> : null}
      {snapshot?.generated_at ? (
        <p className="today-plan-summary-stats" data-plan-snapshot-status>
          {snapshot.stale_reason ? "来源已变化，正在显示上次可用计划" : "来源已核验"}
          {snapshot.producer === "deterministic_organize" ? " · 确定性整理" : snapshot.producer === "agent_plan" ? " · Agent 规划" : ""}
        </p>
      ) : null}
    </section>
  );
}
