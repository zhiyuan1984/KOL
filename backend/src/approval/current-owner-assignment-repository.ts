import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { defaultOrgSnapshot } from "./snapshot.js";
import { employeeById } from "./org.js";
import { postgresTransaction } from "../postgres/pool.js";

/** This command is deliberately PostgreSQL-only.  It repairs one orphaned
 * ontology approval node; it is not a global role or binding mutation. */
export type CurrentOwnerAssignmentInput = {
  approvalId: string;
  targetUserId: string;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: { id: string; name: string; handle: string };
};

export type CurrentOwnerAssignmentResult = {
  replayed: boolean;
  approvalId: string;
  version: number;
  targetUserId: string;
  personRef: string;
};

type ApprovalRecord = {
  id: string;
  status: string;
  kind: string;
  chain: unknown;
  payload: unknown;
  current_index: number | string;
  uses_left: number | string;
  version: number | string;
};

type ActiveUser = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  active: boolean | number | string;
};

type OrganizationPerson = { person_ref: string; status: string };
type StoredReceipt = { result_json: unknown };

type AssignmentReceipt = {
  approval_id: string;
  target_user_id: string;
  reason: string;
  version: number;
  person_ref: string;
};

export class CurrentOwnerAssignmentError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "CurrentOwnerAssignmentError";
  }
}

function fail(code: string, status: 400 | 404 | 409, message: string): never {
  throw new CurrentOwnerAssignmentError(code, status, message);
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  } catch {
    return {};
  }
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return [...value];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? [...parsed] : [];
  } catch {
    return [];
  }
}

function assignmentReceipt(value: unknown): AssignmentReceipt | null {
  const parsed = jsonObject(value);
  const targetUserId = text(parsed.target_user_id);
  const reason = text(parsed.reason);
  const approvalId = text(parsed.approval_id);
  const personRef = text(parsed.person_ref);
  const version = Number(parsed.version);
  if (!approvalId || !targetUserId || !reason || !personRef || !Number.isInteger(version)) return null;
  return { approval_id: approvalId, target_user_id: targetUserId, reason, person_ref: personRef, version };
}

function isActive(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function canonicalUserNode(userId: string): string {
  return `user:${userId}`;
}

export function isCanonicalUserNode(node: string): boolean {
  return /^user:[^\s:][^\s]*$/.test(node);
}

/**
 * Updates exactly the current payload step.  Historical chain entries and all
 * ontology permit fields (scope/base_version/target_digest/change_ref) are
 * copied verbatim rather than reconstructed.
 */
export function assignedOwnerPayload(input: {
  payload: unknown;
  currentIndex: number;
  previousNode: string;
  target: Pick<ActiveUser, "id" | "name">;
  personRef: string;
  actor: CurrentOwnerAssignmentInput["actor"];
  reason: string;
  idempotencyKey: string;
  assignedAt: string;
  approvalId: string;
}): Record<string, unknown> {
  const payload = jsonObject(input.payload);
  const steps = jsonArray(payload.steps);
  const previousStep = steps[input.currentIndex];
  if (!previousStep || typeof previousStep !== "object" || Array.isArray(previousStep)) {
    fail("current_step_missing", 409, "当前审批步骤不完整，不能指派审批人。");
  }
  const canonicalNode = canonicalUserNode(input.target.id);
  const responsibility = {
    type: "authorized_final_reviewer",
    scope: "objects",
    approval_id: input.approvalId,
    limited_to_this_approval: true,
    label: "本体变更 objects 单张授权终审人",
  };
  const nextStep = {
    ...(previousStep as Record<string, unknown>),
    employee_id: canonicalNode,
    user_id: input.target.id,
    person_ref: input.personRef,
    name: input.target.name,
    role: "本体变更 objects 单张授权终审人",
    responsibility,
  };
  const nextSteps = steps.map((step, index) => index === input.currentIndex ? nextStep : step);
  const history = jsonArray(payload.assignment_history);
  return {
    ...payload,
    // These fields are first-write-only by the route's canonical-node guard;
    // preserving them prevents a later command from rewriting provenance.
    original_node: payload.original_node ?? input.previousNode,
    original_step: payload.original_step ?? previousStep,
    steps: nextSteps,
    assignment_history: [...history, {
      action: "assign_current_owner",
      from_node: input.previousNode,
      from_step: previousStep,
      actor: { user_id: input.actor.id, name: input.actor.name, handle: input.actor.handle },
      target_user_id: input.target.id,
      target_name: input.target.name,
      person_ref: input.personRef,
      reason: input.reason,
      idempotency_key: input.idempotencyKey,
      assigned_at: input.assignedAt,
      responsibility,
    }],
  };
}

async function queryRows<T extends QueryResultRow>(client: Pick<PoolClient, "query">, sql: string, values: readonly unknown[] = []): Promise<T[]> {
  return (await client.query<T>(sql, [...values])).rows;
}

function replayOrConflict(receipt: AssignmentReceipt, input: CurrentOwnerAssignmentInput): CurrentOwnerAssignmentResult {
  if (receipt.approval_id !== input.approvalId || receipt.target_user_id !== input.targetUserId || receipt.reason !== input.reason) {
    fail("idempotency_key_conflict", 409, "幂等键已用于不同的当前审批人指派请求。");
  }
  return {
    replayed: true,
    approvalId: receipt.approval_id,
    version: receipt.version,
    targetUserId: receipt.target_user_id,
    personRef: receipt.person_ref,
  };
}

async function priorReceipt(
  client: Pick<PoolClient, "query">,
  input: CurrentOwnerAssignmentInput,
): Promise<CurrentOwnerAssignmentResult | null> {
  const rows = await queryRows<StoredReceipt>(client,
    `SELECT result_json FROM approval_idempotency
      WHERE action=$1 AND approval_id=$2 AND idempotency_key=$3
      FOR UPDATE`,
    ["assign_current_owner", input.approvalId, input.idempotencyKey],
  );
  if (!rows[0]) return null;
  const receipt = assignmentReceipt(rows[0].result_json);
  if (!receipt) fail("idempotency_receipt_invalid", 409, "已有幂等回执不完整，不能安全重放。");
  return replayOrConflict(receipt, input);
}

async function assertLegacyNodeIsOrphan(
  client: Pick<PoolClient, "query">,
  currentNode: string,
  at: string,
): Promise<void> {
  const snapshotNode = employeeById(defaultOrgSnapshot(), currentNode);
  if (!snapshotNode) {
    fail("current_node_not_legacy_snapshot", 409, "当前节点不是可核验的遗留组织节点，不能重指派。");
  }
  const mailboxes = snapshotNode.mailboxes
    .map((mailbox) => mailbox.trim().toLowerCase())
    .filter(Boolean);
  // Exact identity evidence only: never infer a person from prefixes, aliases,
  // or a partial display-name match.  The snapshot's active status alone is not
  // an authenticated account, so emp_zhang with an empty mailbox remains
  // repairable when no real account or binding resolves it.
  const matchingUsers = await queryRows<{ id: string }>(client,
    `SELECT u.id
       FROM users u
      WHERE u.active=1
        AND (u.id=$1 OR u.name=$2
             OR lower(COALESCE(u.username,'')) = ANY($3::text[])
             OR lower(COALESCE(u.email,'')) = ANY($3::text[]))
      LIMIT 1`,
    [currentNode, snapshotNode.name, mailboxes],
  );
  if (matchingUsers.length) {
    fail("current_node_resolved_to_active_user", 409, "当前遗留节点已有精确匹配的在职用户，不能抢占。");
  }
  const bindings = await queryRows<{ user_id: string }>(client,
    `SELECT b.user_id
       FROM approval_role_bindings b
       JOIN users u ON u.id=b.user_id AND u.active=1
      WHERE b.approval_role = ANY($1::text[])
        AND (b.valid_from IS NULL OR b.valid_from <= $2)
        AND (b.valid_to IS NULL OR b.valid_to > $2)
      LIMIT 1`,
    [[currentNode, snapshotNode.name], at],
  );
  if (bindings.length) {
    fail("current_node_has_active_approval_binding", 409, "当前遗留节点已有有效审批绑定，不能抢占。");
  }
}

async function activeTarget(
  client: Pick<PoolClient, "query">,
  targetUserId: string,
): Promise<{ user: ActiveUser; personRef: string }> {
  const users = await queryRows<ActiveUser>(client,
    "SELECT id,name,username,email,active FROM users WHERE id=$1 FOR KEY SHARE",
    [targetUserId],
  );
  const user = users[0];
  if (!user) fail("target_user_not_found", 400, "目标用户不存在。");
  if (!isActive(user.active)) fail("target_user_inactive", 400, "目标用户已停用，不能作为审批人。");
  const people = await queryRows<OrganizationPerson>(client,
    `SELECT person_ref,status FROM organization_people
      WHERE status='active' AND (user_id=$1 OR user_ref=$1)
      ORDER BY person_ref
      FOR KEY SHARE`,
    [targetUserId],
  );
  if (people.length !== 1 || !text(people[0]?.person_ref)) {
    fail("target_person_ref_required", 400, "目标用户必须已有唯一且在职的组织人员关联。");
  }
  return { user, personRef: text(people[0].person_ref) };
}

/**
 * Transaction body exported for mock-based unit tests.  Production callers
 * must use assignCurrentOwner(), which obtains a native PostgreSQL transaction.
 */
export async function assignCurrentOwnerInTransaction(
  client: Pick<PoolClient, "query">,
  input: CurrentOwnerAssignmentInput,
  now = new Date().toISOString(),
): Promise<CurrentOwnerAssignmentResult> {
  const replayBeforeLock = await priorReceipt(client, input);
  if (replayBeforeLock) return replayBeforeLock;

  const approvals = await queryRows<ApprovalRecord>(client,
    "SELECT * FROM approvals WHERE id=$1 FOR UPDATE",
    [input.approvalId],
  );
  const approval = approvals[0];
  if (!approval) fail("approval_not_found", 404, "审批单不存在。");

  // A concurrent caller which waited on the approval row must see the first
  // caller's receipt before it performs any validation or write of its own.
  const replayAfterLock = await priorReceipt(client, input);
  if (replayAfterLock) return replayAfterLock;

  if (text(approval.status) !== "pending") {
    fail("approval_not_pending", 409, "只有待处理审批单可以指派当前审批人。");
  }
  if (text(approval.kind) !== "ontology_change") {
    fail("approval_kind_not_supported", 409, "当前审批人指派只适用于本体变更审批。");
  }
  const payload = jsonObject(approval.payload);
  if (text(payload.scope) !== "objects") {
    fail("approval_scope_not_supported", 409, "当前审批人指派只适用于 objects 范围的单张本体变更审批。");
  }
  const chain = jsonArray(approval.chain).map((node) => text(node));
  const currentIndex = Number(approval.current_index);
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= chain.length || !chain[currentIndex]) {
    fail("current_node_invalid", 409, "当前审批节点无效，不能指派审批人。");
  }
  const previousNode = chain[currentIndex];
  if (isCanonicalUserNode(previousNode)) {
    fail("current_node_already_canonical", 409, "当前审批节点已明确指向用户，不能再次指派。");
  }
  if (Number(approval.version) !== input.expectedVersion) {
    fail("stale", 409, "审批内容已变化，请刷新后重试。");
  }

  await assertLegacyNodeIsOrphan(client, previousNode, now);
  const target = await activeTarget(client, input.targetUserId);
  const nextPayload = assignedOwnerPayload({
    payload,
    currentIndex,
    previousNode,
    target: target.user,
    personRef: target.personRef,
    actor: input.actor,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    assignedAt: now,
    approvalId: input.approvalId,
  });
  const nextChain = [...chain];
  nextChain[currentIndex] = canonicalUserNode(target.user.id);
  const nextVersion = Number(approval.version) + 1;
  const updated = await queryRows<{ id: string }>(client,
    `UPDATE approvals
        SET chain=$1, payload=$2, version=$3, updated_at=$4
      WHERE id=$5 AND status='pending' AND kind='ontology_change' AND version=$6
      RETURNING id`,
    [JSON.stringify(nextChain), JSON.stringify(nextPayload), nextVersion, now, input.approvalId, input.expectedVersion],
  );
  if (!updated.length) fail("stale", 409, "审批内容已变化，请刷新后重试。");

  const receipt: AssignmentReceipt = {
    approval_id: input.approvalId,
    target_user_id: target.user.id,
    reason: input.reason,
    version: nextVersion,
    person_ref: target.personRef,
  };
  const receiptRows = await queryRows<{ id: string }>(client,
    `INSERT INTO approval_idempotency (id,action,approval_id,idempotency_key,result_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (action,approval_id,idempotency_key) DO NOTHING
     RETURNING id`,
    [`aidem_${randomUUID()}`, "assign_current_owner", input.approvalId, input.idempotencyKey, JSON.stringify(receipt), now],
  );
  if (!receiptRows.length) {
    const concurrent = await priorReceipt(client, input);
    if (concurrent) return concurrent;
    fail("idempotency_key_conflict", 409, "幂等键冲突，未写入重复指派。");
  }

  await client.query(
    `INSERT INTO audit_events (ts,actor,event_type,payload)
     VALUES ($1,$2,$3,$4)`,
    [now, input.actor.id, "approval.current_owner.assigned", JSON.stringify({
      approval_id: input.approvalId,
      actor: { user_id: input.actor.id, name: input.actor.name, handle: input.actor.handle },
      reason: input.reason,
      idempotency_key: input.idempotencyKey,
      before: {
        chain_node: previousNode,
        current_index: currentIndex,
        version: Number(approval.version),
        status: approval.status,
        uses_left: approval.uses_left,
        payload_step: jsonArray(payload.steps)[currentIndex],
      },
      after: {
        chain_node: nextChain[currentIndex],
        current_index: currentIndex,
        version: nextVersion,
        status: approval.status,
        uses_left: approval.uses_left,
        target_user_id: target.user.id,
        target_name: target.user.name,
        person_ref: target.personRef,
        scope: "objects",
        responsibility: "本体变更 objects 单张授权终审人",
      },
    })],
  );

  return { replayed: false, approvalId: input.approvalId, version: nextVersion, targetUserId: target.user.id, personRef: target.personRef };
}

export async function assignCurrentOwner(input: CurrentOwnerAssignmentInput): Promise<CurrentOwnerAssignmentResult> {
  return postgresTransaction((client) => assignCurrentOwnerInTransaction(client, input), { isolation: "SERIALIZABLE" });
}
