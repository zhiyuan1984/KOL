/**
 * Gateway：企微模板卡 + 费用审批链。
 * 审批人只来自 Host 规则引擎传入的 chain；本文件不点名。
 */
import { audit, getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import { currentUser } from "../host/persona.js";
import type { WorkApprovalKind } from "../stages.js";
import type { Json, Row } from "../types.js";

export const APPROVAL_KIND_LABEL: Record<WorkApprovalKind, string> = {
  expense: "费用审批",
  stage: "阶段审批",
  content: "内容审核",
  settlement: "结算审批",
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

export function getApproval(aid: string): Row | null {
  const row = getConn().prepare("SELECT * FROM approvals WHERE id = ?").get(aid) as Row | undefined;
  if (!row) return null;
  const d: Row = { ...row };
  d.kind = String(d.kind || "expense");
  d.kind_label = APPROVAL_KIND_LABEL[d.kind as WorkApprovalKind] || d.kind;
  d.chain = JSON.parse(String(d.chain));
  d.chain_id = d.chain_id || d.id;
  d.payload = parseJson(d.payload);
  d.chain_detail = (d.chain as string[]).map((x) => actorOf(x, d.payload as Json));
  const card = getConn().prepare("SELECT * FROM wecom_cards WHERE id = ?").get(d.wecom_card_id) as Row | undefined;
  d.wecom_card = card ? { ...card } : null;
  if (d.wecom_card && (d.wecom_card as Row).payload) {
    (d.wecom_card as Row).payload = parseJson((d.wecom_card as Row).payload);
  }
  if (d.wecom_card) {
    (d.wecom_card as Row).body = withoutRecordIds(String((d.wecom_card as Row).body || ""));
  }
  return d;
}

export function createWorkApproval(input: {
  kind: WorkApprovalKind;
  brand?: string;
  amountUsd?: number;
  draftId?: string;
  fingerprint?: string;
  payload?: Json;
  title?: string;
  chain?: string[];
}): Row {
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
    submittedBy = currentUser().handle;
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
  tx((c) => {
    c.prepare(
      `INSERT INTO approvals
       (id, draft_id, brand, amount_usd, status, chain, current_index, uses_left,
        fingerprint, need_manual_band, wecom_card_id, created_at, chain_id,
        kind, payload, title, submitted_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      aid,
      input.draftId || "",
      brand,
      amount,
      "pending",
      JSON.stringify(chain),
      0,
      1,
      fingerprint,
      0,
      cardId,
      now,
      chainId,
      kind,
      JSON.stringify(payload),
      title,
      submittedBy,
    );
    c.prepare(
      `INSERT INTO wecom_cards (id, approval_id, title, body, status, assignee, payload, ts)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      cardId,
      aid,
      title,
      approvalNotice(kind, payload, "ask", first.name),
      "waiting",
      first.name,
      JSON.stringify(cardPayload),
      now,
    );
    if (input.draftId) {
      c.prepare("UPDATE drafts SET approval_id = ? WHERE id = ?").run(aid, input.draftId);
    }
  });
  audit("gateway", "wecom.card", { approval_id: aid, assignee: first.name, kind, amount });
  return getApproval(aid) as Row;
}

export function listApprovals(): Row[] {
  const ids = getConn().prepare("SELECT id FROM approvals ORDER BY created_at DESC").all() as { id: string }[];
  return ids.map((r) => getApproval(r.id)).filter((x): x is Row => Boolean(x));
}

export function listWecomCards(): Row[] {
  return (getConn().prepare("SELECT * FROM wecom_cards ORDER BY ts DESC").all() as Row[]).map((r) => ({
    ...r,
    body: withoutRecordIds(String(r.body || "")),
    payload: r.payload ? parseJson(r.payload) : {},
  }));
}

export async function decide(
  aid: string,
  decision: string,
  actorRole?: string | null,
  reason?: string | null,
): Promise<Json> {
  const ap = getApproval(aid);
  if (!ap) throw new KeyError(aid);
  if (ap.status !== "pending") throw new Error(`approval status ${ap.status}`);
  const kind = String(ap.kind || "expense") as WorkApprovalKind;
  const chain = ap.chain as string[];
  const idx = Number(ap.current_index);
  const expected = chain[idx];
  if (actorRole && actorRole !== expected) {
    throw new Error(`current level is ${expected}`);
  }
  const now = nowIso();
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
    tx((c) => {
      c.prepare("UPDATE approvals SET status = 'rejected', payload = ? WHERE id = ?").run(
        JSON.stringify(nextPayload),
        aid,
      );
      c.prepare("UPDATE wecom_cards SET status = 'rejected', body = ? WHERE approval_id = ?").run(
        approvalNotice(kind, nextPayload, "reject", actorName, undefined, rejectReason),
        aid,
      );
      if (ap.draft_id) c.prepare("UPDATE drafts SET status = 'discarded' WHERE id = ?").run(ap.draft_id);
    });
    audit("gateway", "approval.reject", { approval_id: aid, kind, reason: rejectReason });
    return { ...getApproval(aid), sent: false, discarded: true, stage_changed: false, reject_reason: rejectReason };
  }
  if (decision !== "approve") throw new Error("decision must be approve or reject");

  if (idx < chain.length - 1) {
    const nxt = chain[idx + 1];
    const person = actorOf(nxt, ap.payload as Json);
    const expectedActor = actorOf(expected, ap.payload as Json);
    tx((c) => {
      c.prepare("UPDATE approvals SET current_index = ? WHERE id = ?").run(idx + 1, aid);
      c.prepare("UPDATE wecom_cards SET status = 'forwarded', body = ? WHERE approval_id = ?").run(
        approvalNotice(kind, ap.payload as Json, "advance", person.name, expectedActor.name),
        aid,
      );
      c.prepare("UPDATE wecom_cards SET assignee = ?, payload = ?, ts = ? WHERE approval_id = ?").run(
        person.name,
        JSON.stringify({ approval_id: aid, assignee: person, level: nxt, kind, amount_usd: ap.amount_usd }),
        now,
        aid,
      );
    });
    audit("gateway", "approval.advance", { approval_id: aid, next: nxt, kind });
    return { ...getApproval(aid), sent: false, advanced: true, stage_changed: false };
  }

  const { fulfillExpenseApproval } = await import("../host/approval-fulfill.js");
  const fulfilled = await fulfillExpenseApproval(ap);
  tx((c) => {
    c.prepare("UPDATE approvals SET status = 'consumed', uses_left = 0 WHERE id = ?").run(aid);
    c.prepare("UPDATE wecom_cards SET status = 'sent', body = ? WHERE approval_id = ?").run(
      approvalNotice(kind, ap.payload as Json, "done", actorOf(expected, ap.payload as Json).name),
      aid,
    );
  });
  audit("gateway", "approval.final_fulfill", { approval_id: aid, kind });
  return { ...getApproval(aid), ...fulfilled };
}

export class KeyError extends Error {
  constructor(public key: string) {
    super(key);
  }
}
