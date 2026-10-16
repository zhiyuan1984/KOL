import { describe, expect, it } from "vitest";
import { INTERNAL_ZH_HEADER, classifyCodexTranslationFailure, isUsableInternalZh, parseTranslatedZh } from "../src/starrykol/translate-zh.js";

const source = "Please review the cooperation terms at https://partners.example.com/legal/campaign/terms?from=mail and email legal.team@example.com to confirm the shipping schedule.";
const chinese = "请查看以下链接中的合作条款：https://partners.example.com/legal/campaign/terms?from=mail，并发送邮件至 legal.team@example.com 确认发货安排。";

describe("translation quality keeps technical identifiers out of English sentence echo detection", () => {
  it("accepts complete genuine Chinese with an unchanged URI and address", () => {
    expect(isUsableInternalZh(`${INTERNAL_ZH_HEADER}\n\n${chinese}`, source)).toBe(true);
    expect(parseTranslatedZh(JSON.stringify({ zh: chinese }), source)).toBe(`${INTERNAL_ZH_HEADER}\n\n${chinese}`);
  });
  it("still rejects a full original English body with Chinese heading and identifiers", () => {
    expect(isUsableInternalZh(`这是内部完整中文译稿\n${source}`, source)).toBe(false);
  });
  it("still rejects a substantive untranslated English sentence fragment with preserved identifiers", () => {
    const echo = "这是一份中文合作资料供内部业务人员查看。Please review the cooperation terms，链接：https://partners.example.com/legal/campaign/terms?from=mail";
    expect(isUsableInternalZh(echo, source)).toBe(false);
  });
  it("reports only actually timed-out requests as codex_timeout", () => {
    expect(classifyCodexTranslationFailure(new Error("RPC timeout after 45 seconds"))).toBe("codex_timeout");
    expect(classifyCodexTranslationFailure(new Error("socket connection closed"))).toBe("codex_request_failed");
  });
  it("separates authentication/access evidence and returns no raw diagnostic text", () => {
    expect(classifyCodexTranslationFailure(new Error("authentication required"))).toBe("codex_auth_or_access_failed");
    expect(classifyCodexTranslationFailure(new Error("synthetic-sensitive-detail"))).toBe("codex_request_failed");
  });
});
