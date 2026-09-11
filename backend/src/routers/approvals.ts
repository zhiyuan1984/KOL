import { Hono } from "hono";
import { canDecideCurrent, employeeForUser } from "../approval/inbox.js";
import { authDisabled, requireConnector, scopedUser } from "../auth.js";
import { decide, getApproval, KeyError, listApprovals, listWecomCards } from "../gateway/wecom.js";
import { HttpFail } from "../host/errors.js";

export const approvals = new Hono();

approvals.get("/approvals", (c) => {
  requireConnector("wecom", "read");
  const user = scopedUser();
  const viewer = employeeForUser(user);
  return c.json(listApprovals().map((approval) => {
    const chain = approval.chain as string[];
    const index = Number(approval.current_index);
    const expectedRole = chain[index] || null;
    return {
      ...approval,
      expected_role: expectedRole,
      can_decide: String(approval.status) === "pending" && canDecideCurrent(user, chain, index),
      viewer_name: viewer?.name || user?.name || null,
    };
  }));
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
