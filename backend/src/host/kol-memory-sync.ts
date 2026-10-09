/**
 * Starry → A/C memory sync. Host connectors only.
 * pageKolProfiles / getKolProfileDetail → A
 * pageEmailConversations only for B.active → C with effective=0/1
 */
import { persistStarryOwnership } from "../postgres/kol-source-authority.js";
import { audit, nowIso } from "../db.js";
import { mailPreview } from "./mail-preview.js";
import { conversationIdOf, conversationSubject, firstString, listOf, messageOccurredAt } from "../starrykol/mail-fields.js";
import type { Json } from "../types.js";
import {
  classifyCorrespondenceKind,
  isEffectiveCorrespondence,
  listActiveFollows,
  memoryCompanyId,
  recordEffectiveCorrespondence,
  upsertPublicProfile,
  upsertThreadSummary,
  type EffectiveKind,
} from "./kol-memory.js";
import { getKolProfileDetail, pageEmailConversations, pageKolProfiles } from "./starry-connectors.js";
import { avgPlaysOf, engagementWithSource, followersOf, geoOf, missingPublicMetrics } from "../starrykol/remote-metrics.js";

function homepageOf(profile: Json): string {
  return firstString(
    profile.homepageUrl, profile.homepage, profile.platformUrl, profile.profileUrl,
    profile.homePage, profile.url,
  );
}

function upsertAFromProfile(profile: Json, sourceVersion?: string): void {
  const kolUid = firstString(profile.kolUid, profile.kol_uid, profile.uid);
  if (!kolUid) return;
  const engagement = engagementWithSource(profile);
  upsertPublicProfile({
    company_id: memoryCompanyId(),
    kol_uid: kolUid,
    handle: firstString(profile.kolName, profile.nickname, profile.name, profile.accountHandle, profile.handle),
    display_name: firstString(profile.kolName, profile.nickname, profile.displayName, profile.accountHandle, profile.name),
    platform: firstString(profile.platform, profile.primaryPlatform),
    homepage_url: homepageOf(profile),
    avatar_url: firstString(profile.avatarUrl, profile.avatar_url, profile.avatar, profile.profileImage, profile.profile_image),
    // 远端只保证 followerCountTenThousands（万）；走共享口径，和 board 路径同量级。
    followers: followersOf(profile),
    avg_plays: avgPlaysOf(profile),
    engagement: engagement.value,
    engagement_source: engagement.source,
    direction: firstString(profile.niche, profile.nicheTagsText, profile.direction),
    region: geoOf(profile) || firstString(profile.region),
    style: firstString(Array.isArray(profile.followStyleTags) ? profile.followStyleTags.join(",") : "", profile.style),
    ingest_source: "starry.pageKolProfiles",
    public_stage: firstString(profile.cooperationStageName, profile.stageName, profile.stage),
    source_version: sourceVersion,
  });
}

export async function syncKolProfileIndex(pageSize = 50): Promise<{
  ok: boolean;
  count: number;
  tool: string;
  /** 缺公开指标（粉丝/均播/互动/方向）的条数：Jev 只依据公开资料评分，这些行大概率评不出分。 */
  missing_metrics: number;
  error?: string;
}> {
  const syncedAt = nowIso();
  try {
    let pageNo = 1;
    let count = 0;
    let missingMetrics = 0;
    let detailFailed = 0;
    const detailFailedSamples: string[] = [];
    for (;;) {
      const data = await pageKolProfiles({ pageNo, pageSize });
      const rows = listOf(data);
      for (const profile of rows) {
        await persistStarryOwnership([profile], memoryCompanyId(), syncedAt);
        upsertAFromProfile(profile, syncedAt);
        const kolUid = firstString(profile.kolUid, profile.kol_uid);
        let merged = profile;
        if (kolUid) {
          try {
            const detail = await getKolProfileDetail(kolUid);
            merged = { ...profile, ...detail };
            await persistStarryOwnership([merged], memoryCompanyId(), syncedAt);
            upsertAFromProfile(merged, syncedAt);
          } catch (error) {
            // 详情是可选补全，但失败必须留痕：此前静默吞掉，主页/头像等字段缺了没人知道。
            detailFailed += 1;
            if (detailFailedSamples.length < 10) detailFailedSamples.push(kolUid);
            audit("host", "kol.memory.profile_detail_failed", {
              kol_uid: kolUid,
              error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
            });
          }
        }
        if (missingPublicMetrics(merged).length) missingMetrics += 1;
        count += 1;
      }
      const total = Number(data.total || 0);
      if (!rows.length || (total && pageNo * pageSize >= total) || rows.length < pageSize) break;
      pageNo += 1;
      if (pageNo > 20) break;
    }
    audit("host", "kol.memory.profile_sync", {
      count, tool: "pageKolProfiles", missing_metrics: missingMetrics, detail_failed: detailFailed,
      detail_failed_samples: detailFailedSamples,
    });
    return { ok: true, count, tool: "pageKolProfiles", missing_metrics: missingMetrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit("host", "kol.memory.profile_sync_failed", { error: message });
    return { ok: false, count: 0, tool: "pageKolProfiles", missing_metrics: 0, error: message };
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
        const subject = conversationSubject(conv);
        const occurredAt = messageOccurredAt(conv) || firstString(conv.lastMessageAt, conv.updatedAt);
        const direction = firstString(conv.direction, conv.lastDirection);
        upsertThreadSummary({
          follow_id: String(follow.id),
          company_id: String(follow.company_id),
          kol_uid: String(follow.kol_uid),
          conversation_id: conversationId,
          subject,
          participants: firstString(conv.recipientEmail, conv.mailboxEmail),
          last_at: occurredAt,
          effective,
          key_agreements: mailPreview(firstString(conv.snippet, conv.lastSnippet, conv.body)),
          mail_refs: conversationId,
          source_version: nowIso(),
        });
        if (effective) {
          recordEffectiveCorrespondence({
            followId: String(follow.id),
            kolUid: String(follow.kol_uid),
            direction: /in/i.test(direction) ? "inbound" : "outbound",
            occurredAt,
            gatewaySuccess: true,
            subject,
            body: firstString(conv.snippet, conv.lastSnippet, conv.body),
          });
        }
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
