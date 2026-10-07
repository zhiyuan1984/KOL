import type { TodayBrief } from "../api";
import { planSourceStatus, type PlanSnapshotInfo } from "./todayPlan";
function isPolicySection(section: { title?: string; body?: string }): boolean {
  const blob = `${section.title || ""}${section.body || ""}`;
  return /原则|缺一条就整轮|关闭的任务不会再出现/.test(blob);
}
function normalizedCopy(value: string): string {
  return value.replace(/\s+/g, "").replace(/[·、,，。；;]/g, "").trim();
}
function stageSourceLabel(brief?: TodayBrief | null): string {
  const source = String(brief?.stats?.stage_counts_source || "");
  return source === "starry_local_mirror" ? "合作阶段（Starry 镜像）" : "合作阶段快照";
}
function snapshotTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
/**
 * 计划摘要（今日/待办共用）。阶段数量与任务/异常数量分别呈现；同一份阶段
 * 文案绝不同时作为 section 正文和统计行重复输出。
 *
 * 任务数与异常数一律从当前列表行派生 —— 摘要里的数字必须和用户眼前的
 * 任务表一致，规划时刻的 stats 快照只讲阶段分布，不讲"有几项任务"。
 */
export default function PlanSummary({ brief, label = "今日计划摘要", snapshot, taskCount = 0, exceptionCount = 0 }: {
  brief?: TodayBrief | null;
  label?: string;
  snapshot?: PlanSnapshotInfo;
  /** 当前列表行数：页面上"任务数"的唯一口径。 */
  taskCount?: number;
  /** 当前列表中符合任务板异常筛选口径的行数。 */
  exceptionCount?: number;
}) {
  const sections = (Array.isArray(brief?.sections) ? brief.sections : []).filter((section) => !isPolicySection(section));
  const lead = String(brief?.lead || "").trim();
  const note = String(sections[0]?.body || "").trim();
  if (!brief || (!lead && !note)) return null;
  const tasks = taskCount;
  const anomalies = exceptionCount;
  const rawStageCounts = brief.stage_counts || brief.stats?.stage_counts;
  const stageCounts = rawStageCounts && typeof rawStageCounts === "object" ? rawStageCounts : null;
  const stageText = stageCounts ? [
    `待打招呼 ${Number(stageCounts.greet || 0)}`,
    `待跟进 ${Number(stageCounts.follow || 0)}`,
    `待报价 ${Number(stageCounts.quote || 0)}`,
    `谈判中 ${Number(stageCounts.negotiate || 0)}`,
  ].join(" · ") : "";
  const noteDuplicatesStageText = Boolean(stageText) && normalizedCopy(note) === normalizedCopy(stageText);
  const stats = [
    tasks ? `${tasks} 项任务` : "",
    anomalies ? `${anomalies} 项异常需优先处理` : "",
  ].filter(Boolean).join(" · ");
  // 来源状态与中栏 success banner 调用同一函数：同一快照，同一说法。
  const sourceStatus = planSourceStatus(snapshot);
  const generatedAt = snapshotTime(snapshot?.generated_at);
  return (
    <section className="today-plan-summary" data-today-brief>
      <div className="today-plan-summary-heading">
        <span className="today-plan-summary-label">{label}</span>
        {generatedAt ? <span className="today-plan-summary-time">整理于 {generatedAt}</span> : null}
      </div>
      {lead ? <p className="today-plan-summary-lead" data-today-lead>{lead}</p> : null}
      {stats ? <p className="today-plan-summary-stats">{stats}</p> : null}
      {(note && !noteDuplicatesStageText) || stageText || snapshot ? (
        <details className="today-plan-summary-details">
          <summary>查看整理依据与来源</summary>
          {note && !noteDuplicatesStageText ? <p className="today-plan-summary-note" data-today-sections>{note}</p> : null}
          {stageText ? <p className="today-plan-summary-stats" data-today-stage-counts>{stageSourceLabel(brief)}（人数）· {stageText}</p> : null}
          {snapshot?.producer ? <p className="today-plan-summary-stats">整理方式：{snapshot.producer === "deterministic_organize" ? "规则整理" : snapshot.producer === "agent_plan" ? "Agent 整理" : snapshot.producer}</p> : null}
          {snapshot?.source_revision ? <p className="today-plan-summary-stats">数据版本：{snapshot.source_revision}</p> : null}
          {snapshot ? <p className="today-plan-summary-stats" data-plan-snapshot-status>{sourceStatus}</p> : null}
        </details>
      ) : null}
    </section>
  );
}
