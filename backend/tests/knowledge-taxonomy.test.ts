import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { applyPostgresMigrations } from "../src/postgres/migrations.js";
import { knowledgeKindSpec, resetKnowledgeKindsCache, validateStructuredFields } from "../src/knowledge-kinds.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;
const MIGRATION = "20261015_046_knowledge_legacy_backfill";
beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kb-taxonomy-"));
  process.env.LINGONG_DATA = tmp;
  resetKnowledgeKindsCache();
  await resetConn();
});
afterEach(async () => {
  resetKnowledgeKindsCache();
  await resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("knowledge taxonomy native PostgreSQL", () => {
  it("backfills current legacy entry fields once and preserves every historical version field", async () => {
    const conn = getConn(), now = new Date().toISOString();
    await conn.query("INSERT INTO knowledge (id,title,body,tags,kind,status,in_market,current_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$7)", ["k_legacy_1","历史制度","正文","extracted","policy","draft",now]);
    await conn.query("INSERT INTO knowledge_versions (id,knowledge_id,version,title,body,kind,status,created_at,note) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)", ["kv_1","k_legacy_1","历史制度","原始版本正文","policy","draft",now,"create"]);
    const originalVersion = (await conn.query("SELECT * FROM knowledge_versions WHERE id=$1", ["kv_1"])).rows[0];
    // The template is fully migrated before each test.  Remove this migration's
    // two isolated ledgers only, so the test exercises its production replay
    // against a legacy-shaped current row without altering SQL/checksums/triggers.
    await conn.query("DELETE FROM app_schema_migrations WHERE id=$1", [MIGRATION]);
    await conn.query("DELETE FROM schema_migrations WHERE id=$1", [MIGRATION]);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await applyPostgresMigrations(client, { only: MIGRATION });
      const family = (await conn.query("SELECT * FROM knowledge_domains WHERE code='uncategorized' AND level='family'")).rows[0];
      expect(family).toMatchObject({ id: "kdom_uncategorized", level: "family" });
      const domain = (await conn.query("SELECT * FROM knowledge_domains WHERE id='kdom_legacy'")).rows[0];
      expect(domain).toMatchObject({ level: "domain", parent_id: "kdom_uncategorized" });
      const base = (await conn.query("SELECT * FROM knowledge_bases WHERE id='kbase_legacy'")).rows[0];
      expect(base).toMatchObject({ kind: "structured" });
      const row = (await conn.query("SELECT base_id,source_body,structured,body FROM knowledge WHERE id=$1", ["k_legacy_1"])).rows[0];
      expect(row).toMatchObject({ base_id: "kbase_legacy", source_body: "正文", body: "正文", structured: null });
      const version = (await conn.query("SELECT * FROM knowledge_versions WHERE id=$1", ["kv_1"])).rows[0];
      // A missing historical tag/base/publication flag is unknown. Current entry
      // metadata cannot be used to reconstruct an older immutable snapshot.
      expect(version).toEqual(originalVersion);
      expect(version.body).toBe("原始版本正文");
      await expect(applyPostgresMigrations(client, { only: MIGRATION })).resolves.toEqual([]);
      expect((await conn.query("SELECT * FROM knowledge_versions WHERE id=$1", ["kv_1"])).rows[0]).toEqual(version);
    } finally { await client.end(); }
  });
  it("validates structured fields against config/knowledge-kinds.yaml", () => {
    expect(knowledgeKindSpec("prompt")?.structured).toBe(true);
    expect(knowledgeKindSpec("mail_template")?.fields.map(field => field.key)).toContain("body_en");
    expect(validateStructuredFields("prompt", { body: "写一封信", variables: ["kol_name"] })).toEqual([]);
    expect(validateStructuredFields("prompt", { variables: [] })).toContain("提示词 缺少必填字段：提示词正文（body）");
    expect(validateStructuredFields("prompt", { body: "x", nope: 1 })).toContain("prompt 不支持字段：nope");
    expect(validateStructuredFields("prompt", { body: "x", variables: "a" })).toContain("提示词 的「变量」必须是字符串数组");
    expect(validateStructuredFields("policy", { body: "x" })).toContain("policy 不支持字段：body");
    expect(validateStructuredFields("nope_not_a_kind", {})).toContain("未知的知识类型：nope_not_a_kind");
  });
});
