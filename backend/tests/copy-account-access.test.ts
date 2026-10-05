import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { saveStarryBinding } from "../src/host/starry-bind.js";
import { copyAccountAccess } from "../src/runtime/account-access.js";
import { resolveSecretReference } from "../src/runtime/credentials.js";
import { createAgentBinding, ensureOrganizationTree, reseedOrganizationTreeFromRegistry } from "../src/runtime/organization-tree.js";

let tmp = "";

function personUser(personRef: string): string | null {
  const row = getConn().prepare("SELECT user_id FROM organization_people WHERE person_ref=?").get(personRef) as
    | { user_id?: string | null }
    | undefined;
  return row?.user_id ? String(row.user_id) : null;
}

beforeEach(() => {
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "17".repeat(32);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-account-access-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, NODE_ENV: "test" });
  resetConn();
  const db = getConn();
  const insert = db.prepare(`INSERT INTO users
    (id,username,name,password_hash,roles,brands,active,email,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insert.run("sriphy", "sriphy", "鄢棽", "x", '["employee","admin"]', '["LT","RO","PQ"]', 1, "sriphy.yan@amperetime.com", "now", "now");
  insert.run("usr_org_huang_qiyou", "jeffrey", "黄启友", "x", '["employee"]', "[]", 1, "jeffrey.huang@amperetime.com", "now", "now");
  saveStarryBinding("sriphy", {
    mailbox_email: "larry.zhao@amperetime.com",
    mailbox_id: "6",
    owner_name: "赵良玉",
    bearer: "personal-token-xyz",
  });
  db.prepare("INSERT INTO approval_role_bindings (user_id, approval_role, role_kind, created_at) VALUES (?,?,?,?)")
    .run("sriphy", "lead", "position", "now");
  ensureOrganizationTree();
  reseedOrganizationTreeFromRegistry();
  createAgentBinding({
    agent_id: "agent:test_copy",
    target_type: "person",
    target_id: "person:yan_chen",
    company_id: "company:amperetime",
  });
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "NODE_ENV", "RUNTIME_CREDENTIAL_MASTER_KEY"]) {
    delete process.env[key];
  }
});

describe("account access copy", () => {
  it("copies mailbox and permissions to the target without touching the source", () => {
    expect(personUser("person:yan_chen")).toBe("sriphy");
    expect(personUser("person:huang_qiyou")).toBe("usr_org_huang_qiyou");

    const plan = copyAccountAccess({ from: "sriphy", to: "usr_org_huang_qiyou" });
    expect(plan.applied).toBe(false);
    expect(plan.actions.some((action) => action.section === "mailbox" && action.action === "copy")).toBe(true);
    expect(
      (getConn().prepare("SELECT COUNT(*) AS n FROM user_starry_bindings WHERE user_id=?").get("usr_org_huang_qiyou") as { n: number }).n,
    ).toBe(0);

    const report = copyAccountAccess({ from: "sriphy", to: "usr_org_huang_qiyou", apply: true });
    const copied = report.actions.filter((action) => action.action === "copy");
    expect(copied.some((action) => action.section === "mailbox" && action.key === "larry.zhao@amperetime.com")).toBe(true);
    expect(copied.some((action) => action.section === "roles")).toBe(true);
    expect(copied.some((action) => action.section === "brands")).toBe(true);
    expect(copied.some((action) => action.section === "approval_role" && action.key === "lead")).toBe(true);
    expect(copied.some((action) => action.section === "agent_binding" && action.key === "agent:test_copy")).toBe(true);

    const binding = getConn().prepare(
      "SELECT * FROM user_starry_bindings WHERE user_id=? AND mailbox_email=?",
    ).get("usr_org_huang_qiyou", "larry.zhao@amperetime.com") as Record<string, unknown>;
    expect(Number(binding.is_default)).toBe(1);
    expect(String(binding.owner_name)).toBe("赵良玉");
    const sourceCredential = String(
      (getConn().prepare("SELECT bearer_token FROM user_starry_bindings WHERE user_id='sriphy'").get() as { bearer_token: string }).bearer_token,
    );
    const targetCredential = String(binding.bearer_token);
    expect(targetCredential).toMatch(/^cred_[A-Za-z0-9_-]{8,160}$/);
    expect(targetCredential).not.toBe(sourceCredential);
    expect(resolveSecretReference(targetCredential, "usr_org_huang_qiyou")).toBe("personal-token-xyz");
    expect(resolveSecretReference(sourceCredential, "sriphy")).toBe("personal-token-xyz");

    const target = getConn().prepare("SELECT roles,brands FROM users WHERE id='usr_org_huang_qiyou'").get() as {
      roles: string;
      brands: string;
    };
    expect(JSON.parse(target.roles)).toEqual(["employee", "admin"]);
    expect(JSON.parse(target.brands)).toEqual(["LT", "RO", "PQ"]);

    expect(
      getConn().prepare("SELECT 1 FROM approval_role_bindings WHERE user_id='usr_org_huang_qiyou' AND approval_role='lead'").get(),
    ).toBeTruthy();

    const copiedBinding = getConn().prepare(
      "SELECT status FROM agent_bindings WHERE agent_id='agent:test_copy' AND target_type='person' AND target_id='person:huang_qiyou'",
    ).get() as { status?: string } | undefined;
    expect(copiedBinding?.status).toBe("active");
    const sourceBinding = getConn().prepare(
      "SELECT status FROM agent_bindings WHERE agent_id='agent:test_copy' AND target_type='person' AND target_id='person:yan_chen'",
    ).get() as { status?: string } | undefined;
    expect(sourceBinding?.status).toBe("active");

    expect(
      getConn().prepare("SELECT 1 FROM audit_events WHERE event_type='account_access.copied' AND actor='cli:copy-account-access'").get(),
    ).toBeTruthy();

    const second = copyAccountAccess({ from: "sriphy", to: "usr_org_huang_qiyou", apply: true });
    expect(second.actions.filter((action) => action.action === "copy")).toEqual([]);
    expect(
      (getConn().prepare("SELECT COUNT(*) AS n FROM user_starry_bindings WHERE user_id=?").get("usr_org_huang_qiyou") as { n: number }).n,
    ).toBe(1);
  });

  it("rejects unknown accounts", () => {
    expect(() => copyAccountAccess({ from: "sriphy", to: "usr_missing", apply: true })).toThrow(/账号不存在/);
  });
});
