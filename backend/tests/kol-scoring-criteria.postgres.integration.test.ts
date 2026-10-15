import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConn } from "../src/db.js";
import { latestDiscoveryCriteria } from "../src/host/kol-scoring-criteria.js";
import { postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";

const NOW = "2031-01-01T00:00:00.000Z";

function requireLocalTestDatabase(): void {
  const url = new URL(String(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || ""));
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("KOL scoring criteria integration test requires local PostgreSQL");
  }
}

async function seedDiscoveryRequest(input: { id: string; owner: string; createdAt: string; platforms: string; keywords: string; filters: string; brand?: string | null }): Promise<void> {
  await postgresPool().query(
    `INSERT INTO discovery_requests
       (id,owner_user_id,keywords,platforms,mode,filters,brand,scope,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'search',$5,$6,'{}','open',$7,$7)`,
    [input.id, input.owner, input.keywords, input.platforms, input.filters, input.brand || null, input.createdAt],
  );
}

beforeEach(async () => {
  requireLocalTestDatabase();
  await freshTestDatabase();
  (await resetConn());
});

afterEach(async () => { (await resetConn()); });

describe.sequential("KOL scoring criteria (native PostgreSQL)", () => {
  it("reads only the employee's latest declared discovery request using parameterized PostgreSQL", async () => {
    await seedDiscoveryRequest({ id: "criteria-old", owner: "employee:criteria", createdAt: NOW, platforms: JSON.stringify(["youtube"]), keywords: JSON.stringify(["old"]), filters: JSON.stringify({ region: "global_en", directions: ["outdoor"], min_followers: 1000, target_count: 10 }), brand: "LT" });
    await seedDiscoveryRequest({ id: "criteria-latest", owner: "employee:criteria", createdAt: "2031-01-02T00:00:00.000Z", platforms: JSON.stringify(["youtube", "invalid-platform"]), keywords: JSON.stringify(["portable power", "portable power", "camping"]), filters: JSON.stringify({ region: "global_en", directions: ["tech", "outdoor"], min_followers: 12000, max_followers: 500000, min_avg_views_10: 8000, target_count: 20 }), brand: "TB" });
    await seedDiscoveryRequest({ id: "criteria-other", owner: "employee:other", createdAt: "2032-01-01T00:00:00.000Z", platforms: JSON.stringify(["instagram"]), keywords: JSON.stringify(["must-not-leak"]), filters: "{}" });

    await expect(latestDiscoveryCriteria("employee:criteria")).resolves.toEqual({ platforms: ["youtube"], region: "global_en", directions: ["tech", "outdoor"], keywords: ["portable power", "camping"], min_followers: 12000, max_followers: 500000, min_avg_plays_10: 8000, expect_count: 20, brand: "TB" });
    await expect(latestDiscoveryCriteria("employee:missing")).resolves.toBeNull();
  });

  it("treats malformed stored JSON as a bounded no-criteria result rather than consulting any compatibility store", async () => {
    await seedDiscoveryRequest({ id: "criteria-malformed", owner: "employee:malformed", createdAt: NOW, platforms: "not-json", keywords: "[", filters: "{", brand: null });
    await expect(latestDiscoveryCriteria("employee:malformed")).resolves.toBeNull();
  });
});
