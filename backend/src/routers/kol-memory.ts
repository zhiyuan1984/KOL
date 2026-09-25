/**
 * KOL memory APIs — PROD-AGENT-01 entry kinds.
 * GET pool / following = memory (no session, no model)
 * POST claim / release = command L3
 * POST kol-analyze/enqueue = command: writes queued work_item only (no session, no model)
 */
import { Hono } from "hono";
import { requireSkill } from "../auth.js";
import { agentSubmissionAllowed } from "../contract-scope.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { ingestDiscoveryBatch } from "../host/discovery-ingest.js";
import {
  applyKolAnalyzeAction,
  claimFollow,
  countKolAnalyzeInFlight,
  currentMemoryEmployee,
  KOL_ANALYZE_MAX_IN_FLIGHT,
  KOL_ANALYZE_MAX_PEOPLE,
  KOL_ANALYZE_TASK_TYPE,
  listEmployeeFollowing,
  listOpenPool,
  parseAnalyzePeople,
  releaseFollow,
} from "../host/kol-memory.js";
import { syncKolProfileIndex } from "../host/kol-memory-sync.js";
import { HttpFail } from "../host/errors.js";
import { currentFollowScope } from "../host/starry-bind.js";
import { nid } from "../ids.js";
import { taskDefinition } from "../tasks/registry.js";
import type { Json } from "../types.js";

export const kolMemory = new Hono();

type PoolSyncReceipt = {
  status: "idle" | "running" | "succeeded" | "failed";
  started_at: string | null;
  completed_at: string | null;
  ok?: boolean;
  count?: number;
  tool?: string;
  message?: string;
};

let poolSyncReceipt: PoolSyncReceipt = {
  status: "idle",
  started_at: null,
  completed_at: null,
};
let poolSyncFlight: Promise<void> | null = null;

function poolSyncResponse() {
  const items = poolSyncReceipt.status === "succeeded" ? listOpenPool() : [];
  return {
    entry: "command" as const,
    kind: "command" as const,
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    ...poolSyncReceipt,
    items,
    kols: items,
  };
}

function startPoolSync(): boolean {
  if (poolSyncFlight) return false;
  const startedAt = nowIso();
  poolSyncReceipt = { status: "running", started_at: startedAt, completed_at: null };
  poolSyncFlight = syncKolProfileIndex()
    .then((result) => {
      poolSyncReceipt = {
        status: result.ok ? "succeeded" : "failed",
        started_at: startedAt,
        completed_at: nowIso(),
        ok: result.ok,
        count: result.count,
        tool: result.tool,
        message: result.ok
          ? `已同步 ${result.count} 个红人档案`
          : (result.error || "红人库同步失败，请稍后重试"),
      };
    })
    .catch((error) => {
      poolSyncReceipt = {
        status: "failed",
        started_at: startedAt,
        completed_at: nowIso(),
        ok: false,
        message: error instanceof Error ? error.message : "红人库同步失败，请稍后重试",
      };
    })
    .finally(() => {
      poolSyncFlight = null;
    });
  return true;
}

kolMemory.post("/home/discovery/ingest", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const result = await ingestDiscoveryBatch(body);
  const status = result.status === "needs_confirmation" ? 422 : 200;
  return c.json(result, status as 200 | 422);
});

kolMemory.get("/home/pool", (c) => {
  c.header("Cache-Control", "no-store");
  const items = listOpenPool();
  return c.json({
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
    index: "公海",
    items,
    kols: items,
  });
});

/**
 * Explicit local-index refresh for the public pool. GET /home/pool remains a
 * zero-write memory read; the command starts the allow-listed Starry reader in
 * the background so an upstream MCP timeout cannot break the employee request.
 */
kolMemory.post("/home/pool/sync", (c) => {
  const started = startPoolSync();
  c.header("Cache-Control", "no-store");
  return c.json({ ...poolSyncResponse(), accepted: true, started }, 202);
});

/** Read-only receipt for the explicit pool-index synchronization command. */
kolMemory.get("/home/pool/sync", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(poolSyncResponse());
});

kolMemory.get("/home/following", (c) => {
  c.header("Cache-Control", "no-store");
  const employee = currentMemoryEmployee();
  const kols = listEmployeeFollowing(employee.id);
  const followScope = currentFollowScope();
  return c.json({
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
    index: "我的跟进",
    employee_id: employee.id,
    follow_scope: followScope,
    kols,
    authority: "kol_follow_index",
  });
});

kolMemory.post("/kols/:kolUid/claim", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const result = claimFollow({
    kolUid: c.req.param("kolUid"),
    scopeBrand: body.scope_brand ? String(body.scope_brand) : undefined,
    confirm: body.confirm === true || body.confirmed === true,
  });
  return c.json({
    entry: "command",
    kind: "command",
    creates_session: false,
    calls_model: false,
    ...result,
  }, result.created ? 201 : 200);
});

kolMemory.post("/follows/:followId/release", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const result = releaseFollow({
    followId: c.req.param("followId"),
    confirm: body.confirm === true || body.confirmed === true,
    reason: body.reason ? String(body.reason) : "manual_release",
  });
  return c.json({
    entry: "command",
    kind: "command",
    creates_session: false,
    calls_model: false,
    ...result,
  });
});

kolMemory.post("/home/kol-analyze/enqueue", async (c) => {
  requireSkill(KOL_ANALYZE_TASK_TYPE);
  if (!agentSubmissionAllowed()) {
    throw new HttpFail(409, {
      code: "agent_not_published",
      message: "KOL Agent 尚未发布，员工端暂不可提交任务",
    });
  }
  const definition = taskDefinition(KOL_ANALYZE_TASK_TYPE);
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: KOL_ANALYZE_TASK_TYPE });
  const body = await c.req.json().catch(() => ({})) as Json;
  const people = parseAnalyzePeople(body);
  if (!people.length) {
    throw new HttpFail(400, { code: "people_required", message: "请指定要分析的红人", max: KOL_ANALYZE_MAX_PEOPLE });
  }
  if (people.length > KOL_ANALYZE_MAX_PEOPLE) {
    throw new HttpFail(400, {
      code: "too_many_people",
      message: `单次最多分析 ${KOL_ANALYZE_MAX_PEOPLE} 人`,
      max: KOL_ANALYZE_MAX_PEOPLE,
    });
  }
  const employee = currentMemoryEmployee();
  const inFlight = countKolAnalyzeInFlight(employee.id);
  if (inFlight >= KOL_ANALYZE_MAX_IN_FLIGHT) {
    throw new HttpFail(409, {
      code: "analyze_cap",
      message: `进行中+排队的分析不得超过 ${KOL_ANALYZE_MAX_IN_FLIGHT} 个`,
      running_plus_queued: inFlight,
      cap: KOL_ANALYZE_MAX_IN_FLIGHT,
    });
  }
  const now = nowIso();
  const id = nid("tsk");
  const title = String(body.title || definition.title).slice(0, 200);
  tx((db) => {
    db.prepare(
      `INSERT INTO work_items
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
        collaboration_id,session_id,due_at,input,entities,data_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, employee.id, KOL_ANALYZE_TASK_TYPE, title, "kol-analyze-enqueue",
      "queued", "normal", definition.id, definition.profile, null,
      null, null, null,
      JSON.stringify({ kol_uids: people, artifact_type: "kol_analyze_brief" }),
      JSON.stringify({ kol_uids: people, task_type: KOL_ANALYZE_TASK_TYPE }),
      1, now, now,
    );
  });
  audit(employee.id, "kol.analyze.enqueue", {
    work_item_id: id,
    task_type: KOL_ANALYZE_TASK_TYPE,
    people: people.length,
    recognizeTaskIntent: false,
  });
  return c.json({
    entry: "command",
    kind: "command",
    creates_session: false,
    calls_model: false,
    task_type: KOL_ANALYZE_TASK_TYPE,
    work_item_id: id,
    people,
    artifact_type: "kol_analyze_brief",
    recognizeTaskIntent: false,
  }, 201);
});

kolMemory.post("/home/kol-analyze/actions", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const workItemId = String(body.work_item_id || body.task_id || body.id || "").trim();
  if (!workItemId) {
    throw new HttpFail(400, { code: "work_item_required", message: "work_item_id required" });
  }
  const result = applyKolAnalyzeAction({
    workItemId,
    verb: body.verb ? String(body.verb) : undefined,
    action: body.action ? String(body.action) : body.verb ? String(body.verb) : undefined,
    artifact: (body.artifact && typeof body.artifact === "object" ? body.artifact : body) as Json,
  });
  return c.json({
    entry: "command",
    kind: "command",
    creates_session: false,
    calls_model: false,
    ...result,
  });
});
