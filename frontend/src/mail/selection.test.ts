import { describe, expect, it } from "vitest";
import { selectedConversationOf, selectedMessageOf, timelineOf } from "./selection";
import type { MailConversation, MailMessage } from "./types";

const msg = (id: string, at: string | null): MailMessage => ({
  id, conversation_id: "3901", direction: "inbound", occurred_at: at,
  from_addr: "amy@example.com", subject: "Re: LiTime collab", snippet: "",
  letter_summary: "", summary_source: "",
});

const conv = (cid: string): MailConversation => ({
  id: `thr_${cid}`, mailbox: "larry.zhao@amperetime.com", conversation_id: cid,
  collaboration_id: null, match_state: "unbound", subject: "s", peer_email: "",
  peer_name: "", last_at: null, last_direction: "", last_preview: "",
  unread_count: 0, digest_source: "",
});

describe("mail selection", () => {
  it("orders the in-conversation timeline newest first", () => {
    const rows = timelineOf([
      msg("m1", "2026-05-20T10:24:00.000Z"),
      msg("m3", "2026-05-22T10:24:00.000Z"),
      msg("m2", "2026-05-21T15:36:00.000Z"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("keeps messages without a timestamp last", () => {
    const rows = timelineOf([msg("m1", null), msg("m2", "2026-05-22T10:24:00.000Z")]);
    expect(rows.map((r) => r.id)).toEqual(["m2", "m1"]);
  });

  it("resolves the focused message, else the newest one", () => {
    const rows = [msg("m3", "2026-05-22T10:24:00.000Z"), msg("m2", "2026-05-21T15:36:00.000Z")];
    expect(selectedMessageOf(rows, "m2")?.id).toBe("m2");
    expect(selectedMessageOf(rows, "missing")?.id).toBe("m3");
    expect(selectedMessageOf([], "m1")).toBeNull();
  });

  it("resolves the focused conversation, else the first one", () => {
    const rows = [conv("3901"), conv("3902")];
    expect(selectedConversationOf(rows, "3902")?.conversation_id).toBe("3902");
    expect(selectedConversationOf(rows, "nope")?.conversation_id).toBe("3901");
    expect(selectedConversationOf([], "3901")).toBeNull();
  });
});
