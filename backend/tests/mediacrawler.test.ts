import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { mcpServerSpecs } from "../mcp/codex-config.js";
import { calculateCreatorScore, ingestMediacrawler } from "../src/adapters/claw.js";
import { parseMediaCrawlerConfigMarkdown } from "../src/config.js";
import {
  clearRemoteHistory,
  monitorCrawlJob,
  retryUpload,
  setCrawlMcpClientFactory,
  stopCrawl,
} from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import { RemoteMcpClient } from "../src/mcp/remote.js";
import { seedAll } from "../src/seed.js";
import type { Row } from "../src/types.js";

type Json = Record<string, unknown>;
let tmp = "";
let httpServer: http.Server | null = null;
let baseUrl = "";
const calls: string[] = [];
const creatorCallArgs: Json[] = [];
let crawlStatus: Json = { task_id: "remote-1", status: "idle" };

async function startMockMcp(): Promise<void> {
  const app = createMcpExpressApp();
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const makeServer = () => {
    const server = new McpServer({ name: "mock-mediacrawler", version: "1.0.0" });
    const tool = (name: string, handler: (args: Json) => Json) => server.registerTool(
      name,
      { inputSchema: { task_id: z.string().optional(), platform: z.string().optional(),
        mode: z.string().optional(), offset: z.number().optional(), limit: z.number().optional(),
        keywords: z.union([z.string(), z.array(z.string())]).optional(), confirm: z.boolean().optional() } },
      async (args) => {
        calls.push(name);
        return { content: [{ type: "text", text: JSON.stringify(handler(args as Json)) }] };
      },
    );
    tool("start_crawl", () => ({ task_id: "remote-1", status: "running" }));
    tool("get_crawl_status", () => crawlStatus);
    tool("get_crawl_logs", () => ({ logs: ["crawl completed", "Authorization: Bearer hidden"] }));
    tool("get_creators", (args) => {
      creatorCallArgs.push(args);
      return {
        creators: [{
          platform: "youtube", platform_creator_id: "creator-1", nickname: "真实达人",
          followers: 1000, recent_views: [100, 200, 300],
        }],
        has_more: false,
      };
    });
    tool("stop_crawl", () => ({ stopped: true }));
    tool("upload_creators", () => ({ uploaded: true }));
    tool("clear_history", () => ({ cleared: true }));
    return server;
  };
  app.use((req: any, res: any, next: () => void) => {
    if (req.headers.authorization !== "Bearer test-secret") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });
  app.post("/mcp", async (req: any, res: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports[sessionId] : undefined;
    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (id) => { transports[id] = transport!; },
      });
      await makeServer().connect(transport);
    }
    if (!transport) {
      res.status(400).json({ error: "missing session" });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  });
  app.delete("/mcp", async (req: any, res: any) => {
    const id = req.headers["mcp-session-id"] as string | undefined;
    if (id && transports[id]) {
      await transports[id].handleRequest(req, res);
      delete transports[id];
      return;
    }
    res.status(200).end();
  });
  httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/mcp`;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mediacrawler-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  calls.length = 0;
  creatorCallArgs.length = 0;
  crawlStatus = { task_id: "remote-1", status: "idle" };
  resetConn();
  seedAll();
  await startMockMcp();
  process.env.MEDIACRAWLER_MCP_URL = baseUrl;
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
});

afterEach(async () => {
  setCrawlMcpClientFactory();
  await new Promise<void>((resolve) => httpServer?.close(() => resolve()) || resolve());
  httpServer = null;
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
  delete process.env.MEDIACRAWLER_INGEST_TOKEN;
  delete process.env.MEDIACRAWLER_AUTO_START;
  delete process.env.MEDIACRAWLER_CREATOR_PAGE_SIZE;
  delete process.env.AUTH_MODE;
});

describe("remote Streamable HTTP MCP", () => {
  it("parses the remote URL and bearer credential from mcp_server.md", () => {
    expect(parseMediaCrawlerConfigMarkdown(`
      endpoint: http://crawler.example/mcp
      Authorization: Bearer test-token
    `)).toEqual({ url: "http://crawler.example/mcp", token: "test-token" });
  });

  it("lists and calls tools with bearer auth and JSON normalization", async () => {
    const client = new RemoteMcpClient();
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("start_crawl");
    expect(await client.callTool("start_crawl", { platform: "youtube", mode: "search", keywords: "battery" }))
      .toMatchObject({ task_id: "remote-1" });
    await client.close();
  });

  it("uses remote Codex config in real mode and local fallback only in stub mode", () => {
    process.env.CODEX_MODE = "real";
    process.env.CLAW_MODE = "remote";
    const remote = mcpServerSpecs(["claw.get_creators"]) as Record<string, Json>;
    expect(remote.claw).toMatchObject({
      url: baseUrl,
      bearer_token_env_var: "MEDIACRAWLER_MCP_TOKEN",
      enabled_tools: ["get_creators"],
    });
    expect(remote.claw.command).toBeUndefined();
    process.env.CODEX_MODE = "stub";
    const local = mcpServerSpecs(["claw.get_creators"]) as Record<string, Json>;
    expect(local.claw.command).toBe(process.execPath);
    expect(String((local.claw.args as string[])[1])).toMatch(/claw-server\.ts$/);
  });

  it("does not mount the local Claw HTTP mock in real remote mode", async () => {
    process.env.CODEX_MODE = "real";
    process.env.CLAW_MODE = "remote";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const response = await app.request("/mock/claw/api/v1/health");
    expect(response.status).toBe(404);
    process.env.CODEX_MODE = "stub";
    process.env.CLAW_MODE = "mock";
  });
});

describe("creator ingestion and scoring", () => {
  it("deduplicates identities, appends snapshots, and computes transparent score inputs", () => {
    const first = ingestMediacrawler({ creators: [{
      platform: "youtube", platform_creator_id: "same", nickname: "A",
      followers: 1000, recent_views: [100, 300],
    }] });
    const second = ingestMediacrawler({ data: { items: [{
      platform: "youtube", platform_creator_id: "same", nickname: "A2",
      followers: 1200, views: [200, 400],
    }] } });
    expect(first).toMatchObject({ accepted: 1, inserted: 1, updated: 0, rejected: 0 });
    expect(second).toMatchObject({ accepted: 1, inserted: 0, updated: 1, rejected: 0 });
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM claw_creators WHERE platform_creator_id='same'").get() as { n: number }).n).toBe(1);
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM creator_snapshots WHERE platform_creator_id='same'").get() as { n: number }).n).toBe(2);
    expect(calculateCreatorScore(1000, [100, 300])).toMatchObject({
      sample_size: 2, view_median: 200, view_mean: 200, view_follower_ratio: 0.2, sample_confidence: 0.2,
    });
  });

  it("accepts crawler auto-upload through the ingestion HTTP endpoint", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const response = await app.request("/api/integrations/mediacrawler/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creators: [{
          platform: "instagram",
          platform_creator_id: "up-9",
          nickname: "户外测评号",
          followers: 5000,
          views: [1000, 2000],
        }],
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: 1, inserted: 1, rejected: 0 });
  });

  it("rejects anonymous ingest when auth is enabled", async () => {
    process.env.AUTH_MODE = "enabled";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const response = await app.request("/api/integrations/mediacrawler/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creators: [{ platform: "instagram", platform_creator_id: "up-anon", nickname: "匿名入库" }],
      }),
    });
    expect(response.status).toBe(401);
  });

  it("accepts ingest with the shared crawler token when auth is enabled", async () => {
    process.env.AUTH_MODE = "enabled";
    process.env.MEDIACRAWLER_INGEST_TOKEN = "ingest-secret";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const response = await app.request("/api/integrations/mediacrawler/creators", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mediacrawler-token": "ingest-secret",
      },
      body: JSON.stringify({
        creators: [{
          platform: "instagram",
          platform_creator_id: "up-token",
          nickname: "令牌入库",
          followers: 100,
        }],
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: 1, inserted: 1, rejected: 0 });
  });
});

describe("crawl lifecycle", () => {
  it("rejects missing remote configuration before creating a crawl job", async () => {
    delete process.env.MEDIACRAWLER_MCP_URL;
    delete process.env.MEDIACRAWLER_MCP_TOKEN;
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_type: "creator_discovery", title: "采集达人" }),
    });
    const task = await created.json() as Json;
    const response = await app.request(`/api/tasks/${task.id}/actions/start-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "youtube", mode: "search", keywords: ["户外"] }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      detail: { code: "mediacrawler_not_configured", message: "远程采集服务未配置。" },
    });
    expect((getConn().prepare("SELECT COUNT(*) AS count FROM crawl_jobs").get() as { count: number }).count).toBe(0);
  });

  it("automatically starts a confirmed creator-discovery plan", async () => {
    process.env.MEDIACRAWLER_AUTO_START = "1";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/tasks/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索 YouTube 户外电源达人" }),
    });
    const task = await created.json() as { task: Json };
    const queued = await app.request(`/api/tasks/${task.task.id}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const run = await queued.json() as { session_id: string; pending_message: Json };
    await app.request(`/api/sessions/${run.session_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(run.pending_message),
    });
    let job: Row | undefined;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = getConn().prepare("SELECT * FROM crawl_jobs WHERE work_item_id=?").get(task.task.id) as Row | undefined;
      if (job?.remote_task_id) break;
    }
    expect(job).toMatchObject({ status: "crawling", remote_task_id: "remote-1" });
    expect(calls).toContain("start_crawl");
    await stopCrawl(String(job!.id));
  });

  it("pulls creators when only the remote auto-upload step failed", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_type: "creator_discovery", title: "采集达人" }),
    });
    const task = await created.json() as Json;
    const started = await app.request(`/api/tasks/${task.id}/actions/start-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "youtube", mode: "search", keywords: ["户外"] }),
    });
    const job = await started.json() as Json;
    crawlStatus = {
      task_id: "remote-1",
      status: "error",
      error_message: "Creator upload failed: stale KOL_INGESTION_URL returned 404",
    };
    const completed = await monitorCrawlJob(String(job.id));
    expect(completed.status).toBe("result_ready");
    expect(((completed.result as Json).candidates as Json[])[0]).toMatchObject({
      platform_creator_id: "creator-1",
    });
    const events = await (await app.request(`/api/tasks/${task.id}/crawl-job/events`)).json() as Json[];
    expect(events.map((event) => event.event_type)).toContain("upload_fallback");
    expect(calls).toContain("get_creators");
    expect(creatorCallArgs[0]).toEqual(expect.objectContaining({
      platform: "youtube",
      offset: 0,
      limit: expect.any(Number),
    }));
    expect(creatorCallArgs[0]).not.toHaveProperty("page");
    expect(creatorCallArgs[0]).not.toHaveProperty("page_size");
    expect(creatorCallArgs[0].task_id).toBeUndefined();
  });

  it("enforces one active job, emits task events, persists result artifact, and supports admin tools", async () => {
    process.env.CODEX_MODE = "stub";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const createTask = async () => {
      const response = await app.request("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_type: "creator_discovery", title: "采集达人" }),
      });
      return await response.json() as Json;
    };
    const first = await createTask();
    const second = await createTask();
    const start = (id: unknown, key: string) => app.request(`/api/tasks/${id}/actions/start-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ platform: "youtube", mode: "search", parameters: { keywords: ["battery"] } }),
    });
    const started = await start(first.id, "one");
    expect(started.status).toBe(202);
    expect((await start(first.id, "one")).status).toBe(200);
    expect((await start(second.id, "two")).status).toBe(409);
    const startedBody = await started.json() as Json;
    await monitorCrawlJob(String(startedBody.id));
    const job = await (await app.request(`/api/tasks/${first.id}/crawl-job`)).json() as Json;
    expect(job.status).toBe("result_ready");
    const candidates = ((job.result as Json).candidates as Json[]);
    expect(candidates[0]).toMatchObject({
      platform: "youtube",
      platform_creator_id: "creator-1",
      nickname: "真实达人",
      recent_views: [100, 200, 300],
      contact_needed: true,
    });
    expect((candidates[0].score_details as Json).sample_confidence).toBe(0.3);
    const detail = await (await app.request(`/api/tasks/${first.id}`)).json() as Json;
    expect(detail.status).toBe("waiting");
    expect((detail.artifacts as Json[]).some((artifact) => artifact.artifact_type === "task_result_card")).toBe(true);
    const events = await (await app.request(`/api/tasks/${first.id}/events`)).json() as Json[];
    expect(events.map((entry) => entry.event_type)).toContain("crawl.result_ready");
    expect(events.map((entry) => entry.event_type)).toContain("crawl.analyzing");
    const crawlEventRows = await (await app.request(`/api/tasks/${first.id}/crawl-job/events`)).json() as Json[];
    const operations = crawlEventRows
      .filter((entry) => entry.event_type === "operation")
      .map((entry) => (entry.payload as Json).operation);
    expect(operations).toEqual(expect.arrayContaining([
      "claw.start_crawl",
      "claw.get_crawl_status",
      "claw.get_crawl_logs",
      "claw.get_creators",
      "host.ingest_creators",
    ]));
    expect(await retryUpload(String(startedBody.id))).toMatchObject({ uploaded: true });
    expect(await clearRemoteHistory()).toMatchObject({ cleared: true });
    expect(calls).toEqual(expect.arrayContaining([
      "start_crawl", "get_crawl_status", "get_crawl_logs", "get_creators", "upload_creators", "clear_history",
    ]));
    expect(creatorCallArgs[0]).toEqual(expect.objectContaining({
      platform: "youtube",
      offset: 0,
      limit: expect.any(Number),
    }));
    expect(creatorCallArgs[0]).not.toHaveProperty("page");
    expect(creatorCallArgs[0]).not.toHaveProperty("page_size");
    expect(creatorCallArgs[0].task_id).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain("Bearer hidden");
  });

  /** 远端 `get_creators` 的分页契约：{task_id, platform, offset, limit}。 */
  function remotePagingStub(catalog: Json[], pages: Json[]) {
    return () => ({
      async callTool(name: string, args: Json = {}) {
        calls.push(name);
        if (name === "start_crawl") return { task_id: "remote-1", status: "running" };
        if (name === "get_crawl_status") return { task_id: "remote-1", status: "idle" };
        if (name === "get_crawl_logs") return { logs: [] };
        if (name === "get_creators") {
          pages.push(args);
          const extra = Object.keys(args).filter((key) => !["platform", "offset", "limit"].includes(key));
          if (extra.length) {
            throw new Error(`validation error: extra fields not permitted: ${extra.join(",")}`);
          }
          const offset = Number(args.offset);
          const limit = Number(args.limit);
          expect(Number.isInteger(offset) && offset >= 0).toBe(true);
          expect(Number.isInteger(limit) && limit >= 1).toBe(true);
          const slice = catalog.slice(offset, offset + limit);
          return {
            creators: slice,
            has_more: offset + slice.length < catalog.length,
            total: catalog.length,
          };
        }
        return {};
      },
      async close() {},
    });
  }

  async function runCreatorCrawl(): Promise<Json> {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_type: "creator_discovery", title: "采集达人" }),
    });
    const task = await created.json() as Json;
    const started = await app.request(`/api/tasks/${task.id}/actions/start-crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "youtube", mode: "search", keywords: ["户外"] }),
    });
    const job = await started.json() as Json;
    return monitorCrawlJob(String(job.id));
  }

  it("pages get_creators with platform/offset/limit; page/page_size would be ignored REAL", async () => {
    process.env.MEDIACRAWLER_CREATOR_PAGE_SIZE = "2";
    const pages: Json[] = [];
    const catalog = [
      { platform: "youtube", platform_creator_id: "yt-a", nickname: "Alpha", followers: 100, recent_views: [10] },
      { platform: "youtube", platform_creator_id: "yt-b", nickname: "Beta", followers: 200, recent_views: [20] },
      { platform: "youtube", platform_creator_id: "yt-c", nickname: "Gamma", followers: 300, recent_views: [30] },
    ];
    setCrawlMcpClientFactory(remotePagingStub(catalog, pages));
    const completed = await runCreatorCrawl();
    expect(completed.status).toBe("result_ready");
    expect(pages).toEqual([
      { platform: "youtube", offset: 0, limit: 2 },
      { platform: "youtube", offset: 2, limit: 2 },
    ]);
    const candidates = ((completed.result as Json).candidates as Json[]);
    expect(candidates.map((row) => row.platform_creator_id).sort()).toEqual(["yt-a", "yt-b", "yt-c"]);
  });

  it("accumulates offset per batch and never re-inserts the previous batch", async () => {
    process.env.MEDIACRAWLER_CREATOR_PAGE_SIZE = "2";
    const pages: Json[] = [];
    const catalog = ["a", "b", "c", "d", "e"].map((suffix, index) => ({
      platform: "youtube",
      platform_creator_id: `yt-page-${suffix}`,
      nickname: `Page${suffix.toUpperCase()}`,
      followers: 100 * (index + 1),
      recent_views: [10 * (index + 1)],
    }));
    setCrawlMcpClientFactory(remotePagingStub(catalog, pages));
    const completed = await runCreatorCrawl();
    expect(completed.status).toBe("result_ready");
    expect(pages.map((args) => args.offset)).toEqual([0, 2, 4]);
    expect(pages.every((args) => args.limit === 2)).toBe(true);
    expect(pages.every((args) => !("page" in args) && !("page_size" in args))).toBe(true);
    const stored = getConn().prepare(
      "SELECT platform_creator_id FROM claw_creators WHERE platform='youtube' ORDER BY platform_creator_id",
    ).all() as Array<{ platform_creator_id: string }>;
    // 第二页 offset 累加对了，就不会把第一页那批再插一次。
    expect(stored.map((row) => row.platform_creator_id)).toEqual([
      "yt-page-a", "yt-page-b", "yt-page-c", "yt-page-d", "yt-page-e",
    ]);
    expect(((completed.result as Json).candidates as Json[])).toHaveLength(5);
  });

  it("calls remote stop_crawl and releases the active lock", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_type: "creator_discovery" }),
    });
    const task = await created.json() as Json;
    await app.request(`/api/tasks/${task.id}/actions/start-crawl`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "youtube", mode: "search", parameters: { keywords: "battery" } }),
    });
    const stopped = await app.request(`/api/tasks/${task.id}/actions/stop-crawl`, { method: "POST" });
    expect(stopped.status).toBe(200);
    expect(calls).toContain("stop_crawl");
  });
});
