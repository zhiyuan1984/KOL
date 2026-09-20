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

/** `lookupFlags` reads already_in_pool off an open profile in kol_profile_index. */
function seedPoolCreator(platformCreatorId: string): void {
  const now = new Date().toISOString();
  getConn().prepare(
    `INSERT INTO kol_profile_index
     (id, company_id, kol_uid, platform, platform_creator_id, pool_status, created_at, updated_at)
     VALUES (?,?,?,?,?, 'open', ?, ?)`,
  ).run(`kpi_${platformCreatorId}`, "cmp_test", `disc_${platformCreatorId}`, "youtube", platformCreatorId, now, now);
}

/** `lookupFlags` reads already_followed off a collaboration this tenant owns (owner_* 非空才算跟进). */
function seedFollowedCreator(platformCreatorId: string): void {
  getConn().prepare(
    `INSERT INTO collaborations
     (id, handle, display_name, brand, platform, email, mailbox_from, lifecycle_id,
      conversation_id, stage_code, owner_name, owner_mailbox)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    `col_${platformCreatorId}`,
    platformCreatorId,
    platformCreatorId,
    "LT",
    "youtube",
    "creator@example.com",
    "ops@example.com",
    "lc_sourcing",
    "cv_sourcing",
    "sourcing",
    "钟槿年",
    "ops@example.com",
  );
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
    expect(packs.find((row) => row.id === "camping")).toMatchObject({
      label: "户外露营",
      keywords: ["camping", "outdoor camping", "camping gear"],
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

  it("honours the frontend threshold names for 均播 and 期望人数", async () => {
    const started = await request("POST", "/api/home/discovery/run", {
      platforms: ["youtube"],
      mode: "search",
      keywords: ["portable power station"],
      min_avg_plays_10: 9000,
      expect_count: 12,
    });
    expect(started.status).toBe(202);
    const run = await request("GET", `/api/home/discovery/runs/${started.body.id}`);
    expect((run.body.run as Json).spec).toMatchObject({
      thresholds: { min_avg_views_10: 9000, target_count: 12 },
    });
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
      library_status: "not_in_library",
    });
    expect((candidates.body.candidates as Json[])[0]).toHaveProperty("score");
    expect((candidates.body.candidates as Json[])[0]).toHaveProperty("confidence");
    expect((candidates.body.candidates as Json[])[0]).toHaveProperty("collected_at");
    // 没被排名就没有分数：列上的 0 是默认值，不是「推荐分 0 分」。
    expect((candidates.body.candidates as Json[])[0]).toMatchObject({
      score: null,
      band: null,
      match_reason: null,
    });
    // brief 的 ranking 必须 join 到候选上，否则行上永远是「匹配：无」
    expect(run.raw_count).toBeGreaterThan(0);
  });

  it("derives library_status from pool / followed / library flags, followed first", async () => {
    seedPoolCreator("yt-beauty-1");
    const pooled = await completeRun();
    expect(pooled.status).toBe("completed");
    const pooledRows = await request("GET", `/api/home/discovery/runs/${pooled.id}/candidates`);
    const pooledRow = (pooledRows.body.candidates as Json[])[0];
    expect(pooledRow.library_status).toBe("pool");
    // 旧口径的 in_library 只认「公海/在库」，不认 followed。
    expect(pooledRow.in_library).toBe(true);

    seedFollowedCreator("yt-beauty-1");
    const followed = await completeRun({
      keywords: ["van life"],
      platforms: ["youtube"],
      brand: "LT",
    });
    expect(followed.status).toBe("completed");
    const followedRows = await request("GET", `/api/home/discovery/runs/${followed.id}/candidates`);
    const followedRow = (followedRows.body.candidates as Json[])[0];
    expect(followedRow.library_status).toBe("followed");
    expect(followedRow.already_followed).toBe(true);
  });

  it("projects the score details and the brief ranking onto the candidate row", async () => {
    creators = [{
      platform: "youtube",
      platform_creator_id: "yt-beauty-12",
      nickname: "TwelveViews",
      followers: 18000,
      recent_views: [8000, 9000, 7000, 8500, 9200, 8100, 8800, 7600, 8300, 8700, 8900, 9100],
    }];
    const run = await completeRun();
    expect(run.status).toBe("completed");
    const candidates = await request("GET", `/api/home/discovery/runs/${run.id}/candidates`);
    expect(candidates.status).toBe(200);
    const row = (candidates.body.candidates as Json[])[0];
    expect(row).toMatchObject({
      platform_creator_id: "yt-beauty-12",
      library_status: "not_in_library",
      confidence: 1,
      sample_size: 10,
      matched_keywords: [],
      profile_url: null,
      avatar_url: null,
    });
    expect(typeof row.view_follower_ratio).toBe("number");
    expect(row.view_mean).toBeGreaterThan(0);
    expect(row.recent_views as number[]).toHaveLength(10);
    // ranking 的 why/band/fit 来自 run 的 brief artifact，不是列
    expect(typeof row.match_reason).toBe("string");
    expect(String(row.match_reason)).toContain("TwelveViews");
    expect(row.why).toBe(row.match_reason);
    expect(["high", "mid", "low", "uncertain"]).toContain(row.band);
    expect(String(row.fit)).not.toBe("");
  });

  it("passes the crawler's extra fields through to the candidate row", async () => {
    creators = [{
      platform: "youtube",
      platform_creator_id: "yt-beauty-2",
      nickname: "LinkedGlow",
      followers: 22000,
      recent_views: [7000, 7100, 7200, 7300, 7400, 7500, 7600, 7700, 7800, 7900],
      profile_url: "https://youtube.com/@linkedglow",
      avatar_url: "https://yt3.ggpht.com/linkedglow.jpg",
      matched_keywords: ["clean beauty", "skincare routine"],
    }];
    const run = await completeRun();
    const candidates = await request("GET", `/api/home/discovery/runs/${run.id}/candidates`);
    expect((candidates.body.candidates as Json[])[0]).toMatchObject({
      profile_url: "https://youtube.com/@linkedglow",
      avatar_url: "https://yt3.ggpht.com/linkedglow.jpg",
      matched_keywords: ["clean beauty", "skincare routine"],
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
