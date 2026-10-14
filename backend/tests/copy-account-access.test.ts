import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptRuntimeCredential, reencryptRuntimeCredential, type RuntimeCredentialCipherRecord } from "../src/runtime/credentials.js";
import { postgresQuery } from "../src/postgres/pool.js";
import { copyAccountAccess } from "../src/runtime/account-access.js";
import { freshTestDatabase } from "./support/pg.js";

const FROM = "user:source";
const TO = "user:target";
const FROM_PERSON = "person:source";
const TO_PERSON = "person:target";
const COMPANY = "company:acme";
const NOW = "2026-01-15T00:00:00.000Z";

async function sql(statement: string, values: readonly unknown[] = []): Promise<void> {
  await postgresQuery(statement, values);
}

async function scalar(statement: string, values: readonly unknown[] = []): Promise<number> {
  const [row] = await postgresQuery<{ n: number | string }>(statement, values);
  return Number(row?.n || 0);
}

async function credential(id: string, ownerUserId: string, secret: string): Promise<void> {
  const encrypted = encryptRuntimeCredential(id, ownerUserId, secret);
  await sql(
    `INSERT INTO runtime_credentials
      (id,type,owner_user_id,label,purpose,status,ciphertext,nonce,auth_tag,key_version,version,created_by,created_at,updated_at)
     VALUES($1,'user_account',$2,'Starry mailbox','Starry mailbox authentication','active',$3,$4,$5,1,1,'test',$6,$6)`,
    [id, ownerUserId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, NOW],
  );
}

async function seedBase(): Promise<void> {
  await sql(`INSERT INTO users(id,username,name,password_hash,roles,brands,active,created_at,updated_at,email)
    VALUES($1,'source','来源用户','x','["employee","admin"]','["LT","RO"]',1,$3,$3,'source@example.test'),
          ($2,'target','目标用户','x','["employee"]','["PQ"]',1,$3,$3,'target@example.test')`, [FROM, TO, NOW]);
  await sql("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('connector:mail','Mailbox',1,'configured',$1)", [NOW]);
  await sql("INSERT INTO organization_people(person_ref,display_name,user_id,status,created_at,updated_at) VALUES($1,'来源人员',$2,'active',$3,$3),($4,'目标人员',$5,'active',$3,$3)", [FROM_PERSON, FROM, NOW, TO_PERSON, TO]);
  await sql("INSERT INTO org_versions(company_id,version,effective_at,note,source,created_at) VALUES($1,1,$2,'test','test',$2)", [COMPANY, NOW]);
  await sql("INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,status,effective_from,created_at,updated_at) VALUES('membership:source',$1,$2,'unit:acme','active',$3,$3,$3),('membership:target',$4,$2,'unit:acme','active',$3,$3,$3)", [FROM_PERSON, COMPANY, NOW, TO_PERSON]);
  await credential("cred_source_mailbox", FROM, "test-only-source-token");
  await sql(`INSERT INTO user_starry_bindings
    (user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at,sync_cursor_at,sync_cursor_id,sync_page_no,synced_at)
    VALUES($1,'source.mailbox@example.test',1,'mailbox-source','Source Owner','cred_source_mailbox','connected',$2,'cursor-at','cursor-id',4,'synced-at')`, [FROM, NOW]);
  await sql("INSERT INTO approval_role_bindings(user_id,approval_role,role_kind,valid_from,valid_to,created_at) VALUES($1,'lead','named',$2,'2026-12-31T00:00:00.000Z',$2)", [FROM, NOW]);
  await sql("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES($1,'connector:mail','write',$2)", [FROM, NOW]);
  await sql("INSERT INTO user_skill_grants(user_id,skill_id,created_at) VALUES($1,'skill:only-source',$2)", [FROM, NOW]);
  await sql(`INSERT INTO agent_bindings
    (id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_by,reason,effective_from,effective_to,source,created_at,updated_at)
    VALUES('binding:agent:mail:person:source','agent:mail','person',$1,$2,'active',1,1,'test','test',$3,'2026-12-31T00:00:00.000Z','test',$3,$3)`, [FROM_PERSON, COMPANY, NOW]);
}

beforeEach(async () => {
  await freshTestDatabase();
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "17".repeat(32);
  await seedBase();
});

afterEach(() => {
  delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
});

describe("account access copy (native PostgreSQL)", () => {
  it("dry-run 零写入；apply 原子复制、按目标 owner 重加密且来源不变", async () => {
    const plan = await copyAccountAccess({ from: FROM, to: TO });
    expect(plan.applied).toBe(false);
    expect(plan.actions.some((action) => action.section === "mailbox" && action.action === "copy")).toBe(true);
    expect(await scalar("SELECT COUNT(*) AS n FROM user_starry_bindings WHERE user_id=$1", [TO])).toBe(0);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='account_access.copied'")).toBe(0);

    const report = await copyAccountAccess({ from: FROM, to: TO, apply: true, actor: "test:copy" });
    expect(report.applied).toBe(true);
    expect(report.actions.filter((action) => action.action === "copy").map((action) => action.section)).toEqual(expect.arrayContaining([
      "mailbox", "roles", "brands", "approval_role", "connector_grant", "skill_grant", "agent_binding",
    ]));

    const [targetBinding] = await postgresQuery<{ bearer_token: string; is_default: number | string; sync_page_no: number | string; sync_cursor_id: string | null }>(
      "SELECT bearer_token,is_default,sync_page_no,sync_cursor_id FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2",
      [TO, "source.mailbox@example.test"],
    );
    expect(targetBinding.bearer_token).toMatch(/^cred_[A-Za-z0-9_-]{8,160}$/);
    expect(targetBinding.bearer_token).not.toBe("cred_source_mailbox");
    expect(Number(targetBinding.is_default)).toBe(1);
    expect(Number(targetBinding.sync_page_no)).toBe(4);
    expect(targetBinding.sync_cursor_id).toBe("cursor-id");

    const credentialRows = await postgresQuery<RuntimeCredentialCipherRecord & { owner_user_id: string }>(
      "SELECT id,owner_user_id,ciphertext,nonce,auth_tag FROM runtime_credentials WHERE id = ANY($1::text[])",
      [["cred_source_mailbox", targetBinding.bearer_token]],
    );
    const sourceCredential = credentialRows.find((row) => row.id === "cred_source_mailbox");
    const targetCredential = credentialRows.find((row) => row.id === targetBinding.bearer_token);
    expect(sourceCredential?.owner_user_id).toBe(FROM);
    expect(targetCredential?.owner_user_id).toBe(TO);
    if (!sourceCredential || !targetCredential) throw new Error("test fixture credential rows missing");
    expect(targetCredential.ciphertext).not.toBe(sourceCredential.ciphertext);
    expect(targetCredential.nonce).not.toBe(sourceCredential.nonce);
    // 只验证可解密/再加密，不把秘密值写到日志、审计或测试输出。
    expect(() => reencryptRuntimeCredential(targetCredential, "cred_verification_copy", TO)).not.toThrow();

    const [targetUser] = await postgresQuery<{ roles: string; brands: string }>("SELECT roles,brands FROM users WHERE id=$1", [TO]);
    expect(JSON.parse(targetUser.roles)).toEqual(["employee", "admin"]);
    expect(JSON.parse(targetUser.brands)).toEqual(["LT", "RO", "PQ"]);
    const [approval] = await postgresQuery<{ role_kind: string; valid_to: string | null }>("SELECT role_kind,valid_to FROM approval_role_bindings WHERE user_id=$1 AND approval_role='lead'", [TO]);
    expect(approval).toEqual({ role_kind: "named", valid_to: "2026-12-31T00:00:00.000Z" });
    expect(await scalar("SELECT COUNT(*) AS n FROM user_connector_grants WHERE user_id=$1 AND connector_id='connector:mail' AND access='write'", [TO])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM user_skill_grants WHERE user_id=$1 AND skill_id='skill:only-source'", [TO])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM user_skill_grants WHERE user_id=$1 AND skill_id='*'", [TO])).toBe(0);
    expect(await scalar("SELECT COUNT(*) AS n FROM agent_bindings WHERE agent_id='agent:mail' AND target_type='person' AND target_id=$1 AND company_id=$2 AND status='active'", [TO_PERSON, COMPANY])).toBe(1);

    const [sourceBinding] = await postgresQuery<{ bearer_token: string; sync_page_no: number | string }>("SELECT bearer_token,sync_page_no FROM user_starry_bindings WHERE user_id=$1", [FROM]);
    expect(sourceBinding.bearer_token).toBe("cred_source_mailbox");
    expect(Number(sourceBinding.sync_page_no)).toBe(4);
    const [audit] = await postgresQuery<{ payload: string }>("SELECT payload FROM audit_events WHERE event_type='account_access.copied'");
    expect(audit.payload).not.toContain("test-only-source-token");
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='account_access.copied'")).toBe(1);
  });

  it("重复 apply 与双 worker 并发仅复制一次，不新增重复审计", async () => {
    const [first, second] = await Promise.all([
      copyAccountAccess({ from: FROM, to: TO, apply: true, actor: "test:worker-a" }),
      copyAccountAccess({ from: FROM, to: TO, apply: true, actor: "test:worker-b" }),
    ]);
    expect([first, second].filter((report) => report.actions.some((action) => action.action === "copy"))).toHaveLength(1);
    const repeat = await copyAccountAccess({ from: FROM, to: TO, apply: true, actor: "test:repeat" });
    expect(repeat.actions.filter((action) => action.action === "copy")).toEqual([]);
    expect(await scalar("SELECT COUNT(*) AS n FROM user_starry_bindings WHERE user_id=$1", [TO])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM runtime_credentials WHERE owner_user_id=$1", [TO])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM approval_role_bindings WHERE user_id=$1", [TO])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM user_connector_grants WHERE user_id=$1", [TO])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM user_skill_grants WHERE user_id=$1", [TO])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM agent_bindings WHERE target_id=$1 AND status='active'", [TO_PERSON])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='account_access.copied'")).toBe(1);
  });

  it("后续无效来源凭据导致整个 apply rollback", async () => {
    await sql(`INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at)
      VALUES($1,'z-invalid@example.test',0,'bad','Bad','cred_missing_source','connected',$2)`, [FROM, NOW]);
    await expect(copyAccountAccess({ from: FROM, to: TO, apply: true })).rejects.toThrow(/来源邮箱凭据不可用/);
    expect(await scalar("SELECT COUNT(*) AS n FROM user_starry_bindings WHERE user_id=$1", [TO])).toBe(0);
    expect(await scalar("SELECT COUNT(*) AS n FROM runtime_credentials WHERE owner_user_id=$1", [TO])).toBe(0);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='account_access.copied'")).toBe(0);
    const [target] = await postgresQuery<{ roles: string; brands: string }>("SELECT roles,brands FROM users WHERE id=$1", [TO]);
    expect(target).toEqual({ roles: "[\"employee\"]", brands: "[\"PQ\"]" });
  });

  it("目标人员不在来源公司有效租户范围时不复制 Agent 绑定", async () => {
    await sql("UPDATE organization_memberships SET status='ended' WHERE person_ref=$1 AND company_id=$2", [TO_PERSON, COMPANY]);
    const report = await copyAccountAccess({ from: FROM, to: TO, apply: true });
    expect(report.actions).toContainEqual(expect.objectContaining({ section: "agent_binding", action: "skip", key: "agent:mail" }));
    expect(await scalar("SELECT COUNT(*) AS n FROM agent_bindings WHERE target_id=$1 AND agent_id='agent:mail'", [TO_PERSON])).toBe(0);
  });

  it("拒绝不存在或停用的账号", async () => {
    await expect(copyAccountAccess({ from: FROM, to: "user:missing", apply: true })).rejects.toThrow(/账号不存在/);
    await sql("UPDATE users SET active=0 WHERE id=$1", [TO]);
    await expect(copyAccountAccess({ from: FROM, to: TO, apply: true })).rejects.toThrow(/账号未启用/);
  });
});
