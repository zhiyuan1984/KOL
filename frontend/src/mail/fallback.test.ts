import { describe, expect, it } from "vitest";
import { conversationsFromBoard, mailHref, workspaceFromFallback } from "./fallback";

describe("mail fallback", () => {
  it("does not filter board threads by mailbox_from", () => {
    const rows = conversationsFromBoard({
      kols: [
        {
          id: "col_a",
          handle: "小美妆日记",
          kol_uid: "KOL_X",
          mail_threads: [{
            conversation_id: "3901",
            subject: "Re: LiTime",
            last_from: "amy@example.com",
            last_from_name: "Amy",
            last_snippet: "想和贵品牌合作",
            last_direction: "inbound",
            last_at: "2026-09-12T10:00:00.000Z",
            unread_count: 1,
          }],
        },
        {
          id: "col_unbound",
          handle: "未建档达人",
          unbound: true,
          mail_threads: [{
            conversation_id: "u-1",
            subject: "Hello",
            last_from: "new@example.com",
            last_snippet: "还没有档案",
            last_direction: "inbound",
          }],
        },
      ],
    }, "larry.zhao@amperetime.com");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.mailbox).toBe("larry.zhao@amperetime.com");
    expect(rows[0]?.conversation_id).toBe("3901");
    expect(rows[1]?.match_state).toBe("unbound");
  });

  it("builds a bound box from starry binding without follow-mail filters", () => {
    const workspace = workspaceFromFallback({
      bound: true,
      mailbox_email: "larry.zhao@amperetime.com",
      owner_name: "钟槿年",
      status: "connected",
      updated_at: "2026-09-18T01:00:00.000Z",
    }, { mail: { unread: 2 }, kols: [] });
    expect(workspace.source).toBe("fallback");
    expect(workspace.box.mailbox).toBe("larry.zhao@amperetime.com");
    expect(workspace.box.unread).toBe(2);
  });

  it("deep-links with box + conversation id", () => {
    expect(mailHref("a@b.com", "3901")).toBe("/mail?box=a%40b.com&c=3901");
    expect(mailHref("", "3901")).toBe("/mail?c=3901");
  });
});
