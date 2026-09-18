import { describe, expect, it } from "vitest";
import {
  contactSearchKeyword,
  conversationSubject,
  handleContactHint,
  inferInbound,
  isPlaceholderMailbox,
  matchCollaboration,
  messageFrom,
  messageOccurredAt,
  occurredAtMs,
  realMailboxEmail,
  replySubjectOf,
  sortByMailTime,
} from "../src/starrykol/mail-fields.js";

describe("starry mail field helpers", () => {
  it("takes the ASCII suffix from a connected-test handle as the search keyword", () => {
    expect(handleContactHint("灵工连通测试-qiyou1984")).toBe("qiyou1984");
    expect(contactSearchKeyword({ handle: "灵工连通测试-qiyou1984" })).toBe("qiyou1984");
    expect(contactSearchKeyword({ email: "qiyou1984@gmail.com", handle: "灵工连通测试-qiyou1984" }))
      .toBe("qiyou1984@gmail.com");
  });

  it("parses a Chinese display name from a From header", () => {
    expect(messageFrom({ from: "黄启友 <qiyou1984@gmail.com>" })).toEqual({
      email: "qiyou1984@gmail.com",
      name: "黄启友",
    });
  });

  it("treats operator sends as outbound and KOL letters as inbound", () => {
    expect(inferInbound({
      from: "larry.zhao@amperetime.com",
      recipientEmail: "qiyou1984@gmail.com",
      direction: "outbound",
    }, { kolEmail: "qiyou1984@gmail.com", mailboxEmail: "larry.zhao@amperetime.com" })).toBe(false);
    expect(inferInbound({
      from: "黄启友 <qiyou1984@gmail.com>",
      recipientEmail: "larry.zhao@amperetime.com",
    }, { handle: "灵工连通测试-qiyou1984", mailboxEmail: "larry.zhao@amperetime.com" })).toBe(true);
  });

  it("reads the real subject from subject groups and builds Re:", () => {
    expect(conversationSubject({ subject: "" }, { list: [{ subject: "KOL合作" }] })).toBe("KOL合作");
    expect(replySubjectOf("KOL合作")).toBe("Re: KOL合作");
  });

  it("sorts letters by occurred time, not conversation id or ingest order", () => {
    const ordered = sortByMailTime([
      { conversation_id: "327", occurred_at: "2026-09-07T10:18:00.000Z", subject: "KOL合作", id: "late" },
      { conversation_id: "320", sendTime: "2026-09-06T09:00:00.000Z", subject: "LiTime MCP 连通测试", id: "early" },
      { conversation_id: "400", created_at: "2026-09-07T18:12:00.000Z", subject: "Re: KOL合作", id: "sent" },
    ]);
    expect(ordered.map((row) => row.id)).toEqual(["early", "late", "sent"]);
    expect(occurredAtMs("1757235480")).toBe(1757235480000);
    expect(occurredAtMs("2026-09-07T10:18:00.000Z")).toBe(Date.parse("2026-09-07T10:18:00.000Z"));
  });

  it("reads Starry sendTime as the message timestamp", () => {
    expect(messageOccurredAt({ sendTime: "2026-09-07T10:18:00.000Z" })).toBe("2026-09-07T10:18:00.000Z");
    expect(messageOccurredAt({ sent_at: "2026-09-06T09:00:00.000Z" })).toBe("2026-09-06T09:00:00.000Z");
  });

  it("skips LT placeholder boxes when a real Starry mailbox exists", () => {
    expect(isPlaceholderMailbox("kol.lt@litime.example")).toBe(true);
    expect(isPlaceholderMailbox("ops@example.com")).toBe(true);
    expect(isPlaceholderMailbox("larry.zhao@amperetime.com")).toBe(false);
    expect(realMailboxEmail("kol.lt@litime.example", "larry.zhao@amperetime.com"))
      .toBe("larry.zhao@amperetime.com");
    expect(realMailboxEmail("kol.lt@litime.example")).toBe("");
  });

  it("matches a followed KOL by gmail local-part when the portrait email is empty", () => {
    const hit = matchCollaboration(
      { from: "黄启友 <qiyou1984@gmail.com>", recipientEmail: "larry.zhao@amperetime.com" },
      [{
        id: "col_qiyou",
        handle: "灵工连通测试-qiyou1984",
        email: "",
        mailbox_from: "larry.zhao@amperetime.com",
      }],
    );
    expect(hit?.id).toBe("col_qiyou");
  });

  it("treats the bound mailbox as brand-side when mailbox_from is a placeholder", () => {
    const hit = matchCollaboration(
      {
        from: "xiaomei.beauty@example.com",
        recipientEmail: "larry.zhao@amperetime.com",
        mailboxEmail: "larry.zhao@amperetime.com",
      },
      [{
        id: "col_xiaomei",
        email: "xiaomei.beauty@example.com",
        mailbox_from: "kol.lt@litime.example",
        owner_mailbox: "",
      }],
      "larry.zhao@amperetime.com",
    );
    expect(hit?.id).toBe("col_xiaomei");
  });
});
