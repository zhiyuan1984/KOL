import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { kolDashboards } from "../src/routers/kol-dashboards.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
import { withTicketPrincipal } from "../src/ticket-domain/auth.js";

/**
 * KOL 管理端驾驶舱 API 测试。
 * - 无 PG 部分：路由注册、非管理员 403。
 * - PG 部分（TEST_POSTGRES_URL）：聚合口径（漏斗计数、异常队列、阶段分布）。
 */
const admin = { id: "usr-admin-1", username: "admin", name: "Admin", roles: ["admin"], active: true } as never;
const employee = { id: "usr-emp-1", username: "emp", name: "Emp", roles: ["employee"], active: true } as never;
async function get(path: string, principal: never) {
  return (await withTicketPrincipal(principal, async () => {
    const res = await kolDashboards.request(path);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }));
}
describe("kol dashboards router", () => {
  it("registers the two dashboard routes", () => {
    const routes = kolDashboards.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain("GET /kol/admin/lead-funnel");
    expect(routes).toContain("GET /kol/admin/project-delivery");
  });

  it("rejects non-admin with 403", async () => {
    const r1 = await get("/kol/admin/lead-funnel", employee);
    expect(r1.status).toBe(403);
    const r2 = await get("/kol/admin/project-delivery", employee);
    expect(r2.status).toBe(403);
  });
});
const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured)
  process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL!.trim();
const describePostgres = configured ? describe : describe.skip;
describePostgres("kol dashboards aggregations", () => {
  beforeEach(async () => {
    await closePostgresPool();
    await freshTestDatabase();
    const p = postgresPool();
    // 3 条线索：1 在跟进(contacting, 20 天未更新=停留异常)、1 已转化、1 已拒绝
    await p.query(`INSERT INTO kol_leads (id, platform, account_handle, display_name, source, lead_stage, is_archived, created_at, updated_at)
      VALUES
      ('t-dash-l1','youtube','h1','Dash Lead 1','manual','contacting',false, now()-interval '25 days', now()-interval '20 days'),
      ('t-dash-l2','youtube','h2','Dash Lead 2','manual','converted',false, now()-interval '40 days', now()-interval '2 days'),
      ('t-dash-l3','youtube','h3','Dash Lead 3','manual','rejected',false, now()-interval '30 days', now()-interval '5 days')`);
    // 1 个阶段变更事件：pending_contact -> contacting（近 30 天）
    await p.query(`INSERT INTO business_events
      (id,event_type,object_type,object_id,occurred_at,received_at,source,actor_type,payload,idempotency_key,created_at)
      VALUES ('t-dash-e1','lead.stage_changed','creator_candidate','t-dash-l1', now()-interval '20 days', now()-interval '20 days',
      'kol-workbench','human','{"from_stage":"pending_contact","to_stage":"contacting"}','t-dash-e1', now())`);
    // 2 个合作项目：1 在途(SAMPLE_PENDING)、1 异常(PAUSED)
    await p.query(`INSERT INTO kol_cooperations (id, lead_id, title, brand, coop_type, coop_stage, owner_principal_id, created_at, updated_at)
      VALUES
      ('t-dash-c1','t-dash-l2','Dash Coop 1','LT','short_video','SAMPLE_PENDING',NULL, now()-interval '10 days', now()-interval '1 day'),
      ('t-dash-c2','t-dash-l2','Dash Coop 2','LT','live','exception',NULL, now()-interval '12 days', now()-interval '6 days')`);
    await p.query(`UPDATE kol_cooperations SET exception_kind='PAUSED' WHERE id='t-dash-c2'`);
    await p.query(`INSERT INTO kol_cooperations (id,lead_id,title,brand,coop_type,coop_stage,exception_kind,archived_at)
      VALUES ('t-dash-cancelled','t-dash-l2','Cancelled fixture','LT','live','exception','CANCELLED',now())`);
  });
  afterAll(async () => { await closePostgresPool(); });
  it("lead-funnel aggregates counts, stuck and funnel", async () => {
    const { status, body } = await get("/kol/admin/lead-funnel", admin) as {
      status: number;
      body: any;
    };
    expect(status).toBe(200);
    expect(body.kpis.active).toBeGreaterThanOrEqual(1);
    expect(body.kpis.stuck_count).toBeGreaterThanOrEqual(1);
    const contacting = body.funnel.find((f: any) => f.stage === "contacting");
    expect(contacting.count).toBeGreaterThanOrEqual(1);
    // 近 30 天有 pending_contact -> contacting 流转，转化率可算
    const pending = body.funnel.find((f: any) => f.stage === "pending_contact");
    expect(pending.conversion_to_next).toBeGreaterThan(0);
    const stuckNames = body.stuck.map((s: any) => s.display_name);
    expect(stuckNames).toContain("Dash Lead 1");
  });
  it("project-delivery lists real exceptions with kind labels", async () => {
    const { status, body } = await get("/kol/admin/project-delivery", admin) as {
      status: number;
      body: any;
    };
    expect(status).toBe(200);
    const kinds = body.exceptions.map((e: any) => e.exception_kind);
    expect(kinds).toContain("PAUSED");
    const paused = body.exceptions.find((e: any) => e.exception_kind === "PAUSED");
    expect(paused.exception_label).toBeTruthy();
    const sample = body.stage_distribution.find((d: any) => d.stage === "SAMPLE_PENDING");
    expect(sample.count).toBeGreaterThanOrEqual(1);
    expect(body.stage_distribution).toHaveLength(15);
    expect(body.kpis.completed_this_week).toBe(0);
    expect(body.kpis.on_time_rate).toBeGreaterThanOrEqual(0);
  });
});
