import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { workReport } from "../src/routers/work-report.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";
let app: Hono;

type Response = { status: number; body: Json; text: string };

async function request(url: string): Promise<Response> {
  const response = await app.request(url);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

async function insertUser(id: string, name: string): Promise<void> {
  const now = nowIso();
  await getConn().query(
    "INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [id, id, name, "unused", JSON.stringify(["employee"]), "[]", "", 1, now, now],
  );
}

async function insertTicket(id: string, owner: string, status: string, kind: string): Promise<void> {
  const now = nowIso();
  await getConn().query(
    "INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,due_at,input,entities,data_version,created_at,updated_at,kind,channel,requester_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
    [id, owner, "risk_scan", id, "manual", status, "normal", "risk_scan", "general", now, "{}", "{}", 1, now, now, kind, "human", "human"],
  );
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-work-report-native-pg-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "disabled";
  await resetConn();
  app = new Hono();
  app.route("/api", workReport);
});

afterEach(async () => {
  process.env.AUTH_MODE = "disabled";
  await resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("work report native PostgreSQL router", () => {
  it("aligns status, range, owner, kind, and limit parameters for filtered report and ticket reads", async () => {
    await insertUser("usr_match", "Matched Owner");
    await insertUser("usr_other", "Other Owner");
    await insertTicket("tkt_match_waiting", "usr_match", "waiting", "risk");
    await insertTicket("tkt_wrong_kind", "usr_match", "waiting", "general");
    await insertTicket("tkt_wrong_owner", "usr_other", "waiting", "risk");
    await insertTicket("tkt_match_accepted", "usr_match", "completed", "risk");
    const acceptedAt = nowIso();
    await getConn().query(
      "INSERT INTO ticket_acceptances (ticket_id,acceptance_event_id,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      ["tkt_match_accepted", "tev_match_accepted", acceptedAt, "usr_match", "usr_match", "{}", "ticket-acceptance.v1", acceptedAt],
    );

    const date = acceptedAt.slice(0, 10);
    const filters = `date=${date}&timezone=UTC&owner=usr_match&kind=risk`;
    const report = await request(`/api/admin/work-report?${filters}`);
    expect(report.status, report.text).toBe(200);
    expect(report.body.summary).toMatchObject({ accepted: 1, waiting: 1 });
    expect(report.body.employees).toEqual([
      expect.objectContaining({ user_id: "usr_match", accepted: 1, waiting: 1 }),
    ]);

    const waiting = await request(`/api/admin/work-report/tickets?view=waiting&limit=1&offset=0&${filters}`);
    expect(waiting.status, waiting.text).toBe(200);
    expect(waiting.body).toMatchObject({ total: 1, limit: 1, offset: 0 });
    expect(waiting.body.items).toEqual([expect.objectContaining({ ticket_id: "tkt_match_waiting" })]);

    const accepted = await request(`/api/admin/work-report/tickets?view=accepted&limit=1&offset=0&${filters}`);
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.body).toMatchObject({ total: 1, limit: 1, offset: 0 });
    expect(accepted.body.items).toEqual([
      expect.objectContaining({ ticket_id: "tkt_match_accepted", attribution_status: "accepted_owner_snapshot" }),
    ]);

    const detail = await request("/api/admin/work-report/tickets/tkt_match_accepted");
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.acceptance).toMatchObject({
      owner_user_id_at_acceptance: "usr_match",
      attribution_status: "accepted_owner_snapshot",
    });
  });
});
