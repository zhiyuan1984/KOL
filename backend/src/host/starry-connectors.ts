/**
 * Host-only Starry connectors for KOL memory sync.
 * Whitelist: pageKolProfiles / getKolProfileDetail → A
 *            pageEmailConversations → C for B.active only
 * FORBID decryptKolContact and every other write/decrypt tool.
 */
import { callStarryKolTool } from "../starrykol/service.js";
import type { Json } from "../types.js";
import { HttpFail } from "./errors.js";

export const MEMORY_STARRY_TOOLS = [
  "pageKolProfiles",
  "getKolProfileDetail",
  "pageEmailConversations",
] as const;

export type MemoryStarryTool = (typeof MEMORY_STARRY_TOOLS)[number];

export const FORBIDDEN_MEMORY_STARRY_TOOLS = [
  "decryptKolContact",
  "sendEmailNow",
  "changeLifecycleStage",
  "updateKolProfile",
  "addKolProfile",
  "importKolProfilesFromCrawler",
  "importKolProfilesV2",
  "createEmailConversation",
  "previewEmailDraft",
] as const;

const ALLOWED = new Set<string>(MEMORY_STARRY_TOOLS);

export async function callMemoryStarryTool(name: string, args: Json = {}): Promise<Json> {
  if (name === "decryptKolContact" || (FORBIDDEN_MEMORY_STARRY_TOOLS as readonly string[]).includes(name)) {
    throw new HttpFail(403, {
      code: "starry_tool_forbidden",
      message: "记忆同步禁止解密或写操作",
      tool: name,
    });
  }
  if (!ALLOWED.has(name)) {
    throw new HttpFail(403, {
      code: "starry_tool_not_whitelisted",
      message: "记忆同步只允许 pageKolProfiles / getKolProfileDetail / pageEmailConversations",
      tool: name,
    });
  }
  return callStarryKolTool(name, args);
}

export function pageKolProfiles(args: Json = {}): Promise<Json> {
  const requestJson = args.requestJson ?? JSON.stringify({
    pageNo: Number(args.pageNo || 1),
    pageSize: Number(args.pageSize || 50),
    ...(args.keyword ? { keyword: args.keyword } : {}),
  });
  return callMemoryStarryTool("pageKolProfiles", { requestJson });
}

export function getKolProfileDetail(kolUid: string): Promise<Json> {
  return callMemoryStarryTool("getKolProfileDetail", { kolUid });
}

export function pageEmailConversations(args: Json = {}): Promise<Json> {
  return callMemoryStarryTool("pageEmailConversations", args);
}
