import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { withTicketPrincipal, type TicketPrincipal } from "../src/ticket-domain/auth.js";
import { tickets } from "../src/routers/tickets.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

const ADMIN: TicketPrincipal = {
  id: "rule-admin", username: "rule_admin", name: "规则管理员", email: null, roles: ["employee", "admin"], active: true,
};
const EMPLOYEE: TicketPrincipal = {
  id: "rule-employee", username: "rule_employee", name: "普通员工", email: null, roles: ["employee"], active: true,
};
const RULE_ID = "sgr-native-governance-test";

function post(path: string, body: Record<string, unknown>, key: string): Request {
  return new Request(`http://test.local${path}`, {
    method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
  });
}

describePostgres("native PostgreSQL scheduling rule governance", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query("DELETE FROM scheduling_rule_command_receipts WHERE rule_id=$1", [RULE_ID]);
    await pool.query("DELETE FROM scheduling_rule_audit_events WHERE rule_id=$1", [RULE_ID]);
    await pool.query("DELETE FROM scheduling_rule_simulations WHERE rule_id=$1", [RULE_ID]);
    await pool.query("DELETE FROM scheduling_rules WHERE id=$1", [RULE_ID]);
    await pool.query("DELETE FROM ticket_org_scopes WHERE ticket_id='rule-simulation-ticket'");
    await pool.query("DELETE FROM tickets WHERE id='rule-simulation-ticket'");
    await pool.query(
      `INSERT INTO ticket_accounts (id,username,name,password_hash,roles,active,created_at,updated_at)
       VALUES ('rule-admin','rule_admin','规则管理员','x','["employee","admin"]'::jsonb,true,now(),now()),
              ('rule-employee','rule_employee','普通员工','x','["employee"]'::jsonb,true,now(),now())
       ON CONFLICT (id) DO UPDATE SET roles=EXCLUDED.roles,active=true,updated_at=now()`,
    );
    await pool.query(
      `INSERT INTO tickets
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,due_at,input,entities,data_version,created_at,updated_at,kind,channel,requester_type)
       VALUES ('rule-simulation-ticket','rule-employee','manual_ticket','需要人工确认的规则候选','manual','pending','important','', 'ticket-workbench',
               '2030-01-01T00:00:00.000Z','{}'::jsonb,'{}'::jsonb,1,now()::text,now()::text,'general','human','human')`,
    );
    await pool.query(
      `INSERT INTO ticket_org_scopes (ticket_id,company_id,assignee_unit_id,org_version,created_at,updated_at)
       VALUES ('rule-simulation-ticket','company:amperetime','org:rules',1,now(),now())`,
    );
  });

  afterAll(async () => { await closePostgresPool(); });

  it("requires an audited simulation before publishing and never mutates the matched ticket", async () => {
    const denied = await withTicketPrincipal(EMPLOYEE, () => tickets.fetch(post("/admin/scheduling/rules/drafts", {
      id: RULE_ID, rule_type: "ticket_assignment", title: "人工分派建议", scope: { company_id: "company:amperetime" },
      definition: { execution_mode: "manual_confirmation", requires_human_confirmation: true, proposed_action: "assignment_suggestion" }, reason: "测试",
    }, "rule-governance-denied-0001")));
    expect(denied.status).toBe(403);

    const created = await withTicketPrincipal(ADMIN, () => tickets.fetch(post("/admin/scheduling/rules/drafts", {
      id: RULE_ID, rule_type: "ticket_assignment", title: "重要任务人工分派建议", scope: { company_id: "company:amperetime" },
      definition: {
        execution_mode: "manual_confirmation", requires_human_confirmation: true, proposed_action: "assignment_suggestion",
        trigger_event_types: ["deadline.quote"], conditions: { ticket_statuses: ["pending"], priorities: ["important"] },
      }, reason: "先创建草稿并进行安全模拟",
    }, "rule-governance-create-0001")));
    expect(created.status).toBe(201);
    const draft = await created.json() as { rule: { id: string; version: number; status: string } };
    expect(draft.rule).toMatchObject({ id: RULE_ID, version: 1, status: "draft" });

    const publishWithoutSimulation = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rules/${RULE_ID}/versions/1/publish`, {
      expected_version: 1, simulation_id: "missing", reason: "不应发布",
    }, "rule-governance-publish-missing-0001")));
    expect(publishWithoutSimulation.status).toBe(409);

    const simulated = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rules/${RULE_ID}/versions/1/simulate`, {
      sample_limit: 10, reason: "验证正式工单命中范围",
    }, "rule-governance-simulate-0001")));
    expect(simulated.status).toBe(201);
    const simulation = await simulated.json() as { simulation_id: string; execution_effect: string; human_confirmation_required: boolean; tickets: Array<{ ticket_id: string }> };
    expect(simulation).toMatchObject({ execution_effect: "none", human_confirmation_required: true });
    expect(simulation.tickets).toEqual(expect.arrayContaining([expect.objectContaining({ ticket_id: "rule-simulation-ticket" })]));

    const published = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rules/${RULE_ID}/versions/1/publish`, {
      expected_version: 1, simulation_id: simulation.simulation_id, reason: "模拟已审阅，仅发布人工确认建议",
    }, "rule-governance-publish-0001")));
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ rule: { status: "published", version: 1 }, execution_effect: "none", manual_confirmation_only: true });

    const evaluated = await withTicketPrincipal(ADMIN, () => tickets.fetch(post("/admin/scheduling/events/evaluate", {
      source_system: "integration_test", source_event_id: "quote-deadline-rule-eval-0001", source_version: "v1",
      event_type: "deadline.quote", company_id: "company:amperetime", ticket_id: "rule-simulation-ticket",
      occurred_at: "2031-01-01T00:00:00.000Z", summary: "报价已到人工复核期限", evidence_ref: "test://quote/deadline/0001",
      evidence: { source: "integration_test", verified: true }, payload: { deadline_kind: "quote" },
    }, "rule-event-evaluate-0001")));
    expect(evaluated.status).toBe(201);
    const evaluatedPayload = await evaluated.json() as { evaluations: Array<{ id: string }> };
    expect(evaluatedPayload).toMatchObject({
      replayed: false, execution_effect: "none", human_confirmation_required: true,
      evaluations: [expect.objectContaining({ rule_id: RULE_ID, outcome: "matched", ticket_id: "rule-simulation-ticket" })],
    });
    const evaluationId = evaluatedPayload.evaluations[0]?.id;
    expect(evaluationId).toBeTruthy();
    const eventReplay = await withTicketPrincipal(ADMIN, () => tickets.fetch(post("/admin/scheduling/events/evaluate", {
      source_system: "integration_test", source_event_id: "quote-deadline-rule-eval-0001", source_version: "v1",
      event_type: "deadline.quote", company_id: "company:amperetime", ticket_id: "rule-simulation-ticket",
      occurred_at: "2031-01-01T00:00:00.000Z", summary: "报价已到人工复核期限", evidence_ref: "test://quote/deadline/0001",
      evidence: { source: "integration_test", verified: true }, payload: { deadline_kind: "quote" },
    }, "rule-event-evaluate-0001")));
    expect(eventReplay.status).toBe(200);
    expect(await eventReplay.json()).toMatchObject({ replayed: true, execution_effect: "none" });
    const evaluations = await withTicketPrincipal(ADMIN, () => tickets.fetch(new Request("http://test.local/admin/scheduling/rule-evaluations")));
    expect(evaluations.status).toBe(200);
    expect(await evaluations.json()).toMatchObject({ items: [expect.objectContaining({ rule_id: RULE_ID, outcome: "matched", event: expect.objectContaining({ event_type: "deadline.quote" }) })] });
    const effectiveness = await withTicketPrincipal(ADMIN, () => tickets.fetch(new Request("http://test.local/admin/scheduling/rule-effectiveness")));
    expect(effectiveness.status).toBe(200);
    expect(await effectiveness.json()).toMatchObject({
      report_version: "scheduling-rule-effectiveness-raw.v1",
      source: "postgresql_ticket_rule_evaluations",
      rules: [expect.objectContaining({
        rule_id: RULE_ID, evaluations: 1, distinct_events: 1, linked_tickets: 1,
        by_outcome: { matched: 1, skipped: 0, missing_fields: 0, failed: 0 },
        manual_confirmation: { matched_pending: 1, confirmed: 0, dismissed: 0, confirmations_recorded: 0, coverage_status: "not_recorded" },
        execution_effect: "none",
      })],
    });
    const employeeTicket = await withTicketPrincipal(EMPLOYEE, () => tickets.fetch(new Request("http://test.local/tickets/rule-simulation-ticket")));
    expect(employeeTicket.status).toBe(200);
    expect(await employeeTicket.json()).toMatchObject({
      business_events: [expect.objectContaining({ event_type: "deadline.quote", evidence_ref: "test://quote/deadline/0001" })],
    });
    const employeeTimeline = await withTicketPrincipal(EMPLOYEE, () => tickets.fetch(new Request("http://test.local/tickets/rule-simulation-ticket/timeline")));
    expect(employeeTimeline.status).toBe(200);
    expect(await employeeTimeline.json()).toMatchObject({
      related_business_events: [expect.objectContaining({ event_type: "deadline.quote" })],
    });
    const confirmed = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rule-evaluations/${evaluationId}/confirmation`, {
      decision: "confirmed", reason: "管理员已审阅证据并同意后续由人工处理",
    }, "rule-evaluation-confirm-0001")));
    expect(confirmed.status).toBe(201);
    expect(await confirmed.json()).toMatchObject({
      replayed: false, confirmation: { evaluation_id: evaluationId, decision: "confirmed", execution_effect: "none", automatic_action: "disabled" },
    });
    const confirmationReplay = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rule-evaluations/${evaluationId}/confirmation`, {
      decision: "confirmed", reason: "管理员已审阅证据并同意后续由人工处理",
    }, "rule-evaluation-confirm-0001")));
    expect(confirmationReplay.status).toBe(200);
    expect(await confirmationReplay.json()).toMatchObject({ replayed: true, confirmation: { decision: "confirmed", execution_effect: "none" } });
    const decidedEffectiveness = await withTicketPrincipal(ADMIN, () => tickets.fetch(new Request("http://test.local/admin/scheduling/rule-effectiveness")));
    expect(decidedEffectiveness.status).toBe(200);
    expect(await decidedEffectiveness.json()).toMatchObject({
      rules: [expect.objectContaining({
        rule_id: RULE_ID,
        manual_confirmation: { matched_pending: 0, confirmed: 1, dismissed: 0, confirmations_recorded: 1, coverage_status: "recorded" },
        execution_effect: "none",
      })],
    });

    const replay = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rules/${RULE_ID}/versions/1/simulate`, {
      sample_limit: 10, reason: "验证正式工单命中范围",
    }, "rule-governance-simulate-0001")));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });

    const facts = await postgresPool().query<{ status: string; assignments: string; events: string; audits: string; simulations: string; evaluations: string }>(
      `SELECT
        (SELECT status FROM scheduling_rules WHERE id=$1 AND version=1) AS status,
        (SELECT COUNT(*)::text FROM ticket_assignments WHERE ticket_id='rule-simulation-ticket') AS assignments,
        (SELECT COUNT(*)::text FROM task_events WHERE work_item_id='rule-simulation-ticket') AS events,
        (SELECT COUNT(*)::text FROM scheduling_rule_audit_events WHERE rule_id=$1) AS audits,
        (SELECT COUNT(*)::text FROM scheduling_rule_simulations WHERE rule_id=$1) AS simulations,
        (SELECT COUNT(*)::text FROM ticket_rule_evaluations WHERE rule_id=$1) AS evaluations`,
      [RULE_ID],
    );
    expect(facts.rows[0]).toEqual({ status: "published", assignments: "0", events: "0", audits: "3", simulations: "1", evaluations: "1" });

    const detail = await withTicketPrincipal(ADMIN, () => tickets.fetch(new Request(`http://test.local/admin/scheduling/rules/${RULE_ID}`)));
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ rule: { id: RULE_ID, status: "published" }, simulations: [expect.objectContaining({ id: simulation.simulation_id })] });

    const restored = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rules/${RULE_ID}/versions/1/restore-draft`, {
      reason: "恢复已审阅的历史版本，重新验证后再发布",
    }, "rule-governance-restore-0001")));
    expect(restored.status).toBe(201);
    expect(await restored.json()).toMatchObject({ rule: { id: RULE_ID, version: 2, status: "draft" }, restored_from_version: 1, execution_effect: "none" });
    const restoredPublish = await withTicketPrincipal(ADMIN, () => tickets.fetch(post(`/admin/scheduling/rules/${RULE_ID}/versions/2/publish`, {
      expected_version: 2, simulation_id: simulation.simulation_id, reason: "不能复用旧版本模拟",
    }, "rule-governance-restore-publish-0001")));
    expect(restoredPublish.status).toBe(409);
  });
});
