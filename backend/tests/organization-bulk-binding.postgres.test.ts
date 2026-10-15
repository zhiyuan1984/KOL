import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresQuery } from "../src/postgres/pool.js";
import { createManagedAgent } from "../src/runtime/managed-agents.js";
import {
  applyBulkAgentBindings,
  bumpOrgVersion,
  createAgentBinding,
  listAgentBindings,
  previewBulkAgentBindings,
} from "../src/runtime/organization-tree.js";
import { freshTestDatabase } from "./support/pg.js";

const COMPANY = "company:amperetime";
const targets = [
  { target_type: "organization_unit" as const, target_id: "org:research_institute" },
  { target_type: "organization_unit" as const, target_id: "org:digital_intelligence_center" },
];

beforeEach(async () => {
  await freshTestDatabase();
  await postgresQuery(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7)`,
    ["admin:test", "admin-test", "Native Test Admin", "x", JSON.stringify(["employee", "admin"]), "[]", new Date().toISOString()],
  );
});

afterEach(async () => {
  await closePostgresPool();
});

async function createTestAgent(name: string): Promise<string> {
  return (await createManagedAgent({ name })).id;
}

describe("组织批量绑定原生 PostgreSQL CAS", () => {
  it("以锁定预览 basis 的签名和组织版本一次提交所有目标；陈旧 basis 不写入", async () => {
    const agentId = await createTestAgent("批量组织绑定 CAS");
    const preview = await previewBulkAgentBindings(agentId, targets);

    const applied = await applyBulkAgentBindings({
      agent_id: agentId,
      targets,
      expected_org_version: preview.org_version,
      preview_signature: preview.preview_signature,
      created_by: "admin:test",
      reason: "定向 PostgreSQL 测试",
    });
    expect(applied.bindings.map((row) => row.target_id).sort()).toEqual([
      "org:digital_intelligence_center",
      "org:research_institute",
    ]);
    expect((await listAgentBindings(agentId)).map((row) => row.target_id).sort()).toEqual([
      "org:digital_intelligence_center",
      "org:research_institute",
    ]);

    const staleAgentId = await createTestAgent("陈旧组织版本");
    const stale = await previewBulkAgentBindings(staleAgentId, targets);
    await bumpOrgVersion(COMPANY, "定向测试造成的组织版本变化", "test");
    await expect(applyBulkAgentBindings({
      agent_id: staleAgentId,
      targets,
      expected_org_version: stale.org_version,
      preview_signature: stale.preview_signature,
      created_by: "admin:test",
    })).rejects.toThrow("组织版本已变化，请重新预览绑定影响");
    expect(await listAgentBindings(staleAgentId)).toEqual([]);
  });

  it("任一目标在同一事务内失效时回滚整个批次，并固定未知组织公开错误", async () => {
    const agentId = await createTestAgent("批量原子回滚");
    // This fresh test database trigger fails only the second target. It proves the preceding
    // valid insert shares the apply transaction and is rolled back instead of committing alone.
    await postgresQuery(
      `CREATE OR REPLACE FUNCTION test_fail_second_bulk_binding() RETURNS trigger AS $$
       BEGIN
         IF NEW.target_id = 'person:gu_jiarui' THEN RAISE EXCEPTION 'forced batch failure'; END IF;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
    );
    await postgresQuery(
      `CREATE TRIGGER test_fail_second_bulk_binding
       BEFORE INSERT ON agent_bindings FOR EACH ROW EXECUTE FUNCTION test_fail_second_bulk_binding()`,
    );
    const atomicTargets = [
      { target_type: "organization_unit" as const, target_id: "org:research_institute" },
      { target_type: "person" as const, target_id: "person:gu_jiarui" },
    ];
    const preview = await previewBulkAgentBindings(agentId, atomicTargets);
    await expect(applyBulkAgentBindings({
      agent_id: agentId,
      targets: atomicTargets,
      expected_org_version: preview.org_version,
      preview_signature: preview.preview_signature,
      created_by: "admin:test",
    })).rejects.toThrow("forced batch failure");
    expect(await listAgentBindings(agentId)).toEqual([]);

    await expect(createAgentBinding({
      agent_id: agentId,
      target_type: "organization_unit",
      target_id: "org:not_exists",
      company_id: COMPANY,
      source: "test",
    })).rejects.toThrow("unknown organization unit: org:not_exists");
  });
});
