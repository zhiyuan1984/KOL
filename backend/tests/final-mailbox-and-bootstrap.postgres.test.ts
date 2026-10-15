import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { saveStarryBinding, clearStarryBinding } from "../src/host/starry-bind.js";
import { seedAll } from "../src/seed.js";
import { freshTestDatabase } from "./support/pg.js";
import { hashPassword } from "../src/auth.js";
beforeEach(async () => {
  await freshTestDatabase();
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
  await getConn().query("INSERT INTO users(id,username,name,roles,brands,active,site,created_at,updated_at,password_hash) VALUES($1,$2,$3,$4,$5,1,$6,$7,$7,$8)", ["usr_mail_atomic","mail-atomic","合成测试员工",'["employee"]','["LT"]',"amperetime",new Date().toISOString(),await hashPassword("native-isolated-test-only!123")]);
});
afterEach(async () => { await resetConn(); });
async function injectAuditFailure(event: string): Promise<void> {
  await getConn().query(`CREATE FUNCTION reject_native_mailbox_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_type = '${event}' THEN RAISE EXCEPTION 'injected mailbox audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_native_mailbox_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_native_mailbox_audit()`);
}
async function credentialIds() { return (await getConn().query("SELECT id FROM runtime_credentials ORDER BY id")).rows; }
async function auditRows() { return (await getConn().query("SELECT id,event_type FROM audit_events ORDER BY id")).rows; }
describe("native mailbox mutation atomic audit", () => {
  it("rolls back a binding and its new credential if binding audit insert fails", async () => {
    const credentials = await credentialIds(), audit = await auditRows();
    await injectAuditFailure("starry.bind");
    await expect(saveStarryBinding("usr_mail_atomic", { mailbox_email: "atomic@example.com", bearer: "synthetic-only-token" })).rejects.toThrow(/injected mailbox audit/);
    expect((await getConn().query("SELECT mailbox_email FROM user_starry_bindings WHERE user_id=$1", ["usr_mail_atomic"])).rows).toEqual([]);
    expect(await credentialIds()).toEqual(credentials);
    expect(await auditRows()).toEqual(audit);
  });
  it("rolls back deletion, default change, credential deletion and audit on unbind audit failure", async () => {
    await saveStarryBinding("usr_mail_atomic", { mailbox_email: "atomic@example.com", bearer: "synthetic-only-token" });
    const bindings = (await getConn().query("SELECT user_id,mailbox_email,is_default,bearer_token FROM user_starry_bindings WHERE user_id=$1", ["usr_mail_atomic"])).rows;
    const credentials = await credentialIds(), audit = await auditRows();
    await injectAuditFailure("starry.unbind");
    await expect(clearStarryBinding("usr_mail_atomic", "atomic@example.com")).rejects.toThrow(/injected mailbox audit/);
    expect((await getConn().query("SELECT user_id,mailbox_email,is_default,bearer_token FROM user_starry_bindings WHERE user_id=$1", ["usr_mail_atomic"])).rows).toEqual(bindings);
    expect(await credentialIds()).toEqual(credentials);
    expect(await auditRows()).toEqual(audit);
  });
});
describe("native bootstrap never overwrites maintained facts", () => {
  it("preserves directory metadata, knowledge revision, persona and mailbox owner scope", async () => {
    const db = getConn(), now = new Date().toISOString();
    await db.query("INSERT INTO directory_users(id,handle,name,role) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role", ["sriphy","sriphy","用户维护名称","employee"]);
    await db.query("INSERT INTO knowledge(id,title,body,tags,kind,status,base_id,source_body,in_market,current_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$3,0,1,$8,$8)", ["kb_followup","维护后的标题","维护后的正文","owned","policy","draft","kbase_legacy",now]);
    await db.query("INSERT INTO knowledge_versions(id,knowledge_id,version,title,body,kind,status,created_at,note) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)", ["native_maintained_v1","kb_followup","维护后的标题","维护后的正文","policy","draft",now,"maintained"]);
    await db.query("INSERT INTO app_state(key,value) VALUES('persona','native_test_persona') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
    await db.query("INSERT INTO mailbox_owners(email,brand,owner_name,dept,account_type,status,permission_scope) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(email) DO UPDATE SET permission_scope=EXCLUDED.permission_scope", ["kol.lt@litime.example","LT","测试负责人","测试部门","personal","active","owned-test-scope"]);
    const entry = (await db.query("SELECT title,body,tags,status,current_version,created_at,updated_at FROM knowledge WHERE id=$1", ["kb_followup"])).rows[0];
    const versions = (await db.query("SELECT id,title,body,status FROM knowledge_versions WHERE knowledge_id=$1 ORDER BY id", ["kb_followup"])).rows;
    await seedAll();
    expect((await db.query("SELECT name,role FROM directory_users WHERE id=$1", ["sriphy"])).rows[0]).toEqual({ name: "用户维护名称", role: "employee" });
    expect((await db.query("SELECT title,body,tags,status,current_version,created_at,updated_at FROM knowledge WHERE id=$1", ["kb_followup"])).rows[0]).toEqual(entry);
    expect((await db.query("SELECT id,title,body,status FROM knowledge_versions WHERE knowledge_id=$1 ORDER BY id", ["kb_followup"])).rows).toEqual(versions);
    expect((await db.query("SELECT value FROM app_state WHERE key='persona'")).rows[0].value).toBe("native_test_persona");
    expect((await db.query("SELECT permission_scope FROM mailbox_owners WHERE email=$1", ["kol.lt@litime.example"])).rows[0].permission_scope).toBe("owned-test-scope");
  });
});
