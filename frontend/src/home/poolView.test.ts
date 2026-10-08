import { describe, expect, it } from "vitest";
import { isHighPoolScore, poolScorePlaceholder } from "./poolView";

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

  it("评过但置信度不足：显示置信度并说明低于 70% 不给分", () => {
    const placeholder = poolScorePlaceholder({
      state: "low_confidence",
      potential_confidence: 0.55,
      assessed_at: "2026-09-27T00:00:00.000Z",
    }, []);
    expect(placeholder.state).toBe("low_confidence");
    expect(placeholder.label).toBe("已评估 · 置信度 55%");
    expect(placeholder.title).toContain("低于 70%");
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
