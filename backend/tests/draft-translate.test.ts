import { describe, expect, it } from "vitest";
import { isUsableInternalZh, stubInternalZh, translateDraftInternal } from "../src/starrykol/translate-zh.js";

process.env.CODEX_MODE = "stub";

const ENGLISH = "Hi Qiyou,\n\nJust following up on the LiTime collaboration. We would love to collaborate.\n";

describe("draft internal Chinese translation", () => {
  it("rejects the old prefix-plus-English cache", () => {
    const fake = `【内部中文译稿 · 不会进入 SMTP】\n${ENGLISH}`;
    expect(isUsableInternalZh(fake, ENGLISH)).toBe(false);
    expect(isUsableInternalZh("", ENGLISH)).toBe(false);
  });

  it("stub copy is Chinese and does not echo the English body", () => {
    const zh = stubInternalZh(ENGLISH);
    expect(zh).toMatch(/[\u4e00-\u9fff]/);
    expect(zh).toContain("不会进入 SMTP");
    expect(zh).not.toContain("We would love to collaborate");
    expect(zh).not.toContain("following up on the LiTime collaboration");
    expect(isUsableInternalZh(zh, ENGLISH)).toBe(true);
  });

  it("translateDraftInternal ignores the English cache and writes Chinese", async () => {
    const zh = await translateDraftInternal(ENGLISH, `【内部中文译稿 · 不会进入 SMTP】\n${ENGLISH}`);
    expect(zh).toMatch(/跟进|合作|你好/);
    expect(zh).not.toContain("We would love to collaborate");
  });
});
