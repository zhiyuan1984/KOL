import { describe, expect, it } from "vitest";
import { CodexUnavailable } from "../src/worker/errors.js";
import { completeTurnItems } from "../src/worker/session-items.js";

describe("CodexUnavailable.asDict", () => {
  it("surfaces the thrown message and next_action instead of a generic input hint", () => {
    const err = new CodexUnavailable(
      "生成已结束，但没有产出可映射的邮件草稿。Host 没有代填。",
      "请重试；若仍失败，请管理员查看该次运行记录（是否调用了预览草稿 / Starry KOL MCP）。",
    );
    expect(err.asDict()).toMatchObject({
      code: "generation_unavailable",
      status: "暂时无法生成",
      message: "生成已结束，但没有产出可映射的邮件草稿。Host 没有代填。",
      next_action: "请重试；若仍失败，请管理员查看该次运行记录（是否调用了预览草稿 / Starry KOL MCP）。",
      ok: false,
      synthesized: false,
    });
    expect(JSON.stringify(err.asDict())).not.toContain("请检查任务输入后重试");
  });

  it("does not ask the operator to check quote input when Codex produced no mail result", async () => {
    const prev = process.env.CODEX_MODE;
    process.env.CODEX_MODE = "real";
    try {
      await completeTurnItems("email_compose", { raw: "写报价邮件 @灵工连通测试-qiyou1984 金额 USD 1000" }, [], []);
      throw new Error("expected CodexUnavailable");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexUnavailable);
      const dict = (error as CodexUnavailable).asDict();
      expect(dict.message).toBe("生成已结束，但没有产出可映射的邮件草稿。Host 没有代填。");
      expect(String(dict.next_action)).toMatch(/运行记录/);
      expect(String(dict.next_action)).not.toContain("请检查任务输入后重试");
    } finally {
      process.env.CODEX_MODE = prev;
    }
  });
});
