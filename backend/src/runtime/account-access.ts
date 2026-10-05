/**
 * 账号访问资产复制（2026-10-05，user-confirmed）：登录账户从鄢棽（sriphy）切换为黄启友
 * （usr_org_huang_qiyou）时，把来源账号的邮箱绑定与权限复制给目标账号；来源侧保持不动。
 *
 * 复制内容：user_starry_bindings（个人保险柜凭据为目标账号新建持密副本——user_account 凭据按
 * owner 校验，不能跨账号共用；源凭据不动、不删除，分页游标一并复制）、users.roles/brands 并集、
 * approval_role_bindings、user_connector_grants、user_skill_grants、以来源人员为目标的
 * active agent_bindings（为目标人员建同款绑定，走 createAgentBinding 的版本与唯一约束）。
 *
 * 幂等：重复执行只跳过已存在的项。默认只报告（不写库），apply 为 true 才写库并记审计。
 * 不做：不复制会话/工单/记忆等个人工作数据，不改远端 Starry 授权，不触发任何外发动作。
 */
import { audit, getConn, nowIso } from "../db.js";
import { saveStarryBinding } from "../host/starry-bind.js";
import { resolveSecretReference } from "./credentials.js";
import { createAgentBinding } from "./organization-tree.js";
import type { Row } from "../types.js";

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

export type AccountAccessReport = {
  applied: boolean;
  from: { id: string; name: string; username: string };
  to: { id: string; name: string; username: string };
  from_person: string | null;
  to_person: string | null;
  actions: AccountAccessAction[];
};

export type AccountAccessInput = {
  from: string;
  to: string;
  apply?: boolean;
  actor?: string;
};

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function userRow(id: string): Row | undefined {
  return getConn().prepare("SELECT id,username,name,roles,brands,active FROM users WHERE id=?").get(id) as Row | undefined;
}

function personRef(userId: string): string | null {
  const row = getConn().prepare("SELECT person_ref FROM organization_people WHERE user_id=?").get(userId) as
    | { person_ref?: string }
    | undefined;
  return row?.person_ref ? String(row.person_ref) : null;
}

export function copyAccountAccess(input: AccountAccessInput): AccountAccessReport {
  const db = getConn();
  const fromId = String(input.from || "").trim();
  const toId = String(input.to || "").trim();
  const apply = Boolean(input.apply);
  if (!fromId || !toId) throw new Error("copyAccountAccess 需要 from 与 to 两个账号 id");
  if (fromId === toId) throw new Error("来源与目标账号相同，无需复制");

  const from = userRow(fromId);
  const to = userRow(toId);
  if (!from || !to) {
    throw new Error(`账号不存在：${!from ? fromId : toId}。请先完成组织人员账号导入。`);
  }
  if (Number(from.active) !== 1 || Number(to.active) !== 1) {
    throw new Error(`账号未启用：from active=${from.active}，to active=${to.active}`);
  }

  const fromPerson = personRef(fromId);
  const toPerson = personRef(toId);
  const stamp = nowIso();
  const actions: AccountAccessAction[] = [];

  // 邮箱绑定：缺什么复制什么；凭据为目标账号新建副本，游标一并复制。
  const fromBindings = db.prepare(
    "SELECT * FROM user_starry_bindings WHERE user_id=? ORDER BY is_default DESC, updated_at ASC, mailbox_email ASC",
  ).all(fromId) as Row[];
  const toMailboxes = new Set(
    (db.prepare("SELECT mailbox_email FROM user_starry_bindings WHERE user_id=?").all(toId) as Row[])
      .map((row) => String(row.mailbox_email || "")),
  );
  for (const binding of fromBindings) {
    const mailbox = String(binding.mailbox_email || "");
    const detail = `默认=${Number(binding.is_default || 0) === 1 ? "是" : "否"}，状态=${String(binding.status || "")}`;
    if (!mailbox || toMailboxes.has(mailbox)) {
      actions.push({ section: "mailbox", action: "skip", key: mailbox, detail: "目标账号已绑定" });
      continue;
    }
    if (apply) {
      const reference = String(binding.bearer_token || "").trim();
      const secret = reference ? resolveSecretReference(reference, fromId) : "";
      saveStarryBinding(toId, {
        mailbox_email: mailbox,
        mailbox_id: String(binding.mailbox_id || ""),
        owner_name: String(binding.owner_name || ""),
        bearer: secret,
        status: String(binding.status || "connected") === "expired" ? "expired" : "connected",
      });
      db.prepare(
        "UPDATE user_starry_bindings SET sync_cursor_at=?,sync_cursor_id=?,sync_page_no=?,synced_at=? WHERE user_id=? AND mailbox_email=?",
      ).run(
        binding.sync_cursor_at ?? null,
        binding.sync_cursor_id ?? null,
        Number(binding.sync_page_no ?? 1),
        binding.synced_at ?? null,
        toId,
        mailbox,
      );
    }
    actions.push({ section: "mailbox", action: "copy", key: mailbox, detail });
  }

  // 角色与品牌：求并集（来源在前），有变化才写。
  const fromRoles = jsonArray(from.roles);
  const toRoles = jsonArray(to.roles);
  const nextRoles = [...fromRoles, ...toRoles.filter((role) => !fromRoles.includes(role))];
  if (JSON.stringify(nextRoles) !== JSON.stringify(toRoles)) {
    if (apply) db.prepare("UPDATE users SET roles=?, updated_at=? WHERE id=?").run(JSON.stringify(nextRoles), stamp, toId);
    actions.push({ section: "roles", action: "copy", key: JSON.stringify(nextRoles), detail: `${JSON.stringify(toRoles)} → ${JSON.stringify(nextRoles)}` });
  } else {
    actions.push({ section: "roles", action: "skip", key: JSON.stringify(toRoles), detail: "已一致" });
  }
  const fromBrands = jsonArray(from.brands);
  const toBrands = jsonArray(to.brands);
  const nextBrands = [...fromBrands, ...toBrands.filter((brand) => !fromBrands.includes(brand))];
  if (JSON.stringify(nextBrands) !== JSON.stringify(toBrands)) {
    if (apply) db.prepare("UPDATE users SET brands=?, updated_at=? WHERE id=?").run(JSON.stringify(nextBrands), stamp, toId);
    actions.push({ section: "brands", action: "copy", key: JSON.stringify(nextBrands), detail: `${JSON.stringify(toBrands)} → ${JSON.stringify(nextBrands)}` });
  } else {
    actions.push({ section: "brands", action: "skip", key: JSON.stringify(toBrands), detail: "已一致" });
  }

  // 审批角色 / 连接器授权 / 技能个人授权：逐行复制。
  const fromApprovals = db.prepare(
    "SELECT approval_role, role_kind, valid_from, valid_to FROM approval_role_bindings WHERE user_id=?",
  ).all(fromId) as Row[];
  const toApprovalRoles = new Set(
    (db.prepare("SELECT approval_role FROM approval_role_bindings WHERE user_id=?").all(toId) as Row[])
      .map((row) => String(row.approval_role || "")),
  );
  for (const row of fromApprovals) {
    const role = String(row.approval_role || "");
    if (toApprovalRoles.has(role)) {
      actions.push({ section: "approval_role", action: "skip", key: role, detail: "目标账号已有" });
      continue;
    }
    if (apply) {
      db.prepare(
        "INSERT OR IGNORE INTO approval_role_bindings (user_id, approval_role, role_kind, valid_from, valid_to, created_at) VALUES (?,?,?,?,?,?)",
      ).run(toId, role, String(row.role_kind || "position"), row.valid_from ?? null, row.valid_to ?? null, stamp);
    }
    actions.push({ section: "approval_role", action: "copy", key: role });
  }

  const fromConnectorGrants = db.prepare(
    "SELECT connector_id, access FROM user_connector_grants WHERE user_id=?",
  ).all(fromId) as Row[];
  const toConnectors = new Set(
    (db.prepare("SELECT connector_id FROM user_connector_grants WHERE user_id=?").all(toId) as Row[])
      .map((row) => String(row.connector_id || "")),
  );
  for (const row of fromConnectorGrants) {
    const connectorId = String(row.connector_id || "");
    if (toConnectors.has(connectorId)) {
      actions.push({ section: "connector_grant", action: "skip", key: connectorId, detail: "目标账号已有" });
      continue;
    }
    if (apply) {
      db.prepare(
        "INSERT OR IGNORE INTO user_connector_grants (user_id, connector_id, access, created_at) VALUES (?,?,?,?)",
      ).run(toId, connectorId, String(row.access || "read"), stamp);
    }
    actions.push({ section: "connector_grant", action: "copy", key: connectorId, detail: String(row.access || "read") });
  }

  const fromSkillGrants = db.prepare("SELECT skill_id FROM user_skill_grants WHERE user_id=?").all(fromId) as Row[];
  const toSkills = new Set(
    (db.prepare("SELECT skill_id FROM user_skill_grants WHERE user_id=?").all(toId) as Row[])
      .map((row) => String(row.skill_id || "")),
  );
  for (const row of fromSkillGrants) {
    const skillId = String(row.skill_id || "");
    if (toSkills.has(skillId)) {
      actions.push({ section: "skill_grant", action: "skip", key: skillId, detail: "目标账号已有" });
      continue;
    }
    if (apply) {
      db.prepare("INSERT OR IGNORE INTO user_skill_grants (user_id, skill_id, created_at) VALUES (?,?,?)")
        .run(toId, skillId, stamp);
    }
    actions.push({ section: "skill_grant", action: "copy", key: skillId });
  }

  // Agent 使用绑定：以来源人员为目标的 active 绑定，为目标人员建同款。
  if (fromPerson && toPerson) {
    const fromAgentBindings = db.prepare(
      "SELECT agent_id, company_id FROM agent_bindings WHERE status='active' AND target_type='person' AND target_id=? ORDER BY agent_id",
    ).all(fromPerson) as Row[];
    const toAgentIds = new Set(
      (db.prepare(
        "SELECT agent_id FROM agent_bindings WHERE status='active' AND target_type='person' AND target_id=?",
      ).all(toPerson) as Row[]).map((row) => String(row.agent_id || "")),
    );
    for (const row of fromAgentBindings) {
      const agentId = String(row.agent_id || "");
      if (toAgentIds.has(agentId)) {
        actions.push({ section: "agent_binding", action: "skip", key: agentId, detail: "目标人员已有" });
        continue;
      }
      if (apply) {
        createAgentBinding({
          agent_id: agentId,
          target_type: "person",
          target_id: toPerson,
          company_id: String(row.company_id),
          created_by: String(input.actor || "cli:copy-account-access"),
          reason: ACCOUNT_ACCESS_REASON,
          source: ACCOUNT_ACCESS_SOURCE,
        });
      }
      actions.push({ section: "agent_binding", action: "copy", key: agentId, detail: `→ ${toPerson}` });
    }
  } else {
    actions.push({
      section: "agent_binding",
      action: "skip",
      key: fromPerson || toPerson || "",
      detail: "人员锚点缺失（organization_people.user_id），跳过 Agent 绑定复制",
    });
  }

  if (apply) {
    audit(String(input.actor || "cli:copy-account-access"), "account_access.copied", {
      from: fromId,
      to: toId,
      from_person: fromPerson,
      to_person: toPerson,
      actions,
      source: ACCOUNT_ACCESS_SOURCE,
    });
  }

  return {
    applied: apply,
    from: { id: fromId, name: String(from.name || ""), username: String(from.username || "") },
    to: { id: toId, name: String(to.name || ""), username: String(to.username || "") },
    from_person: fromPerson,
    to_person: toPerson,
    actions,
  };
}
