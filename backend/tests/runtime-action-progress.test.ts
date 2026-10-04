import { describe, expect, it } from "vitest";
import { canRetryRuntimeCrawl, runtimeActionProgress } from "../src/runtime/action-progress.js";

describe("durable confirmation progress", () => {
  it("distinguishes executed request from ended collection in employee copy", () => {
    const action = { state: "succeeded", error_code: null };
    expect(runtimeActionProgress(action, null, null).label).toBe("操作已执行");
    expect(runtimeActionProgress(action, { state: "running" }, null).label).toBe("执行中");
    expect(runtimeActionProgress(action, { state: "succeeded" }, null).label).toBe("采集已结束");
  });
  it("replaces a waiting prediction as soon as confirmation is queued", () => {
    const progress = runtimeActionProgress({ state: "pending", error_code: null }, null, { status: "queued" });
    expect(progress).toMatchObject({ state: "queued", label: "已确认，等待执行", replace_result: true });
    expect(JSON.stringify(progress)).not.toContain("请在确认卡");
  });
  it("prefers a known pre-dispatch rejection over an uncertain queue wrapper", () => {
    const action = { state: "rejected", error_code: "runtime_probe_crawl_busy" };
    const progress = runtimeActionProgress(action, null, { status: "uncertain" });
    expect(progress).toMatchObject({ state: "rejected", label: "采集未启动 · 已有任务占用", replace_result: true });
    expect(progress.summary).toContain("本次启动未执行");
    expect(canRetryRuntimeCrawl(action, null)).toBe(true);
  });
  it("keeps uncertain and in-flight writes out of the retry path", () => {
    for (const state of ["pending", "dispatching", "uncertain", "succeeded"]) {
      expect(canRetryRuntimeCrawl({ state, error_code: "runtime_probe_crawl_busy" }, null)).toBe(false);
    }
    expect(canRetryRuntimeCrawl({ state: "rejected", error_code: "unreviewed_error" }, null)).toBe(false);
    expect(canRetryRuntimeCrawl({ state: "succeeded", error_code: null }, { state: "running" })).toBe(false);
  });
  it("shows collection timeout from its receipt and retains its task ID", () => {
    const progress = runtimeActionProgress({ state: "succeeded", error_code: null },
      { state: "failed", error_code: "runtime_crawl_timeout", remote_task_id: "owned-task" }, { status: "succeeded" });
    expect(progress).toMatchObject({ state: "failed", label: "采集超时", replace_result: true });
    expect(JSON.stringify(progress.result)).toContain("owned-task");
  });
});
