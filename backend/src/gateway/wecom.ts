/**
 * Gateway：企微模板卡 + 费用审批链。
 * 审批人只来自 Host 规则引擎传入的 chain；本文件不点名。
 */
import { audit, getConn, nowIso, tx } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { currentUser } from "../host/persona.js";
import { defaultOrgSnapshot } from "../approval/snapshot.js";
import type { WorkApprovalKind } from "../stages.js";
import type { Json, Row } from "../types.js";

export const APPROVAL_KIND_LABEL: Record<WorkApprovalKind, string> = {
  expense: "费用审批",
  stage: "阶段审批",
  content: "内容审核",
  settlement: "结算审批",
  skill_publish: "技能发布",
  ontology_change: "本体变更",
};

function parseJson(value: unknown, fallback: Json = {}): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

function withoutRecordIds(text: string): string {
  return String(text || "")
    .replace(/\s*(approval_id|chain_id)=\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyPhrase(payload: Json): string {
  const currency = String(payload.currency || "CNY");
  const amount = Number(payload.amount);
  const base = Number(payload.amount_base);
  const n = (value: number) => value.toLocaleString("zh-CN");
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (currency === "CNY") return `人民币 ${n(amount)}`;
  if (Number.isFinite(base) && base > 0) return `${currency} ${n(amount)}（折合人民币 ${n(base)}）`;
  return `${currency} ${n(amount)}`;
}

function rejectClause(actor: string, reason?: string): string {
  const why = String(reason || "").trim();
  return why ? `${actor} 已驳回：${why}` : `${actor} 已驳回`;
}

function expenseNotice(
  payload: Json,
  phase: "ask" | "advance" | "reject" | "done",
  actor: string,
  previous?: string,
  reason?: string,
): string {
  const requester = String(payload.requester_name || "申请人");
  const money = moneyPhrase(payload);
  const subject = money ? `${requester} 申请的 ${money} 费用审批` : `${requester} 的费用审批`;
  if (phase === "ask") return `请 ${actor} 确认：${subject}。`;
  if (phase === "advance") return `${previous} 已同意。请 ${actor} 确认：${subject}。`;
  if (phase === "reject") return `${rejectClause(actor, reason)}，${subject}已作废。`;
  return `${actor} 已同意，${subject}已办结。`;
}

function stageNotice(
  payload: Json,
  phase: "ask" | "advance" | "reject" | "done",
  actor: string,
  previous?: string,
  reason?: string,
): string {
  const current = String(payload.stage_label || payload.current_stage || "当前阶段");
  const target = String(payload.target_label || payload.stage_code || "目标阶段");
  const subject = `确认阶段：从 ${current} 进入 ${target}`;
  if (phase === "ask") return `请 ${actor} ${subject}。`;
  if (phase === "advance") return `${previous} 已同意。请 ${actor} ${subject}。`;
  if (phase === "reject") return `${rejectClause(actor, reason)}，${subject}已作废。`;
  return `${actor} 已同意，${subject}已办结。`;
}

function approvalNotice(
  kind: WorkApprovalKind,
  payload: Json,
  phase: "ask" | "advance" | "reject" | "done",
  actor: string,
  previous?: string,
  reason?: string,
): string {
  if (kind === "expense") return expenseNotice(payload, phase, actor, previous, reason);
  return stageNotice(payload, phase, actor, previous, reason);
}

function actorOf(id: string, payload: Json = {}): { id: string; name: string; role: string } {
  const steps = Array.isArray(payload.steps) ? payload.steps as Json[] : [];
  const hit = steps.find((step) => String(step.employee_id || "") === id);
  return {
    id,
    name: String(hit?.name || id),
    role: String(hit?.role || id),
  };
}

export async function getApproval(aid: string): Promise<Awaited<Row | null>> {
  const row = (await getConn().query("SELECT * FROM approvals WHERE id = $1",[aid])).rows[0] as Row | undefined;
  if (!row) return null;
  const d: Row = { ...row };
  d.kind = String(d.kind || "expense");
  d.kind_label = APPROVAL_KIND_LABEL[d.kind as WorkApprovalKind] || d.kind;
  d.chain = JSON.parse(String(d.chain));
  d.chain_id = d.chain_id || d.id;
  d.payload = parseJson(d.payload);
  d.chain_detail = (d.chain as string[]).map((x) => actorOf(x, d.payload as Json));
  const card = (await getConn().query("SELECT * FROM wecom_cards WHERE id = $1",[d.wecom_card_id])).rows[0] as Row | undefined;
  d.wecom_card = card ? { ...card } : null;
  if (d.wecom_card && (d.wecom_card as Row).payload) {
    (d.wecom_card as Row).payload = parseJson((d.wecom_card as Row).payload);
  }
  if (d.wecom_card) {
    (d.wecom_card as Row).body = withoutRecordIds(String((d.wecom_card as Row).body || ""));
  }
  d.version = Number(d.version || 0);
  d.updated_at = d.updated_at || d.created_at;
  return d;
}

export async function createWorkApproval(input: {
  kind: WorkApprovalKind;
  brand?: string;
  amountUsd?: number;
  draftId?: string;
  fingerprint?: string;
  payload?: Json;
  title?: string;
  chain?: string[];
}): Promise<Awaited<Row>> {
  const kind = input.kind;
  const brand = String(input.brand || "LT");
  const amount = Number(input.amountUsd || 0);
  const payload = { ...(input.payload || {}) };
  const chain = input.chain && input.chain.length ? input.chain : [];
  if (!chain.length) return {};
  const aid = nid("appr");
  const chainId = aid;
  const first = actorOf(chain[0], payload);
  const cardId = aid;
  const title = input.title || `${APPROVAL_KIND_LABEL[kind]} · ${payload.requester_name || brand}`;
  const fingerprint = input.fingerprint || JSON.stringify(payload);
  let submittedBy = "";
  try {
    submittedBy = (await currentUser()).handle;
  } catch {
    submittedBy = "host";
  }
  const cardPayload = {
    approval_id: aid,
    chain_id: chainId,
    kind,
    brand,
    amount_usd: amount,
    chain,
    assignee: first,
    draft_id: input.draftId || "",
    copy: "确认审批",
  };
  const now = nowIso();
  (await tx(async (c) => {
    (await c.query("INSERT INTO approvals\n       (id, draft_id, brand, amount_usd, status, chain, current_index, uses_left,\n        fingerprint, need_manual_band, wecom_card_id, created_at, chain_id,\n        kind, payload, title, submitted_by, version, updated_at)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",[aid,input.draftId || "",brand,amount,"pending",JSON.stringify(chain),0,1,fingerprint,0,cardId,now,chainId,kind,JSON.stringify(payload),title,submittedBy,0,now]));
    (await c.query("INSERT INTO wecom_cards (id, approval_id, title, body, status, assignee, payload, ts)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[cardId,aid,title,approvalNotice(kind, payload, "ask", first.name),"waiting",first.name,JSON.stringify(cardPayload),now]));
    if (input.draftId) {
      (await c.query("UPDATE drafts SET approval_id = $1 WHERE id = $2",[aid,input.draftId]));
    }
  }));
  (await audit("gateway", "wecom.card", { approval_id: aid, assignee: first.name, kind, amount }));
  return (await getApproval(aid)) as Row;
}

export async function listApprovals(): Promise<Awaited<Row[]>> {
  const ids = (await getConn().query("SELECT id FROM approvals ORDER BY created_at DESC",[])).rows as { id: string }[];
  return (await Promise.all(ids.map(async (r) => (await getApproval(r.id))))).filter((x): x is Row => Boolean(x));
}

export async function createReceipt(key: string): Promise<Awaited<Row | null>> {
  const row = (await getConn().query("SELECT result_json FROM approval_idempotency WHERE action = 'create' AND approval_id = '*' AND idempotency_key = $1",[key])).rows[0] as { result_json: string } | undefined;
  if (!row?.result_json) return null;
  try {
    const parsed = JSON.parse(row.result_json) as { id?: string };
    return parsed.id ? (await getApproval(String(parsed.id))) : null;
  } catch {
    return null;
  }
}

export async function saveCreateReceipt(key: string, approval: Row) {
  (await getConn().query("INSERT INTO approval_idempotency\n     (id, action, approval_id, idempotency_key, result_json, created_at)\n     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[nid("aidem"),"create","*",key,JSON.stringify({ id: approval.id }),nowIso()]));
}

export async function listWecomCards(): Promise<Awaited<Row[]>> {
  return ((await getConn().query("SELECT * FROM wecom_cards ORDER BY ts DESC",[])).rows as Row[]).map((r) => ({
    ...r,
    body: withoutRecordIds(String(r.body || "")),
    payload: r.payload ? parseJson(r.payload) : {},
  }));
}

export type DecideGate = {
  expected_version: number;
  idempotency_key: string;
};

export async function decideReceipt(aid: string, key: string): Promise<Awaited<Json | null>> {
  const row = (await getConn().query("SELECT result_json FROM approval_idempotency WHERE action = 'decide' AND approval_id = $1 AND idempotency_key = $2",[aid,key])).rows[0] as { result_json: string } | undefined;
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as Json;
  } catch {
    return null;
  }
}

async function insertDecideReceipt(aid: string, key: string, result: Json, at: string) {
  (await getConn().query("INSERT INTO approval_idempotency\n     (id, action, approval_id, idempotency_key, result_json, created_at)\n     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[nid("aidem"),"decide",aid,key,JSON.stringify(result),at]));
}

function staleFail(): never {
  throw new HttpFail(409, { code: "stale", message: "内容已变化，请重新确认。" });
}

export async function decide(
  aid: string,
  decision: string,
  actorRole?: string | null,
  reason?: string | null,
  gate?: DecideGate,
): Promise<Json> {
  if (gate?.idempotency_key) {
    const replay = (await decideReceipt(aid, gate.idempotency_key));
    if (replay) return { ...replay, replayed: true };
  }
  const ap = (await getApproval(aid));
  if (!ap) throw new KeyError(aid);
  if (ap.status !== "pending") throw new Error(`approval status ${ap.status}`);
  if (gate && Number(ap.version || 0) !== gate.expected_version) staleFail();
  const kind = String(ap.kind || "expense") as WorkApprovalKind;
  const chain = ap.chain as string[];
  const idx = Number(ap.current_index);
  const expected = chain[idx];
  if (actorRole && actorRole !== expected) {
    throw new Error(`current level is ${expected}`);
  }
  const now = nowIso();
  const nextVersion = Number(ap.version || 0) + 1;
  const remember = async (result: Json) => {
    if (gate?.idempotency_key) (await insertDecideReceipt(aid, gate.idempotency_key, result, now));
    return result;
  };
  if (decision === "reject") {
    const rejectReason = String(reason || "").trim();
    if (!rejectReason) {
      throw new Error("reject_reason_required");
    }
    const actorName = actorOf(expected, ap.payload as Json).name;
    const nextPayload = {
      ...(ap.payload as Json),
      reject_reason: rejectReason,
      rejected_by: actorName,
    };
    (await tx(async (c) => {
      const updated = (await c.query("UPDATE approvals SET status = 'rejected', payload = $1, version = $2, updated_at = $3 WHERE id = $4 AND status = 'pending' AND version = $5",[JSON.stringify(nextPayload),nextVersion,now,aid,Number(ap.version || 0)]));
      if (!updated.changes) staleFail();
      (await c.query("UPDATE wecom_cards SET status = 'rejected', body = $1 WHERE approval_id = $2",[approvalNotice(kind, nextPayload, "reject", actorName, undefined, rejectReason),aid]));
      if (ap.draft_id) (await c.query("UPDATE drafts SET status = 'discarded' WHERE id = $1",[ap.draft_id]));
    }));
    (await audit("gateway", "approval.reject", { approval_id: aid, kind, reason: rejectReason, version: nextVersion }));
    return remember({ ...(await getApproval(aid)), sent: false, discarded: true, stage_changed: false, reject_reason: rejectReason });
  }
  if (decision !== "approve") throw new Error("decision must be approve or reject");

  if (idx < chain.length - 1) {
    const nxt = chain[idx + 1];
    const person = actorOf(nxt, ap.payload as Json);
    const expectedActor = actorOf(expected, ap.payload as Json);
    (await tx(async (c) => {
      const updated = (await c.query("UPDATE approvals SET current_index = $1, version = $2, updated_at = $3 WHERE id = $4 AND status = 'pending' AND version = $5",[idx + 1,nextVersion,now,aid,Number(ap.version || 0)]));
      if (!updated.changes) staleFail();
      (await c.query("UPDATE wecom_cards SET status = 'forwarded', body = $1 WHERE approval_id = $2",[approvalNotice(kind, ap.payload as Json, "advance", person.name, expectedActor.name),aid]));
      (await c.query("UPDATE wecom_cards SET assignee = $1, payload = $2, ts = $3 WHERE approval_id = $4",[person.name,JSON.stringify({ approval_id: aid, assignee: person, level: nxt, kind, amount_usd: ap.amount_usd }),now,aid]));
    }));
    (await audit("gateway", "approval.advance", { approval_id: aid, next: nxt, kind, version: nextVersion }));
    return remember({ ...(await getApproval(aid)), sent: false, advanced: true, stage_changed: false });
  }

  const { fulfillExpenseApproval } = await import("../host/approval-fulfill.js");
  const fulfilled = await fulfillExpenseApproval(ap);
  (await tx(async (c) => {
    const updated = (await c.query("UPDATE approvals SET status = 'consumed', uses_left = 0, version = $1, updated_at = $2 WHERE id = $3 AND status = 'pending' AND version = $4",[nextVersion,now,aid,Number(ap.version || 0)]));
    if (!updated.changes) staleFail();
    (await c.query("UPDATE wecom_cards SET status = 'sent', body = $1 WHERE approval_id = $2",[approvalNotice(kind, ap.payload as Json, "done", actorOf(expected, ap.payload as Json).name),aid]));
  }));
  (await audit("gateway", "approval.final_fulfill", { approval_id: aid, kind, version: nextVersion }));
  return remember({ ...(await getApproval(aid)), ...fulfilled });
}

/**
 * 转交：当前审批人将本节点转给他人。仅 pending 且调用者为当前节点审批人时允许。
 * 转交后 chain[current_index] 替换为目标，版本 +1，留痕。
 */
export async function transferApproval(
  aid: string,
  targetEmployeeId: string,
  actorRole?: string,
  reason?: string,
  gate?: { expected_version?: number; idempotency_key?: string },
): Promise<Awaited<Row>> {
  const ap = (await getApproval(aid));
  if (!ap) throw new KeyError(aid);
  if (String(ap.status) !== "pending") throw new Error(`approval status ${ap.status}`);
  if (gate && Number(ap.version || 0) !== gate.expected_version) staleFail();
  const chain = [...(ap.chain as string[])];
  const idx = Number(ap.current_index);
  const expected = chain[idx];
  if (actorRole && actorRole !== expected) throw new Error(`current level is ${expected}`);
  const target = String(targetEmployeeId || "").trim();
  if (!target) throw new Error("transfer_target_required");
  if (target === expected) throw new Error("transfer_target_same");
  const now = nowIso();
  const nextVersion = Number(ap.version || 0) + 1;
  const fromName = actorOf(expected, ap.payload as Json).name;
  const orgEmp = defaultOrgSnapshot().employees.find((e) => e.id === target);
  const toName = orgEmp?.name || actorOf(target, ap.payload as Json).name;
  const toRole = orgEmp?.position || target;
  chain[idx] = target;
  const payloadSteps = Array.isArray((ap.payload as Json).steps)
    ? (ap.payload as { steps: Array<Record<string, unknown>> }).steps.map((s, i) =>
        i === idx ? { ...s, employee_id: target, name: toName, role: toRole } : s
      )
    : (ap.payload as Json).steps;
  const nextPayload = {
    ...(ap.payload as Json),
    steps: payloadSteps,
    transfers: [...((ap.payload as { transfers?: unknown[] }).transfers || []), {
      from: expected, from_name: fromName, to: target, to_name: toName,
      reason: String(reason || "").trim() || undefined, at: now,
    }],
  };
  (await tx(async (c) => {
    const updated = (await c.query("UPDATE approvals SET chain = $1, payload = $2, version = $3, updated_at = $4 WHERE id = $5 AND status = 'pending' AND version = $6",[JSON.stringify(chain),JSON.stringify(nextPayload),nextVersion,now,aid,Number(ap.version || 0)]));
    if (!updated.changes) staleFail();
  }));
  (await audit("gateway", "approval.transfer", { approval_id: aid, from: expected, to: target, version: nextVersion }));
  return (await getApproval(aid)) as Row;
}

/**
 * 加签：在当前节点后插入一个加签审批人。被加签人默认仅查看（不继承原审批人权限）。
 * 方案 §3.4：加签需模板开启（此处默认允许），被加签人可再转交。
 */
export async function countersignApproval(
  aid: string,
  targetEmployeeId: string,
  actorRole?: string,
  reason?: string,
  gate?: { expected_version?: number; idempotency_key?: string },
): Promise<Awaited<Row>> {
  const ap = (await getApproval(aid));
  if (!ap) throw new KeyError(aid);
  if (String(ap.status) !== "pending") throw new Error(`approval status ${ap.status}`);
  if (gate && Number(ap.version || 0) !== gate.expected_version) staleFail();
  const chain = [...(ap.chain as string[])];
  const idx = Number(ap.current_index);
  const expected = chain[idx];
  if (actorRole && actorRole !== expected) throw new Error(`current level is ${expected}`);
  const target = String(targetEmployeeId || "").trim();
  if (!target) throw new Error("countersign_target_required");
  if (chain.includes(target)) throw new Error("countersign_target_exists");
  const now = nowIso();
  const nextVersion = Number(ap.version || 0) + 1;
  const orgEmp = defaultOrgSnapshot().employees.find((e) => e.id === target);
  if (!orgEmp) throw new Error("countersign_target_unknown");
  const toName = orgEmp.name;
  // 在当前节点后插入加签节点
  chain.splice(idx + 1, 0, target);
  const payloadSteps = Array.isArray((ap.payload as Json).steps)
    ? (ap.payload as { steps: Array<Record<string, unknown>> }).steps
    : [];
  const newStep = {
    sequence: idx + 2,
    employee_id: target,
    name: toName,
    role: `${orgEmp.position}（加签）`,
    source: "countersign",
  };
  const nextSteps = [
    ...payloadSteps.slice(0, idx + 1),
    newStep,
    ...payloadSteps.slice(idx + 1).map((s) => ({ ...s, sequence: Number(s.sequence || 0) + 1 })),
  ];
  const nextPayload = {
    ...(ap.payload as Json),
    steps: nextSteps,
    countersigns: [...((ap.payload as { countersigns?: unknown[] }).countersigns || []), {
      by: expected, by_name: actorOf(expected, ap.payload as Json).name,
      target, target_name: toName,
      reason: String(reason || "").trim() || undefined, at: now,
    }],
  };
  (await tx(async (c) => {
    const updated = (await c.query("UPDATE approvals SET chain = $1, payload = $2, version = $3, updated_at = $4 WHERE id = $5 AND status = 'pending' AND version = $6",[JSON.stringify(chain),JSON.stringify(nextPayload),nextVersion,now,aid,Number(ap.version || 0)]));
    if (!updated.changes) staleFail();
  }));
  (await audit("gateway", "approval.countersign", { approval_id: aid, by: expected, target, version: nextVersion }));
  return (await getApproval(aid)) as Row;
}

/**
 * 撤回：发起人在终审前撤回。仅 pending 且调用者为发起人时允许。
 */
export async function withdrawApproval(
  aid: string,
  actorHandle?: string,
  gate?: { expected_version?: number; idempotency_key?: string },
): Promise<Awaited<Row>> {
  const ap = (await getApproval(aid));
  if (!ap) throw new KeyError(aid);
  if (String(ap.status) !== "pending") throw new Error(`approval status ${ap.status}`);
  if (gate && Number(ap.version || 0) !== gate.expected_version) staleFail();
  const now = nowIso();
  const nextVersion = Number(ap.version || 0) + 1;
  const nextPayload = {
    ...(ap.payload as Json),
    withdrawn_by: actorHandle || undefined,
    withdrawn_at: now,
  };
  (await tx(async (c) => {
    const updated = (await c.query("UPDATE approvals SET status = 'withdrawn', payload = $1, version = $2, updated_at = $3 WHERE id = $4 AND status = 'pending' AND version = $5",[JSON.stringify(nextPayload),nextVersion,now,aid,Number(ap.version || 0)]));
    if (!updated.changes) staleFail();
    (await c.query("UPDATE wecom_cards SET status = 'withdrawn' WHERE approval_id = $1",[aid]));
  }));
  (await audit("gateway", "approval.withdraw", { approval_id: aid, version: nextVersion }));
  return (await getApproval(aid)) as Row;
}

export class KeyError extends Error {
  constructor(public key: string) {
    super(key);
  }
}
