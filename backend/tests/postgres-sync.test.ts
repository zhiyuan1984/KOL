import { describe, expect, it } from "vitest";
import { translateSqliteSql } from "../src/postgres/sync.js";

describe("PostgreSQL synchronous repository bridge", () => {
  it("converts positional parameters while preserving literals", () => {
    expect(translateSqliteSql("SELECT ? AS value, '?' AS literal")).toBe("SELECT $1 AS value, '?' AS literal");
  });

  it("maps SQLite conflict helpers to PostgreSQL conflict clauses", () => {
    expect(translateSqliteSql("INSERT OR IGNORE INTO app_state (key,value) VALUES (?,?)"))
      .toBe("INSERT INTO app_state (key,value) VALUES ($1,$2) ON CONFLICT DO NOTHING");
    expect(translateSqliteSql("INSERT OR REPLACE INTO app_state (key,value) VALUES (?,?)"))
      .toBe("INSERT INTO app_state (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET key=EXCLUDED.key,value=EXCLUDED.value");
  });

  it("maps transactional and scalar compatibility forms", () => {
    expect(translateSqliteSql("BEGIN IMMEDIATE")).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(translateSqliteSql("SELECT IFNULL(json_extract(payload,'$.kind'),'')")).toBe("SELECT COALESCE(payload::jsonb ->> 'kind','')");
    expect(translateSqliteSql("schema_hash NOT GLOB '*[^0123456789abcdef]*'"))
      .toBe("schema_hash !~ '[^0123456789abcdef]'");
  });
});
