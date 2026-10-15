import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({ codexMode: () => "stub", liveRemoteSideEffectsEnabled: () => false }));
vi.mock("../src/starrykol/connection.js", () => ({ starryKolMcpConfigured: () => true }));
vi.mock("../src/starrykol/service.js", () => ({ callStarryKolTool: vi.fn() }));
vi.mock("../src/gateway/discovery-harness.js", () => ({ rejectDiscoveryHarnessTool: vi.fn() }));

import { postgresPool } from "../src/postgres/pool.js";
import { callStarryKolTool } from "../src/starrykol/service.js";
import { importKolProfilesFromCrawlerConfirmed, lookupImportedKolUid } from "../src/gateway/import-creator.js";
import { buildCrawlerImportFile } from "../src/discovery-import.js";
import { freshTestDatabase } from "./support/pg.js";

beforeEach(async () => {
  // Each case uses an owned, current-schema native PG clone. Do not recreate
  // retired DDL or route the audit through the old in-memory db mock.
  await freshTestDatabase({ reclaimPrevious: true });
  vi.clearAllMocks();
});
afterEach(() => vi.clearAllMocks());
describe("uncertain import reconciliation", () => {
  it("checks listAll when keyword misses and finds the exact platform account", async () => {
    vi.mocked(callStarryKolTool)
      .mockResolvedValueOnce({ list: [] })
      .mockResolvedValueOnce({ list: [
        { kolUid: "KOLWRONG", platform: "instagram", account: "stable-channel" },
        { kolUid: "KOLREAL001", platform: "youtube", accountHandle: "stable-channel" },
      ] });
    expect(await lookupImportedKolUid({ creatorExternalId: "youtube:stable-channel" })).toBe("KOLREAL001");
    expect(vi.mocked(callStarryKolTool).mock.calls.map(call => call[0])).toEqual(["pageKolProfiles", "listAllKolProfiles"]);
    expect(vi.mocked(callStarryKolTool).mock.calls[0][2]).toEqual({ timeoutMs: 20_000 });
    expect(vi.mocked(callStarryKolTool).mock.calls[1][2]).toEqual({ timeoutMs: 60_000 });
  });
  it("does not adopt a UID from a fuzzy nickname result", async () => {
    vi.mocked(callStarryKolTool)
      .mockResolvedValueOnce({ list: [{ kolUid: "KOLWRONG", kolName: "stable-channel", account: "someone-else" }] })
      .mockResolvedValueOnce({ list: [] });
    expect(await lookupImportedKolUid({ creatorExternalId: "youtube:stable-channel" })).toBe("");
  });
  it("does not adopt an account without proven platform identity", async () => {
    vi.mocked(callStarryKolTool).mockResolvedValue({ list: [{ kolUid: "KOLUNKNOWN", account: "stable-channel" }] });
    expect(await lookupImportedKolUid({ creatorExternalId: "youtube:stable-channel" })).toBe("");
  });
  it("propagates listAll failure instead of concluding the KOL does not exist", async () => {
    vi.mocked(callStarryKolTool).mockResolvedValueOnce({ list: [] }).mockRejectedValueOnce(new Error("listAll unavailable"));
    await expect(lookupImportedKolUid({ creatorExternalId: "youtube:stable-channel" })).rejects.toThrow("listAll unavailable");
  });
  it("keeps the real rejected error in audit while redacting credentials", async () => {
    vi.mocked(callStarryKolTool).mockRejectedValue(new Error("remote import rejected token=private-token https://private.example/mcp"));
    const file = buildCrawlerImportFile([{ profile_url: "https://youtube.com/channel/stable-channel", kol_name: "Camping", platform_dict: "YOUTUBE", account: "stable-channel" }]);
    await expect(importKolProfilesFromCrawlerConfirmed({ file, sourceBatch: "test", creatorExternalId: "youtube:stable-channel", actor: "test" }))
      .rejects.toMatchObject({ detail: { code: "import_creator_failed" } });
    const audits = (await postgresPool().query<{ actor: string; event_type: string; payload: unknown }>(
      "SELECT actor,event_type,payload::jsonb AS payload FROM audit_events WHERE event_type=$1 ORDER BY id DESC",
      ["host.import_creator.failed"],
    )).rows;
    // The durable audit must be valid native JSON and must not retain the
    // credential or endpoint that the local Starry stub returned.
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: "test", event_type: "host.import_creator.failed" });
    expect(audits[0]?.payload).toMatchObject({
      error_detail: "remote import rejected token=*** [url]",
    });
    expect(JSON.stringify(audits)).not.toContain("private-token");
    expect(JSON.stringify(audits)).not.toContain("private.example");
  });
});
