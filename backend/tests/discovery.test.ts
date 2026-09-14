import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { monitorCrawlJob } from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { buildHomeBoard, buildRecommendedTasks, isInsightWorkItem, isTodoWorkItem } from "../src/host/home-board.js";
import { OVERSEAS_CRAWL_PLATFORMS } from "../src/crawl/platforms.js";
import type { Json } from "../src/types.js";

const calls: string[] = [];
let tmp = "";
let app: Hono;
let creators: Json[] = [{
  platform: "youtube",
  platform_creator_id: "yt-outdoor-1",
  nickname: "OutdoorPower",
  followers: 12000,
  recent_views: [1000, 2000, 1500],
}];

function mockMcp() {
  return {
    async callTool(name: string) {
      calls.push(name);
      if (name === "start_crawl") return { task_id: "remote-disc-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-disc-1", status: "idle" };
      if (name === "get_crawl_logs") return { logs: ["Authorization: Bearer hidden-secret"] };
      if (name === "get_creators") return { creators, has_more: false };
      if (name === "stop_crawl") return { stopped: true };
      return {};
    },
    async close() {},
  };
}

async function request(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

function sideEffects() {
  return {
    sends: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get() as { n: number }).n),
    stageWrites: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_stage_writes").get() as { n: number }).n),
    transitions: Number((getConn().prepare("SELECT COUNT(*) AS n FROM stage_transitions").get() as { n: number }).n),
  };
}

function assertEmployeeCopy(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/MediaCrawler|mediacrawler|MCP|Codex|Job ID|crawl_job|remote_task|hidden-secret/i);
}

function crawlJobIdFor(requestId: string): string {
  const row = getConn().prepare(
    "SELECT crawl_job_id FROM discovery_runs WHERE request_id=? ORDER BY created_at DESC LIMIT 1",
  ).get(requestId) as { crawl_job_id?: string } | undefined;
  return String(row?.crawl_job_id || "");
}

async function confirmAndComplete(keywords = ["portable power", "camping battery"]): Promise<{
  requestId: string;
  runId: string;
  results: Json;
}> {
  const created = await request("POST", "/api/discovery/requests", {
    keywords,
    platforms: ["youtube"],
    brand: "LT",
  });
  expect(created.status).toBe(201);
  expect(created.body.status).toBe("open");
  expect(created.body.status_label).toBe("待确认");
  expect(calls).not.toContain("start_crawl");
  const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
  expect(started.status).toBe(202);
  expect(started.body.status_label).toMatch(/排队中|采集中|已完成/);
  expect(OVERSEAS_CRAWL_PLATFORMS).toContain(started.body.platform);
  const jobId = crawlJobIdFor(String(created.body.id));
  expect(jobId).toMatch(/^crawl_/);
  await monitorCrawlJob(jobId);
  const results = await request("GET", `/api/discovery/requests/${created.body.id}/results`);
  expect(results.status).toBe(200);
  assertEmployeeCopy(results.body);
  return {
    requestId: String(created.body.id),
    runId: String(started.body.id),
    results: results.body,
  };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-discovery-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  calls.length = 0;
  creators = [{
    platform: "youtube",
    platform_creator_id: "yt-outdoor-1",
    nickname: "OutdoorPower",
    followers: 12000,
    recent_views: [1000, 2000, 1500],
  }];
  resetConn();
  seedAll();
  setCrawlMcpClientFactory(mockMcp);
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  setCrawlMcpClientFactory();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
  delete process.env.AUTH_MODE;
});

describe("discovery request create", () => {
  it("persists a confirmable plan and does not start MediaCrawler", async () => {
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["portable power"],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      keywords: ["portable power"],
      platforms: ["youtube", "instagram"],
      status: "open",
      status_label: "待确认",
    });
    expect(String(created.body.plan_summary)).toContain("portable power");
    expect(created.body.latest_run).toBeNull();
    expect(calls).not.toContain("start_crawl");
    assertEmployeeCopy(created.body);
    const listed = await request("GET", "/api/discovery/requests");
    expect(listed.status).toBe(200);
    expect(listed.body as unknown as Json[]).toHaveLength(1);
    const one = await request("GET", `/api/discovery/requests/${created.body.id}`);
    expect(one.status).toBe(200);
    expect(one.body.status_label).toBe("待确认");
  });

  it("starts an overseas run only after explicit confirm", async () => {
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["solar"],
      platforms: ["instagram"],
    });
    expect(created.status).toBe(201);
    expect(created.body.platforms).toEqual(["instagram"]);
    for (const code of created.body.platforms as string[]) {
      expect(OVERSEAS_CRAWL_PLATFORMS).toContain(code);
    }
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {
      platform: "instagram",
    });
    expect(started.status).toBe(202);
    expect(started.body.platform).toBe("instagram");
    expect(OVERSEAS_CRAWL_PLATFORMS).toContain(started.body.platform);
    expect(calls).toContain("start_crawl");
    assertEmployeeCopy(started.body);
  });
});

describe("discovery run lifecycle", () => {
  it("returns panel-ready results without creating Collaboration", async () => {
    const { requestId, runId, results } = await confirmAndComplete();
    expect(results.status).toBe("succeeded");
    expect(results.status_label).toBe("已完成");
    expect(results.ready).toBe(true);
    expect((results.counts as Json).suggested_count).toBe(1);
    expect(results.pending_confirm).toBe(true);
    const candidates = results.candidates as Json[];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      platform: "youtube",
      nickname: "OutdoorPower",
      handle: "OutdoorPower",
      title: "发现 @OutdoorPower",
      source: "ai",
      source_label: "AI发现",
      intent: "creator_profile",
      status: "suggested",
      request_id: requestId,
      run_id: runId,
    });
    expect(candidates[0].reason || candidates[0].summary).toBeTruthy();
    expect(results).toMatchObject({
      title: expect.any(String),
      plan_summary: expect.any(String),
      run: { status_label: "已完成" },
    });
    expect(OVERSEAS_CRAWL_PLATFORMS).toContain(candidates[0].platform);
    expect(candidates[0]).not.toHaveProperty("platform_creator_id");
    expect(results.run).not.toHaveProperty("crawl_job_id");
    expect(results.run).not.toHaveProperty("remote_task_id");

    expect(Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'",
    ).get() as { n: number }).n)).toBe(0);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });
});

describe("follow and dismiss", () => {
  it("follow creates Collaboration once; dismiss does not; neither sends nor writes stage", async () => {
    creators = [
      {
        platform: "youtube",
        platform_creator_id: "yt-outdoor-1",
        nickname: "OutdoorPower",
        followers: 12000,
        recent_views: [1000, 2000, 1500],
      },
      {
        platform: "instagram",
        platform_creator_id: "ig-camp-2",
        nickname: "CampKitchen",
        followers: 8000,
        recent_views: [400, 500],
      },
    ];
    const { results } = await confirmAndComplete(["camping"]);
    const items = results.candidates as Json[];
    const first = items.find((row) => row.nickname === "OutdoorPower") || items[0];
    const second = items.find((row) => row.id !== first.id);

    const followed = await request("POST", `/api/discovery/candidates/${first.id}/follow`);
    expect(followed.status).toBe(200);
    expect(followed.body.status).toBe("followed");
    expect(followed.body.collaboration).toMatchObject({
      handle: "OutdoorPower",
      platform: "youtube",
      source: "discovery",
      stage_code: "INITIAL_CONTACT",
    });
    expect(followed.body.created).toBe(true);
    expect((followed.body.collaboration as Json).owner_name == null
      || (followed.body.collaboration as Json).owner_name === "").toBe(true);
    assertEmployeeCopy(followed.body);

    const again = await request("POST", `/api/discovery/candidates/${first.id}/follow`);
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect((again.body.collaboration as Json).id).toBe((followed.body.collaboration as Json).id);
    expect(Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'",
    ).get() as { n: number }).n)).toBe(1);

    if (second) {
      const dismissed = await request("POST", `/api/discovery/candidates/${second.id}/dismiss`);
      expect(dismissed.status).toBe(200);
      expect(dismissed.body.status).toBe("dismissed");
      expect(dismissed.body.collaboration_id).toBeNull();
    }

    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("does not auto-create Collaboration when crawl completes", async () => {
    await confirmAndComplete();
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE status='suggested'").get()).toEqual({ n: 1 });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });
});

describe("AI发现 is not 今日任务 recommendations", () => {
  it("keeps CreatorCandidate off buildRecommendedTasks and out of todos", async () => {
    expect(isTodoWorkItem({ source: "discovery", status: "pending" })).toBe(false);
    expect(isInsightWorkItem({ source: "discovery", status: "pending" })).toBe(false);

    const { results } = await confirmAndComplete();
    const candidate = (results.candidates as Json[])[0];
    const board = buildHomeBoard() as Json;
    const recs = ((board.workbench as Json).recommendations as Json[]) || [];
    expect(recs.some((row) => row.candidate_id === candidate.id)).toBe(false);
    expect(JSON.stringify(board.workbench)).not.toContain(String(candidate.id));
    expect((buildRecommendedTasks([], []) as Json[]).some((row) => row.candidate_id)).toBe(false);
    expect(((board.workbench as Json).todo as Json[]).some((row) => String(row.source) === "discovery")).toBe(false);

    await request("POST", `/api/discovery/candidates/${candidate.id}/follow`);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });
});

describe("discovery auth and secrets", () => {
  it("requires authentication when AUTH_MODE is enabled", async () => {
    process.env.AUTH_MODE = "enabled";
    process.env.CODEX_MODE = "real";
    resetConn();
    const { createApp } = await import("../src/app.js");
    app = createApp();
    expect((await request("GET", "/api/discovery/requests")).status).toBe(401);
    expect((await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
    })).status).toBe(401);
  });

  it("sanitizes secrets in failed run errors", async () => {
    setCrawlMcpClientFactory(() => ({
      async callTool() {
        throw new Error("Authorization: Bearer super-secret-token failed");
      },
      async close() {},
    }));
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
    });
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
    expect(started.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(started.body)).not.toContain("super-secret-token");
    assertEmployeeCopy(started.body);
    const failed = getConn().prepare("SELECT error FROM discovery_runs ORDER BY created_at DESC LIMIT 1").get() as
      | { error?: string }
      | undefined;
    expect(String(failed?.error || "")).not.toContain("super-secret-token");
    expect(String(failed?.error || "")).toMatch(/\*\*\*/);
  });
});
