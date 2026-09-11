import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-async-"));
  fs.chmodSync(fake, 0o755);
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.CODEX_BIN = fake;
  process.env.FAKE_CODEX_MODE = "crawl-plan-success";
  process.env.FAKE_CODEX_DELAY = "150";
  process.env.HOST_WORKER_TIMEOUT = "1";
  process.env.HOME = tmp;
  process.env.CODEX_HOME = path.join(tmp, ".codex");
  fs.mkdirSync(process.env.CODEX_HOME);
  resetConn();
  seedAll();
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
  await new Promise((r) => setTimeout(r, 50));
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CODEX_BIN;
  delete process.env.FAKE_CODEX_MODE;
  delete process.env.FAKE_CODEX_DELAY;
  delete process.env.HOST_WORKER_TIMEOUT;
});

describe("real Codex HTTP flow", () => {
  it("acknowledges creator discovery immediately and publishes the background outcome", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
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
      body: JSON.stringify({ text: "搜索抖音露营达人", intent: "creator_discovery", act: "ask" }),
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
    for (let i = 0; i < 30; i += 1) {
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
    ).toEqual([]);
  });

  it("streams reasoning/process and persists a generic right-side task result", async () => {
    process.env.FAKE_CODEX_MODE = "crawl-plan-success";
    process.env.FAKE_CODEX_DELAY = "120";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "discovery review" }),
    });
    const { id } = (await created.json()) as { id: string };
    const response = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索抖音露营达人", intent: "creator_discovery", act: "ask" }),
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

  it("produces a strict crawl plan without mounting remote MCP in the planning turn", async () => {
    process.env.FAKE_CODEX_MODE = "crawl-plan-success";
    process.env.FAKE_CODEX_DELAY = "50";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/tasks/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "搜索抖音露营达人" }),
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { task: { id: string } };
    const queued = await app.request(`/api/tasks/${task.task.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const run = (await queued.json()) as { session_id: string; pending_message: Record<string, unknown> };
    const started = await app.request(`/api/sessions/${run.session_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(run.pending_message),
    });
    expect(started.status).toBe(202);
    let session: { agent_status?: string; messages?: { kind?: string; payload?: Record<string, unknown> }[] } = {};
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      session = (await (await app.request(`/api/sessions/${run.session_id}`)).json()) as typeof session;
      if (session.agent_status !== "running") break;
    }
    const plan = session.messages?.find((message) => message.kind === "crawl_plan");
    expect(plan?.payload?.crawl_plan).toMatchObject({
      platform: "dy",
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
    expect(worker?.contract_log?.find((entry) => entry.method === "mcp_servers")?.params?.names).toEqual([]);
  });
});
