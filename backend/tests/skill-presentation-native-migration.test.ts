import { afterAll, describe, expect, it } from "vitest";
import { applyPostgresMigrations } from "../src/postgres/migrations.js";
import { postgresPool, closePostgresPool } from "../src/postgres/pool.js";
import { readPresentationOverlays, savePresentationOverlay } from "../src/host/skill-presentation.js";
const id = "20261015_045_skill_presentation_overlays";
afterAll(async () => { await closePostgresPool(); });

describe("formal skill presentation schema and atomic native writes", () => {
  it("registers the selected formal migration in both ledgers and is repeatable", async () => {
    const client = await postgresPool().connect();
    try {
      await applyPostgresMigrations(client, { only: id });
      expect(await applyPostgresMigrations(client, { only: id })).toEqual([]);
      const ledger = await client.query("SELECT id,checksum FROM schema_migrations WHERE id=$1", [id]);
      expect(ledger.rows).toHaveLength(1);
      expect(ledger.rows[0].checksum).toMatch(/^[a-f0-9]{64}$/);
      expect((await client.query("SELECT id FROM app_schema_migrations WHERE id=$1", [id])).rows).toHaveLength(1);
      expect((await client.query("SELECT skill_id,payload,updated_at FROM skill_presentation_overlays WHERE FALSE")).rows).toEqual([]);
    } finally { client.release(); }
  });
  it("rejects non-object data instead of recording a malformed successful overlay", async () => {
    await expect(postgresPool().query("INSERT INTO skill_presentation_overlays (skill_id,payload) VALUES ($1,$2)", ["invalid-array", "[]"]))
      .rejects.toMatchObject({ code: "23514" });
    expect((await postgresPool().query("SELECT skill_id FROM skill_presentation_overlays WHERE skill_id=$1", ["invalid-array"])).rows).toEqual([]);
  });
  it("merges concurrent independent patches atomically, without a read-then-write race", async () => {
    await savePresentationOverlay("native-concurrency-fixture", { icon: "research", category: "旧分类" });
    await Promise.all([
      savePresentationOverlay("native-concurrency-fixture", { badge: "已核对来源" }),
      savePresentationOverlay("native-concurrency-fixture", { category: "新分类" }),
    ]);
    const overlay = (await readPresentationOverlays()).get("native-concurrency-fixture");
    expect(overlay).toEqual({ icon: "research", badge: "已核对来源", category: "新分类" });
    await postgresPool().query("DELETE FROM skill_presentation_overlays WHERE skill_id=$1", ["native-concurrency-fixture"]);
  });
});
