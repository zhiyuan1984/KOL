import fs from "node:fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../scripts/apply-postgres-schema.ts", import.meta.url), "utf8");
const migrations = source.slice(source.indexOf("const migrations:"), source.indexOf("const onlyMigration"));

describe("PostgreSQL migration registration", () => {
  it("registers every migration id exactly once", () => {
    const ids = Array.from(migrations.matchAll(/\bid:\s*"([^"]+)"/g), match => match[1]);
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.length).toBe(new Set(ids).size);
  });
  it("creates KOL leads before dedup scoring and brand visibility migrations", () => {
    const create = migrations.indexOf('id: "20261007_kol_lead_coop"');
    expect(create).toBeGreaterThan(0);
    for (const id of ["20261008_discovery_dedup_score", "20261008_pool_brand_visibility"]) {
      expect(migrations.indexOf(`id: "${id}"`)).toBeGreaterThan(create);
    }
  });
});
