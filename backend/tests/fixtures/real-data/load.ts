import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "../../../src/types.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

export function realDataPath(name: string): string {
  return path.join(dir, name);
}

export function readRealText(name: string): string {
  return fs.readFileSync(realDataPath(name), "utf8");
}

export function readRealJson<T>(name: string): T {
  return JSON.parse(readRealText(name)) as T;
}

export function parseMarkdownTable(markdown: string): Record<string, string>[] {
  const lines = markdown.split(/\r?\n/).filter((line) => line.startsWith("|"));
  if (lines.length < 2) return [];
  const headers = splitRow(lines[0]);
  return lines.slice(2).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  }).filter((row) => Object.values(row).some((value) => value.trim()));
}

function splitRow(line: string): string[] {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

export function portraitRows(): Record<string, string>[] {
  return parseMarkdownTable(readRealText("红人画像信息表.md"))
    .filter((row) => row["名称"] && !row["名称"].includes("示例"));
}

export function flowTemplateRows(): Record<string, string>[] {
  return parseMarkdownTable(readRealText("KOL合作主流程识别表.md"));
}

export function exceptionTemplateRows(): Record<string, string>[] {
  return parseMarkdownTable(readRealText("长期合作与异常阶段识别表.md"));
}

export function mailboxBindRows(): Record<string, string>[] {
  return parseMarkdownTable(readRealText("邮箱-负责人绑定清单.md"));
}

export type StarryProfile = Json & {
  kolUid: string;
  kolName: string;
  ownerName?: string | null;
  ownerUserId?: string | null;
  ownerMailbox?: string | null;
  brandName?: string | null;
  platform?: string | null;
  accountHandle?: string | null;
  countryName?: string | null;
  followerCountTenThousands?: number | null;
  avgVideoViews10?: number | null;
  avgVideoEngagementRate10?: number | null;
  audienceGeo?: Record<string, string> | null;
  nicheTagsText?: string | null;
  nicheTags?: Array<{ code: string; name: string }>;
  cooperationStageCode?: string | null;
  cooperationStageName?: string | null;
  daysInStage?: number | null;
  riskTag?: string | null;
  riskTagCodes?: string[];
  contactEmailMasked?: string | null;
  followStyleTags?: Array<{ id: string; label: string }>;
};

export function starryProfiles(): StarryProfile[] {
  const payload = readRealJson<{ total: number; list: StarryProfile[] }>("starry-kol-profiles.json");
  return payload.list;
}

export function starryMailboxes(): Json[] {
  const payload = readRealJson<{ total: number; list: Json[] }>("starry-kol-mailboxes.json");
  return payload.list;
}

export function starryStages(): Array<{
  stageCode: string;
  stageName: string;
  main?: boolean;
  aliases?: string[];
}> {
  return readRealJson<Array<{ stageCode: string; stageName: string; main?: boolean; aliases?: string[] }>>("starry-kol-stages.json");
}

export function completeStarryProfiles(): StarryProfile[] {
  return starryProfiles().filter((row) => row.platform && row.kolName && row.followerCountTenThousands);
}

export const WENDELL_UID = "KOLA58D2B0B4445431A9655";

export function wendellProfile(): StarryProfile {
  const hit = starryProfiles().find((row) => row.kolUid === WENDELL_UID);
  if (!hit) throw new Error("Wendell Fishing snapshot missing");
  return hit;
}

/** Tool names from the uploaded Starry / email-agent MCP inventory. */
export function starryToolNames(): string[] {
  const names: string[] = [];
  for (const line of readRealText("starry-kol-mcp.md").split(/\r?\n/)) {
    const match = /^\|\s*`([A-Za-z][A-Za-z0-9]+)`\s*\|/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

export const PORTRAIT_SHEET_EMAILS = [
  "wendellfishing@gmail.com",
  "heyhollyyoo@gmail.com",
  "giardi.j@gmail.com",
] as const;

export const LARRY_ZHAO_MAILBOX = "larry.zhao@amperetime.com";

export const CONNECTIVITY_TEST_EMAILS = [
  "qiyou1984@gmail.com",
  "qiyouhuang@163.com",
] as const;

export type LarryZhaoEmailFixture = {
  meta: Json;
  sender: Json & { mailboxEmail: string; brandCode: string; ownerUserName: string; responsibleStatus: number };
  recipients: Array<Json & { id: string; name: string; email: string; emailSource: string }>;
  mailbox_ops: Json[];
  outbound_mcp: Array<Json & { id: string; entities?: Json; expect?: Json }>;
  outbound_host: Array<Json & { id: string; template_id?: string; skill?: string; expect?: Json }>;
  inbound: Array<Json & {
    id: string;
    from: string;
    to: string;
    subject: string;
    body: string;
    current_stage?: string;
    attachments?: string[];
    fulfillment?: Record<string, unknown>;
    expect: Json;
  }>;
};

export function larryZhaoEmailScenarios(): LarryZhaoEmailFixture {
  return readRealJson<LarryZhaoEmailFixture>("larry-zhao-email-scenarios.json");
}
