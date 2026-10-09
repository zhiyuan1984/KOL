import { describe, expect, it } from "vitest";
import type { CronJob, CronRun } from "../api";
import { actionAllowed, orderedIds, receiptLabel, resultLabel, searchedJobs, viewCounts } from "./cronModel";
const job = (id: string, status: string, extra: Partial<CronJob> = {}): CronJob => ({ id, job_key: id, title: `任务${id}`, status, handler_key: "daily-task-snapshot", ...extra });

describe("employee cron read model", () => {
  it("counts the searched authorized collection before state / pagination filtering", () => {
    const jobs = [job("1", "published", { title: "风险扫描" }), job("2", "paused", { title: "风险复核" }), job("3", "draft", { title: "其他" })];
    const found = searchedJobs(jobs, "风险", false);
    expect(viewCounts(found)).toEqual({ all: 2, published: 1, paused: 1, draft: 0, disabled: 0 });
    expect(found.filter(row => row.status === "paused")).toHaveLength(1);
  });
  it("uses only actual last-terminal failures for attention, not plan state / unready capability", () => {
    const jobs = [job("1", "published", { last_terminal_status: "failed" }), job("2", "paused", { last_terminal_status: "needs_takeover" }), job("3", "draft", { execution_capability: { ready: false } })];
    expect(searchedJobs(jobs, "", true).map(row => row.id)).toEqual(["1", "2"]);
    expect(viewCounts(searchedJobs(jobs, "", true)).all).toBe(2);
  });
  it("does not grant permissions from system, status, or view mode", () => {
    expect(actionAllowed(job("1", "published", { system: true }), "pause")).toBe(false);
    expect(actionAllowed(job("2", "published"), "run_now")).toBe(false);
    expect(actionAllowed(job("3", "paused", { allowed_actions: { edit: false, pause: false, resume: true, publish: false, run_now: false } }), "resume")).toBe(true);
  });
  it("never labels async submission as completed and uses actual queue receipt", () => {
    expect(resultLabel(job("1", "published", { handler_key: "discovery-search", last_terminal_status: "succeeded" }))).toBe("待核对回执");
    expect(resultLabel(job("1", "published", { last_result_label: "已入队" }))).toBe("已入队");
    const run: CronRun = { id: "r", job_id: "1", trigger: "manual", status: "succeeded", receipt: { handler_key: "discovery-search", crawl_job_id: "queue-1" } };
    expect(receiptLabel(run)).toBe("已入队");
    expect(receiptLabel({ ...run, receipt: { handler_key: "discovery-search" } })).toBe("待核对回执");
    expect(receiptLabel({ ...run, receipt: { handler_key: "ai-task" } })).toBe("已提交");
    expect(receiptLabel({ ...run, status: "needs_takeover" })).toBe("待接管");
  });
  it("puts absent, invalid and paused next-times last in either explicit sort direction", () => {
    const jobs = [job("A", "published", { next_run_at: "2026-10-12T00:00:00Z" }), job("B", "published", { next_run_at: "2026-10-13T00:00:00Z" }), job("C", "published"), job("D", "paused", { next_run_at: "2026-10-01T00:00:00Z" }), job("E", "published", { next_run_at: "invalid" })];
    expect(orderedIds(jobs, "next-asc")).toEqual(["A", "B", "C", "D", "E"]);
    expect(orderedIds(jobs, "next-desc")).toEqual(["B", "A", "C", "D", "E"]);
  });
});
