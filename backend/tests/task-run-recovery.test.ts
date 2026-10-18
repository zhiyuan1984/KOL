import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { createAgentBinding, revokeAgentBinding, syncUserOrganization } from "../src/runtime/organization-tree.js";
import { getAgentSkills, setAgentSkill } from "../src/runtime/store.js";
import { failInterruptedTaskRuns } from "../src/host/task-run-recovery.js";
import { markSessionRunning, publicQueue, resetRunControl } from "../src/host/run-control.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
import { seedPublishedAgent } from "./fixtures/runtime-auth.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown, cookie = "") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: text ? (JSON.parse(text) as Json) : {},
    cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

type TaskEventRow = { event_type: string; label: string; status: string; safe_summary: string | null };

async function enableAgentSkill(agentId: string, skillId: string): Promise<void> {
  const current = (await getAgentSkills(agentId)).find((row) => row.skill_id === skillId);
  if (!current) await setAgentSkill(agentId, skillId, true, 0);
  else if (!current.enabled) await setAgentSkill(agentId, skillId, true, Number(current.version));
}

async function createAndQueueTask(cookie = "") {
  const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "扫描风险" }, cookie);
  expect(created.status, created.text).toBe(201);
  const taskId = String(created.body.id);
  const queued = await request("POST", `/api/tasks/${taskId}/run`, { text: "风险扫描" }, cookie);
  expect(queued.status, queued.text).toBe(202);
  return {
    taskId,
    sessionId: String(queued.body.session_id),
    runId: String(queued.body.run_id),
    pending: queued.body.pending_message as Json,
  };
}

async function workItemStatus(taskId: string): Promise<string> {
  return String(((await getConn().query("SELECT status FROM tickets WHERE id=$1", [taskId])).rows[0] as { status: string }).status);
}

async function runRow(runId: string): Promise<{ status: string; error: string | null }> {
  return (await getConn().query("SELECT status,error FROM task_runs WHERE id=$1", [runId])).rows[0] as { status: string; error: string | null };
}

async function taskEvents(taskId: string): Promise<TaskEventRow[]> {
  return (await getConn().query("SELECT event_type,label,status,safe_summary FROM task_events WHERE work_item_id=$1 ORDER BY sequence", [taskId])).rows as TaskEventRow[];
}

function lastEvent(rows: TaskEventRow[]): TaskEventRow | undefined {
  return rows[rows.length - 1];
}

describe("task run lifecycle honesty", () => {
  beforeEach(async () => {
    await freshTestDatabase();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-task-run-"));

    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    await resetConn();
    (await resetRunControl());
    await seedAll();
    const { createApp } = await import("../src/app.js");
    app = (await createApp());
  });

  afterEach(async () => {
    (await resetRunControl());
    await resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps a bound task queued (not running) while it waits behind another run", async () => {
    const { taskId, sessionId, runId, pending } = await createAndQueueTask();
    (await markSessionRunning(sessionId));
    const posted = await request("POST", `/api/sessions/${sessionId}/messages`, pending);
    expect(posted.status, posted.text).toBe(202);
    expect(posted.body.queued).toBe(true);
    expect((await publicQueue(sessionId))).toHaveLength(1);
    expect((await workItemStatus(taskId))).toBe("queued");
    expect((await runRow(runId)).status).toBe("queued");
    const rows = (await taskEvents(taskId));
    expect(rows.map((row) => row.event_type)).toContain("run.queued");
    expect(rows.map((row) => row.event_type)).not.toContain("run.started");
    const queuedEvent = rows.find((row) => row.event_type === "run.queued");
    expect(queuedEvent?.label).toBe("已排队");
    expect(String(queuedEvent?.safe_summary || "")).toContain("轮到时自动开始");
  });

  it("cancels the bound ticket when its queued run is removed", async () => {
    const { taskId, sessionId, runId, pending } = await createAndQueueTask();
    (await markSessionRunning(sessionId));
    await request("POST", `/api/sessions/${sessionId}/messages`, pending);
    const qid = String((await publicQueue(sessionId))[0]?.id || "");
    expect(qid).toBeTruthy();
    const removed = await request("DELETE", `/api/sessions/${sessionId}/queue/${qid}`);
    expect(removed.status, removed.text).toBe(200);
    expect((await workItemStatus(taskId))).toBe("cancelled");
    expect((await runRow(runId)).status).toBe("cancelled");
    const last = lastEvent((await taskEvents(taskId)));
    expect(last?.event_type).toBe("run.cancelled");
    expect(String(last?.safe_summary || "")).toContain("未执行");
  });

  it("fails a bound task when its ask is refused before any execution", async () => {
    // 人员资格锚点是 Agent（ADR-2026-10-03）：只有开启鉴权才能验证「未授权即拒绝」。
    const previousAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "enabled";
    try {
      const setup = await request("POST", "/api/auth/setup", {
        username: "recovery-admin",
        name: "Recovery Admin",
        password: "admin-password",
        brands: ["LT"],
      });
      expect(setup.status, setup.text).toBe(201);
      const employee = await request("POST", "/api/admin/users", {
        username: "recovery-employee",
        name: "Recovery Employee",
        password: "employee-password",
        roles: ["employee"],
        brands: ["LT"],
      }, setup.cookie);
      expect(employee.status, employee.text).toBe(201);
      const outsider = await request("POST", "/api/admin/users", {
        username: "recovery-observer", name: "Recovery Observer",
        password: "observer-password", roles: ["employee"], brands: ["LT"],
      }, setup.cookie);
      expect(outsider.status, outsider.text).toBe(201);
      const login = await request("POST", "/api/auth/login", {
        username: "recovery-employee",
        password: "employee-password",
      });
      expect(login.status, login.text).toBe(200);
      const cookie = login.cookie;
      // 先绑定 Agent，任务才能创建并排队；随后的 ask 才代表「有资格之后被撤权」。
      await seedPublishedAgent("agent:kol");
      await enableAgentSkill("agent:kol", "risk_scan");
      const binding = (await createAgentBinding({
        agent_id: "agent:kol", target_type: "organization_unit", target_id: "org:lt_team",
        company_id: "company:amperetime", source: "test",
      }));
      await syncUserOrganization(String(employee.body.id), "org:lt_team");
      const { taskId, sessionId, runId, pending } = await createAndQueueTask(cookie);
      const outsiderLogin = await request("POST", "/api/auth/login", {
        username: "recovery-observer", password: "observer-password",
      });
      expect(outsiderLogin.status, outsiderLogin.text).toBe(200);
      const beforeForeignAsk = await workItemStatus(taskId);
      const foreignAsk = await request("POST", `/api/sessions/${sessionId}/messages`, pending, outsiderLogin.cookie);
      expect(foreignAsk.status, foreignAsk.text).toBe(404);
      expect(await workItemStatus(taskId)).toBe(beforeForeignAsk);
      expect((await runRow(runId)).status).toBe("pending");
      expect((await taskEvents(taskId)).map((row) => row.event_type)).not.toContain("run.failed");
      // 撤掉 Agent 绑定：ask 必须在任何执行之前被拒绝。
      (await revokeAgentBinding(binding.id));
      const posted = await request("POST", `/api/sessions/${sessionId}/messages`, pending, cookie);
      expect(posted.status, posted.text).toBe(400);
      expect((await workItemStatus(taskId))).toBe("failed");
      expect((await runRow(runId)).status).toBe("failed");
      const rows = (await taskEvents(taskId));
      expect(rows.map((row) => row.event_type)).not.toContain("run.started");
      const last = lastEvent(rows);
      expect(last?.event_type).toBe("run.failed");
      expect(last?.label).toBe("未能开始");
      expect(String(last?.safe_summary || "")).toContain("未授权");
    } finally {
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousAuthMode;
    }
  });

  it("boot reconciliation closes an abandoned running task run", async () => {
    const { taskId, runId } = await createAndQueueTask();
    // Simulate a worker that died with the previous process: the run row was
    // left running with no execution and no terminal event.
    (await getConn().query("UPDATE task_runs SET status='running',started_at=$1 WHERE id=$2", [nowIso(), runId]));
    (await getConn().query("UPDATE tickets SET status='running' WHERE id=$1", [taskId]));
    const touched = (await failInterruptedTaskRuns("Host 重启时该运行仍在执行"));
    expect(touched).toContain(taskId);
    expect((await workItemStatus(taskId))).toBe("failed");
    const run = (await runRow(runId));
    expect(run.status).toBe("failed");
    expect(String(run.error || "")).toContain("interrupted");
    const last = lastEvent((await taskEvents(taskId)));
    expect(last?.event_type).toBe("run.failed");
    expect(last?.label).toBe("执行被中断");
    expect(String(last?.safe_summary || "")).toContain("未产生结果");
    expect((await failInterruptedTaskRuns("Host 重启时该运行仍在执行"))).toEqual([]);
  });
});
