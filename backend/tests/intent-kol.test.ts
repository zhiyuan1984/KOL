import { describe, expect, it } from "vitest";
import { classify, extractEmail, extractHandle } from "../src/host/intent.js";
import { stubClassifyIntent } from "../src/tasks/openai-intent.js";

describe("compose classify", () => {
  it("maps 写合作邮件 and 写跟进 to email_compose", () => {
    for (const t of [
      "写合作邮件",
      "写跟进邮件",
      "给达人写邮件",
      "写报价信",
      "写一份报价邮件",
      "写一份报价邮件 金额 680",
    ]) {
      expect(classify(t).type, t).toBe("chat");
      const i = stubClassifyIntent(t);
      expect(i.task_type, t).toBe("email_compose");
    }
  });

  it("does not treat @写合作邮件 as a KOL handle", () => {
    expect(extractHandle("@写合作邮件")).toBeNull();
    expect(classify("@写合作邮件").handle).toBeNull();
    expect(extractHandle("@写合作邮件 @小美妆日记")).toBe("小美妆日记");
  });

  it("reads 发送给 and a plaintext email from the first-touch prompt", () => {
    expect(extractHandle("首封建联 发送给 灵工连通测试-qiyou1984")).toBe("灵工连通测试-qiyou1984");
    expect(extractEmail("给@灵工连通测试-qiyou1984 写合作邮件 qiyou1984@gmail.com")).toBe("qiyou1984@gmail.com");
    const i = classify("首封建联 发送给 灵工连通测试-qiyou1984 qiyou1984@gmail.com");
    expect(i.handle).toBe("灵工连通测试-qiyou1984");
    expect((i.extras as { email?: string }).email).toBe("qiyou1984@gmail.com");
  });

  it("frontend intent email_compose without handle still needs a worker", () => {
    const i = classify("帮我写封信", "email_compose");
    expect(i.type).toBe("email_compose");
    expect(i.skill).toBe("email_compose");
    expect(i.needs_worker).toBe(true);
    expect(i.handle).toBeNull();
  });

  it("does not lock quote amount or tracking from the command text", () => {
    const i = classify("写报价邮件 100美金1小时 运单号 UPS123456 承运商 UPS");
    expect(i.amount_usd).toBeNull();
    expect(i.tracking).toBeNull();
    expect(i.carrier).toBeNull();
    expect(i.skill).toBeNull();
  });
});
