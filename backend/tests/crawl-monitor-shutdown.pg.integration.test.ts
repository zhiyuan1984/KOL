import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drainBackgroundWork } from "../src/background-work.js";
import { monitorCrawlJob, restoreActiveCrawlJobs, setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { seedAll } from "../src/seed.js";
import { configureCrawlerFixture } from "./helpers/crawler-vault.js";
import { freshTestDatabase } from "./support/pg.js";

let app: Hono;
let dir = "";
const calls: string[] = [];
beforeEach(async () => {
  await freshTestDatabase();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-monitor-shutdown-"));
  process.env.LINGONG_DATA = dir;
  process.env.LINGONG_DB = path.join(dir, "unused.db");
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  calls.length = 0;
  await resetConn();
  await seedAll();
  await configureCrawlerFixture();
  setCrawlMcpClientFactory(() => ({
    async callTool(name: string) {
      calls.push(name);
      if (name === "start_crawl") return { task_id: "monitor-remote-1", status: "running" };
      if (name === "get_crawl_status") return { status: "idle" };
      if (name === "get_crawl_logs") return { logs: [] };
      if (name === "get_creators") return { creators: [{ platform: "youtube", platform_creator_id: "timer-1", nickname: "TimerCreator", followers: 1000, recent_views: [100, 200] }], has_more: false };
      return {};
    },
    async close() {},
  }));
  const { createApp } = await import("../src/app.js");
  app = await createApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetConn();
  setCrawlMcpClientFactory();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
});

function captureMonitorTimer() {
  const interval = process.env.MEDIACRAWLER_POLL_INTERVAL_MS;
  process.env.MEDIACRAWLER_POLL_INTERVAL_MS = "1234";
  const original = globalThis.setTimeout;
  const entries: Array<{ run: () => unknown; handle: ReturnType<typeof setTimeout> }> = [];
  const timers = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => unknown, ms?: number, ...args: unknown[]) => {
    if (ms === 1234) {
      const handle = { unref() { return this; } } as unknown as ReturnType<typeof setTimeout>;
      entries.push({ run: fn, handle });
      return handle;
    }
    return Reflect.apply(original, globalThis, [fn, ms, ...args]);
  }) as typeof setTimeout);
  return { entries, restore() {
    timers.mockRestore();
    if (interval === undefined) delete process.env.MEDIACRAWLER_POLL_INTERVAL_MS;
    else process.env.MEDIACRAWLER_POLL_INTERVAL_MS = interval;
  } };
}
async function start(): Promise<string> {
  const created = await app.request("/api/discovery/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords: ["portable power"], platforms: ["youtube"], brand: "LT", filters: {} }) });
  expect(created.status, await created.clone().text()).toBe(201);
  const request = await created.json() as { id: string };
  const started = await app.request(`/api/discovery/requests/${request.id}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(started.status, await started.clone().text()).toBe(202);
  const row = (await getConn().query("SELECT crawl_job_id FROM discovery_runs WHERE request_id=$1 ORDER BY created_at DESC LIMIT 1", [request.id])).rows[0] as { crawl_job_id: string };
  return row.crawl_job_id;
}

describe("crawl monitor shutdown and restoration", () => {
  it("cancels a completed job's timer and rejects its already queued callback without reconnecting", async () => {
    const capture = captureMonitorTimer();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    let connect: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const id = await start();
      expect(capture.entries).toHaveLength(1);
      await monitorCrawlJob(id);
      await drainBackgroundWork();
      expect(clear).toHaveBeenCalledWith(capture.entries[0]!.handle);
      await closePostgresPool();
      connect = vi.spyOn(Pool.prototype, "connect");
      await capture.entries[0]!.run();
      await drainBackgroundWork();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect?.mockRestore();
      clear.mockRestore();
      capture.restore();
      await closePostgresPool();
    }
  });

  it("drains an in-flight monitor before ending the pool, then restores the durable active job", async () => {
    const capture = captureMonitorTimer();
    const pool = postgresPool();
    const query = pool.query.bind(pool);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    const queries = vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
      if (String(args[0]).includes("SELECT status,started_at,created_at FROM crawl_jobs")) {
        entered = true;
        return barrier.then(() => Reflect.apply(query, pool, args));
      }
      return Reflect.apply(query, pool, args);
    }) as typeof pool.query);
    const end = vi.spyOn(pool, "end");
    let closing: Promise<void> | undefined;
    let callback: Promise<unknown> = Promise.resolve();
    try {
      const id = await start();
      expect(capture.entries).toHaveLength(1);
      callback = Promise.resolve(capture.entries[0]!.run());
      // The old async timer's rejection is collected even on the deliberate counterexample.
      const observed = Promise.allSettled([callback]);
      await vi.waitFor(() => expect(entered).toBe(true));
      closing = closePostgresPool();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(end).not.toHaveBeenCalled();
      release();
      await closing;
      await observed;
      expect(end).toHaveBeenCalledOnce();
      expect(calls.filter(name => name === "get_crawl_status")).toHaveLength(0);
      queries.mockRestore();
      end.mockRestore();
      const active = (await postgresPool().query("SELECT status FROM crawl_jobs WHERE id=$1", [id])).rows[0] as { status: string };
      expect(active.status).toBe("crawling");
      await restoreActiveCrawlJobs();
      expect(capture.entries).toHaveLength(2);
      await capture.entries[1]!.run();
      await drainBackgroundWork();
      const ready = (await postgresPool().query("SELECT status FROM crawl_jobs WHERE id=$1", [id])).rows[0] as { status: string };
      expect(ready.status).toBe("result_ready");
      expect(calls.filter(name => name === "get_crawl_status")).toHaveLength(1);
    } finally {
      release();
      await Promise.allSettled([callback]);
      await closing;
      queries.mockRestore();
      end.mockRestore();
      capture.restore();
    }
  });
});
