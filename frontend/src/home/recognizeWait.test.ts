import { describe, expect, it } from "vitest";
import {
  RECOGNIZE_WAIT_LINES,
  RECOGNIZE_WAIT_OVERDUE,
  revealWaitLines,
} from "./recognizeWait";

describe("recognize wait copy", () => {
  it("tells the same three beats for every entry, on its own lines", () => {
    const text = RECOGNIZE_WAIT_LINES.join("");
    expect(text).toContain("我读懂了");
    expect(text).toContain("正在分析你的问题");
    expect(text).toContain("开始执行");
    expect(RECOGNIZE_WAIT_LINES.length).toBeGreaterThan(1);
    // 缺字段 / 要定方向时先问一句，不把「执行」说成一定发生。
    expect(text).toContain("需要你确认");
    expect(RECOGNIZE_WAIT_OVERDUE).toContain("继续等");
  });

  it("reveals the text character by character and stops at the last one", () => {
    const lines = ["甲甲", "乙乙", "丙丙"];
    expect(revealWaitLines(lines, 0)).toEqual({ visible: ["甲"], done: false });
    // 30ms 一个字：90ms 走到第 3 个字（第二行半句）。
    expect(revealWaitLines(lines, 90)).toEqual({ visible: ["甲甲", "乙"], done: false });
    expect(revealWaitLines(lines, 180)).toEqual({ visible: ["甲甲", "乙乙", "丙丙"], done: true });
    // 过后不再增长。
    expect(revealWaitLines(lines, 10_000)).toEqual({ visible: ["甲甲", "乙乙", "丙丙"], done: true });
  });

  it("keeps the reveal a growing prefix, never a rewrite", () => {
    const lines = RECOGNIZE_WAIT_LINES;
    let previous = "";
    for (const elapsed of [0, 40, 120, 300, 600, 900, 1200, 2000]) {
      const current = revealWaitLines(lines, elapsed).visible.join("");
      expect(current.startsWith(previous)).toBe(true);
      previous = current;
    }
    expect(revealWaitLines(lines, 2000).done).toBe(true);
  });
});
