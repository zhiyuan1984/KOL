import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { knowledgeKindSpec, resetKnowledgeKindsCache, validateStructuredFields } from "../src/knowledge-kinds.js";
import type { Row } from "../src/types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kb-taxonomy-"));
  process.env.LINGONG_DB = path.join(tmp, "kb.db");
  process.env.LINGONG_DATA = tmp;
  process.env.NODE_ENV = "test";
  resetKnowledgeKindsCache();
  resetConn();
  getConn();
});

afterEach(() => {
  resetKnowledgeKindsCache();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("knowledge taxonomy (P1)", () => {
  it("merges a legacy knowledge table: default family/domain/base + backfills", async () => {
    const dbPath = path.join(tmp, "legacy.db");
    resetConn();
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE knowledge (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT,
        in_market INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL DEFAULT 'policy',
        status TEXT NOT NULL DEFAULT 'draft', current_version INTEGER NOT NULL DEFAULT 1,
        effective_at TEXT, expires_at TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE knowledge_versions (
        id TEXT PRIMARY KEY, knowledge_id TEXT NOT NULL, version INTEGER NOT NULL,
        title TEXT, body TEXT, kind TEXT, status TEXT, created_at TEXT, note TEXT
      );
    `);
    const now = new Date().toISOString();
    raw.prepare(
      "INSERT INTO knowledge (id,title,body,tags,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run("k_legacy_1", "历史制度", "正文", "extracted", "policy", "published", now, now);
    raw.prepare(
      "INSERT INTO knowledge_versions (id,knowledge_id,version,title,body,kind,status,created_at,note) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("kv_1", "k_legacy_1", 1, "历史制度", "正文", "policy", "published", now, "create");
    raw.close();

    process.env.LINGONG_DB = dbPath;
    resetConn();
    const conn = getConn();

    const family = conn.prepare("SELECT * FROM knowledge_domains WHERE code='uncategorized'").get() as Row | undefined;
    expect(family).toBeTruthy();
    expect(String(family!.level)).toBe("family");
    const domain = conn.prepare("SELECT * FROM knowledge_domains WHERE code='legacy'").get() as Row | undefined;
    expect(domain).toBeTruthy();
    expect(String(domain!.level)).toBe("domain");
    expect(String(domain!.parent_id)).toBe("kdom_uncategorized");
    const base = conn.prepare("SELECT * FROM knowledge_bases WHERE code='legacy'").get() as Row | undefined;
    expect(base).toBeTruthy();
    expect(String(base!.kind)).toBe("structured");

    const row = conn.prepare("SELECT base_id, source_body, structured FROM knowledge WHERE id='k_legacy_1'").get() as Row;
    expect(String(row.base_id)).toBe("kbase_legacy");
    expect(String(row.source_body)).toBe("正文");
    expect(row.structured).toBeNull();

    const version = conn.prepare("SELECT tags, in_market FROM knowledge_versions WHERE id='kv_1'").get() as Row;
    expect(String(version.tags)).toBe("extracted");
    expect(Number(version.in_market)).toBe(1);
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
