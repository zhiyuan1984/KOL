import { describe, expect, it } from "vitest";
import { INTERNAL_ZH_HEADER, splitLongTextForCodex, stubInternalZh, translateWithCodexChunks, unwrapMcpTranslatedZh } from "../src/starrykol/translate-zh.js";

const english = "This unique synthetic factual paragraph is English and has no production data. 😀\n".repeat(600);

describe("complete source-backed chunk translation contract", () => {
  it.each(["english_echo", "header_only", "stub"])("rejects one %s chunk even when preceding chunks contain usable Chinese", async (kind) => {
    expect(splitLongTextForCodex(english).length).toBeGreaterThan(1);
    let calls = 0;
    const result = await translateWithCodexChunks(english, async (chunk) => {
      calls += 1;
      if (calls !== 2) return "这是完整可用的合成中文译文，没有生产数据。";
      return kind === "english_echo" ? chunk : kind === "header_only" ? INTERNAL_ZH_HEADER : stubInternalZh(chunk);
    });
    expect(result).toBeNull();
    expect(calls).toBe(2);
  });

  it("rejects explicit upstream errors and needs-input envelopes even if they contain Chinese", () => {
    const text = "翻译服务暂时不可用，请稍后再试。";
    for (const result of [{ text, error: "upstream_failed" }, { translation: text, error_code: "upstream_failed" }, { zh: text, errorCode: "upstream_failed" }, { text, needs_input: true }]) {
      expect(unwrapMcpTranslatedZh(result, english)).toBeNull();
    }
  });
});
