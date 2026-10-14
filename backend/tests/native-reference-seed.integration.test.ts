import { beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { postgresDb } from "../src/postgres/access.js";
import { seedPostgresReferenceData } from "../src/postgres/reference-seed.js";

beforeEach(async () => { await freshTestDatabase(); });
describe("native PostgreSQL reference-data initialization", () => {
  it("creates missing directory references without credentials or runtime authority", async () => {
    const counts = await seedPostgresReferenceData();
    expect(counts.connectors).toBeGreaterThan(0);
    expect(await postgresDb().one("SELECT enabled,status,credential_ref FROM connectors WHERE id=$1", "starrykol"))
      .toEqual({ enabled: 0, status: "draft", credential_ref: null });
    expect(await postgresDb().one("SELECT code,kind FROM knowledge_bases WHERE id=$1", "kbase_legacy"))
      .toEqual({ code: "legacy", kind: "structured" });
  });
  it("is idempotent and preserves existing operator configuration", async () => {
    await seedPostgresReferenceData();
    await postgresDb().execute("UPDATE connectors SET label=$1,enabled=1,status=$2,credential_ref=$3 WHERE id=$4",
      "Operator-owned name", "configured", "opaque-existing-vault-reference", "starrykol");
    const before = await postgresDb().one("SELECT count(*) AS n FROM connectors");
    await seedPostgresReferenceData();
    expect(await postgresDb().one("SELECT count(*) AS n FROM connectors")).toEqual(before);
    expect(await postgresDb().one("SELECT label,enabled,status,credential_ref FROM connectors WHERE id=$1", "starrykol"))
      .toEqual({ label: "Operator-owned name", enabled: 1, status: "configured", credential_ref: "opaque-existing-vault-reference" });
  });
});
