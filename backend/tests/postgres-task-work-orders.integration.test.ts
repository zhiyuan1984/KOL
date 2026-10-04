import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { tickets } from "../src/routers/tickets.js";
import { syncWorkbenchTicketPrincipal, withTicketPrincipal } from "../src/ticket-domain/auth.js";
import { createTaskRootPostgres, listTaskWorkOrderAggregates, taskWorkOrderAggregate } from "../src/ticket-domain/task-work-orders.js";
import { recordWorkOrderShadowDecision } from "../src/ticket-domain/work-order-shadow.js";
import { setWorkOrderJevFetch } from "../src/ticket-domain/work-order-jev.js";
import { createWorkOrderTemplateDraft, disableWorkOrderTemplate, listWorkOrderTemplates, publishWorkOrderTemplate } from "../src/ticket-domain/work-order-template-governance.js";
import { setWorkOrderAutomationRelease } from "../src/ticket-domain/work-order-automation-release.js";
import { executeWorkOrderDecision } from "../src/ticket-domain/work-order-executor.js";
import { enqueueWorkOrderDecisionExecution } from "../src/ticket-domain/work-order-automation-pipeline.js";
import { processNextExecutionJob } from "../src/execution-jobs/dispatcher.js";
import { pgExecutionJobById } from "../src/execution-jobs/postgres-store.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

describePostgres("PostgreSQL task to AI work-order model", () => {
  beforeEach(async () => {
    await postgresPool().query(`
      TRUNCATE task_root_command_receipts,work_order_command_receipts,work_order_template_command_receipts,work_order_automation_release_events,work_order_execution_attempts,work_order_outbox,
        work_order_stage_events,work_order_decisions,work_order_basis_refs,work_order_assignments,work_order_automation_releases,work_orders,work_order_templates,workbench_principal_binding_events,
        workbench_principal_bindings,ticket_auth_sessions,ticket_accounts,tickets CASCADE
    `);
  });

  afterAll(async () => { await closePostgresPool(); });

  it("keeps one task root while projecting standard child work orders and their blocking fact", async () => {
    const actor = await syncWorkbenchTicketPrincipal({
      id: "u-task-owner", username: "task_owner", name: "Task Owner", email: "owner@example.test", roles: ["employee"], active: true,
    });
    const task = await createTaskRootPostgres(actor.id, {
      title: "推进 KOL 报价合作", goal: "完成报价确认并推进合作", priority: "important", due_at: "2031-02-01T09:00:00.000Z", idempotency_key: "task-root-create-1",
    });
    const replay = await createTaskRootPostgres(actor.id, {
      title: "ignored", idempotency_key: "task-root-create-1",
    });
    expect(replay.task_id).toBe(task.task_id);
    expect(replay.title).toBe(task.title);

    await postgresPool().query(
      `INSERT INTO work_order_templates
       (id,template_code,version,title,description,status,automation_level,created_by)
       VALUES ('tpl-quote-v1','quote_deadline_followup',1,'报价期限跟进','核验报价与下一步','published','A2',$1)`,
      [actor.id],
    );
    await postgresPool().query(
      `INSERT INTO work_orders
       (id,task_id,template_id,template_code,template_version,status,priority,title,objective,automation_level,created_by,created_at,updated_at)
       VALUES
        ('wo-review',$1,'tpl-quote-v1','quote_deadline_followup',1,'needs_review','important','核验报价期限','检查已验证期限','A1',$2,now(),now()),
        ('wo-done',$1,'tpl-quote-v1','quote_deadline_followup',1,'completed','normal','已完成资料核验','不改变父任务','A1',$2,now(),now())`,
      [task.task_id, actor.id],
    );
    await postgresPool().query(
      `INSERT INTO work_order_assignments
       (id,work_order_id,principal_id,role,status,assigned_by)
       VALUES ('woa-review','wo-review',$1,'primary','active',$1)`,
      [actor.id],
    );
    await postgresPool().query(
      `INSERT INTO work_order_decisions
       (task_id,work_order_id,decision_mode,outcome,status,input_hash,input_json,judgment_json,gate_results_json,actor_ref,idempotency_key,confidence)
       VALUES ($1,'wo-review','shadow','needs_review','recorded','hash-1','{}','{"choice":"needs_review"}','{}',$2,'decision-shadow-1',0.61)`,
      [task.task_id, actor.id],
    );

    const aggregate = await taskWorkOrderAggregate(actor.id, task.task_id);
    expect(aggregate.task).toMatchObject({ task_id: task.task_id, status: "open", title: "推进 KOL 报价合作" });
    expect(aggregate.counts).toEqual({ total: 2, open: 1, blocked: 1, waiting_review: 1, completed: 1 });
    expect(aggregate.current_blocking_work_order).toMatchObject({ work_order_id: "wo-review", status: "needs_review", latest_decision: { decision_mode: "shadow", outcome: "needs_review" } });
    expect(aggregate.work_orders).toHaveLength(2);

    const response = await withTicketPrincipal(actor, () => tickets.fetch(new Request(`http://test.local/task-work-orders/${task.task_id}`)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ task: { task_id: task.task_id }, counts: { total: 2, blocked: 1 }, source: "postgresql_task_work_orders" });

    expect(await listTaskWorkOrderAggregates(actor.id)).toMatchObject({ items: [{ task: { task_id: task.task_id }, counts: { total: 2, blocked: 1 } }] });
    const listResponse = await withTicketPrincipal(actor, () => tickets.fetch(new Request("http://test.local/task-work-orders?limit=20")));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({ items: [{ task: { task_id: task.task_id }, current_blocking_work_order: { work_order_id: "wo-review" } }] });
  });

  it("records a bounded Jev shadow recommendation without creating, assigning, staging, or completing anything", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousEnabled = process.env.JEV_WORK_ORDER_ENABLED;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.JEV_WORK_ORDER_ENABLED = "1";
    const actor = await syncWorkbenchTicketPrincipal({
      id: "u-work-order-admin", username: "work_order_admin", name: "Work Order Admin", email: "admin@example.test", roles: ["admin"], active: true,
    });
    const task = await createTaskRootPostgres(actor.id, {
      title: "推进样品签收", goal: "核验样品并完成下一步安排", idempotency_key: "task-root-shadow-1",
    });
    await postgresPool().query(
      `INSERT INTO work_order_templates
       (id,template_code,version,title,description,status,automation_level,routing_policy_code,stage_policy_json,created_by)
       VALUES ('tpl-sample-v1','sample_receipt_verify',1,'样品签收核验','核验签收事实后建议下一步','published','A2','kol_primary_owner','{"allowed_next_stages":["sample_received"]}',$1)`,
      [actor.id],
    );
    let requestBody: Record<string, unknown> = {};
    setWorkOrderJevFetch(async (_input, init) => {
      requestBody = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      return new Response(JSON.stringify({
        model: "typesafe/jev-1.13",
        answers: {
          template_code: { type: "choice", choice: "sample_receipt_verify", confidence: 0.93, probabilities: { sample_receipt_verify: 0.93, no_action: 0.07 } },
          action: { type: "choice", choice: "create", confidence: 0.91, probabilities: { create: 0.91, needs_review: 0.09 } },
          routing_policy_code: { type: "choice", choice: "kol_primary_owner", confidence: 0.89 },
          stage_action: { type: "choice", choice: "sample_received", confidence: 0.88 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const input = {
        source_event: { id: "evt-sample-1", type: "sample.received_verified", summary: "仓库已核验样品签收", occurred_at: "2031-03-01T09:00:00.000Z" },
        idempotency_key: "work-order-shadow-1",
      };
      const result = await recordWorkOrderShadowDecision(actor.id, task.task_id, input, { isAdmin: true });
      expect(result.decision).toMatchObject({
        decision_mode: "shadow", outcome: "create", status: "recorded", template_code: "sample_receipt_verify", execution_effect: "decision_only", automatic_action: "requires_durable_queue_handoff",
        gates: { execution_mode: "shadow_only", no_assignment_written: true, no_stage_written: true, no_task_completion_written: true },
      });
      expect((requestBody.state as Record<string, unknown>).task).toMatchObject({ id: task.task_id, title: "推进样品签收" });
      expect(requestBody.questions).toHaveProperty("template_code");
      expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_orders")).rows[0]?.count).toBe(0);
      expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_order_assignments")).rows[0]?.count).toBe(0);
      expect((await postgresPool().query("SELECT status FROM tickets WHERE id=$1", [task.task_id])).rows[0]?.status).toBe("open");

      const replay = await recordWorkOrderShadowDecision(actor.id, task.task_id, input, { isAdmin: true });
      expect(replay.decision.replayed).toBe(true);
      expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_order_decisions")).rows[0]?.count).toBe(1);
    } finally {
      setWorkOrderJevFetch();
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      if (previousEnabled === undefined) delete process.env.JEV_WORK_ORDER_ENABLED;
      else process.env.JEV_WORK_ORDER_ENABLED = previousEnabled;
    }
  });

  it("publishes only governed A2 templates, retires the prior published version, and records idempotent commands", async () => {
    const actor = await syncWorkbenchTicketPrincipal({
      id: "u-template-admin", username: "template_admin", name: "Template Admin", email: "template@example.test", roles: ["admin"], active: true,
    });
    const base = {
      template_code: "quote_deadline_followup", title: "报价期限跟进", description: "基于已核验报价期限创建跟进工单", automation_level: "A2",
      trigger_event_types: ["deadline.quote"], acceptance_criteria: ["报价期限已核验", "下一步商务动作已记录"],
      routing_policy_code: "quote_owner", input_schema: { event_id: { required: true } }, fill_policy: { due_at: "event.deadline" },
    };
    const draft = await createWorkOrderTemplateDraft(actor.id, { ...base, idempotency_key: "template-draft-1" });
    expect(draft.template).toMatchObject({ status: "draft", version: 1, automation_level: "A2" });
    expect((await createWorkOrderTemplateDraft(actor.id, { ...base, idempotency_key: "template-draft-1" })).replayed).toBe(true);
    const published = await publishWorkOrderTemplate(actor.id, draft.template.id, { expected_version: 1, idempotency_key: "template-publish-1" });
    expect(published.template).toMatchObject({ status: "published", template_code: "quote_deadline_followup" });

    const v2 = await createWorkOrderTemplateDraft(actor.id, { ...base, title: "报价期限跟进 v2", idempotency_key: "template-draft-2" });
    expect(v2.template.version).toBe(2);
    await publishWorkOrderTemplate(actor.id, v2.template.id, { expected_version: 2, idempotency_key: "template-publish-2" });
    const rows = await listWorkOrderTemplates();
    expect(rows.templates.filter((item) => item.template_code === "quote_deadline_followup").map((item) => [item.version, item.status])).toEqual([[2, "published"], [1, "retired"]]);

    const disabled = await disableWorkOrderTemplate(actor.id, v2.template.id, { reason: "暂停报价活动", idempotency_key: "template-disable-2" });
    expect(disabled.template).toMatchObject({ status: "disabled", disable_reason: "暂停报价活动" });
    expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_order_template_command_receipts")).rows[0]?.count).toBe(5);
  });

  it("materializes an A2 work order only after an explicit release and deterministic task-owner route", async () => {
    const actor = await syncWorkbenchTicketPrincipal({
      id: "u-execution-admin", username: "execution_admin", name: "Execution Admin", email: "execution@example.test", roles: ["admin"], active: true,
    });
    const task = await createTaskRootPostgres(actor.id, { title: "跟进报价期限", goal: "在报价截止前推进商务动作", due_at: "2031-04-01T10:00:00.000Z", idempotency_key: "task-executor-1" });
    const draft = await createWorkOrderTemplateDraft(actor.id, {
      template_code: "quote_due_execute", title: "报价期限跟进", description: "核验报价与下一步", automation_level: "A2", trigger_event_types: ["deadline.quote"],
      acceptance_criteria: ["报价期限已核验"], routing_policy_code: "task_owner", idempotency_key: "executor-template-draft-1",
    });
    await publishWorkOrderTemplate(actor.id, draft.template.id, { expected_version: 1, idempotency_key: "executor-template-publish-1" });
    const decision = await postgresPool().query<{ id: string }>(
      `INSERT INTO work_order_decisions
       (task_id,source_event_id,template_code,template_version,routing_policy_code,decision_mode,outcome,status,input_hash,input_json,judgment_json,gate_results_json,actor_ref,idempotency_key,confidence)
       VALUES ($1,'evt-quote-1','quote_due_execute',1,'task_owner','shadow','create','recorded','decision-hash-1',$2,'{}','{}',$3,'executor-decision-1',0.95)
       RETURNING id`,
      [task.task_id, JSON.stringify({ source_event: { id: "evt-quote-1", type: "deadline.quote", summary: "已核验报价期限", occurred_at: "2031-03-29T10:00:00.000Z" } }), actor.id],
    );
    const decisionId = decision.rows[0]!.id;
    const disabled = await executeWorkOrderDecision(actor.id, decisionId, { idempotency_key: "executor-before-release" });
    expect(disabled.attempt).toMatchObject({ status: "skipped", reason_code: "automation_release_disabled" });
    expect(disabled.work_order).toBeNull();

    const release = await setWorkOrderAutomationRelease(actor.id, draft.template.id, { action: "enabled", minimum_confidence: 0.92, routing_policy_code: "task_owner", reason: "通过低风险报价期限自动化验证", idempotency_key: "executor-release-enable" });
    expect(release.release).toMatchObject({ status: "enabled", automation_level: "A2", routing_policy_code: "task_owner" });
    const executed = await executeWorkOrderDecision(actor.id, decisionId, { idempotency_key: "executor-after-release" });
    expect(executed.attempt).toMatchObject({ status: "created", execution_mode: "automatic", receipt: { assignment_created: true, outbox_event: "work_order.materialized" } });
    expect(executed.work_order).toMatchObject({ status: "assigned", data_version: 1 });
    expect((await executeWorkOrderDecision(actor.id, decisionId, { idempotency_key: "executor-after-release" })).replayed).toBe(true);
    expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_orders")).rows[0]?.count).toBe(1);
    expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_order_assignments WHERE role='primary' AND status='active'")).rows[0]?.count).toBe(1);
    expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_order_outbox WHERE event_type='work_order.materialized'")).rows[0]?.count).toBe(1);
    expect((await postgresPool().query("SELECT status FROM tickets WHERE id=$1", [task.task_id])).rows[0]?.status).toBe("open");
  });

  it("hands a released Jev decision to the PostgreSQL Outbox worker without completing its parent task", async () => {
    const actor = await syncWorkbenchTicketPrincipal({
      id: "u-pipeline-admin", username: "pipeline_admin", name: "Pipeline Admin", email: "pipeline@example.test", roles: ["admin"], active: true,
    });
    const task = await createTaskRootPostgres(actor.id, { title: "推进报价自动工单", goal: "基于核验期限生成标准跟进动作", idempotency_key: "task-pipeline-1" });
    const draft = await createWorkOrderTemplateDraft(actor.id, {
      template_code: "pipeline_quote_followup", title: "报价期限跟进", description: "核验报价与下一步", automation_level: "A2",
      trigger_event_types: ["deadline.quote"], acceptance_criteria: ["报价期限已核验"], routing_policy_code: "task_owner", idempotency_key: "pipeline-template-draft-1",
    });
    await publishWorkOrderTemplate(actor.id, draft.template.id, { expected_version: 1, idempotency_key: "pipeline-template-publish-1" });
    await setWorkOrderAutomationRelease(actor.id, draft.template.id, { action: "enabled", minimum_confidence: 0.9, routing_policy_code: "task_owner", reason: "低风险事件自动化验证", idempotency_key: "pipeline-release-1" });
    const decision = await postgresPool().query<{ id: string }>(
      `INSERT INTO work_order_decisions
       (task_id,source_event_id,template_code,template_version,routing_policy_code,decision_mode,outcome,status,input_hash,input_json,judgment_json,gate_results_json,actor_ref,idempotency_key,confidence)
       VALUES ($1,'evt-pipeline-1','pipeline_quote_followup',1,'task_owner','shadow','create','recorded','pipeline-hash',$2,'{}','{}',$3,'pipeline-decision-1',0.95)
       RETURNING id`,
      [task.task_id, JSON.stringify({ source_event: { id: "evt-pipeline-1", type: "deadline.quote", summary: "已核验报价期限", occurred_at: "2031-04-01T10:00:00.000Z" } }), actor.id],
    );
    const queued = await enqueueWorkOrderDecisionExecution(actor.id, decision.rows[0]!.id);
    expect(queued).toMatchObject({ created: true, execution_job: { job_type: "work_order.materialize", status: "queued" } });
    expect((await enqueueWorkOrderDecisionExecution(actor.id, decision.rows[0]!.id)).created).toBe(false);

    const dispatched = await processNextExecutionJob("pipeline-worker");
    expect(dispatched).toMatchObject({ job_type: "work_order.materialize", outcome: "processed" });
    const job = await pgExecutionJobById(String((queued.execution_job as Record<string, unknown>).id));
    expect(job).toMatchObject({ status: "succeeded" });
    expect((await postgresPool().query("SELECT COUNT(*)::int AS count FROM work_orders")).rows[0]?.count).toBe(1);
    expect((await postgresPool().query("SELECT status FROM tickets WHERE id=$1", [task.task_id])).rows[0]?.status).toBe("open");
  });
});
