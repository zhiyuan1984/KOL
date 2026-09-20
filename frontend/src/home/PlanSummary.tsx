import type { TodayBrief } from "../api";

function isPolicySection(section: { title?: string; body?: string }): boolean {
  const blob = `${section.title || ""}${section.body || ""}`;
  return /原则|缺一条就整轮|关闭的任务不会再出现/.test(blob);
}

function statOf(brief: TodayBrief | null | undefined, key: string): number {
  const value = Number(brief?.stats?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 今日计划摘要 — a light summary, not a card. The actionable line lives on the
 * task row (`data-today-todo-act`), so this never renders a business button.
 */
export default function PlanSummary({ brief }: { brief?: TodayBrief | null }) {
  const sections = (Array.isArray(brief?.sections) ? brief.sections : []).filter((section) => !isPolicySection(section));
  const lead = String(brief?.lead || "").trim();
  const note = String(sections[0]?.body || "").trim();
  if (!brief || (!lead && !note)) return null;
  const tasks = statOf(brief, "unfinished");
  const anomalies = statOf(brief, "failed_runs") + statOf(brief, "discovery_anomalies");
  const stats = [
    tasks ? `${tasks} 项任务` : "",
    anomalies ? `${anomalies} 项异常需优先处理` : "",
  ].filter(Boolean).join(" · ");

  return (
    <section className="today-plan-summary" data-today-brief>
      <span className="today-plan-summary-label">今日计划摘要</span>
      {lead ? <p className="today-plan-summary-lead" data-today-lead>{lead}</p> : null}
      {note ? <p className="today-plan-summary-note" data-today-sections>{note}</p> : null}
      {stats ? <p className="today-plan-summary-stats">{stats}</p> : null}
    </section>
  );
}
