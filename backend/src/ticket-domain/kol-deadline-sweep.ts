import { postgresPool } from "../postgres/pool.js";
import { emitKolEventAndDecide } from "./kol-leads.js";

/**
 * KOL 工单 deadline 自动生产者（2026-10-08）。
 * cron handler `kol-deadline-sweep` 调用；PG-only，不碰 legacy SQLite。
 *
 * 规则（与工单模板 trigger_event_types 对齐）：
 * - kol_production_followup：逾期未完成 → kol.production_delayed；3 天内到期 → kol.production_deadline_near
 * - kol_settlement_check：7 天内到期 → kol.settlement_due
 * - 合作项目已 PUBLISHED 且无未完成结算工单 → kol.settlement_due（结算工单由该事件创建，鸡生蛋问题）
 *
 * 去重：幂等键按天作用（kol:deadline:{event}:{ref}:{yyyy-mm-dd}），同一天同一对象只发一次；
 * Jev 侧 partial unique index 保证同模板不会重复建单。
 * 事件归因：verified_by = Task owner（任务负责人对系统检测的事实负责）。
 */
export type DeadlineSweepItem = {
  kind: "work_order" | "cooperation";
  ref_id: string;
  task_id: string;
  event_type: string;
  idempotency_key: string;
  replayed: boolean;
};

const OPEN_WO = "wo.status NOT IN ('completed','cancelled')";
const DAY_MS = 86_400_000;

export const SWEEP_TEMPLATES = ["kol_production_followup", "kol_settlement_check"] as const;

/** 纯函数：按模板与到期时间决定 deadline 事件类型（无 PG，可单测）。 */
export function selectDeadlineEvent(templateCode: string, dueMs: number, nowMs: number): string | null {
  if (Number.isNaN(dueMs)) return null;
  if (templateCode === "kol_production_followup") {
    if (dueMs < nowMs) return "kol.production_delayed";
    if (dueMs < nowMs + 3 * DAY_MS) return "kol.production_deadline_near";
    return null;
  }
  if (templateCode === "kol_settlement_check") {
    return dueMs < nowMs + 7 * DAY_MS ? "kol.settlement_due" : null;
  }
  return null;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function alreadyEmitted(idempotencyKey: string): Promise<boolean> {
  const rows = await postgresPool().query(
    `SELECT 1 FROM work_order_verified_events WHERE idempotency_key=$1`, [idempotencyKey]);
  return Boolean(rows.rows[0]);
}

export async function sweepKolDeadlines(): Promise<{ emitted: DeadlineSweepItem[]; scanned: number }> {
  const today = todayKey();
  const now = Date.now();
  const emitted: DeadlineSweepItem[] = [];
  let scanned = 0;

  const woRows = await postgresPool().query<{
    id: string; task_id: string; template_code: string; title: string; due_at: string; owner_user_id: string;
  }>(
    `SELECT wo.id, wo.task_id, wo.template_code, wo.title, wo.due_at, t.owner_user_id
       FROM work_orders wo JOIN tickets t ON t.id = wo.task_id
      WHERE wo.biz_type = 'kol_cooperation' AND ${OPEN_WO} AND wo.due_at IS NOT NULL
        AND wo.template_code IN ('kol_production_followup','kol_settlement_check')`,
  );
  for (const wo of woRows.rows) {
    scanned++;
    const eventType = selectDeadlineEvent(wo.template_code, new Date(wo.due_at).getTime(), now);
    if (!eventType) continue;
    const idem = `kol:deadline:${eventType}:${wo.id}:${today}`;
    if (await alreadyEmitted(idem)) continue;
    const summary = eventType === "kol.production_delayed"
      ? `系统检测：拍摄跟进工单「${wo.title}」已逾期`
      : eventType === "kol.production_deadline_near"
        ? `系统检测：拍摄跟进工单「${wo.title}」3 天内到期`
        : `系统检测：结算工单「${wo.title}」7 天内到期`;
    await emitKolEventAndDecide(wo.owner_user_id, false, wo.task_id, eventType, summary,
      { work_order_id: wo.id, due_at: wo.due_at, detected_by: "kol-deadline-sweep" },
      { work_order_id: wo.id }, idem);
    emitted.push({ kind: "work_order", ref_id: wo.id, task_id: wo.task_id, event_type: eventType, idempotency_key: idem, replayed: false });
  }

  const coopRows = await postgresPool().query<{
    id: string; project_task_id: string; title: string; owner_user_id: string;
  }>(
    `SELECT c.id, c.project_task_id, c.title, t.owner_user_id
       FROM kol_cooperations c JOIN tickets t ON t.id = c.project_task_id
      WHERE c.coop_stage = 'PUBLISHED' AND c.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM work_orders wo
           WHERE wo.task_id = c.project_task_id AND wo.template_code = 'kol_settlement_check' AND ${OPEN_WO}
        )`,
  );
  for (const coop of coopRows.rows) {
    scanned++;
    const idem = `kol:deadline:kol.settlement_due:coop:${coop.id}:${today}`;
    if (await alreadyEmitted(idem)) continue;
    await emitKolEventAndDecide(coop.owner_user_id, false, coop.project_task_id, "kol.settlement_due",
      `系统检测：合作项目「${coop.title}」已发布且未建结算工单`,
      { coop_id: coop.id, detected_by: "kol-deadline-sweep" },
      { coop_id: coop.id }, idem);
    emitted.push({ kind: "cooperation", ref_id: coop.id, task_id: coop.project_task_id, event_type: "kol.settlement_due", idempotency_key: idem, replayed: false });
  }

  return { emitted, scanned };
}
