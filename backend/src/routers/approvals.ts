import { Hono } from "hono";
import { employeeForUser } from "../approval/inbox.js";
import { calculateApprovalPlan, planContentVersion, type PlanInput } from "../approval/plan.js";
import {
  inApprovalBox,
  isVisibleToViewer,
  parseApprovalBox,
  projectApproval,
  type ApprovalBox,
} from "../approval/queue.js";
import { authDisabled, requireConnector, scopedUser } from "../auth.js";
import { audit } from "../db.js";
import {
  createReceipt,
  createWorkApproval,
  decide,
  getApproval,
  KeyError,
  listApprovals,
  listWecomCards,
  saveCreateReceipt,
} from "../gateway/wecom.js";
import { HttpFail } from "../host/errors.js";
import { currentUser } from "../host/persona.js";
import { parseExpectedVersion } from "../host/version.js";
import type { Row } from "../types.js";

export const approvals = new Hono();

type ExpenseCreateBody = {
  kind?: string;
  amount?: unknown;
  currency?: unknown;
  requester_id?: unknown;
  requester_name?: unknown;
  purpose?: unknown;
  business_type?: unknown;
  expected_version?: unknown;
  idempotency_key?: unknown;
};

function viewer() {
  return scopedUser() || undefined;
}

function enrich(approval: Row) {
  return projectApproval(approval, viewer());
}

function requireVisible(approval: Row) {
  if (authDisabled()) return;
  if (!isVisibleToViewer(approval, viewer())) {
    throw new HttpFail(404, "Not Found");
  }
}

function defaultRequester(): Pick<PlanInput, "requester_id" | "requester_name"> {
  try {
    const user = scopedUser();
    if (user) {
      const person = employeeForUser(user);
      return {
        requester_id: person?.id,
        requester_name: person?.name || user.name,
      };
    }
    const me = currentUser();
    const person = employeeForUser({ name: me.name, username: me.handle });
    return {
      requester_id: person?.id,
      requester_name: person?.name || me.name,
    };
  } catch {
    return {};
  }
}

function expensePlanInput(body: ExpenseCreateBody): PlanInput {
  const kind = String(body.kind || "").trim();
  if (kind !== "expense") {
    throw new HttpFail(400, { code: "unsupported_kind", message: "本页只能发起费用审批。" });
  }
  const requester_id = String(body.requester_id || "").trim();
  const requester_name = String(body.requester_name || "").trim();
  const fallback = !requester_id && !requester_name ? defaultRequester() : {};
  return {
    amount: Number(body.amount),
    currency: String(body.currency || "CNY").trim() || "CNY",
    requester_id: requester_id || fallback.requester_id,
    requester_name: requester_name || fallback.requester_name,
    purpose: String(body.purpose || "").trim() || undefined,
    business_type: String(body.business_type || "").trim() || "marketing_expense",
  };
}

function planOrThrow(body: ExpenseCreateBody) {
  const plan = calculateApprovalPlan(expensePlanInput(body));
  if (plan.blocked) {
    throw new HttpFail(400, {
      code: plan.blocked.code,
      message: plan.explanation || plan.blocked.message || "审批规则无法计算路径。",
    });
  }
  return plan;
}

function requireIdempotencyKey(value: unknown): string {
  const key = String(value || "").trim();
  if (!key) {
    throw new HttpFail(400, { code: "idempotency_key_required", message: "提交需要幂等键。" });
  }
  return key;
}

function requireExpectedVersion(value: unknown): number {
  const version = parseExpectedVersion(value);
  if (version == null) {
    throw new HttpFail(400, { code: "expected_version_required", message: "提交需要期望版本。" });
  }
  return version;
}

function createExpenseApproval(body: ExpenseCreateBody) {
  const plan = planOrThrow(body);
  const planVersion = planContentVersion(plan);
  const expected = body.expected_version == null || body.expected_version === ""
    ? (authDisabled() ? planVersion : null)
    : requireExpectedVersion(body.expected_version);
  if (expected == null) {
    throw new HttpFail(400, { code: "expected_version_required", message: "提交需要期望版本。" });
  }
  if (expected !== planVersion) {
    throw new HttpFail(409, { code: "stale", message: "审批内容已变化，请重新确认。" });
  }
  const idempotencyKey = String(body.idempotency_key || "").trim();
  if (!idempotencyKey && !authDisabled()) {
    throw new HttpFail(400, { code: "idempotency_key_required", message: "提交需要幂等键。" });
  }
  if (idempotencyKey) {
    const replayed = createReceipt(idempotencyKey);
    if (replayed) return enrich(replayed);
  }
  const approval = createWorkApproval({
    kind: "expense",
    brand: "LT",
    amountUsd: plan.amount_base,
    title: `${plan.requester_name}申请 ${plan.currency} ${plan.amount}，折合人民币 ${plan.amount_base}`,
    chain: plan.steps.map((step) => step.employee_id),
    payload: {
      ...plan,
      steps: plan.steps,
      purpose: String(body.purpose || "").trim() || undefined,
    },
  });
  if (!approval?.id) {
    throw new HttpFail(400, {
      code: "empty_approval_chain",
      message: plan.explanation || "规则没有算出可执行的审批链。",
    });
  }
  if (idempotencyKey) saveCreateReceipt(idempotencyKey, approval);
  audit("host", "expense.approval.created", {
    approval_id: approval.id,
    policy_id: plan.policy_id,
    rule_id: plan.rule_id,
    requester_id: plan.requester_id,
    idempotency_key: idempotencyKey || undefined,
  });
  return enrich(approval);
}

function visibleRows(box?: ApprovalBox) {
  const user = viewer();
  return listApprovals()
    .filter((approval) => {
      if (!isVisibleToViewer(approval, user)) return false;
      if (box) return inApprovalBox(approval, box, user);
      return true;
    })
    .map((approval) => enrich(approval));
}

approvals.get("/approvals/badge", (c) => {
  requireConnector("wecom", "read");
  const user = viewer();
  const count = listApprovals().filter((approval) => inApprovalBox(approval, "inbox", user)).length;
  return c.json({ count });
});

approvals.get("/approvals", (c) => {
  requireConnector("wecom", "read");
  let box: ApprovalBox | undefined;
  try {
    box = parseApprovalBox(c.req.query("box"));
  } catch {
    throw new HttpFail(400, { code: "unknown_box", message: "box 只能是 inbox、submitted 或 done。" });
  }
  return c.json(visibleRows(box));
});

approvals.post("/approvals", async (c) => {
  requireConnector("wecom", "write");
  const body = (await c.req.json()) as ExpenseCreateBody;
  return c.json(createExpenseApproval(body));
});

approvals.post("/approvals/preview", async (c) => {
  requireConnector("wecom", "read");
  const body = (await c.req.json()) as ExpenseCreateBody;
  const plan = planOrThrow(body);
  return c.json({
    kind: "expense",
    plan,
    steps: plan.steps,
    expected_version: planContentVersion(plan),
  });
});

approvals.get("/approvals/:aid", (c) => {
  requireConnector("wecom", "read");
  const row = getApproval(c.req.param("aid"));
  if (!row) throw new HttpFail(404, "Not Found");
  requireVisible(row);
  return c.json(enrich(row));
});

approvals.post("/approvals/:aid/decide", async (c) => {
  const body = (await c.req.json()) as {
    decision: string;
    actor?: string;
    reason?: string;
    expected_version?: unknown;
    idempotency_key?: unknown;
  };
  const approval = getApproval(c.req.param("aid"));
  if (!approval) throw new HttpFail(404, "Not Found");
  const expectedVersion = requireExpectedVersion(body.expected_version);
  const idempotencyKey = requireIdempotencyKey(body.idempotency_key);
  let actor = body.actor;
  if (!authDisabled()) {
    requireConnector("wecom", "write");
    const user = scopedUser();
    const chain = approval.chain as string[];
    const index = Number(approval.current_index);
    const expected = chain[index];
    if (!user || !isVisibleToViewer(approval, user)) {
      throw new HttpFail(404, "Not Found");
    }
    if (!canDecideProjected(approval, user)) {
      throw new HttpFail(403, { code: "approval_role_required", role: expected });
    }
    actor = expected;
  }
  if (body.decision === "reject" && !String(body.reason || "").trim()) {
    throw new HttpFail(400, { code: "reject_reason_required", message: "驳回必须填写原因。" });
  }
  try {
    const result = await decide(c.req.param("aid"), body.decision, actor, body.reason, {
      expected_version: expectedVersion,
      idempotency_key: idempotencyKey,
    });
    audit("gateway", "approval.decide", {
      approval_id: c.req.param("aid"),
      decision: body.decision,
      expected_version: expectedVersion,
      idempotency_key: idempotencyKey,
      replayed: Boolean((result as { replayed?: boolean }).replayed),
    });
    return c.json(enrich({ ...getApproval(c.req.param("aid")), ...result } as Row));
  } catch (e) {
    if (e instanceof KeyError) throw new HttpFail(404, "Not Found");
    if (e instanceof HttpFail) throw e;
    if (e instanceof Error && e.message === "reject_reason_required") {
      throw new HttpFail(400, { code: "reject_reason_required", message: "驳回必须填写原因。" });
    }
    throw new HttpFail(400, String(e));
  }
});

approvals.get("/wecom/cards", (c) => {
  requireConnector("wecom", "read");
  return c.json(listWecomCards());
});

function canDecideProjected(approval: Row, user: ReturnType<typeof scopedUser>) {
  return Boolean(projectApproval(approval, user || undefined).can_decide);
}
