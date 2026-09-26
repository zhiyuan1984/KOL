import { describe, expect, it, vi } from "vitest";
import { hydratePollDelayMs, normalizeBox, normalizeConversation, normalizeThread } from "./client";

describe("mail client vs PR #177 shapes", () => {
  it("normalizes GET /api/mail/box MailBoxStatus", () => {
    const box = normalizeBox({
      entry: "memory",
      creates_session: false,
      mailbox: "larry.zhao@amperetime.com",
      bound: true,
      unread: 2,
      synced_at: "2026-09-18T01:00:00.000Z",
      error: null,
      last_tool: "pageEmailConversations",
      cursor_at: "2026-09-18T01:00:00.000Z",
      cursor_id: "3901",
    });
    expect(box).toMatchObject({
      mailbox: "larry.zhao@amperetime.com",
      bound: true,
      unread: 2,
      error: null,
      last_tool: "pageEmailConversations",
    });
  });

  it("treats empty mailbox as unbound even if leftover fields exist", () => {
    const box = normalizeBox({
      mailbox: "",
      bound: false,
      unread: 0,
      synced_at: null,
      error: null,
    });
    expect(box?.bound).toBe(false);
    expect(box?.mailbox).toBe("");
  });

  it("carries one binding per mailbox with owner_name as the secondary line", () => {
    const box = normalizeBox({
      mailbox: "a@x.com",
      bound: true,
      unread: 1,
      bindings: [
        { mailbox: "a@x.com", owner_name: "甲", unread: 1, bound: true, synced_at: null, error: null },
        { mailbox: "b@x.com", unread: 2, bound: true, synced_at: null, error: "boom" },
      ],
      total_unread: 3,
    });
    expect(box?.bindings).toHaveLength(2);
    expect(box?.bindings?.[0]).toMatchObject({ mailbox: "a@x.com", owner_name: "甲", unread: 1 });
    expect(box?.bindings?.[1]).toMatchObject({ mailbox: "b@x.com", owner_name: undefined, error: "boom" });
    expect(box?.total_unread).toBe(3);
  });

  it("normalizes ConversationRow including last_receipt", () => {
    const row = normalizeConversation({
      id: "thr_1",
      mailbox: "larry.zhao@amperetime.com",
      conversation_id: "3901",
      collaboration_id: "col_xiaomei",
      match_state: "matched",
      subject: "Re: LiTime MCP 连通测试",
      peer_email: "xiaomei.beauty@example.com",
      peer_name: "小美",
      last_at: "2026-09-12T10:00:00.000Z",
      last_direction: "inbound",
      last_preview: "想和贵品牌litime合作",
      unread_count: 2,
      last_receipt: "",
      digest_source: "body_analysis",
    });
    expect(row).toMatchObject({
      id: "thr_1",
      conversation_id: "3901",
      match_state: "matched",
      last_preview: "想和贵品牌litime合作",
      digest_source: "body_analysis",
    });
  });

  it("reads GET /api/mail/conversations/:id conversation + top-level digest", () => {
    const thread = normalizeThread({
      entry: "memory",
      creates_session: false,
      conversation: {
        id: "thr_1",
        mailbox: "larry.zhao@amperetime.com",
        conversation_id: "3901",
        match_state: "matched",
        subject: "Re: LiTime",
        peer_email: "amy@example.com",
        peer_name: "Amy",
        last_preview: "想和贵品牌合作",
        unread_count: 1,
        digest_source: "codex_memory",
        digest_text: "对方已确认档期",
      },
      messages: [{
        id: "m1",
        conversation_id: "3901",
        direction: "inbound",
        occurred_at: "2026-09-12T10:00:00.000Z",
        from_addr: "amy@example.com",
        letter_summary: "想和贵品牌合作",
        summary_source: "body_analysis",
        body_text: "Hello",
      }],
      digest_text: "对方已确认档期",
      digest_source: "codex_memory",
    });
    expect(thread?.thread.conversation_id).toBe("3901");
    expect(thread?.digest).toMatchObject({ text: "对方已确认档期", source: "codex_memory" });
    expect(thread?.messages[0]?.letter_summary).toBe("想和贵品牌合作");
  });

  it("keeps unbound conversations when collaboration_id is null", () => {
    const row = normalizeConversation({
      id: "thr_u",
      conversation_id: "8801",
      mailbox: "larry.zhao@amperetime.com",
      match_state: "unbound",
      collaboration_id: null,
      subject: "Unknown brand pitch",
      peer_email: "stranger@example.net",
      last_preview: "Hello, can we work together",
    });
    expect(row?.match_state).toBe("unbound");
    expect(row?.collaboration_id).toBeNull();
  });

  it("maps MessageRow summary / from_name the way #177 messageRowOf does", () => {
    const thread = normalizeThread({
      conversation: {
        id: "thr_1",
        conversation_id: "3901",
        subject: "Re: LiTime",
        peer_email: "amy@example.com",
      },
      messages: [{
        id: "m1",
        conversation_id: "3901",
        direction: "inbound",
        from_name: "Amy",
        summary: "想和贵品牌合作",
        summary_zh: "想和贵品牌合作",
        summary_source: "body_analysis",
        body_text: "Hello",
      }],
      digest_text: "",
      digest_source: "body_analysis",
    });
    expect(thread?.messages[0]).toMatchObject({
      from_addr: "Amy",
      letter_summary: "想和贵品牌合作",
      summary_source: "body_analysis",
    });
    expect(thread?.digest.source).toBe("body_analysis");
  });
});

describe("thread hydrate polling", () => {
  it("keeps re-reading a hydrating thread every 4s for the first attempts", () => {
    expect(hydratePollDelayMs(1)).toBe(4000);
    expect(hydratePollDelayMs(8)).toBe(4000);
  });

  it("stops instead of polling forever", () => {
    expect(hydratePollDelayMs(9)).toBeNull();
    expect(hydratePollDelayMs(0)).toBeNull();
  });
});

describe("mail workspace first paint", () => {
  it("loadMailWorkspaceFast paints local memory without waiting for decorations", async () => {
    vi.resetModules();
    vi.doMock("../api", () => ({
      api: {
        mailBox: vi.fn(async () => ({ mailbox: "larry.zhao@amperetime.com", bound: true, unread: 0, synced_at: "2026-09-20T03:00:00.000Z", error: null })),
        mailConversations: vi.fn(async () => ({ conversations: [] })),
        starryBinding: vi.fn(() => new Promise(() => { /* never resolves */ })),
        homeBoard: vi.fn(() => new Promise(() => { /* never resolves */ })),
      },
    }));
    const { loadMailWorkspaceFast } = await import("./client");
    const started = Date.now();
    const workspace = await loadMailWorkspaceFast();
    expect(Date.now() - started).toBeLessThan(200);
    expect(workspace.box.bound).toBe(true);
  });
});

describe("mail workspace load must not hang on an unanswered binding lookup", () => {
  it("returns the box even when starryBinding never resolves", async () => {
    vi.resetModules();
    vi.doMock("../api", () => ({
      api: {
        mailBox: vi.fn(async () => ({
          mailbox: "larry.zhao@amperetime.com",
          bound: true,
          unread: 1,
          synced_at: "2026-09-20T03:00:00.000Z",
          error: null,
        })),
        mailConversations: vi.fn(async () => ({ conversations: [] })),
        // The binding endpoint paints an optional owner label; an unanswered
        // request must not pin the whole page at the loading skeleton.
        starryBinding: vi.fn(() => new Promise(() => { /* never resolves */ })),
        homeBoard: vi.fn(() => new Promise(() => { /* never resolves */ })),
      },
    }));
    const { loadMailWorkspace } = await import("./client");
    const workspace = await Promise.race([
      loadMailWorkspace(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    expect(workspace).not.toBeNull();
    expect(workspace?.box.bound).toBe(true);
  }, 10000);
});

describe("mail workspace load never pulls the heavy board payload", () => {
  it("returns the list (and keeps kol_uid/handle from it) without calling homeBoard", async () => {
    vi.resetModules();
    const homeBoard = vi.fn(() => new Promise(() => { /* multi-megabyte endpoint: must never be requested */ }));
    vi.doMock("../api", () => ({
      api: {
        mailBox: vi.fn(async () => ({
          mailbox: "larry.zhao@amperetime.com",
          bound: true,
          owner_name: "赵良玉",
          unread: 3,
          synced_at: "2026-09-20T03:00:00.000Z",
          error: null,
        })),
        mailConversations: vi.fn(async () => ({
          conversations: [
            {
              id: "thr_1",
              conversation_id: "267",
              collaboration_id: "col_KOL1",
              kol_uid: "KOL51DA646D8D8A4544BB93",
              handle: "小美妆日记",
              mailbox: "larry.zhao@amperetime.com",
              match_state: "matched",
              subject: "Exciting Collaboration Opportunity",
              unread_count: 0,
              last_at: "2026-09-19T13:43:14.492Z",
            },
            {
              // Matched, but the list itself has no kol_uid/handle for this one:
              // that used to be the only reason to fetch the board.
              id: "thr_2",
              conversation_id: "268",
              collaboration_id: "col_KOL2",
              mailbox: "larry.zhao@amperetime.com",
              match_state: "matched",
              subject: "Second thread",
              unread_count: 1,
              last_at: "2026-09-18T13:43:14.492Z",
            },
          ],
        })),
        homeBoard,
        starryBinding: vi.fn(async () => null),
      },
    }));
    const { loadMailWorkspace } = await import("./client");
    const started = Date.now();
    const workspace = await Promise.race([
      loadMailWorkspace(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    expect(workspace).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(workspace?.box.bound).toBe(true);
    expect(workspace?.box.mailbox).toBe("larry.zhao@amperetime.com");
    expect(workspace?.conversations).toHaveLength(2);
    expect(workspace?.conversations[0]).toMatchObject({
      conversation_id: "267",
      kol_uid: "KOL51DA646D8D8A4544BB93",
      handle: "小美妆日记",
    });
    expect(workspace?.conversations[1]?.conversation_id).toBe("268");
    // /api/mail/conversations already carries kol_uid/handle, so the list must not
    // hold first paint hostage to a 2MB board request.
    expect(homeBoard).not.toHaveBeenCalled();
  }, 10000);
});
