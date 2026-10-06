import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import KeywordChipField, {
  addKeywordDraft,
  discoveryKeywordOptions,
  filterKeywordOptions,
  flushKeywordDraft,
  keywordKey,
  removeKeyword,
  splitKeywordDraft,
} from "./workspace/KeywordChipField";
import SkillParamCard, { followersRangeInvalid, formatCompactNumber, type SkillParamField } from "./workspace/SkillParamCard";

describe("关键词芯片：纯逻辑", () => {
  it("按回车添加：新词追加在已有芯片之后", () => {
    expect(addKeywordDraft(["camping"], "hiking")).toEqual(["camping", "hiking"]);
    expect(addKeywordDraft([], "camping")).toEqual(["camping"]);
  });

  it("空格属于英文短语，不拆分", () => {
    expect(splitKeywordDraft("portable power station")).toEqual(["portable power station"]);
    expect(addKeywordDraft([], "portable power station")).toEqual(["portable power station"]);
    expect(addKeywordDraft([], "  off grid living  ")).toEqual(["off grid living"]);
  });

  it("逗号与顿号仍可一次输入多个词", () => {
    expect(addKeywordDraft([], "camping, hiking、van life")).toEqual(["camping", "hiking", "van life"]);
  });

  it("大小写不敏感去重，保留首次输入形态", () => {
    expect(addKeywordDraft(["Camping"], "camping")).toEqual(["Camping"]);
    expect(addKeywordDraft(["Camping"], "CAMPING")).toEqual(["Camping"]);
    expect(addKeywordDraft(["Portable Power Station"], "portable power station")).toEqual(["Portable Power Station"]);
    expect(addKeywordDraft([], "camping, Camping, CAMPING")).toEqual(["camping"]);
  });

  it("空词与纯分隔符不生成芯片", () => {
    expect(keywordKey("  Camping  ")).toBe("camping");
    expect(addKeywordDraft([], "   ")).toEqual([]);
    expect(addKeywordDraft(["camping"], ", ，、")).toEqual(["camping"]);
  });

  it("flushDraft 把未回车的草稿并入有效关键词", () => {
    expect(flushKeywordDraft(["camping"], "van life")).toEqual(["camping", "van life"]);
    expect(flushKeywordDraft(["camping"], "")).toEqual(["camping"]);
    expect(flushKeywordDraft(["camping"], "Camping")).toEqual(["camping"]);
    expect(flushKeywordDraft([], "camping, hiking")).toEqual(["camping", "hiking"]);
  });

  it("删除只影响对应的那一个词", () => {
    expect(removeKeyword(["camping", "hiking"], "camping")).toEqual(["hiking"]);
    expect(removeKeyword(["Camping", "hiking"], "camping")).toEqual(["hiking"]);
    expect(removeKeyword(["camping"], "找不到的词")).toEqual(["camping"]);
  });

  it("候选 = 方向包关键词去重，已选词不再出现", () => {
    const options = discoveryKeywordOptions();
    expect(options).toContain("camping gear");
    expect(options.length).toBe(new Set(options.map((word) => word.toLowerCase())).size);
    expect(filterKeywordOptions(options, ["camping"], "")).not.toContain("camping");
    expect(filterKeywordOptions(options, [], "van")[0]).toBe("van life");
    expect(filterKeywordOptions(options, [], "zzz")).toEqual([]);
  });
});

describe("粉丝上限「不限」与只读数值", () => {
  it("上限留空即不限，不算越界", () => {
    expect(followersRangeInvalid(10000, null)).toBe(false);
    expect(followersRangeInvalid(10000, "")).toBe(false);
    expect(followersRangeInvalid(10000, undefined)).toBe(false);
  });

  it("只有上限低于下限才提示（相等不算）", () => {
    expect(followersRangeInvalid(10000, 9999)).toBe(true);
    expect(followersRangeInvalid(10000, 10000)).toBe(false);
    expect(followersRangeInvalid(10000, 20000)).toBe(false);
  });

  it("只读数值：null 上限渲染「不限」，零值照旧，其余千位分隔", () => {
    expect(formatCompactNumber("max_followers", null)).toBe("不限");
    expect(formatCompactNumber("min_followers", 10000)).toBe("10,000");
    expect(formatCompactNumber("expect_count", 0)).toBe("0");
    expect(formatCompactNumber("min_followers", "")).toBe("未填写");
  });
});

/** E2E 与别的组件都按这套 data-* 契约取元素，改渲染结构时这里先红。 */
const CARD_FIELDS: SkillParamField[] = [
  { key: "platforms", label: "平台", kind: "multiple", max: 1, options_source: "api:/home/discovery/template#platforms" },
  { key: "region", label: "地区", kind: "single", options_source: "api:/home/discovery/template#regions" },
  { key: "directions", label: "方向", kind: "multiple", max: 8, options_source: "api:/home/discovery/template#directions" },
  { key: "keywords", label: "关键词", kind: "text" },
  { key: "min_followers", label: "粉丝数下限", kind: "number" },
  { key: "max_followers", label: "粉丝数上限", kind: "number" },
  { key: "min_avg_plays_10", label: "近10条均播", kind: "number" },
  { key: "expect_count", label: "期望人数", kind: "number" },
];
const CARD_VALUES = {
  platforms: ["youtube"],
  region: "na",
  directions: ["camping"],
  keywords: ["camping", "portable power station"],
  min_followers: 10000,
  max_followers: null,
  min_avg_plays_10: 5000,
  expect_count: 30,
};
const CARD_OPTIONS = {
  platforms: [{ code: "youtube", label: "YouTube" }],
  regions: [{ code: "na", label: "北美" }],
  directions: [{ code: "camping", label: "户外露营", keywords: ["camping", "camping gear"] }],
};

describe("条件卡 DOM 契约", () => {
  it("关键词控件：芯片、输入位、清空按钮与 data-* 逐条落地", () => {
    const html = renderToStaticMarkup(createElement(KeywordChipField, {
      value: ["camping", "portable power station"],
      options: ["camping", "van life"],
    }));
    expect(html).toContain('class="ai-discovery-text-control is-keyword-control"');
    expect(html).toContain("data-discovery-keywords-control");
    expect(html).toContain("data-discovery-keywords=");
    expect(html).toContain('data-discovery-keyword-chip="camping"');
    expect(html).toContain('class="chip-x"');
    expect(html).toContain("data-discovery-keyword-remove");
    expect(html).toContain('aria-label="删除关键词 camping"');
    expect(html).toContain('data-discovery-keywords-input="true"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("data-discovery-clear-keywords");
    expect(html).toContain('aria-label="清除关键词"');
    // 候选列表只在展开时渲染；芯片容器本体不预渲染候选。
    expect(html).not.toContain("data-discovery-keyword-options");
  });

  it("只读态沿用紧凑分组：值不带控件、上限 null 显示不限", () => {
    const html = renderToStaticMarkup(createElement(SkillParamCard, {
      fields: CARD_FIELDS,
      values: CARD_VALUES,
      mode: "ready",
      hideTitle: true,
      compactDiscoveryLayout: true,
      tokenFields: ["keywords"],
      optionSets: CARD_OPTIONS,
    }));
    expect(html).toContain('data-param-mode="ready"');
    expect(html).toContain('data-skill-param-group="followers_range"');
    expect(html).toContain('data-skill-param-group="discovery_metrics"');
    expect(html).toContain("data-discovery-keyword-static");
    expect(html).not.toContain("data-discovery-keyword-remove");
    expect(html).toContain("10,000");
    expect(html).toContain("不限");
    expect(html).toContain("北美");
    expect(html).not.toContain(">na<");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("data-discovery-followers-hint");
  });

  it("编辑态：上限可留空（placeholder 不限）、有说明与越界提示", () => {
    const html = renderToStaticMarkup(createElement(SkillParamCard, {
      fields: CARD_FIELDS,
      values: { ...CARD_VALUES, min_followers: 20000, max_followers: 10000 },
      hideTitle: true,
      compactDiscoveryLayout: true,
      tokenFields: ["keywords"],
      optionSets: CARD_OPTIONS,
    }));
    expect(html).toContain('placeholder="不限"');
    expect(html).toContain("data-discovery-followers-hint");
    expect(html).toContain("上限低于下限");
    expect(html).toContain('data-discovery-keywords="true"');
  });
});
