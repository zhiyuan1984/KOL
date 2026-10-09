import { describe, expect, it } from "vitest";
import type { PoolKol } from "./kolContract";
import {
  EMPTY_POOL_CLAIM_RECEIPTS,
  canStartPoolMutation,
  countsAfterPoolReceipts,
  isHighPoolScore,
  poolCandidateCards,
  poolScorePlaceholder,
  reducePoolClaimReceipts,
} from "./poolView";

function poolCard(kolUid: string, stage = "未首次建联"): PoolKol {
  return {
    kol_uid: kolUid,
    identity: { display: `@${kolUid}`, platform: "youtube" },
    metrics: {},
    public_stage: { label: stage },
  };
}

/**
 * 「未评分」必须能解释自己：从未评过 / 评过但置信度不足 / 评分失败，三种原因文案与 tooltip 都不同；
 * 缺公开指标时要把缺哪几项点名（Jev 只依据公开资料打分）。
 */
describe("pool score placeholder", () => {
  it("从未评过：文案是未评分，缺指标时点名缺什么", () => {
    const withMetrics = poolScorePlaceholder({ state: "unscored" }, []);
    expect(withMetrics.state).toBe("unscored");
    expect(withMetrics.label).toBe("未评分");
    expect(withMetrics.title).toContain("可用中栏「红人评分」执行");
    expect(withMetrics.title).not.toContain("缺 ");

    const missing = poolScorePlaceholder({ state: "unscored" }, ["均播", "互动率"]);
    expect(missing.label).toBe("未评分");
    expect(missing.title).toContain("缺 均播、互动率");
  });

  it("评过但资料不足：显示置信度并说明人工复核", () => {
    const placeholder = poolScorePlaceholder({
      state: "low_confidence",
      potential_confidence: 0.55,
      assessed_at: "2026-09-27T00:00:00.000Z",
    }, []);
    expect(placeholder.state).toBe("low_confidence");
    expect(placeholder.label).toBe("已评估 · 置信度 55%");
    expect(placeholder.title).toContain("人工复核");
    expect(placeholder.title).toContain("评估于");
  });

  it("调用失败：不伪装成「未评分」，提示可重试", () => {
    const placeholder = poolScorePlaceholder({ state: "failed", assessed_at: "2026-09-27T00:00:00.000Z" }, []);
    expect(placeholder.state).toBe("failed");
    expect(placeholder.label).toBe("评分失败");
    expect(placeholder.title).toContain("可重试");
  });

  it("口径随评分一起显示：tooltip 写明 AI 发现条件摘要", () => {
    const low = poolScorePlaceholder({
      state: "low_confidence",
      potential_confidence: 0.55,
      criteria_summary: "平台 youtube · 地区 global_en · 近10条均播 ≥5000",
    }, []);
    expect(low.title).toContain("口径 平台 youtube");
    expect(low.title).toContain("近10条均播 ≥5000");

    const unscored = poolScorePlaceholder({ state: "unscored" }, ["均播"]);
    expect(unscored.title).toContain("口径以执行前确认的条件为准");
  });

  it("高分徽章与置信度门槛一致（≥80 且 ≥0.7）", () => {
    expect(isHighPoolScore(85, 0.91)).toBe(true);
    expect(isHighPoolScore(85, 0.55)).toBe(false);
    expect(isHighPoolScore(50, 0.99)).toBe(false);
    expect(isHighPoolScore(null, 0.99)).toBe(false);
  });
});

describe("pool claim receipts", () => {
  it("keeps a successful claim as a release receipt, excludes it from candidates, then restores the claim action after release", () => {
    const card = poolCard("kol-1");
    const claimed = reducePoolClaimReceipts(EMPTY_POOL_CLAIM_RECEIPTS, {
      type: "claim-succeeded",
      receipt: { kolUid: card.kol_uid, followId: "follow-1", card },
    });

    expect(claimed[card.kol_uid]?.followId).toBe("follow-1");
    expect(poolCandidateCards([card], claimed)).toEqual([]);
    expect(countsAfterPoolReceipts({ newCount: 4, overdueCount: 2 }, claimed)).toEqual({ newCount: 3, overdueCount: 2 });

    const released = reducePoolClaimReceipts(claimed, { type: "release-succeeded", kolUid: card.kol_uid });
    expect(poolCandidateCards([card], released)).toEqual([card]);
  });

  it("does not switch the committed receipt state when a claim or release fails", () => {
    const card = poolCard("kol-1", "14天无回复");
    const claimed = reducePoolClaimReceipts(EMPTY_POOL_CLAIM_RECEIPTS, {
      type: "claim-succeeded",
      receipt: { kolUid: card.kol_uid, followId: "follow-1", card },
    });

    expect(reducePoolClaimReceipts(EMPTY_POOL_CLAIM_RECEIPTS, { type: "claim-failed" })).toBe(EMPTY_POOL_CLAIM_RECEIPTS);
    expect(reducePoolClaimReceipts(claimed, { type: "release-failed" })).toBe(claimed);
    expect(countsAfterPoolReceipts({ newCount: 4, overdueCount: 2 }, claimed)).toEqual({ newCount: 4, overdueCount: 1 });
  });

  it("blocks a second click during the same ownership mutation", () => {
    expect(canStartPoolMutation(null, "kol-1")).toBe(true);
    expect(canStartPoolMutation("kol-1", "kol-1")).toBe(false);
    expect(canStartPoolMutation("kol-2", "kol-1")).toBe(false);
  });

  it("clears temporary receipts whenever the query/filter/page scope changes", () => {
    const card = poolCard("kol-1");
    const claimed = reducePoolClaimReceipts(EMPTY_POOL_CLAIM_RECEIPTS, {
      type: "claim-succeeded",
      receipt: { kolUid: card.kol_uid, followId: "follow-1", card },
    });
    expect(reducePoolClaimReceipts(claimed, { type: "scope-reset" })).toBe(EMPTY_POOL_CLAIM_RECEIPTS);
  });
});
