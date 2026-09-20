import { describe, expect, it } from "vitest";
import { parseTranslatedZh, repairStoredZh } from "../src/starrykol/translate-zh.js";

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
