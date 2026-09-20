import { describe, expect, it } from "vitest";
import { clampCountInput, discoveryTaskSummaryRows } from "./discoveryBriefForm";
import { defaultDiscoveryBrief } from "./discoveryTemplate";

describe("discovery brief form helpers", () => {
  it("renders the 发现任务 summary in the wireframe order with 未选/未填 copy", () => {
    const rows = discoveryTaskSummaryRows(defaultDiscoveryBrief());
    expect(rows.map((row) => row.label)).toEqual([
      "平台", "地区", "方向", "关键词", "粉丝", "近10条均播", "期望人数",
    ]);
    const value = (label: string) => rows.find((row) => row.label === label)?.value;
    expect(value("平台")).toBe("（未选）");
    expect(value("地区")).toBe("全球英文");
    expect(value("方向")).toBe("（未选）");
    expect(value("关键词")).toBe("户外露营, 户外能源");
    expect(value("粉丝")).toBe("10000–2000000");
    expect(value("近10条均播")).toBe("≥ 5000");
    expect(value("期望人数")).toBe("30");
    expect(rows.find((row) => row.label === "关键词")?.wide).toBe(true);
  });

  it("reflects chosen chips", () => {
    const rows = discoveryTaskSummaryRows({
      ...defaultDiscoveryBrief(),
      platforms: ["youtube"],
      directions: ["camping", "portable_power"],
      keywords: ["camping", "portable power station"],
    });
    const value = (label: string) => rows.find((row) => row.label === label)?.value;
    expect(value("平台")).toBe("YouTube");
    expect(value("方向")).toBe("户外露营、户外能源");
    expect(value("关键词")).toBe("camping, portable power station");
  });

  it("never lets a numeric field go NaN", () => {
    expect(clampCountInput("", 10000)).toBe(10000);
    expect(clampCountInput("abc", 30)).toBe(30);
    expect(clampCountInput("-5", 30)).toBe(30);
    expect(clampCountInput("12000", 10000)).toBe(12000);
    expect(clampCountInput("12.7", 30)).toBe(12);
  });
});
