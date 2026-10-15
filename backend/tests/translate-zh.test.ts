import { afterEach, describe, expect, it } from "vitest";
import { CODEX_TRANSLATION_CHUNK_MAX_CHARS, CODEX_TRANSLATION_CHUNK_THRESHOLD, parseTranslatedZh, repairStoredZh, splitLongTextForCodex, translateDraftInternal, translateMailBodyZh, translateWithCodexChunks, unwrapMcpTranslatedZh } from "../src/starrykol/translate-zh.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";

const ENGLISH = "Hi, I hope you are doing well. We would love to collaborate with you on the upcoming launch.";

describe("translated zh parsing", () => {
  it("unwraps a single JSON envelope into plain text", () => {
    const out = parseTranslatedZh('{"zh":"希望一切顺利，我们想和你合作。"}', ENGLISH);
    expect(out).toContain("希望一切顺利");
    expect(out).not.toContain('{"zh"');
  });

  it("keeps the first translation when the model appends a second JSON object", () => {
    const out = parseTranslatedZh('{"zh":"感谢您考虑这一合作机会。期待您的回复。"}\n{}', ENGLISH);
    expect(out).toContain("感谢您考虑这一合作机会");
    expect(out).not.toContain('{"zh"');
  });

  it("passes plain text through with the internal header", () => {
    const out = parseTranslatedZh("希望你一切都好，我们很期待合作。", ENGLISH);
    expect(out).toContain("希望你一切都好");
    expect(out).toContain("内部中文译稿");
  });

  it("rejects an envelope that carries no usable Chinese", () => {
    expect(parseTranslatedZh('{"zh":""}', ENGLISH)).toBeNull();
  });
});

describe("stored translation repair", () => {
  it("rewrites a stored JSON envelope as plain text", () => {
    expect(repairStoredZh('{"zh":"感谢您考虑这一合作机会。期待您的回复。"}', ENGLISH))
      .toContain("感谢您考虑这一合作机会");
  });

  it("drops a stored envelope with no usable Chinese so it is translated again", () => {
    expect(repairStoredZh('{"zh":""}', ENGLISH)).toBeNull();
  });

  it("leaves an already-plain translation untouched", () => {
    const stored = "【内部中文译稿】\n\n希望你一切都好，我们很期待合作。";
    expect(repairStoredZh(stored, ENGLISH)).toBe(stored);
  });
});

describe("Starry MCP translation adapter", () => {
  afterEach(() => setStarryKolClientFactory());

  it("sends precisely the requestJson TranslationRequest and unwraps a nested body result", async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    setStarryKolClientFactory(() => ({
      callTool: async (name, args) => {
        called = { name, args: args || {} };
        return { data: { result: { translatedBody: "你好。这只是合成英文翻译检查，请将这句话翻译成中文。" } } };
      },
      close: async () => undefined,
    }));

    await expect(translateMailBodyZh(ENGLISH)).resolves.toEqual({
      text: "你好。这只是合成英文翻译检查，请将这句话翻译成中文。",
      source: "starry_mcp",
    });
    expect(called).toEqual({
      name: "translateEmailToChinese",
      args: { requestJson: JSON.stringify({ text: ENGLISH }) },
    });
  });

  it("does not call MCP for empty input", async () => {
    let calls = 0;
    setStarryKolClientFactory(() => ({
      callTool: async () => { calls += 1; return {}; },
      close: async () => undefined,
    }));

    await expect(translateMailBodyZh("  ")).resolves.toBeNull();
    expect(calls).toBe(0);
  });

  it("does not report an unusable or explicitly failed MCP result as translated", () => {
    expect(unwrapMcpTranslatedZh({ data: { translatedBody: ENGLISH } }, ENGLISH)).toBeNull();
    expect(unwrapMcpTranslatedZh({ success: false, translation: "翻译服务暂不可用，请稍后再试。" }, ENGLISH)).toBeNull();
  });

  it("retains the existing draft fallback when MCP is unavailable", async () => {
    setStarryKolClientFactory(() => ({
      callTool: async () => { throw new Error("synthetic MCP unavailable"); },
      close: async () => undefined,
    }));

    const result = await translateDraftInternal(ENGLISH);
    expect(result).toContain("内部中文译稿");
    expect(result).not.toContain("synthetic MCP unavailable");
  });
});


function syntheticLongUnicodeText(): string {
  let text = "";
  for (let index = 0; Array.from(text).length < 37_612; index += 1) {
    text += `synthetic-unique-segment-${index.toString(36)} remains English 😀\n`;
  }
  return text;
}

describe("large-body Codex translation", () => {
  it("splits Unicode safely, bounds every chunk, and preserves all source text", () => {
    const source = syntheticLongUnicodeText();
    const chunks = splitLongTextForCodex(source);
    expect(Array.from(source).length).toBeGreaterThan(CODEX_TRANSLATION_CHUNK_THRESHOLD);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= CODEX_TRANSLATION_CHUNK_MAX_CHARS)).toBe(true);
    expect(chunks.join("")).toBe(source);
    expect(chunks.join("")).toContain("😀");
  });

  it("returns a complete merged translation only after every bounded chunk succeeds", async () => {
    const source = syntheticLongUnicodeText();
    const received: string[] = [];
    const result = await translateWithCodexChunks(source, async (chunk) => {
      received.push(chunk);
      return `第${received.length}段中文译文完整可用，内容仅用于合成测试。`;
    });

    expect(received.length).toBeGreaterThan(1);
    expect(received.join("")).toBe(source);
    expect(result).toContain("第1段中文译文完整可用");
    expect(result).toContain(`第${received.length}段中文译文完整可用`);
  });

  it("does not return or continue after an intermediate chunk failure", async () => {
    const source = syntheticLongUnicodeText();
    let calls = 0;
    const result = await translateWithCodexChunks(source, async () => {
      calls += 1;
      return calls === 2 ? null : "这是一段可用的中文译文，用于验证失败处理。";
    });

    expect(result).toBeNull();
    expect(calls).toBe(2);
  });

  it("keeps normal-size input as a single unchanged Codex request", async () => {
    const source = "This is a short synthetic English email body that should remain one request.";
    const received: string[] = [];
    const result = await translateWithCodexChunks(source, async (chunk) => {
      received.push(chunk);
      return "这是一封简短的合成英文邮件正文，应保持为单次请求。";
    });

    expect(received).toEqual([source]);
    expect(result).toContain("这是一封简短的合成英文邮件正文");
  });
});
