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
import { setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { monitorCrawlJob } from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { buildHomeBoard, buildRecommendedTasks, isInsightWorkItem, isTodoWorkItem } from "../src/host/home-board.js";
import { OVERSEAS_CRAWL_PLATFORMS } from "../src/crawl/platforms.js";
import type { Json } from "../src/types.js";

const calls: string[] = [];
const creatorCallArgs: Json[] = [];
const crawlStartArgs: Json[] = [];
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
    async callTool(name: string, args: Json = {}) {
      calls.push(name);
      if (name === "start_crawl") {
        crawlStartArgs.push(args);
        return { task_id: "remote-disc-1", status: "running" };
      }
      if (name === "get_crawl_status") return { task_id: "remote-disc-1", status: "idle" };
      if (name === "get_crawl_logs") return { logs: ["Authorization: Bearer hidden-secret"] };
      if (name === "get_creators") {
        creatorCallArgs.push(args);
        return { creators, has_more: false };
      }
      if (name === "stop_crawl") return { stopped: true };
      return {};
    },
    async close() {},
  };
}

function assertGetCreatorsMcpContract(args: Json, platform: string): void {
  expect(args).toEqual(expect.objectContaining({
    platform,
    page: 1,
    page_size: expect.any(Number),
  }));
  expect(args).not.toHaveProperty("offset");
  expect(args).not.toHaveProperty("limit");
  expect(args.task_id).toBeUndefined();
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
  expect(text).not.toMatch(
    /MediaCrawler|mediacrawler|MCP|Codex|Job ID|crawl_job|remote_task|hidden-secret|Streamable|ECONNREFUSED|Failed to fetch|HTTP 404/i,
  );
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
  creatorCallArgs.length = 0;
  crawlStartArgs.length = 0;
  creators = [{
    platform: "youtube",
    platform_creator_id: "yt-outdoor-1",
    nickname: "OutdoorPower",
    followers: 12000,
    recent_views: [1000, 2000, 1500],
  }];
  resetConn();
  seedAll();
  resetCollectorConnectionCache();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  setCrawlMcpClientFactory(mockMcp);
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  setCrawlMcpClientFactory();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  resetCollectorConnectionCache();
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
    expect(created.body.connection).toMatchObject({
      credentials_present: true,
      status: "unchecked",
      status_label: "待检查",
    });
    expect(calls).not.toContain("start_crawl");
    assertEmployeeCopy(created.body);
    const listed = await request("GET", "/api/discovery/requests");
    expect(listed.status).toBe(200);
    expect(listed.body as unknown as Json[]).toHaveLength(1);
    const one = await request("GET", `/api/discovery/requests/${created.body.id}`);
    expect(one.status).toBe(200);
    expect(one.body.status_label).toBe("待确认");
    expect(one.body.filters).toEqual({ region: "all", directions: [] });
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
    expect(results.empty_hint).toBeNull();
    expect(creatorCallArgs.length).toBeGreaterThan(0);
    assertGetCreatorsMcpContract(creatorCallArgs[0], "youtube");
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

  it("mocked REAL get_creators page contract still unblocks results and follow", async () => {
    setCrawlMcpClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        calls.push(name);
        if (name === "start_crawl") return { task_id: "remote-disc-1", status: "running" };
        if (name === "get_crawl_status") return { task_id: "remote-disc-1", status: "idle" };
        if (name === "get_crawl_logs") return { logs: [] };
        if (name === "get_creators") {
          creatorCallArgs.push(args);
          const extra = Object.keys(args).filter((key) => !["platform", "page", "page_size"].includes(key));
          if (extra.length) throw new Error(`pydantic: unexpected fields ${extra.join(",")}`);
          return { creators, has_more: false, total: creators.length };
        }
        return {};
      },
      async close() {},
    }));
    const { results } = await confirmAndComplete();
    const items = results.candidates as Json[];
    expect(items).toHaveLength(1);
    assertGetCreatorsMcpContract(creatorCallArgs[0], "youtube");
    const followed = await request("POST", `/api/discovery/candidates/${items[0].id}/follow`);
    expect(followed.status).toBe(200);
    expect(followed.body.status).toBe("followed");
    expect(followed.body.created).toBe(true);
    assertEmployeeCopy(followed.body);
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
    expect(recs.every((row) => row.source_label !== "AI发现")).toBe(true);
    expect(JSON.stringify(board.workbench)).not.toContain(String(candidate.id));
    expect((buildRecommendedTasks([], []) as Json[]).some((row) => row.candidate_id)).toBe(false);
    expect(((board.workbench as Json).todo as Json[]).some((row) => String(row.source) === "discovery")).toBe(false);

    await request("POST", `/api/discovery/candidates/${candidate.id}/follow`);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });
});

describe("discovery filters directions and region", () => {
  it("trims, dedupes, and persists directions with a Chinese region label in the plan", async () => {
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["portable power"],
      platforms: ["youtube"],
      filters: {
        region: "us",
        directions: [" 户外电源 ", "camping", "户外电源", "CAMPING"],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.filters).toEqual({
      region: "us",
      directions: ["户外电源", "camping"],
    });
    expect(created.body.keywords).toEqual(["portable power"]);
    expect(String(created.body.plan_summary)).toContain("portable power");
    expect(String(created.body.plan_summary)).toContain("户外电源");
    expect(String(created.body.plan_summary)).toContain("camping");
    expect(String(created.body.plan_summary)).toContain("美国");
    expect(String(created.body.plan_summary)).not.toMatch(/MediaCrawler|MCP|Job ID/i);
    const stored = getConn().prepare("SELECT filters FROM discovery_requests WHERE id=?").get(created.body.id) as
      | { filters?: string }
      | undefined;
    expect(JSON.parse(String(stored?.filters || "{}"))).toEqual({
      region: "us",
      directions: ["户外电源", "camping"],
    });
  });

  it("merges legacy niche into directions and accepts compat regions", async () => {
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["solar"],
      platforms: ["instagram"],
      filters: { region: "na", niche: " 房车露营 ", directions: ["solar"] },
    });
    expect(created.status).toBe(201);
    expect(created.body.filters).toEqual({
      region: "na",
      directions: ["solar", "房车露营"],
    });
    expect(JSON.stringify(created.body.filters)).not.toContain("niche");
    expect(String(created.body.plan_summary)).toContain("北美");
    expect(String(created.body.plan_summary)).toContain("房车露营");

    const sea = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["facebook"],
      filters: { region: "sea", niche: "储能" },
    });
    expect(sea.status).toBe(201);
    expect(sea.body.filters).toEqual({ region: "sea", directions: ["储能"] });
    expect(String(sea.body.plan_summary)).toContain("东南亚");
  });

  it("expands Chinese niches to English crawl keywords without expanding platforms", async () => {
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["找北美户外评测达人"],
      platforms: ["youtube"],
      filters: { region: "us", directions: ["户外电源"] },
    });
    expect(created.body.platforms).toEqual(["youtube"]);
    expect(created.body.keywords).toEqual(["找北美户外评测达人"]);
    expect(String(created.body.plan_summary)).toContain("户外电源");
    expect(String(created.body.plan_summary)).toContain("找北美户外评测达人");
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
    expect(started.status).toBe(202);
    expect(started.body.platform).toBe("youtube");
    expect(started.body.search_keywords).toEqual(["outdoor review", "portable power station", "USA"]);
    const job = getConn().prepare(
      "SELECT platform, parameters FROM crawl_jobs ORDER BY created_at DESC LIMIT 1",
    ).get() as { platform?: string; parameters?: string } | undefined;
    expect(job?.platform).toBe("youtube");
    expect(JSON.parse(String(job?.parameters || "{}"))).toMatchObject({
      region: "us",
      directions: ["户外电源"],
      keywords: ["outdoor review", "portable power station", "USA"],
    });
    expect(String(crawlStartArgs[0]?.keywords || "")).toContain("portable power station");
    expect(String(crawlStartArgs[0]?.keywords || "")).not.toMatch(/找北美|户外电源|达人/);
    expect(JSON.stringify(started.body)).not.toMatch(/MediaCrawler|MCP|Job ID|crawl_job/i);
  });

  it("returns employee empty copy with the English search terms actually used", async () => {
    creators = [];
    const { results } = await confirmAndComplete(["户外电源"]);
    expect(results.status).toBe("succeeded");
    expect((results.counts as Json).candidate_count).toBe(0);
    expect(results.search_keywords).toEqual(["portable power station"]);
    expect(results.empty_hint).toBe("按「portable power station」没有找到线索，可换词再试。");
    expect(results.ready).toBe(false);
    assertEmployeeCopy(results);
    expect(String(results.empty_hint)).not.toMatch(/MCP|MediaCrawler|Job|crawl/i);
    expect(String(crawlStartArgs[0]?.keywords || "")).toBe("portable power station");
  });

  it("rejects oversized, overlong, non-array, and invalid region input with 400", async () => {
    const tooMany = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: { directions: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] },
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.detail).toMatchObject({ code: "too_many_directions" });

    const tooLong = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: { directions: ["x".repeat(31)] },
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.detail).toMatchObject({ code: "direction_too_long" });

    const notArray = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: { directions: "户外电源" },
    });
    expect(notArray.status).toBe(400);
    expect(notArray.body.detail).toMatchObject({ code: "invalid_directions" });

    const badItem = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: { directions: [{ name: "户外" }] },
    });
    expect(badItem.status).toBe(400);

    const badNiche = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: { niche: ["户外电源"] },
    });
    expect(badNiche.status).toBe(400);

    const nineAfterMerge = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: {
        directions: ["a", "b", "c", "d", "e", "f", "g", "h"],
        niche: "extra",
      },
    });
    expect(nineAfterMerge.status).toBe(400);
    expect(nineAfterMerge.body.detail).toMatchObject({ code: "too_many_directions" });

    const badRegion = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: { region: "cn" },
    });
    expect(badRegion.status).toBe(400);
    expect(badRegion.body.detail).toMatchObject({ code: "invalid_region" });

    const badFilters = await request("POST", "/api/discovery/requests", {
      keywords: ["battery"],
      platforms: ["youtube"],
      filters: ["us"],
    });
    expect(badFilters.status).toBe(400);
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
    expect(started.body.detail).toMatchObject({
      code: "collector_unreachable",
      message: "采集服务连接失败",
    });
    expect(JSON.stringify(started.body)).not.toContain("super-secret-token");
    assertEmployeeCopy(started.body);
    const failed = getConn().prepare("SELECT error FROM discovery_runs ORDER BY created_at DESC LIMIT 1").get() as
      | { error?: string }
      | undefined;
    expect(String(failed?.error || "")).toBe("采集服务连接失败");
    expect(String(failed?.error || "")).not.toContain("super-secret-token");
  });
});
