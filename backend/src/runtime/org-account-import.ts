import { randomBytes, scryptSync } from "node:crypto";
import { postgresTransaction } from "../postgres/pool.js";
import { ensureOrganizationTree } from "./organization-tree.js";

type Person = {
  person_ref: string; display_name: string; user_id: string | null; email: string | null; status: string;
};
type Membership = { person_ref: string; org_unit_id: string; position: string | null; relation: string; status: string };
type ImportAction = { person_ref: string; name: string; action: "create" | "link" | "update" | "skip"; reason?: string; user_id?: string };
function nowIso(): string { return new Date().toISOString(); }
function accountPasswordHash(): string {
  // A directory import never issues a shared/default credential.
  const secret = randomBytes(48).toString("base64url"); const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(secret, salt, 64).toString("base64")}`;
}
function usernameFor(person: Person): string {
  const email = String(person.email || "").trim().toLowerCase();
  return email || person.person_ref.replace(/^person:/, "").replace(/[^a-z0-9._-]/gi, "_").toLowerCase();
}

/** Registry people become ordinary active accounts; existing identity, role, active-state and credential stay intact. */
export async function importOrganizationAccounts(apply = false): Promise<ImportAction[]> {
  await ensureOrganizationTree();
  return postgresTransaction(async (client) => {
    const anyUser = (await client.query("SELECT 1 FROM users LIMIT 1 FOR KEY SHARE")).rows[0];
    if (!anyUser) throw new Error("请先完成首个管理员账号设置，再导入组织人员账号");
    const stamp = nowIso();
    const people = (await client.query<Person>("SELECT person_ref,display_name,user_id,email,status FROM organization_people WHERE status='active' ORDER BY display_name FOR UPDATE")).rows;
    const memberships = (await client.query<Membership>(`SELECT person_ref,org_unit_id,position,relation,status FROM organization_memberships
      WHERE relation='primary' AND status='active' AND (effective_from IS NULL OR effective_from <= $1) AND (effective_to IS NULL OR effective_to > $1) FOR UPDATE`, [stamp])).rows;
    const units = new Set((await client.query<{ id: string }>("SELECT id FROM organization_units WHERE status='active' FOR KEY SHARE")).rows.map((row) => row.id));
    const membershipByPerson = new Map(memberships.map((row) => [row.person_ref, row])); const actions: ImportAction[] = [];
    for (const person of people) {
      const membership = membershipByPerson.get(person.person_ref);
      if (!membership || !units.has(membership.org_unit_id)) { actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "缺少有效主组织" }); continue; }
      const username = usernameFor(person);
      if (!/^[a-z0-9._@-]{3,100}$/.test(username)) { actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "缺少有效账号标识" }); continue; }
      const linked = person.user_id ? (await client.query<{ id: string; username: string; email: string | null }>("SELECT id,username,email FROM users WHERE id=$1 FOR UPDATE", [person.user_id])).rows[0] : undefined;
      const email = String(person.email || "").trim().toLowerCase();
      const existing = linked || (email ? (await client.query<{ id: string; username: string; email: string | null }>(
        "SELECT id,username,email FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($1) LIMIT 1 FOR UPDATE", [email],
      )).rows[0] : undefined);
      const claimed = existing ? (await client.query<{ person_ref: string }>(
        "SELECT person_ref FROM organization_people WHERE user_id=$1 AND person_ref<>$2 FOR UPDATE", [existing.id, person.person_ref],
      )).rows[0] : undefined;
      if (claimed) { actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: `账号已关联 ${claimed.person_ref}` }); continue; }
      const byUsername = (await client.query<{ id: string }>("SELECT id FROM users WHERE username=$1 FOR UPDATE", [username])).rows[0];
      if (byUsername && byUsername.id !== existing?.id) { actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "账号标识已被其他账号占用" }); continue; }
      const id = existing?.id || `usr_org_${person.person_ref.replace(/^person:/, "")}`;
      const idTaken = !existing && (await client.query("SELECT 1 FROM users WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (idTaken) { actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "账号 ID 已被占用" }); continue; }
      const brands = (await client.query<{ brand_id: string | null }>("SELECT DISTINCT brand_id FROM scope_memberships WHERE subject_type='person' AND subject_id=$1 AND status='active'", [person.person_ref]))
        .rows.map((row) => String(row.brand_id || "").replace(/^brand:/, "").toUpperCase()).filter(Boolean);
      if (existing) {
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: person.user_id === id ? "update" : "link", user_id: id });
        if (apply) await client.query(`UPDATE users SET name=$1,site=$2,position=$3,email=COALESCE(NULLIF(email,''),$4),updated_at=$5 WHERE id=$6`,
          [person.display_name, membership.org_unit_id, membership.position || "", person.email || "", stamp, id]);
      } else {
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: "create", user_id: id });
        if (apply) await client.query(`INSERT INTO users
          (id,username,name,password_hash,roles,brands,site,position,active,email,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$10)`,
          [id, username, person.display_name, accountPasswordHash(), JSON.stringify(["employee"]), JSON.stringify(brands),
            membership.org_unit_id, membership.position || "", person.email || "", stamp]);
      }
      if (apply) await client.query("UPDATE organization_people SET user_id=$1,updated_at=$2 WHERE person_ref=$3", [id, stamp, person.person_ref]);
    }
    return actions;
  }, { isolation: "SERIALIZABLE" });
}
