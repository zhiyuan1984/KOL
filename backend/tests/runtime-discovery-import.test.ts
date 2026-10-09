import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/gateway/import-creator.js", () => ({ addKolProfileConfirmed: vi.fn(),
  findExistingKolUid: vi.fn(), importKolProfilesFromCrawlerConfirmed: vi.fn() }));
vi.mock("../src/host/starry-bind.js", () => ({ starryBindingRow: vi.fn() }));
vi.mock("../src/starrykol/service.js", () => ({ resolveStarryOwnerForMailbox: vi.fn() }));
import { addKolProfileConfirmed, findExistingKolUid, importKolProfilesFromCrawlerConfirmed } from "../src/gateway/import-creator.js";
import { starryBindingRow } from "../src/host/starry-bind.js";
import { resolveStarryOwnerForMailbox } from "../src/starrykol/service.js";
import { importRuntimeCandidateProfile } from "../src/gateway/runtime-discovery-import.js";
const candidate = { id: "stable-channel", platform: "youtube", name: "Camping", source_url: "https://youtube.com/channel/stable-channel", contact_email: "real@example.com" };
const input = () => ({ candidate, actorId: "employee", sourceBatch: "batch", authorizeCreate: vi.fn(), checkpoint: vi.fn().mockResolvedValue(undefined) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(findExistingKolUid).mockResolvedValue(null);
  vi.mocked(starryBindingRow).mockReturnValue({ mailbox_id: "5", mailbox_email: "employee@example.com", owner_name: "Employee" });
  vi.mocked(resolveStarryOwnerForMailbox).mockResolvedValue({ ownerOpenId: "19" });
  vi.mocked(addKolProfileConfirmed).mockResolvedValue({ kol_uid: "KOLREAL001" });
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "KOLREAL001" });
});
it("creates once then imports with the verified UID and no contact column", async () => {
  const args = input(); await expect(importRuntimeCandidateProfile(args)).resolves.toMatchObject({ kol_uid: "KOLREAL001" });
  expect(args.authorizeCreate).toHaveBeenCalledTimes(1);
  expect(addKolProfileConfirmed).toHaveBeenCalledWith(expect.objectContaining({ contactEmail: "real@example.com", owner: { ownerOpenId: "19" } }));
  expect(args.checkpoint.mock.calls.map(c => c[0])).toEqual([{ phase: "preflight" }, { phase: "add_uncertain" }, { phase: "profile_ready", kol_uid: "KOLREAL001" }]);
  const imported = vi.mocked(importKolProfilesFromCrawlerConfirmed).mock.calls[0][0];
  expect(imported.knownKolUid).toBe("KOLREAL001"); expect(imported.file.csv).toContain("红人统一ID");
  expect(imported.file.rows[0].kol_uid).toBe("KOLREAL001"); expect(imported.file.csv).not.toContain("@");
  expect(vi.mocked(addKolProfileConfirmed).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(importKolProfilesFromCrawlerConfirmed).mock.invocationCallOrder[0]);
});
it("finds an exact existing UID without requiring email or create permission", async () => {
  vi.mocked(findExistingKolUid).mockResolvedValue({ kol_uid: "KOLREAL001", via: "keyword", profile: {} });
  const args = { ...input(), candidate: { ...candidate, contact_email: "" } };
  await importRuntimeCandidateProfile(args); expect(args.authorizeCreate).not.toHaveBeenCalled();
  expect(addKolProfileConfirmed).not.toHaveBeenCalled(); expect(resolveStarryOwnerForMailbox).not.toHaveBeenCalled();
});
it("never imports a CSV without UID when the candidate has no email", async () => {
  await expect(importRuntimeCandidateProfile({ ...input(), candidate: { ...candidate, contact_email: "" } }))
    .rejects.toMatchObject({ detail: { code: "import_creator_no_contact_email" } });
  expect(addKolProfileConfirmed).not.toHaveBeenCalled(); expect(importKolProfilesFromCrawlerConfirmed).not.toHaveBeenCalled();
});
it("does not dispatch when create permission is revoked", async () => {
  const args = input(); args.authorizeCreate.mockImplementation(() => { throw new Error("denied"); });
  await expect(importRuntimeCandidateProfile(args)).rejects.toThrow("denied"); expect(args.checkpoint).toHaveBeenCalledWith({ phase: "preflight" });
  expect(addKolProfileConfirmed).not.toHaveBeenCalled(); expect(importKolProfilesFromCrawlerConfirmed).not.toHaveBeenCalled();
});
it("does not invent an owner id", async () => {
  vi.mocked(resolveStarryOwnerForMailbox).mockResolvedValue({ ownerUserName: "Employee" });
  await expect(importRuntimeCandidateProfile(input())).rejects.toMatchObject({ detail: { code: "import_creator_no_owner_open_id" } });
  expect(addKolProfileConfirmed).not.toHaveBeenCalled();
});
it("blocks writes if lookup fails or identity is ambiguous", async () => {
  vi.mocked(findExistingKolUid).mockRejectedValue(new Error("lookup unavailable"));
  await expect(importRuntimeCandidateProfile(input())).rejects.toThrow("lookup unavailable");
  expect(addKolProfileConfirmed).not.toHaveBeenCalled();
  expect(findExistingKolUid).toHaveBeenCalledWith(expect.anything(), { actor: "employee", strict: true });
});
it("resumes enrichment from a durable profile UID without creating again", async () => {
  await importRuntimeCandidateProfile({ ...input(), knownKolUid: "KOLREAL001" });
  expect(findExistingKolUid).not.toHaveBeenCalled(); expect(addKolProfileConfirmed).not.toHaveBeenCalled();
  expect(importKolProfilesFromCrawlerConfirmed).toHaveBeenCalledTimes(1);
});
it("keeps the verified UID checkpoint when enrichment fails", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("failed enrichment"));
  const args = input(); await expect(importRuntimeCandidateProfile(args)).rejects.toThrow("failed enrichment");
  expect(args.checkpoint).toHaveBeenLastCalledWith({ phase: "profile_ready", kol_uid: "KOLREAL001" });
});
it("does not blindly repeat an uncertain add even after an empty lookup", async () => {
  await expect(importRuntimeCandidateProfile({ ...input(), addUncertain: true }))
    .rejects.toMatchObject({ detail: { code: "import_creator_uncertain" } });
  expect(addKolProfileConfirmed).not.toHaveBeenCalled(); expect(importKolProfilesFromCrawlerConfirmed).not.toHaveBeenCalled();
});
it("can reconcile an uncertain add to an exact matching UID", async () => {
  vi.mocked(findExistingKolUid).mockResolvedValue({ kol_uid: "KOLREAL001", via: "list_all", profile: {} });
  await importRuntimeCandidateProfile({ ...input(), addUncertain: true });
  expect(addKolProfileConfirmed).not.toHaveBeenCalled(); expect(importKolProfilesFromCrawlerConfirmed).toHaveBeenCalledTimes(1);
});
it("stops before enrichment when add fails or returns no real UID", async () => {
  vi.mocked(addKolProfileConfirmed).mockRejectedValueOnce(new Error("add timeout"));
  await expect(importRuntimeCandidateProfile(input())).rejects.toThrow("add timeout");
  vi.mocked(addKolProfileConfirmed).mockResolvedValueOnce({});
  await expect(importRuntimeCandidateProfile(input())).rejects.toMatchObject({ detail: { code: "import_creator_no_kol_uid" } });
  expect(importKolProfilesFromCrawlerConfirmed).not.toHaveBeenCalled();
});

it("rechecks import permission after creation and preserves the profile checkpoint on denial", async () => {
 const args = { ...input(), authorizeImport: vi.fn(() => { throw new Error("revoked"); }) };
 await expect(importRuntimeCandidateProfile(args)).rejects.toThrow("revoked");
 expect(addKolProfileConfirmed).toHaveBeenCalledTimes(1); expect(importKolProfilesFromCrawlerConfirmed).not.toHaveBeenCalled();
 expect(args.checkpoint).toHaveBeenLastCalledWith({ phase: "profile_ready", kol_uid: "KOLREAL001" });
});
