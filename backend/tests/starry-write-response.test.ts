import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db.js")>();
  return { ...actual, audit: vi.fn() };
});
vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return { ...actual, codexMode: () => "stub", liveRemoteSideEffectsEnabled: () => false };
});
vi.mock("../src/starrykol/connection.js", () => ({ starryKolMcpConfigured: () => true }));
vi.mock("../src/gateway/discovery-harness.js", () => ({ rejectDiscoveryHarnessTool: vi.fn() }));

import { audit } from "../src/db.js";
import { buildCrawlerImportFile } from "../src/discovery-import.js";
import { addKolProfileConfirmed, importKolProfilesFromCrawlerConfirmed } from "../src/gateway/import-creator.js";
import { starryBodyFailure, starryResponseDigest } from "../src/gateway/starry-response.js";
import { callStarryKolTool, setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";

const call = vi.fn<(name: string, args?: Json) => Promise<Json>>();
const add = { kolName: "Camping", contactEmail: "creator@example.com", owner: { ownerOpenId: "9" },
  sourceBatch: "response-test", creatorExternalId: "youtube:stable-channel", candidateId: "candidate-test", actor: "test" };
const file = buildCrawlerImportFile([{ profile_url: "https://youtube.com/channel/stable-channel", kol_name: "Camping", platform_dict: "YOUTUBE", account: "stable-channel" }]);
const importer = { file, sourceBatch: add.sourceBatch, creatorExternalId: add.creatorExternalId, actor: add.actor };
const exactProfile = { kolUid: "KOLREAL001", platform: "youtube", accountHandle: "stable-channel" };

beforeEach(() => {
  vi.clearAllMocks();
  call.mockReset();
  setStarryKolClientFactory(() => ({ callTool: call, close: async () => undefined }));
});
afterEach(() => setStarryKolClientFactory());

describe("Starry write response diagnostics", () => {
  it.each([
    { success: false, message: "联系邮箱已被其他红人占用", data: {} },
    { code: 409, msg: "联系邮箱已被其他红人占用", data: {} },
    { code: "409", message: "联系邮箱已被其他红人占用" },
    { data: { ok: false, errMsg: "联系邮箱已被其他红人占用" } },
    { result: JSON.stringify({ success: false, message: "联系邮箱已被其他红人占用" }) },
  ])("surfaces the explicit rejection without lookup or another write: %j", async (response) => {
    call.mockResolvedValue(response);
    await expect(addKolProfileConfirmed(add)).rejects.toMatchObject({ detail: {
      code: "import_creator_failed", message: "Starry 建档未成功：联系邮箱已被其他红人占用",
    } });
    expect(call.mock.calls.map(args => args[0])).toEqual(["addKolProfile"]);
    expect(audit).toHaveBeenCalledWith("test", "host.add_kol_profile.failed", expect.objectContaining({
      reason: "starry_rejected", starry_response: JSON.stringify(response),
    }));
  });
  it("does not let a UID embedded in a rejected response imply success", async () => {
    call.mockResolvedValue({ success: false, message: "字段校验失败", data: { kolUid: "KOLSTALE001" } });
    await expect(addKolProfileConfirmed(add)).rejects.toMatchObject({ detail: { message: "Starry 建档未成功：字段校验失败" } });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("does not let a known UID conceal a rejected enrichment import", async () => {
    call.mockResolvedValue({ code: 400, message: "平台字段校验失败", data: {} });
    await expect(importKolProfilesFromCrawlerConfirmed({ ...importer, knownKolUid: "KOLKNOWN001" }))
      .rejects.toMatchObject({ detail: { message: "Starry 入库未成功：平台字段校验失败" } });
    expect(audit).toHaveBeenCalledWith("test", "host.import_creator.failed", expect.objectContaining({ reason: "starry_rejected" }));
    expect(call).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "KOLKNOWN001"])("surfaces the actual skipped row even with known UID %s", async (knownKolUid) => {
    const response = { code: 200, message: "success", data: {
      totalCount: 1, createdCount: 0, updatedCount: 0, failedCount: 0, failures: [], skippedCount: 1,
      skipped: [{ rowNo: 2, kolUid: null, kolName: "Outdoor Boys", reasons: [
        { field: "红人统一ID", code: "SKIPPED_NO_KOL_UID", reason: "缺少红人统一ID，已跳过" },
      ] }],
    } };
    call.mockResolvedValue(response);
    await expect(importKolProfilesFromCrawlerConfirmed({ ...importer, knownKolUid })).rejects.toMatchObject({
      detail: { code: "import_creator_failed", message: "Starry 入库未成功：缺少红人统一ID，已跳过" },
    });
    expect(call.mock.calls.map(args => args[0])).toEqual(["importKolProfilesFromCrawler"]);
    expect(audit).toHaveBeenCalledWith("test", "host.import_creator.failed", expect.objectContaining({
      reason: "starry_rejected", starry_response: JSON.stringify(response),
    }));
  });
  it("surfaces failed row reasons inside an outer success envelope", async () => {
    call.mockResolvedValue({ code: 200, message: "success", data: { totalCount: 1, failedCount: 1,
      failures: [{ reasons: [{ reason: "平台字段校验失败 token=private" }] }] } });
    await expect(importKolProfilesFromCrawlerConfirmed(importer)).rejects.toMatchObject({
      detail: { message: "Starry 入库未成功：平台字段校验失败 token=***" },
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("does not interpret zero failed/skipped counts as rejection", async () => {
    call.mockResolvedValue({ code: 200, data: { totalCount: 1, updatedCount: 1, failedCount: 0, skippedCount: 0 } });
    await expect(importKolProfilesFromCrawlerConfirmed({ ...importer, knownKolUid: "KOLKNOWN001" }))
      .resolves.toMatchObject({ kol_uid: "KOLKNOWN001" });
  });
  it("keeps a clear rejection even when its message is absent", async () => {
    call.mockResolvedValue({ success: false, data: {} });
    await expect(addKolProfileConfirmed(add)).rejects.toMatchObject({ detail: { code: "import_creator_failed" } });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it.each([0, 200, "0", "200", "success", "ok"])("retains successful wrapped receipts with code %s", async (code) => {
    call.mockResolvedValue({ code, message: "成功", data: { data: { kolUid: "KOLREAL001" } } });
    await expect(addKolProfileConfirmed(add)).resolves.toMatchObject({ ok: true, kol_uid: "KOLREAL001" });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("reconciles a successful add missing its UID using exact account and platform", async () => {
    call.mockResolvedValueOnce({ success: true, data: {} })
      .mockResolvedValueOnce({ data: { list: [] } })
      .mockResolvedValueOnce({ data: { list: [exactProfile] } });
    await expect(addKolProfileConfirmed(add)).resolves.toMatchObject({ kol_uid: "KOLREAL001", looked_up_after_missing_uid: true });
    expect(call.mock.calls.map(args => args[0])).toEqual(["addKolProfile", "pageKolProfiles", "listAllKolProfiles"]);
  });
  it("reconciles a successful import missing its UID without repeating the import", async () => {
    call.mockResolvedValueOnce({ code: 0, data: { imported: 1 } })
      .mockResolvedValueOnce({ list: [exactProfile] });
    await expect(importKolProfilesFromCrawlerConfirmed(importer)).resolves.toMatchObject({ kol_uid: "KOLREAL001", looked_up_after_missing_uid: true });
    expect(call.mock.calls.map(args => args[0])).toEqual(["importKolProfilesFromCrawler", "pageKolProfiles"]);
  });
  it("audits the exact business response when reconciliation finds no profile", async () => {
    const response = { success: true, message: "已处理", data: { imported: 1 } };
    call.mockResolvedValueOnce(response).mockResolvedValue({ list: [] });
    await expect(addKolProfileConfirmed(add)).rejects.toMatchObject({ detail: { code: "import_creator_no_kol_uid" } });
    expect(audit).toHaveBeenCalledWith("test", "host.add_kol_profile.failed", expect.objectContaining({
      reason: "missing_kol_uid", starry_response: JSON.stringify(response),
    }));
  });
  it("preserves the original response if lookup itself fails", async () => {
    const response = { success: true, data: {} };
    call.mockResolvedValueOnce(response).mockRejectedValueOnce(new Error("lookup unavailable token=private"));
    await expect(addKolProfileConfirmed(add)).rejects.toMatchObject({ detail: { code: "import_creator_no_kol_uid" } });
    expect(audit).toHaveBeenCalledWith("test", "host.add_kol_profile.failed", expect.objectContaining({ starry_response: JSON.stringify(response) }));
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("retains original import behavior when a known UID accompanies a success counter", async () => {
    call.mockResolvedValue({ code: 0, data: { updatedCount: 1 } });
    await expect(importKolProfilesFromCrawlerConfirmed({ ...importer, knownKolUid: "KOLKNOWN001" })).resolves.toMatchObject({ kol_uid: "KOLKNOWN001" });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("preserves envelopes only for the two ingestion tools", async () => {
    const envelope = { success: false, code: 409, message: "拒绝", data: {} };
    call.mockResolvedValue(envelope);
    expect(await callStarryKolTool("addKolProfile", {})).toEqual(envelope);
    expect(await callStarryKolTool("importKolProfilesFromCrawler", {})).toEqual(envelope);
    call.mockResolvedValue({ code: 0, data: { list: [] } });
    expect(await callStarryKolTool("pageKolProfiles", {})).toEqual({ list: [] });
  });
  it("bounds the audit digest to 2000 characters, including the truncation marker", () => {
    const digest = starryResponseDigest({ message: "长".repeat(3000) });
    expect(digest).toHaveLength(2000);
    expect(digest).toMatch(/…\(truncated\)$/);
  });
  it("redacts credentials without replacing business error wording", () => {
    const response = { success: false, message: "字段校验失败 token=private-token", authorization: "Bearer jwt-secret", apiKey: "key-secret" };
    const digest = starryResponseDigest(response);
    expect(digest).toContain("字段校验失败");
    expect(digest).not.toMatch(/private-token|jwt-secret|key-secret/);
    expect(starryBodyFailure(response)).toEqual({ failed: true, message: "字段校验失败 token=***" });
  });
  it("does not infer rejection from an unmarked informational message", () => {
    expect(starryBodyFailure({ message: "已处理，请核对" })).toEqual({ failed: false, message: "" });
  });
});
