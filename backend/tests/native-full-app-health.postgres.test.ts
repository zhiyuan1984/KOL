import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import * as database from "../src/db.js";
import { dropTestDatabases, freshTestDatabase } from "./support/pg.js";

describe("full native PostgreSQL application health", () => {
  beforeEach(async () => { await freshTestDatabase({ reclaimPrevious: true }); });
  afterAll(async () => { await dropTestDatabases(); });
  it("checks a genuine native query and identifies the full application store", async () => {
    const app = await createApp();
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true, name: "灵工", ui: "agent-v1", database_ready: true,
      runtime_mode: "postgres-native", authority_store: "postgresql",
      storage_adapter: "pg-native", compat_bridge: false,
    });
  });
  it("does not claim readiness or expose database connection details on native connection failure", async () => {
    const app = await createApp();
    const unreachable = new Pool({ host: "127.0.0.1", port: 1,
      user: "synthetic_health_probe", password: "synthetic-never-expose-password",
      database: "synthetic_health_probe", connectionTimeoutMillis: 100 });
    const connection = vi.spyOn(database, "getConn").mockReturnValue(unreachable);
    try {
      const response = await app.request("/api/health");
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ ok: false, database_ready: false,
        authority_store: "postgresql", compat_bridge: false, message: "原生数据库暂未就绪" });
      const encoded = JSON.stringify(body);
      expect(encoded).not.toContain("synthetic-never-expose-password");
      expect(encoded).not.toContain("ECONNREFUSED");
      expect(encoded).not.toContain("127.0.0.1");
    } finally { connection.mockRestore(); await unreachable.end(); }
  });
});
