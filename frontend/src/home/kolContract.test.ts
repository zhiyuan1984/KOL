import { describe, expect, it } from "vitest";
import {
  ANALYZE_QUEUED_COPY,
  analyzePrefillPrompt,
  briefPriorityOf,
  clockFromRow,
  followHasDiscoveryField,
  followKolToRecord,
  isActiveFollowRow,
  isAnalyzePrefill,
  isOpenPoolRow,
  poolHasBannedField,
  selectAllMax8,
  sortByFollowedBriefPriority,
  toFollowKol,
  runningBadgeCount,
  runningBadgeHref,
  toPoolKol,
  toggleSelectMax8,
  type FollowKol,
  type PoolKol,
} from "./kolContract";
import { briefingForFollowed, followedBriefPriority } from "./FollowedBrief";
import { projectFollowedKolCard } from "../followedKolCard";
import { homeEntryById } from "./entryRegistry";

function pool(partial: Partial<PoolKol> & Pick<PoolKol, "kol_uid">): PoolKol {
  return {
    identity: { display: "@户外充电君", platform: "YouTube" },
    metrics: { followers: "12万", avg_plays: "3万", engagement: "4.2%" },
    public_stage: { code: "PUBLIC_POOL", label: "公海" },
    ...partial,
  };
}

function follow(partial: Partial<FollowKol> & Pick<FollowKol, "kol_uid" | "brief_priority">): FollowKol {
  return {
    identity: { display: "@小美妆日记", platform: "YouTube" },
    stage: { code: "INTERESTED", label: "已回复-有兴趣" },
    latest_correspondence: { valid: true, summary: "想和贵品牌合作", at: "2026-09-01T00:00:00Z" },
    clock_14d: { release_scheduler: false, label: "14 日计时（只读）· 剩 10 天", days_since_interaction: 4, countdown: true },
    risk: { chips: [] },
    ...partial,
  };
}

describe("kol workbench contract (#172)", () => {
  it("maps GET /api/home/pool publicProfileFields and strips private keys", () => {
    const card = toPoolKol({
      id: "kpi_outdoor",
      company_id: "company:amperetime",
      kol_uid: "uid_outdoor",
      handle: "户外充电君",
      display_name: "户外充电君",
      platform: "youtube",
      homepage_url: "https://www.youtube.com/@outdoor",
      followers: "120000",
      avg_plays: "30000",
      engagement: "0.042",
      direction: "vanlife",
      region: "北美",
      style: "",
      ingest_source: "starry",
      ingested_at: "2026-08-01T00:00:00Z",
      idle: 1,
      public_stage: "公海",
      pool_status: "open",
      email: "secret@example.com",
      quote: "1200",
      contract: "ct_1",
      notes: "私有备注",
    });
    expect(card?.kol_uid).toBe("uid_outdoor");
    expect(card?.identity.display).toBe("@户外充电君");
    expect(card?.identity.profile_url).toContain("youtube");
    expect(card?.metrics.followers).toBe("12万");
    expect(card?.idle?.idle).toBe(true);
    expect(card?.idle?.label).toBe("闲置");
    expect(poolHasBannedField(card!)).toBeNull();
    expect(JSON.stringify(card)).not.toMatch(
      /unread|mail_threads|notes|release_due|email|quote|contract|wechat|owner_name|owner_mailbox|owner_user_id|last_conversation_id/,
    );
    expect(poolHasBannedField({ ...pool({ kol_uid: "uid_dirty" }), owner_mailbox: "ops@example.com" } as unknown as PoolKol)).toBe("owner_mailbox");
    expect(poolHasBannedField({ ...pool({ kol_uid: "uid_dirty" }), last_conversation_id: "conv_9" } as unknown as PoolKol)).toBe("last_conversation_id");
    expect(toPoolKol({ kol_uid: "uid_claimed", handle: "已领", pool_status: "claimed" })).toBeNull();
    expect(isOpenPoolRow({ pool_status: "claimed" })).toBe(false);
    expect(isOpenPoolRow({ pool_status: "open" })).toBe(true);

    // 未首次建联：有任何会话且不是无主 → 不是公海。
    expect(isOpenPoolRow({ pool_status: "open", last_conversation_id: "conv_1" })).toBe(false);
    expect(isOpenPoolRow({ pool_status: "open", lastConversationId: "conv_1" })).toBe(false);
    expect(isOpenPoolRow({ pool_status: "open", has_conversation: true })).toBe(false);
    expect(isOpenPoolRow({ pool_status: "open", has_conversation: false })).toBe(true);
    expect(toPoolKol({ kol_uid: "uid_talked", handle: "已建联", pool_status: "open", last_conversation_id: "conv_1" })).toBeNull();
    expect(toPoolKol({ kol_uid: "uid_plain", handle: "新红人", pool_status: "open" })?.public_stage?.label).toBe("未首次建联");

    // 无主也算公海：三个归属信号都空时，即使已有往来也入选，并标明原因。
    const unownedContacted = {
      kol_uid: "uid_unowned",
      handle: "无主",
      pool_status: "open",
      owner_name: null,
      owner_mailbox: null,
      owner_user_id: null,
      last_conversation_id: "conv_u",
    };
    expect(isOpenPoolRow(unownedContacted)).toBe(true);
    const unownedCard = toPoolKol(unownedContacted);
    expect(unownedCard).toMatchObject({ unowned: true, has_conversation: true, sea_reason: "unowned" });
    expect(unownedCard?.public_stage?.label).toBe("无主·已有往来");
    // 缺归属字段不能推定无主，否则所有行都会涌进公海。
    expect(isOpenPoolRow({ kol_uid: "uid_bare", pool_status: "open", last_conversation_id: "conv_b" })).toBe(false);
    // 有主 + 已建联 → 仍不进公海。
    expect(isOpenPoolRow({ pool_status: "open", owner_mailbox: "ops@example.com", last_conversation_id: "conv_o" })).toBe(false);
  });

  it("maps GET /api/home/following B.active clock and hides C/discovery fields", () => {
    const none = toFollowKol({
      id: "kpi_1",
      kol_uid: "uid_1",
      handle: "小美妆日记",
      display_name: "小美妆日记",
      platform: "youtube",
      follow_id: "kfi_1",
      status: "active",
      public_stage: "已拒绝",
      last_effective_mail_at: null,
      days_since_interaction: null,
      release_due_at: null,
      countdown: false,
      cron_eligible: false,
      last_interaction_at: null,
      followers: 999,
      score: 0.9,
    });
    expect(none?.follow_id).toBe("kfi_1");
    expect(none?.clock_14d.countdown).toBe(false);
    expect(none?.clock_14d.label).toBe("尚未有效往来");
    expect(none?.latest_correspondence.summary).toBe("尚未有效往来");
    expect(none?.brief_priority).toBe("refused");
    expect(followHasDiscoveryField(none!)).toBeNull();
    expect(none).not.toHaveProperty("followers");

    const ticking = clockFromRow({
      last_effective_mail_at: "2026-09-01T00:00:00Z",
      days_since_interaction: 12,
      countdown: true,
      cron_eligible: true,
    });
    expect(ticking.countdown).toBe(true);
    expect(ticking.near).toBe(true);
    expect(ticking.label).toContain("14 日计时");
  });

  it("FollowedBrief priority is 拒信 → 临近14日 → 有兴趣", () => {
    expect(briefPriorityOf({ refused: true, near: true, interested: true })).toBe("refused");
    expect(briefPriorityOf({ near: true, interested: true })).toBe("near_14d");
    expect(briefPriorityOf({ interested: true })).toBe("interested");
    const ranked = sortByFollowedBriefPriority([
      follow({ kol_uid: "i", brief_priority: "interested" }),
      follow({ kol_uid: "r", brief_priority: "refused", stage: { code: "REJECTED", label: "已拒绝" } }),
      follow({ kol_uid: "n", brief_priority: "near_14d" }),
    ]);
    expect(ranked.map((row) => row.kol_uid)).toEqual(["r", "n", "i"]);
  });

  it("selection caps at 8 and analyze prefill stays editable copy", () => {
    let ids: string[] = [];
    for (let i = 1; i <= 10; i += 1) ids = toggleSelectMax8(ids, `k${i}`, true);
    expect(ids).toHaveLength(8);
    expect(selectAllMax8(["a", "b", "c", "d", "e", "f", "g", "h", "i"], true)).toHaveLength(8);
    const prompt = analyzePrefillPrompt([pool({ kol_uid: "cr_outdoor" })], "pool");
    expect(isAnalyzePrefill(prompt)).toBe(true);
    expect(prompt).toContain("@户外充电君");
    expect(prompt).toContain("未首次建联");
    expect(analyzePrefillPrompt([pool({ kol_uid: "cr_outdoor" })], "following")).not.toContain("公海");
    expect(ANALYZE_QUEUED_COPY).toBe("已入队，等待 Codex");
    expect(ANALYZE_QUEUED_COPY).not.toContain("正在思考");
  });

  it("entry registry matches #172 ids and session flags", () => {
    expect(homeEntryById("list-pool")).toMatchObject({ kind: "memory", creates_session: false, route: "GET /api/home/pool" });
    expect(homeEntryById("list-followed")).toMatchObject({ kind: "memory", creates_session: false, route: "GET /api/home/following" });
    expect(homeEntryById("kol-analyze-enqueue")).toMatchObject({
      // d68a056 有意把该入口定为 command：它只写一条 queued work_item，
      // 不建会话、不调模型（见后端同构注册表与 /home/kol-analyze/enqueue 响应）。
      kind: "command",
      creates_session: false,
      calls_model: false,
      route: "POST /api/home/kol-analyze/enqueue",
    });
    expect(homeEntryById("claim-kol")).toMatchObject({ kind: "command", creates_session: false, route: "POST /api/kols/:kolUid/claim" });
    expect(homeEntryById("release-follow")).toMatchObject({ kind: "command", route: "POST /api/follows/:followId/release" });
    expect(homeEntryById("enqueue-kol-analyze")).toBeUndefined();
    expect(homeEntryById("claim-follow")).toBeUndefined();
    expect(homeEntryById("switch-tab")?.creates_session).toBe(false);
  });

  it("follow card projection keeps correspondence and omits pool mail-digest dialect", () => {
    const record = followKolToRecord(follow({
      kol_uid: "uid_1",
      follow_id: "kfi_1",
      collaboration_id: "col_1",
      brief_priority: "refused",
      stage: { code: "REJECTED", label: "已拒绝" },
      latest_correspondence: { valid: true, summary: "拒信：暂不合作", thread_id: "t1" },
    }));
    expect(record.follow_id).toBe("kfi_1");
    const card = projectFollowedKolCard(record);
    expect(card.latest_fact.summary).toContain("拒信");
    expect(followedBriefPriority(card)).toBe("refused");
    expect(briefingForFollowed([card]).priority).toBe("refused");
    expect(card.identity.display).toBe("@小美妆日记");
  });

  it("following list keeps B.active only and 进行中 counts kol_analyze work/sessions", () => {
    expect(isActiveFollowRow({ follow_id: "kfi_1", status: "active", kol_uid: "u1" })).toBe(true);
    expect(isActiveFollowRow({ follow_id: "kfi_1", status: "released", kol_uid: "u1" })).toBe(false);
    expect(runningBadgeCount({
      sessions: [],
      analyzeItems: [{ id: "tsk_analyze_1", status: "queued", task_type: "kol_analyze" }],
    })).toBe(1);
    expect(runningBadgeHref({
      sessions: [],
      analyzeItems: [{ id: "tsk_analyze_1", status: "queued", task_type: "kol_analyze" }],
    })).toBe("/?tab=todo");
    expect(runningBadgeHref({
      sessions: [],
      analyzeItems: [{ id: "tsk_analyze_1", status: "queued", session_id: "ses_1", task_type: "kol_analyze" }],
    })).toBe("/s/ses_1");
  });
});
