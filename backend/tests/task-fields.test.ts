import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { displayStatusOf, normalizePriority, todayDateStr } from "../src/host/home-board.js";
import { loadTodayTaskResults, writeTodayTaskResults } from "../src/host/today-tasks.js";
import { parseTaskFieldUpdatesFallback } from "../src/tasks/task-field-updates.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

function localDatePlus(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-task-fields-"));
  process.env.LINGONG_DB = path.join(tmp, "tasks.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("task base fields", () => {
  it("normalizes legacy priority codes to canonical ones", () => {
    expect(normalizePriority("high")).toBe("important");
    expect(normalizePriority("medium")).toBe("normal");
    expect(normalizePriority("important_urgent")).toBe("important_urgent");
    expect(normalizePriority("urgent")).toBe("urgent");
    expect(normalizePriority("low")).toBe("low");
    expect(normalizePriority("bogus")).toBeNull();
    expect(normalizePriority(null)).toBeNull();
  });

  it("derives display_status without persisting it", () => {
    expect(displayStatusOf({ status: "completed" })).toEqual({ display_status: "completed", display_status_label: "完成" });
    expect(displayStatusOf({ status: "done" }).display_status).toBe("completed");
    expect(displayStatusOf({ status: "cancelled" }).display_status).toBe("cancelled");
    expect(displayStatusOf({ status: "failed" })).toEqual({ display_status: "failed", display_status_label: "失败" });
    expect(displayStatusOf({ status: "pending", due_at: `${localDatePlus(-1)}T00:00:00` }))
      .toEqual({ display_status: "overdue", display_status_label: "延期" });
    expect(displayStatusOf({ status: "pending", due_at: todayDateStr() }).display_status).toBe("due_soon");
    expect(displayStatusOf({ status: "pending", due_at: localDatePlus(2) }).display_status).toBe("due_soon");
    expect(displayStatusOf({ status: "pending", due_at: localDatePlus(5) }).display_status).toBe("not_started");
    expect(displayStatusOf({ status: "running", due_at: localDatePlus(5) }).display_status).toBe("in_progress");
    expect(displayStatusOf({ status: "pending", started_at: "2026-09-01T00:00:00Z", due_at: localDatePlus(5) }))
      .toEqual({ display_status: "in_progress", display_status_label: "进行中" });
    expect(displayStatusOf({ status: "pending", due_at: localDatePlus(5) }))
      .toEqual({ display_status: "not_started", display_status_label: "未开始" });
  });

  it("creates tasks with today defaults and canonical priority", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "字段默认值" });
    expect(created.status).toBe(201);
    expect(created.body.priority).toBe("normal");
    expect(created.body.risk_level).toBe("none");
    expect(created.body.content).toBe("");
    expect(created.body.start_date).toBe(todayDateStr());
    expect(created.body.due_at).toBe(todayDateStr());
    expect(created.body.display_status).toBe("due_soon");
    expect(created.body.display_status_label).toBe("临期");
  });

  it("normalizes legacy priority on write and matches legacy priority filters", async () => {
    const created = await request("POST", "/api/tasks", {
      task_type: "risk_scan",
      title: "旧码优先级",
      priority: "high",
    });
    expect(created.status).toBe(201);
    expect(created.body.priority).toBe("important");
    const medium = await request("POST", "/api/tasks", {
      task_type: "risk_scan",
      title: "中优先级",
      priority: "medium",
    });
    expect(medium.body.priority).toBe("normal");
    const urgent = await request("POST", "/api/tasks", {
      task_type: "risk_scan",
      title: "新码紧急",
      priority: "urgent",
    });
    expect(urgent.body.priority).toBe("urgent");
    const invalid = await request("POST", "/api/tasks", {
      task_type: "risk_scan",
      title: "非法优先级",
      priority: "p0",
    });
    expect(invalid.status).toBe(400);
    const filtered = await request("GET", "/api/tasks?priority=high");
    const ids = (filtered.body as unknown as Json[]).map((task) => String(task.id));
    expect(ids).toContain(String(created.body.id));
    expect(ids).not.toContain(String(urgent.body.id));
  });

  it("sorts priority_desc by severity with 重要紧急 first", async () => {
    const low = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "低", priority: "low" });
    const top = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "重要紧急", priority: "important_urgent" });
    const mid = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "紧急", priority: "urgent" });
    const listed = await request("GET", "/api/tasks?sort=priority_desc");
    const ids = (listed.body as unknown as Json[]).map((task) => String(task.id));
    expect(ids.indexOf(String(top.body.id))).toBeLessThan(ids.indexOf(String(mid.body.id)));
    expect(ids.indexOf(String(mid.body.id))).toBeLessThan(ids.indexOf(String(low.body.id)));
  });
});

describe("PATCH /api/tasks/:id", () => {
  it("updates structured fields with version bump, event and audit", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "待编辑" });
    const id = String(created.body.id);
    const patched = await request("PATCH", `/api/tasks/${id}`, {
      title: "改后的标题",
      content: "补充的任务内容",
      status: "in_progress",
      priority: "important_urgent",
      risk_level: "high",
      start_date: localDatePlus(-1),
      due_at: localDatePlus(10),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe("改后的标题");
    expect(patched.body.content).toBe("补充的任务内容");
    expect(patched.body.status).toBe("in_progress");
    expect(patched.body.priority).toBe("important_urgent");
    expect(patched.body.risk_level).toBe("high");
    expect(patched.body.start_date).toBe(localDatePlus(-1));
    expect(patched.body.due_at).toBe(localDatePlus(10));
    expect(patched.body.data_version).toBe(2);
    expect(patched.body.display_status).toBe("in_progress");
    const events = await request("GET", `/api/tasks/${id}/events`);
    const updated = (events.body as unknown as Json[]).find((event) => event.event_type === "task.updated");
    expect(String(updated?.safe_summary || "")).toContain("标题");
    expect(String(updated?.safe_summary || "")).toContain("风险等级");
    const auditRows = getConn().prepare("SELECT * FROM audit_events WHERE event_type='task.updated'").all() as Json[];
    expect(auditRows.length).toBe(1);
    expect(JSON.parse(String(auditRows[0].payload))).toMatchObject({
      work_item_id: id,
      fields: ["title", "content", "status", "priority", "risk_level", "start_date", "due_at"],
    });
  });

  it("clears dates with null and rejects invalid enums", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "清除日期" });
    const id = String(created.body.id);
    expect(created.body.due_at).toBe(todayDateStr());
    const cleared = await request("PATCH", `/api/tasks/${id}`, { due_at: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.due_at).toBeNull();
    expect(cleared.body.display_status).toBe("not_started");
    expect((await request("PATCH", `/api/tasks/${id}`, { status: "bogus" })).status).toBe(400);
    expect((await request("PATCH", `/api/tasks/${id}`, { risk_level: "extreme" })).status).toBe(400);
    expect((await request("PATCH", `/api/tasks/${id}`, { priority: "p9" })).status).toBe(400);
    expect((await request("PATCH", `/api/tasks/${id}`, { start_date: "下周" })).status).toBe(400);
    expect((await request("PATCH", `/api/tasks/${id}`, {})).status).toBe(400);
  });

  it("returns 404 for unknown or foreign tasks", async () => {
    expect((await request("PATCH", "/api/tasks/tsk_missing", { title: "x" })).status).toBe(404);
    const now = new Date().toISOString();
    getConn().prepare(
      `INSERT INTO work_items
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("tsk_foreign", "usr_other", "risk_scan", "别人的任务", "manual", "pending", "normal",
      "risk_scan", "lead", "{}", "{}", 1, now, now);
    expect((await request("PATCH", "/api/tasks/tsk_foreign", { title: "x" })).status).toBe(404);
    expect((await request("POST", "/api/tasks/tsk_foreign/edit", { text: "已完成" })).status).toBe(404);
  });
});

describe("POST /api/tasks/:id/edit", () => {
  it("applies deterministic fallback extraction in stub mode", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "自然语言编辑" });
    const id = String(created.body.id);
    const edited = await request("POST", `/api/tasks/${id}/edit`, {
      text: "把优先级改成重要紧急，风险改为高，延期到后天",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.source).toBe("fallback");
    expect(edited.body.applied_fields).toEqual(expect.arrayContaining(["priority", "risk_level", "due_at"]));
    const task = edited.body.task as Json;
    expect(task.priority).toBe("important_urgent");
    expect(task.risk_level).toBe("high");
    expect(task.due_at).toBe(localDatePlus(2));
    expect(task.data_version).toBe(2);
    const events = await request("GET", `/api/tasks/${id}/events`);
    const updated = (events.body as unknown as Json[]).find((event) => event.event_type === "task.updated");
    expect(String(updated?.safe_summary || "")).toContain("重要紧急");
  });

  it("parses status and start date phrases", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "状态编辑" });
    const id = String(created.body.id);
    const edited = await request("POST", `/api/tasks/${id}/edit`, {
      text: "这个任务已经完成了",
    });
    expect(edited.body.task).toMatchObject({ status: "completed", display_status: "completed" });
    const started = await request("POST", `/api/tasks/${id}/edit`, {
      text: "重新开始，开始于明天",
    });
    expect(started.status).toBe(200);
    expect((started.body.task as Json).start_date).toBe(localDatePlus(1));
  });

  it("returns 422 without writing when nothing is recognized", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "无法识别" });
    const id = String(created.body.id);
    const before = getConn().prepare("SELECT data_version FROM work_items WHERE id=?").get(id) as { data_version: number };
    const edited = await request("POST", `/api/tasks/${id}/edit`, { text: "今天天气真不错" });
    expect(edited.status).toBe(422);
    expect(edited.body.code).toBe("edit_not_recognized");
    expect(edited.body.message).toBe("没有识别出要修改的字段");
    const after = getConn().prepare("SELECT data_version FROM work_items WHERE id=?").get(id) as { data_version: number };
    expect(after.data_version).toBe(before.data_version);
    const events = getConn().prepare("SELECT COUNT(*) AS c FROM task_events WHERE work_item_id=? AND event_type='task.updated'")
      .get(id) as { c: number };
    expect(events.c).toBe(0);
  });
});

describe("fallback field parser", () => {
  it("extracts priority, risk, dates and title from Chinese text", () => {
    expect(parseTaskFieldUpdatesFallback("把优先级改成重要")).toMatchObject({ priority: "important" });
    expect(parseTaskFieldUpdatesFallback("设为紧急")).toMatchObject({ priority: "urgent" });
    expect(parseTaskFieldUpdatesFallback("优先级改成低")).toMatchObject({ priority: "low" });
    expect(parseTaskFieldUpdatesFallback("风险调到中")).toMatchObject({ risk_level: "medium" });
    expect(parseTaskFieldUpdatesFallback("无风险")).toMatchObject({ risk_level: "none" });
    expect(parseTaskFieldUpdatesFallback("截止到2026-10-01")).toMatchObject({ due_at: "2026-10-01" });
    expect(parseTaskFieldUpdatesFallback("延期到9月20日")).toMatchObject({ due_at: `${new Date().getFullYear()}-09-20` });
    expect(parseTaskFieldUpdatesFallback("开始于明天")).toMatchObject({ start_date: localDatePlus(1) });
    expect(parseTaskFieldUpdatesFallback("标题改为「重试户外采集」")).toMatchObject({ title: "重试户外采集" });
    expect(parseTaskFieldUpdatesFallback("随便聊聊")).toEqual({});
  });
});

describe("today task display rows", () => {
  it("passes icon and group through write and load", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "展示行" });
    const id = String(created.body.id);
    const written = writeTodayTaskResults({
      owner: "usr_sriphy",
      workItemId: id,
      runId: null,
      results: {
        items: [{ work_item_id: id, rank: 1, title: "展示行", verb: "edit", label: "处理", icon: "📋", group: "重要" }],
      },
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    getConn().prepare(
      "INSERT INTO employee_today_briefs (owner_user_id, artifact_id, work_item_id, result_artifact_id, updated_at) VALUES (?,?,?,?,?)",
    ).run("usr_sriphy", written.artifact_id, id, written.artifact_id, new Date().toISOString());
    const loaded = loadTodayTaskResults("usr_sriphy");
    expect(loaded?.items[0]).toMatchObject({ work_item_id: id, icon: "📋", group: "重要" });
    const listed = await request("GET", "/api/home/today-tasks");
    expect(listed.status).toBe(200);
    const items = listed.body.items as Json[];
    expect(items[0]).toMatchObject({ work_item_id: id, icon: "📋", group: "重要" });
  });
});
