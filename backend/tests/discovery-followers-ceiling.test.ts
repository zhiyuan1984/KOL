/**
 * 粉丝上限「不限」= `max_followers: null` 的纯函数契约。
 *
 * 这些是被员工清空上限时直接读到的地方（校验 / 口径文案 / 模型状态），不依赖 PostgreSQL，
 * 因此在没有测试库的机器上也能跑；PG 侧的过滤与投递由 home-discovery / skill-runtime-execution
 * / kol-memory 三个套件覆盖。
 */
import { describe, expect, it } from "vitest";
import { validateWorkspaceBrief } from "../src/crawl/discovery-workspace.js";
import { HttpFail } from "../src/host/errors.js";
import { criteriaState, criteriaSummary, normalizeScoringCriteria } from "../src/host/kol-scoring-criteria.js";

const brief = {
  platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"],
  min_followers: 10_000, max_followers: null, min_avg_plays_10: 100, expect_count: 10,
};
const invalid = (input: unknown) => expect(() => validateWorkspaceBrief(input)).toThrow(HttpFail);

describe("discovery brief 的粉丝上限不限", () => {
  it("接受显式 null 并原样返回，不替换成 0 或默认上限", () => {
    expect(validateWorkspaceBrief(brief)).toMatchObject({ max_followers: null, min_followers: 10_000 });
    expect(validateWorkspaceBrief({ ...brief, max_followers: 2_000_000 })).toMatchObject({ max_followers: 2_000_000 });
  });

  it("只有显式 null 是不限：负数、上限低于下限仍然拒绝；缺上限按不限处理", () => {
    expect(validateWorkspaceBrief({ ...brief, max_followers: undefined })).toMatchObject({ max_followers: null });
    invalid({ ...brief, max_followers: -1 });
    invalid({ ...brief, min_followers: 30_000, max_followers: 20_000 });
  });

  it("其余校验不因不限而放宽", () => {
    invalid({ ...brief, expect_count: 81 });
    invalid({ ...brief, expect_count: 0 });
    invalid({ ...brief, keywords: [] });
    invalid({ ...brief, region: "cn" });
  });
});

describe("评分口径的粉丝上限不限", () => {
  it("null 不被 clamp 成下限，文案写「至少 1 万，上限不限」", () => {
    const criteria = normalizeScoringCriteria(brief);
    expect(criteria?.max_followers).toBeNull();
    expect(criteriaSummary(criteria)).toContain("粉丝至少1万，上限不限");
    expect(criteriaState(criteria as NonNullable<typeof criteria>)).toContain('"followers_range":"至少10000，上限不限"');
  });

  it("缺省上限跟随默认口径：不限（null），不回落成数字上限", () => {
    const criteria = normalizeScoringCriteria({ ...brief, max_followers: undefined });
    expect(criteria?.max_followers).toBeNull();
    expect(criteriaSummary(criteria)).toContain("上限不限");
  });
});
