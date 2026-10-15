import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";
import { isDemoAdminIdentifier, looksLikePhone, normalizeAccount, normalizeEmail, normalizePhone } from "../host/identity.js";

export async function pgFindUserForLogin(raw: string): Promise<Row | undefined> {
  const ident = String(raw || "").trim();
  if (!ident) return undefined;
  const account = normalizeAccount(ident);
  const email = ident.includes("@") ? normalizeEmail(ident) : "";
  const rows = await postgresQuery<Row>(
    `SELECT * FROM users WHERE active=1 AND (
      username=$1 OR lower(coalesce(email,''))=$2 OR lower(trim(name))=lower($3)
      OR ($4 <> '' AND phone IS NOT NULL AND trim(phone) <> '')
    ) ORDER BY CASE WHEN username=$1 THEN 0 ELSE 1 END, id`,
    [email || account, email, ident, looksLikePhone(ident) ? "phone" : ""],
  );
  const phone = looksLikePhone(ident) ? normalizePhone(ident) : "";
  const candidates = rows.filter((row) => !phone || normalizePhone(String(row.phone || "")) === phone);
  if (isDemoAdminIdentifier(ident)) {
    return candidates.find((row) => String(row.username) === "lingong" || normalizeEmail(String(row.email || "")) === normalizeEmail("qiyouhuang@163.com")) || candidates[0];
  }
  if (email || account) return candidates.find((row) => String(row.username) === (email || account)) || candidates.find((row) => normalizeEmail(String(row.email || "")) === email) || (candidates.length === 1 ? candidates[0] : undefined);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export async function pgUserCount(): Promise<number> {
  const [row] = await postgresQuery<{ n: string }>("SELECT COUNT(*)::text AS n FROM users");
  return Number(row?.n || 0);
}

export async function pgCreateUser(input: { id: string; username: string; name: string; passwordHash: string; brands: Json; site: string; email: string; phone: string; now: string; }): Promise<Row> {
  return postgresTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email,phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,$10)`,
      [input.id, input.username, input.name, input.passwordHash, JSON.stringify(["employee", "admin"]), JSON.stringify(input.brands || []), input.site, input.now, input.email, input.phone],
    );
    return (await client.query<Row>("SELECT * FROM users WHERE id=$1", [input.id])).rows[0];
  });
}

export async function pgCreateSession(idHash: string, userId: string, expiresAt: string, createdAt: string): Promise<void> {
  await postgresQuery("INSERT INTO auth_sessions (id_hash,user_id,expires_at,created_at) VALUES ($1,$2,$3,$4)", [idHash, userId, expiresAt, createdAt]);
}

export async function pgDeleteSession(idHash: string): Promise<void> {
  await postgresQuery("DELETE FROM auth_sessions WHERE id_hash=$1", [idHash]);
}

export async function pgConnectorPermissions(userId: string): Promise<Record<string, string>> {
  const rows = await postgresQuery<{ connector_id: string; access: string }>(
    "SELECT g.connector_id,g.access FROM user_connector_grants g JOIN connectors c ON c.id=g.connector_id WHERE g.user_id=$1 AND c.enabled=1",
    [userId],
  );
  return Object.fromEntries(rows.map((row) => [String(row.connector_id), String(row.access)]));
}

export async function pgDefaultBinding(userId: string): Promise<Row | undefined> {
  const [row] = await postgresQuery<Row>(
    "SELECT mailbox_email,mailbox_id,owner_name,status,bearer_token,updated_at FROM user_starry_bindings WHERE user_id=$1 AND is_default=1 ORDER BY updated_at ASC,mailbox_email ASC LIMIT 1",
    [userId],
  );
  return row;
}

/**
 * CONST-05 的唯一资格内核：只以 PostgreSQL 中当前有效的人员、成员关系、组织树、
 * Agent 发布状态和绑定为事实。它刻意不读取已废弃的 user_skill_grants，也不从
 * 管理员角色、site 字段或缓存推断资格。
 *
 * 单位绑定覆盖该单位全部下级成员，并只把资格给真实上级链中的负责人；人员绑定
 * 覆盖该人员及其所属各级单位负责人。所有成员、绑定和组织单位均在同一快照按
 * company_id 与有效期过滤，缺少权威关系时结果为空（fail closed）。
 */
export async function pgUsableAgentIdsForUser(
  userId: string,
  now: string,
  filter: { agentId?: string; skillId?: string } = {},
): Promise<string[]> {
  const rows = await postgresQuery<{ agent_id: string }>(
    `WITH RECURSIVE bindings AS (
       SELECT b.agent_id,b.target_type,b.target_id,b.company_id
       FROM agent_bindings b
       JOIN managed_agents a ON a.id=b.agent_id AND a.status='published'
       WHERE b.status='active'
         AND (b.effective_from IS NULL OR b.effective_from <= $4)
         AND (b.effective_to IS NULL OR b.effective_to > $4)
         AND ($2::text IS NULL OR b.agent_id=$2)
         AND ($3::text IS NULL OR EXISTS (
           SELECT 1 FROM runtime_agent_skills s
           WHERE s.agent_id=b.agent_id AND s.skill_id=$3 AND s.enabled=1
         ))
     ), covered_units AS (
       SELECT b.agent_id,b.company_id,u.id,u.parent_id,u.head_person_ref
       FROM bindings b JOIN organization_units u
         ON b.target_type='organization_unit' AND u.id=b.target_id
        AND u.company_id=b.company_id AND u.status='active'
       UNION
       SELECT cu.agent_id,cu.company_id,child.id,child.parent_id,child.head_person_ref
       FROM covered_units cu JOIN organization_units child
         ON child.parent_id=cu.id AND child.company_id=cu.company_id AND child.status='active'
     ), ancestor_units AS (
       SELECT b.agent_id,b.company_id,u.id,u.parent_id,u.head_person_ref
       FROM bindings b JOIN organization_units u
         ON b.target_type='organization_unit' AND u.id=b.target_id
        AND u.company_id=b.company_id AND u.status='active'
       UNION
       SELECT au.agent_id,au.company_id,parent.id,parent.parent_id,parent.head_person_ref
       FROM ancestor_units au JOIN organization_units parent
         ON parent.id=au.parent_id AND parent.company_id=au.company_id AND parent.status='active'
     ), person_binding_units AS (
       SELECT b.agent_id,b.company_id,u.id,u.parent_id,u.head_person_ref
       FROM bindings b
       JOIN organization_people bound_person
         ON b.target_type='person' AND bound_person.person_ref=b.target_id AND bound_person.status='active'
       JOIN organization_memberships bound_membership
         ON bound_membership.person_ref=bound_person.person_ref AND bound_membership.company_id=b.company_id
        AND bound_membership.status='active'
        AND (bound_membership.effective_from IS NULL OR bound_membership.effective_from <= $4)
        AND (bound_membership.effective_to IS NULL OR bound_membership.effective_to > $4)
       JOIN organization_units u
         ON u.id=bound_membership.org_unit_id AND u.company_id=b.company_id AND u.status='active'
       UNION
       SELECT pbu.agent_id,pbu.company_id,parent.id,parent.parent_id,parent.head_person_ref
       FROM person_binding_units pbu JOIN organization_units parent
         ON parent.id=pbu.parent_id AND parent.company_id=pbu.company_id AND parent.status='active'
     )
     SELECT DISTINCT b.agent_id
     FROM users account
     JOIN organization_people person ON person.user_id=account.id AND person.status='active'
     JOIN bindings b ON true
     JOIN organization_memberships membership
       ON membership.person_ref=person.person_ref AND membership.company_id=b.company_id
      AND membership.status='active'
      AND (membership.effective_from IS NULL OR membership.effective_from <= $4)
      AND (membership.effective_to IS NULL OR membership.effective_to > $4)
     LEFT JOIN covered_units covered ON covered.agent_id=b.agent_id AND covered.company_id=b.company_id
     LEFT JOIN ancestor_units ancestor ON ancestor.agent_id=b.agent_id AND ancestor.company_id=b.company_id
     LEFT JOIN person_binding_units person_ancestor ON person_ancestor.agent_id=b.agent_id AND person_ancestor.company_id=b.company_id
     WHERE account.id=$1 AND account.active=1 AND (
       (b.target_type='person' AND b.target_id=person.person_ref)
       OR (b.target_type='person' AND person.person_ref=person_ancestor.head_person_ref)
       OR (b.target_type='organization_unit' AND membership.org_unit_id=covered.id)
       OR (b.target_type='organization_unit' AND person.person_ref=covered.head_person_ref)
       OR (b.target_type='organization_unit' AND person.person_ref=ancestor.head_person_ref)
     ) ORDER BY b.agent_id`,
    [userId, filter.agentId || null, filter.skillId || null, now],
  );
  return rows.map((row) => String(row.agent_id));
}

export async function pgUserCanUseAgent(userId: string, agentId: string, now: string): Promise<boolean> {
  return (await pgUsableAgentIdsForUser(userId, now, { agentId })).length > 0;
}

export async function pgUserCanUseSkill(userId: string, skillId: string, now: string): Promise<boolean> {
  return (await pgUsableAgentIdsForUser(userId, now, { skillId })).length > 0;
}

export async function pgVisibleSkillIdsForUser(userId: string, now: string): Promise<string[]> {
  const agents = await pgUsableAgentIdsForUser(userId, now);
  if (!agents.length) return [];
  const rows = await postgresQuery<{ skill_id: string }>(
    "SELECT DISTINCT skill_id FROM runtime_agent_skills WHERE enabled=1 AND agent_id=ANY($1::text[]) ORDER BY skill_id",
    [agents],
  );
  return rows.map((row) => String(row.skill_id));
}

export async function pgApprovalRoles(userId: string, now: string): Promise<string[]> {
  const rows = await postgresQuery<{ approval_role: string }>(
    `SELECT approval_role FROM approval_role_bindings
     WHERE user_id=$1 AND (valid_from IS NULL OR valid_from <= $2)
       AND (valid_to IS NULL OR valid_to > $2)`,
    [userId, now],
  );
  return rows.map((row) => String(row.approval_role));
}

export async function pgAvatarUrlForUser(userId: string): Promise<string | null> {
  const [row] = await postgresQuery<{ avatar_url: string | null }>(
    "SELECT to_jsonb(person)->>'avatar_url' AS avatar_url FROM organization_people person WHERE user_id=$1 AND status='active' ORDER BY updated_at DESC NULLS LAST, person_ref LIMIT 1",
    [userId],
  );
  return row?.avatar_url || null;
}
export async function pgConnectorAccess(userId: string, connectorId: string): Promise<{ enabled: boolean; access: string | null }> {
  const [row] = await postgresQuery<{ enabled: boolean; access: string | null }>(
    `SELECT c.enabled, g.access FROM connectors c
     LEFT JOIN user_connector_grants g ON g.connector_id=c.id AND g.user_id=$1
     WHERE c.id=$2`,
    [userId, connectorId],
  );
  return { enabled: Boolean(row?.enabled), access: row?.access || null };
}

export async function pgAudit(actor: string, eventType: string, payload: Json, now: string): Promise<void> {
  await postgresQuery(
    "INSERT INTO audit_events (ts,actor,event_type,payload) VALUES ($1,$2,$3,$4)",
    [now, actor, eventType, JSON.stringify(payload)],
  );
}
