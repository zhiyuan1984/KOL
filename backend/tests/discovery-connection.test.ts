import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEMO_USER } from "../src/config.js";
import {
  resetCollectorConnectionCache,
  setCollectorProbeClientFactory,
  setCollectorProbeFetch,
} from "../src/crawl/connection.js";
import { monitorCrawlJob, setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import {
  COLLECTOR_CONNECT_MESSAGE,
  COLLECTOR_NOT_CONFIGURED_MESSAGE,
  CRAWL_ACTIVE_MESSAGE,
  employeeError,
  isConnectionClassError,
} from "../src/discovery-errors.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";

const STREAMABLE_404 = "Streamable HTTP error: Error POSTing to endpoint (HTTP 404)";
const FETCH_FAILED = "fetch failed";
const ECONN = "connect ECONNREFUSED 127.0.0.1:9";

let tmp = "";
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

function assertEmployeeCopy(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(
    /MediaCrawler|mediacrawler|\bMCP\b|Codex|Job ID|crawl_job|remote_task|Streamable|ECONNREFUSED|Failed to fetch|HTTP 404|Bearer |https?:\/\//i,
  );
}

function mockCrawl(handler: (name: string) => Json | Promise<Json> | never) {
  setCrawlMcpClientFactory(() => ({
    async callTool(name: string) {
      return handler(name);
    },
    async close() {},
  }));
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-disc-conn-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  process.env.MEDIACRAWLER_PROBE_TIMEOUT_MS = "400";
  resetConn();
  seedAll();
  resetCollectorConnectionCache();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  setCrawlMcpClientFactory();
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
  delete process.env.MEDIACRAWLER_PROBE_TIMEOUT_MS;
  delete process.env.AUTH_MODE;
});

describe("employeeError mapping", () => {
  it("maps Streamable HTTP / network / MCP 404/401/timeout to 采集服务连接失败", () => {
    for (const raw of [
      STREAMABLE_404,
      FETCH_FAILED,
      ECONN,
      "Failed to fetch",
      "getaddrinfo ENOTFOUND crawler.example",
      "request timed out",
      "MCP error 401 unauthorized",
      "Error POSTing to endpoint (HTTP 401)",
      { message: STREAMABLE_404 },
    ]) {
      expect(isConnectionClassError(raw)).toBe(true);
      expect(employeeError(raw)).toBe(COLLECTOR_CONNECT_MESSAGE);
    }
  });

  it("keeps Chinese business copy and does not leak engine tokens", () => {
    expect(employeeError("请先填写要发现的关键词。")).toBe("请先填写要发现的关键词。");
    expect(employeeError("远程采集服务未配置。")).toBe("远程采集服务未配置。");
    expect(employeeError("Authorization: Bearer super-secret-token failed")).toBe(COLLECTOR_CONNECT_MESSAGE);
    expect(employeeError("start_crawl returned no task_id")).toBe("发现未完成，请稍后重试。");
    expect(employeeError({ code: "collector_unreachable", message: COLLECTOR_CONNECT_MESSAGE }))
      .toBe(COLLECTOR_CONNECT_MESSAGE);
    expect(JSON.stringify(employeeError(STREAMABLE_404))).not.toMatch(/Streamable|HTTP 404|MCP/i);
  });
});

describe("GET/POST /api/discovery/connection", () => {
  it("returns not_configured when URL+token are missing", async () => {
    delete process.env.MEDIACRAWLER_MCP_URL;
    delete process.env.MEDIACRAWLER_MCP_TOKEN;
    resetCollectorConnectionCache();
    const got = await request("GET", "/api/discovery/connection");
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      status: "not_configured",
      credentials_present: false,
      reachable: false,
      connected: false,
      status_label: "未配置",
      message: COLLECTOR_NOT_CONFIGURED_MESSAGE,
    });
    expect(got.body.checked_at).toBeTruthy();
    assertEmployeeCopy(got.body);
  });

  it("returns unreachable when the MCP host connection is refused", async () => {
    setCollectorProbeFetch(async () => {
      throw new Error(ECONN);
    });
    const got = await request("POST", "/api/discovery/connection", {});
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      status: "unreachable",
      credentials_present: true,
      reachable: false,
      connected: false,
      status_label: "连接失败",
      message: COLLECTOR_CONNECT_MESSAGE,
    });
    expect(got.body.checked_at).toBeTruthy();
    assertEmployeeCopy(got.body);
  });

  it("returns unreachable when initialize/listTools hits Streamable HTTP 404", async () => {
    setCollectorProbeFetch(async () => new Response("not found", { status: 404 }));
    setCollectorProbeClientFactory(() => ({
      async listTools() {
        throw new Error(STREAMABLE_404);
      },
      async close() {},
    }));
    const got = await request("GET", "/api/discovery/connection");
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      status: "unreachable",
      credentials_present: true,
      connected: false,
      message: COLLECTOR_CONNECT_MESSAGE,
      status_label: "连接失败",
    });
    assertEmployeeCopy(got.body);
  });

  it("returns ok only after a live listTools probe succeeds", async () => {
    setCollectorProbeFetch(async () => new Response("ok", { status: 200 }));
    setCollectorProbeClientFactory(() => ({
      async listTools() {
        return [{ name: "start_crawl" }];
      },
      async close() {},
    }));
    const got = await request("POST", "/api/discovery/connection", {});
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      status: "ok",
      credentials_present: true,
      reachable: true,
      connected: true,
      status_label: "已配置",
      message: "采集服务可用",
    });
    assertEmployeeCopy(got.body);
  });

  it("bounds a hung probe and reports unreachable without leaking the URL", async () => {
    setCollectorProbeFetch(() => new Promise(() => undefined) as Promise<Response>);
    const started = Date.now();
    const got = await request("GET", "/api/discovery/connection");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(got.status).toBe(200);
    expect(got.body.status).toBe("unreachable");
    expect(JSON.stringify(got.body)).not.toContain("127.0.0.1");
    expect(JSON.stringify(got.body)).not.toContain("test-secret");
    assertEmployeeCopy(got.body);
  });
});

describe("discovery run / completeJob surfaces Chinese connection errors", () => {
  it("maps start_crawl Streamable HTTP 404 to 采集服务连接失败", async () => {
    mockCrawl(() => {
      throw new Error(STREAMABLE_404);
    });
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["portable power"],
      platforms: ["youtube"],
    });
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
    expect(started.status).toBe(502);
    expect(started.body.detail).toMatchObject({
      code: "collector_unreachable",
      message: COLLECTOR_CONNECT_MESSAGE,
    });
    assertEmployeeCopy(started.body);
    const results = await request("GET", `/api/discovery/requests/${created.body.id}/results`);
    expect(results.status).toBe(200);
    expect(results.body.error || (results.body.run as Json | undefined)?.error).toBe(COLLECTOR_CONNECT_MESSAGE);
    expect((results.body.run as Json).status).toBe("failed");
    expect((results.body.run as Json).status_label).toBe("失败");
    expect(results.body.connection).toBeTruthy();
    assertEmployeeCopy(results.body);
    const stored = getConn().prepare("SELECT error FROM discovery_runs ORDER BY created_at DESC LIMIT 1").get() as
      | { error?: string }
      | undefined;
    expect(stored?.error).toBe(COLLECTOR_CONNECT_MESSAGE);
  });

  it("maps crawl_active to Chinese copy and never persists empty-code JSON", async () => {
    const now = new Date().toISOString();
    getConn().prepare(
      `INSERT INTO work_items
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "tsk_active_crawl",
      DEMO_USER.id,
      "creator_discovery",
      "active crawl blocker",
      "manual",
      "running",
      "normal",
      "creator_discovery",
      "lead",
      "{}",
      "{}",
      now,
      now,
    );
    getConn().prepare(
      `INSERT INTO crawl_jobs
       (id,idempotency_key,owner_user_id,work_item_id,platform,mode,parameters,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "crawl_activeblocker",
      "idem-active-blocker",
      DEMO_USER.id,
      "tsk_active_crawl",
      "youtube",
      "search",
      JSON.stringify({ keywords: ["blocker"] }),
      "crawling",
      now,
      now,
    );
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["portable power station", "outdoor review"],
      platforms: ["youtube"],
    });
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
    expect(started.status).toBe(409);
    expect(started.body.detail).toMatchObject({
      code: "crawl_active",
      message: CRAWL_ACTIVE_MESSAGE,
    });
    expect(JSON.stringify(started.body)).not.toMatch(/\{\"code\":\"\"/);
    assertEmployeeCopy(started.body);
    const stored = getConn().prepare("SELECT error, started_at FROM discovery_runs ORDER BY created_at DESC LIMIT 1").get() as
      | { error?: string; started_at?: string | null }
      | undefined;
    expect(stored?.error).toBe(CRAWL_ACTIVE_MESSAGE);
    expect(stored?.error).not.toMatch(/\{/);
  });

  it("maps completeJob / get_creators connection failure into the discovery run", async () => {
    mockCrawl((name) => {
      if (name === "start_crawl") return { task_id: "remote-disc-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-disc-1", status: "idle" };
      if (name === "get_crawl_logs") return { logs: [] };
      if (name === "get_creators") throw new Error(STREAMABLE_404);
      return {};
    });
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["camping battery"],
      platforms: ["youtube"],
    });
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
    expect(started.status).toBe(202);
    const jobId = String(
      (getConn().prepare(
        "SELECT crawl_job_id FROM discovery_runs WHERE id=?",
      ).get(started.body.id) as { crawl_job_id?: string }).crawl_job_id,
    );
    await monitorCrawlJob(jobId);
    const results = await request("GET", `/api/discovery/requests/${created.body.id}/results`);
    expect(results.status).toBe(200);
    expect((results.body.run as Json).status).toBe("failed");
    expect((results.body.run as Json).error).toBe(COLLECTOR_CONNECT_MESSAGE);
    expect(results.body.error).toBe(COLLECTOR_CONNECT_MESSAGE);
    expect((results.body.request as Json).error).toBe(COLLECTOR_CONNECT_MESSAGE);
    assertEmployeeCopy(results.body);
  });

  it("attaches a live probe snapshot after check-connection", async () => {
    setCollectorProbeFetch(async () => new Response("ok", { status: 200 }));
    setCollectorProbeClientFactory(() => ({
      async listTools() {
        return [{ name: "start_crawl" }];
      },
      async close() {},
    }));
    const probed = await request("GET", "/api/discovery/connection");
    expect(probed.body.status).toBe("ok");
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["solar"],
      platforms: ["youtube"],
    });
    expect(created.body.connection).toMatchObject({
      status: "ok",
      credentials_present: true,
      connected: true,
      status_label: "已配置",
    });
    assertEmployeeCopy(created.body);
  });
});
