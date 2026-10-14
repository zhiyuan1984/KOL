/**
 * 人工等待：waiting_approval 后 kill box（一任务一箱）。
 * 人确认后是新 turn，不是长驻进程。
 */
import fs from "node:fs";
import path from "node:path";
import { boxDir } from "../config.js";
import { audit, nowIso, pgTransaction } from "../postgres/access.js";
import type { Json, WorkerResult } from "../types.js";
export const FORBIDDEN_ITEM_TYPES = ["send_mail", "wecom_send", "confirm_stage", "starry_stage", "ingest"];
export function approvalBoxGuardrails(): string[] {
  return [
    "优先匹配 CONTEXT.approval_templates 中当前公司已发布流程，输出 review_draft；只能写草稿，不得提交或批准。",
    "费用制度仅采用公司现行有效制度，公开搜索不能替代公司制度。需要汇率时用 Codex 内置网络搜索技能。读 approval-policy.md。",
    "禁止用训练记忆或 Host TypeScript 常数表。改档改汇率只改技能说明。",
    "create_approval 必须带本轮搜索出处：fx、policy（source_url 或原文摘录）、amount_cny、chain。",
    "链上人名必须来自本轮组织绑定。禁止裸 HTTP 爬虫。",
  ];
}

export function sandboxPolicyForSkill(skill: string, cwd: string): Json {
  return {
    type: "workspaceWrite",
    writableRoots: [cwd],
    networkAccess: skill === "business_approval",
  };
}
export async function killBox(wid: string, reason: string): Promise<void> {
  const box = path.join(boxDir(), wid);
  fs.rmSync(box, { recursive: true, force: true });
  (await pgTransaction(async (c) => {
    (await c.execute("UPDATE workers SET status = $1, killed_reason = $2 WHERE id = $3", "killed", reason, wid));
  }));
  (await audit("worker", "worker.kill", { worker_id: wid, reason }));
}
export async function markWaitingApproval(wid: string): Promise<void> {
  (await killBox(wid, "waiting_approval"));
  (await pgTransaction(async (c) => {
    (await c.execute("UPDATE workers SET status = $1 WHERE id = $2", "waiting_approval", wid));
  }));
}
export function workerCannotSend(): never {
  const err = new Error("worker cannot send");
  err.name = "PermissionError";
  throw err;
}
export async function persistWorker(result: WorkerResult, sessionId: string): Promise<void> {
  (await pgTransaction(async (c) => {
    (await c.execute(`INSERT INTO workers (id, session_id, skill, profile_id, status, contract_log, items, box_path, killed_reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, result.worker_id, sessionId, result.skill, result.profile_id ?? null, result.status, JSON.stringify(result.contract_log), JSON.stringify(result.items), result.box_path ?? null, result.killed_reason ?? null, nowIso()));
  }));
  (await audit("worker", "worker.start", { worker_id: result.worker_id, skill: result.skill, session_id: sessionId }));
}
export function assertItemsSafe(items: Json[]): void {
  for (const i of items) {
    if (FORBIDDEN_ITEM_TYPES.includes(String(i.type))) {
      throw new Error("worker must not emit send/stage/wecom/ingest items");
    }
  }
}
