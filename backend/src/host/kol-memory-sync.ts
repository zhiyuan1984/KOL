/**
 * Starry → A/C memory sync. Host connectors only.
 * pageKolProfiles / getKolProfileDetail → A
 * pageEmailConversations only for B.active → C with effective=0/1
 */
import { audit, nowIso } from "../db.js";
import { conversationIdOf, conversationSubject, firstString, listOf, messageOccurredAt } from "../starrykol/mail-fields.js";
import type { Json } from "../types.js";
import {
  classifyCorrespondenceKind,
  isEffectiveCorrespondence,
  listActiveFollows,
  memoryCompanyId,
  upsertPublicProfile,
  upsertThreadSummary,
  type EffectiveKind,
} from "./kol-memory.js";
import { getKolProfileDetail, pageEmailConversations, pageKolProfiles } from "./starry-connectors.js";

function homepageOf(profile: Json): string {
  return firstString(
    profile.homepageUrl, profile.homepage, profile.platformUrl, profile.profileUrl,
    profile.homePage, profile.url,
  );
}

function upsertAFromProfile(profile: Json, sourceVersion?: string): void {
  const kolUid = firstString(profile.kolUid, profile.kol_uid, profile.uid);
  if (!kolUid) return;
  upsertPublicProfile({
    company_id: memoryCompanyId(),
    kol_uid: kolUid,
    handle: firstString(profile.kolName, profile.nickname, profile.name, profile.handle),
    display_name: firstString(profile.kolName, profile.nickname, profile.displayName, profile.name),
    platform: firstString(profile.platform, profile.primaryPlatform),
    homepage_url: homepageOf(profile),
    avatar_url: firstString(profile.avatarUrl, profile.avatar_url, profile.avatar, profile.profileImage, profile.profile_image),
    followers: firstString(profile.followers, profile.followerCount, profile.followerCountTenThousands),
    avg_plays: firstString(profile.avgVideoViews10, profile.avg_views_10, profile.avgPlays),
    engagement: firstString(profile.avgVideoEngagementRate10, profile.engagementRate, profile.engagement_rate),
    direction: firstString(profile.niche, profile.nicheTagsText, profile.direction),
    region: firstString(profile.countryName, profile.country, profile.audienceGeo, profile.region),
    style: firstString(Array.isArray(profile.followStyleTags) ? profile.followStyleTags.join(",") : "", profile.style),
    ingest_source: "starry.pageKolProfiles",
    public_stage: firstString(profile.cooperationStageName, profile.stageName, profile.stage),
    source_version: sourceVersion,
  });
}

export async function syncKolProfileIndex(pageSize = 50): Promise<{ ok: boolean; count: number; tool: string; error?: string }> {
  const syncedAt = nowIso();
  try {
    let pageNo = 1;
    let count = 0;
    for (;;) {
      const data = await pageKolProfiles({ pageNo, pageSize });
      const rows = listOf(data);
      for (const profile of rows) {
        upsertAFromProfile(profile, syncedAt);
        const kolUid = firstString(profile.kolUid, profile.kol_uid);
        if (kolUid) {
          try {
            const detail = await getKolProfileDetail(kolUid);
            upsertAFromProfile({ ...profile, ...detail }, syncedAt);
          } catch {
            /* list row is enough; detail is optional enrichment */
          }
        }
        count += 1;
      }
      const total = Number(data.total || 0);
      if (!rows.length || (total && pageNo * pageSize >= total) || rows.length < pageSize) break;
      pageNo += 1;
      if (pageNo > 20) break;
    }
    audit("host", "kol.memory.profile_sync", { count, tool: "pageKolProfiles" });
    return { ok: true, count, tool: "pageKolProfiles" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit("host", "kol.memory.profile_sync_failed", { error: message });
    return { ok: false, count: 0, tool: "pageKolProfiles", error: message };
  }
}

function conversationEffective(conv: Json): { effective: 0 | 1; kind: EffectiveKind } {
  const subject = conversationSubject(conv);
  const status = firstString(conv.status, conv.deliveryStatus, conv.sendStatus);
  const kind = classifyCorrespondenceKind({
    subject,
    body: firstString(conv.snippet, conv.lastSnippet, conv.body),
    from: firstString(conv.from, conv.sender, conv.mailer),
    status,
  });
  const gatewaySuccess = !/fail|bounce|undeliver/i.test(status) && kind === "human";
  const direction = firstString(conv.direction, conv.lastDirection) || "outbound";
  const effective = isEffectiveCorrespondence({
    gatewaySuccess,
    direction: /in/i.test(direction) ? "inbound" : "outbound",
    kind,
    subject,
    body: firstString(conv.snippet, conv.body),
    from: firstString(conv.from, conv.sender),
    status,
  });
  return { effective: effective ? 1 : 0, kind };
}

export async function syncActiveFollowThreads(): Promise<{ ok: boolean; follows: number; threads: number; error?: string }> {
  const follows = listActiveFollows();
  let threads = 0;
  try {
    for (const follow of follows) {
      const data = await pageEmailConversations({
        pageNo: 1,
        pageSize: 20,
        keyword: follow.kol_uid,
      });
      const conversations = listOf(data);
      for (const conv of conversations) {
        const conversationId = conversationIdOf(conv);
        const { effective } = conversationEffective(conv);
        upsertThreadSummary({
          follow_id: String(follow.id),
          company_id: String(follow.company_id),
          kol_uid: String(follow.kol_uid),
          conversation_id: conversationId,
          subject: conversationSubject(conv),
          participants: firstString(conv.recipientEmail, conv.mailboxEmail),
          last_at: messageOccurredAt(conv) || firstString(conv.lastMessageAt, conv.updatedAt),
          effective,
          mail_refs: conversationId,
          source_version: nowIso(),
        });
        threads += 1;
      }
    }
    audit("host", "kol.memory.thread_sync", { follows: follows.length, threads, tool: "pageEmailConversations" });
    return { ok: true, follows: follows.length, threads };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit("host", "kol.memory.thread_sync_failed", { error: message });
    return { ok: false, follows: follows.length, threads, error: message };
  }
}

export async function syncKolMemoryIndexes(): Promise<Json> {
  const profiles = await syncKolProfileIndex();
  const threads = await syncActiveFollowThreads();
  return { profiles, threads, decryptKolContact: false };
}
