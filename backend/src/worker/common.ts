/**
 * 人工等待：waiting_approval 后 kill box（一任务一箱）。
 * 人确认后是新 turn，不是长驻进程。
 */
import fs from "node:fs";
import path from "node:path";
import { boxDir } from "../config.js";
import { audit, nowIso, tx } from "../db.js";
import type { Json, WorkerResult } from "../types.js";

export const FORBIDDEN_ITEM_TYPES = ["send_mail", "wecom_send", "confirm_stage", "starry_stage", "ingest"];

export function approvalBoxGuardrails(): string[] {
  return [
    "费用档与汇率必须用 Codex 内置网络搜索技能 web_search / $web-search。读 approval-policy.md。",
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

export function killBox(wid: string, reason: string): void {
  const box = path.join(boxDir(), wid);
  fs.rmSync(box, { recursive: true, force: true });
  tx((c) => {
    c.prepare("UPDATE workers SET status = ?, killed_reason = ? WHERE id = ?").run("killed", reason, wid);
  });
  audit("worker", "worker.kill", { worker_id: wid, reason });
}

export function markWaitingApproval(wid: string): void {
  killBox(wid, "waiting_approval");
  tx((c) => {
    c.prepare("UPDATE workers SET status = ? WHERE id = ?").run("waiting_approval", wid);
  });
}

export function workerCannotSend(): never {
  const err = new Error("worker cannot send");
  err.name = "PermissionError";
  throw err;
}

export function persistWorker(result: WorkerResult, sessionId: string): void {
  tx((c) => {
    c.prepare(
      `INSERT INTO workers (id, session_id, skill, profile_id, status, contract_log, items, box_path, killed_reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      result.worker_id,
      sessionId,
      result.skill,
      result.profile_id ?? null,
      result.status,
      JSON.stringify(result.contract_log),
      JSON.stringify(result.items),
      result.box_path ?? null,
      result.killed_reason ?? null,
      nowIso(),
    );
  });
  audit("worker", "worker.start", { worker_id: result.worker_id, skill: result.skill, session_id: sessionId });
}

export function assertItemsSafe(items: Json[]): void {
  for (const i of items) {
    if (FORBIDDEN_ITEM_TYPES.includes(String(i.type))) {
      throw new Error("worker must not emit send/stage/wecom/ingest items");
    }
  }
}
