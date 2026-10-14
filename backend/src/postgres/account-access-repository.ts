import type { PoolClient, QueryResultRow } from "pg";
import type { Row } from "../types.js";
import { nid } from "../ids.js";
import {
  reencryptRuntimeCredential,
  type RuntimeCredentialCipherRecord,
} from "../runtime/credentials.js";
import { postgresQuery, postgresTransaction } from "./pool.js";

export const ACCOUNT_ACCESS_REASON = "用户 2026-10-05：登录账户从鄢棽切换为黄启友；黄启友获得鄢棽原有的邮箱与权限";
export const ACCOUNT_ACCESS_SOURCE = "user-confirmed 2026-10-05";

export type AccountAccessSection =
  | "mailbox"
  | "roles"
  | "brands"
  | "approval_role"
  | "connector_grant"
  | "skill_grant"
  | "agent_binding";

export type AccountAccessAction = {
  section: AccountAccessSection;
  action: "copy" | "skip";
  key: string;
  detail?: string;
};

export type AccountAccessInput = {
  from: string;
  to: string;
  apply?: boolean;
  actor?: string;
};

export type AccountAccessReport = {
  applied: boolean;
  from: { id: string; name: string; username: string };
  to: { id: string; name: string; username: string };
  from_person: string | null;
  to_person: string | null;
  actions: AccountAccessAction[];
};

type UserRow = QueryResultRow & {
  id: string;
  username: string;
  name: string;
  roles: string;
  brands: string;
  active: number | string;
};
type BindingRow = QueryResultRow & {
  mailbox_email: string;
  is_default: number | string;
  mailbox_id: string | null;
  owner_name: string | null;
  bearer_token: string | null;
  status: string | null;
  updated_at: string | null;
  sync_cursor_at: string | null;
  sync_cursor_id: string | null;
  sync_page_no: number | string | null;
  synced_at: string | null;
};
type ApprovalRow = QueryResultRow & {
  approval_role: string;
  role_kind: string | null;
  valid_from: string | null;
  valid_to: string | null;
};
type ConnectorGrantRow = QueryResultRow & { connector_id: string; access: string | null };
type SkillGrantRow = QueryResultRow & { skill_id: string };
type AgentBindingRow = QueryResultRow & {
  id: string;
  agent_id: string;
  company_id: string;
  effective_from: string | null;
  effective_to: string | null;
  org_version: number | string;
};
type CredentialRow = RuntimeCredentialCipherRecord & QueryResultRow & {
  type: string;
  status: string;
  label: string;
  purpose: string;
  key_version: number | string;
};

type Reader = PoolClient | undefined;

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(text(value) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function distinctUnion(first: string[], second: string[]): string[] {
  return [...first, ...second.filter((entry) => !first.includes(entry))];
}

async function rows<T extends QueryResultRow>(client: Reader, statement: string, values: readonly unknown[] = []): Promise<T[]> {
  if (client) return (await client.query<T>(statement, [...values])).rows;
  return postgresQuery<T>(statement, values);
}

function normalizedInput(input: AccountAccessInput): { fromId: string; toId: string; actor: string } {
  const fromId = text(input.from).trim();
  const toId = text(input.to).trim();
  if (!fromId || !toId) throw new Error("copyAccountAccess 需要 from 与 to 两个账号 id");
  if (fromId === toId) throw new Error("来源与目标账号相同，无需复制");
  return { fromId, toId, actor: text(input.actor).trim() || "cli:copy-account-access" };
}

async function lockedUsers(client: Reader, fromId: string, toId: string): Promise<{ from: UserRow; to: UserRow }> {
  const ids = [fromId, toId].sort();
  const lock = client ? " FOR UPDATE" : "";
  const accountRows = await rows<UserRow>(client,
    `SELECT id,username,name,roles,brands,active FROM users WHERE id = ANY($1::text[]) ORDER BY id${lock}`,
    [ids],
  );
  const byId = new Map(accountRows.map((row) => [row.id, row]));
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to) {
    throw new Error(`账号不存在：${!from ? fromId : toId}。请先完成组织人员账号导入。`);
  }
  if (Number(from.active) !== 1 || Number(to.active) !== 1) {
    throw new Error(`账号未启用：from active=${from.active}，to active=${to.active}`);
  }
  return { from, to };
}

async function personRef(client: Reader, userId: string): Promise<string | null> {
  const [person] = await rows<{ person_ref: string }>(client,
    "SELECT person_ref FROM organization_people WHERE user_id=$1 AND status='active' ORDER BY person_ref LIMIT 1",
    [userId],
  );
  return person?.person_ref ? String(person.person_ref) : null;
}

async function personIsActiveMemberOfCompany(
  client: Reader,
  person: string,
  companyId: string,
  stamp: string,
): Promise<boolean> {
  const [membership] = await rows<{ present: number }>(client,
    `SELECT 1 AS present
       FROM organization_memberships
      WHERE person_ref=$1 AND company_id=$2 AND status='active'
        AND (effective_from IS NULL OR effective_from <= $3)
        AND (effective_to IS NULL OR effective_to > $3)
      LIMIT 1`,
    [person, companyId, stamp],
  );
  return Boolean(membership?.present);
}

function accountReport(
  applied: boolean,
  from: UserRow,
  to: UserRow,
  fromPerson: string | null,
  toPerson: string | null,
  actions: AccountAccessAction[],
): AccountAccessReport {
  return {
    applied,
    from: { id: from.id, name: text(from.name), username: text(from.username) },
    to: { id: to.id, name: text(to.name), username: text(to.username) },
    from_person: fromPerson,
    to_person: toPerson,
    actions,
  };
}

async function planCopy(client: Reader, input: AccountAccessInput): Promise<AccountAccessReport> {
  const { fromId, toId } = normalizedInput(input);
  const { from, to } = await lockedUsers(client, fromId, toId);
  const [fromPerson, toPerson] = await Promise.all([personRef(client, fromId), personRef(client, toId)]);
  const actions: AccountAccessAction[] = [];

  const [fromBindings, targetBindings] = await Promise.all([
    rows<BindingRow>(client, `SELECT mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at,sync_cursor_at,sync_cursor_id,sync_page_no,synced_at
      FROM user_starry_bindings WHERE user_id=$1 ORDER BY is_default DESC,updated_at ASC,mailbox_email ASC`, [fromId]),
    rows<{ mailbox_email: string }>(client, "SELECT mailbox_email FROM user_starry_bindings WHERE user_id=$1", [toId]),
  ]);
  const targetMailboxes = new Set(targetBindings.map((row) => text(row.mailbox_email)));
  for (const binding of fromBindings) {
    const mailbox = text(binding.mailbox_email);
    const detail = `默认=${Number(binding.is_default) === 1 ? "是" : "否"}，状态=${text(binding.status)}`;
    actions.push(!mailbox || targetMailboxes.has(mailbox)
      ? { section: "mailbox", action: "skip", key: mailbox, detail: "目标账号已绑定" }
      : { section: "mailbox", action: "copy", key: mailbox, detail });
  }

  const fromRoles = jsonArray(from.roles);
  const toRoles = jsonArray(to.roles);
  const nextRoles = distinctUnion(fromRoles, toRoles);
  actions.push(JSON.stringify(nextRoles) === JSON.stringify(toRoles)
    ? { section: "roles", action: "skip", key: JSON.stringify(toRoles), detail: "已一致" }
    : { section: "roles", action: "copy", key: JSON.stringify(nextRoles), detail: `${JSON.stringify(toRoles)} → ${JSON.stringify(nextRoles)}` });
  const fromBrands = jsonArray(from.brands);
  const toBrands = jsonArray(to.brands);
  const nextBrands = distinctUnion(fromBrands, toBrands);
  actions.push(JSON.stringify(nextBrands) === JSON.stringify(toBrands)
    ? { section: "brands", action: "skip", key: JSON.stringify(toBrands), detail: "已一致" }
    : { section: "brands", action: "copy", key: JSON.stringify(nextBrands), detail: `${JSON.stringify(toBrands)} → ${JSON.stringify(nextBrands)}` });

  const [fromApprovals, targetApprovals, fromConnectors, targetConnectors, fromSkills, targetSkills] = await Promise.all([
    rows<ApprovalRow>(client, "SELECT approval_role,role_kind,valid_from,valid_to FROM approval_role_bindings WHERE user_id=$1 ORDER BY approval_role", [fromId]),
    rows<{ approval_role: string }>(client, "SELECT approval_role FROM approval_role_bindings WHERE user_id=$1", [toId]),
    rows<ConnectorGrantRow>(client, "SELECT connector_id,access FROM user_connector_grants WHERE user_id=$1 ORDER BY connector_id", [fromId]),
    rows<{ connector_id: string }>(client, "SELECT connector_id FROM user_connector_grants WHERE user_id=$1", [toId]),
    rows<SkillGrantRow>(client, "SELECT skill_id FROM user_skill_grants WHERE user_id=$1 ORDER BY skill_id", [fromId]),
    rows<{ skill_id: string }>(client, "SELECT skill_id FROM user_skill_grants WHERE user_id=$1", [toId]),
  ]);
  const targetApprovalRoles = new Set(targetApprovals.map((row) => text(row.approval_role)));
  for (const grant of fromApprovals) actions.push(targetApprovalRoles.has(text(grant.approval_role))
    ? { section: "approval_role", action: "skip", key: text(grant.approval_role), detail: "目标账号已有" }
    : { section: "approval_role", action: "copy", key: text(grant.approval_role) });
  const targetConnectorIds = new Set(targetConnectors.map((row) => text(row.connector_id)));
  for (const grant of fromConnectors) actions.push(targetConnectorIds.has(text(grant.connector_id))
    ? { section: "connector_grant", action: "skip", key: text(grant.connector_id), detail: "目标账号已有" }
    : { section: "connector_grant", action: "copy", key: text(grant.connector_id), detail: text(grant.access || "read") });
  const targetSkillIds = new Set(targetSkills.map((row) => text(row.skill_id)));
  // 仅逐项保留原有个人 skill grant；绝不转换成任何 "all"/默认放行权限。
  for (const grant of fromSkills) actions.push(targetSkillIds.has(text(grant.skill_id))
    ? { section: "skill_grant", action: "skip", key: text(grant.skill_id), detail: "目标账号已有" }
    : { section: "skill_grant", action: "copy", key: text(grant.skill_id) });

  if (!fromPerson || !toPerson) {
    actions.push({ section: "agent_binding", action: "skip", key: fromPerson || toPerson || "", detail: "人员锚点缺失（organization_people.user_id），跳过 Agent 绑定复制" });
  } else {
    const [sourceBindings, targetAgentBindings] = await Promise.all([
      rows<AgentBindingRow>(client, `SELECT id,agent_id,company_id,effective_from,effective_to,org_version
        FROM agent_bindings WHERE status='active' AND target_type='person' AND target_id=$1 ORDER BY agent_id,id`, [fromPerson]),
      rows<{ id: string; agent_id: string }>(client, "SELECT id,agent_id FROM agent_bindings WHERE target_type='person' AND target_id=$1", [toPerson]),
    ]);
    const targetAgentIds = new Set(targetAgentBindings.map((row) => text(row.agent_id)));
    for (const binding of sourceBindings) actions.push(targetAgentIds.has(text(binding.agent_id))
      ? { section: "agent_binding", action: "skip", key: text(binding.agent_id), detail: "目标人员已有" }
      : { section: "agent_binding", action: "copy", key: text(binding.agent_id), detail: `→ ${toPerson}` });
  }
  return accountReport(false, from, to, fromPerson, toPerson, actions);
}

async function copyInTransaction(client: PoolClient, input: AccountAccessInput): Promise<AccountAccessReport> {
  const { fromId, toId, actor } = normalizedInput(input);
  const stamp = nowIso();
  const { from, to } = await lockedUsers(client, fromId, toId);
  const [fromPerson, toPerson] = await Promise.all([personRef(client, fromId), personRef(client, toId)]);
  const actions: AccountAccessAction[] = [];

  const [fromBindings, targetBindingRows] = await Promise.all([
    rows<BindingRow>(client, `SELECT mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at,sync_cursor_at,sync_cursor_id,sync_page_no,synced_at
      FROM user_starry_bindings WHERE user_id=$1 ORDER BY is_default DESC,updated_at ASC,mailbox_email ASC`, [fromId]),
    rows<{ mailbox_email: string; is_default: number | string }>(client,
      "SELECT mailbox_email,is_default FROM user_starry_bindings WHERE user_id=$1 FOR UPDATE", [toId]),
  ]);
  const targetMailboxes = new Set(targetBindingRows.map((row) => text(row.mailbox_email)));
  let targetHasDefault = targetBindingRows.some((row) => Number(row.is_default) === 1);
  for (const binding of fromBindings) {
    const mailbox = text(binding.mailbox_email);
    const detail = `默认=${Number(binding.is_default) === 1 ? "是" : "否"}，状态=${text(binding.status)}`;
    if (!mailbox || targetMailboxes.has(mailbox)) {
      actions.push({ section: "mailbox", action: "skip", key: mailbox, detail: "目标账号已绑定" });
      continue;
    }
    let targetCredentialRef = "";
    const sourceCredentialRef = text(binding.bearer_token).trim();
    let targetCredentialId: string | undefined;
    if (sourceCredentialRef) {
      const [sourceCredential] = await rows<CredentialRow>(client,
        `SELECT id,type,owner_user_id,label,purpose,status,ciphertext,nonce,auth_tag,key_version,version,created_by,created_at,updated_at
           FROM runtime_credentials WHERE id=$1 FOR SHARE`,
        [sourceCredentialRef],
      );
      if (!sourceCredential || sourceCredential.type !== "user_account" || sourceCredential.owner_user_id !== fromId || sourceCredential.status !== "active") {
        throw new Error("来源邮箱凭据不可用，拒绝复制跨账号或非活动凭据");
      }
      targetCredentialId = nid("cred");
      const encrypted = reencryptRuntimeCredential(sourceCredential, targetCredentialId, toId);
      await client.query(
        `INSERT INTO runtime_credentials
          (id,type,owner_user_id,label,purpose,status,ciphertext,nonce,auth_tag,key_version,version,created_by,created_at,updated_at)
         VALUES ($1,'user_account',$2,$3,$4,'active',$5,$6,$7,$8,1,$9,$10,$10)`,
        [targetCredentialId, toId, sourceCredential.label, sourceCredential.purpose,
          encrypted.ciphertext, encrypted.nonce, encrypted.authTag, Number(sourceCredential.key_version), actor, stamp],
      );
      targetCredentialRef = targetCredentialId;
    }
    const inserted = await client.query<{ mailbox_email: string }>(
      `INSERT INTO user_starry_bindings
       (user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at,sync_cursor_at,sync_cursor_id,sync_page_no,synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id,mailbox_email) DO NOTHING
       RETURNING mailbox_email`,
      [toId, mailbox, targetHasDefault ? 0 : 1, binding.mailbox_id, binding.owner_name, targetCredentialRef,
        text(binding.status) === "expired" ? "expired" : "connected", stamp, binding.sync_cursor_at,
        binding.sync_cursor_id, Number(binding.sync_page_no || 1), binding.synced_at],
    );
    if (!inserted.rows.length) {
      if (targetCredentialId) await client.query("DELETE FROM runtime_credentials WHERE id=$1", [targetCredentialId]);
      actions.push({ section: "mailbox", action: "skip", key: mailbox, detail: "目标账号已绑定" });
      targetMailboxes.add(mailbox);
      continue;
    }
    targetMailboxes.add(mailbox);
    targetHasDefault = true;
    actions.push({ section: "mailbox", action: "copy", key: mailbox, detail });
  }

  const fromRoles = jsonArray(from.roles);
  const toRoles = jsonArray(to.roles);
  const nextRoles = distinctUnion(fromRoles, toRoles);
  if (JSON.stringify(nextRoles) === JSON.stringify(toRoles)) {
    actions.push({ section: "roles", action: "skip", key: JSON.stringify(toRoles), detail: "已一致" });
  } else {
    await client.query("UPDATE users SET roles=$1,updated_at=$2 WHERE id=$3", [JSON.stringify(nextRoles), stamp, toId]);
    actions.push({ section: "roles", action: "copy", key: JSON.stringify(nextRoles), detail: `${JSON.stringify(toRoles)} → ${JSON.stringify(nextRoles)}` });
  }
  const fromBrands = jsonArray(from.brands);
  const toBrands = jsonArray(to.brands);
  const nextBrands = distinctUnion(fromBrands, toBrands);
  if (JSON.stringify(nextBrands) === JSON.stringify(toBrands)) {
    actions.push({ section: "brands", action: "skip", key: JSON.stringify(toBrands), detail: "已一致" });
  } else {
    await client.query("UPDATE users SET brands=$1,updated_at=$2 WHERE id=$3", [JSON.stringify(nextBrands), stamp, toId]);
    actions.push({ section: "brands", action: "copy", key: JSON.stringify(nextBrands), detail: `${JSON.stringify(toBrands)} → ${JSON.stringify(nextBrands)}` });
  }

  const [fromApprovals, targetApprovals] = await Promise.all([
    rows<ApprovalRow>(client, "SELECT approval_role,role_kind,valid_from,valid_to FROM approval_role_bindings WHERE user_id=$1 ORDER BY approval_role", [fromId]),
    rows<{ approval_role: string }>(client, "SELECT approval_role FROM approval_role_bindings WHERE user_id=$1 FOR UPDATE", [toId]),
  ]);
  const targetApprovalRoles = new Set(targetApprovals.map((row) => text(row.approval_role)));
  for (const grant of fromApprovals) {
    const role = text(grant.approval_role);
    if (targetApprovalRoles.has(role)) {
      actions.push({ section: "approval_role", action: "skip", key: role, detail: "目标账号已有" });
      continue;
    }
    const inserted = await client.query(
      `INSERT INTO approval_role_bindings(user_id,approval_role,role_kind,valid_from,valid_to,created_at)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,approval_role) DO NOTHING RETURNING approval_role`,
      [toId, role, text(grant.role_kind) || "position", grant.valid_from, grant.valid_to, stamp],
    );
    if (inserted.rows.length) {
      targetApprovalRoles.add(role);
      actions.push({ section: "approval_role", action: "copy", key: role });
    } else actions.push({ section: "approval_role", action: "skip", key: role, detail: "目标账号已有" });
  }

  const [fromConnectors, targetConnectors] = await Promise.all([
    rows<ConnectorGrantRow>(client, "SELECT connector_id,access FROM user_connector_grants WHERE user_id=$1 ORDER BY connector_id", [fromId]),
    rows<{ connector_id: string }>(client, "SELECT connector_id FROM user_connector_grants WHERE user_id=$1 FOR UPDATE", [toId]),
  ]);
  const targetConnectorIds = new Set(targetConnectors.map((row) => text(row.connector_id)));
  for (const grant of fromConnectors) {
    const connectorId = text(grant.connector_id);
    if (targetConnectorIds.has(connectorId)) {
      actions.push({ section: "connector_grant", action: "skip", key: connectorId, detail: "目标账号已有" });
      continue;
    }
    const inserted = await client.query(
      `INSERT INTO user_connector_grants(user_id,connector_id,access,created_at)
       VALUES($1,$2,$3,$4) ON CONFLICT(user_id,connector_id) DO NOTHING RETURNING connector_id`,
      [toId, connectorId, text(grant.access) || "read", stamp],
    );
    if (inserted.rows.length) {
      targetConnectorIds.add(connectorId);
      actions.push({ section: "connector_grant", action: "copy", key: connectorId, detail: text(grant.access) || "read" });
    } else actions.push({ section: "connector_grant", action: "skip", key: connectorId, detail: "目标账号已有" });
  }

  const [fromSkills, targetSkills] = await Promise.all([
    rows<SkillGrantRow>(client, "SELECT skill_id FROM user_skill_grants WHERE user_id=$1 ORDER BY skill_id", [fromId]),
    rows<{ skill_id: string }>(client, "SELECT skill_id FROM user_skill_grants WHERE user_id=$1 FOR UPDATE", [toId]),
  ]);
  const targetSkillIds = new Set(targetSkills.map((row) => text(row.skill_id)));
  for (const grant of fromSkills) {
    const skillId = text(grant.skill_id);
    if (targetSkillIds.has(skillId)) {
      actions.push({ section: "skill_grant", action: "skip", key: skillId, detail: "目标账号已有" });
      continue;
    }
    const inserted = await client.query(
      `INSERT INTO user_skill_grants(user_id,skill_id,created_at)
       VALUES($1,$2,$3) ON CONFLICT(user_id,skill_id) DO NOTHING RETURNING skill_id`,
      [toId, skillId, stamp],
    );
    if (inserted.rows.length) {
      targetSkillIds.add(skillId);
      actions.push({ section: "skill_grant", action: "copy", key: skillId });
    } else actions.push({ section: "skill_grant", action: "skip", key: skillId, detail: "目标账号已有" });
  }

  if (!fromPerson || !toPerson) {
    actions.push({ section: "agent_binding", action: "skip", key: fromPerson || toPerson || "", detail: "人员锚点缺失（organization_people.user_id），跳过 Agent 绑定复制" });
  } else {
    const [sourceBindings, targetBindings] = await Promise.all([
      rows<AgentBindingRow>(client, `SELECT id,agent_id,company_id,effective_from,effective_to,org_version
        FROM agent_bindings WHERE status='active' AND target_type='person' AND target_id=$1 ORDER BY agent_id,id`, [fromPerson]),
      rows<{ agent_id: string }>(client, "SELECT agent_id FROM agent_bindings WHERE target_type='person' AND target_id=$1 FOR UPDATE", [toPerson]),
    ]);
    const targetAgentIds = new Set(targetBindings.map((row) => text(row.agent_id)));
    for (const sourceBinding of sourceBindings) {
      const agentId = text(sourceBinding.agent_id);
      if (targetAgentIds.has(agentId)) {
        actions.push({ section: "agent_binding", action: "skip", key: agentId, detail: "目标人员已有" });
        continue;
      }
      const [sourceInCompany, targetInCompany] = await Promise.all([
        personIsActiveMemberOfCompany(client, fromPerson, text(sourceBinding.company_id), stamp),
        personIsActiveMemberOfCompany(client, toPerson, text(sourceBinding.company_id), stamp),
      ]);
      if (!sourceInCompany || !targetInCompany) {
        actions.push({ section: "agent_binding", action: "skip", key: agentId, detail: "人员不在来源公司有效成员范围内" });
        continue;
      }
      const id = `binding:${agentId}:person:${toPerson}`;
      const orgVersionRows = await client.query<{ version: number | string }>("SELECT MAX(version) AS version FROM org_versions WHERE company_id=$1", [sourceBinding.company_id]);
      const orgVersion = Math.max(1, Number(orgVersionRows.rows[0]?.version || sourceBinding.org_version || 1));
      const inserted = await client.query(
        `INSERT INTO agent_bindings
          (id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_by,reason,effective_from,effective_to,source,created_at,updated_at)
         VALUES($1,$2,'person',$3,$4,'active',1,$5,$6,$7,$8,$9,$10,$11,$11)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [id, agentId, toPerson, sourceBinding.company_id, orgVersion, actor, ACCOUNT_ACCESS_REASON,
          sourceBinding.effective_from || stamp, sourceBinding.effective_to, ACCOUNT_ACCESS_SOURCE, stamp],
      );
      if (inserted.rows.length) {
        targetAgentIds.add(agentId);
        actions.push({ section: "agent_binding", action: "copy", key: agentId, detail: `→ ${toPerson}` });
      } else actions.push({ section: "agent_binding", action: "skip", key: agentId, detail: "目标人员已有" });
    }
  }

  if (actions.some((action) => action.action === "copy")) {
    await client.query(
      "INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,'account_access.copied',$3)",
      [stamp, actor, JSON.stringify({ from: fromId, to: toId, from_person: fromPerson, to_person: toPerson, actions, source: ACCOUNT_ACCESS_SOURCE })],
    );
  }
  return accountReport(true, from, to, fromPerson, toPerson, actions);
}

/**
 * Native PostgreSQL account-access copy. Dry runs issue read-only SELECTs; apply
 * takes source/target user locks in lexical order and commits every copied asset
 * plus its audit event in one SERIALIZABLE transaction.
 */
export async function pgCopyAccountAccess(input: AccountAccessInput): Promise<AccountAccessReport> {
  if (!input.apply) return planCopy(undefined, input);
  return postgresTransaction((client) => copyInTransaction(client, input), { isolation: "SERIALIZABLE" });
}

// Existing enterprise-account repository functions remain native PostgreSQL and
// are intentionally retained because routers/enterprise.ts calls them directly.
export async function pgFindUserForLoginRows(identifier: string): Promise<Row[]> {
  return postgresQuery<Row>(
    "SELECT * FROM users WHERE active=1 AND (username=$1 OR lower(coalesce(email,''))=$2 OR lower(trim(name))=lower($3) OR ($4<>'' AND phone IS NOT NULL AND trim(phone)<>'') ) ORDER BY CASE WHEN username=$1 THEN 0 ELSE 1 END,id",
    [identifier, identifier.includes("@") ? identifier.toLowerCase() : "", identifier, /^\+?[0-9 ()-]{7,}$/.test(identifier) ? "phone" : ""],
  );
}

export async function pgSetApprovalRoles(userId: string, grants: Array<{ role: string; kind: string; validFrom?: string | null; validTo?: string | null }>, now: string): Promise<void> {
  await postgresTransaction(async (client) => {
    await client.query("DELETE FROM approval_role_bindings WHERE user_id=$1", [userId]);
    for (const grant of grants) await client.query(
      "INSERT INTO approval_role_bindings(user_id,approval_role,role_kind,valid_from,valid_to,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [userId, grant.role, grant.kind, grant.validFrom || null, grant.validTo || null, now],
    );
  });
}

export async function pgBindApprovalRole(userId: string, role: string, kind: string, now: string): Promise<void> {
  await postgresQuery("INSERT INTO approval_role_bindings(user_id,approval_role,role_kind,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [userId, role, kind, now]);
}

export async function pgUnbindApprovalRole(userId: string, role: string): Promise<void> {
  await postgresQuery("DELETE FROM approval_role_bindings WHERE user_id=$1 AND approval_role=$2", [userId, role]);
}

export async function pgUpdatePreferences(userId: string, analytics: boolean, preferences: Record<string, unknown>, now: string, defaultMailbox?: string): Promise<Row | undefined> {
  return postgresTransaction(async (client) => {
    if (defaultMailbox !== undefined) {
      await client.query("UPDATE user_starry_bindings SET is_default=0 WHERE user_id=$1", [userId]);
      if (defaultMailbox) await client.query("UPDATE user_starry_bindings SET is_default=1 WHERE user_id=$1 AND lower(mailbox_email)=lower($2)", [userId, defaultMailbox]);
    }
    const result = await client.query<Row>(
      "INSERT INTO user_preferences(user_id,analytics_cookies,preferences,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET analytics_cookies=EXCLUDED.analytics_cookies,preferences=EXCLUDED.preferences,updated_at=EXCLUDED.updated_at RETURNING *",
      [userId, analytics ? 1 : 0, JSON.stringify(preferences), now],
    );
    return result.rows[0];
  });
}
