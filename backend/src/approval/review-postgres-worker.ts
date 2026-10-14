import { createHash, randomUUID } from "node:crypto";
import { postgresTransaction } from "../postgres/pool.js";
import { pgCompleteExecutionJob, pgEnqueueExecutionJob } from "../execution-jobs/postgres-store.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import type { ReviewInstance } from "../../../shared/review.js";
import { currentTasks, normalizeTasks, reassignTask } from "./review-operations.js";
import { reviewResolver } from "./review-resolver.js";
import { postgresReviewContext } from "./review-postgres-access.js";
import type { Json, Row } from "../types.js";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, Object.keys(value as object).sort())).digest("hex");
}
function parseInstance(value: unknown): ReviewInstance {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object")
    throw new Error("review instance payload is invalid");
  return normalizeTasks(parsed as ReviewInstance);
}
async function notify(client: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}, tenant: string, instance: ReviewInstance, userId: string, key: string, message: string, now: string) {
  return (await client.query("INSERT INTO review_notifications(id,tenant,instance_id,user_id,message,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [stableHash({ tenant, instance: instance.id, user: userId, key }), tenant, instance.id, userId, message, now]));
}
export async function executePostgresReviewTimeout(job: ClaimedExecutionJob): Promise<{
  instanceId: string;
  receipt: Json;
}> {
  const payload = JSON.parse(String(job.payload_json || "{}")) as Record<string, unknown>;
  const instanceId = String(payload.instanceId || "");
  const taskId = String(payload.taskId || "");
  const dueAt = String(payload.dueAt || "");
  const tenant = String(job.tenant_ref || "");
  const actor = String(job.actor_ref || "");
  if (!instanceId || !taskId || !dueAt || !tenant || !actor)
    throw new Error("review timeout payload is incomplete");
  const receipt = await postgresTransaction(async (client) => {
    const lease = (await client.query("SELECT id FROM execution_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_until>$3 FOR UPDATE", [job.id, job.worker_id, new Date().toISOString()])).rows[0];
    if (!lease)
      throw new Error("超时作业租约已失效");
    const previous = (await client.query<{
      receipt: Json;
    }>("SELECT receipt FROM review_timer_receipts WHERE tenant=$1 AND task_id=$2 AND due_at=$3", [tenant, taskId, dueAt])).rows[0];
    if (previous)
      return previous.receipt;
    const row = (await client.query<Row>("SELECT payload,version,status,requester FROM review_instances WHERE tenant=$1 AND id=$2 FOR UPDATE", [tenant, instanceId])).rows[0];
    if (!row)
      throw new Error("评审实例不存在");
    const instance = parseInstance(row.payload);
    const task = instance.tasks.find((item) => item.id === taskId);
    if (instance.requester !== actor)
      throw new Error("超时作业身份不匹配");
    if (instance.status !== "reviewing" || !task || task.status !== "pending" || task.round !== instance.round || task.dueAt !== dueAt || dueAt > new Date().toISOString()) {
      return { status: "skipped", reason: "任务或期限已变化" };
    }
    const node = instance.definition.nodes.find((item) => item.id === task.nodeId);
    const policy = node?.operations?.timeout;
    if (!node || !policy)
      return { status: "skipped", reason: "没有已发布超时策略" };
    let status: "reminded" | "transferred" | "needs_takeover" = "reminded";
    if (policy.action === "transfer") {
      const context = await postgresReviewContext(client, actor, tenant);
      const used = new Set(currentTasks(instance).map((item) => item.userId));
      const targets = reviewResolver(context)({ ...node, assignee: policy.candidates }, instance.requester).filter((id) => id !== instance.requester && !used.has(id));
      if (targets.length !== 1 || task.assignmentSource === "timeout") {
        status = "needs_takeover";
        instance.blockedReason = "超时升级无法解析唯一合格目标，或已升级一次。请由当前评审人处理或按授权转交。";
      }
      else {
        reassignTask(instance, task, targets[0], "timeout", new Date().toISOString());
        status = "transferred";
      }
    }
    const now = new Date().toISOString();
    await notify(client, tenant, instance, task.userId, `timeout:${task.id}:${dueAt}`, "评审任务已超时，请处理", now);
    if (status === "needs_takeover")
      await notify(client, tenant, instance, instance.requester, `takeover:${task.id}:${dueAt}`, instance.blockedReason!, now);
    for (const item of currentTasks(instance).filter((candidate) => candidate.status === "pending")) {
      await client.query("INSERT INTO review_participants(tenant,instance_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [tenant, instance.id, item.userId]);
      if (item.userId !== task.userId)
        await notify(client, tenant, instance, item.userId, `task:${item.id}`, "有一项评审等待你处理", now);
      if (item.dueAt && item.userId !== task.userId) {
        await pgEnqueueExecutionJob({
          job_type: "review.timeout", tenant_ref: tenant, actor_ref: instance.requester,
          idempotency_key: `review-timeout:${tenant}:${item.id}:${item.dueAt}`,
          object_ref: { instanceId: instance.id }, rule_id: instance.templateId,
          rule_version: String(instance.templateVersion), risk_level: "low", max_attempts: 3,
          next_attempt_at: item.dueAt, payload: { instanceId: instance.id, taskId: item.id, dueAt: item.dueAt },
          scope_snapshot: { tenant, requester: instance.requester },
        }, { client, now: new Date(now) });
      }
    }
    const previousVersion = Number(row.version);
    instance.version = previousVersion + 1;
    instance.updatedAt = now;
    await client.query("UPDATE review_instances SET version=$1,payload=$2,updated_at=$3,status=$4 WHERE tenant=$5 AND id=$6 AND version=$7", [instance.version, JSON.stringify(instance), now, instance.status, tenant, instance.id, previousVersion]);
    await client.query("INSERT INTO review_events(id,tenant,resource_id,actor,action,version,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), tenant, instance.id, actor, `timeout.${status}`, instance.version, JSON.stringify({ taskId, dueAt, policyVersion: instance.templateVersion }), now]);
    const finalReceipt = { status, instanceId: instance.id, version: instance.version };
    await client.query("INSERT INTO review_timer_receipts(tenant,task_id,due_at,receipt) VALUES($1,$2,$3,$4)", [tenant, taskId, dueAt, JSON.stringify(finalReceipt)]);
    return finalReceipt;
  });
  await pgCompleteExecutionJob(String(job.id), receipt, new Date(), job.worker_id);
  return { instanceId, receipt };
}
