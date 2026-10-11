import type { CronJob, CronRun } from "../api";

export const PLAN_VIEWS = [
  { key: "all", label: "全部" }, { key: "published", label: "已启用" },
  { key: "paused", label: "已暂停" }, { key: "draft", label: "草稿" }, { key: "disabled", label: "未启用" },
] as const;
export const TERMINAL_RUNS = new Set(["succeeded", "failed", "skipped", "needs_takeover"]);
export const planLabel = (status: string) => PLAN_VIEWS.find(item => item.key === status)?.label || status;
export const runStatusLabel = (status?: string | null): string => ({
  queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", skipped: "已跳过", needs_takeover: "待接管",
} as Record<string, string>)[status || ""] || status || "—";
export const isAttention = (status?: string | null) => status === "failed" || status === "needs_takeover";
export function resultLabel(job: CronJob): string {
  if (job.last_result_label) return job.last_result_label;
  if (job.last_terminal_status === "succeeded" && job.handler_key === "discovery-search") return "待核对回执";
  if (job.last_terminal_status === "succeeded" && job.handler_key === "ai-task") return "已提交";
  return runStatusLabel(job.last_terminal_status);
}
export function receiptLabel(run: CronRun): string {
  if (run.status === "succeeded" && run.receipt?.handler_key === "discovery-search") return run.receipt.crawl_job_id ? "已入队" : "待核对回执";
  if (run.status === "succeeded" && run.receipt?.handler_key === "ai-task") return "已提交";
  return runStatusLabel(run.status);
}
export function searchedJobs(jobs: CronJob[], query: string, attention: boolean): CronJob[] {
  const q = query.trim().toLocaleLowerCase();
  return jobs.filter(job => `${job.title} ${job.frequency || ""}`.toLocaleLowerCase().includes(q) && (!attention || isAttention(job.last_terminal_status)));
}
export function viewCounts(jobs: CronJob[]): Record<string, number> {
  const counts: Record<string, number> = { all: jobs.length, published: 0, paused: 0, draft: 0, disabled: 0 };
  for (const job of jobs) counts[job.status] = (counts[job.status] || 0) + 1;
  return counts;
}
/** Order is captured only on initial load / an explicit sort; async updates do not move targets. */
export function orderedIds(jobs: CronJob[], sort: "name" | "next-asc" | "next-desc"): string[] {
  const time = (job: CronJob) => job.status === "published" && job.next_run_at ? Date.parse(job.next_run_at) : NaN;
  return [...jobs].sort((a, b) => {
    if (sort !== "name") {
      const at = time(a), bt = time(b);
      if (Number.isFinite(at) !== Number.isFinite(bt)) return Number.isFinite(at) ? -1 : 1;
      if (Number.isFinite(at) && at !== bt) return (at - bt) * (sort === "next-desc" ? -1 : 1);
    }
    return a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id);
  }).map(job => job.id);
}
/** Missing capability data never grants an action. Authorization remains on the backend. */
export const actionAllowed = (job: CronJob, action: "edit" | "pause" | "resume" | "publish" | "run_now") => job.allowed_actions?.[action] === true;
