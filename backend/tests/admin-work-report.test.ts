import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";
let app: Hono;

type Response = { status: number; body: Json; text: string };

async function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

function insertUser(id: string, name: string, roles: string[]) {
  const now = nowIso();
  getConn().prepare(
    "INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(id, id, name, "unused", JSON.stringify(roles), "[]", "", 1, now, now);
}

function insertTicket(id: string, owner: string, status: string, title = id) {
  const now = nowIso();
  getConn().prepare(
    `INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,due_at,input,entities,data_version,created_at,updated_at,kind,channel,requester_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, owner, "risk_scan", title, "manual", status, "normal", "risk_scan", "general", now, "{}", "{}", 1, now, now, "general", "human", "human");
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-admin-work-report-"));
  process.env.LINGONG_DB = path.join(tmp, "report.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "disabled";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  process.env.AUTH_MODE = "disabled";
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("admin daily work report", () => {
  it("counts accepted tickets from acceptance facts, not successful runs, and retains legacy events as unattributed", async () => {
    insertUser("usr_owner", "负责员工", ["employee"]);
    insertTicket("tkt_accepted", "usr_owner", "completed", "已验收工单");
    insertTicket("tkt_run_only", "usr_owner", "running", "仅运行成功");
    insertTicket("tkt_legacy", "usr_owner", "completed", "旧验收事件");
    const today = nowIso().slice(0, 10);
    const acceptedAt = `${today}T08:00:00.000Z`;
    getConn().prepare(
      `INSERT INTO ticket_acceptances (ticket_id,acceptance_event_id,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run("tkt_accepted", "tev_accepted", acceptedAt, "usr_owner", "usr_acceptor", JSON.stringify({ receipt: "人工核验" }), "ticket-acceptance.v1", acceptedAt);
    getConn().prepare(
      "INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,label,status,safe_summary,time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run("tev_accepted", "tkt_accepted", null, 1, "task.accepted", "任务验收完成", "completed", "", acceptedAt, acceptedAt);
    getConn().prepare(
      "INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,label,status,safe_summary,time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run("tev_legacy", "tkt_legacy", null, 1, "task.accepted", "旧验收", "completed", "", acceptedAt, acceptedAt);
    getConn().prepare(
      "INSERT INTO task_runs (id,work_item_id,status,input,entities,created_at,completed_at) VALUES (?,?,?,?,?,?,?)",
    ).run("run_success", "tkt_run_only", "succeeded", "{}", "{}", acceptedAt, acceptedAt);

    const report = await request("GET", `/api/admin/work-report?date=${today}&timezone=UTC`);
    expect(report.status, report.text).toBe(200);
    expect(report.body.summary).toMatchObject({ accepted: 2, accepted_attributed: 1, accepted_unattributed: 1, processing: 1 });
    const employee = (report.body.employees as Json[]).find((row) => row.user_id === "usr_owner");
    expect(employee).toMatchObject({ accepted: 1, processing: 1 });
    expect(report.body.report_version).toBe("daily-work-report.v1");

    const accepted = await request("GET", `/api/admin/work-report/tickets?view=accepted&date=${today}&timezone=UTC`);
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticket_id: "tkt_accepted", attribution_status: "accepted_owner_snapshot" }),
      expect.objectContaining({ ticket_id: "tkt_legacy", attribution_status: "legacy_unattributed" }),
    ]));
  });

  it("persists evidence and acceptance-time ownership when the command completes a ticket", async () => {
    insertTicket("tkt_command", "sriphy", "waiting", "命令验收工单");
    // The command endpoint operates on formal tickets and an explicit primary assignee.
    getConn().prepare("UPDATE tickets SET task_type='manual_ticket',profile='ticket-workbench' WHERE id=?").run("tkt_command");
    getConn().prepare("INSERT INTO ticket_assignments(ticket_id,assignee_person_ref,assignee_user_id,org_unit_id,role) VALUES (?,?,?,?,?)")
      .run("tkt_command", "person:fixture", "sriphy", "org:fixture", "primary");
    const command = await request("POST", "/api/tickets/tkt_command/commands", {
      action: "complete", expected_version: 1, acceptance_evidence: { receipt: "验收附件#1" },
    }, { "Idempotency-Key": "acceptance-command-0001" });
    expect(command.status, command.text).toBe(200);
    const acceptance = getConn().prepare("SELECT * FROM ticket_acceptances WHERE ticket_id=?").get("tkt_command") as Record<string, unknown>;
    expect(acceptance).toMatchObject({ ticket_id: "tkt_command", owner_user_id_at_acceptance: "sriphy", accepted_by_user_id: "sriphy" });
    expect(JSON.parse(String(acceptance.evidence_json))).toEqual({ receipt: "验收附件#1" });

    const detail = await request("GET", "/api/admin/work-report/tickets/tkt_command");
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.acceptance).toMatchObject({ owner_user_id_at_acceptance: "sriphy", attribution_status: "accepted_owner_snapshot" });
  });

  it("rejects report reads from an authenticated non-admin before aggregating team data", async () => {
    process.env.AUTH_MODE = "enabled";
    insertUser("usr_employee", "普通员工", ["employee"]);
    const { hashPassword } = await import("../src/auth.js");
    getConn().prepare("UPDATE users SET password_hash=? WHERE id=?").run(await hashPassword("employee-pass-1"), "usr_employee");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "usr_employee", password: "employee-pass-1" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    const blocked = await request("GET", "/api/admin/work-report", undefined, { Cookie: String(cookie) });
    expect(blocked.status, blocked.text).toBe(403);
  });

  it("supports week and month windows with previous-period deltas", async () => {
    insertUser("usr_owner", "负责员工", ["employee"]);
    insertTicket("tkt_this_week", "usr_owner", "completed", "本周验收");
    insertTicket("tkt_last_week", "usr_owner", "completed", "上周验收");
    const accept = (id: string, at: string) => getConn().prepare(
      `INSERT INTO ticket_acceptances (ticket_id,acceptance_event_id,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, `tev_${id}`, at, "usr_owner", "usr_owner", JSON.stringify({}), "ticket-acceptance.v1", at);
    accept("tkt_this_week", "2026-10-06T02:00:00.000Z");
    accept("tkt_last_week", "2026-10-03T02:00:00.000Z");

    const week = await request("GET", "/api/admin/work-report?date=2026-10-08&period=week");
    expect(week.status, week.text).toBe(200);
    expect(week.body.period).toMatchObject({ period: "week", start: "2026-10-04T16:00:00.000Z", end: "2026-10-11T16:00:00.000Z" });
    const weekSummary = week.body.summary as { accepted: number; previous_accepted: number };
    expect(weekSummary.accepted).toBe(1);
    expect(weekSummary.previous_accepted).toBe(1);
    const kinds = week.body.accepted_by_kind as Array<{ kind: string; count: number }>;
    expect(kinds.reduce((sum, row) => sum + row.count, 0)).toBe(weekSummary.accepted);

    const month = await request("GET", "/api/admin/work-report?date=2026-10-08&period=month");
    expect(month.status, month.text).toBe(200);
    expect(month.body.period).toMatchObject({ period: "month", start: "2026-09-30T16:00:00.000Z", end: "2026-10-31T16:00:00.000Z" });
    expect(month.body.summary).toMatchObject({ accepted: 2, previous_accepted: 0 });
  });

  it("rejects an unknown period value", async () => {
    const bad = await request("GET", "/api/admin/work-report?period=quarter");
    expect(bad.status, bad.text).toBe(400);
  });

  it("paginates ticket detail views with offset and total", async () => {
    insertUser("usr_owner", "负责员工", ["employee"]);
    for (let index = 1; index <= 5; index += 1) {
      insertTicket(`tkt_w${index}`, "usr_owner", "waiting", `等待工单${index}`);
    }
    const first = await request("GET", "/api/admin/work-report/tickets?view=waiting&limit=2&offset=0");
    expect(first.status, first.text).toBe(200);
    expect(first.body).toMatchObject({ view: "waiting", total: 5, limit: 2, offset: 0 });
    expect((first.body.items as unknown[]).length).toBe(2);
    const second = await request("GET", "/api/admin/work-report/tickets?view=waiting&limit=2&offset=2");
    expect(second.status, second.text).toBe(200);
    expect(second.body).toMatchObject({ total: 5, offset: 2 });
    expect((second.body.items as unknown[]).length).toBe(2);
    const tail = await request("GET", "/api/admin/work-report/tickets?view=waiting&limit=2&offset=4");
    expect(tail.status, tail.text).toBe(200);
    expect((tail.body.items as unknown[]).length).toBe(1);
    const invalid = await request("GET", "/api/admin/work-report/tickets?view=waiting&limit=2&offset=-3");
    expect(invalid.status, invalid.text).toBe(200);
    expect(invalid.body).toMatchObject({ offset: 0 });
  });

  it("paginates the merged accepted view across attributed and legacy rows", async () => {
    insertUser("usr_owner", "负责员工", ["employee"]);
    const today = nowIso().slice(0, 10);
    const accept = (id: string, hour: string) => {
      const at = `${today}T${hour}:00:00.000Z`;
      insertTicket(id, "usr_owner", "completed", id);
      getConn().prepare(
        `INSERT INTO ticket_acceptances (ticket_id,acceptance_event_id,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(id, `tev_${id}`, at, "usr_owner", "usr_owner", JSON.stringify({}), "ticket-acceptance.v1", at);
    };
    accept("tkt_a1", "06");
    accept("tkt_a2", "07");
    accept("tkt_a3", "08");
    const page = await request("GET", `/api/admin/work-report/tickets?view=accepted&date=${today}&timezone=UTC&limit=2&offset=1`);
    expect(page.status, page.text).toBe(200);
    expect(page.body).toMatchObject({ view: "accepted", total: 3, limit: 2, offset: 1 });
    const items = page.body.items as Array<{ ticket_id: string }>;
    expect(items.map((item) => item.ticket_id)).toEqual(["tkt_a2", "tkt_a1"]);
  });
});
