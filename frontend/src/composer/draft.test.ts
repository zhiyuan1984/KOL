import { describe, expect, it } from "vitest";
import { peekComposerDraft, stashComposerDraft, takeComposerDraftStash } from "./draft";
import { clientEntryFor } from "./types";

describe("stashComposerDraft", () => {
  it("stores the chip/scope shape without opening a page", () => {
    const stored = stashComposerDraft({
      text: "给@小美妆日记 写跟进",
      intent: "mail_reply",
      chips: [{ kind: "skill", id: "email_compose", label: "写跟进邮件", write: true }],
      object_refs: [{ kind: "kol", id: "xiaomei", label: "小美妆日记" }],
      client_entry: "compose-send",
    });
    expect(peekComposerDraft()?.intent).toBe("mail_reply");
    expect(peekComposerDraft()?.chips?.[0]).toMatchObject({ kind: "skill", id: "email_compose" });
    expect(takeComposerDraftStash()).toEqual(stored);
    expect(peekComposerDraft()).toBeNull();
  });

  it("maps entry intent to client_entry", () => {
    expect(clientEntryFor("free")).toBe("compose-send");
    expect(clientEntryFor("discover")).toBe("start-crawl");
    expect(clientEntryFor("analyze_followed")).toBe("enqueue-analyze");
    expect(clientEntryFor("mail_reply")).toBe("compose-send");
  });
});
