import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAgentSubmissionOverride } from "../src/contract-scope.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { authenticatedTestApp, seedRuntimeTestActor } from "./fixtures/runtime-auth.js";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");
let tmp = "";
let runtimeCookie = "";
const savedCrawlEnv = {
  url: process.env.MEDIACRAWLER_MCP_URL,
  token: process.env.MEDIACRAWLER_MCP_TOKEN,
  autoStart: process.env.MEDIACRAWLER_AUTO_START,
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-async-"));
  fs.chmodSync(fake, 0o755);
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.AUTH_MODE = "enabled";
  process.env.CODEX_BIN = fake;
  process.env.FAKE_CODEX_MODE = "crawl-plan-success";
  process.env.FAKE_CODEX_DELAY = "150";
  process.env.HOST_WORKER_TIMEOUT = "2";
  process.env.HOME = tmp;
  process.env.CODEX_HOME = path.join(tmp, ".codex");
  fs.mkdirSync(process.env.CODEX_HOME);
  // These tests exercise Host + fake Codex only. Inherited MediaCrawler
  // credentials must not auto-start a LIVE crawl after the crawl plan lands.
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
  delete process.env.MEDIACRAWLER_AUTO_START;
  setAgentSubmissionOverride();
  resetConn();
  seedAll();
  runtimeCookie = seedRuntimeTestActor(["creator_discovery"]);
  getConn().prepare(
    `INSERT OR REPLACE INTO claw_creators
     (id, handle, name, platform, followers, score, status, outreach_script, payload)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    "cr_async_kol",
    "async-creator",
    "async-creator",
    "youtube",
    1000,
    8,
    "discovered",
    "Hi, LiTime would like to collaborate.",
    JSON.stringify({ email: "async.creator@example.com" }),
  );
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 80));
  setAgentSubmissionOverride();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  delete process.env.CODEX_BIN;
  delete process.env.FAKE_CODEX_MODE;
  delete process.env.FAKE_CODEX_DELAY;
  delete process.env.HOST_WORKER_TIMEOUT;
  if (savedCrawlEnv.url === undefined) delete process.env.MEDIACRAWLER_MCP_URL;
  else process.env.MEDIACRAWLER_MCP_URL = savedCrawlEnv.url;
  if (savedCrawlEnv.token === undefined) delete process.env.MEDIACRAWLER_MCP_TOKEN;
  else process.env.MEDIACRAWLER_MCP_TOKEN = savedCrawlEnv.token;
  if (savedCrawlEnv.autoStart === undefined) delete process.env.MEDIACRAWLER_AUTO_START;
  else process.env.MEDIACRAWLER_AUTO_START = savedCrawlEnv.autoStart;
});

describe("real Codex HTTP flow", () => {
  it("acknowledges creator discovery immediately and publishes the background outcome", async () => {
    const { createApp } = await import("../src/app.js");
    const app = authenticatedTestApp(createApp(), runtimeCookie);
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "async discovery" }),
    });
    const { id } = (await created.json()) as { id: string };

    const startedAt = Date.now();
    const response = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索 YouTube 露营达人", intent: "creator_discovery", act: "ask" }),
    });
    const body = (await response.json()) as {
      accepted?: boolean;
      agent_status?: string;
      messages?: unknown[];
    };
    expect(response.status).toBe(202);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(body.accepted).toBe(true);
    expect(body.agent_status).toBe("running");
    expect(body.messages?.length).toBeGreaterThan(0);
    expect(
      (body.messages as { kind?: string; payload?: { status?: string } }[]).some(
        (m) => m.kind === "job_status" && m.payload?.status === "running",
      ),
    ).toBe(true);

    await new Promise((r) => setTimeout(r, 40));
    const inProgress = (await (await app.request(`/api/sessions/${id}`)).json()) as {
      agent_status?: string;
      messages?: { kind?: string; payload?: { text?: string; status?: string } }[];
    };
    expect(inProgress.agent_status).toBe("running");
    expect(
      inProgress.messages?.some(
        (m) => m.kind === "job_status" && m.payload?.status === "running",
      ),
    ).toBe(true);

    let session: { agent_status?: string; messages?: { kind?: string }[] } = {};
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      session = (await (await app.request(`/api/sessions/${id}`)).json()) as typeof session;
      if (session.agent_status !== "running") break;
    }
    expect(session.agent_status).toBe("listening");
    expect(session.messages?.some((m) => m.kind === "crawl_plan" || m.kind === "email_card" || m.kind === "task_result_card")).toBe(true);
    expect(session.messages?.some((m) => m.kind === "process_trace")).toBe(true);
    const trace = session.messages?.find((m) => m.kind === "process_trace") as
      | { payload?: { items?: { status?: string; label?: string }[]; summaries?: string[] } }
      | undefined;
    expect(trace?.payload?.items?.every((item) => item.status === "done")).toBe(true);
    expect((trace?.payload?.items || []).map((item) => String(item.label || ""))).toContain("已根据平台和关键词整理采集范围。");
    expect(JSON.stringify(trace?.payload?.items || [])).not.toContain("理解任务");
    expect(JSON.stringify(trace?.payload?.items || [])).not.toContain("校验安全边界与格式");
    expect((trace?.payload?.summaries || []).length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(trace?.payload)).not.toContain("raw hidden reasoning");
    expect(
      session.messages?.some(
        (m) => m.kind === "job_status" && (m as { payload?: { status?: string } }).payload?.status === "done",
      ),
    ).toBe(true);
    const audit = (await (await app.request("/api/audit")).json()) as {
      event_type?: string;
      payload?: { skill?: string; item_types?: string[] };
    }[];
    expect(audit.some((e) => e.event_type === "skill.invoked" && e.payload?.skill === "creator_discovery")).toBe(true);
    expect(
      audit.some(
        (e) =>
          e.event_type === "skill.result" &&
          e.payload?.skill === "creator_discovery",
      ),
    ).toBe(true);
    const workers = (await (await app.request("/api/workers")).json()) as {
      skill?: string;
      contract_log?: { method?: string; params?: { names?: string[] } }[];
    }[];
    const discoveryWorker = workers.find((worker) => worker.skill === "creator_discovery");
    expect(
      discoveryWorker?.contract_log?.find((entry) => entry.method === "mcp_servers")?.params?.names,
    ).toEqual(["skill_runtime"]);
  });

  it("streams reasoning/process and persists a generic right-side task result", async () => {
    process.env.FAKE_CODEX_MODE = "crawl-plan-success";
    process.env.FAKE_CODEX_DELAY = "120";
    const { createApp } = await import("../src/app.js");
    const app = authenticatedTestApp(createApp(), runtimeCookie);
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "discovery review" }),
    });
    const { id } = (await created.json()) as { id: string };
    const response = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索 YouTube 露营达人", intent: "creator_discovery", act: "ask" }),
    });
    expect(response.status).toBe(202);

    let session: {
      agent_status?: string;
      messages?: { kind?: string; payload?: Record<string, unknown> }[];
    } = {};
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      session = (await (await app.request(`/api/sessions/${id}`)).json()) as typeof session;
      if (session.agent_status !== "running") break;
    }
    const result = session.messages?.find((message) =>
      message.kind === "task_result_card" || message.kind === "crawl_plan",
    );
    expect(result).toBeTruthy();
    const processTrace = session.messages?.find((message) => message.kind === "process_trace");
    expect(Array.isArray(processTrace?.payload?.summaries)).toBe(true);
    expect(JSON.stringify(processTrace?.payload)).not.toContain("raw generic reasoning");
    expect(JSON.stringify(processTrace?.payload?.items || [])).toContain("已根据平台和关键词整理采集范围。");
    expect(JSON.stringify(processTrace?.payload?.items || [])).not.toContain("理解任务");
    const operations = session.messages?.find((message) => message.kind === "operation_trace");
    expect(operations?.payload?.title).toBe("远程MCP调用");
    expect(operations?.payload?.items).toEqual([]);
  });

  it("produces a strict crawl plan without mounting a direct supplier MCP in the planning turn", async () => {
    process.env.FAKE_CODEX_MODE = "crawl-plan-success";
    process.env.FAKE_CODEX_DELAY = "50";
    const { createApp } = await import("../src/app.js");
    const app = authenticatedTestApp(createApp(), runtimeCookie);
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "strict discovery plan" }),
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    const started = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索 YouTube 露营达人", intent: "creator_discovery", act: "ask" }),
    });
    expect(started.status).toBe(202);
    let session: { agent_status?: string; messages?: { kind?: string; payload?: Record<string, unknown> }[] } = {};
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      session = (await (await app.request(`/api/sessions/${id}`)).json()) as typeof session;
      if (session.agent_status !== "running") break;
    }
    const plan = session.messages?.find((message) => message.kind === "crawl_plan");
    expect(plan?.payload?.crawl_plan).toMatchObject({
      platform: "youtube",
      mode: "search",
      keywords: ["露营"],
      specified_ids: [],
      creator_ids: [],
      requires_confirmation: false,
    });
    const workers = (await (await app.request("/api/workers")).json()) as {
      skill?: string;
      contract_log?: { method?: string; params?: { names?: string[] } }[];
    }[];
    const worker = workers.find((item) => item.skill === "creator_discovery");
    expect(worker?.contract_log?.find((entry) => entry.method === "mcp_servers")?.params?.names).toEqual(["skill_runtime"]);
  });

  it("POST /stop aborts an in-flight Codex turn and returns listening", async () => {
    process.env.FAKE_CODEX_MODE = "crawl-plan-success";
    process.env.FAKE_CODEX_DELAY = "2000";
    process.env.HOST_WORKER_TIMEOUT = "8";
    const { createApp } = await import("../src/app.js");
    const app = authenticatedTestApp(createApp(), runtimeCookie);
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "stop discovery" }),
    });
    const { id } = (await created.json()) as { id: string };
    const started = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索 YouTube 露营达人", intent: "creator_discovery", act: "ask" }),
    });
    expect(started.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const inProgress = (await (await app.request(`/api/sessions/${id}`)).json()) as { agent_status?: string };
    expect(inProgress.agent_status).toBe("running");

    const stopStarted = Date.now();
    const stopped = await app.request(`/api/sessions/${id}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const stopBody = (await stopped.json()) as { stopped?: boolean; agent_status?: string };
    expect(stopped.status).toBe(200);
    expect(stopBody.stopped).toBe(true);
    expect(stopBody.agent_status).toBe("listening");
    expect(Date.now() - stopStarted).toBeLessThan(1500);

    let session: {
      agent_status?: string;
      messages?: { kind?: string; payload?: { status?: string; text?: string } }[];
    } = {};
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      session = (await (await app.request(`/api/sessions/${id}`)).json()) as typeof session;
      const stoppedJob = session.messages?.some(
        (message) => message.kind === "job_status" && String(message.payload?.text || "").includes("已停止"),
      );
      if (session.agent_status !== "running" && stoppedJob) break;
    }
    expect(session.agent_status).toBe("listening");
    expect(
      session.messages?.some(
        (message) => message.kind === "job_status" && String(message.payload?.text || "").includes("已停止"),
      ),
    ).toBe(true);
    expect(session.messages?.some((message) => message.kind === "crawl_plan")).toBe(false);
  });

  it("blocks employee submission when the publish gate is stubbed unpublished", async () => {
    setAgentSubmissionOverride(false);
    try {
      const { createApp } = await import("../src/app.js");
      const app = authenticatedTestApp(createApp(), runtimeCookie);
      const created = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "unpublished gate" }),
      });
      const { id } = (await created.json()) as { id: string };
      const response = await app.request(`/api/sessions/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "搜索 YouTube 露营达人", intent: "creator_discovery", act: "ask" }),
      });
      expect(response.status).toBe(409);
      expect((await response.json()) as Record<string, unknown>).toMatchObject({
        detail: { code: "agent_not_published" },
      });
    } finally {
      setAgentSubmissionOverride();
    }
  });

  it("does not throw when a bound crawl follow-up lands after the task is torn down", async () => {
    const { appendTaskEvent } = await import("../src/routers/tasks.js");
    const workItemId = "tsk_torn_down";
    const runId = "run_torn_down";
    // Same isolation as afterEach: a later test opens a new SQLite file, so a
    // delayed crawl follow-up must not insert against missing parents.
    process.env.LINGONG_DB = path.join(tmp, "torn-down.db");
    resetConn();
    seedAll();
    expect(appendTaskEvent(workItemId, runId, "crawl.start_failed", "远程采集启动失败", "failed", "gone")).toBeNull();
    expect(appendTaskEvent(workItemId, null, "crawl.clarification", "请补充关键词", "needs_clarification")).toBeNull();
  });
});
