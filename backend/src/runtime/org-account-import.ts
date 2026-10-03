import { randomBytes, scryptSync } from "node:crypto";
import { getConn, nowIso, type SqliteConn } from "../db.js";
import { listOrganizationMemberships, listOrganizationPeople, listOrganizationUnits } from "./organization-tree.js";

type Person = ReturnType<typeof listOrganizationPeople>[number];
type ImportAction = { person_ref: string; name: string; action: "create" | "link" | "update" | "skip"; reason?: string; user_id?: string };

function accountPasswordHash(): string {
  // No shared/default credential is issued by a directory import.
  const secret = randomBytes(48).toString("base64url");
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(secret, salt, 64).toString("base64")}`;
}

function usernameFor(person: Person): string {
  const email = String(person.email || "").trim().toLowerCase();
  if (email) return email;
  return person.person_ref.replace(/^person:/, "").replace(/[^a-z0-9._-]/gi, "_").toLowerCase();
}

function userFor(db: SqliteConn, person: Person) {
  const linked = person.user_id
    ? db.prepare("SELECT id,username,email FROM users WHERE id=?").get(person.user_id) as { id: string; username: string; email: string | null } | undefined
    : undefined;
  if (linked) return linked;
  const email = String(person.email || "").trim().toLowerCase();
  if (!email) return undefined;
  return db.prepare("SELECT id,username,email FROM users WHERE lower(email)=? OR lower(username)=?")
    .get(email, email) as { id: string; username: string; email: string | null } | undefined;
}

/** Registry people become ordinary active accounts; existing account identity and credentials are preserved. */
export function importOrganizationAccounts(apply = false): ImportAction[] {
  const db = getConn();
  if (!db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
    throw new Error("请先完成首个管理员账号设置，再导入组织人员账号");
  }
  const people = listOrganizationPeople().filter((person) => person.status === "active");
  const memberships = listOrganizationMemberships().filter((row) => row.relation === "primary" && row.status === "active");
  const units = new Set(listOrganizationUnits().filter((unit) => unit.status === "active").map((unit) => unit.id));
  const membershipByPerson = new Map(memberships.map((row) => [row.person_ref, row]));
  const actions: ImportAction[] = [];
  const stamp = nowIso();

  db.exec("BEGIN");
  try {
    for (const person of people) {
      const membership = membershipByPerson.get(person.person_ref);
      if (!membership || !units.has(membership.org_unit_id)) {
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "缺少有效主组织" });
        continue;
      }
      const username = usernameFor(person);
      if (!/^[a-z0-9._@-]{3,100}$/.test(username)) {
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "缺少有效账号标识" });
        continue;
      }
      const existing = userFor(db, person);
      const claimed = db.prepare("SELECT person_ref FROM organization_people WHERE user_id=? AND person_ref<>?")
        .get(existing?.id || "", person.person_ref) as { person_ref: string } | undefined;
      if (claimed) {
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: `账号已关联 ${claimed.person_ref}` });
        continue;
      }
      const byUsername = db.prepare("SELECT id FROM users WHERE username=?")
        .get(username) as { id: string } | undefined;
      if (byUsername && byUsername.id !== existing?.id) {
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "账号标识已被其他账号占用" });
        continue;
      }
      const id = existing?.id || `usr_org_${person.person_ref.replace(/^person:/, "")}`;
      const idTaken = !existing && db.prepare("SELECT 1 FROM users WHERE id=?").get(id);
      if (idTaken) {
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: "skip", reason: "账号 ID 已被占用" });
        continue;
      }
      const brands = (db.prepare("SELECT DISTINCT brand_id FROM scope_memberships WHERE subject_type='person' AND subject_id=? AND status='active'")
        .all(person.person_ref) as Array<{ brand_id: string }>).map((row) => row.brand_id.replace(/^brand:/, "").toUpperCase());
      if (existing) {
        // Keep existing roles, username, password, active state, and explicit brand grants.
        db.prepare("UPDATE users SET name=?,site=?,position=?,email=COALESCE(NULLIF(email,''),?),updated_at=? WHERE id=?")
          .run(person.display_name, membership.org_unit_id, membership.position || "", person.email || "", stamp, id);
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: person.user_id === id ? "update" : "link", user_id: id });
      } else {
        db.prepare(`INSERT INTO users
          (id,username,name,password_hash,roles,brands,site,position,active,email,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, username, person.display_name, accountPasswordHash(), JSON.stringify(["employee"]), JSON.stringify(brands),
          membership.org_unit_id, membership.position || "", 1, person.email || "", stamp, stamp,
        );
        actions.push({ person_ref: person.person_ref, name: person.display_name, action: "create", user_id: id });
      }
      db.prepare("UPDATE organization_people SET user_id=?,updated_at=? WHERE person_ref=?").run(id, stamp, person.person_ref);
    }
    db.exec(apply ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return actions;
}
