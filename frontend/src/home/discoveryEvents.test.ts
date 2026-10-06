import { describe, expect, it } from "vitest";
import type { TaskEvent } from "../api";
import {
  presentDiscoveryEvents,
  presentDiscoveryThink,
} from "./discoveryEvents";
import { THINK_TAIL_LINES, thinkTail } from "./streamText";

const event = (row: Record<string, unknown>): TaskEvent => row as TaskEvent;

function labels(events: TaskEvent[]): string[] {
  return presentDiscoveryEvents(events).map((step) => step.label);
}

function kinds(events: TaskEvent[]): string[] {
  return presentDiscoveryEvents(events).map((step) => step.kind);
}

describe("discovery process stream", () => {
  it("keeps the vocabulary the pane has always used", () => {
    const events = [
      event({ type: "queued" }),
      event({ type: "search_started" }),
      event({ type: "received", count: 40 }),
      event({ type: "deduped", count: 28 }),
      event({ type: "scoring" }),
      event({ type: "ranked" }),
    ];
    expect(labels(events)).toEqual([
      "排队",
      "开始搜索关键词",
      "已收到 40 条",
      "采集结束去重后 28 条",
      "正在打分",
      "已排出候选",
    ]);
    expect(kinds(events)).toEqual([
      "queued",
      "search",
      "received",
      "deduped",
      "scoring",
      "ranked",
    ]);
  });

  it("covers the events the crawl service actually writes", () => {
    // 采集是异步作业：这几类事件过去一个都对不上，过程流因此看起来比实际快。
    expect(labels([event({ type: "crawl_started" })])).toEqual(["正在采集"]);
    expect(labels([event({ type: "crawl.progress", label: "已抓取 120 条" })])).toEqual(["已采集 120 条"]);
    expect(labels([event({ type: "crawl.logs", summary: "Fetched 48 creators" })])).toEqual(["已采集 48 条"]);
    expect(labels([event({ type: "crawl.status", label: "采集中" })])).toEqual(["正在采集"]);
    expect(labels([event({ type: "crawl.status", status: "analyzing", label: "Remote status: analyzing" })]))
      .toEqual(["正在整理候选"]);
    expect(labels([event({ type: "crawl.logs", summary: "读取最新采集日志" })])).toEqual(["采集日志已更新"]);
    expect(labels([event({ type: "crawl.analyzing" })])).toEqual(["整理候选"]);
    expect(labels([event({ type: "crawl.result_ready" })])).toEqual(["采集完成"]);
    expect(labels([event({ type: "discovery.plan_started" })])).toEqual(["正在生成发现简报"]);
    expect(labels([event({ type: "artifact_ready" })])).toEqual(["已排出候选"]);
  });

  it("never reports a shortlist before the brief exists", () => {
    // 简报还没生成就写「已排出候选」= 显示与事实不符（CONST-10）。
    expect(labels([event({ type: "ranking_started", label: "开始生成发现简报" })]))
      .toEqual(["正在生成发现简报"]);
    expect(kinds([event({ type: "ranking_started" })])).toEqual(["briefing"]);
    expect(labels([event({ type: "artifact_ready" })])).toEqual(["已排出候选"]);
  });

  it("keeps failures, stops and Host steps honest", () => {
    expect(labels([event({ type: "crawl.error", message: "采集凭据失效" })]))
      .toEqual(["失败原因：采集凭据失效"]);
    expect(kinds([event({ type: "crawl.error" })])).toEqual(["failed"]);
    expect(labels([event({ type: "crawl.stopped" })])).toEqual(["采集已停止"]);
    expect(labels([event({ type: "run.step", label: "读取候选" })])).toEqual(["读取候选"]);
    // 推理不占步骤位，它走 think 块。
    expect(presentDiscoveryEvents([event({ type: "run.think", summary: "先看样本" })])).toEqual([]);
  });

  it("does not paint asynchronous events after a failure as successful work", () => {
    const events = [
      event({ type: "queued" }),
      event({ type: "crawl.started" }),
      event({ type: "crawl.error", message: "读取远程采集日志未完成" }),
      event({ type: "crawl.result_ready" }),
      event({ type: "run.step", label: "整理结果" }),
      event({ type: "artifact_ready" }),
    ];

    expect(labels(events)).toEqual([
      "排队",
      "正在采集",
      "失败原因：读取远程采集日志未完成",
    ]);
    expect(presentDiscoveryThink([
      event({ type: "run.think", status: "running", summary: "先核对候选" }),
      event({ type: "crawl.error", message: "读取远程采集日志未完成" }),
      event({ type: "run.think", status: "running", summary: "不应展示" }),
    ])?.body).toBe("先核对候选");
  });

  it("never turns the delivery task's own start into a collection milestone", () => {
    // 线上取证（task_events）：`run.started` 的 safe_summary 是技能 id `crawler_collect`。
    // 早先整条 blob 匹配 /crawl|采集/，于是员工还没确认就出现一条「正在采集」，
    // 时间戳还是提交时刻（图 1：等待确认的采集块里躺着 19:33:49 的「正在采集」）。
    const events = [
      event({ type: "run.started", status: "running", label: "任务开始处理", safe_summary: "crawler_collect" }),
      event({ type: "run.progress", status: "running", label: "加载任务规则" }),
      event({ type: "run.progress", status: "running", label: "整理结果" }),
      event({ type: "run.completed", status: "completed", label: "结果已生成" }),
    ];
    expect(labels(events)).toEqual(["任务开始处理", "加载任务规则", "整理结果"]);
    expect(kinds(events)).not.toContain("collecting");
  });

  it("takes 正在采集 only from crawl-scoped events", () => {
    // 只有采集服务自己的事件（crawl.* / claw.*）才是远端事实；run.* 是交付任务的准备过程。
    expect(kinds([event({ type: "crawl_started", label: "发现采集已开始" })])).toEqual(["collecting"]);
    expect(kinds([event({ type: "run.started", label: "任务开始处理", safe_summary: "crawler_collect" })]))
      .toEqual(["step"]);
    expect(kinds([event({ type: "queued", summary: "发现采集已排队" })])).toEqual(["queued"]);
  });

  it("keeps the pre-run trail from claiming the task finished", () => {
    // 交付任务自己收尾（run.completed）不是采集结果，过程流不留「已生成结果」这一行。
    expect(labels([event({ type: "run.completed", label: "结果已生成" })])).toEqual([]);
    expect(labels([event({ type: "run.failed", label: "执行失败", message: "未生成结果" })]))
      .toEqual(["失败原因：未生成结果"]);
  });

  it("folds the repeated steps the backend writes per tick", () => {
    const events = [
      event({ type: "crawl.progress" }),
      event({ type: "crawl.progress" }),
      event({ type: "crawl.logs", label: "日志" }),
    ];
    expect(presentDiscoveryEvents(events).map((step) => step.label)).toEqual([
      "正在采集",
      "采集日志已更新",
    ]);
  });
});

describe("discovery Codex think block", () => {
  it("shows the newest reasoning paragraph and folds the earlier ones", () => {
    const think = presentDiscoveryThink([
      event({ type: "run.think", status: "done", summary: "先读候选池" }),
      event({ type: "run.think", status: "running", summary: "再按匹配度排序" }),
    ]);
    expect(think).toEqual({
      body: "再按匹配度排序",
      truncated: false,
      state: "running",
      folded: 1,
    });
  });

  it("uses persisted event timestamps for process and reasoning rows", () => {
    const createdAt = "2026-09-24T06:32:07.000Z";
    const [step] = presentDiscoveryEvents([event({ type: "queued", created_at: createdAt })]);
    const think = presentDiscoveryThink([event({ type: "run.think", summary: "检查候选", created_at: createdAt })]);

    expect(step.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(think?.time).toBe(step.time);
  });

  it("tails long reasoning like today's plan stream does", () => {
    const long = Array.from({ length: THINK_TAIL_LINES + 2 }, (_, i) => `第 ${i + 1} 行`).join("\n");
    const think = presentDiscoveryThink([event({ type: "run.think", status: "done", summary: long })]);
    expect(think?.truncated).toBe(true);
    expect(think?.body).toBe(thinkTail(long).body);
    expect(think?.body).not.toContain("第 1 行");
  });

  it("has nothing to show before the brief worker runs", () => {
    expect(presentDiscoveryThink([event({ type: "crawl_started" })])).toBeNull();
    expect(presentDiscoveryThink([event({ type: "run.think", summary: "  " })])).toBeNull();
  });
});
