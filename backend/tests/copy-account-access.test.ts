import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postgresDb } from "../src/postgres/access.js";
import { saveStarryBinding } from "../src/host/starry-bind.js";
import { copyAccountAccess } from "../src/runtime/account-access.js";
import { resolveSecretReference } from "../src/runtime/credentials.js";
import { freshTestDatabase } from "./support/pg.js";
import { createAgentBinding, ensureOrganizationTree, reseedOrganizationTreeFromRegistry } from "../src/runtime/organization-tree.js";
async function personUser(personRef: string): Promise<string | null> {
  const row = (await postgresDb().one("SELECT user_id FROM organization_people WHERE person_ref=$1", personRef)) as {
    user_id?: string | null;
  } | undefined;
  return row?.user_id ? String(row.user_id) : null;
}
beforeEach(async () => {
  await freshTestDatabase();
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "17".repeat(32);
  const db = postgresDb();
  await db.execute(`INSERT INTO users
    (id,username,name,password_hash,roles,brands,active,email,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, "sriphy", "sriphy", "鄢棽", "x", '["employee","admin"]', '["LT","RO","PQ"]', 1, "sriphy.yan@amperetime.com", "now", "now");
  await db.execute(`INSERT INTO users
    (id,username,name,password_hash,roles,brands,active,email,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, "usr_org_huang_qiyou", "jeffrey", "黄启友", "x", '["employee"]', "[]", 1, "jeffrey.huang@amperetime.com", "now", "now");
  (await saveStarryBinding("sriphy", {
    mailbox_email: "larry.zhao@amperetime.com",
    mailbox_id: "6",
    owner_name: "赵良玉",
    bearer: "personal-token-xyz",
  }));
  (await db.execute("INSERT INTO approval_role_bindings (user_id, approval_role, role_kind, created_at) VALUES ($1,$2,$3,$4)", "sriphy", "lead", "position", "now"));
  (await ensureOrganizationTree());
  (await reseedOrganizationTreeFromRegistry());
  (await createAgentBinding({
    agent_id: "agent:test_copy",
    target_type: "person",
    target_id: "person:yan_chen",
    company_id: "company:amperetime",
  }));
});
afterEach(async () => {
  await postgresDb().close();
  delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
});
describe("account access copy", () => {
  it("copies mailbox and permissions to the target without touching the source", async () => {
    expect((await personUser("person:yan_chen"))).toBe("sriphy");
    expect((await personUser("person:huang_qiyou"))).toBe("usr_org_huang_qiyou");
    const plan = (await copyAccountAccess({ from: "sriphy", to: "usr_org_huang_qiyou" }));
    expect(plan.applied).toBe(false);
    expect(plan.actions.some((action) => action.section === "mailbox" && action.action === "copy")).toBe(true);
    expect(((await postgresDb().one("SELECT COUNT(*) AS n FROM user_starry_bindings WHERE user_id=$1", "usr_org_huang_qiyou")) as {
      n: number;
    }).n).toBe(0);
    const report = (await copyAccountAccess({ from: "sriphy", to: "usr_org_huang_qiyou", apply: true }));
    const copied = report.actions.filter((action) => action.action === "copy");
    expect(copied.some((action) => action.section === "mailbox" && action.key === "larry.zhao@amperetime.com")).toBe(true);
    expect(copied.some((action) => action.section === "roles")).toBe(true);
    expect(copied.some((action) => action.section === "brands")).toBe(true);
    expect(copied.some((action) => action.section === "approval_role" && action.key === "lead")).toBe(true);
    expect(copied.some((action) => action.section === "agent_binding" && action.key === "agent:test_copy")).toBe(true);
    const binding = (await postgresDb().one("SELECT * FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2", "usr_org_huang_qiyou", "larry.zhao@amperetime.com")) as Record<string, unknown>;
    expect(Number(binding.is_default)).toBe(1);
    expect(String(binding.owner_name)).toBe("赵良玉");
    const sourceCredential = String(((await postgresDb().one("SELECT bearer_token FROM user_starry_bindings WHERE user_id='sriphy'")) as {
      bearer_token: string;
    }).bearer_token);
    const targetCredential = String(binding.bearer_token);
    expect(targetCredential).toMatch(/^cred_[A-Za-z0-9_-]{8,160}$/);
    expect(targetCredential).not.toBe(sourceCredential);
    expect((await resolveSecretReference(targetCredential, "usr_org_huang_qiyou"))).toBe("personal-token-xyz");
    expect((await resolveSecretReference(sourceCredential, "sriphy"))).toBe("personal-token-xyz");
    const target = (await postgresDb().one("SELECT roles,brands FROM users WHERE id='usr_org_huang_qiyou'")) as {
      roles: string;
      brands: string;
    };
    expect(JSON.parse(target.roles)).toEqual(["employee", "admin"]);
    expect(JSON.parse(target.brands)).toEqual(["LT", "RO", "PQ"]);
    expect((await postgresDb().one("SELECT 1 FROM approval_role_bindings WHERE user_id='usr_org_huang_qiyou' AND approval_role='lead'"))).toBeTruthy();
    const copiedBinding = (await postgresDb().one("SELECT status FROM agent_bindings WHERE agent_id='agent:test_copy' AND target_type='person' AND target_id='person:huang_qiyou'")) as {
      status?: string;
    } | undefined;
    expect(copiedBinding?.status).toBe("active");
    const sourceBinding = (await postgresDb().one("SELECT status FROM agent_bindings WHERE agent_id='agent:test_copy' AND target_type='person' AND target_id='person:yan_chen'")) as {
      status?: string;
    } | undefined;
    expect(sourceBinding?.status).toBe("active");
    expect((await postgresDb().one("SELECT 1 FROM audit_events WHERE event_type='account_access.copied' AND actor='cli:copy-account-access'"))).toBeTruthy();
    const second = (await copyAccountAccess({ from: "sriphy", to: "usr_org_huang_qiyou", apply: true }));
    expect(second.actions.filter((action) => action.action === "copy")).toEqual([]);
    expect(((await postgresDb().one("SELECT COUNT(*) AS n FROM user_starry_bindings WHERE user_id=$1", "usr_org_huang_qiyou")) as {
      n: number;
    }).n).toBe(1);
  });
  it("rejects unknown accounts", async () => {
    await expect(copyAccountAccess({ from: "sriphy", to: "usr_missing", apply: true })).rejects.toThrow(/账号不存在/);
  });
});
