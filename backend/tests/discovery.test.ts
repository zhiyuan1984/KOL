import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { monitorCrawlJob } from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { buildHomeBoard, isInsightWorkItem, isTodoWorkItem } from "../src/host/home-board.js";
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
      if (name === "get_creators") {
        return { creators, has_more: false };
      }
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

async function completeFirstRun(): Promise<{ request: Json; runId: string; jobId: string }> {
  const created = await request("POST", "/api/discovery/requests", {
    keywords: ["portable power", "camping battery"],
    platforms: ["youtube"],
    mode: "search",
    brand: "LT",
  });
  expect(created.status).toBe(202);
  const requestBody = created.body;
  const runId = String((requestBody.latest_run as Json)?.id || "");
  const jobId = String((requestBody.latest_run as Json)?.crawl_job_id || "");
  expect(runId).toMatch(/^drun_/);
  expect(jobId).toMatch(/^crawl_/);
  await monitorCrawlJob(jobId);
  return { request: (await request("GET", `/api/discovery/requests/${requestBody.id}`)).body, runId, jobId };
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
  it("creates a request and kicks off an overseas MediaCrawler run", async () => {
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["portable power"],
      platforms: ["youtube"],
    });
    expect(created.status).toBe(202);
    expect(created.body).toMatchObject({
      keywords: ["portable power"],
      platforms: ["youtube"],
      mode: "search",
    });
    expect(["running", "queued", "succeeded"]).toContain(created.body.status);
    expect((created.body.latest_run as Json)?.platform).toBe("youtube");
    expect(OVERSEAS_CRAWL_PLATFORMS).toContain((created.body.latest_run as Json)?.platform);
    expect(calls).toContain("start_crawl");
    const listed = await request("GET", "/api/discovery/requests");
    expect(listed.status).toBe(200);
    expect(listed.body as unknown as Json[]).toHaveLength(1);
    const one = await request("GET", `/api/discovery/requests/${created.body.id}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(created.body.id);
  });

  it("can create a request without starting a run", async () => {
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["solar"],
      platforms: ["instagram"],
      start: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("open");
    expect(created.body.latest_run).toBeNull();
    expect(calls).not.toContain("start_crawl");
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {
      platform: "instagram",
    });
    expect(started.status).toBe(202);
    expect(started.body.platform).toBe("instagram");
    expect(OVERSEAS_CRAWL_PLATFORMS).toContain(started.body.platform);
  });

  it("rejects domestic platforms as the scenario under test", async () => {
    for (const platform of ["xhs", "dy", "bili", "zhihu"]) {
      const res = await request("POST", "/api/discovery/requests", {
        keywords: ["户外"],
        platforms: [platform],
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ detail: { code: "overseas_platforms_only" } });
    }
    expect(calls).not.toContain("start_crawl");
  });
});

describe("discovery run lifecycle", () => {
  it("mirrors crawl completion into candidates without creating Collaboration", async () => {
    const { request: req, runId } = await completeFirstRun();
    expect(req.status).toBe("succeeded");
    expect((req.result as Json).ready).toBe(true);
    expect((req.result as Json).suggested_count).toBe(1);
    expect((req.result as Json).pending_confirm).toBe(true);

    const run = await request("GET", `/api/discovery/runs/${runId}`);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe("succeeded");
    expect(run.body.platform).toBe("youtube");

    const page = await request("GET", `/api/discovery/runs/${runId}/candidates`);
    expect(page.status).toBe(200);
    const items = (page.body.items as Json[]) || [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      platform: "youtube",
      platform_creator_id: "yt-outdoor-1",
      nickname: "OutdoorPower",
      status: "suggested",
      collaboration_id: null,
      insight: true,
    });
    expect(OVERSEAS_CRAWL_PLATFORMS).toContain(items[0].platform);
    expect(JSON.stringify(page.body)).not.toContain("hidden-secret");
    expect(JSON.stringify(page.body)).not.toContain("Bearer hidden");

    expect(Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'",
    ).get() as { n: number }).n)).toBe(0);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("lists request + latest run summary after a retry run", async () => {
    const { request: first } = await completeFirstRun();
    const retry = await request("POST", `/api/discovery/requests/${first.id}/runs`, {
      platform: "youtube",
    }, { "Idempotency-Key": "retry-youtube" });
    expect([202, 409]).toContain(retry.status);
    const listed = await request("GET", "/api/discovery/requests");
    expect((listed.body as unknown as Json[])[0].id).toBe(first.id);
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
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["camping"],
      platforms: ["youtube"],
    });
    const jobId = String((created.body.latest_run as Json)?.crawl_job_id || "");
    await monitorCrawlJob(jobId);
    const runId = String((created.body.latest_run as Json)?.id || "");
    const page = await request("GET", `/api/discovery/runs/${runId}/candidates`);
    const items = page.body.items as Json[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    const first = items.find((row) => row.platform_creator_id === "yt-outdoor-1") || items[0];
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
    expect(String((followed.body.collaboration as Json).id)).toMatch(/^col_/);
    expect(followed.body.created).toBe(true);

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
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get() as { n: number }).n)).toBe(0);
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_stage_writes").get() as { n: number }).n)).toBe(0);

    const detail = await request("GET", `/api/discovery/candidates/${first.id}`);
    expect(detail.body).toMatchObject({ status: "followed", platform: "youtube" });
  });

  it("does not auto-create Collaboration when crawl completes", async () => {
    await completeFirstRun();
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE status='suggested'").get()).toEqual({ n: 1 });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });
});

describe("home board AI发现 consumption", () => {
  it("surfaces pending candidates as source=ai insights and keeps discovery work items out of todos", async () => {
    expect(isTodoWorkItem({ source: "discovery", status: "pending" })).toBe(false);
    expect(isInsightWorkItem({ source: "discovery", status: "pending" })).toBe(false);
    expect(isInsightWorkItem({ source: "ai", status: "pending" })).toBe(true);

    const { runId } = await completeFirstRun();
    const page = await request("GET", `/api/discovery/runs/${runId}/candidates`);
    const candidate = (page.body.items as Json[])[0];

    const board = buildHomeBoard() as Json;
    const workbench = board.workbench as Json;
    expect(workbench.discovery).toMatchObject({ pending_count: 1, ready: true });
    const pending = workbench.discovery as Json;
    expect((pending.candidates as Json[])[0]).toMatchObject({
      id: candidate.id,
      status: "suggested",
      platform: "youtube",
    });
    const recs = workbench.recommendations as Json[];
    expect(recs.some((row) => row.source === "ai" && row.candidate_id === candidate.id)).toBe(true);
    expect((workbench.todo as Json[]).some((row) => String(row.source) === "discovery")).toBe(false);
    expect((workbench.insights as Json[]).some((row) => String(row.source) === "discovery")).toBe(false);

    await request("POST", `/api/discovery/candidates/${candidate.id}/follow`);
    const after = buildHomeBoard() as Json;
    expect((after.workbench as Json).discovery).toMatchObject({ pending_count: 0, ready: false });
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
    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(created.body)).not.toContain("super-secret-token");
    const failed = getConn().prepare("SELECT error FROM discovery_runs ORDER BY created_at DESC LIMIT 1").get() as
      | { error?: string }
      | undefined;
    expect(String(failed?.error || "")).not.toContain("super-secret-token");
    expect(String(failed?.error || "")).toMatch(/\*\*\*/);
  });
});
