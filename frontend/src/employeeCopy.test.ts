import { describe, expect, it } from "vitest";
import { stripEngineCopy } from "./employeeCopy";

describe("stripEngineCopy", () => {
  it("removes the remote surface name without leaving a broken sentence", () => {
    const out = stripEngineCopy("Starry KOL MCP 连接器本轮不可用");
    expect(out).not.toMatch(/MCP/i);
    expect(out).not.toContain("Starry");
    expect(out).not.toMatch(/\s{2,}/);
    expect(out).toBe("数据连接器本轮不可用");
  });

  it("maps a skill id to its employee name instead of leaking the id", () => {
    const out = stripEngineCopy("我会按 creator_library_query 技能执行");
    expect(out).not.toContain("creator_library_query");
    expect(out).toContain("达人库查询");
    expect(out).not.toMatch(/\s{2,}/);
  });

  it("drops unknown engine ids and tool aliases", () => {
    expect(stripEngineCopy("skill_runtime 已就绪")).not.toContain("skill_runtime");
    expect(stripEngineCopy("rt_9f2c1a 调用完成")).not.toContain("rt_9f2c1a");
    expect(stripEngineCopy("starrykol.previewEmailDraft 已返回")).toBe("已返回");
  });

  it("keeps ordinary business prose untouched", () => {
    for (const copy of [
      "已完成达人库查询，命中 12 位达人。",
      "报价待确认，今天需要发出报价。",
      "以下是《退货政策 v4》的口径。",
      "Hi Amy, thanks for reading — best_regards 请按模板替换。",
    ]) {
      const out = stripEngineCopy(copy);
      expect(out).not.toMatch(/MCP|Codex|Thread/);
      expect(out.replace(/\s+/g, " ")).toBe(copy.replace(/\s+/g, " "));
    }
  });

  it("keeps the meaning of a sentence that only drops engine words", () => {
    expect(stripEngineCopy("Using Codex MCP to read the notes for camping creators."))
      .toBe("Using to read the notes for camping creators.");
  });

  it("keeps thread / skill in English letters but drops them as jargon inside Chinese", () => {
    const letter = "Hi Amy, replying in this email thread — your editing skill really shows.";
    expect(stripEngineCopy(letter)).toBe(letter);
    expect(stripEngineCopy("本轮调用 Skill 完成整理")).toBe("本轮调用完成整理");
    expect(stripEngineCopy("Thread 已结束")).toBe("已结束");
  });
});
