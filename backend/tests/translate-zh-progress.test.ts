import { describe, expect, it } from "vitest";
import {
  classifyMailSourceLanguage,
  isUsableInternalZh,
  splitLongTextForCodex,
  translateWithCodexChunksResumable,
} from "../src/starrykol/translate-zh.js";

function longSyntheticUnicode(): string {
  let source = "";
  while (Array.from(source).length <= 12_100) source += `unique synthetic English ${source.length} 😀\n`;
  return source;
}

describe("Codex 长正文恢复与语言可用性", () => {
  it("Unicode 分片可无损重构，恢复时只调用缺失片且不返回前缀", async () => {
    const source = longSyntheticUnicode();
    const chunks = splitLongTextForCodex(source);
    expect(chunks.join("")).toBe(source);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 4_000)).toBe(true);
    const persisted = ["第一片真实中文翻译，内容足够用于测试。"];
    const called: string[] = [];
    const result = await translateWithCodexChunksResumable(source, async (chunk) => {
      called.push(chunk);
      return `第${called.length + 1}片真实中文翻译，内容足够用于测试。`;
    }, {
      completedChunks: persisted,
      checkpoint: async ({ translation }) => { persisted.push(translation); return true; },
    });
    expect(called).toHaveLength(chunks.length - 1);
    expect(result.text).toContain("第一片真实中文翻译");
  });

  it("预算让出与任片失败都不把已完成前缀伪装成全文", async () => {
    const source = longSyntheticUnicode();
    const yielded = await translateWithCodexChunksResumable(source, async () => "不应调用", { shouldYield: () => true });
    expect(yielded).toMatchObject({ yielded: true });
    expect(yielded.text).toBeUndefined();
    let calls = 0;
    const failed = await translateWithCodexChunksResumable(source, async () => {
      calls += 1;
      return calls === 2 ? null : "这是一段真实的中文翻译，用于验证完整性。";
    });
    expect(failed.text).toBeUndefined();
    expect(failed.error).toBe("codex_chunk_unavailable");
    expect(calls).toBe(2);
  });

  it("中文、混合、短英文翻译、占位和英文回显遵守不同语义", () => {
    expect(classifyMailSourceLanguage("最新失败项为中文正文，已经足够明确。")).toMatchObject({ kind: "source_zh", reason: "source_chinese" });
    expect(classifyMailSourceLanguage("这是中文，但 please send rate card 仍需翻译。")).toMatchObject({ kind: "needs_model", reason: "mixed_substantive_english" });
    expect(classifyMailSourceLanguage("我同意 deal").kind).toBe("needs_model");
    expect(classifyMailSourceLanguage("请访问 https://example.test").kind).toBe("needs_model");
    expect(classifyMailSourceLanguage("型号 12V").kind).toBe("needs_model");
    expect(isUsableInternalZh("谢谢", "thanks")).toBe(true);
    expect(isUsableInternalZh("【内部中文译稿 · 不会进入 SMTP】", "thanks")).toBe(false);
    expect(isUsableInternalZh("内部转述：这是英文草稿里的合作跟进内容。\n发送仍用英文原文，本段仅内部查看。", "thanks")).toBe(false);
    expect(isUsableInternalZh("译文：This English message must not be treated as Chinese translation.", "This English message must not be treated as Chinese translation.")).toBe(false);
    expect(isUsableInternalZh("好的，This is a very long English message that must be rejected rather than masked by Chinese.", "This is a very long English message that must be rejected rather than masked by Chinese.")).toBe(false);
  });
});
