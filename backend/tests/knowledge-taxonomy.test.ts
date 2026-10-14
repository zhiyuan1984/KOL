import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseEngine, postgresDb, type PgRepository } from "../src/postgres/access.js";
import { knowledgeKindSpec, resetKnowledgeKindsCache, validateStructuredFields } from "../src/knowledge-kinds.js";
import type { Row } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
let db: PgRepository;
beforeEach(async () => {
  await freshTestDatabase();
  db = postgresDb();
  resetKnowledgeKindsCache();
});
afterEach(async () => {
  resetKnowledgeKindsCache();
  await db.close();
});
describe("knowledge taxonomy (PostgreSQL)", () => {
  it("keeps the authoritative default family/domain/base and accepts compatible legacy material with its backfills", async () => {
    expect(databaseEngine()).toBe("postgres");
    const family = await db.one("SELECT * FROM knowledge_domains WHERE code=$1", "uncategorized") as Row | undefined;
    expect(family).toBeTruthy();
    expect(String(family!.level)).toBe("family");
    const domain = await db.one("SELECT * FROM knowledge_domains WHERE code=$1", "legacy") as Row | undefined;
    expect(domain).toBeTruthy();
    expect(String(domain!.level)).toBe("domain");
    expect(String(domain!.parent_id)).toBe("kdom_uncategorized");
    const base = await db.one("SELECT * FROM knowledge_bases WHERE code=$1", "legacy") as Row | undefined;
    expect(base).toBeTruthy();
    expect(String(base!.kind)).toBe("structured");
    const now = new Date().toISOString();
    await db.execute(`INSERT INTO knowledge
          (id,title,body,tags,in_market,kind,status,current_version,created_at,updated_at,base_id,source_body)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, "k_legacy_1", "历史制度", "正文", "extracted", 1, "policy", "published", 1, now, now, "kbase_legacy", "正文");
    await db.execute(`INSERT INTO knowledge_versions
          (id,knowledge_id,version,title,body,kind,status,tags,in_market,base_id,source_body,created_at,note)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, "kv_1", "k_legacy_1", 1, "历史制度", "正文", "policy", "published", "extracted", 1, "kbase_legacy", "正文", now, "create");
    const row = await db.one("SELECT base_id, source_body, structured FROM knowledge WHERE id=$1", "k_legacy_1") as Row;
    expect(String(row.base_id)).toBe("kbase_legacy");
    expect(String(row.source_body)).toBe("正文");
    expect(row.structured).toBeNull();
    const version = await db.one("SELECT tags, in_market, base_id, source_body FROM knowledge_versions WHERE id=$1", "kv_1") as Row;
    expect(String(version.tags)).toBe("extracted");
    expect(Number(version.in_market)).toBe(1);
    expect(String(version.base_id)).toBe("kbase_legacy");
    expect(String(version.source_body)).toBe("正文");
  });
  it("validates structured fields against config/knowledge-kinds.yaml", () => {
    expect(knowledgeKindSpec("prompt")?.structured).toBe(true);
    expect(knowledgeKindSpec("mail_template")?.fields.map((field) => field.key)).toContain("body_en");
    expect(validateStructuredFields("prompt", { body: "写一封信", variables: ["kol_name"] })).toEqual([]);
    expect(validateStructuredFields("prompt", { variables: [] })).toContain("提示词 缺少必填字段：提示词正文（body）");
    expect(validateStructuredFields("prompt", { body: "x", nope: 1 })).toContain("prompt 不支持字段：nope");
    expect(validateStructuredFields("prompt", { body: "x", variables: "a" })).toContain("提示词 的「变量」必须是字符串数组");
    expect(validateStructuredFields("policy", { body: "x" })).toContain("policy 不支持字段：body");
    expect(validateStructuredFields("nope_not_a_kind", {})).toContain("未知的知识类型：nope_not_a_kind");
  });
});
