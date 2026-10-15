import { describe, expect, it } from "vitest";
import { postgresMigrationManifest } from "../src/postgres/migrations.js";
const ids = postgresMigrationManifest().map(row => row.id);
describe("PostgreSQL migration registration", () => {
  it("registers every actual migration id exactly once", () => {
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.length).toBe(new Set(ids).size);
  });
  it("creates KOL leads before dedup scoring and brand visibility migrations", () => {
    const create = ids.indexOf("20261007_kol_lead_coop");
    expect(create).toBeGreaterThan(0);
    for (const id of ["20261008_discovery_dedup_score", "20261008_pool_brand_visibility"]) expect(ids.indexOf(id)).toBeGreaterThan(create);
  });
  it("registers native extension dependencies before their guarded business operations", () => {
    for (const [before,after] of [
      ["20261015_032_review_postgres","20261015_046_knowledge_legacy_backfill"],
      ["20261015_042_organization_native_postgres","20261015_046_knowledge_legacy_backfill"],
    ]) {
      expect(ids.indexOf(before)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(after)).toBeGreaterThan(ids.indexOf(before));
    }
  });
  it("creates private labels and mail threads before migrating assignments to peers", () => {
    const labels = ids.indexOf("20261012_mail_private_labels");
    const threads = ids.indexOf("20261007_kol_lead_coop");
    const peers = ids.indexOf("20261015_mail_labels_peer_email");
    expect(labels).toBeGreaterThan(0);
    expect(threads).toBeGreaterThan(0);
    expect(peers).toBeGreaterThan(labels);
    expect(peers).toBeGreaterThan(threads);
  });
});
