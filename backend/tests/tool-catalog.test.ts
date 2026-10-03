import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { getToolPolicy, setConnectorConfig, setToolPolicy } from "../src/runtime/store.js";
import { deriveToolPolicy, registerDiscoveredToolPolicies } from "../src/runtime/tool-catalog.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;
let env: Record<string, string | undefined>;
beforeEach(async () => {
  await freshTestDatabase();
  env = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"].map(k => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tool-catalog-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  resetConn();
  getConn().prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('catalog_fixture','Fixture',1,'configured','now')").run();
  setConnectorConfig("catalog_fixture", { url: "https://fixture.example/mcp", allow_unauthenticated: true }, 0);
});
afterEach(() => {
  resetConn(); fs.rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const hash = (seed: string) => seed.repeat(64).slice(0, 64);

describe("tool risk derivation (07-mcp-data-contract)", () => {
  it("classifies read families as L1 and sensitive families as L3", () => {
    expect(deriveToolPolicy("pageKolProfiles")).toEqual({ risk: "L1", access: "read" });
    expect(deriveToolPolicy("summarizeRiskConversations")).toEqual({ risk: "L1", access: "read" });
    expect(deriveToolPolicy("deleteMailbox")).toEqual({ risk: "L3", access: "write" });
    expect(deriveToolPolicy("sendEmailNow")).toEqual({ risk: "L3", access: "write" });
    expect(deriveToolPolicy("decryptKolContact")).toEqual({ risk: "L3", access: "write" });
    expect(deriveToolPolicy("importKolProfilesV2")).toEqual({ risk: "L3", access: "write" });
  });
  it("keeps drafts, previews and unknown tools conservative at L2", () => {
    expect(deriveToolPolicy("previewEmailDraft")).toEqual({ risk: "L2", access: "write" });
    expect(deriveToolPolicy("updateRiskDefinition")).toEqual({ risk: "L2", access: "write" });
    expect(deriveToolPolicy("changeLifecycleRiskTag")).toEqual({ risk: "L2", access: "write" });
  });
});

describe("registerDiscoveredToolPolicies", () => {
  it("creates derived policies on first discovery and disables L3 rows", () => {
    const result = registerDiscoveredToolPolicies("catalog_fixture", [
      { name: "pageKolProfiles", schema_hash: hash("a"), inputSchema: { type: "object" } },
      { name: "sendEmailNow", schema_hash: hash("b"), inputSchema: { type: "object" } },
    ]);
    expect(result).toMatchObject({ total: 2, created: 2, refreshed: 0, skipped: 0 });
    expect(getToolPolicy("catalog_fixture", "pageKolProfiles")).toMatchObject({ risk: "L1", access: "read", enabled: 1 });
    expect(getToolPolicy("catalog_fixture", "sendEmailNow")).toMatchObject({ risk: "L3", enabled: 0 });
  });
  it("derives a missing fingerprint instead of skipping the tool", () => {
    const result = registerDiscoveredToolPolicies("catalog_fixture", [{ name: "listAllKolProfiles", inputSchema: { type: "object" } }]);
    expect(result.created).toBe(1);
    const policy = getToolPolicy("catalog_fixture", "listAllKolProfiles");
    expect(String(policy?.schema_hash)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("keeps administrator overrides and only refreshes a changed fingerprint", () => {
    setToolPolicy("catalog_fixture", "pageKolProfiles", { enabled: true, risk: "L2", access: "write", schema_hash: hash("a") }, 0);
    registerDiscoveredToolPolicies("catalog_fixture", [{ name: "pageKolProfiles", schema_hash: hash("a") }]);
    expect(getToolPolicy("catalog_fixture", "pageKolProfiles")).toMatchObject({ risk: "L2", version: 1 });
    const refreshed = registerDiscoveredToolPolicies("catalog_fixture", [{ name: "pageKolProfiles", schema_hash: hash("c") }]);
    expect(refreshed).toMatchObject({ refreshed: 1 });
    expect(getToolPolicy("catalog_fixture", "pageKolProfiles")).toMatchObject({ risk: "L2", access: "write", schema_hash: hash("c"), version: 2 });
  });
  it("skips tools without a usable name", () => {
    const result = registerDiscoveredToolPolicies("catalog_fixture", [{ description: "no name" }]);
    expect(result).toMatchObject({ total: 1, created: 0, skipped: 1 });
  });
});
