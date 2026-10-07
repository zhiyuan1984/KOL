import { describe, expect, it } from "vitest";
import { applyAddressesToText, hasAddressPlaceholders, mergeSubjectIntoText } from "./addresses";

describe("applyAddressesToText", () => {
  it("只替换收发件占位符，不动人已经写的内容", () => {
    const text = "写合作邮件\n发件邮箱：[发件邮箱]\n收件邮箱：[收件邮箱]\n邮件主题：[邮件主题]\n\nHi，我是小李，想谈合作。";
    const next = applyAddressesToText(text, "m@litime.com", "kol@gmail.com");
    expect(next).toContain("发件邮箱：m@litime.com");
    expect(next).toContain("收件邮箱：kol@gmail.com");
    expect(next).toContain("Hi，我是小李，想谈合作。");
    expect(next).toContain("[邮件主题]");
    expect(hasAddressPlaceholders(next)).toBe(false);
  });

  it("地址为空时保留占位符原文", () => {
    const next = applyAddressesToText("发件邮箱：[发件邮箱]", "", "kol@gmail.com");
    expect(next).toBe("发件邮箱：[发件邮箱]");
  });

  it("没有占位符时原样返回", () => {
    expect(applyAddressesToText("已经写好的正文", "m@litime.com", "kol@gmail.com")).toBe("已经写好的正文");
  });
});

describe("mergeSubjectIntoText", () => {
  it("优先替换 [邮件主题] / [主题] 占位符", () => {
    expect(mergeSubjectIntoText("邮件主题：[邮件主题]", "合作邀约")).toBe("邮件主题：合作邀约");
    expect(mergeSubjectIntoText("主题：[主题]", "合作邀约")).toBe("主题：合作邀约");
  });

  it("没有占位符时追加主题行", () => {
    expect(mergeSubjectIntoText("发件邮箱：m@litime.com", "合作邀约")).toBe("发件邮箱：m@litime.com\n主题：合作邀约");
  });

  it("主题为空时不改文本", () => {
    expect(mergeSubjectIntoText("正文", "")).toBe("正文");
  });
});
