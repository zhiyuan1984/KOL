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
    expect(labels([event({ type: "crawl.progress", label: "已抓取 120 条" })])).toEqual(["正在采集"]);
    expect(labels([event({ type: "crawl.status", label: "采集中" })])).toEqual(["正在采集"]);
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

  it("folds the repeated steps the backend writes per tick", () => {
    const events = [
      event({ type: "crawl.progress" }),
      event({ type: "crawl.progress" }),
      event({ type: "crawl.logs", label: "日志" }),
    ];
    expect(presentDiscoveryEvents(events)).toHaveLength(1);
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
