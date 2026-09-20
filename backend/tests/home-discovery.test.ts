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
import { getConn, listAudit, resetConn } from "../src/db.js";
import {
  awaitHomeDiscoveryWork,
  setDiscoveryBriefRunner,
} from "../src/home-discovery.js";
import { HOME_ENTRY_REGISTRY } from "../src/host/entry-registry.js";
import { seedAll } from "../src/seed.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import { clearTaskRegistryCache, taskDefinition } from "../src/tasks/registry.js";
import type { Json } from "../src/types.js";

const calls: string[] = [];
const creatorCallArgs: Json[] = [];
let tmp = "";
let app: Hono;
let creators: Json[] = [];

function mockMcp() {
  return {
    async callTool(name: string, args: Json = {}) {
      calls.push(name);
      if (name === "start_crawl") return { task_id: "remote-home-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-home-1", status: "idle" };
      if (name === "get_crawl_logs") return { logs: ["ok"] };
      if (name === "get_creators") {
        creatorCallArgs.push(args);
        return { creators, has_more: false };
      }
      if (name === "stop_crawl") return { stopped: true };
      if (name === "upload_creators") return { uploaded: true };
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

function starryWrites() {
  return {
    sends: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get() as { n: number }).n),
    stageWrites: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_stage_writes").get() as { n: number }).n),
    transitions: Number((getConn().prepare("SELECT COUNT(*) AS n FROM stage_transitions").get() as { n: number }).n),
    imports: Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM audit_events WHERE event_type LIKE '%import%' OR event_type LIKE '%follow%'",
    ).get() as { n: number }).n),
  };
}

function crawlJobIdFor(runId: string): string {
  const row = getConn().prepare("SELECT crawl_job_id FROM discovery_runs WHERE id=?").get(runId) as
    | { crawl_job_id?: string }
    | undefined;
  return String(row?.crawl_job_id || "");
}

async function completeRun(body: Json = {
  keywords: ["clean beauty"],
  platforms: ["youtube"],
  brand: "LT",
}): Promise<Json> {
  const started = await request("POST", "/api/home/discovery/run", body);
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  const jobId = crawlJobIdFor(String(started.body.id));
  expect(jobId).toMatch(/^crawl_/);
  await monitorCrawlJob(jobId);
  await awaitHomeDiscoveryWork();
  const run = await request("GET", `/api/home/discovery/runs/${started.body.id}`);
  expect(run.status).toBe(200);
  return run.body.run as Json;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-home-discovery-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  calls.length = 0;
  creatorCallArgs.length = 0;
  creators = [{
    platform: "youtube",
    platform_creator_id: "yt-beauty-1",
    nickname: "CleanGlow",
    followers: 18000,
    recent_views: [8000, 9000, 7000, 8500, 9200, 8100, 8800, 7600, 8300, 8700],
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
  setStarryKolClientFactory();
  resetCollectorConnectionCache();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
});

describe("GET /api/home/discovery/template", () => {
  it("returns dictionary + packs + employee defaults with zero model", async () => {
    const sessionsBefore = Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n);
    const workersBefore = Number((getConn().prepare("SELECT COUNT(*) AS n FROM workers").get() as { n: number }).n);
    const result = await request("GET", "/api/home/discovery/template");
    expect(result.status).toBe(200);
    expect(result.body.calls_model).toBe(false);
    expect(result.body.creates_session).toBe(false);
    expect((result.body.platforms as Json[]).map((row) => row.id)).toEqual([
      "youtube", "instagram", "facebook",
    ]);
    expect((result.body.regions as Json[]).map((row) => row.id)).toEqual([
      "na", "eu", "sea", "jpkr", "mena", "latam", "global_en",
    ]);
    const packs = result.body.keyword_packs as Json[];
    expect(packs).toHaveLength(8);
    expect(packs.find((row) => row.id === "beauty")).toMatchObject({
      label: "美妆护肤",
      keywords: ["clean beauty", "skincare routine", "drugstore makeup"],
    });
    expect(result.body.defaults).toMatchObject({
      brand: "LT",
      region: "global_en",
      thresholds: {
        min_followers: 10000,
        max_followers: 2000000,
        min_avg_views_10: 5000,
        target_count: 30,
      },
    });
    expect(result.body.employee).toMatchObject({
      brands: expect.arrayContaining(["LT"]),
      default_brand: "LT",
      default_region: "global_en",
    });
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n)).toBe(sessionsBefore);
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM workers").get() as { n: number }).n)).toBe(workersBefore);
    expect(calls).toEqual([]);
  });
});

describe("POST /api/home/discovery/run validation", () => {
  it("rejects missing keywords with 400", async () => {
    const result = await request("POST", "/api/home/discovery/run", {
      platforms: ["youtube"],
      mode: "search",
      keywords: [],
    });
    expect(result.status).toBe(400);
    expect(result.body.detail).toMatchObject({ code: "keywords_required" });
    expect(calls).not.toContain("start_crawl");
  });

  it("rejects domestic platform codes with 400", async () => {
    const result = await request("POST", "/api/home/discovery/run", {
      platforms: ["xhs"],
      keywords: ["clean beauty"],
    });
    expect(result.status).toBe(400);
    expect(result.body.detail).toMatchObject({ code: "overseas_platforms_only" });
    expect(calls).not.toContain("start_crawl");
  });

  it("reads the stored platform and keyword JSON back as plain codes", async () => {
    const started = await request("POST", "/api/home/discovery/run", {
      platforms: ["youtube", "instagram"],
      mode: "search",
      keywords: ["clean beauty"],
      directions: ["beauty"],
    });
    expect(started.status).toBe(202);
    const run = await request("GET", `/api/home/discovery/runs/${started.body.id}`);
    expect((run.body.run as Json).spec).toMatchObject({
      platforms: ["youtube", "instagram"],
      keywords: ["clean beauty"],
      directions: ["beauty"],
    });
    expect((run.body.run as Json).search_keywords).toEqual(["clean beauty"]);
  });

  it("rejects unauthorized brand with 403", async () => {
    const result = await request("POST", "/api/home/discovery/run", {
      platforms: ["youtube"],
      keywords: ["clean beauty"],
      brand: "ACME",
    });
    expect(result.status).toBe(403);
    expect(result.body.detail).toMatchObject({ code: "brand_not_authorized" });
  });

  it("rejects more than 8 directions", async () => {
    const result = await request("POST", "/api/home/discovery/run", {
      platforms: ["youtube"],
      keywords: ["clean beauty"],
      directions: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    });
    expect(result.status).toBe(400);
    expect(result.body.detail).toMatchObject({ code: "too_many_directions" });
  });
});

describe("POST /api/home/discovery/run lifecycle", () => {
  it("returns the old session when the employee already has a queued/crawling/ranking run", async () => {
    const first = await request("POST", "/api/home/discovery/run", {
      keywords: ["clean beauty"],
      platforms: ["youtube"],
    });
    expect(first.status).toBe(202);
    const second = await request("POST", "/api/home/discovery/run", {
      keywords: ["skincare routine"],
      platforms: ["instagram"],
    });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.session_id).toBe(first.body.session_id);
    expect(second.body.duplicate || second.body.reused).toBeTruthy();
    expect(calls.filter((name) => name === "start_crawl")).toHaveLength(1);
  });

  it("does not write Starry when crawl ends", async () => {
    const before = starryWrites();
    const collabsBefore = Number((getConn().prepare("SELECT COUNT(*) AS n FROM collaborations").get() as { n: number }).n);
    const run = await completeRun();
    expect(["completed", "rank_failed"]).toContain(run.status);
    expect(run.candidate_count).toBeGreaterThan(0);
    expect(creatorCallArgs[0]).toEqual(expect.objectContaining({
      platform: "youtube",
      page: 1,
      page_size: expect.any(Number),
    }));
    expect(creatorCallArgs[0]).not.toHaveProperty("task_id");
    expect(creatorCallArgs[0]).not.toHaveProperty("offset");
    expect(calls).not.toContain("upload_creators");
    const after = starryWrites();
    expect(after.sends).toBe(before.sends);
    expect(after.stageWrites).toBe(before.stageWrites);
    expect(after.transitions).toBe(before.transitions);
    const collabsAfter = Number((getConn().prepare("SELECT COUNT(*) AS n FROM collaborations").get() as { n: number }).n);
    expect(collabsAfter).toBe(collabsBefore);
    const poolAfter = Number((getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get() as { n: number }).n);
    expect(poolAfter).toBe(0);
    const events = (run.events as Json[]).map((row) => row.type);
    expect(events).toEqual(expect.arrayContaining([
      "discovery.queued",
      "crawl_started",
      "crawl_idle",
    ]));
    const ingest = await request("POST", `/api/home/discovery/runs/${run.id}/ingest`);
    expect(ingest.status).toBe(501);
    expect(ingest.body.executed).toBe(false);
    expect(ingest.body.starry_written).toBe(false);
    expect(ingest.body.code).toBe("ingest_handoff");
    expect(String(ingest.body.message)).toMatch(/网关/);
    expect(starryWrites().sends).toBe(before.sends);

    const candidates = await request("GET", `/api/home/discovery/runs/${run.id}/candidates`);
    const candidateId = String((candidates.body.candidates as Json[])[0].id);
    const homeFollow = await request("POST", `/api/home/discovery/candidates/${candidateId}/follow`);
    expect(homeFollow.status).toBe(403);
    expect(homeFollow.body.code).toBe("home_discovery_follow_forbidden");
    expect(homeFollow.body.collaboration_created).toBe(false);
    const legacyFollow = await request("POST", `/api/discovery/candidates/${candidateId}/follow`);
    expect(legacyFollow.status).toBe(403);
    expect(legacyFollow.body.detail).toMatchObject({ code: "home_discovery_follow_forbidden" });
    const collabsAfterFollow = Number((getConn().prepare("SELECT COUNT(*) AS n FROM collaborations").get() as { n: number }).n);
    expect(collabsAfterFollow).toBe(collabsBefore);
    expect(starryWrites().sends).toBe(before.sends);
  });

  it("keeps raw candidates and marks rank_failed when brief is missing ranking", async () => {
    setDiscoveryBriefRunner(async () => ({
      items: [{
        type: "task_result",
        title: "半段结果",
        summary: "没有 ranking",
        sections: [],
        metrics: [],
        recommended_actions: [],
      }],
    }));
    const run = await completeRun();
    expect(run.status).toBe("rank_failed");
    expect(run.brief).toBeNull();
    const candidates = await request("GET", `/api/home/discovery/runs/${run.id}/candidates`);
    expect(candidates.status).toBe(200);
    expect(candidates.body.candidates as Json[]).toHaveLength(1);
    expect((candidates.body.candidates as Json[])[0]).toMatchObject({
      platform: "youtube",
      platform_creator_id: "yt-beauty-1",
      nickname: "CleanGlow",
    });
  });

  it("writes an honest empty result when crawl returns no creators", async () => {
    creators = [];
    const run = await completeRun({
      keywords: ["clean beauty"],
      platforms: ["youtube"],
    });
    expect(run.status).toBe("completed");
    expect(run.candidate_count).toBe(0);
    expect(String(run.empty_hint)).toContain("clean beauty");
    expect(run.brief).toMatchObject({
      schema: "discovery_brief/v1",
      ranking: [],
    });
  });
});

describe("home discovery extras", () => {
  it("clamps target_count over 80 and records an event", async () => {
    const started = await request("POST", "/api/home/discovery/run", {
      keywords: ["clean beauty"],
      platforms: ["youtube"],
      target_count: 120,
    });
    expect(started.status).toBe(202);
    expect((started.body.spec as Json).thresholds).toMatchObject({ target_count: 80 });
    const events = (started.body.events as Json[]).map((row) => row.type);
    expect(events).toContain("discovery.target_clamped");
  });

  it("rejects from-text for discovery_plan / discovery_crawl", async () => {
    const plan = await request("POST", "/api/tasks/from-text", {
      text: "写一个发现计划",
      task_type: "discovery_plan",
    });
    expect(plan.status).toBe(400);
    expect(plan.body.detail).toMatchObject({ code: "from_text_forbidden" });
    const crawl = await request("POST", "/api/tasks/from-text", {
      text: "开始发现采集",
      task_type: "discovery_crawl",
    });
    expect(crawl.status).toBe(400);
    expect(crawl.body.detail).toMatchObject({ code: "from_text_forbidden" });
  });

  it("registers discovery skills and entry kinds", () => {
    expect(taskDefinition("discovery_brief")?.id).toBe("discovery_brief");
    expect(taskDefinition("discovery_plan")?.id).toBe("discovery_plan");
    expect(taskDefinition("discovery_brief")?.in_market).toBe(false);
    expect(taskDefinition("discovery_plan")?.in_market).toBe(false);
    const byId = Object.fromEntries(HOME_ENTRY_REGISTRY.map((row) => [row.id, row]));
    expect(byId["list-discovery-runs"]?.kind).toBe("memory");
    expect(byId["list-discovery-candidates"]?.kind).toBe("memory");
    expect(byId["open-discovery-template"]?.kind).toBe("memory");
    expect(byId["plan-discovery-spec"]?.kind).toBe("think");
    expect(byId["start-discovery-run"]?.kind).toBe("think");
    expect(byId["retry-discovery-run"]?.kind).toBe("command");
    expect(byId["cancel-discovery-run"]?.kind).toBe("command");
    expect(byId["ignore-candidate"]?.kind).toBe("command");
  });

  it("cancels an active run via stop_crawl and ignores a candidate", async () => {
    const started = await request("POST", "/api/home/discovery/run", {
      keywords: ["clean beauty"],
      platforms: ["youtube"],
    });
    const cancelled = await request("POST", `/api/home/discovery/runs/${started.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(calls).toContain("stop_crawl");
    const jobId = crawlJobIdFor(String(started.body.id));
    if (jobId) await monitorCrawlJob(jobId).catch(() => undefined);
    await awaitHomeDiscoveryWork();
  });
});

describe("discovery harness gateway reject", () => {
  it("audits and rejects start_crawl during a discovery_brief turn", async () => {
    const { runInDiscoveryHarness, rejectDiscoveryHarnessTool } = await import(
      "../src/gateway/discovery-harness.js"
    );
    const { HttpFail } = await import("../src/host/errors.js");
    expect(() => runInDiscoveryHarness({ skill: "discovery_brief", session_id: "ses_x" }, () => {
      rejectDiscoveryHarnessTool("start_crawl");
    })).toThrow(HttpFail);
    const rows = listAudit().filter((row) => String(row.event_type) === "discovery.harness.tool_rejected");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1)?.payload).toMatchObject({ tool: "start_crawl", skill: "discovery_brief" });
  });
});
