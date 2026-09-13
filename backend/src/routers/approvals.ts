import { Hono } from "hono";
import { canDecideCurrent, employeeForUser } from "../approval/inbox.js";
import { calculateApprovalPlan, type PlanInput } from "../approval/plan.js";
import { authDisabled, requireConnector, scopedUser } from "../auth.js";
import { audit } from "../db.js";
import { createWorkApproval, decide, getApproval, KeyError, listApprovals, listWecomCards } from "../gateway/wecom.js";
import { HttpFail } from "../host/errors.js";
import { currentUser } from "../host/persona.js";
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
};

function enrichApproval(approval: Row, user = scopedUser()) {
  const chain = approval.chain as string[];
  const index = Number(approval.current_index);
  const expectedRole = chain[index] || null;
  const viewer = employeeForUser(user);
  return {
    ...approval,
    expected_role: expectedRole,
    can_decide: String(approval.status) === "pending" && canDecideCurrent(user, chain, index),
    viewer_name: viewer?.name || user?.name || null,
  };
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

function createExpenseApproval(body: ExpenseCreateBody) {
  const plan = planOrThrow(body);
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
  audit("host", "expense.approval.created", {
    approval_id: approval.id,
    policy_id: plan.policy_id,
    rule_id: plan.rule_id,
    requester_id: plan.requester_id,
  });
  return enrichApproval(approval);
}

approvals.get("/approvals", (c) => {
  requireConnector("wecom", "read");
  return c.json(listApprovals().map((approval) => enrichApproval(approval)));
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
  return c.json({ kind: "expense", plan, steps: plan.steps });
});

approvals.get("/approvals/:aid", (c) => {
  requireConnector("wecom", "read");
  const row = getApproval(c.req.param("aid"));
  if (!row) throw new HttpFail(404, "Not Found");
  return c.json(row);
});

approvals.post("/approvals/:aid/decide", async (c) => {
  const body = (await c.req.json()) as { decision: string; actor?: string };
  const approval = getApproval(c.req.param("aid"));
  if (!approval) throw new HttpFail(404, "Not Found");
  let actor = body.actor;
  if (!authDisabled()) {
    requireConnector("wecom", "write");
    const user = scopedUser();
    const chain = approval.chain as string[];
    const index = Number(approval.current_index);
    const expected = chain[index];
    if (!user || !canDecideCurrent(user, chain, index)) {
      throw new HttpFail(403, { code: "approval_role_required", role: expected });
    }
    actor = expected;
  }
  try {
    return c.json(await decide(c.req.param("aid"), body.decision, actor));
  } catch (e) {
    if (e instanceof KeyError) throw new HttpFail(404, "Not Found");
    throw new HttpFail(400, String(e));
  }
});

approvals.get("/wecom/cards", (c) => {
  requireConnector("wecom", "read");
  return c.json(listWecomCards());
});
