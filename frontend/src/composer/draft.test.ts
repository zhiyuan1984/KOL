import { describe, expect, it, beforeEach } from "vitest";
import { peekComposerDraft, stashComposerDraft, takeComposerDraftStash } from "./draft";
import { COMPOSER_DRAFT_STASH, clientEntryFor } from "./types";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    },
  });
  memory.delete(COMPOSER_DRAFT_STASH);
});

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
