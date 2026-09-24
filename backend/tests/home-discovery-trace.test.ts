/**
 * AI发现 runs must stream the same 处理过程 rows as the today plan run:
 * reasoning summaries as run.think (label「Codex 推理」), harness steps as
 * run.step, one row per harness item key however many deltas arrive.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import {
  resetCollectorConnectionCache,
  setCollectorProbeClientFactory,
  setCollectorProbeFetch,
} from "../src/crawl/connection.js";
import { monitorCrawlJob, setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import { awaitHomeDiscoveryWork, setDiscoveryBriefRunner } from "../src/home-discovery.js";
import { seedAll } from "../src/seed.js";
import { clearTaskRegistryCache } from "../src/tasks/registry.js";
import type { Row, Json } from "../src/types.js";
import type { WorkerProgress } from "../src/worker/progress.js";

let tmp = "";
let app: Hono;
let creators: Json[] = [];

function mockMcp() {
  return {
    async callTool(name: string) {
      if (name === "start_crawl") return { task_id: "remote-home-trace-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-home-trace-1", status: "idle" };
      if (name === "get_crawl_logs") return { logs: ["ok"] };
      if (name === "get_creators") return { creators, has_more: false };
      if (name === "stop_crawl") return { stopped: true };
      return {};
    },
    async close() {},
  };
}

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

function reasoning(text: string, status: "running" | "done" = "running"): WorkerProgress {
  return {
    phase: "generating",
    summary: text,
    trace: { id: "reasoning:rs_1", label: text, status, kind: "reasoning", streaming: status === "running" },
  };
}

function step(
  id: string,
  label: string,
  status: "running" | "done" = "running",
  kind: "host" | "result" = "host",
): WorkerProgress {
  return { phase: kind === "result" ? "validating" : "reading_data", trace: { id, label, status, kind } };
}

function briefRankingCandidate(input: { extra: Json }): Json {
  const pack = (input.extra.pack || {}) as Json;
  const candidates = Array.isArray(pack.candidates) ? pack.candidates as Json[] : [];
  return {
    items: [{
      type: "task_result",
      title: "发现简报",
      summary: "按均播和粉丝区间排出候选",
      sections: [],
      metrics: [],
      recommended_actions: [],
      brief: {
        schema: "discovery_brief/v1",
        headline: "找到 1 个干净美妆线索",
        counts: { raw: 1, after_host_filter: 1, shown: 1, dropped: 0 },
        ranking: [{
          candidate_id: String(candidates[0]?.id || ""),
          score: 88,
          band: "high",
          why: ["均播达标"],
          gaps: [],
          fit: "clean beauty",
          recommend: "ingest",
        }],
        dropped: [],
        gaps: [],
        next_actions: ["ignore"],
      },
    }],
  };
}

async function completeRun(): Promise<Json> {
  const started = await request("POST", "/api/home/discovery/run", {
    keywords: ["clean beauty"],
    platforms: ["youtube"],
    brand: "LT",
  });
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  const job = getConn().prepare("SELECT crawl_job_id FROM discovery_runs WHERE id=?").get(started.body.id) as
    | { crawl_job_id?: string }
    | undefined;
  const jobId = String(job?.crawl_job_id || "");
  expect(jobId).toMatch(/^crawl_/);
  await monitorCrawlJob(jobId);
  await awaitHomeDiscoveryWork();
  const run = await request("GET", `/api/home/discovery/runs/${started.body.id}`);
  expect(run.status).toBe(200);
  return run.body.run as Json;
}

function traceRows(workItemId: string): Row[] {
  return getConn().prepare(
    `SELECT * FROM task_events
      WHERE work_item_id=? AND event_type IN ('run.think','run.step','run.tool')
      ORDER BY sequence`,
  ).all(workItemId) as Row[];
}

function workItemIdOf(run: Json): string {
  return String(run.work_item_id || "");
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-home-discovery-trace-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  creators = [{
    platform: "youtube",
    platform_creator_id: "yt-trace-1",
    nickname: "TraceGlow",
    followers: 18000,
    recent_views: [8000, 9000, 7000, 8500, 9200, 8100, 8800, 7600, 8300, 8700],
    email: "trace.glow@mailcreators.example",
  }];
  resetConn();
  seedAll();
  clearTaskRegistryCache();
  resetCollectorConnectionCache();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  setCrawlMcpClientFactory(mockMcp);
  setDiscoveryBriefRunner(null);
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  setDiscoveryBriefRunner(null);
  setCrawlMcpClientFactory();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  resetCollectorConnectionCache();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
});

describe("home discovery Codex reasoning stream", () => {
  it("writes reasoning into run.think's safe_summary and steps into run.step, one row per item key", async () => {
    const deltas: string[] = [];
    setDiscoveryBriefRunner(async (input) => {
      input.onStream?.(step("host:preparing", "准备任务"));
      input.onStream?.(step("host:skill_ready", "加载任务规则", "done"));
      for (const text of ["先看", "先看均播", "先看均播是否达标", "先看均播是否达标再排", "先看均播是否达标再排"]) {
        deltas.push(text);
        input.onStream?.(reasoning(text));
      }
      input.onStream?.(step("host:formatting", "整理结果", "done", "result"));
      input.onStream?.(reasoning(deltas.at(-1) || "", "done"));
      return briefRankingCandidate({ extra: input.extra });
    });
    const run = await completeRun();
    expect(run.status, JSON.stringify(run.events)).toBe("completed");
    const workItemId = workItemIdOf(run);
    expect(workItemId).toBeTruthy();

    const rows = traceRows(workItemId);
    // 4 harness items → 4 rows: a row per token delta would leave 7+.
    expect(rows.map((row) => row.item_key)).toEqual([
      "host:preparing",
      "host:skill_ready",
      "reasoning:rs_1",
      "host:formatting",
    ]);
    expect(rows.filter((row) => row.item_key === "reasoning:rs_1")).toHaveLength(1);

    const thinking = rows.find((row) => row.item_key === "reasoning:rs_1") as Row;
    expect(thinking).toMatchObject({
      event_type: "run.think",
      label: "Codex 推理",
      status: "done",
      safe_summary: "先看均播是否达标再排",
    });
    const stepRow = rows.find((row) => row.item_key === "host:preparing") as Row;
    expect(stepRow).toMatchObject({
      event_type: "run.step",
      label: "准备任务",
      status: "done",
      safe_summary: null,
    });

    // The run payload the frontend polls carries the same row.
    const events = run.events as Json[];
    const streamed = events.find((row) => row.type === "run.think");
    expect(streamed).toMatchObject({ type: "run.think", summary: "先看均播是否达标再排" });
    expect(events.filter((row) => row.type === "run.think")).toHaveLength(1);

    // 推理行先收尾：工作项最后一条事件仍是终态，不是推理行。
    const last = getConn().prepare(
      "SELECT event_type FROM task_events WHERE work_item_id=? ORDER BY sequence DESC LIMIT 1",
    ).get(workItemId) as { event_type: string };
    expect(last.event_type).toBe("artifact_ready");
  });

  it("caps the reasoning summary at 1000 characters", async () => {
    const long = `${"分析".repeat(600)}尾巴`;
    setDiscoveryBriefRunner(async (input) => {
      input.onStream?.(reasoning(long));
      return briefRankingCandidate({ extra: input.extra });
    });
    const run = await completeRun();
    const rows = traceRows(workItemIdOf(run));
    const thinking = rows.find((row) => row.event_type === "run.think") as Row;
    expect(String(thinking.safe_summary)).toHaveLength(1000);
    expect(String(thinking.safe_summary)).toBe(long.slice(-1000));
  });

  it("marks unfinished trace rows interrupted when the brief run fails", async () => {
    setDiscoveryBriefRunner(async (input) => {
      input.onStream?.(step("host:preparing", "准备任务"));
      input.onStream?.(reasoning("先按均播粗筛", "running"));
      throw new Error("codex turn 中断");
    });
    const run = await completeRun();
    expect(run.status).toBe("rank_failed");
    const rows = traceRows(workItemIdOf(run));
    const thinking = rows.find((row) => row.event_type === "run.think") as Row;
    expect(thinking).toMatchObject({ label: "Codex 推理", safe_summary: "先按均播粗筛", status: "interrupted" });
    const stepRow = rows.find((row) => row.item_key === "host:preparing") as Row;
    expect(stepRow.status).toBe("interrupted");
  });

  it("marks the running row interrupted and keeps the failure event last when the brief fails validation", async () => {
    setDiscoveryBriefRunner(async (input) => {
      input.onStream?.(reasoning("先按均播粗筛", "running"));
      return { items: [{ type: "task_result", title: "半段结果", summary: "没有 ranking", sections: [], metrics: [], recommended_actions: [] }] };
    });
    const run = await completeRun();
    expect(run.status).toBe("rank_failed");
    const workItemId = workItemIdOf(run);
    const thinking = traceRows(workItemId).find((row) => row.event_type === "run.think") as Row;
    expect(thinking).toMatchObject({ label: "Codex 推理", safe_summary: "先按均播粗筛", status: "interrupted" });
    // 失败终态事件在推理行之后：工作项的「最新状态」不会被推理行顶掉。
    const last = getConn().prepare(
      "SELECT event_type FROM task_events WHERE work_item_id=? ORDER BY sequence DESC LIMIT 1",
    ).get(workItemId) as { event_type: string };
    expect(last.event_type).toBe("failed");
  });
});
