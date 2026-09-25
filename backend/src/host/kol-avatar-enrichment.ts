import { lookup } from "node:dns/promises";
import { audit, getConn, nowIso, type SqliteConn } from "../db.js";
import type { Row } from "../types.js";
import { memoryCompanyId } from "./kol-memory.js";

type FetchLike = typeof fetch;
let avatarFetchOverride: FetchLike | null = null;

/** Test seam; production always uses the platform fetch implementation. */
export function setAvatarCrawlerFetch(fetcher?: FetchLike): void {
  avatarFetchOverride = fetcher || null;
}

function crawlerFetch(): FetchLike {
  return avatarFetchOverride || fetch;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}

function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (isPrivateIpv4(lower)) return true;
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
}

/** Public-profile crawler boundary: http(s) only, no loopback or private network targets. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("主页地址无效");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("仅允许公开 http(s) 主页");
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error("主页地址不符合公开抓取规则");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isPrivateAddress(host)) {
    throw new Error("主页地址指向本地或私有网络");
  }
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error("主页地址未解析为公开网络");
    }
  } catch (error) {
    if (error instanceof Error && /公开网络|私有网络/.test(error.message)) throw error;
    throw new Error("主页地址无法解析");
  }
  return parsed;
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function attr(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return htmlDecode(match?.[2] || "").trim();
}

/** Extract only public social-image metadata; page text is never persisted or passed to a model. */
export function publicAvatarUrlFromHtml(html: string, pageUrl: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const names = new Set(["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
  for (const tag of tags) {
    const name = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    if (!names.has(name)) continue;
    const content = attr(tag, "content");
    if (!content) continue;
    try {
      const candidate = new URL(content, pageUrl);
      if (candidate.protocol === "https:" || candidate.protocol === "http:") return candidate.toString();
    } catch {
      /* malformed metadata cannot enrich the profile */
    }
  }
  return null;
}

async function fetchPublicHtml(start: string): Promise<{ html: string; pageUrl: string }> {
  let current = await assertPublicHttpUrl(start);
  for (let redirects = 0; redirects <= 1; redirects += 1) {
    const response = await crawlerFetch()(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "KOL-Public-Avatar-Indexer/1.0 (+public-profile-enrichment)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects >= 1) throw new Error("主页重定向未完成");
      current = await assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`主页返回 ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("主页不是 HTML 页面");
    if (Number.isFinite(contentLength) && contentLength > 1_000_000) throw new Error("主页内容超过抓取上限");
    return { html: (await response.text()).slice(0, 300_000), pageUrl: current.toString() };
  }
  throw new Error("主页重定向未完成");
}

function eligibleProfiles(companyId: string, limit: number, db: SqliteConn): Row[] {
  return db.prepare(
    `SELECT kol_uid, homepage_url
       FROM kol_profile_index
      WHERE company_id=?
        AND pool_status='open'
        AND trim(COALESCE(homepage_url,''))<>''
        AND trim(COALESCE(avatar_url,''))=''
      ORDER BY COALESCE(avatar_checked_at,''), updated_at, kol_uid
      LIMIT ?`,
  ).all(companyId, limit) as Row[];
}

export type AvatarEnrichmentResult = {
  ok: boolean;
  eligible: number;
  checked: number;
  updated: number;
  failed: number;
};

/**
 * Manual, bounded enrichment. It uses no login state and touches only public
 * profile pages that are already stored as KOL homepages.
 */
export async function enrichMissingPublicAvatars(input: {
  limit?: number;
  companyId?: string;
  db?: SqliteConn;
} = {}): Promise<AvatarEnrichmentResult> {
  const db = input.db || getConn();
  const companyId = input.companyId || memoryCompanyId();
  const limit = Math.max(1, Math.min(32, Math.floor(Number(input.limit || 12))));
  const profiles = eligibleProfiles(companyId, limit, db);
  let updated = 0;
  let failed = 0;
  for (const profile of profiles) {
    const checkedAt = nowIso();
    try {
      const page = await fetchPublicHtml(String(profile.homepage_url));
      const avatarUrl = publicAvatarUrlFromHtml(page.html, page.pageUrl);
      if (!avatarUrl) throw new Error("主页未声明公开头像");
      await assertPublicHttpUrl(avatarUrl);
      db.prepare(
        `UPDATE kol_profile_index
            SET avatar_url=?, avatar_checked_at=?, avatar_error='', updated_at=?
          WHERE company_id=? AND kol_uid=? AND trim(COALESCE(avatar_url,''))=''`,
      ).run(avatarUrl, checkedAt, checkedAt, companyId, String(profile.kol_uid));
      updated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 180) : "公开头像抓取失败";
      db.prepare(
        `UPDATE kol_profile_index
            SET avatar_checked_at=?, avatar_error=?, updated_at=?
          WHERE company_id=? AND kol_uid=?`,
      ).run(checkedAt, message, checkedAt, companyId, String(profile.kol_uid));
      failed += 1;
    }
  }
  const result = { ok: true, eligible: profiles.length, checked: profiles.length, updated, failed };
  audit("system", "kol.memory.avatar_enrichment", { ...result, limit });
  return result;
}
